// Pollution you can see: smoke and steam from the stacks, furnace glow and flame, the smoky haze over the
// valley, waste washing out of the works into the rivers and drifting downstream, and slag poured glowing
// down the bank from the steel works. Everything reads the simulation: the year (gas boom, smoke control,
// clean-air laws), each works' waste policy and how hard it ran last season, the season's wind, and the
// "smoke this season" field (env.air).
//
// Cheap by construction: puffs, glows and stains are small cached sprites drawn with drawImage and
// globalAlpha (no gradients built per frame); the haze is a handful of soft blobs per block painted into a
// low-resolution canvas and scaled up with smoothing; spill paths are traced once per works.

import { blockGrid, blockStatics, B } from "../core/blocks";
import { SOOT_SCALE } from "../core/environment";
import { type GameState, rivalRunning, type Works } from "../core/game";
import type { GameMap } from "../core/map";
import { RIVALS } from "../core/rivals";
import { Terrain } from "../core/terrain";
import { type Camera, BASE_M, HH, HW, project, ZPX } from "./iso";
import { waterFields } from "./waterfields";

const DIR8 = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]] as const;

function hash(a: number, b: number, c = 0): number {
  let h = (a * 374761393) ^ (b * 668265263) ^ (c * 2147483647);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

// ---------------------------------------------------------------- sprites (built once, cached)

type Cv = HTMLCanvasElement;
function canvas(w: number, h: number): Cv { const c = document.createElement("canvas"); c.width = w; c.height = h; return c; }
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((b) => (b + 0.5) / 16 - 0.5);

const spriteCache = new Map<string, Cv>();
/**
 * A soft, lumpy puff (smoke, steam, stain, haze): a few overlapping lobes, lit from the upper left, with
 * an ordered-dither edge so it keeps a pixel-art grain. `flat` squashes it 2:1 for things lying on the water.
 */
function puffSprite(r: number, g: number, b: number, variant: number, kind: "puff" | "stain" | "blob"): Cv {
  const key = `${kind}|${r},${g},${b}|${variant}`;
  let c = spriteCache.get(key);
  if (c) return c;
  const S = kind === "blob" ? 16 : 32;
  c = canvas(S, S);
  const cx = c.getContext("2d")!;
  const img = cx.createImageData(S, S);
  // lobes: centre plus 3–4 bumps around it
  const lobes: [number, number, number][] = [[0, 0, 0.62]];
  const nl = kind === "blob" ? 0 : 3 + (variant % 2);
  for (let k = 0; k < nl; k++) {
    const a = (k / nl) * Math.PI * 2 + hash(variant, k, 3) * 1.4;
    const d = 0.28 + hash(variant, k, 4) * 0.12;
    lobes.push([Math.cos(a) * d, Math.sin(a) * d * (kind === "stain" ? 0.8 : 1), 0.34 + hash(variant, k, 5) * 0.12]);
  }
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const u = (x + 0.5) / S * 2 - 1, v = (y + 0.5) / S * 2 - 1;
    let a = 0;
    for (const [lx, ly, lr] of lobes) {
      const d = Math.hypot(u - lx, v - ly) / lr;
      if (d < 1) a = Math.max(a, kind === "stain" ? (1 - d * d) * 1.15 : (1 - d * d) * (1 - d * d));
    }
    if (kind === "blob") a = clamp01(1 - Math.hypot(u, v)) ** 1.6;
    else a = clamp01(a * 1.25);
    if (a <= 0) continue;
    // grain: a little ordered dither and per-pixel noise in the alpha
    const grain = kind === "blob" ? 0 : BAYER[(y & 3) * 4 + (x & 3)] * 0.22 + (hash(x, y, variant + 11) - 0.5) * 0.12;
    a = clamp01(a + grain * a);
    // light from the upper left, shade lower right (puffs only)
    const lit = kind === "puff" ? 1.08 - (u + v) * 0.1 - Math.max(0, v) * 0.06 : 1;
    const o = (y * S + x) * 4;
    img.data[o] = Math.min(255, r * lit); img.data[o + 1] = Math.min(255, g * lit); img.data[o + 2] = Math.min(255, b * lit);
    img.data[o + 3] = Math.round(a * 255);
  }
  cx.putImageData(img, 0, 0);
  spriteCache.set(key, c);
  return c;
}

/** a radial glow (additive): white-hot core, orange, red rim */
function glowSprite(hot: boolean): Cv {
  const key = `glow|${hot}`;
  let c = spriteCache.get(key);
  if (c) return c;
  c = canvas(64, 64);
  const cx = c.getContext("2d")!;
  const gr = cx.createRadialGradient(32, 32, 0, 32, 32, 32);
  if (hot) { gr.addColorStop(0, "rgba(255,236,170,1)"); gr.addColorStop(0.18, "rgba(255,190,90,0.85)"); gr.addColorStop(0.5, "rgba(235,105,35,0.35)"); }
  else { gr.addColorStop(0, "rgba(255,180,90,0.85)"); gr.addColorStop(0.25, "rgba(245,125,45,0.5)"); gr.addColorStop(0.6, "rgba(210,70,25,0.18)"); }
  gr.addColorStop(1, "rgba(160,40,10,0)");
  cx.fillStyle = gr; cx.fillRect(0, 0, 64, 64);
  spriteCache.set(key, c);
  return c;
}

