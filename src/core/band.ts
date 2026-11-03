// The simulated band (v0.23). Only the land along the rivers — where the mills, the mill towns and the hillside
// neighbourhoods are — is simulated each season. The ridge-top countryside beyond it is still drawn (terrain,
// farms, the odd early village) but nothing there grows or ticks. The band is ~half the map, so every
// whole-map pass (growth, land value, smoke, streets, the commute) does about half the work.
//
// The band is the land within D tiles of the three rivers, plus the East End (East Liberty, Shadyside, Homewood,
// Wilkinsburg, the East End parks) and the South Hills streetcar suburbs, rounded off by a morphological closing so its edge follows the valleys in
// smooth curves rather than circles. D (BAND_DIST) is set so the band covers BAND_SHARE of the map.

import { B, blockGrid } from "./blocks";
import type { GameMap } from "./map";
import { latLonToTile } from "./features";
import { stepDist, HEX6 } from "./hex";

/** share of the map that is simulated (target) */
export const BAND_SHARE = 0.5;
/** river distance (tiles) that gives BAND_SHARE with the anchors below — found by bisection (tests/band.test.ts) */
export const BAND_DIST = 67;
/** the edge fades over this many tiles: growth thins out toward it so the town doesn't stop at a line */
export const BAND_FADE = 10;
/** river water codes (map waterNames 13–16: Allegheny, Youghiogheny, Monongahela, Ohio) */
const RIVER_MIN = 13;

/** places inland from the rivers that must stay live: [name, lat, lon, radius m] */
export const BAND_ANCHORS: [string, number, number, number][] = [
  ["East Liberty", 40.4615, -79.9250, 1300],
  ["Shadyside", 40.4540, -79.9350, 1000],
  ["Homewood", 40.4555, -79.8990, 1100],
  ["Wilkinsburg", 40.4415, -79.8820, 1100],
  ["Highland Park", 40.4740, -79.9150, 800],
  ["Frick Park", 40.4330, -79.9060, 900],
  ["Squirrel Hill", 40.4380, -79.9230, 1200],
  // the South Hills streetcar suburbs (Beltzhoover, Beechview, Brookline, Dormont)
  ["Beechview", 40.4150, -80.0100, 1500],
  ["Dormont", 40.4000, -80.0350, 1400],
  // the Allegheny's north bank hilltops (Riverview Park, the Observatory) and the north-east stand-in sites
  ["Riverview Park", 40.4710, -80.0150, 800],
  ["New Kensington", 40.4750, -79.9300, 700],
  // rival sites set back from the rivers (Westinghouse Research at Forest Hills, Astronuclear at Large)
  ["Forest Hills", 40.4200, -79.8500, 700],
  ["Large", 40.2960, -79.9350, 600],
];

export interface SimBand {
  /** 1 inside the band, per tile */
  mask: Uint8Array;
  /** 0..1 per tile: 1 well inside, fading to 0 over the last BAND_FADE tiles */
  weight: Float32Array;
  /** row runs inside the band: [y, x0, x1) triplets, row-major */
  spans: Int32Array;
  /** 1 for blocks (4×4) with any band tile in them */
  blocks: Uint8Array;
  /** per row: the band's extent widened by 4 tiles, [rowLo, rowHi) (empty rows: 0, 0) */
  rowLo: Int32Array;
  rowHi: Int32Array;
  /** block-row runs: [by, bx0, bx1) triplets */
  blockSpans: Int32Array;
  /** tiles inside */
  tiles: number;
  share: number;
  /** river distance used */
  dist: number;
}

const cache = new WeakMap<GameMap, SimBand>();

/** The simulated band for a map (computed once, deterministic). */
export function simBand(m: GameMap): SimBand {
  let b = cache.get(m);
  if (!b) { b = buildBand(m, BAND_DIST); cache.set(m, b); }
  return b;
}

/** is tile (x, y) simulated? */
export function inBand(m: GameMap, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < m.width && y < m.height && simBand(m).mask[y * m.width + x] === 1;
}

/**
 * Two-pass distance (in neighbour steps) from every cell where `src` is set, over the six hex neighbours.
 * Exact hex distance across open ground, which is all a band edge needs.
 */
export function chamfer(W: number, H: number, src: (i: number) => boolean): Float32Array {
  const d = new Float32Array(W * H);
  const INF = 1e9;
  for (let i = 0; i < d.length; i++) d[i] = src(i) ? 0 : INF;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x;
    let v = d[i];
    if (!v) continue;
    if (x > 0) v = Math.min(v, d[i - 1] + 1);
    if (y > 0) {
      v = Math.min(v, d[i - W] + 1);
      if (x < W - 1) v = Math.min(v, d[i - W + 1] + 1);
    }
    d[i] = v;
  }
  for (let y = H - 1; y >= 0; y--) for (let x = W - 1; x >= 0; x--) {
    const i = y * W + x;
    let v = d[i];
    if (!v) continue;
    if (x < W - 1) v = Math.min(v, d[i + 1] + 1);
    if (y < H - 1) {
      v = Math.min(v, d[i + W] + 1);
      if (x > 0) v = Math.min(v, d[i + W - 1] + 1);
    }
    d[i] = v;
  }
  return d;
}

