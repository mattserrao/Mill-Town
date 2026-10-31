// Smooth-terrain isometric renderer.
// The map is cut into 16x16-tile chunks. Each chunk is software-rasterized once per zoom level:
// every tile is two lit, textured triangles over its four real corner heights (no steps between
// tiles), followed by its sprites, all painted back-to-front into one pixel buffer.
// Chunks are cached (LRU) and re-rendered progressively when the world changes.

import type { GameState } from "../core/game";
import type { IndustryId } from "../core/industries";
import { type GameMap, Special } from "../core/map";
import { RIVALS } from "../core/rivals";
import { Terrain } from "../core/terrain";
import { STRUCTURES, Street, Use } from "../core/town";
import { type Camera, BASE_M, HH, HW, project, tileCorners, ZPX } from "./iso";
import { buildSprites, scaleSprite, type Part, type Sprite, type SpriteBuf } from "./sprites";

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
const PAD_TOP = 200;        // room for tall sprites (stacks, smoke, spires), zoom-1 px
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
      const sp = this.base.get(key);
      if (!sp) return null;
      b = scaleSprite(sp, s);
      this.scaled.set(k, b);
    }
    return b;
  }

  // ------------------------------------------------------------ frame
  /** Draw the view. Returns true if more chunks still need rendering (call again next frame). */
  draw(ctx: CanvasRenderingContext2D, cam: Camera, g: GameState, view: ViewOptions, marks: Marks): boolean {
    const cw = ctx.canvas.width, ch = ctx.canvas.height;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = "#1b1d22";
    ctx.fillRect(0, 0, cw, ch);
    ctx.imageSmoothingEnabled = false;
    for (const r of g.rivals) {
      const def = RIVALS.find((d) => d.id === r.id);
      if (def) this.rivalIndustry.set(r.ownerId, def.industry);
    }

    const s = Math.min(1, cam.zoom);
    const k = cam.zoom / s; // extra pixel scaling for zoom > 1
    const version = `${g.world.version}|${view.overlayKey}|${view.grid}|${g.company?.lastSeason?.produced ? 1 : 0}`;
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
    if (marks.labels) this.drawLabels(ctx, cam, g);
    this.pending = missing;
    return missing > 0;
  }

  invalidateAll() {
    this.chunks.clear();
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
    const produced = !!g.company?.lastSeason?.produced;

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
          if (o) { tint = rgb(o[0], o[1], o[2]); tintA = o[3]; }
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

        for (const sp of this.tileSprites(g, tx, ty, i, produced)) blit(sp.key, tx + sp.u, ty + sp.v, sp.h ?? 0);
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
      const polluted = Math.min(0.4, w.pollution[i] * 0.3);
      return (u: number, v: number, _h: number, gx: number, gy: number) => {
        let c = pick(WATER, hash(gx >> 2, gy >> 1, 3));
        const r = hash(gx >> 2, gy, 4);
        if (r > 0.97 && (gx & 3) < 3) c = 0x6f9cc0; // ripple
        if (landMask) {
          const dl = edgeDist(landMask, u, v);
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
      case Use.Industry: case Use.Rival: base = (_u, _v, _h, gx, gy) => pick(PAL.yard, hash(gx, gy, 16)); break;
      case Use.Landmark: base = (_u, _v, _h, gx, gy) => pick(PAL.paved, hash(gx >> 1, gy, 17)); break;
      case Use.Wharf: base = (_u, _v, _h, gx, gy) => {
        const sx = Math.floor(gx / 3) + ((Math.floor(gy / 2) & 1) ? 1 : 0);
        if (gx % 3 === 0 || gy % 2 === 0) return 0x5c5850;
        return hash(sx, gy >> 1, 18) < 0.5 ? 0x8e8a80 : 0x7a766e;
      }; break;
      case Use.Rock: base = (_u, _v, h, gx, gy) => {
        const band = Math.floor(h / 2.5);
        const c = PAL.rock[(band + (hash(band, 0, 19) * 3 | 0)) % PAL.rock.length];
        return hash(gx, gy, 20) < 0.08 ? 0x5a5446 : hash(gx >> 1, gy >> 1, 21) < 0.12 ? 0x5e7a3a : c;
      }; break;
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
    const streetMask = w.street[i] ? mask((j) => w.street[j] > 0) : 0;
    const dense = use === Use.Rowhouses || w.street[i] && [at(1, 0), at(-1, 0), at(0, 1), at(0, -1)].some((j) => j >= 0 && w.use[j] === Use.Rowhouses);
    const streetW = w.street[i] === Street.Pike ? 0.17 : dense ? 0.26 : 0.14;
    const rail = railActive(i) ? mask((j) => railActive(j)) : -1;
    const creekMask = m.creek[i] ? mask((j) => m.creek[j] > 0 || m.terrain[j] === Terrain.Water) : -1;
    const waterMask = rawMask((j) => m.terrain[j] === Terrain.Water);
    const wharf = m.special[i] === Special.Wharf;

    return (u: number, v: number, h: number, gx: number, gy: number) => {
      let c = base(u, v, h, gx, gy);
      if (waterMask && !wharf) {
        const dw = edgeDist(waterMask, u, v);
        if (dw < 0.08) c = pick(PAL.wet, hash(gx, gy, 25));
        else if (dw < 0.24 + hash(gx >> 2, gy >> 2, 27) * 0.08) c = pick(PAL.sand, hash(gx, gy, 26));
      }
      if (creekMask >= 0) {
        const [dc] = lineDist(creekMask, u, v);
        if (dc < 0.06) c = hash(gx, gy, 27) < 0.15 ? 0x8cb4d4 : 0x467aa0;
        else if (dc < 0.1) c = 0x5e6a44;
      }
      if (w.street[i]) {
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
        const [dr, along] = lineDist(rail, u, v);
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

  // ------------------------------------------------------------ sprites per tile
  private tileSprites(g: GameState, x: number, y: number, i: number, produced: boolean): { key: string; u: number; v: number; h?: number }[] {
    const m = this.map, w = g.world, W = m.width;
    const out: { key: string; u: number; v: number; h?: number }[] = [];
    const n = (c: number) => hash(x, y, c + (w.seed & 0xff));
    const use = w.use[i];
    const t = m.terrain[i];
    const streetAt = (dx: number, dy: number) => {
      const nx = x + dx, ny = y + dy;
      return nx >= 0 && ny >= 0 && nx < W && ny < m.height && w.street[ny * W + nx] > 0;
    };
    // street along x-direction neighbours -> buildings in a row along u ("a"), else along v ("b")
    const orient = (): "a" | "b" => (streetAt(0, 1) || streetAt(0, -1) ? "a" : streetAt(1, 0) || streetAt(-1, 0) ? "b" : n(1) < 0.5 ? "a" : "b");

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
      case Use.Cottage:
        if (w.pop[i] >= 4 && n(10) < 0.35 && !w.street[i]) out.push({ key: `farm:${Math.floor(n(11) * 2)}`, u: 0.5, v: 0.5 });
        else out.push({ key: `cabin:${Math.floor(n(12) * 3)}`, u: 0.5, v: 0.5 });
        if (n(13) < 0.4) out.push({ key: `tree:maple${Math.floor(n(14) * 3)}`, u: 0.8, v: 0.25 });
        break;
      case Use.Houses:
        out.push({ key: `house:${orient()}${Math.floor(n(15) * 4)}`, u: 0.5, v: 0.5 });
        break;
      case Use.Rowhouses:
        out.push({ key: `row:${orient()}${Math.floor(n(16) * 4)}`, u: 0.5, v: 0.5 });
        break;
      case Use.Civic:
        out.push({ key: `church:${Math.floor(n(17) * 2)}`, u: 0.5, v: 0.5 });
        break;
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
        let ox = x, oy = y, fp = 8, ind: IndustryId = "steel", owner: "p" | "r" = "p";
        if (use === Use.Industry && g.company) { ox = g.company.x; oy = g.company.y; fp = g.company.footprint; ind = g.company.industry; }
        else {
          const r = g.rivals.find((r) => r.ownerId === w.owner[i]);
          if (r) { ox = r.x; oy = r.y; fp = r.footprint; ind = this.rivalIndustry.get(r.ownerId) ?? "steel"; owner = "r"; }
        }
        const part = industryLayout(ind, x - ox, y - oy, fp);
        if (part !== "yard") out.push({ key: `ind:${owner}:${part}`, u: 0.5, v: 0.5 });
        if (part === "stack" && (owner === "r" || produced)) out.push({ key: `smoke:${(x + y) & 1}`, u: 0.5, v: 0.5 });
        break;
      }
    }

    if (t === Terrain.Water) {
      // bridges
      if (w.street[i] === Street.Bridge) out.push({ key: `bridge:road:${this.bridgeAxis.get(m.bridge[i]) ?? "a"}`, u: 0.5, v: 0.5 });
      else if (m.rail[i] && (m.railLines[String(m.rail[i])]?.year ?? 9999) <= w.year) {
        const ax = (m.rail[i - 1] || m.rail[i + 1]) ? "a" : "b";
        out.push({ key: `bridge:rail:${ax}`, u: 0.5, v: 0.5 });
      } else if ((x + 2 * y) % 5 === 0) {
        // river traffic: steamboats at the wharves, coal barges on the Mon
        let nearWharf = false;
        for (let dy = -2; dy <= 2 && !nearWharf; dy++) for (let dx = -2; dx <= 2; dx++) {
          const nx = x + dx, ny = y + dy;
          if (nx >= 0 && ny >= 0 && nx < W && ny < m.height && m.special[ny * W + nx] === Special.Wharf) { nearWharf = true; break; }
        }
        const axis = riverAxis(m, x, y);
        if (nearWharf && n(20) < 0.3) out.push({ key: `boat:steam:${axis}`, u: 0.5, v: 0.5 });
        else if (n(21) < 0.006) out.push({ key: `boat:barge:${axis}`, u: 0.5, v: 0.5 });
      }
    }
    if (out.length > 1) out.sort((a, b) => a.u + a.v - (b.u + b.v));
    return out;
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

  private drawLabels(ctx: CanvasRenderingContext2D, cam: Camera, g: GameState) {
    const m = this.map;
    ctx.textAlign = "center";
    const items: { name: string; x: number; y: number; col: string; min: number }[] = [];
    for (const lm of m.landmarks) {
      const col = lm.kind === "historic_site" ? "#ffcf6e" : lm.kind === "hill" ? "#cfe3a0" : lm.kind.startsWith("structure") ? "#c8d8ff" : "#ffffff";
      const min = lm.kind === "town" ? 0 : lm.kind === "hill" ? 0.1875 : 0.5;
      if (lm.kind === "historic_site" && g.world.year < 1870) continue;
      items.push({ name: lm.name, x: lm.x + 0.5, y: lm.y + 0.5, col, min });
    }
    for (const b of Object.values(m.bridges)) {
      if (b.year > g.world.year) continue;
      let sx = 0, sy = 0, c = 0;
      for (let i = 0; i < m.bridge.length; i++) if (m.bridge[i] === b.id && m.terrain[i] === Terrain.Water) { sx += i % m.width; sy += (i / m.width) | 0; c++; }
      if (c) items.push({ name: b.name, x: sx / c + 0.5, y: sy / c + 0.5, col: "#d8c8a8", min: 0.75 });
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

/** Which building part goes on tile (lx, ly) of an industry's footprint. */
export function industryLayout(ind: IndustryId, lx: number, ly: number, fp: number): Part {
  const edge = lx === 0 || ly === 0 || lx === fp - 1 || ly === fp - 1;
  switch (ind) {
    case "steel":
      if (lx === 1 && ly === 1) return "stack";
      if (edge) return (lx + ly) % 4 === 0 ? "orepile" : (lx + ly) % 4 === 2 ? "coalpile" : "yard";
      if (lx === 2) return ly % 3 === 1 ? "furnace" : ly % 3 === 2 ? "stoves" : "shed_b";
      if (lx === fp - 3 && ly === fp - 3) return "stack";
      return ly % 2 ? "mill_a" : "shed_a";
    case "glass":
      if (lx === 1 && ly === 1) return "stack";
      if (edge) return (lx * 3 + ly) % 5 === 0 ? "orepile" : "yard";
      return lx % 2 === 1 && ly % 2 === 1 ? "cone" : "shed_b";
    case "power":
      if (lx === 1 && ly === 1) return "stack";
      if (edge) return (lx + ly) % 3 === 0 ? "coalpile" : "yard";
      return (lx + ly) % 2 === 0 ? "gasholder" : "retort";
    case "metalworks":
      if (lx === 1 && ly === 1) return "stack";
      if (edge) return (lx + ly) % 3 === 0 ? "lumber" : "yard";
      return lx >= fp - 3 ? (ly % 2 ? "slip_a" : "slip_b") : ly % 2 ? "shed_a" : "mill_b";
  }
}