// ---------------------------------------------------------------- what the simulation says

/** How dark and heavy works smoke is in a year: the 1884–91 gas boom, smoke control from 1946, the clean-air 1970s. */
export function eraSmoke(year: number): { dark: number; size: number } {
  if (year < 1884) return { dark: 0.9, size: 1 };
  if (year < 1891) return { dark: 0.5, size: 0.75 };
  if (year < 1946) return { dark: 1, size: 1.06 };
  if (year < 1953) { const k = (year - 1946) / 7; return { dark: lerp(1, 0.62, k), size: lerp(1.06, 0.86, k) }; }
  if (year < 1970) { const k = (year - 1953) / 17; return { dark: lerp(0.62, 0.48, k), size: lerp(0.86, 0.76, k) }; }
  if (year < 1977) { const k = (year - 1970) / 7; return { dark: lerp(0.48, 0.22, k), size: lerp(0.76, 0.52, k) }; }
  return { dark: 0.2, size: 0.5 };
}

/** One works' smoke and fire, fixed for the season: darkness 0..1, plume size, and heat (how hard it ran) 0..1. */
export interface SmokeLook { dark: number; size: number; heat: number }

/** The look of one of your works (the company's waste policy applies to every works) or of a rival (by year). */
export function smokeLook(g: GameState, w?: Works): SmokeLook {
  const era = eraSmoke(g.world.year);
  let dark = era.dark, size = era.size, heat = 1;
  if (w && g.company) {
    const waste = g.company.biz.policy.waste;
    if (waste === "dump") { dark = Math.min(1, dark * 1.15 + 0.1); size *= 1.22; }
    else if (waste === "abate") { dark *= 0.62; size *= 0.74; }
    const s = w.lastSeason;
    heat = s && s.workersWanted > 0 ? clamp01(s.workersHired / s.workersWanted) * (s.produced > 0 ? 1 : 0.3) : 0.6;
    if (g.company.biz.layoffUntil > g.turn) heat *= 0.55;
    if (w.status === "flooded") heat *= 0.4; // banking the fires while the water's in the yard
    heat = Math.max(0.15, heat);
  }
  return { dark, size: size * (0.6 + 0.4 * heat), heat };
}

/** A rival's look: by year, full heat while running (less in its declining years). */
export function rivalLook(g: GameState, id: string): SmokeLook {
  const era = eraSmoke(g.world.year);
  const def = RIVALS.find((d) => d.id === id);
  const heat = def ? clamp01(rivalRunning(def, g.world.year) / 0.85) : 1;
  return { dark: era.dark, size: era.size * (0.6 + 0.4 * heat), heat };
}

/** The season's wind, as a screen direction (east = (0.89, 0.45)) and a strength. Seeded per game and season. */
export interface Wind { x: number; y: number; s: number }
let windCache: { key: string; w: Wind } | null = null;
// direction the wind blows towards, degrees (0 = east, 90 = south): spring WSW, summer SW, autumn W, winter NW
const SEASON_WIND = [-15, -35, 0, 30];
const SEASON_GUST = [1, 0.75, 0.95, 1.25];
export function windFor(g: GameState): Wind {
  const key = `${g.seed}|${g.turn}`;
  if (windCache?.key === key) return windCache.w;
  const s = g.turn % 4;
  // mostly the prevailing westerly; one season in six something else (an east wind before a storm)
  const odd = hash(g.seed, g.turn, 91) < 0.16;
  const deg = (odd ? 180 + (hash(g.seed, g.turn, 92) - 0.5) * 120 : SEASON_WIND[s] + (hash(g.seed, g.turn, 93) - 0.5) * 60);
  const a = deg * Math.PI / 180;
  const gx = Math.cos(a), gy = Math.sin(a); // ground direction in tiles
  let sx = gx - gy, sy = (gx + gy) * 0.5;   // onto the screen (2:1 iso)
  const l = Math.hypot(sx, sy) || 1; sx /= l; sy /= l;
  const w = { x: sx, y: sy, s: SEASON_GUST[s] * (0.7 + hash(g.seed, g.turn, 94) * 0.6) * (odd ? 0.7 : 1) };
  windCache = { key, w };
  return w;
}

// ---------------------------------------------------------------- smoke, steam, glow, flame

const N_PUFFS = 10;
/**
 * A plume from one stack: puffs rise first, then bend over with the wind, growing, thinning and lightening
 * as they go. Each puff gets its own size, shade, sway and sprite every cycle so no two look alike.
 * `sz` is the emitter size × zoom.
 */
