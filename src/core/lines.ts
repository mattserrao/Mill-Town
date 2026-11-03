// Vector creeks and rail lines, indexed by tile, so the renderer can draw them as smooth lines
// (the raster layers step tile by tile on the diagonal) and trains can ride the drawn track.

import type { GameMap } from "./map";
import { cellAt, groundOf, stepDist } from "./hex";

export interface Seg {
  kind: "creek" | "rail";
  /** rail line id (opening year in map.railLines) */
  line: number;
  ax: number; ay: number; bx: number; by: number;
  /** distance along the polyline at a (neighbour steps), for tie spacing */
  s0: number;
}

const cache = new WeakMap<GameMap, Map<number, Seg[]>>();

/** segments passing within `pad` tiles of each tile */
export function lineIndex(m: GameMap, pad = 0.3): Map<number, Seg[]> {
  const hit = cache.get(m);
  if (hit) return hit;
  const idx = new Map<number, Seg[]>();
  const add = (kind: Seg["kind"], line: number, pts: number[]) => {
    let s = 0;
    for (let k = 0; k + 3 < pts.length; k += 2) {
      const seg: Seg = { kind, line, ax: pts[k], ay: pts[k + 1], bx: pts[k + 2], by: pts[k + 3], s0: s };
      s += stepDist(seg.bx - seg.ax, seg.by - seg.ay);
      // axial boxes are sheared on the ground, so reach a step further than the pad
      const x0 = Math.floor(Math.min(seg.ax, seg.bx) - pad - 1), x1 = Math.floor(Math.max(seg.ax, seg.bx) + pad + 1);
      const y0 = Math.floor(Math.min(seg.ay, seg.by) - pad - 1), y1 = Math.floor(Math.max(seg.ay, seg.by) + pad + 1);
      for (let y = Math.max(0, y0); y <= Math.min(m.height - 1, y1); y++)
        for (let x = Math.max(0, x0); x <= Math.min(m.width - 1, x1); x++) {
          if (segDist(seg, x + 0.5, y + 0.5)[0] > 0.58 + pad) continue; // a cell reaches 0.58 steps (its circumradius)
          const i = y * m.width + x;
          const l = idx.get(i);
          if (l) l.push(seg); else idx.set(i, [seg]);
        }
    }
  };
  for (const pts of m.lines.creek) add("creek", 0, pts);
  for (const r of m.lines.rail) add("rail", r.line, r.pts);
  cache.set(m, idx);
  return idx;
}

/**
 * [distance, distance along the polyline, closest x, closest y] from (px, py) to a segment. Positions are
 * axial-continuous; the distances are measured on the ground, in neighbour steps (1 = centre to centre).
 */
export function segDist(s: Seg, px: number, py: number): [number, number, number, number] {
  const [ax, ay] = groundOf(s.ax, s.ay), [bx, by] = groundOf(s.bx, s.by), [qx, qy] = groundOf(px, py);
  const dx = bx - ax, dy = by - ay;
  const L2 = dx * dx + dy * dy || 1e-9;
  const t = Math.max(0, Math.min(1, ((qx - ax) * dx + (qy - ay) * dy) / L2));
  return [Math.hypot(qx - (ax + dx * t), qy - (ay + dy * t)), s.s0 + t * Math.sqrt(L2), s.ax + (s.bx - s.ax) * t, s.ay + (s.by - s.ay) * t];
}

/** the nearest point on an open rail line to (px, py), if one passes within `maxD` tiles */
export function snapToRail(m: GameMap, px: number, py: number, year: number, maxD = 0.9): [number, number] | null {
  const [cx0, cy0] = cellAt(px, py);
  const segs = lineIndex(m).get(cy0 * m.width + cx0);
  if (!segs) return null;
  let best = maxD, out: [number, number] | null = null;
  for (const s of segs) {
    if (s.kind !== "rail" || (m.railLines[String(s.line)]?.year ?? 9999) > year) continue;
    const [d, , cx, cy] = segDist(s, px, py);
    if (d < best) { best = d; out = [cx, cy]; }
  }
  return out;
}
