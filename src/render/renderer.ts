// Smooth-terrain isometric renderer.
// The map is cut into 16x16-tile chunks. Each chunk is software-rasterized once per zoom level:
// every tile is two lit, textured triangles over its four real corner heights (no steps between
// tiles), followed by its sprites, all painted back-to-front into one pixel buffer.
// Chunks are cached (LRU) and re-rendered progressively when the world changes.

import { lineIndex, segDist, type Seg } from "../core/lines";
import { techsForYear, type GameState } from "../core/game";
import { INDUSTRIES, type IndustryId } from "../core/industries";
import { type GameMap, Special } from "../core/map";
import { RIVALS } from "../core/rivals";
import { Terrain } from "../core/terrain";
import { CivicSub, HouseSub, STRUCTURES, Street, Use } from "../core/town";
import { ANCHORS } from "../core/ancestry";
import { latLonToTile } from "../core/features";
import { buildHouse, houseKey, styleForYear, type HouseKind } from "./houses";
import { type Camera, BASE_M, HH, HW, project, tileCorners, ZPX } from "./iso";
import { buildPlant, type Emitter, emittersFor, layoutPlant, type PlantCtx, plantKey, type PlantTile } from "./plants";
import { buildSprites, scaleSprite, type Sprite, type SpriteBuf } from "./sprites";

interface PlantRef { t: PlantTile; c: PlantCtx; years: number }
interface LiveEmitter extends Emitter { wx: number; wy: number; seed: number; running: boolean }

export type OverlayFn = ((i: number) => [number, number, number, number] | null) | null;

export interface ViewOptions {
  overlay: OverlayFn;
  overlayKey: string;
  grid: boolean;
}

export interface Marks {
  hover: { x: number; y: number } | null;
  selected: { x: number; y: number } | null;
  footprint: { x: number; y: number; size: number; ok: boolean } | null;
  labels: boolean;
}

const CS = 16;              // chunk size in tiles
const PAD_TOP = 330;        // room for tall sprites (stacks, smoke, spires), zoom-1 px
const PAD_X = 48;
const BUDGET_PX = 48e6;     // cached chunk pixels
const FRAME_MS = 28;        // raster budget per frame

interface Chunk { canvas: HTMLCanvasElement; ox: number; oy: number; key: string; px: number }