export function drawPlume(ctx: CanvasRenderingContext2D, sx: number, sy: number, sz: number, steam: boolean, seed: number,
  look: SmokeLook, wind: Wind, t: number, night: number) {
  const size = steam ? 0.7 + 0.3 * look.size : look.size;
  const rate = steam ? 0.2 : 0.11 + 0.02 * wind.s;
  const rise = (steam ? 58 : 66) * sz * Math.sqrt(size) / (0.5 + 0.5 * wind.s);
  const drift = 74 * sz * wind.s * Math.sqrt(size);
  const nightK = 1 - 0.5 * night;
  const dens = steam ? 0.75 : (0.5 + 0.5 * look.dark) * (0.55 + 0.45 * look.heat);
  const n = steam ? 8 : N_PUFFS;
  for (let k = 0; k < n; k++) {
    const u = t * rate + k / n + seed / 97 + hash(seed, k, 7) * 0.04;
    const cyc = Math.floor(u), ph = u - cyc;
    const h1 = hash(seed + k * 13, cyc, 1), h2 = hash(seed + k * 13, cyc, 2), h3 = hash(seed + k * 13, cyc, 3);
    // rise fast and slow down; the wind bends the plume over more and more
    const up = rise * (1 - (1 - ph) * (1 - ph)) * (0.85 + 0.3 * h1);
    const along = drift * ph * ph * (1.6 - 0.6 * ph);
    const sway = Math.sin(ph * 5 + seed + h2 * 6) * 4 * sz * ph;
    const px = sx + wind.x * along - wind.y * sway;
    const py = sy - up + wind.y * along * 0.5 + wind.x * sway * 0.5;
    const r = (steam ? 4 + ph * 22 : 4 + ph * 20) * sz * size * (0.8 + 0.45 * h2);
    // fade in quickly, out slowly; steam dissipates sooner
    const fin = Math.min(1, ph * 10);
    const a = fin * (steam ? (1 - ph) * (1 - ph) * 0.9 : Math.pow(1 - ph, 1.25)) * dens * (0.8 + 0.4 * h3);
    if (a < 0.02 || r < 0.5) continue;
    let shade: number;
    if (steam) shade = 236 - ph * 22;
    else shade = lerp(lerp(170, 44, look.dark), lerp(204, 112, look.dark), ph) + (h3 - 0.5) * 24;
    const lvl = Math.max(0, Math.min(15, Math.round(shade * nightK / 16)));
    const c = lvl * 16 + 8;
    const sp = steam ? puffSprite(c - 6, c, Math.min(255, c + 8), (k + cyc) & 3, "puff") : puffSprite(c + 6, c + 1, c - 6, (k + cyc) & 3, "puff");
    ctx.globalAlpha = Math.min(1, a);
    ctx.drawImage(sp, px - r * 1.25, py - r, r * 2.5, r * 2);
  }
  ctx.globalAlpha = 1;
}

