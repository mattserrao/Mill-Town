// Procedurally generated pixel art. Everything is drawn into small canvases once at startup.
// Style target: SimCity 2000-era 2:1 tiles, dithered grass, brown strata on cliffs.

import { tileNoise } from "../core/rng";
import { TW, TH, LEVEL_PX } from "./iso";

type RGB = [number, number, number];
export const SHADES = [1.16, 1.07, 1.0, 0.9, 0.8];
export const VARIANTS = 3;

const TERRAIN_PAL: Record<number, RGB[]> = {
  0: [[43, 93, 155], [48, 105, 168], [40, 86, 146], [70, 125, 190]],      // water
  1: [[127, 162, 74], [139, 176, 84], [111, 148, 64], [150, 170, 90]],   // floodplain
  2: [[109, 154, 62], [121, 166, 70], [95, 138, 54], [130, 160, 80]],    // flat
  3: [[95, 140, 56], [107, 152, 63], [85, 125, 49], [120, 110, 70]],     // slope
  4: [[107, 106, 58], [122, 107, 69], [90, 90, 50], [140, 130, 100]],    // steep
  5: [[134, 168, 85], [147, 179, 93], [122, 154, 75], [160, 175, 100]],  // upland
};

function canvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  return c;
}

/** pixel rows of the 2:1 diamond: [xStart, xEnd) for row r of a TW x TH tile */
export function diamondRow(r: number): [number, number] {
  const half = r < TH / 2 ? 2 * (r + 1) : 2 * (TH - r);
  return [TW / 2 - half, TW / 2 + half];
}

function put(d: ImageData, x: number, y: number, c: RGB, a = 255) {
  if (x < 0 || y < 0 || x >= d.width || y >= d.height) return;
  const i = (y * d.width + x) * 4;
  d.data[i] = c[0]; d.data[i + 1] = c[1]; d.data[i + 2] = c[2]; d.data[i + 3] = a;
}
const mul = (c: RGB, k: number): RGB => [Math.min(255, c[0] * k), Math.min(255, c[1] * k), Math.min(255, c[2] * k)];

function topTile(pal: RGB[], shade: number, seed: number, extra?: (x: number, y: number) => RGB | null): HTMLCanvasElement {
  const c = canvas(TW, TH);
  const ctx = c.getContext("2d")!;
  const d = ctx.createImageData(TW, TH);
  for (let y = 0; y < TH; y++) {
    const [a, b] = diamondRow(y);
    for (let x = a; x < b; x++) {
      const n = tileNoise(seed, x, y, 7);
      let col = n < 0.5 ? pal[0] : n < 0.78 ? pal[1] : n < 0.96 ? pal[2] : pal[3];
      const e = extra?.(x, y);
      if (e) col = e;
      // faint darker rim on the lower edges reads as SC2000's soft tile seams
      const rim = (y >= TH / 2 && (x === a || x === b - 1)) || y === TH - 1 ? 0.93 : 1;
      put(d, x, y, mul(col, shade * rim));
    }
  }
  ctx.putImageData(d, 0, 0);
  return c;
}

/** Make anti-aliased canvas drawing crisp: alpha snaps to 0/255. */
function crisp(c: HTMLCanvasElement) {
  const ctx = c.getContext("2d")!;
  const d = ctx.getImageData(0, 0, c.width, c.height);
  for (let i = 3; i < d.data.length; i += 4) d.data[i] = d.data[i] > 110 ? 255 : 0;
  ctx.putImageData(d, 0, 0);
  return c;
}

// ---------------------------------------------------------------- iso drawing helpers for buildings
const BW = TW, BH = 56;          // building canvas
const GY = BH - TH;              // y of the diamond's top vertex inside the building canvas
const P = (u: number, v: number): [number, number] => [TW / 2 + (u - v) * (TW / 2), GY + (u + v) * (TH / 2)];

function poly(ctx: CanvasRenderingContext2D, pts: [number, number][], fill: string) {
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (const p of pts.slice(1)) ctx.lineTo(p[0], p[1]);
  ctx.closePath();
  ctx.fill();
}

interface BoxStyle { top: string; left: string; right: string; roof?: "flat" | "hip" | "gable"; roofL?: string; roofR?: string; roofH?: number }