// ---------------------------------------------------------------- colour helpers
const rgb = (r: number, g: number, b: number) => (r << 16) | (g << 8) | b;
function hash(x: number, y: number, c = 0): number {
  let h = (x * 374761393) ^ (y * 668265263) ^ (c * 2147483647);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
const pick = (pal: number[], n: number) => pal[Math.min(pal.length - 1, Math.floor(n * pal.length))];
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((b) => (b + 0.5) / 16 - 0.5);

const PAL = {
  grass: [0x6f9a3e, 0x7aa646, 0x668f39, 0x80aa4a, 0x729e40],
  meadow: [0x86a84e, 0x93b45a, 0x7c9e48, 0x8eae52],
  woods: [0x3c5a2a, 0x46622e, 0x52583a, 0x40602c, 0x5a6236],
  lot: [0x7a9a48, 0x86905a, 0x6e9040, 0x8a8a58],
  town: [0x7a6650, 0x6e5c48, 0x856e56, 0x76604c],
  yard: [0x3a3634, 0x46403c, 0x302c2a, 0x54402e, 0x403a36],
  rock: [0x8a7a62, 0x9a8a70, 0x7a6a56, 0x86806c, 0x6e6658],
  paved: [0xb8b0a0, 0xaca492, 0xc0b8a8],
  sand: [0xa08e66, 0x948258, 0xaa9a72],
  wet: [0x6a5e46, 0x5e523e],
  crops: [
    [0xc8aa5a, 0xb89a4c, 0xd4b866], // wheat
    [0x5e8a38, 0x4c7430, 0x6a9640], // corn
    [0x7a5a3a, 0x664a30, 0x86664a], // plowed
    [0x9cb45a, 0x8aa24e, 0xaabe66], // hay
    [0x78a448, 0x6c9840, 0x84ac50], // pasture
  ],
};
const WATER = [0x33668e, 0x366b94, 0x306188, 0x386e96];

// 8 neighbour directions (dx, dy)
const N8: [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];

export class Renderer {
  private base: Map<string, Sprite>;
  private scaled = new Map<string, SpriteBuf>();
  private chunks = new Map<string, Chunk>();
  private chunkHeights: Float32Array; // min,max per chunk
  private ncx: number;
  private ncy: number;
  private bridgeAxis = new Map<number, "a" | "b">();
  private rivalIndustry = new Map<number, IndustryId>();
  private plants = new Map<number, PlantRef>();
  private emitters: LiveEmitter[] = [];
  private plantsKey = "";
  private generated = 0;
  pending = 0;

  constructor(private map: GameMap) {
    this.base = buildSprites();
    this.ncx = Math.ceil(map.width / CS);
    this.ncy = Math.ceil(map.height / CS);
    this.chunkHeights = new Float32Array(this.ncx * this.ncy * 2);
    this.updateHeights();
    // bridge orientation from the extent of each bridge's tiles
    const ext = new Map<number, number[]>();
    for (let i = 0; i < map.bridge.length; i++) {
      const b = map.bridge[i];
      if (!b) continue;
      const x = i % map.width, y = (i / map.width) | 0;
      const e = ext.get(b) ?? [x, x, y, y];
      e[0] = Math.min(e[0], x); e[1] = Math.max(e[1], x); e[2] = Math.min(e[2], y); e[3] = Math.max(e[3], y);
      ext.set(b, e);
    }
    for (const [b, e] of ext) this.bridgeAxis.set(b, e[1] - e[0] >= e[3] - e[2] ? "a" : "b");
  }

  /** call after terrain heights change (grading) */
  updateHeights() {
    const m = this.map, V = m.width + 1;
    for (let cy = 0; cy < this.ncy; cy++) for (let cx = 0; cx < this.ncx; cx++) {
      let lo = Infinity, hi = -Infinity;
      for (let y = cy * CS; y <= Math.min(m.height, cy * CS + CS); y++) for (let x = cx * CS; x <= Math.min(m.width, cx * CS + CS); x++) {
        const h = m.vert[y * V + x];
        if (h < lo) lo = h;
        if (h > hi) hi = h;
      }
      const k = (cy * this.ncx + cx) * 2;
      this.chunkHeights[k] = lo;
      this.chunkHeights[k + 1] = hi;
    }
  }

  worldBounds() {
    const m = this.map;
    return {
      left: -m.height * HW - 100,
      right: m.width * HW + 100,
      top: -(m.maxHeight - BASE_M) * ZPX - PAD_TOP,
      bottom: (m.width + m.height) * HH + 200,
    };
  }

  private sprite(key: string, s: number): SpriteBuf | null {
    const k = `${key}@${s}`;
    let b = this.scaled.get(k);
    if (!b) {
      let sp = this.base.get(key);
      if (!sp && (key.startsWith("H|") || key.startsWith("P|"))) {
        if (this.generated > 2500) this.dropGenerated();
        sp = key.startsWith("H|") ? buildHouse(key) : buildPlant(key);
        this.base.set(key, sp);
        this.generated++;
      }
      if (!sp) return null;
      b = scaleSprite(sp, s);
      this.scaled.set(k, b);
    }
    return b;
  }

  private dropGenerated() {
    for (const k of [...this.base.keys()]) if (k.startsWith("H|") || k.startsWith("P|")) this.base.delete(k);
    for (const k of [...this.scaled.keys()]) if (k.startsWith("H|") || k.startsWith("P|")) this.scaled.delete(k);
    this.generated = 0;
  }

  /** Resolve every plant's layout (player + rivals) for this world state. */
  private updatePlants(g: GameState) {
    const c = g.company;
    // only what the plant drawings depend on: layout, status, how full the yards are, and the year (soot, rival tech)
    const fillOf = (co: NonNullable<typeof c>) => Math.min(2, Math.round(((co.lastSeason?.produced ?? 0) / INDUSTRIES[co.industry].baseCapacity) * 2));
    const key = `${c ? `${c.x},${c.y},${c.industry}` : ""}|${c?.status}|${c?.techs.join(",")}|${c ? fillOf(c) : 0}|${g.rivals.length}|${g.world.year}`;
    if (key === this.plantsKey) return;
    this.plantsKey = key;
    this.plants.clear();
    this.emitters = [];
    const m = this.map;
    const add = (x0: number, y0: number, fp: number, ctx: PlantCtx, running: boolean, years: number) => {
      const lay = layoutPlant(ctx);
      for (let ly = 0; ly < fp; ly++) for (let lx = 0; lx < fp; lx++) {
        const t = lay[ly * fp + lx];
        const x = x0 + lx, y = y0 + ly;
        if (x >= m.width || y >= m.height) continue;
        this.plants.set(y * m.width + x, { t, c: ctx, years });
        for (const e of emittersFor(t.part)) {
          const h = m.elevation[y * m.width + x];
          const [wx, wy] = project(x + e.u, y + e.v, h);
          this.emitters.push({ ...e, wx, wy: wy - e.z, seed: (x * 31 + y * 17) % 997, running });
        }
      }
    };
    if (c) {
      const capacity = INDUSTRIES[c.industry].baseCapacity;
      const fill = Math.min(2, Math.round(((c.lastSeason?.produced ?? 0) / capacity) * 2));
      add(c.x, c.y, c.footprint, { ind: c.industry, techs: c.techs, fp: c.footprint, side: c.riverSide, owner: "p", status: c.status, fill },
        c.status === "running" || c.status === "flooded", c.seasonsOperating / 4);
    }
    for (const r of g.rivals) {
      const def = RIVALS.find((d) => d.id === r.id);
      if (!def) continue;
      this.rivalIndustry.set(r.ownerId, def.industry);
      // Homestead, 1892: the lockout at the Frick/Carnegie works
      const status = g.world.year === 1892 && (r.id === "frick" || r.id === "carnegie") ? "strike" : g.world.year >= 1983 && def.industry === "steel" ? "idle" : "running";
      add(r.x, r.y, r.footprint, { ind: def.industry, techs: techsForYear(def.industry, g.world.year), fp: r.footprint, side: r.riverSide, owner: r.id, status, fill: status === "running" ? 1 : 0 },
        status === "running", g.world.year - def.entryYear);
    }
  }

  // ------------------------------------------------------------ frame
  /** Draw the view. Returns true if more chunks still need rendering (call again next frame). */
  draw(ctx: CanvasRenderingContext2D, cam: Camera, g: GameState, view: ViewOptions, marks: Marks): boolean {
    const cw = ctx.canvas.width, ch = ctx.canvas.height;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = "#1b1d22";
    ctx.fillRect(0, 0, cw, ch);
    ctx.imageSmoothingEnabled = false;
    this.updatePlants(g);

    const s = Math.min(1, cam.zoom);
    const k = cam.zoom / s; // extra pixel scaling for zoom > 1
    const tail = `|${view.overlayKey}|${view.grid}`;
    const vis: { cx: number; cy: number; d: number }[] = [];
    const vx0 = cam.x, vy0 = cam.y, vx1 = cam.x + cw / cam.zoom, vy1 = cam.y + ch / cam.zoom;
    const midx = (vx0 + vx1) / 2, midy = (vy0 + vy1) / 2;
    for (let cy = 0; cy < this.ncy; cy++) for (let cx = 0; cx < this.ncx; cx++) {
      const x0 = cx * CS, y0 = cy * CS;
      const left = (x0 - (y0 + CS)) * HW - PAD_X, right = (x0 + CS - y0) * HW + PAD_X;
      if (right < vx0 || left > vx1) continue;
      const hk = (cy * this.ncx + cx) * 2;
      const top = (x0 + y0) * HH - (this.chunkHeights[hk + 1] - BASE_M) * ZPX - PAD_TOP;
      const bottom = (x0 + y0 + 2 * CS) * HH - (this.chunkHeights[hk] - BASE_M) * ZPX + 400;
      if (bottom < vy0 || top > vy1) continue;
      const ccx = (x0 - y0) * HW, ccy = (x0 + y0 + CS) * HH;
      vis.push({ cx, cy, d: Math.hypot(ccx - midx, ccy - midy) });
    }

    // render missing / stale chunks, nearest first, within the frame budget
    const t0 = performance.now();
    let missing = 0;
    for (const c of [...vis].sort((a, b) => a.d - b.d)) {
      const key = `${s}:${c.cx},${c.cy}`;
      const have = this.chunks.get(key);
      // each chunk re-renders only when what it shows has changed (dirty-chunk tracking by content signature)
      const version = this.chunkSig(g, c.cx, c.cy) + tail;
      if (have && have.key === version) continue;
      if (performance.now() - t0 > FRAME_MS && have) { missing++; continue; }
      if (performance.now() - t0 > FRAME_MS * 2) { missing++; continue; }
      const ch2 = this.renderChunk(g, c.cx, c.cy, s, view, version);
      this.chunks.delete(key);
      this.chunks.set(key, ch2);
    }
    this.evict();

    vis.sort((a, b) => (a.cx + a.cy) - (b.cx + b.cy) || a.cx - b.cx);
    for (const c of vis) {
      const key = `${s}:${c.cx},${c.cy}`;
      const chn = this.chunks.get(key);
      if (!chn) continue;
      this.chunks.delete(key);
      this.chunks.set(key, chn); // LRU touch
      const dx = Math.round(chn.ox * k - cam.x * cam.zoom), dy = Math.round(chn.oy * k - cam.y * cam.zoom);
      if (k === 1) ctx.drawImage(chn.canvas, dx, dy);
      else ctx.drawImage(chn.canvas, dx, dy, chn.canvas.width * k, chn.canvas.height * k);
    }

    this.drawMarks(ctx, cam, marks);
    this.pending = missing;
    return missing > 0;
  }

  invalidateAll() {
    this.chunks.clear();
    this.sigs.clear();
  }

  private sigs = new Map<number, { stamp: string; sig: string }>();

  /**
   * A signature of everything a chunk's pixels depend on: the tiles in it and one tile around it
   * (streets and rows look at their neighbours), quantized the way the renderer quantizes them.
   * Cached per world version, so it's computed once per chunk per turn.
   */
  private chunkSig(g: GameState, cx: number, cy: number): string {
    const w = g.world, m = this.map, W = m.width;
    const stamp = `${w.version}|${this.plantsKey}`;
    const id = cy * this.ncx + cx;
    const hit = this.sigs.get(id);
    if (hit && hit.stamp === stamp) return hit.sig;
    let h1 = 0x811c9dc5 | 0, h2 = 0x1b873593 | 0, plant = false, rails = 0;
    const lix = lineIndex(m);
    const mix = (v: number) => { h1 = Math.imul(h1 ^ v, 0x01000193); h2 = Math.imul(h2 ^ v, 0x5bd1e995) ^ (h2 >>> 15); };
    const x0 = Math.max(0, cx * CS - 1), y0 = Math.max(0, cy * CS - 1);
    const x1 = Math.min(W - 1, cx * CS + CS), y1 = Math.min(m.height - 1, cy * CS + CS);
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const i = y * W + x;
      const p = w.pollution[i];
      mix(w.use[i] | (w.sub[i] << 5) | (w.street[i] << 10) | ((w.pop[i] > 0 ? 1 : 0) << 14) | (w.structure[i] << 15) | (w.eth[i] << 24));
      if (((x | y) & 7) === 0) mix(w.kit[(y >> 3) * Math.ceil(W / 8) + (x >> 3)] + 7919);
      mix(w.built[i] | ((p < 0.15 ? 0 : p < 0.4 ? 1 : p < 0.5 ? 2 : p < 1.2 ? 3 : 4) << 12) | (Math.min(8, Math.floor(p * 6)) << 16) | (w.owner[i] << 20));
      if (this.plants.has(i)) plant = true;
      if (m.rail[i] && (m.railLines[String(m.rail[i])]?.year ?? 9999) <= w.year) rails++;
      const vs = lix.get(i);
      if (vs) for (const sg of vs) if (sg.kind === "rail" && (m.railLines[String(sg.line)]?.year ?? 9999) <= w.year) rails += 64;
    }
    // year-gated looks: gas → electric lamps and timber → concrete steps in 1910
    const sig = `${(h1 >>> 0).toString(36)}${(h2 >>> 0).toString(36)}|${rails}|${w.year >= 1910 ? 1 : 0}|${plant ? this.plantsKey : ""}`;
    this.sigs.set(id, { stamp, sig });
    return sig;
  }

  private evict() {
    let total = 0;
    for (const c of this.chunks.values()) total += c.px;
    for (const [k, c] of this.chunks) {
      if (total <= BUDGET_PX) break;
      this.chunks.delete(k);
      total -= c.px;
    }
  }

  // ------------------------------------------------------------ chunk rasterization
  private renderChunk(g: GameState, cx: number, cy: number, s: number, view: ViewOptions, version: string): Chunk {
    const m = this.map, w = g.world, W = m.width, H = m.height, V = W + 1;
    const x0 = cx * CS, y0 = cy * CS, x1 = Math.min(W, x0 + CS), y1 = Math.min(H, y0 + CS);
    const hk = (cy * this.ncx + cx) * 2;
    const lo = this.chunkHeights[hk], hi = this.chunkHeights[hk + 1];
    const edge = x1 === W || y1 === H;
    const skirtBottom = m.minHeight - 14;
    const ox = Math.floor(((x0 - y1) * HW - PAD_X) * s);
    const oy = Math.floor(((x0 + y0) * HH - (hi - BASE_M) * ZPX - PAD_TOP) * s);
    const ex = Math.ceil(((x1 - y0) * HW + PAD_X) * s);
    const ey = Math.ceil(((x1 + y1) * HH - ((edge ? skirtBottom : lo) - BASE_M) * ZPX + 12) * s);
    const cw = Math.max(1, ex - ox), ch = Math.max(1, ey - oy);
    const buf = new Uint32Array(cw * ch);
    const year = w.year;
    const pxu = 1 / (HW * s * 1.2); // ~ uv units per pixel

    const P = (fx: number, fy: number, h: number): [number, number] => {
      const [sx, sy] = project(fx, fy, h);
      return [sx * s - ox, sy * s - oy];
    };
    const railActive = (i: number) => m.rail[i] > 0 && (m.railLines[String(m.rail[i])]?.year ?? 9999) <= year;

    // --- triangle rasterizer: flat light, per-pixel texture
    const tri = (
      ax: number, ay: number, bx: number, by: number, qx: number, qy: number,
      au: number, av: number, ah: number, bu: number, bv: number, bh: number, qu: number, qv: number, qh: number,
      light: number, tex: (u: number, v: number, h: number, gx: number, gy: number) => number, tint: number, tintA: number,
    ) => {
      const minX = Math.max(0, Math.floor(Math.min(ax, bx, qx))), maxX = Math.min(cw - 1, Math.ceil(Math.max(ax, bx, qx)));
      const minY = Math.max(0, Math.floor(Math.min(ay, by, qy))), maxY = Math.min(ch - 1, Math.ceil(Math.max(ay, by, qy)));
      const area = (bx - ax) * (qy - ay) - (by - ay) * (qx - ax);
      if (Math.abs(area) < 1e-9) return;
      const inv = 1 / area;
      const tr = (tint >> 16) & 255, tg = (tint >> 8) & 255, tb = tint & 255;
      for (let py = minY; py <= maxY; py++) {
        const yy = py + 0.5;
        for (let px = minX; px <= maxX; px++) {
          const xx = px + 0.5;
          const w0 = ((bx - xx) * (qy - yy) - (by - yy) * (qx - xx)) * inv;
          const w1 = ((qx - xx) * (ay - yy) - (qy - yy) * (ax - xx)) * inv;
          const w2 = 1 - w0 - w1;
          if (w0 < -1e-4 || w1 < -1e-4 || w2 < -1e-4) continue;
          const u = w0 * au + w1 * bu + w2 * qu, v = w0 * av + w1 * bv + w2 * qv, h = w0 * ah + w1 * bh + w2 * qh;
          const c = tex(u, v, h, px + ox, py + oy);
          let k = light + BAYER[((py & 3) << 2) | (px & 3)] * 0.07;
          k = Math.round(k * 14) / 14;
          let r = ((c >> 16) & 255) * k, gg = ((c >> 8) & 255) * k, b = (c & 255) * k;
          if (tintA > 0) { r += (tr - r) * tintA; gg += (tg - gg) * tintA; b += (tb - b) * tintA; }
          buf[py * cw + px] = 0xff000000 | (Math.min(255, b) << 16) | (Math.min(255, gg) << 8) | Math.min(255, r);
        }
      }
    };

    const blit = (key: string, fx: number, fy: number, hOff = 0) => {
      const sb = this.sprite(key, s);
      if (!sb) return;
      const tx = Math.min(W - 1, Math.floor(fx)), ty = Math.min(H - 1, Math.floor(fy));
      const u = fx - tx, v = fy - ty;
      const a = m.vert[ty * V + tx], b = m.vert[ty * V + tx + 1], c = m.vert[(ty + 1) * V + tx], d = m.vert[(ty + 1) * V + tx + 1];
      const h = (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v + hOff;
      const [sx, sy] = P(fx, fy, h);
      const dx = Math.round(sx - sb.ax), dy = Math.round(sy - sb.ay);
      for (let yy = 0; yy < sb.h; yy++) {
        const by_ = dy + yy;
        if (by_ < 0 || by_ >= ch) continue;
        const row = yy * sb.w, drow = by_ * cw;
        for (let xx = 0; xx < sb.w; xx++) {
          const bx_ = dx + xx;
          if (bx_ < 0 || bx_ >= cw) continue;
          const p = sb.px[row + xx];
          const al = p >>> 24;
          if (!al) continue;
          if (al === 255 || !sb.soft) { buf[drow + bx_] = p | 0xff000000; continue; }
          const q = buf[drow + bx_], f = al / 255;
          const r = (q & 255) + ((p & 255) - (q & 255)) * f;
          const gg = ((q >> 8) & 255) + (((p >> 8) & 255) - ((q >> 8) & 255)) * f;
          const bb = ((q >> 16) & 255) + (((p >> 16) & 255) - ((q >> 16) & 255)) * f;
          buf[drow + bx_] = 0xff000000 | (bb << 16) | (gg << 8) | r;
        }
      }
    };

    // light: from screen-left and above (faces toward -x and +y are lit)
    const L = [-0.6, 0.6, 1.0];
    const LN = Math.hypot(L[0], L[1], L[2]);
    const lightOf = (nx: number, ny: number, nz: number) => {
      const d = (nx * L[0] + ny * L[1] + nz * L[2]) / (Math.hypot(nx, ny, nz) * LN);
      return 0.42 + 0.78 * Math.max(0, d);
    };
    const MPT = m.metersPerTile;

    const tilesD = (x1 - x0) + (y1 - y0) - 1;
    for (let d = 0; d < tilesD; d++) {
      for (let tx = Math.max(x0, x0 + d - (y1 - y0 - 1)); tx <= Math.min(x1 - 1, x0 + d); tx++) {
        const ty = y0 + d - (tx - x0);
        const i = ty * W + tx;
        const hT = m.vert[ty * V + tx], hR = m.vert[ty * V + tx + 1], hL = m.vert[(ty + 1) * V + tx], hB = m.vert[(ty + 1) * V + tx + 1];
        const [Tx, Ty] = P(tx, ty, hT), [Rx, Ry] = P(tx + 1, ty, hR), [Lx, Ly] = P(tx, ty + 1, hL), [Bx, By] = P(tx + 1, ty + 1, hB);
        const tex = this.groundShader(g, tx, ty, i, pxu, view.grid, railActive);
        let tint = 0, tintA = 0;
        const pol = w.pollution[i];
        if (pol > 0.02 && m.terrain[i] !== Terrain.Water) { tint = 0x2e2824; tintA = Math.min(0.55, pol * 0.35); }
        if (view.overlay) {
          const o = view.overlay(i);
          // wash the ground out to a neutral grey so the data colours stand apart from grass and brick
          if (o) { tint = rgb(o[0], o[1], o[2]); tintA = o[3]; }
          else if (m.terrain[i] === Terrain.Water) { tint = 0x40566e; tintA = 0.45; }
          else { tint = 0x8c8a86; tintA = 0.62; }
        }
        const isWater = m.terrain[i] === Terrain.Water;
        const l1 = isWater ? 1 : lightOf(-MPT * (hR - hT), -MPT * (hL - hT), MPT * MPT);
        const l2 = isWater ? 1 : lightOf(MPT * (hL - hB), MPT * (hR - hB), MPT * MPT);
        tri(Tx, Ty, Rx, Ry, Lx, Ly, 0, 0, hT, 1, 0, hR, 0, 1, hL, l1, tex, tint, tintA);
        tri(Lx, Ly, Rx, Ry, Bx, By, 0, 1, hL, 1, 0, hR, 1, 1, hB, l2, tex, tint, tintA);

        // map-edge skirt (diorama base)
        if (ty === H - 1 || tx === W - 1) {
          const sk = (ax: number, ay: number, bx: number, by: number, ha: number, hb: number, lit: number) => {
            const [a2x, a2y] = [ax, ay + (ha - skirtBottom) * ZPX * s], [b2x, b2y] = [bx, by + (hb - skirtBottom) * ZPX * s];
            const st = (_u: number, _v: number, hh: number, gx: number, gy: number) => {
              if (isWater && hh > ha - 4) return 0x24486a;
              const band = Math.floor(hh / 3) & 3;
              return [0x8a6a48, 0x7a5c3e, 0x94744e, 0x6e523a][band] + (hash(gx, gy, 9) < 0.1 ? 0x080808 : 0);
            };
            tri(ax, ay, bx, by, b2x, b2y, 0, 0, ha, 1, 0, hb, 1, 1, skirtBottom, lit, st, 0, 0);
            tri(ax, ay, b2x, b2y, a2x, a2y, 0, 0, ha, 1, 1, skirtBottom, 0, 1, skirtBottom, lit, st, 0, 0);
          };
          if (ty === H - 1) sk(Lx, Ly, Bx, By, hL, hB, 0.95);
          if (tx === W - 1) sk(Bx, By, Rx, Ry, hB, hR, 0.68);
        }

        // with a data overlay on, show the ground (SimCity-style data map): only bridges stay
        for (const sp of this.tileSprites(g, tx, ty, i)) if (!view.overlay || sp.key.startsWith("bridge:")) blit(sp.key, tx + sp.u, ty + sp.v, sp.h ?? 0);
      }
    }

    const canvas = document.createElement("canvas");
    canvas.width = cw; canvas.height = ch;
    const c2 = canvas.getContext("2d")!;
    c2.putImageData(new ImageData(new Uint8ClampedArray(buf.buffer), cw, ch), 0, 0);
    return { canvas, ox, oy, key: version, px: cw * ch };
  }

  // ------------------------------------------------------------ ground textures
  private groundShader(g: GameState, x: number, y: number, i: number, pxu: number, grid: boolean, railActive: (i: number) => boolean) {
    const m = this.map, w = g.world, W = m.width, H = m.height;
    const t = m.terrain[i];
    const use = w.use[i];
    const at = (dx: number, dy: number) => {
      const nx = x + dx, ny = y + dy;
      return nx >= 0 && ny >= 0 && nx < W && ny < H ? ny * W + nx : -1;
    };
    // neighbour masks for linear features
    const mask = (f: (j: number) => boolean) => {
      let mk = 0;
      N8.forEach(([dx, dy], k) => { const j = at(dx, dy); if (j >= 0 && f(j)) mk |= 1 << k; });
      // drop diagonals already implied by orthogonal neighbours
      for (let k = 4; k < 8; k++) {
        const [dx, dy] = N8[k];
        const ox = N8.findIndex(([a, b]) => a === dx && b === 0), oy = N8.findIndex(([a, b]) => a === 0 && b === dy);
        if (mk & (1 << ox) || mk & (1 << oy)) mk &= ~(1 << k);
      }
      return mk;
    };
    const lineDist = (mk: number, u: number, v: number) => {
      // a plain 90° turn is drawn as a chamfer from edge-midpoint to edge-midpoint, so tile-by-tile
      // staircases (creeks, rails, streets running on the diagonal) read as straight 45° lines
      const L = lCorner(mk, true);
      if (L) {
        const [a, b] = orient(L, u, v);
        // segment (1, .5) → (.5, 1) in oriented coords
        let tt = ((a - 1) * -0.5 + (b - 0.5) * 0.5) / 0.5;
        tt = Math.max(0, Math.min(1, tt));
        return [Math.hypot(a - (1 - 0.5 * tt), b - (0.5 + 0.5 * tt)), tt * Math.SQRT1_2];
      }
      let best = Math.hypot(u - 0.5, v - 0.5);
      let along = 0;
      for (let k = 0; k < 8; k++) {
        if (!(mk & (1 << k))) continue;
        const [dx, dy] = N8[k];
        const ex = dx * 0.5, ey = dy * 0.5;
        const len2 = ex * ex + ey * ey;
        let tt = ((u - 0.5) * ex + (v - 0.5) * ey) / len2;
        tt = Math.max(0, Math.min(1, tt));
        const d = Math.hypot(u - 0.5 - ex * tt, v - 0.5 - ey * tt);
        if (d < best) { best = d; along = tt * Math.sqrt(len2); }
      }
      return [best, along];
    };

    /**
     * If the only orthogonal neighbours in `mk` are two perpendicular ones (an L), return their directions
     * (sx: +1 east / -1 west, sy: +1 south / -1 north). `strict`: no other neighbours at all (lines);
     * otherwise (shorelines) the two opposite sides must be clear.
     */
    function lCorner(mk: number, strict: boolean): [number, number] | null {
      const orth = mk & 15;
      if (strict && mk !== orth) return null;
      const sx = orth & 1 ? 1 : orth & 2 ? -1 : 0, sy = orth & 4 ? 1 : orth & 8 ? -1 : 0;
      if (!sx || !sy || (orth & 3) === 3 || (orth & 12) === 12) return null;
      return [sx, sy];
    }
    const orient = ([sx, sy]: [number, number], u: number, v: number) => [sx > 0 ? u : 1 - u, sy > 0 ? v : 1 - v];

    /** distance (uv) from (u,v) to the nearest edge/corner shared with a neighbour in `mk` (no diagonal suppression) */
    const rawMask = (f: (j: number) => boolean) => {
      let mk = 0;
      N8.forEach(([dx, dy], k) => { const j = at(dx, dy); if (j >= 0 && f(j)) mk |= 1 << k; });
      return mk;
    };
    const edgeDist = (mk: number, u: number, v: number) => {
      let d = 9;
      if (mk & 1) d = Math.min(d, 1 - u);
      if (mk & 2) d = Math.min(d, u);
      if (mk & 4) d = Math.min(d, 1 - v);
      if (mk & 8) d = Math.min(d, v);
      if (mk & 16) d = Math.min(d, Math.hypot(1 - u, 1 - v));
      if (mk & 32) d = Math.min(d, Math.hypot(1 - u, v));
      if (mk & 64) d = Math.min(d, Math.hypot(u, 1 - v));
      if (mk & 128) d = Math.min(d, Math.hypot(u, v));
      return d;
    };
    const water = t === Terrain.Water;

    if (water) {
      const landMask = rawMask((j) => m.terrain[j] !== Terrain.Water);
      const shoreL = lCorner(landMask, false);
      const polluted = Math.min(8, Math.floor(w.pollution[i] * 6)) * 0.05; // stepped, so chunk signatures stay stable
      return (u: number, v: number, _h: number, gx: number, gy: number) => {
        let c = pick(WATER, hash(gx >> 2, gy >> 1, 3));
        const r = hash(gx >> 2, gy, 4);
        if (r > 0.97 && (gx & 3) < 3) c = 0x6f9cc0; // ripple
        if (landMask) {
          let dl = edgeDist(landMask, u, v);
          if (shoreL) {
            // a water tile poking out between two land sides: cut its corner into a 45° bank
            const [a, b] = orient(shoreL, u, v);
            const dc = (1.5 - a - b) * Math.SQRT1_2;
            if (dc < 0) return dc > -0.06 ? pick(PAL.wet, hash(gx, gy, 25)) : pick(PAL.sand, hash(gx, gy, 26));
            dl = Math.min(dl, dc);
          }
          if (dl < 0.05 && hash(gx, gy, 5) < 0.35) c = 0x9cc0d4;
          else if (dl < 0.14) c = 0x3f7598;
        }
        if (polluted > 0) c = rgb(((c >> 16) & 255) * (1 - polluted) + 70 * polluted, ((c >> 8) & 255) * (1 - polluted) + 64 * polluted, (c & 255) * (1 - polluted) + 50 * polluted);
        return c;
      };
    }

    // base ground by land use
    let base: (u: number, v: number, h: number, gx: number, gy: number) => number;
    switch (use) {
      case Use.Forest: base = (_u, _v, _h, gx, gy) => pick(PAL.woods, hash(gx >> 1, gy >> 1, 6)); break;
      case Use.Farm: {
        const fx = Math.floor(x / 7), fy = Math.floor(y / 5);
        const crop = PAL.crops[Math.floor(hash(fx, fy, w.seed & 0xffff) * PAL.crops.length)];
        const along = hash(fx, fy, 11) < 0.5;
        const hedgeU = x % 7 === 0, hedgeV = y % 5 === 0;
        base = (u, v, _h, gx, gy) => {
          if ((hedgeU && u < 0.07) || (hedgeV && v < 0.07)) return hash(gx, gy, 12) < 0.7 ? 0x3e5a2a : 0x4e6a34;
          const row = along ? (y + v) * 9 : (x + u) * 9;
          const stripe = Math.floor(row) & 1;
          return crop[stripe ? 0 : hash(gx, gy, 13) < 0.8 ? 1 : 2];
        };
        break;
      }
      case Use.Cottage: case Use.Houses: base = (_u, _v, _h, gx, gy) => pick(PAL.lot, hash(gx >> 1, gy, 14)); break;
      case Use.Rowhouses: case Use.Civic: base = (_u, _v, _h, gx, gy) => pick(PAL.town, hash(gx, gy, 15)); break;
      case Use.Industry: case Use.Rival: {
        const pr = this.plants.get(i);
        const gr = pr?.t.ground ?? "yard";
        const flooded = pr?.c.status === "flooded";
        if (gr === "dock") base = (u, v, _h, gx, gy) => {
          const along = pr?.t.axis === "v" ? v : u;
          return (Math.floor(along * 16) & 1) ? (hash(gx, gy, 40) < 0.2 ? 0x5a4632 : 0x6e5840) : 0x7a6448;
        };
        else if (gr === "paved") base = (_u, _v, _h, gx, gy) => pick(PAL.paved, hash(gx >> 1, gy, 17));
        else if (gr === "spur") {
          const ax = pr?.t.axis ?? "u";
          base = (u, v, _h, gx, gy) => {
            const d = Math.abs((ax === "u" ? v : u) - 0.5), along = ax === "u" ? u : v;
            if (d < 0.13) {
              let c = hash(gx, gy, 30) < 0.5 ? 0x6a6258 : 0x5c544a;
              if (d < 0.09 && (Math.floor(along / 0.07) & 1) === 0) c = 0x4a3626;
              if (Math.abs(d - 0.045) < pxu * 0.9) c = 0xa8a8b0;
              return c;
            }
            return pick(PAL.yard, hash(gx, gy, 16));
          };
        } else base = (_u, _v, _h, gx, gy) => (flooded && hash(gx >> 3, gy >> 2, 41) < 0.45 ? 0x4a6a80 : pick(PAL.yard, hash(gx, gy, 16)));
        break;
      }
      case Use.Park: base = (u, v, _h, gx, gy) => {
        const path = ((x + y) % 4 === 0 && Math.abs(u - v) < 0.07) || ((x - y + 400) % 4 === 0 && Math.abs(u + v - 1) < 0.07);
        if (path) return hash(gx, gy, 44) < 0.3 ? 0xb8a888 : 0xc8b898;
        return hash(gx >> 1, gy >> 1, 45) < 0.5 ? 0x7cb04c : 0x86b854;
      }; break;
      case Use.Mine: base = (_u, _v, _h, gx, gy) => (hash(gx, gy, 42) < 0.5 ? 0x3a3630 : pick(PAL.woods, hash(gx >> 1, gy >> 1, 6))); break;
      case Use.Commerce: base = (_u, _v, _h, gx, gy) => pick(PAL.paved, hash(gx >> 1, gy, 43) * 0.5 + 0.2); break;
      case Use.Landmark: base = (_u, _v, _h, gx, gy) => pick(PAL.paved, hash(gx >> 1, gy, 17)); break;
      case Use.Wharf: base = (_u, _v, _h, gx, gy) => {
        const sx = Math.floor(gx / 3) + ((Math.floor(gy / 2) & 1) ? 1 : 0);
        if (gx % 3 === 0 || gy % 2 === 0) return 0x5c5850;
        return hash(sx, gy >> 1, 18) < 0.5 ? 0x8e8a80 : 0x7a766e;
      }; break;
      case Use.Rock: {
        // bare bluff: soft, broken strata (not hard contour bands), with a ragged, chamfered edge into the
        // woods or fields next to it so a chain of rock tiles doesn't read as a staircase
        const soft = rawMask((j) => w.use[j] !== Use.Rock && m.terrain[j] !== Terrain.Water);
        const corner = lCorner(soft, false);
        base = (u, v, h, gx, gy) => {
          if (soft) {
            let d = edgeDist(soft, u, v);
            if (corner) { const [a, b] = orient(corner, u, v); d = Math.min(d, (1.5 - a - b) * Math.SQRT1_2); }
            const reach = 0.18 + hash(gx >> 2, gy >> 2, 47) * 0.22;
            if (d < reach && hash(gx >> 1, gy >> 1, 48) < 1 - d / reach) return pick(PAL.woods, hash(gx >> 1, gy >> 1, 6));
          }
          const band = Math.floor(h / 4 + hash(gx >> 3, gy >> 2, 49) * 0.9);
          const c = PAL.rock[(band + (hash(band, 0, 19) * 2 | 0)) % 3 + 0];
          return hash(gx, gy, 20) < 0.08 ? 0x6e6658 : hash(gx >> 1, gy >> 1, 21) < 0.16 ? 0x5e7a3a : c;
        };
        break;
      }
      default: {
        const pal = t === Terrain.Floodplain ? PAL.meadow : PAL.grass;
        base = (_u, _v, _h, gx, gy) => {
          const r = hash(gx, gy, 22);
          if (r > 0.995) return 0xe8e0a0;
          if (r > 0.99) return 0xd8b0c8;
          return pick(pal, hash(gx >> 1, gy >> 1, 23) * 0.6 + r * 0.4);
        };
      }
    }
    if (t === Terrain.Cliff && use === Use.Forest) {
      const b0 = base;
      base = (u, v, h, gx, gy) => (hash(gx >> 2, gy >> 1, 24) < 0.35 ? PAL.rock[(Math.floor(h / 2.5)) % 5] : b0(u, v, h, gx, gy));
    }

    // linear features
    const incline = use === Use.Incline ? mask((j) => w.use[j] === Use.Incline) : -1;
    const stairs = w.street[i] === Street.Steps || (w.street[i] > 0 && m.slope[i] >= 24);
    const streetMask = w.street[i] ? mask((j) => w.street[j] > 0) : 0;
    const dense = use === Use.Rowhouses || w.street[i] && [at(1, 0), at(-1, 0), at(0, 1), at(0, -1)].some((j) => j >= 0 && w.use[j] === Use.Rowhouses);
    const streetW = w.street[i] === Street.Pike ? 0.17 : dense ? 0.26 : 0.14;
    // creeks and rails come from the source vectors where the map has them (smooth on any angle);
    // otherwise from the raster masks
    const vec = m.lines.creek.length > 0 || m.lines.rail.length > 0;
    const segs = vec ? lineIndex(m).get(i) ?? [] : [];
    const creekSegs = segs.filter((sg) => sg.kind === "creek");
    const railSegs = segs.filter((sg) => sg.kind === "rail" && (m.railLines[String(sg.line)]?.year ?? 9999) <= w.year);
    const nearest = (list: Seg[], u: number, v: number): [number, number] => {
      let bd = 9, ba = 0;
      for (const sg of list) { const [d, a] = segDist(sg, x + u, y + v); if (d < bd) { bd = d; ba = a; } }
      return [bd, ba];
    };
    const rail = vec ? (railSegs.length ? 0 : -1) : railActive(i) ? mask((j) => railActive(j)) : -1;
    const creekMask = vec ? (creekSegs.length ? 0 : -1) : m.creek[i] ? mask((j) => m.creek[j] > 0 || m.terrain[j] === Terrain.Water) : -1;
    const waterMask = rawMask((j) => m.terrain[j] === Terrain.Water);
    const wharf = m.special[i] === Special.Wharf;
    const waterL = !wharf && !w.street[i] && !w.owner[i] && use !== Use.Wharf ? lCorner(waterMask, false) : null;

    return (u: number, v: number, h: number, gx: number, gy: number) => {
      let c = base(u, v, h, gx, gy);
      if (waterMask && !wharf) {
        let dw = edgeDist(waterMask, u, v);
        if (waterL) {
          // a point of land between two water sides: the river takes the corner (45° bank)
          const [a, b] = orient(waterL, u, v);
          const dc = (1.5 - a - b) * Math.SQRT1_2;
          if (dc < 0) return dc > -0.05 ? 0x3f7598 : pick(WATER, hash(gx >> 2, gy >> 1, 3));
          dw = Math.min(dw, dc);
        }
        if (dw < 0.08) c = pick(PAL.wet, hash(gx, gy, 25));
        else if (dw < 0.24 + hash(gx >> 2, gy >> 2, 27) * 0.08) c = pick(PAL.sand, hash(gx, gy, 26));
      }
      if (creekMask >= 0) {
        const [dc] = vec ? nearest(creekSegs, u, v) : lineDist(creekMask, u, v);
        if (dc < 0.06) c = hash(gx, gy, 27) < 0.15 ? 0x8cb4d4 : 0x467aa0;
        else if (dc < 0.1) c = 0x5e6a44;
      }
      if (incline >= 0) {
        const [di] = lineDist(incline || 0xff, u, v);
        if (di < 0.22) c = hash(gx, gy, 46) < 0.5 ? 0x6a5e48 : 0x5e5440; // cleared right-of-way
      }
      if (w.street[i] && stairs) {
        // Pittsburgh city steps: concrete or timber treads with landings and pipe handrails
        const [ds, along] = lineDist(streetMask, u, v);
        const landing = (Math.floor(along / 0.25) & 1) === 1 && (along % 0.25) < 0.06;
        const wood = w.year < 1910;
        if (ds < 0.09) c = landing ? (wood ? 0x9a8a6a : 0xb0aca4) : (Math.floor(along / 0.03) & 1) ? (wood ? 0x8a7a5e : 0xa8a49c) : (wood ? 0x5e4e3a : 0x6e6a64);
        else if (Math.abs(ds - 0.11) < pxu * 1.2) c = wood ? 0x3a3028 : 0x4a5a6a;
      } else if (w.street[i]) {
        const [ds] = lineDist(streetMask, u, v);
        if (ds < streetW) {
          if (dense) {
            // cobbles
            c = (gx % 3 === 0 || gy % 2 === 0) ? 0x6a665e : hash(gx >> 1, gy >> 1, 28) < 0.5 ? 0x8e8a82 : 0x7e7a72;
          } else {
            c = ds > streetW - pxu * 1.5 ? 0x6e5e44 : hash(gx, gy, 29) < 0.12 ? 0x7a6a4e : 0x92805e;
            if (Math.abs(ds - streetW * 0.45) < pxu * 0.8) c = 0x7e6c50; // wheel ruts
          }
        }
      }
      if (rail >= 0) {
        const [dr, along] = vec ? nearest(railSegs, u, v) : lineDist(rail, u, v);
        if (dr < 0.13) {
          c = hash(gx, gy, 30) < 0.5 ? 0x6a6258 : 0x5c544a; // ballast
          if (dr < 0.09 && (Math.floor(along / 0.07) & 1) === 0) c = 0x4a3626; // ties
          if (Math.abs(dr - 0.045) < pxu * 0.9) c = 0xa8a8b0; // rails
        }
      }
      if (grid && (u < pxu || v < pxu)) c = rgb(((c >> 16) & 255) * 0.82, ((c >> 8) & 255) * 0.82, (c & 255) * 0.82);
      return c;
    };
  }

  /** What is drawn on a tile (sprite keys and the plant part, if any), for the query tool. */
  tileObjects(g: GameState, x: number, y: number): { keys: string[]; plant?: { part: string; owner: string } } {
    this.updatePlants(g);
    const i = y * this.map.width + x;
    const pr = this.plants.get(i);
    return { keys: this.tileSprites(g, x, y, i).map((s) => s.key), plant: pr ? { part: pr.t.part, owner: pr.c.owner } : undefined };
  }

  // ------------------------------------------------------------ sprites per tile
  private houseSpecFor(g: GameState, x: number, y: number, i: number, kind: HouseKind, sub: number) {
    const m = this.map, w = g.world, W = m.width, V = W + 1;
    const st = (dx: number, dy: number) => {
      const nx = x + dx, ny = y + dy;
      return nx >= 0 && ny >= 0 && nx < W && ny < m.height && w.street[ny * W + nx] > 0;
    };
    let o: "a" | "b" = "a", front: "+" | "-" = "+";
    if (st(0, 1)) { o = "a"; front = "+"; }
    else if (st(1, 0)) { o = "b"; front = "+"; }
    else if (st(0, -1)) { o = "a"; front = "-"; }
    else if (st(-1, 0)) { o = "b"; front = "-"; }
    else { o = hash(x, y, 50) < 0.5 ? "a" : "b"; front = "+"; }
    const corner = (st(0, 1) || st(0, -1)) && (st(1, 0) || st(-1, 0)) ? 1 : 0;
    const hT = m.vert[y * V + x], hR = m.vert[y * V + x + 1], hL = m.vert[(y + 1) * V + x], hB = m.vert[(y + 1) * V + x + 1];
    const hc = (hT + hR + hL + hB) / 4;
    const q = (h: number) => Math.max(-60, Math.min(60, Math.round(((h - hc) * ZPX) / 3) * 3));
    const ground: [number, number, number, number] = [q(hT), q(hR), q(hB), q(hL)];
    const pol = w.pollution[i];
    const soot = pol < 0.15 ? 0 : pol < 0.5 ? 1 : pol < 1.2 ? 2 : 3;
    const housing = kind !== "civic" && kind !== "shop";
    const boarded = housing && w.pop[i] === 0 && kind !== "mansion" ? 1 : 0;
    // the community's style: houses whose families belong to the community that holds this part of town
    const kc = w.kit[((y / 8) | 0) * Math.ceil(W / 8) + ((x / 8) | 0)];
    const kit = housing && kc && w.eth[i] === kc ? kc : 0;
    return houseKey({ kind, sub, style: styleForYear(w.built[i] || 1850), o, front, corner, v: Math.floor(hash(x, y, 51) * 6), g: ground, lift: 0, fnd: 0, soot, boarded, kit });
  }

  private denseStreet(g: GameState, x: number, y: number) {
    const m = this.map, w = g.world, W = m.width;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= m.height) continue;
      const u2 = w.use[ny * W + nx];
      if (u2 === Use.Rowhouses || u2 === Use.Commerce) return true;
    }
    return false;
  }

  private tileSprites(g: GameState, x: number, y: number, i: number): { key: string; u: number; v: number; h?: number }[] {
    const m = this.map, w = g.world, W = m.width;
    const out: { key: string; u: number; v: number; h?: number }[] = [];
    const n = (c: number) => hash(x, y, c + (w.seed & 0xff));
    const use = w.use[i];
    const t = m.terrain[i];
    const sub = w.sub[i];

    switch (use) {
      case Use.Forest: {
        const high = m.elevation[i] > 320 || t === Terrain.Steep || t === Terrain.Cliff;
        const count = 3 + Math.floor(n(2) * 3);
        for (let k = 0; k < count; k++) {
          const u = 0.15 + hash(x * 7 + k, y, 31) * 0.7, v = 0.15 + hash(x, y * 7 + k, 32) * 0.7;
          const r = hash(x + k, y - k, 33);
          const sp = high ? (r < 0.55 ? "pine" : r < 0.85 ? "oak" : "bush") : (r < 0.45 ? "oak" : r < 0.8 ? "maple" : r < 0.92 ? "pine" : "bush");
          out.push({ key: `tree:${sp}${Math.floor(hash(k, x + y, 34) * (sp === "bush" ? 2 : 3))}`, u, v });
        }
        break;
      }
      case Use.Empty:
        if (!w.street[i] && t !== Terrain.Water && n(3) < 0.18) out.push({ key: n(4) < 0.5 ? "tree:bush0" : `tree:oak${Math.floor(n(5) * 3)}`, u: 0.3 + n(6) * 0.4, v: 0.3 + n(7) * 0.4 });
        break;
      case Use.Farm:
        if (x % 7 === 0 && y % 5 === 0 && n(8) < 0.7) out.push({ key: `tree:oak${Math.floor(n(9) * 3)}`, u: 0.12, v: 0.12 });
        break;
      case Use.Cottage: {
        if (sub === HouseSub.Shanty) { out.push({ key: this.houseSpecFor(g, x, y, i, "shanty", sub), u: 0.5, v: 0.5 }); break; }
        if (sub === HouseSub.Company) { out.push({ key: this.houseSpecFor(g, x, y, i, "company", sub), u: 0.5, v: 0.5 }); break; }
        let nearStreet = false;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const nx = x + dx, ny = y + dy; if (nx >= 0 && ny >= 0 && nx < W && ny < m.height && w.street[ny * W + nx]) nearStreet = true; }
        if (!nearStreet && w.pop[i] >= 4) out.push({ key: `farm:${Math.floor(n(11) * 2)}`, u: 0.5, v: 0.5 });
        else out.push({ key: this.houseSpecFor(g, x, y, i, "cottage", sub), u: 0.5, v: 0.5 });
        break;
      }
      case Use.Houses: {
        const kind: HouseKind = sub === HouseSub.Estate ? (w.pollution[i] < 0.4 ? "mansion" : "house") : sub === HouseSub.Company ? "company" : sub === HouseSub.Shanty ? "shanty" : sub === HouseSub.Boarding ? "boarding" : "house";
        out.push({ key: this.houseSpecFor(g, x, y, i, kind, sub), u: 0.5, v: 0.5 });
        break;
      }
      case Use.Rowhouses:
        out.push({ key: this.houseSpecFor(g, x, y, i, sub === HouseSub.Boarding ? "boarding" : "row", sub), u: 0.5, v: 0.5 });
        break;
      case Use.Civic:
        out.push({ key: this.houseSpecFor(g, x, y, i, "civic", sub as CivicSub), u: 0.5, v: 0.5 });
        break;
      case Use.Commerce:
        out.push({ key: this.houseSpecFor(g, x, y, i, "shop", sub || 2), u: 0.5, v: 0.5 });
        break;
      case Use.Mine:
        out.push({ key: `mine:${Math.floor(n(12) * 2)}`, u: 0.5, v: 0.5 });
        break;
      case Use.Park:
        if (n(22) < 0.55) out.push({ key: `tree:${n(23) < 0.6 ? "oak" : "maple"}${Math.floor(n(24) * 3)}`, u: 0.25 + n(25) * 0.5, v: 0.25 + n(26) * 0.5 });
        if (n(27) < 0.08) out.push({ key: "park:bandstand", u: 0.5, v: 0.5 });
        break;
      case Use.Incline: {
        // stations at either end, a car part-way up
        let nb = 0;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const nx = x + dx, ny = y + dy; if ((dx || dy) && nx >= 0 && ny >= 0 && nx < W && ny < m.height && w.use[ny * W + nx] === Use.Incline && w.sub[ny * W + nx] === sub) nb++; }
        if (nb <= 1) out.push({ key: "incline:station", u: 0.5, v: 0.5 });
        break;
      }
      case Use.Landmark: {
        const st = w.structure[i];
        if (st > 0 && st < 255) out.push({ key: `struct:${STRUCTURES[st]}`, u: 0.5, v: 0.5 });
        break;
      }
      case Use.Wharf:
        if (n(18) < 0.3) out.push({ key: `wharf:${Math.floor(n(19) * 3)}`, u: 0.5, v: 0.5 });
        break;
      case Use.Industry:
      case Use.Rival: {
        const pr = this.plants.get(i);
        if (pr && pr.t.part) {
          const soot = Math.min(3, Math.floor(pr.years / 12) + 1);
          out.push({ key: plantKey(pr.t, pr.c, soot, Math.floor(n(14) * 3)), u: 0.5, v: 0.5 });
        }
        break;
      }
    }

    // gas (later electric) street lamps along busy streets
    if (w.street[i] && w.street[i] !== Street.Bridge && (x * 3 + y) % 4 === 0 && this.denseStreet(g, x, y))
      out.push({ key: w.year >= 1910 ? "lamp:elec" : "lamp:gas", u: 0.5, v: 0.5 });

    if (t === Terrain.Water) {
      // bridges are drawn whole as smooth spans (drawBridges), not per tile
      if (!(w.street[i] === Street.Bridge || (m.rail[i] && (m.railLines[String(m.rail[i])]?.year ?? 9999) <= w.year))) {
        // barges moored at plant docks; steamboats at the wharves; coal barges on the Mon
        let dock = false, nearWharf = false;
        for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= W || ny >= m.height) continue;
          const j = ny * W + nx;
          if (Math.abs(dx) <= 1 && Math.abs(dy) <= 1 && this.plants.get(j)?.t.ground === "dock") dock = true;
          if (m.special[j] === Special.Wharf) nearWharf = true;
        }
        const axis = riverAxis(m, x, y);
        if (dock && (x + y) % 2 === 0) out.push({ key: `boat:barge:${axis}`, u: 0.5, v: 0.5 });
        else if ((x + 2 * y) % 5 === 0) {
          if (nearWharf && n(20) < 0.3) out.push({ key: `boat:steam:${axis}`, u: 0.5, v: 0.5 });
          else if (n(21) < 0.006) out.push({ key: `boat:barge:${axis}`, u: 0.5, v: 0.5 });
        }
      }
    }
    if (out.length > 1) out.sort((a, b) => a.u + a.v - (b.u + b.v));
    return out;
  }

  // ------------------------------------------------------------ bridges (whole spans, drawn live)
  /**
   * Each bridge is one straight span from abutment to abutment with a smooth vertical profile
   * (bank height at the ends, navigation clearance over the channel), piers in the river, and a
   * superstructure by type: covered timber, wire suspension, lenticular truss, through truss, arch.
   */
  drawBridges(ctx: CanvasRenderingContext2D, cam: Camera, g: GameState) {
    const m = this.map, z = cam.zoom, year = g.world.year;
    const cw = ctx.canvas.width, ch = ctx.canvas.height;
    const S = (x: number, y: number, h: number): [number, number] => { const [wx, wy] = project(x, y, h); return [(wx - cam.x) * z, (wy - cam.y) * z]; };
    const elevAt = (x: number, y: number) => m.elevation[Math.max(0, Math.min(m.height - 1, Math.floor(y))) * m.width + Math.max(0, Math.min(m.width - 1, Math.floor(x)))];
    const live = m.spans.map((sp) => ({ sp, st: stageOf(sp, year) })).filter((o) => o.st)
      .sort((p, q) => (p.sp.a[0] + p.sp.a[1] + p.sp.b[0] + p.sp.b[1]) - (q.sp.a[0] + q.sp.a[1] + q.sp.b[0] + q.sp.b[1]));
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.lineJoin = "round";
    for (const { sp, st } of live) {
      const type = st!.type, built = st!.year;
      const [ax, ay] = sp.a, [bx, by] = sp.b;
      const A = S(ax, ay, 260), B = S(bx, by, 260);
      if (Math.max(A[0], B[0]) < -200 || Math.min(A[0], B[0]) > cw + 200 || Math.max(A[1], B[1]) < -300 || Math.min(A[1], B[1]) > ch + 300) continue;
      const len = Math.hypot(bx - ax, by - ay);
      const ux = (bx - ax) / len, uy = (by - ay) / len;
      const rail = sp.kind === "rail";
      const halfW = (rail ? 0.16 : type === "arch" && built >= 1940 ? 0.32 : 0.22);
      // which side faces the viewer (larger x + y)
      let px = -uy * halfW, py = ux * halfW;
      if (px + py < 0) { px = -px; py = -py; }
      const gA = elevAt(ax, ay), gB = elevAt(bx, by);
      const wl = m.waterLevel[Math.floor((ay + by) / 2) * m.width + Math.floor((ax + bx) / 2)] || Math.min(gA, gB) - 8;
      const clear = rail ? 17 : type === "covered" ? 9 : built >= 1920 ? 22 : 14;
      const lift = Math.max(0, wl + clear - Math.min(gA, gB));
      const N = Math.max(8, Math.round(len * 4));
      const hAt = (t: number) => gA + (gB - gA) * t + lift * Math.pow(Math.sin(Math.PI * t), 0.45);
      const at = (t: number, side: number, dz = 0): [number, number] => S(ax + (bx - ax) * t + px * side, ay + (by - ay) * t + py * side, hAt(t) + dz);
      const ts: number[] = []; for (let k = 0; k <= N; k++) ts.push(k / N);
      const steel = rail ? (built < 1890 ? "#3e3e46" : "#4e525c") : built >= 1955 ? "#c8a23a" : built >= 1890 ? "#5a6470" : "#3e3e46";
      const lw = (w: number) => Math.max(1, w * z);
      const line = (pts: [number, number][], col: string, w: number) => { ctx.strokeStyle = col; ctx.lineWidth = lw(w); ctx.beginPath(); pts.forEach(([x, y], k) => (k ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.stroke(); };
      const seg = (p: [number, number], q: [number, number], col: string, w: number) => line([p, q], col, w);
      const poly = (pts: [number, number][], col: string) => { ctx.fillStyle = col; ctx.beginPath(); pts.forEach(([x, y], k) => (k ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.closePath(); ctx.fill(); };

      // piers (only where the ground under the span is river)
      const nP = Math.max(1, Math.round(len / 3.6));
      const piers: number[] = [];
      for (let k = 1; k < nP; k++) piers.push(k / nP);
      if (type === "suspension" && !rail) { piers.length = 0; piers.push(0.2, 0.8); }
      const pierCol = built < 1900 ? "#8a8272" : "#9a968c";
      for (const t of piers) {
        const fx = ax + (bx - ax) * t, fy = ay + (by - ay) * t;
        const base = Math.min(hAt(t), elevAt(fx, fy) < wl + 1 ? wl - 1 : elevAt(fx, fy));
        const top = hAt(t) - 1.5;
        const f0 = S(fx - px * 1.1, fy - py * 1.1, top), f1 = S(fx + px * 1.1, fy + py * 1.1, top);
        const b0 = S(fx - px * 1.1, fy - py * 1.1, base), b1 = S(fx + px * 1.1, fy + py * 1.1, base);
        poly([f0, f1, b1, b0], pierCol);
        const thick = 3 * z;
        poly([f1, [f1[0] + thick, f1[1] - thick / 2], [b1[0] + thick, b1[1] - thick / 2], b1], shade6(pierCol, 0.7));
      }

      // superstructure drawing for one side (-1 far, +1 near)
      const side = (s: number) => {
        if (type === "covered") {
          const H = 5.5;
          const bottom = ts.map((t) => at(t, s)), topPts = ts.map((t) => at(t, s, H));
          poly([...bottom, ...topPts.reverse()], s > 0 ? "#8a3e2a" : "#6a2e20");
          for (let k = 2; k < N; k += 3) { const q = at(k / N, s, 2.5); ctx.fillStyle = "#2a1a14"; ctx.fillRect(q[0] - lw(1), q[1] - lw(1), lw(2), lw(1.5)); }
        } else if (type === "truss") {
          const H = rail ? 9 : 8;
          const top = ts.map((t) => at(t, s, H));
          line(top, steel, 1.6);
          line(ts.map((t) => at(t, s, 0.3)), steel, 1.4);
          const panels = Math.max(4, Math.round(len * 1.6));
          for (let k = 0; k <= panels; k++) {
            const t = k / panels;
            seg(at(t, s, 0.3), at(t, s, H), steel, 1);
            if (k < panels) seg(at(k % 2 ? t : (k + 1) / panels, s, 0.3), at(k % 2 ? (k + 1) / panels : t, s, H), steel, 0.8);
          }
        } else if (type === "lenticular") {
          // Smithfield Street: lens-shaped trusses over each span
          const spans = [0, ...piers, 1];
          for (let k = 0; k + 1 < spans.length; k++) {
            const t0 = spans[k], t1 = spans[k + 1];
            const up: [number, number][] = [], dn: [number, number][] = [];
            for (let j = 0; j <= 16; j++) { const t = t0 + ((t1 - t0) * j) / 16, f = Math.sin((Math.PI * j) / 16); up.push(at(t, s, 1 + f * 9)); dn.push(at(t, s, 1 - f * 4)); }
            line(up, steel, 1.8); line(dn, steel, 1.4);
            for (let j = 1; j < 16; j += 2) seg(up[j], dn[j], steel, 0.7);
            const portal = at(t0, s, 0), portal2 = at(t0, s, 10);
            seg(portal, portal2, "#7a6a5a", 2.2);
          }
        } else if (type === "suspension") {
          const towers = [0.2, 0.8], TH = rail ? 20 : 18;
          for (const t of towers) seg(at(t, s, -1), at(t, s, TH), built >= 1920 ? steel : "#8a8272", built >= 1920 ? 2.4 : 3.2);
          const cable: [number, number][] = [];
          for (const t of ts) {
            let zc: number;
            if (t < 0.2) zc = TH * (t / 0.2) ** 1.4;
            else if (t > 0.8) zc = TH * ((1 - t) / 0.2) ** 1.4;
            else { const u = (t - 0.5) / 0.3; zc = 2 + (TH - 2) * u * u; }
            cable.push(at(t, s, zc));
          }
          line(cable, "#2a2a2e", 1.3);
          for (let k = 1; k < N; k++) { const t = k / N; if (k % 2) continue; seg(at(t, s, 0.5), cable[k], "#4a4a50", 0.6); }
          ctx.fillStyle = "#2a2a2e";
          line(ts.map((t) => at(t, s, 1.2)), "#3a3a40", 0.8);
        } else if (type === "arch") {
          if (built >= 1940) {
            // tied arch above the deck
            const arch: [number, number][] = ts.map((t) => at(t, s, 2 + Math.sin(Math.PI * Math.min(1, Math.max(0, (t - 0.1) / 0.8))) * 16 * (t > 0.1 && t < 0.9 ? 1 : 0)));
            line(arch, steel, 2.4);
            for (let k = 2; k < N - 1; k += 2) { const t = k / N; if (t > 0.12 && t < 0.88) seg(at(t, s, 0.5), arch[k], steel, 0.7); }
          } else {
            // deck arch springing from the piers, spandrel columns up to the deck
            const t0 = 0.12, t1 = 0.88;
            const arch: [number, number][] = [];
            for (let j = 0; j <= 24; j++) { const t = t0 + ((t1 - t0) * j) / 24; const f = Math.sin((Math.PI * j) / 24); const zz = (wl + 2 - hAt(t)) * (1 - f) - 0.8 * f; arch.push(at(t, s, zz)); }
            line(arch, s > 0 ? "#8a96a4" : steel, 3);
            for (let j = 2; j < 24; j += 2) { const t = t0 + ((t1 - t0) * j) / 24; seg(arch[j], at(t, s, 0), steel, 1); }
          }
          line(ts.map((t) => at(t, s, 1)), "#c8c4b8", 0.8); // railing
        }
      };

      // far side, deck, fascia, near side, covered roof
      side(-1);
      const far = ts.map((t) => at(t, -1)), near = ts.map((t) => at(t, 1));
      const deckCol = rail ? "#3e3a36" : type === "covered" ? "#7a5a3a" : built >= 1920 ? "#6a6a6a" : "#8a7656";
      poly([...far, ...[...near].reverse()], deckCol);
      if (!rail && z >= 0.375) line(ts.map((t) => at(t, 0, 0.05)), built >= 1920 ? "#c8c040" : "#6e5c44", 0.5);
      if (rail && z >= 0.375) { line(ts.map((t) => at(t, -0.3, 0.1)), "#a8a8b0", 0.6); line(ts.map((t) => at(t, 0.3, 0.1)), "#a8a8b0", 0.6); }
      const fasc = ts.map((t) => at(t, 1, -1.8));
      poly([...near, ...[...fasc].reverse()], type === "covered" ? "#5a2a1c" : "#4a4440");
      side(1);
      if (type === "covered") {
        const rf = ts.map((t) => at(t, -1, 5.5)), rn = ts.map((t) => at(t, 1, 5.5)), ridge = ts.map((t) => at(t, 0, 8));
        poly([...rf, ...[...ridge].reverse()], "#4a4038");
        poly([...ridge, ...[...rn].reverse()], "#5e5248");
      }
      if (type === "truss" && z >= 0.375) {
        for (let k = 0; k <= N; k += 3) seg(at(k / N, -1, rail ? 9 : 8), at(k / N, 1, rail ? 9 : 8), steel, 0.7);
      }
    }
    ctx.restore();
  }

  // ------------------------------------------------------------ inclines (drawn live, cars run)
  /** Timber trestle on a straight grade from foot to head, with two counterbalanced cars. */
  /** the player's rail siding: ballast, ties and rails from the works to the main line */
  drawSpur(ctx: CanvasRenderingContext2D, cam: Camera, g: GameState) {
    const c = g.company;
    if (!c?.spur) return;
    const m = this.map, z = cam.zoom;
    const S = (x: number, y: number): [number, number] => { const xi = Math.max(0, Math.min(m.width - 1, Math.floor(x))), yi = Math.max(0, Math.min(m.height - 1, Math.floor(y))); const [wx, wy] = project(x, y, m.elevation[yi * m.width + xi] + 0.4); return [(wx - cam.x) * z, (wy - cam.y) * z]; };
    const [tx, ty] = c.spur;
    const ex = Math.max(c.x, Math.min(c.x + c.footprint, tx + 0.5)), ey = Math.max(c.y, Math.min(c.y + c.footprint, ty + 0.5));
    const len = Math.hypot(tx + 0.5 - ex, ty + 0.5 - ey);
    const n = Math.max(2, Math.ceil(len * 4));
    const ux = (tx + 0.5 - ex) / (len || 1), uy = (ty + 0.5 - ey) / (len || 1), vx = -uy * 0.09, vy = ux * 0.09;
    ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.lineCap = "round";
    const line = (off: number, col: string, wpx: number) => {
      ctx.strokeStyle = col; ctx.lineWidth = Math.max(1, wpx * z); ctx.beginPath();
      for (let k = 0; k <= n; k++) { const f = k / n; const [sx, sy] = S(ex + (tx + 0.5 - ex) * f + vx * off, ey + (ty + 0.5 - ey) * f + vy * off); if (k) ctx.lineTo(sx, sy); else ctx.moveTo(sx, sy); }
      ctx.stroke();
    };
    line(0, "#5c544a", 9);
    ctx.strokeStyle = "#4a3626"; ctx.lineWidth = Math.max(1, 1.5 * z);
    for (let k = 0; k <= n * 2; k++) { const f = k / (n * 2); const px = ex + (tx + 0.5 - ex) * f, py = ey + (ty + 0.5 - ey) * f; const a = S(px + vx * 1.6, py + vy * 1.6), b = S(px - vx * 1.6, py - vy * 1.6); ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke(); }
    line(1, "#a8a8b0", 1.2); line(-1, "#a8a8b0", 1.2);
    ctx.restore();
  }

  drawInclines(ctx: CanvasRenderingContext2D, cam: Camera, g: GameState, t: number) {
    const m = this.map, z = cam.zoom;
    const S = (x: number, y: number, h: number): [number, number] => { const [wx, wy] = project(x, y, h); return [(wx - cam.x) * z, (wy - cam.y) * z]; };
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    for (const inc of g.world.inclines) {
      const path = inc.path;
      if (path.length < 2) continue;
      const [x0, y0] = path[0], [x1, y1] = path[path.length - 1];
      const h0 = m.elevation[y0 * m.width + x0] + 2, h1 = m.elevation[y1 * m.width + x1] + 2;
      const A = S(x0 + 0.5, y0 + 0.5, h0), B = S(x1 + 0.5, y1 + 0.5, h1);
      if (Math.max(A[0], B[0]) < -50 || Math.min(A[0], B[0]) > ctx.canvas.width + 50 || Math.max(A[1], B[1]) < -50 || Math.min(A[1], B[1]) > ctx.canvas.height + 50) continue;
      const N = Math.max(2, Math.round(Math.hypot(x1 - x0, y1 - y0) * 3));
      const deck = (k: number): [number, number, number, number, number] => {
        const f = k / N;
        const fx = x0 + 0.5 + (x1 - x0) * f, fy = y0 + 0.5 + (y1 - y0) * f;
        const ground = m.elevation[Math.min(m.height - 1, Math.floor(fy)) * m.width + Math.min(m.width - 1, Math.floor(fx))];
        const h = h0 + (h1 - h0) * f; // a straight grade: cuts through high ground, trestles over low
        return [fx, fy, h, ground, f];
      };
      // trestle bents
      ctx.strokeStyle = "#3e2e1e";
      ctx.lineWidth = Math.max(1, 1.2 * z);
      for (let k = 1; k < N; k += 2) {
        const [fx, fy, h, ground] = deck(k);
        if (h - ground < 1.5) continue;
        const a = S(fx, fy, h), b = S(fx, fy, ground);
        ctx.beginPath(); ctx.moveTo(a[0] - 3 * z, a[1]); ctx.lineTo(b[0] - 5 * z, b[1]); ctx.moveTo(a[0] + 3 * z, a[1]); ctx.lineTo(b[0] + 5 * z, b[1]);
        ctx.moveTo(a[0] - 3 * z, (a[1] + b[1]) / 2); ctx.lineTo(a[0] + 3 * z, (a[1] + b[1]) / 2); ctx.stroke();
      }
      // deck and rails
      const pts: [number, number][] = [];
      for (let k = 0; k <= N; k++) { const [fx, fy, h] = deck(k); pts.push(S(fx, fy, h)); }
      const stroke = (col: string, w: number, dy = 0) => { ctx.strokeStyle = col; ctx.lineWidth = w; ctx.beginPath(); pts.forEach(([px, py], k) => (k ? ctx.lineTo(px, py + dy) : ctx.moveTo(px, py + dy))); ctx.stroke(); };
      stroke("#3a2a1c", Math.max(3, 11 * z));
      stroke("#6e5638", Math.max(2, 8 * z), -1 * z);
      stroke("#8a7050", Math.max(1, 2 * z), -3 * z);
      stroke("#b8b8c0", Math.max(1, 0.8 * z), -2 * z);
      // two cars, counterbalanced
      const ph = (Math.sin(t * 0.25 + inc.id) + 1) / 2;
      for (const f of [ph, 1 - ph]) {
        const k = f * N, k0 = Math.floor(k), k1 = Math.min(N, k0 + 1), r = k - k0;
        const p0 = pts[k0], p1 = pts[k1];
        const cx = p0[0] + (p1[0] - p0[0]) * r, cy = p0[1] + (p1[1] - p0[1]) * r;
        const w = 9 * z, hh = 9 * z;
        ctx.fillStyle = "#a8302a"; ctx.fillRect(cx - w / 2, cy - hh - 2 * z, w, hh);
        ctx.fillStyle = "#6a1e1a"; ctx.fillRect(cx - w / 2, cy - hh - 3 * z, w, 1.5 * z);
        ctx.fillStyle = "#f0e0b0"; ctx.fillRect(cx - w / 2 + 1.5 * z, cy - hh + 0.5 * z, w - 3 * z, 2.5 * z);
      }
    }
    ctx.restore();
  }

  // ------------------------------------------------------------ animation layer
  /**
   * Smoke, steam, furnace glow and flame from running works; night falls with lit windows and lamps.
   * Drawn on top of the cached chunks every frame. `t` in seconds, `night` 0..1.
   */
  drawAnimated(ctx: CanvasRenderingContext2D, cam: Camera, g: GameState, t: number, night: number) {
    const cw = ctx.canvas.width, ch = ctx.canvas.height, z = cam.zoom;
    const toS = (wx: number, wy: number): [number, number] => [(wx - cam.x) * z, (wy - cam.y) * z];
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    // night sky over the land
    if (night > 0.02) {
      ctx.fillStyle = `rgba(14,18,44,${(night * 0.62).toFixed(3)})`;
      ctx.fillRect(0, 0, cw, ch);
      if (z >= 0.375) this.drawLights(ctx, cam, g, night);
    }
    const wind = 1;
    for (const e of this.emitters) {
      if (!e.running) continue;
      const [sx, sy] = toS(e.wx, e.wy);
      if (sx < -200 || sx > cw + 300 || sy < -300 || sy > ch + 100) continue;
      const sz = e.size * z;
      if (e.kind === "smoke" || e.kind === "steam") {
        const N = 9;
        for (let k = 0; k < N; k++) {
          const ph = (t * 0.12 * (e.kind === "steam" ? 1.3 : 1) + k / N + e.seed / 97) % 1;
          const r = (3 + ph * 16) * sz;
          const px = sx + ph * 70 * sz * wind + Math.sin(ph * 6 + e.seed) * 4 * sz;
          const py = sy - ph * 55 * sz;
          const a = (1 - ph) * (e.kind === "steam" ? 0.5 : 0.62);
          const c = e.kind === "steam" ? 230 : 58 + ph * 70;
          ctx.fillStyle = `rgba(${c | 0},${(c - 4) | 0},${(c - 8) | 0},${a.toFixed(3)})`;
          ctx.beginPath();
          ctx.ellipse(px, py, r * 1.25, r, 0, 0, Math.PI * 2);
          ctx.fill();
        }
      } else {
        const flick = 0.65 + 0.35 * Math.sin(t * 9 + e.seed) * Math.sin(t * 3.7 + e.seed * 2);
        const r = (e.kind === "flame" ? 10 : 14) * sz * (1 + night * 1.6);
        ctx.globalCompositeOperation = "lighter";
        const gr = ctx.createRadialGradient(sx, sy, 0, sx, sy, r);
        const a = (0.35 + night * 0.55) * flick;
        gr.addColorStop(0, `rgba(255,200,90,${a.toFixed(3)})`);
        gr.addColorStop(0.5, `rgba(240,110,30,${(a * 0.5).toFixed(3)})`);
        gr.addColorStop(1, "rgba(200,60,20,0)");
        ctx.fillStyle = gr;
        ctx.fillRect(sx - r, sy - r, r * 2, r * 2);
        if (e.kind === "flame") {
          ctx.fillStyle = `rgba(255,${(180 + 60 * flick) | 0},80,${(0.8 * flick).toFixed(3)})`;
          ctx.beginPath();
          ctx.ellipse(sx, sy - 6 * sz * flick, 3 * sz, 9 * sz * flick, 0, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.globalCompositeOperation = "source-over";
      }
    }
    ctx.restore();
  }

  /** Lit windows and street lamps after dark (visible tiles only). */
  private drawLights(ctx: CanvasRenderingContext2D, cam: Camera, g: GameState, night: number) {
    const m = this.map, w = g.world, z = cam.zoom;
    const cw = ctx.canvas.width, ch = ctx.canvas.height;
    const corners = [[0, 0], [cw, 0], [cw, ch], [0, ch]].map(([px, py]) => {
      const wx = cam.x + px / z, wy = cam.y + py / z + (260 - BASE_M) * ZPX;
      const a = wx / HW, b = wy / HH;
      return [(a + b) / 2, (b - a) / 2];
    });
    const x0 = Math.max(0, Math.floor(Math.min(...corners.map((c) => c[0]))) - 4), x1 = Math.min(m.width - 1, Math.ceil(Math.max(...corners.map((c) => c[0]))) + 8);
    const y0 = Math.max(0, Math.floor(Math.min(...corners.map((c) => c[1]))) - 4), y1 = Math.min(m.height - 1, Math.ceil(Math.max(...corners.map((c) => c[1]))) + 8);
    ctx.globalCompositeOperation = "lighter";
    const a = Math.min(1, night * 1.3);
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const i = y * m.width + x;
      const u = w.use[i];
      const lampTile = w.street[i] && w.street[i] !== Street.Bridge && (x * 3 + y) % 4 === 0 && this.denseStreet(g, x, y);
      if (!(u >= Use.Cottage && u <= Use.Civic || u === Use.Commerce) && !lampTile) continue;
      const [wx, wy] = project(x + 0.5, y + 0.5, m.elevation[i]);
      const sx = (wx - cam.x) * z, sy = (wy - cam.y) * z;
      if (sx < -20 || sy < -40 || sx > cw + 20 || sy > ch + 20) continue;
      if (lampTile) {
        ctx.fillStyle = `rgba(255,220,140,${(0.5 * a).toFixed(3)})`;
        ctx.beginPath(); ctx.arc(sx - 24 * z, sy - 12 * z, 5 * z, 0, Math.PI * 2); ctx.fill();
        if (!(u >= Use.Cottage)) continue;
      }
      if (w.pop[i] === 0 && u !== Use.Commerce && u !== Use.Civic) continue;
      const lit = u === Use.Rowhouses ? 5 : u === Use.Commerce ? 4 : u === Use.Houses ? 3 : 1;
      for (let k = 0; k < lit; k++) {
        if (hash(x * 7 + k, y, 77 + Math.floor(Date.now() / 20000)) > 0.65) continue;
        const ox = (hash(x, y * 3 + k, 78) - 0.5) * 44 * z, oy = -(4 + hash(x + k, y, 79) * 22) * z;
        ctx.fillStyle = `rgba(255,210,120,${(0.85 * a).toFixed(3)})`;
        ctx.fillRect(Math.round(sx + ox), Math.round(sy + oy), Math.max(1, Math.round(2 * z)), Math.max(1, Math.round(2 * z)));
      }
    }
    ctx.globalCompositeOperation = "source-over";
  }

  // ------------------------------------------------------------ overlays drawn live
  private drawMarks(ctx: CanvasRenderingContext2D, cam: Camera, mk: Marks) {
    const m = this.map;
    const toScreen = ([x, y]: [number, number]): [number, number] => [(x - cam.x) * cam.zoom, (y - cam.y) * cam.zoom];
    const outline = (x: number, y: number, stroke: string, fill?: string) => {
      const pts = tileCorners(m, x, y).map(toScreen);
      ctx.beginPath();
      pts.forEach((p, k) => (k ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])));
      ctx.closePath();
      if (fill) { ctx.fillStyle = fill; ctx.fill(); }
      ctx.strokeStyle = stroke;
      ctx.lineWidth = 1.5;
      ctx.stroke();
    };
    if (mk.footprint) {
      const f = mk.footprint;
      const corners: [number, number][] = [[f.x, f.y], [f.x + f.size, f.y], [f.x + f.size, f.y + f.size], [f.x, f.y + f.size]];
      const pts = corners.map(([x, y]) => {
        const cx = Math.min(m.width, Math.max(0, x)), cy = Math.min(m.height, Math.max(0, y));
        return toScreen(project(x, y, m.vert[cy * (m.width + 1) + cx]));
      });
      ctx.beginPath();
      pts.forEach((p, k) => (k ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])));
      ctx.closePath();
      ctx.fillStyle = f.ok ? "rgba(90,220,120,0.30)" : "rgba(230,70,60,0.30)";
      ctx.fill();
      ctx.strokeStyle = f.ok ? "#7ef0a0" : "#ff7a6a";
      ctx.lineWidth = 2;
      ctx.stroke();
    }
    if (mk.hover) outline(mk.hover.x, mk.hover.y, "rgba(255,255,255,0.9)");
    if (mk.selected) outline(mk.selected.x, mk.selected.y, "#ffd65a", "rgba(255,214,90,0.15)");
  }

  drawLabels(ctx: CanvasRenderingContext2D, cam: Camera, g: GameState) {
    const m = this.map;
    ctx.textAlign = "center";
    const items: { name: string; x: number; y: number; col: string; min: number }[] = [];
    for (const lm of m.landmarks) {
      const col = lm.kind === "historic_site" ? "#ffcf6e" : lm.kind === "hill" ? "#cfe3a0" : lm.kind.startsWith("structure") ? "#c8d8ff" : "#ffffff";
      const min = lm.kind === "town" ? 0 : lm.kind === "hill" ? 0.1875 : 0.5;
      if (lm.kind === "historic_site" && g.world.year < 1870) continue;
      items.push({ name: lm.name, x: lm.x + 0.5, y: lm.y + 0.5, col, min });
    }
    for (const a of ANCHORS) {
      if (m.landmarks.some((l) => l.name.startsWith(a.name))) continue;
      const [ax, ay] = latLonToTile(m, a.lat, a.lon);
      items.push({ name: a.name, x: ax + 0.5, y: ay + 0.5, col: "#b8d8ff", min: 0.375 });
    }
    for (const inc of g.world.inclines) {
      const mid = inc.path[Math.floor(inc.path.length / 2)];
      items.push({ name: inc.name, x: mid[0] + 1.5, y: mid[1] + 0.5, col: "#ffb0a0", min: 0.5 });
    }
    const seen = new Set<string>();
    for (const sp of m.spans) {
      if (sp.kind !== "road" || seen.has(sp.name) || !stageOf(sp, g.world.year)) continue;
      seen.add(sp.name);
      items.push({ name: sp.name, x: (sp.a[0] + sp.b[0]) / 2, y: (sp.a[1] + sp.b[1]) / 2, col: "#d8c8a8", min: 0.75 });
    }
    for (const it of items) {
      if (cam.zoom < it.min) continue;
      const tx = Math.floor(it.x), ty = Math.floor(it.y);
      const [wx, wy] = project(it.x, it.y, m.elevation[ty * m.width + tx] ?? BASE_M);
      const px = Math.round((wx - cam.x) * cam.zoom), py = Math.round((wy - cam.y) * cam.zoom) - 14;
      if (px < -120 || py < -20 || px > ctx.canvas.width + 120 || py > ctx.canvas.height + 20) continue;
      ctx.font = it.min === 0 ? "bold 13px ui-monospace, monospace" : "bold 11px ui-monospace, monospace";
      ctx.lineWidth = 3;
      ctx.strokeStyle = "rgba(0,0,0,0.85)";
      ctx.strokeText(it.name, px, py);
      ctx.fillStyle = it.col;
      ctx.fillText(it.name, px, py);
    }
  }
}

function riverAxis(m: GameMap, x: number, y: number): "a" | "b" {
  let ax = 0, ay = 0;
  for (let k = -4; k <= 4; k++) {
    if (x + k >= 0 && x + k < m.width && m.terrain[y * m.width + x + k] === Terrain.Water) ax++;
    if (y + k >= 0 && y + k < m.height && m.terrain[(y + k) * m.width + x] === Terrain.Water) ay++;
  }
  return ax >= ay ? "a" : "b";
}

export function stageOf(sp: { stages: { year: number; type: import("../core/map").BridgeType }[] }, year: number) {
  let st: { year: number; type: import("../core/map").BridgeType } | null = null;
  for (const s of sp.stages) if (s.year <= year) st = s;
  return st;
}

function shade6(col: string, k: number): string {
  const n = parseInt(col.slice(1), 16);
  const c = (v: number) => Math.min(255, Math.round(v * k));
  return `rgb(${c((n >> 16) & 255)},${c((n >> 8) & 255)},${c(n & 255)})`;
}