/** the big river system: the largest 8-connected body of river water (drops ponds coded as river) */
function mainRiver(m: GameMap): Uint8Array {
  const W = m.width, H = m.height, n = W * H;
  const lab = new Int32Array(n), out = new Uint8Array(n);
  let best = 0, bestSize = 0, next = 0;
  const stack: number[] = [];
  for (let s = 0; s < n; s++) {
    if (lab[s] || m.water[s] < RIVER_MIN) continue;
    const id = ++next;
    let size = 0;
    lab[s] = id; stack.push(s);
    while (stack.length) {
      const i = stack.pop()!, x = i % W, y = (i / W) | 0;
      size++;
      for (const [dx, dy] of HEX6) {
        const xx = x + dx, yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
        const j = yy * W + xx;
        if (!lab[j] && m.water[j] >= RIVER_MIN) { lab[j] = id; stack.push(j); }
      }
    }
    if (size > bestSize) { bestSize = size; best = id; }
  }
  for (let i = 0; i < n; i++) if (lab[i] === best) out[i] = 1;
  return out;
}

/** the band for river distance D (not cached; simBand is the one the game uses) */
export function buildBand(m: GameMap, D: number): SimBand {
  const W = m.width, H = m.height, n = W * H;
  const river = mainRiver(m);
  const dRiver = chamfer(W, H, (i) => river[i] === 1);
  // the anchors: distance to the nearest anchor disc's edge (≤ 0 inside one)
  const dAnchor = new Float32Array(n).fill(1e9);
  const tpm = 1 / m.metersPerTile;
  for (const [, lat, lon, rM] of BAND_ANCHORS) {
    const [ax, ay] = latLonToTile(m, lat, lon), r = rM * tpm, R = r + 200;
    const RB = R * 1.6; // a disc of radius R steps spans up to ~1.58 R in axial rows
    for (let y = Math.max(0, Math.floor(ay - RB)); y <= Math.min(H - 1, Math.ceil(ay + RB)); y++)
      for (let x = Math.max(0, Math.floor(ax - RB)); x <= Math.min(W - 1, Math.ceil(ax + RB)); x++) {
        const i = y * W + x, d = stepDist(x - ax, y - ay) - r;
        if (d < dAnchor[i]) dAnchor[i] = d;
      }
  }
  // closing radius: fills the gaps between the anchor discs and the river band so the edge reads as one shape
  const CLOSE = 18;
  const mask = new Uint8Array(n);
  let nValid = 0;
  for (let i = 0; i < n; i++) nValid += m.valid[i];
  const build = (D: number) => {
    // dilate (union of the river band and anchors grown by CLOSE), then erode back by CLOSE
    const grown = chamfer(W, H, (i) => dRiver[i] <= D || dAnchor[i] <= 0);
    const outside = chamfer(W, H, (i) => m.valid[i] === 1 && grown[i] > CLOSE);
    let c = 0;
    for (let i = 0; i < n; i++) { const v = m.valid[i] && (outside[i] > CLOSE || dRiver[i] <= D || dAnchor[i] <= 0) ? 1 : 0; mask[i] = v; c += v; }
    return c / nValid;
  };
  const share = build(D);

  // edge fade
  const toOut = chamfer(W, H, (i) => m.valid[i] === 1 && !mask[i]);
  const weight = new Float32Array(n);
  let tiles = 0;
  for (let i = 0; i < n; i++) if (mask[i]) { tiles++; weight[i] = Math.min(1, toOut[i] / BAND_FADE); }

  // runs
  const sp: number[] = [];
  for (let y = 0; y < H; y++) {
    let x = 0;
    while (x < W) {
      while (x < W && !mask[y * W + x]) x++;
      if (x >= W) break;
      const x0 = x;
      while (x < W && mask[y * W + x]) x++;
      sp.push(y, x0, x);
    }
  }
  const rowLo = new Int32Array(H), rowHi = new Int32Array(H);
  for (let y = 0; y < H; y++) { rowLo[y] = W; rowHi[y] = 0; }
  for (let s = 0; s < sp.length; s += 3) { const y = sp[s]; rowLo[y] = Math.min(rowLo[y], Math.max(0, sp[s + 1] - 4)); rowHi[y] = Math.max(rowHi[y], Math.min(W, sp[s + 2] + 4)); }
  for (let y = 0; y < H; y++) if (rowHi[y] <= rowLo[y]) { rowLo[y] = 0; rowHi[y] = 0; }
  const g = blockGrid(m), blocks = new Uint8Array(g.n);
  for (let s = 0; s < sp.length; s += 3) {
    const by = (sp[s] / B) | 0;
    for (let bx = (sp[s + 1] / B) | 0, be = ((sp[s + 2] - 1) / B) | 0; bx <= be; bx++) blocks[by * g.bw + bx] = 1;
  }
  const bsp: number[] = [];
  for (let by = 0; by < g.bh; by++) {
    let bx = 0;
    while (bx < g.bw) {
      while (bx < g.bw && !blocks[by * g.bw + bx]) bx++;
      if (bx >= g.bw) break;
      const b0 = bx;
      while (bx < g.bw && blocks[by * g.bw + bx]) bx++;
      bsp.push(by, b0, bx);
    }
  }
  return { mask, weight, spans: Int32Array.from(sp), rowLo, rowHi, blocks, blockSpans: Int32Array.from(bsp), tiles, share, dist: D };
}
