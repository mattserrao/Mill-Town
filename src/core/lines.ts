// Vector creeks and rail lines, indexed by tile, so the renderer can draw them as smooth lines
// (the raster layers step tile by tile on the diagonal) and trains can ride the drawn track.

import type { GameMap } from "./map";

export interface Seg {
  kind: "creek" | "rail";
  /** rail line id (opening year in map.railLines) */
  line: number;
  ax: number; ay: number; bx: number; by: number;
  /** distance along the polyline at a (tiles), for tie spacing */
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
      s += Math.hypot(seg.bx - seg.ax, seg.by - seg.ay);
      const x0 = Math.floor(Math.min(seg.ax, seg.bx) - pad), x1 = Math.floor(Math.max(seg.ax, seg.bx) + pad);
      const y0 = Math.floor(Math.min(seg.ay, seg.by) - pad), y1 = Math.floor(Math.max(seg.ay, seg.by) + pad);
      for (let y = Math.max(0, y0); y <= Math.min(m.height - 1, y1); y++)
        for (let x = Math.max(0, x0); x <= Math.min(m.width - 1, x1); x++) {
          if (segDist(seg, x + 0.5, y + 0.5)[0] > 0.71 + pad) continue;
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

/** [distance, distance along the polyline, closest x, closest y] from (px, py) to a segment */
export function segDist(s: Seg, px: number, py: number): [number, number, number, number] {
  const dx = s.bx - s.ax, dy = s.by - s.ay;
  const L2 = dx * dx + dy * dy || 1e-9;
  const t = Math.max(0, Math.min(1, ((px - s.ax) * dx + (py - s.ay) * dy) / L2));
  const cx = s.ax + dx * t, cy = s.ay + dy * t;
  return [Math.hypot(px - cx, py - cy), s.s0 + t * Math.sqrt(L2), cx, cy];
}

/** the nearest point on an open rail line to (px, py), if one passes within `maxD` tiles */
export function snapToRail(m: GameMap, px: number, py: number, year: number, maxD = 0.9): [number, number] | null {
  const segs = lineIndex(m).get(Math.floor(py) * m.width + Math.floor(px));
  if (!segs) return null;
  let best = maxD, out: [number, number] | null = null;
  for (const s of segs) {
    if (s.kind !== "rail" || (m.railLines[String(s.line)]?.year ?? 9999) > year) continue;
    const [d, , cx, cy] = segDist(s, px, py);
    if (d < best) { best = d; out = [cx, cy]; }
  }
  return out;
}