/** Furnace glow or a flame, brightness from last season's work; drawn additively (set "lighter" first). */
export function drawFire(ctx: CanvasRenderingContext2D, sx: number, sy: number, sz: number, flame: boolean, big: boolean, seed: number,
  heat: number, wind: Wind, t: number, night: number) {
  const hb = (0.2 + 0.8 * heat) * (0.8 + 0.4 * hash(seed, 3, 61));
  // flicker: two incommensurate waves plus a slow breath, different per furnace
  const flick = 0.72 + 0.16 * Math.sin(t * 8.3 + seed) + 0.1 * Math.sin(t * 13.7 + seed * 2.1) + 0.06 * Math.sin(t * 1.3 + seed * 0.7);
  if (night > 0.05) {
    // after dark the furnace light spills over the yard and the walls around it
    const pool = (30 + 14 * hash(seed, 4, 62)) * sz * (0.6 + 0.4 * heat);
    ctx.globalAlpha = Math.min(1, 0.16 * night * hb * (0.85 + 0.15 * flick));
    ctx.drawImage(glowSprite(false), sx - pool, sy - pool * 0.6, pool * 2, pool * 1.2);
  }
  const halo = (flame ? 10 : 12) * sz * (1 + night * 0.8) * (0.7 + 0.3 * heat);
  ctx.globalAlpha = Math.min(1, (0.2 + 0.45 * night) * flick * hb);
  ctx.drawImage(glowSprite(false), sx - halo, sy - halo * 0.75, halo * 2, halo * 1.5);
  const core = halo * 0.32;
  ctx.globalAlpha = Math.min(1, (0.35 + 0.4 * night) * flick * hb);
  ctx.drawImage(glowSprite(true), sx - core, sy - core * 0.7, core * 2, core * 1.4);
  if (flame) {
    const fh = (big ? 15 : 9) * sz * flick * (0.45 + 0.55 * heat);
    const lean = wind.x * wind.s * 2.5 * sz;
    ctx.globalAlpha = Math.min(1, 0.75 * hb);
    ctx.fillStyle = "rgb(240,110,30)";
    ctx.beginPath(); ctx.ellipse(sx + lean * 0.5, sy - fh * 0.55, 2.8 * sz * (big ? 1.3 : 1), fh * 0.6, lean * 0.02, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "rgb(255,214,110)";
    ctx.beginPath(); ctx.ellipse(sx + lean * 0.3, sy - fh * 0.4, 1.7 * sz * (big ? 1.3 : 1), fh * 0.42, lean * 0.02, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "rgb(255,250,220)";
    ctx.beginPath(); ctx.ellipse(sx, sy - fh * 0.22, 0.9 * sz, fh * 0.2, 0, 0, Math.PI * 2); ctx.fill();
    if (big && heat > 0.3) {
      // the Bessemer blow: a shower of sparks arcing out of the converter mouth
      ctx.fillStyle = "rgb(255,220,120)";
      const ps = Math.max(1, Math.round(sz));
      for (let k = 0; k < 10; k++) {
        const u = t * 0.9 + k / 10 + hash(seed, k, 21);
        const cyc = Math.floor(u), ph = u - cyc;
        const vx = (hash(seed + k, cyc, 22) - 0.5) * 36 * sz + lean * 3, vy = (18 + hash(seed + k, cyc, 23) * 22) * sz;
        ctx.globalAlpha = (1 - ph) * 0.9 * hb;
        ctx.fillRect(Math.round(sx + vx * ph), Math.round(sy - fh * 0.8 - vy * ph + 34 * sz * ph * ph), ps, ps);
      }
    }
  }
  ctx.globalAlpha = 1;
}

// ---------------------------------------------------------------- haze

/** the tile rectangle under the screen (with a margin) */
function viewTiles(m: GameState["map"], cam: Camera, cw: number, ch: number) {
  const corners = [[0, 0], [cw, 0], [cw, ch], [0, ch]].map(([px, py]) => {
    const wx = cam.x + px / cam.zoom, wy = cam.y + py / cam.zoom + (260 - BASE_M) * ZPX;
    const a = wx / HW, b = wy / HH;
    return [(a + b) / 2, (b - a) / 2];
  });
  return {
    x0: Math.max(0, Math.floor(Math.min(...corners.map((c) => c[0]))) - 6), x1: Math.min(m.width - 1, Math.ceil(Math.max(...corners.map((c) => c[0]))) + 12),
    y0: Math.max(0, Math.floor(Math.min(...corners.map((c) => c[1]))) - 6), y1: Math.min(m.height - 1, Math.ceil(Math.max(...corners.map((c) => c[1]))) + 12),
  };
}

/** colour of the smoke pall: brown coal smoke early, greyer later */
function hazeColour(year: number): [number, number, number] {
  const k = clamp01((year - 1930) / 40);
  return [Math.round(lerp(126, 150, k)), Math.round(lerp(112, 146, k)), Math.round(lerp(90, 138, k))];
}

const HAZE_DS = 8; // low-res canvas: one pixel per 8×8 screen pixels
let hazeCv: Cv | null = null;
let hazeKey = "", hazeT = -1, hazeDrawn = 0;

/**
 * Smoky air where the smoke is: soft blobs per block of the season's smoke field (heavier in the valley
 * floors and mill towns, light on the hilltops), drifting slowly downwind, painted into a small canvas and
 * scaled up smoothly; plus a light era tint over everything.
 */
export function drawHaze(ctx: CanvasRenderingContext2D, g: GameState, cam: Camera, cw: number, ch: number, time = 0) {
  const y = g.world.year, z = cam.zoom;
  const tint = y < 1884 ? 0.07 : y < 1891 ? 0.035 : y < 1947 ? 0.085 : Math.max(0.012, 0.085 - (y - 1947) * 0.003);
  const [hr, hg, hb] = hazeColour(y);
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  // the era's pall and the per-area haze share one small canvas, composited once (one full-screen pass)
  const lw = Math.ceil(cw / HAZE_DS), lh = Math.ceil(ch / HAZE_DS);
  if (!hazeCv) hazeCv = canvas(lw, lh);
  if (hazeCv.width < lw || hazeCv.height < lh) { hazeCv.width = Math.max(lw, hazeCv.width); hazeCv.height = Math.max(lh, hazeCv.height); }
  // the drift is slow: repaint the small canvas only when the view or season changes, or ~8 times a second
  const key = `${cam.x},${cam.y},${z},${cw},${ch},${g.turn},${g.seed},${y}`;
  if (key !== hazeKey || Math.abs(time - hazeT) > 0.12) {
    hazeKey = key; hazeT = time;
    hazeDrawn = paintHaze(hazeCv, g, cam, cw, ch, lw, lh, time, hr, hg, hb, tint);
  }
  if (hazeDrawn || tint > 0.01) {
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "low";
    ctx.drawImage(hazeCv, 0, 0, lw, lh, 0, 0, lw * HAZE_DS, lh * HAZE_DS);
  }
  ctx.restore();
}

/** paint the haze blobs into the low-res canvas; returns how many were drawn */
function paintHaze(cv: Cv, g: GameState, cam: Camera, cw: number, ch: number, lw: number, lh: number, time: number, hr: number, hg: number, hb: number, tint: number): number {
  const m = g.map, z = cam.zoom;
  const hc = cv.getContext("2d")!;
  hc.setTransform(1, 0, 0, 1, 0, 0);
  hc.clearRect(0, 0, lw, lh);
  // the era's pall: a little heavier towards the horizon
  const gr = hc.createLinearGradient(0, 0, 0, lh);
  gr.addColorStop(0, `rgba(${hr + 8},${hg + 8},${hb + 6},${(tint * 1.3).toFixed(3)})`);
  gr.addColorStop(1, `rgba(${hr},${hg},${hb},${(tint * 0.6).toFixed(3)})`);
  hc.globalAlpha = 1;
  hc.fillStyle = gr;
  hc.fillRect(0, 0, lw, lh);
  const bg = blockGrid(m), st = blockStatics(m), air = g.env.air;
  const v = viewTiles(m, cam, cw, ch);
  const stride = z >= 0.75 ? 1 : z >= 0.375 ? 2 : z >= 0.19 ? 3 : 4;
  const blob = puffSprite(hr, hg, hb, 0, "blob");
  const wind = windFor(g);
  const season = g.turn % 4, inv = season >= 2 ? 0.5 : 0.2;
  // blob size: about two blocks across on screen, in low-res pixels
  const rx = (B * stride * HW * 2.3 * z) / HAZE_DS, ry = rx * 0.6;
  const drift = B * stride * 1.4 * HW * z / HAZE_DS; // how far a blob drifts in one cycle
  const bx0 = Math.floor(v.x0 / B / stride) * stride, bx1 = Math.ceil(v.x1 / B), by0 = Math.floor(v.y0 / B / stride) * stride, by1 = Math.ceil(v.y1 / B);
  let drawn = 0;
  for (let by = by0; by <= by1 && by < bg.bh; by += stride) for (let bx = bx0; bx <= bx1 && bx < bg.bw; bx += stride) {
    const b = by * bg.bw + bx;
    // smoke this season, made worse visually under valley inversions and better on the ridges
    let s = 0, n = 0;
    for (let dy = 0; dy < stride && by + dy < bg.bh; dy++) for (let dx = 0; dx < stride && bx + dx < bg.bw; dx++) { s += air[b + dy * bg.bw + dx]; n++; }
    const a0 = (s / n) * SOOT_SCALE * (1 + st.trap[b] * inv - st.ridge[b] * 0.35);
    const amt = 0.34 * (1 - Math.exp(-Math.max(0, a0 - 0.03) * 2.6));
    if (amt < 0.015) continue;
    const cxT = (bx + stride / 2) * B, cyT = (by + stride / 2) * B;
    const [wx, wy] = project(cxT, cyT, st.elev[b] + 25);
    const lx = (wx - cam.x) * z / HAZE_DS, ly = (wy - cam.y) * z / HAZE_DS;
    if (lx < -rx * 2 || ly < -ry * 2 || lx > lw + rx * 2 || ly > lh + ry * 2) continue;
    // three staggered layers drifting downwind, each fading in and out (sin² weights a third of a cycle
    // apart sum to a constant): the amount stays steady while the texture moves
    for (let L = 0; L < 3; L++) {
      const u = time * 0.03 * wind.s + hash(bx, by, 31) + L / 3;
      const ph = u - Math.floor(u);
      const sn = Math.sin(ph * Math.PI), w = sn * sn * (2 / 3);
      const sc = 0.92 + 0.16 * hash(bx, by, 32 + L);
      hc.globalAlpha = Math.min(1, amt * w);
      const ox = lx + wind.x * drift * (ph - 0.5), oy = ly + wind.y * drift * (ph - 0.5);
      hc.drawImage(blob, ox - rx * sc, oy - ry * sc, rx * 2 * sc, ry * 2 * sc);
      drawn++;
    }
  }
  hc.globalAlpha = 1;
  return drawn;
}

// ---------------------------------------------------------------- spills and slag

/** a works' outfall and plume course (tile coords + water level), and the bank above it if the river runs by the works */
interface SpillPath { pts: [number, number, number][]; land: [number, number, number] | null }
const pathCache = new WeakMap<GameMap, Map<string, SpillPath | null>>();
const PATH_LEN = 44;

/** The outfall nearest a works and the way its waste drifts downstream, smoothed into a curve; traced once. */
function spillPath(m: GameMap, x0: number, y0: number, fp: number): SpillPath | null {
  let cache = pathCache.get(m);
  if (!cache) { cache = new Map(); pathCache.set(m, cache); }
  const key = `${x0},${y0},${fp}`;
  if (cache.has(key)) return cache.get(key)!;
  const { shore, down } = waterFields(m);
  const cx = x0 + fp / 2, cy = y0 + fp / 2;
  let out = -1, bd = Infinity;
  // the works' sewer runs to the nearest river, up to ten tiles beyond its own ground (Clairton sits back from the Mon)
  const R = Math.ceil(fp / 2) + 10;
  for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
    const x = Math.round(cx + dx), y = Math.round(cy + dy);
    if (x < 0 || y < 0 || x >= m.width || y >= m.height) continue;
    const j = y * m.width + x;
    if (m.terrain[j] === Terrain.Water && down[j] >= 0 && Math.hypot(dx, dy) < bd) { bd = Math.hypot(dx, dy); out = j; }
  }
  if (out < 0) { cache.set(key, null); return null; }
  const ohio = /Ohio/.test(m.waterNames[String(m.water[out])] ?? "");
  const path: number[] = [out];
  let cur = out;
  const seen = new Set<number>([out]);
  for (let k = 0; k < PATH_LEN; k++) {
    const x = cur % m.width, y = (cur / m.width) | 0;
    let nb = -1, bv = ohio ? -Infinity : Infinity;
    for (const [dx, dy] of DIR8) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= m.width || ny >= m.height) continue;
      const j = ny * m.width + nx;
      if (down[j] < 0 || seen.has(j)) continue;
      // downstream, but drawn out from the bank towards mid-river
      const val = down[j] - shore[j] * 0.15 * (ohio ? -1 : 1);
      if (ohio ? val > bv : val < bv) { bv = val; nb = j; }
    }
    if (nb < 0) break;
    cur = nb; path.push(cur); seen.add(cur);
  }
  // smooth the tile staircase into a curve (two passes of a 3-tap average; the outfall stays put)
  let pts: [number, number, number][] = path.map((j) => [j % m.width + 0.5, ((j / m.width) | 0) + 0.5, m.waterLevel[j]]);
  for (let pass = 0; pass < 3; pass++) {
    pts = pts.map((p, k) => k === 0 || k === pts.length - 1 ? p : [(pts[k - 1][0] + p[0] * 2 + pts[k + 1][0]) / 4, (pts[k - 1][1] + p[1] * 2 + pts[k + 1][1]) / 4, p[2]]);
  }
  // the bank above the outfall, a little way towards the works, for slag pours
  const ox = out % m.width + 0.5, oy = ((out / m.width) | 0) + 0.5;
  const dl = Math.hypot(cx - ox, cy - oy) || 1;
  let land: [number, number, number] | null = null;
  // slag is tipped only where the works stands on the bank
  if (bd <= fp / 2 + 4) for (let d = 0.8; d <= 3; d += 0.4) {
    const fx = ox + (cx - ox) / dl * d, fy = oy + (cy - oy) / dl * d;
    const j = Math.floor(fy) * m.width + Math.floor(fx);
    if (j >= 0 && j < m.terrain.length && m.terrain[j] !== Terrain.Water) {
      // the ladle tips from the top of the bank, a little further in
      const tx = Math.min(m.width - 1, Math.max(0, fx + (cx - ox) / dl * 0.8)), ty = Math.min(m.height - 1, Math.max(0, fy + (cy - oy) / dl * 0.8));
      land = [tx, ty, Math.max(m.elevation[j], m.elevation[Math.floor(ty) * m.width + Math.floor(tx)]) + 3];
      break;
    }
  }
  const sp = { pts, land };
  cache.set(key, sp);
  return sp;
}

