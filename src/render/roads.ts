// v0.32: roads drawn as smooth lines across many tiles. The street layer is a tile graph, so a road that climbs a
// hill on a contour or a switchback (or just runs on the diagonal) is a staircase of single-tile steps, and the old
// tile-by-tile drawing showed it as a zig-zag. Here the street tiles are traced into polylines between junctions and
// dead ends, and each polyline is smoothed (Chaikin's corner cutting, its ends pinned to the junction centres), so a
// staircase becomes a straight diagonal and a switchback a rounded hairpin. The ground shader and the street traffic
// both read these lines. Straight runs and junctions are unchanged.

import type { GameMap } from "../core/map";
import { Street, type World } from "../core/town";

export interface RoadSeg { ax: number; ay: number; bx: number; by: number; s0: number }

interface RoadIndex { key: number; idx: Map<number, RoadSeg[]> }
let cache: RoadIndex | null = null;
let cacheMap: GameMap | null = null;

/** street tiles that are drawn as smooth lines (bridges are drawn by the bridge code; alleys stay on the lot lines) */
const traced = (s: number) => s > 0 && s !== Street.Bridge && s !== Street.Alley;

/** a cheap fingerprint of the street layer (the index is rebuilt only when it changes) */
function streetKey(w: World): number {
  let h = 0x811c9dc5 | 0;
  const s = w.street;
  for (let i = 0; i < s.length; i++) if (s[i]) h = Math.imul(h ^ (i * 8 + s[i]), 0x01000193);
  return h;
}

const DIR8: [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];

/** the smoothed road lines, indexed by every tile they pass within ~0.4 tiles of */
export function roadIndex(m: GameMap, w: World): Map<number, RoadSeg[]> {
  const key = streetKey(w);
  if (cache && cacheMap === m && cache.key === key) return cache.idx;
  const W = m.width, H = m.height;
  const on = (x: number, y: number) => x >= 0 && y >= 0 && x < W && y < H && traced(w.street[y * W + x]);
  // links: orthogonal neighbours; a diagonal only where neither orthogonal step between them is street
  const links = (x: number, y: number): number[] => {
    const out: number[] = [];
    for (const [dx, dy] of DIR8) {
      if (!on(x + dx, y + dy)) continue;
      if (dx && dy && (on(x + dx, y) || on(x, y + dy))) continue;
      out.push((y + dy) * W + x + dx);
    }
    return out;
  };
  const deg = new Map<number, number[]>();
  for (let i = 0; i < w.street.length; i++) if (traced(w.street[i])) deg.set(i, links(i % W, (i / W) | 0));
  const done = new Set<string>();
  const ek = (a: number, b: number) => (a < b ? `${a}:${b}` : `${b}:${a}`);
  const lines: number[][] = [];
  const walk = (start: number, next: number) => {
    const pts = [start, next];
    done.add(ek(start, next));
    let prev = start, cur = next;
    while ((deg.get(cur)?.length ?? 0) === 2) {
      const nb = deg.get(cur)!;
      const nx = nb[0] === prev ? nb[1] : nb[0];
      if (done.has(ek(cur, nx))) break;
      done.add(ek(cur, nx));
      pts.push(nx);
      prev = cur; cur = nx;
    }
    lines.push(pts);
  };
  for (const [i, nb] of deg) if (nb.length !== 2) for (const j of nb) if (!done.has(ek(i, j))) walk(i, j);
  for (const [i, nb] of deg) for (const j of nb) if (!done.has(ek(i, j))) walk(i, j); // loops
  for (const [i, nb] of deg) if (!nb.length) lines.push([i]); // a lone street tile

  const idx = new Map<number, RoadSeg[]>();
  const pad = 0.45;
  for (const L of lines) {
    let pts: [number, number][] = L.map((i) => [(i % W) + 0.5, ((i / W) | 0) + 0.5]);
    if (pts.length >= 3) pts = chaikin(chaikin(chaikin(pts)));
    if (pts.length === 1) pts.push([pts[0][0], pts[0][1]]);
    let s = 0;
    for (let k = 0; k + 1 < pts.length; k++) {
      const [ax, ay] = pts[k], [bx, by] = pts[k + 1];
      const seg: RoadSeg = { ax, ay, bx, by, s0: s };
      s += Math.hypot(bx - ax, by - ay);
      const x0 = Math.max(0, Math.floor(Math.min(ax, bx) - pad)), x1 = Math.min(W - 1, Math.floor(Math.max(ax, bx) + pad));
      const y0 = Math.max(0, Math.floor(Math.min(ay, by) - pad)), y1 = Math.min(H - 1, Math.floor(Math.max(ay, by) + pad));
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
        if (roadDist(seg, x + 0.5, y + 0.5)[0] > 0.71 + pad) continue;
        const i = y * W + x;
        const l = idx.get(i);
        if (l) l.push(seg); else idx.set(i, [seg]);
      }
    }
  }
  cache = { key, idx };
  cacheMap = m;
  return idx;
}

/** Chaikin corner cutting, ends pinned (a junction or dead end stays at its tile centre) */
function chaikin(p: [number, number][]): [number, number][] {
  const out: [number, number][] = [p[0]];
  for (let k = 0; k + 1 < p.length; k++) {
    const [ax, ay] = p[k], [bx, by] = p[k + 1];
    if (k > 0) out.push([ax * 0.75 + bx * 0.25, ay * 0.75 + by * 0.25]);
    if (k + 2 < p.length) out.push([ax * 0.25 + bx * 0.75, ay * 0.25 + by * 0.75]);
  }
  out.push(p[p.length - 1]);
  return out;
}

/** [distance, distance along, closest x, closest y] */
export function roadDist(s: RoadSeg, px: number, py: number): [number, number, number, number] {
  const dx = s.bx - s.ax, dy = s.by - s.ay;
  const L2 = dx * dx + dy * dy || 1e-9;
  const t = Math.max(0, Math.min(1, ((px - s.ax) * dx + (py - s.ay) * dy) / L2));
  const cx = s.ax + dx * t, cy = s.ay + dy * t;
  return [Math.hypot(px - cx, py - cy), s.s0 + t * Math.sqrt(L2), cx, cy];
}

/** the nearest point on a drawn road to (px, py) within `maxD`, with the road's direction there */
export function snapToRoad(m: GameMap, w: World, px: number, py: number, maxD = 0.6): [number, number, number, number] | null {
  const xi = Math.floor(px), yi = Math.floor(py);
  if (xi < 0 || yi < 0 || xi >= m.width || yi >= m.height) return null;
  const segs = roadIndex(m, w).get(yi * m.width + xi);
  if (!segs) return null;
  let best = maxD, out: [number, number, number, number] | null = null;
  for (const s of segs) {
    const [d, , cx, cy] = roadDist(s, px, py);
    if (d < best) {
      best = d;
      const l = Math.hypot(s.bx - s.ax, s.by - s.ay) || 1;
      out = [cx, cy, (s.bx - s.ax) / l, (s.by - s.ay) / l];
    }
  }
  return out;
}