function box(ctx: CanvasRenderingContext2D, u0: number, v0: number, u1: number, v1: number, h: number, s: BoxStyle) {
  const up = (p: [number, number], k = h): [number, number] => [p[0], p[1] - k];
  const A = P(u0, v0), B = P(u1, v0), C = P(u1, v1), D = P(u0, v1);
  poly(ctx, [D, C, up(C), up(D)], s.left);
  poly(ctx, [C, B, up(B), up(C)], s.right);
  if (!s.roof || s.roof === "flat") { poly(ctx, [up(A), up(B), up(C), up(D)], s.top); return; }
  const rh = s.roofH ?? 4;
  if (s.roof === "hip") {
    const pk = P((u0 + u1) / 2, (v0 + v1) / 2);
    const peak: [number, number] = [pk[0], pk[1] - h - rh];
    poly(ctx, [up(A), up(B), peak], s.roofR ?? s.top);
    poly(ctx, [up(A), up(D), peak], s.roofL ?? s.top);
    poly(ctx, [up(D), up(C), peak], s.roofL ?? s.top);
    poly(ctx, [up(C), up(B), peak], s.roofR ?? s.top);
    return;
  }
  // gable: ridge runs along u
  const vm = (v0 + v1) / 2;
  const R0 = up(P(u0, vm), h + rh), R1 = up(P(u1, vm), h + rh);
  poly(ctx, [up(A), up(B), R1, R0], s.roofR ?? s.top);
  poly(ctx, [up(D), up(C), R1, R0], s.roofL ?? s.top);
  poly(ctx, [up(C), up(B), R1], s.right); // gable end
}