/** a point `u` tiles along the path (fractional), with the local direction */
function along(pts: [number, number, number][], u: number): [number, number, number, number, number] {
  const k = Math.max(0, Math.min(pts.length - 2, Math.floor(u)));
  const f = Math.max(0, Math.min(1, u - k));
  const a = pts[k], b = pts[k + 1] ?? a;
  const dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1;
  return [a[0] + dx * f, a[1] + dy * f, a[2] + (b[2] - a[2]) * f, dx / l, dy / l];
}

const SPILL_COL: Record<string, [number, number, number]> = {
  steel: [192, 100, 42], glass: [214, 220, 206], power: [28, 26, 26], metalworks: [138, 96, 158], benzene: [26, 22, 20],
};

/**
 * A stain drifting downstream from an outfall: soft flat blotches flowing along the river's course, spreading
 * and fading as they go. `len` in tiles, `strength` scales the opacity.
 */
function drawStain(ctx: CanvasRenderingContext2D, S: (fx: number, fy: number, h: number) => [number, number], z: number, m: GameMap,
  sp: SpillPath, col: [number, number, number], len: number, strength: number, sheen: boolean, seed: number, time: number) {
  const pts = sp.pts;
  const L = Math.min(len, pts.length - 1);
  if (L < 2) return;
  const n = Math.round(L * (z >= 0.75 ? 4 : z >= 0.4 ? 2.2 : 1.4)) + 4;
  const ak = z >= 0.75 ? 1 : z >= 0.4 ? 1.5 : 2.2; // fewer, stronger blotches when zoomed out
  const rate = 0.9 / L; // about a tile a second... slower for long plumes
  for (let k = 0; k < n; k++) {
    const u = time * rate * 0.6 + k / n + hash(seed, k, 41) * 0.5 / n;
    const cyc = Math.floor(u), s = u - cyc;
    const h1 = hash(seed + k, cyc, 42), h2 = hash(seed + k, cyc, 43);
    const [fx, fy, h, dx, dy] = along(pts, s * L);
    // spread across the current, wider downstream; a slow meander
    const wide = 0.4 + s * 2.4;
    let lat = (h1 - 0.5) * wide + Math.sin(time * 0.4 + k * 1.7 + seed) * 0.25 * s;
    // keep to the water: a plume hugging the bank spreads out into the river, not over the land
    const lx = Math.floor(fx - dy * lat), ly = Math.floor(fy + dx * lat);
    if (m.terrain[ly * m.width + lx] !== Terrain.Water) lat = -lat;
    const [sx, sy] = S(fx - dy * lat, fy + dx * lat, h);
    const r = (10 + s * 56) * z * (0.75 + 0.5 * h2);
    // thickest at the mouth of the outfall, thinning as it spreads downstream
    const a = Math.min(1, s * 40) * Math.pow(1 - s, 1.4) * 0.2 * ak * strength;
    if (a < 0.015) continue;
    ctx.globalAlpha = a;
    ctx.drawImage(puffSprite(col[0], col[1], col[2], (k + cyc) & 3, "stain"), sx - r, sy - r * 0.5, r * 2, r);
    if (sheen && (k + cyc) % 4 === 0) {
      // an oily rainbow film catching the light
      ctx.globalAlpha = Math.min(1, a * 1.6);
      ctx.drawImage(puffSprite((k & 2) ? 150 : 110, (k & 2) ? 120 : 190, 200, 2, "stain"), sx - r * 0.45 + r * 0.25 * (h1 - 0.5), sy - r * 0.12, r * 0.9, r * 0.22);
    }
  }
  ctx.globalAlpha = 1;
}

