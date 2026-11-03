// Smooth shorelines.
//
// The map's water is a raster: a tile is river or it isn't, so a bank running at any angle but 0°, 45° or 90° comes
// out as a staircase of square tiles. This turns that raster into a smooth "wetness" field (1 = open water,
// 0 = dry land) that the renderer reads per pixel: the shoreline is the field's 0.5 contour, a curve that runs
// straight through the corners of the staircase and across as many tiles as the bank needs.
//
// The field is the water mask blurred over a couple of tiles, then pinned at every tile centre (water centres stay
// wet, land centres stay dry), so the simulation's tiles and the drawing never disagree about what a tile is: only
// the bank between two tile centres moves. `shoreLines` traces the same contour into polylines, the "drawn line"
// a map editor or the hydrography could supply instead.

import { Terrain } from "./terrain";
import type { GameMap } from "./map";

/** blur radius (tiles, one standard deviation): wide enough to straighten a 2:1 staircase, small enough to keep coves */
const SIGMA = 1.15;
/** how far each tile centre is pinned past the 0.5 line */
const PIN = 0.14;

export interface ShoreField {
  w: number;
  h: number;
  /** wetness at tile centres, row-major */
  f: Float32Array;
}

const cache = new WeakMap<GameMap, ShoreField>();

export function shoreField(m: GameMap): ShoreField {
  const hit = cache.get(m);
  if (hit) return hit;
  const W = m.width, H = m.height;
  const R = Math.ceil(SIGMA * 2.6);
  const k: number[] = [];
  let ks = 0;
  for (let d = -R; d <= R; d++) { const v = Math.exp(-(d * d) / (2 * SIGMA * SIGMA)); k.push(v); ks += v; }
  for (let d = 0; d < k.length; d++) k[d] /= ks;
  const src = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) src[i] = m.terrain[i] === Terrain.Water ? 1 : 0;
  // separable blur, clamping at the map edge (the river runs off it rather than ending)
  const tmp = new Float32Array(W * H), f = new Float32Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let s = 0;
    for (let d = -R; d <= R; d++) s += k[d + R] * src[y * W + Math.max(0, Math.min(W - 1, x + d))];
    tmp[y * W + x] = s;
  }
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let s = 0;
    for (let d = -R; d <= R; d++) s += k[d + R] * tmp[Math.max(0, Math.min(H - 1, y + d)) * W + x];
    f[y * W + x] = src[y * W + x] ? Math.max(s, 0.5 + PIN) : Math.min(s, 0.5 - PIN);
  }
  const out = { w: W, h: H, f };
  cache.set(m, out);
  return out;
}

/**
 * Wetness at a fractional tile position (tile (x, y) spans x..x+1), and its gradient (per tile), from a smooth
 * (Catmull-Rom) interpolation of the tile-centre field, so the 0.5 contour has no kinks at the tile seams.
 * `out` is [value, d/dx, d/dy].
 */
export function wetAt(s: ShoreField, fx: number, fy: number, out: [number, number, number]): [number, number, number] {
  const gx = fx - 0.5, gy = fy - 0.5;
  const x0 = Math.floor(gx), y0 = Math.floor(gy);
  const tx = gx - x0, ty = gy - y0;
  const W = s.w, H = s.h, f = s.f;
  // Catmull-Rom weights and their derivatives
  const wx = cr(tx), wy = cr(ty), dx = crd(tx), dy = crd(ty);
  let v = 0, vx = 0, vy = 0;
  for (let j = 0; j < 4; j++) {
    const yy = Math.max(0, Math.min(H - 1, y0 - 1 + j));
    let row = 0, rowd = 0;
    for (let i = 0; i < 4; i++) {
      const c = f[yy * W + Math.max(0, Math.min(W - 1, x0 - 1 + i))];
      row += wx[i] * c; rowd += dx[i] * c;
    }
    v += wy[j] * row; vx += wy[j] * rowd; vy += dy[j] * row;
  }
  out[0] = v; out[1] = vx; out[2] = vy;
  return out;
}