function tree(ctx: CanvasRenderingContext2D, u: number, v: number, size: number, seed: number) {
  const [x, y] = P(u, v);
  ctx.fillStyle = "#4a3a22";
  ctx.fillRect(Math.round(x), Math.round(y - 2), 1, 2);
  const conifer = tileNoise(seed, Math.round(u * 100), Math.round(v * 100), 3) < 0.4;
  const dark = conifer ? "#2f5a2a" : "#3d6b2c", mid = conifer ? "#3c6e33" : "#4f8236", lite = conifer ? "#4f8240" : "#6a9a44";
  if (conifer) {
    for (let k = 0; k < size + 3; k++) {
      const w = Math.max(1, Math.round((k / (size + 3)) * (size + 1)));
      ctx.fillStyle = k % 3 === 0 ? dark : mid;
      ctx.fillRect(Math.round(x - w / 2), Math.round(y - size - 5 + k), w, 1);
    }
  } else {
    const r = size / 2 + 1.5;
    ctx.fillStyle = dark; ctx.beginPath(); ctx.ellipse(x, y - r - 1, r + 0.5, r, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = mid; ctx.beginPath(); ctx.ellipse(x - 0.5, y - r - 1.5, r - 0.5, r - 1, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = lite; ctx.fillRect(Math.round(x - r / 2), Math.round(y - 2 * r), 2, 1);
  }
}

export type BuildingKind = "forest" | "cottage" | "houses" | "rowhouses" | "civic" | "farmhouse" |
  "works_shed" | "works_furnace" | "works_stack" | "rival_shed" | "rival_furnace" | "rival_stack";

const HOUSE_COLORS = [["#d8d0b8", "#b8ae94"], ["#c9b07a", "#a8915f"], ["#a9a9a0", "#8a8a82"], ["#b9846a", "#97684f"]];

function building(kind: BuildingKind, variant: number): HTMLCanvasElement {
  const c = canvas(BW, BH);
  const ctx = c.getContext("2d")!;
  const s = 1000 + variant * 17;
  const rnd = (k: number) => tileNoise(s, k, variant, 11);
  switch (kind) {
    case "forest": {
      const pts: [number, number][] = [];
      for (let k = 0; k < 7; k++) pts.push([0.15 + rnd(k) * 0.7, 0.15 + rnd(k + 20) * 0.7]);
      pts.sort((a, b) => a[0] + a[1] - (b[0] + b[1]));
      pts.forEach(([u, v], k) => tree(ctx, u, v, 3 + Math.round(rnd(k + 40) * 3), s + k));
      break;
    }
    case "cottage":
    case "farmhouse": {
      const n = kind === "farmhouse" ? 1 : 1 + (variant % 2);
      for (let k = 0; k < n; k++) {
        const u = 0.2 + rnd(k) * 0.4, v = 0.2 + rnd(k + 5) * 0.4;
        const [w, sh] = HOUSE_COLORS[(variant + k) % HOUSE_COLORS.length];
        box(ctx, u, v, u + 0.28, v + 0.22, 5, { top: w, left: w, right: sh, roof: "gable", roofL: "#6a4a3a", roofR: "#57392c", roofH: 3 });
      }
      if (kind === "farmhouse") box(ctx, 0.55, 0.15, 0.85, 0.45, 6, { top: "#8e3b2a", left: "#a3442f", right: "#7c3022", roof: "gable", roofL: "#5d5d5d", roofR: "#4a4a4a", roofH: 4 });
      break;
    }
    case "houses": {
      const spots = [[0.08, 0.1], [0.5, 0.1], [0.08, 0.52], [0.5, 0.52]];
      spots.forEach(([u, v], k) => {
        if (rnd(k) < 0.2) { tree(ctx, u + 0.2, v + 0.2, 3, s + k); return; }
        const [w, sh] = HOUSE_COLORS[(variant + k) % HOUSE_COLORS.length];
        box(ctx, u, v, u + 0.36, v + 0.3, 7, { top: w, left: w, right: sh, roof: "gable", roofL: "#5a4636", roofR: "#46362a", roofH: 4 });
      });
      break;
    }
    case "rowhouses": {
      const brick = variant % 2 ? ["#9c4b36", "#7d3a29"] : ["#a8573d", "#87432e"];
      for (const v of [0.08, 0.54]) {
        box(ctx, 0.06, v, 0.94, v + 0.36, 11, { top: "#4c4038", left: brick[0], right: brick[1], roof: "gable", roofL: "#4f4440", roofR: "#3d3431", roofH: 3 });
        // windows
        ctx.fillStyle = "#2a2622";
        for (let k = 0; k < 5; k++) {
          const [x, y] = P(0.12 + k * 0.17, v + 0.36);
          ctx.fillRect(Math.round(x), Math.round(y - 8), 1, 2);
          ctx.fillRect(Math.round(x), Math.round(y - 4), 1, 2);
        }
      }
      break;
    }
    case "civic": {
      box(ctx, 0.2, 0.25, 0.75, 0.75, 10, { top: "#cfc6ae", left: "#d9d0b8", right: "#b2a88f", roof: "gable", roofL: "#556070", roofR: "#434c59", roofH: 5 });
      box(ctx, 0.62, 0.62, 0.8, 0.8, 22, { top: "#cfc6ae", left: "#d9d0b8", right: "#b2a88f", roof: "hip", roofL: "#556070", roofR: "#434c59", roofH: 9 });
      break;
    }
    case "works_shed":
    case "rival_shed": {
      const pl = kind === "works_shed";
      const wall = pl ? ["#7e3b2c", "#612c20"] : ["#6b6152", "#544b3f"];
      box(ctx, 0.05, 0.1, 0.95, 0.9, 12, { top: "#3a3633", left: wall[0], right: wall[1], roof: "gable", roofL: pl ? "#3f3f46" : "#3f4a3a", roofR: pl ? "#2e2e34" : "#2f382b", roofH: 5 });
      break;
    }
    case "works_furnace":
    case "rival_furnace": {
      const pl = kind === "works_furnace";
      box(ctx, 0.1, 0.1, 0.9, 0.9, 6, { top: "#4a4440", left: pl ? "#7e3b2c" : "#6b6152", right: pl ? "#612c20" : "#544b3f" });
      box(ctx, 0.3, 0.3, 0.7, 0.7, 24, { top: "#2d2b2a", left: "#5a514c", right: "#433c38" });
      box(ctx, 0.22, 0.45, 0.32, 0.55, 18, { top: "#2d2b2a", left: "#6b625c", right: "#4e4743" });
      ctx.fillStyle = "#e0782a";
      const [x, y] = P(0.5, 0.7);
      ctx.fillRect(Math.round(x - 1), Math.round(y - 4), 2, 2);
      break;
    }
    case "works_stack":
    case "rival_stack": {
      box(ctx, 0.15, 0.15, 0.85, 0.85, 5, { top: "#3f3a36", left: "#5f5650", right: "#4a433e" });
      box(ctx, 0.42, 0.42, 0.58, 0.58, 38, { top: "#1e1c1b", left: kind === "works_stack" ? "#8a4433" : "#6e665c", right: kind === "works_stack" ? "#6b3326" : "#575048" });
      break;
    }
  }
  return crisp(c);
}

/** Farm field: furrows run along one axis, alternating crop colours. */
function farmTile(shade: number, variant: number): HTMLCanvasElement {
  const crops: RGB[][] = [
    [[176, 156, 84], [160, 140, 74]],
    [[120, 160, 70], [104, 140, 60]],
    [[146, 118, 78], [128, 102, 66]],
  ];
  const [a, b] = crops[variant % crops.length];
  return topTile(TERRAIN_PAL[2], shade, 500 + variant, (x, y) => {
    const along = variant % 2 ? x / 2 + y : x / 2 - y + 16;
    return Math.floor(along / 2) % 2 ? a : b;
  });
}

/** Road overlay for a 4-neighbour mask: 1 = x-1, 2 = x+1, 4 = y-1, 8 = y+1. */
function roadTile(mask: number, bridge: boolean): HTMLCanvasElement {
  const c = canvas(TW, TH);
  const ctx = c.getContext("2d")!;
  const ends: Record<number, [number, number]> = { 1: [8, 4], 2: [24, 12], 4: [24, 4], 8: [8, 12] };
  const col = bridge ? "#6f6a63" : "#8d7b5c", edge = bridge ? "#3e3a36" : "#6d5d43";
  const stamp = (x: number, y: number, w: number, color: string) => {
    for (let r = -1; r <= 1; r++) {
      const ww = r === 0 ? w : w - 2;
      ctx.fillStyle = color;
      ctx.fillRect(Math.round(x - ww / 2), Math.round(y + r), ww, 1);
    }
  };
  const dirs = [1, 2, 4, 8].filter((b) => mask & b);
  for (const pass of [0, 1]) {
    stamp(16, 8, pass ? 6 : 8, pass ? col : edge);
    for (const b of dirs) {
      const [ex, ey] = ends[b];
      for (let t = 0; t <= 1.0001; t += 0.1) stamp(16 + (ex - 16) * t, 8 + (ey - 8) * t, pass ? 6 : 8, pass ? col : edge);
    }
  }
  // clip to diamond
  const d = ctx.getImageData(0, 0, TW, TH);
  for (let y = 0; y < TH; y++) {
    const [a, b] = diamondRow(y);
    for (let x = 0; x < TW; x++) if (x < a || x >= b) d.data[(y * TW + x) * 4 + 3] = 0;
  }
  ctx.putImageData(d, 0, 0);
  return c;
}

/** Cliff face below a tile's left (SW) or right (SE) edge, `h` levels tall. */
function faceSprite(side: "left" | "right", hLevels: number, kind: "earth" | "water"): HTMLCanvasElement {
  const hp = hLevels * LEVEL_PX;
  const c = canvas(TW, TH + hp);
  const ctx = c.getContext("2d")!;
  const d = ctx.createImageData(TW, TH + hp);
  const base: RGB = kind === "water" ? [30, 66, 116] : side === "left" ? [150, 112, 70] : [114, 82, 52];
  for (let col = side === "left" ? 0 : TW / 2; col < (side === "left" ? TW / 2 : TW); col++) {
    const edge = side === "left" ? TH / 2 + Math.floor(col / 2) : Math.floor((TW + TH - 1 - col) / 2);
    for (let k = 1; k <= hp; k++) {
      const y = edge + k;
      let cc = base;
      if (kind === "earth") {
        if (k === 1) cc = side === "left" ? [96, 124, 58] : [76, 100, 46]; // sod
        else if ((k + Math.floor(col / 8)) % LEVEL_PX === 0) cc = mul(base, 0.82); // strata
        else if (tileNoise(91, col, k, side === "left" ? 1 : 2) < 0.12) cc = mul(base, 1.12);
      }
      put(d, col, y, cc);
    }
  }
  ctx.putImageData(d, 0, 0);
  return c;
}

export interface Sprites {
  top: HTMLCanvasElement[][][]; // [terrain][shade][variant]
  farm: HTMLCanvasElement[][];  // [shade][variant]
  road: HTMLCanvasElement[];    // [mask]
  bridge: HTMLCanvasElement[];  // [mask]
  building: Record<BuildingKind, HTMLCanvasElement[]>;
  face(side: "left" | "right", hLevels: number, kind: "earth" | "water"): HTMLCanvasElement;
  buildingAnchorY: number;      // building canvas y of the tile's top vertex
}

export function buildSprites(): Sprites {
  const top: HTMLCanvasElement[][][] = [];
  for (let t = 0; t <= 5; t++) {
    top[t] = SHADES.map((sh, si) => Array.from({ length: VARIANTS }, (_, v) =>
      topTile(TERRAIN_PAL[t], t === 0 ? 1 : sh, t * 100 + v * 7 + si)));
  }
  const farm = SHADES.map((sh) => Array.from({ length: VARIANTS }, (_, v) => farmTile(sh, v)));
  const road = Array.from({ length: 16 }, (_, m) => roadTile(m, false));
  const bridge = Array.from({ length: 16 }, (_, m) => roadTile(m, true));
  const kinds: BuildingKind[] = ["forest", "cottage", "houses", "rowhouses", "civic", "farmhouse",
    "works_shed", "works_furnace", "works_stack", "rival_shed", "rival_furnace", "rival_stack"];
  const b = {} as Record<BuildingKind, HTMLCanvasElement[]>;
  for (const k of kinds) b[k] = Array.from({ length: 4 }, (_, v) => building(k, v));
  const faces = new Map<string, HTMLCanvasElement>();
  return {
    top, farm, road, bridge, building: b, buildingAnchorY: GY,
    face(side, h, kind) {
      const key = `${side}${h}${kind}`;
      let f = faces.get(key);
      if (!f) { f = faceSprite(side, h, kind); faces.set(key, f); }
      return f;
    },
  };
}