/** Molten slag tipped over the bank from a ladle car: a glowing stream, a pool of glow, steam off the water. */
function drawSlag(ctx: CanvasRenderingContext2D, S: (fx: number, fy: number, h: number) => [number, number], z: number,
  sp: SpillPath, seed: number, time: number, night: number) {
  if (!sp.land) return;
  const u = time * 0.075 + hash(seed, 0, 51);
  const ph = u - Math.floor(u);
  const POUR = 0.4;
  const env = ph < POUR ? Math.sin((ph / POUR) * Math.PI) : 0;
  const cool = ph < POUR ? (ph / POUR) : Math.max(0, 1 - (ph - POUR) / 0.35); // the bank keeps glowing a while
  const w = sp.pts[0];
  const [tx, ty] = S(sp.land[0], sp.land[1], sp.land[2]);
  const [bx, by] = S(w[0] + (sp.land[0] - w[0]) * 0.25, w[1] + (sp.land[1] - w[1]) * 0.25, w[2]);
  ctx.globalCompositeOperation = "lighter";
  // the bank of cooling slag glows dull red after a pour
  const gl = glowSprite(false);
  if (cool > 0.02) {
    const r = (10 + 10 * night) * z;
    const mx = (tx + bx) / 2, my = (ty + by) / 2;
    ctx.globalAlpha = cool * (0.2 + 0.35 * night);
    ctx.drawImage(gl, mx - r, my - r * 0.6, r * 2, r * 1.2);
  }
  if (env > 0.02) {
    // the stream: slag runs down the face of the dump in a lumpy, flowing ribbon: a dull red crust at the
    // edges, bright clots sliding down it, a thin white-hot core while the ladle pours hardest
    const mx = (tx + bx) / 2, my = Math.min(ty, by) + Math.abs(by - ty) * 0.15; // bulges out over the bank
    const qx = (u: number) => (1 - u) * (1 - u) * tx + 2 * u * (1 - u) * mx + u * u * bx;
    const qy = (u: number) => (1 - u) * (1 - u) * ty + 2 * u * (1 - u) * my + u * u * by;
    ctx.strokeStyle = "rgb(150,36,10)"; ctx.globalAlpha = 0.6 * env;
    ctx.lineWidth = Math.max(1.5, 5 * z * (0.5 + 0.5 * env));
    ctx.beginPath(); ctx.moveTo(tx, ty); ctx.quadraticCurveTo(mx, my, bx, by); ctx.stroke();
    const hot = glowSprite(true);
    for (let k = 0; k < 9; k++) {
      const u = (k / 9 + time * 0.9) % 1;
      const w = (2.2 + 1.6 * hash(seed, k, 55)) * z * (0.6 + 0.4 * env) * (1 + u * 0.6);
      ctx.globalAlpha = env * (0.75 - u * 0.35);
      ctx.drawImage(hot, qx(u) - w, qy(u) - w * 0.8, w * 2, w * 1.6);
    }
    if (env > 0.5) {
      ctx.strokeStyle = "rgb(255,236,170)"; ctx.globalAlpha = (env - 0.5) * 1.6;
      ctx.lineWidth = Math.max(1, 1.2 * z);
      ctx.beginPath(); ctx.moveTo(tx, ty); ctx.quadraticCurveTo(mx, my, bx, by); ctx.stroke();
    }
    // glow where it hits the water
    const r = (16 + 26 * night) * z * (0.6 + 0.4 * env);
    ctx.globalAlpha = env * (0.35 + 0.45 * night);
    ctx.drawImage(gl, bx - r, by - r * 0.6, r * 2, r * 1.2);
    ctx.globalAlpha = env * (0.5 + 0.3 * night);
    const c = r * 0.3;
    ctx.drawImage(glowSprite(true), bx - c, by - c * 0.6, c * 2, c * 1.2);
  }
  ctx.globalCompositeOperation = "source-over";
  // steam boiling off where the slag meets the river (lingers a little after the pour)
  const steamAmt = Math.max(env, cool * 0.5);
  if (steamAmt > 0.05) {
    for (let k = 0; k < 6; k++) {
      const uu = time * 0.45 + k / 6 + hash(seed, k, 52);
      const cyc = Math.floor(uu), p = uu - cyc;
      const r = (3 + p * 11) * z * (0.8 + 0.4 * hash(seed + k, cyc, 53));
      const px = bx + (hash(seed + k, cyc, 54) - 0.5) * 10 * z + p * 8 * z;
      const py = by - p * 26 * z;
      const shade = Math.round(lerp(236, 120, night * 0.6) / 16) * 16 + 8;
      ctx.globalAlpha = Math.min(1, p * 8) * (1 - p) * (1 - p) * 0.7 * steamAmt;
      ctx.drawImage(puffSprite(shade - 6, shade, Math.min(255, shade + 8), (k + cyc) & 3, "puff"), px - r * 1.2, py - r, r * 2.4, r * 2);
    }
    ctx.globalAlpha = 1;
  }
}

