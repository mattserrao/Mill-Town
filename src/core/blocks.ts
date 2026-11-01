// Block fields: city-wide quantities held at 4×4 tiles (120 m), as Micropolis holds pollution, land value
// and crime at 2×2 to 8×8. Cheaper to update, smoother, and closer to how people perceive a district.
// Per-tile values are read with bilinear sampling so edges stay smooth.

import type { GameMap } from "./map";
import { Terrain } from "./terrain";

export const B = 4;

export interface BlockGrid { bw: number; bh: number; n: number }

const gridCache = new WeakMap<GameMap, BlockGrid>();
export function blockGrid(m: GameMap): BlockGrid {
  let g = gridCache.get(m);
  if (!g) { const bw = Math.ceil(m.width / B), bh = Math.ceil(m.height / B); g = { bw, bh, n: bw * bh }; gridCache.set(m, g); }
  return g;
}

export const blockOf = (g: BlockGrid, x: number, y: number) => ((y / B) | 0) * g.bw + ((x / B) | 0);

/** bilinear sample of a block field at the centre of tile (x, y) */
export function sampleBlock(g: BlockGrid, f: Float32Array, x: number, y: number): number {
  const fx = (x + 0.5) / B - 0.5, fy = (y + 0.5) / B - 0.5;
  const x0 = Math.max(0, Math.min(g.bw - 1, Math.floor(fx))), y0 = Math.max(0, Math.min(g.bh - 1, Math.floor(fy)));
  const x1 = Math.min(g.bw - 1, x0 + 1), y1 = Math.min(g.bh - 1, y0 + 1);
  const tx = Math.max(0, Math.min(1, fx - x0)), ty = Math.max(0, Math.min(1, fy - y0));
  const a = f[y0 * g.bw + x0], b = f[y0 * g.bw + x1], c = f[y1 * g.bw + x0], d = f[y1 * g.bw + x1];
  return (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty;
}

/**
 * One dispersion step with a prevailing westerly: each block keeps 40%, passes 30% north/south
 * and carries more downwind (east) than upwind.
 */
export function disperse(g: BlockGrid, f: Float32Array, out: Float32Array = new Float32Array(g.n)): Float32Array {
  const { bw, bh } = g;
  for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) {
    const i = y * bw + x;
    const w = x > 0 ? f[i - 1] : f[i], e = x < bw - 1 ? f[i + 1] : f[i];
    const n = y > 0 ? f[i - bw] : f[i], s = y < bh - 1 ? f[i + bw] : f[i];
    out[i] = 0.4 * f[i] + 0.15 * (n + s) + 0.2 * w + 0.1 * e;
  }
  return out;
}

interface Statics { elev: Float32Array; trap: Float32Array; ridge: Float32Array; water: Float32Array }
const staticCache = new WeakMap<GameMap, Statics>();

/**
 * Per-block terrain facts: mean elevation; how far a block sits below its surroundings (valley floors
 * trap smoke under autumn and winter inversions, as at Donora in 1948); how far above (ridges clear fast);
 * share of water.
 */
export function blockStatics(m: GameMap): Statics {
  let s = staticCache.get(m);
  if (s) return s;
  const g = blockGrid(m);
  const elev = new Float32Array(g.n), cnt = new Float32Array(g.n), water = new Float32Array(g.n);
  for (let y = 0; y < m.height; y++) for (let x = 0; x < m.width; x++) {
    const b = blockOf(g, x, y), i = y * m.width + x;
    elev[b] += m.elevation[i]; cnt[b]++;
    if (m.terrain[i] === Terrain.Water) water[b]++;
  }
  for (let b = 0; b < g.n; b++) { elev[b] /= cnt[b] || 1; water[b] /= cnt[b] || 1; }
  const trap = new Float32Array(g.n), ridge = new Float32Array(g.n);
  const R = 6; // ~720 m
  for (let y = 0; y < g.bh; y++) for (let x = 0; x < g.bw; x++) {
    let sum = 0, k = 0;
    for (let dy = -R; dy <= R; dy += 2) for (let dx = -R; dx <= R; dx += 2) {
      const xx = x + dx, yy = y + dy;
      if (xx < 0 || yy < 0 || xx >= g.bw || yy >= g.bh) continue;
      sum += elev[yy * g.bw + xx]; k++;
    }
    const d = elev[y * g.bw + x] - sum / k;
    trap[y * g.bw + x] = Math.max(0, Math.min(1, -d / 35));
    ridge[y * g.bw + x] = Math.max(0, Math.min(1, d / 35));
  }
  s = { elev, trap, ridge, water };
  staticCache.set(m, s);
  return s;
}

/** value at the p-th percentile (0..1) of the non-zero entries, for normalising a field for display */
export function percentile(f: Float32Array, p: number): number {
  const v: number[] = [];
  for (let i = 0; i < f.length; i += 3) if (f[i] > 0) v.push(f[i]);
  if (!v.length) return 1;
  v.sort((a, b) => a - b);
  return v[Math.min(v.length - 1, Math.floor(v.length * p))] || 1;
}

/**
 * Bilinear upsample of a block field to tiles, row by row (fast): calls `put(i, value)` for every tile.
 */
export function upsample(m: GameMap, f: Float32Array, put: (i: number, v: number) => void) {
  const out = upsampleTo(m, f);
  for (let i = 0, n = out.length; i < n; i++) put(i, out[i]);
}

let upScratch: Float32Array | null = null;
/**
 * Bilinear upsample of a block field to tiles into a shared scratch array (valid until the next call) —
 * a plain loop over the result is several times quicker than a callback per tile.
 */
export function upsampleTo(m: GameMap, f: Float32Array): Float32Array {
  const g = blockGrid(m), W = m.width, n = W * m.height;
  if (!upScratch || upScratch.length !== n) upScratch = new Float32Array(n);
  const out = upScratch;
  const x0 = new Int32Array(W), x1 = new Int32Array(W), tx = new Float32Array(W);
  for (let x = 0; x < W; x++) {
    const fx = (x + 0.5) / B - 0.5;
    const a = Math.max(0, Math.min(g.bw - 1, Math.floor(fx)));
    x0[x] = a; x1[x] = Math.min(g.bw - 1, a + 1); tx[x] = Math.max(0, Math.min(1, fx - a));
  }
  for (let y = 0; y < m.height; y++) {
    const fy = (y + 0.5) / B - 0.5;
    const y0 = Math.max(0, Math.min(g.bh - 1, Math.floor(fy))), y1 = Math.min(g.bh - 1, y0 + 1);
    const ty = Math.max(0, Math.min(1, fy - y0));
    const r0 = y0 * g.bw, r1 = y1 * g.bw, row = y * W;
    for (let x = 0; x < W; x++) {
      const t = tx[x];
      const top = f[r0 + x0[x]] * (1 - t) + f[r0 + x1[x]] * t;
      const bot = f[r1 + x0[x]] * (1 - t) + f[r1 + x1[x]] * t;
      out[row + x] = top * (1 - ty) + bot * ty;
    }
  }
  return out;
}