function cr(t: number): [number, number, number, number] {
  const t2 = t * t, t3 = t2 * t;
  return [(-t3 + 2 * t2 - t) / 2, (3 * t3 - 5 * t2 + 2) / 2, (-3 * t3 + 4 * t2 + t) / 2, (t3 - t2) / 2];
}
function crd(t: number): [number, number, number, number] {
  const t2 = t * t;
  return [(-3 * t2 + 4 * t - 1) / 2, (9 * t2 - 10 * t) / 2, (-9 * t2 + 8 * t + 1) / 2, (3 * t2 - 2 * t) / 2];
}

/** signed distance (tiles) to the shoreline from a wetness sample: + in the water, − on land (first-order) */
export function shoreDist(w: [number, number, number]): number {
  const g = Math.hypot(w[1], w[2]);
  return g < 1e-4 ? (w[0] > 0.5 ? 9 : -9) : (w[0] - 0.5) / g;
}

/**
 * The shoreline as polylines in tile coordinates (marching squares over the tile-centre field, at sub-tile steps),
 * for overlays, the minimap and tests. Long rivers come back as a few long lines crossing hundreds of tiles.
 */
export function shoreLines(m: GameMap, step = 0.5): number[][] {
  const s = shoreField(m);
  const nx = Math.floor((m.width - 1) / step), ny = Math.floor((m.height - 1) / step);
  const tmp: [number, number, number] = [0, 0, 0];
  const val = new Float32Array((nx + 1) * (ny + 1));
  for (let j = 0; j <= ny; j++) for (let i = 0; i <= nx; i++) val[j * (nx + 1) + i] = wetAt(s, 0.5 + i * step, 0.5 + j * step, tmp)[0] - 0.5;
  // edges keyed by grid-edge id → point; link segments cell by cell
  const pt = (i0: number, j0: number, i1: number, j1: number): [number, number] => {
    const a = val[j0 * (nx + 1) + i0], b = val[j1 * (nx + 1) + i1];
    const t = a / (a - b);
    return [0.5 + (i0 + (i1 - i0) * t) * step, 0.5 + (j0 + (j1 - j0) * t) * step];
  };
  const segs: [string, string, [number, number], [number, number]][] = [];
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const a = val[j * (nx + 1) + i] > 0, b = val[j * (nx + 1) + i + 1] > 0, c = val[(j + 1) * (nx + 1) + i + 1] > 0, d = val[(j + 1) * (nx + 1) + i] > 0;
    const cut: [string, [number, number]][] = [];
    if (a !== b) cut.push([`h${i},${j}`, pt(i, j, i + 1, j)]);
    if (b !== c) cut.push([`v${i + 1},${j}`, pt(i + 1, j, i + 1, j + 1)]);
    if (d !== c) cut.push([`h${i},${j + 1}`, pt(i, j + 1, i + 1, j + 1)]);
    if (a !== d) cut.push([`v${i},${j}`, pt(i, j, i, j + 1)]);
    if (cut.length === 2) segs.push([cut[0][0], cut[1][0], cut[0][1], cut[1][1]]);
    else if (cut.length === 4) { segs.push([cut[0][0], cut[1][0], cut[0][1], cut[1][1]]); segs.push([cut[2][0], cut[3][0], cut[2][1], cut[3][1]]); }
  }
  const at = new Map<string, number[]>();
  segs.forEach((sg, k) => { for (const e of [sg[0], sg[1]]) { const l = at.get(e); if (l) l.push(k); else at.set(e, [k]); } });
  const used = new Uint8Array(segs.length);
  const lines: number[][] = [];
  for (let k0 = 0; k0 < segs.length; k0++) {
    if (used[k0]) continue;
    used[k0] = 1;
    const chain: [number, number][] = [segs[k0][2], segs[k0][3]];
    // grow forward from end 1, then backward from end 0
    for (const dir of [1, 0] as const) {
      let key: string = segs[k0][dir];
      for (;;) {
        const nxt = (at.get(key) ?? []).find((k) => !used[k]);
        if (nxt === undefined) break;
        used[nxt] = 1;
        const sg = segs[nxt];
        const far = sg[0] === key;
        const p = far ? sg[3] : sg[2];
        if (dir === 1) chain.push(p); else chain.unshift(p);
        key = far ? sg[1] : sg[0];
      }
    }
    lines.push(chain.flat());
  }
  return lines;
}