/** turn "Benzene in the Mon" made the news (or was first seen), per game */
const benzeneSeen = new WeakMap<GameState, number>();
function benzeneTurn(g: GameState): number | null {
  if (!g.flags.benzene) return null;
  const have = benzeneSeen.get(g);
  if (have !== undefined) return have;
  const issue = g.news.find((n) => n.items.some((e) => e.name === "Benzene in the Mon"));
  const turn = issue ? issue.turn : g.turn;
  benzeneSeen.set(g, turn);
  return turn;
}
const BENZENE_SEASONS = 4;

/** Waste washing out of the works into the river, drifting downstream; slag poured over the bank. */
export function drawSpills(ctx: CanvasRenderingContext2D, g: GameState, cam: Camera, time: number, night: number) {
  const m = g.map, z = cam.zoom, year = g.world.year;
  const cw = ctx.canvas.width, ch = ctx.canvas.height;
  const S = (fx: number, fy: number, h: number): [number, number] => { const [wx, wy] = project(fx, fy, h); return [(wx - cam.x) * z, (wy - cam.y) * z]; };
  // ALCOSAN (1959) treats the towns' sewage and the works tie in: every outfall is smaller from then on
  const alcosan = year >= 1959 ? 0.55 : 1;
  const plants: { x: number; y: number; fp: number; ind: string; running: boolean; amount: number }[] = [];
  if (g.company) {
    const waste = g.company.biz.policy.waste;
    const pol = waste === "dump" ? 1.45 : waste === "abate" ? 0.45 : 1;
    for (const w of [g.company, ...g.company.others]) {
      const s = w.lastSeason, run = s && s.workersWanted > 0 ? Math.max(0.3, s.workersHired / s.workersWanted) : 0.7;
      plants.push({ x: w.x, y: w.y, fp: w.footprint, ind: w.industry, running: w.status === "running", amount: pol * alcosan * run });
    }
  }
  // rivals: their real industry, and only while they run (not before they open, on strike or after they close)
  for (const r of g.rivals) {
    const def = RIVALS.find((d) => d.id === r.id);
    if (r.owned || !def || def.id === "mellon") continue; // the Mellons are a bank: no outfall
    const run = rivalRunning(def, year);
    const running = r.active && !r.closed && (r.strikeUntil ?? 0) <= g.turn && run > 0 && !(def.opens !== undefined && year < def.opens);
    plants.push({ x: r.x, y: r.y, fp: r.footprint, ind: def.industry, running, amount: alcosan * clamp01(run / 0.85) });
  }
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.imageSmoothingEnabled = true;
  const onScreen = (sp: SpillPath, len: number) => {
    // cheap cull: the outfall or the plume's far end near the screen
    for (const k of [0, Math.min(sp.pts.length - 1, Math.round(len / 2)), Math.min(sp.pts.length - 1, len)]) {
      const p = sp.pts[k], [sx, sy] = S(p[0], p[1], p[2]);
      if (sx > -300 && sy > -200 && sx < cw + 300 && sy < ch + 200) return true;
    }
    return false;
  };
  for (const p of plants) {
    if (!p.running) continue;
    const sp = spillPath(m, p.x, p.y, p.fp);
    if (!sp) continue;
    const len = Math.round(Math.min(PATH_LEN - 4, 26 * Math.sqrt(p.amount)));
    if (!onScreen(sp, len)) continue;
    const col = SPILL_COL[p.ind] ?? SPILL_COL.metalworks;
    drawStain(ctx, S, z, m, sp, col, len, Math.min(1.3, 0.45 + 0.6 * p.amount), p.ind === "metalworks", p.x * 7 + p.y, time);
    // slag pours over the bank until "Slag Dumping Ends" (1972)
    if (p.ind === "steel" && year < 1972) drawSlag(ctx, S, z, sp, p.x * 13 + p.y, time, night);
  }
  // "Benzene in the Mon" (Winter 1984): a dark slick spreading downriver from Clairton for a few seasons
  const bt = benzeneTurn(g);
  if (bt !== null && g.turn - bt < BENZENE_SEASONS) {
    const r = g.rivals.find((rv) => rv.id === "clairton");
    const sp = r ? spillPath(m, r.x, r.y, r.footprint) : null;
    if (sp && onScreen(sp, PATH_LEN)) {
      const fade = 1 - (g.turn - bt) / BENZENE_SEASONS;
      drawStain(ctx, S, z, m, sp, SPILL_COL.benzene, Math.round(PATH_LEN * (0.6 + 0.4 * fade)), 1.2 * fade + 0.25, true, 1984, time * 0.8);
    }
  }
  ctx.restore();
}
