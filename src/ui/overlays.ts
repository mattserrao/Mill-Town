// Data overlays for examining the map.

import type { GameState } from "../core/game";
import { INDUSTRIES, type IndustryId } from "../core/industries";
import { evaluateSite, popSAT } from "../core/site";
import { Terrain } from "../core/terrain";
import type { OverlayFn } from "../render/renderer";

export type OverlayId = "none" | "elevation" | "terrain" | "coal" | "transport" | "population" | "landValue" | "pollution" | `site:${IndustryId}`;

export const OVERLAYS: { id: OverlayId; label: string }[] = [
  { id: "none", label: "None" },
  { id: "elevation", label: "Elevation" },
  { id: "terrain", label: "Terrain class" },
  { id: "coal", label: "Coal seam" },
  { id: "transport", label: "Rail & roads (by year)" },
  { id: "population", label: "Population" },
  { id: "landValue", label: "Land value" },
  { id: "pollution", label: "Pollution" },
  ...(Object.keys(INDUSTRIES) as IndustryId[]).map((k) => ({ id: `site:${k}` as OverlayId, label: `Site: ${INDUSTRIES[k].name}` })),
];

type RGBA = [number, number, number, number];

function ramp(t: number, a = 0.6): RGBA {
  const stops: [number, number, number][] = [[49, 54, 149], [69, 117, 180], [254, 224, 144], [244, 109, 67], [165, 0, 38]];
  t = Math.max(0, Math.min(0.9999, t)) * (stops.length - 1);
  const k = Math.floor(t), f = t - k;
  const c0 = stops[k], c1 = stops[k + 1];
  return [Math.round(c0[0] + (c1[0] - c0[0]) * f), Math.round(c0[1] + (c1[1] - c0[1]) * f), Math.round(c0[2] + (c1[2] - c0[2]) * f), a];
}

export interface OverlayCache { site?: { key: string; scores: Uint8Array } }

/** Returns the per-tile colour function plus a key that changes whenever its output would. */
export function makeOverlay(id: OverlayId, g: GameState, cache: OverlayCache): { fn: OverlayFn; key: string } {
  const m = g.map, w = g.world;
  switch (id) {
    case "none": return { fn: null, key: "none" };
    case "elevation": {
      const lo = m.minHeight, hi = m.maxHeight;
      return { key: id, fn: (i) => m.terrain[i] === Terrain.Water ? null : ramp((m.elevation[i] - lo) / (hi - lo), 0.5) };
    }
    case "terrain": {
      const pal: Record<number, RGBA> = { 1: [120, 200, 255, 0.45], 2: [140, 230, 120, 0.4], 3: [240, 200, 90, 0.4], 4: [230, 120, 60, 0.45], 5: [200, 140, 255, 0.4], 6: [220, 50, 50, 0.55] };
      return { key: id, fn: (i) => pal[m.terrain[i]] ?? null };
    }
    case "coal":
      return { key: id, fn: (i) => m.coal[i] === 2 ? [10, 10, 10, 0.8] : m.coal[i] === 1 ? [70, 60, 50, 0.3] : null };
    case "transport":
      return {
        key: `${id}|${w.year}`,
        fn: (i) => {
          const r = m.rail[i];
          if (r) { const yr = m.railLines[String(r)]?.year ?? 9999; return yr <= w.year ? [20, 20, 20, 0.85] : [200, 60, 200, 0.55]; }
          if (w.street[i]) return [240, 200, 80, 0.7];
          if (m.road[i]) return [255, 255, 255, 0.18];
          return null;
        },
      };
    case "population":
      return { key: `${id}|${w.version}`, fn: (i) => w.pop[i] > 0 ? ramp(Math.sqrt(w.pop[i] / 70), 0.6) : null };
    case "landValue":
      return { key: `${id}|${w.version}`, fn: (i) => m.terrain[i] === Terrain.Water ? null : ramp(w.landValue[i] / 400, 0.5) };
    case "pollution":
      return { key: `${id}|${w.version}`, fn: (i) => w.pollution[i] > 0.005 ? ramp(Math.min(1, w.pollution[i] / 3), 0.6) : null };
    default: {
      const ind = id.slice(5) as IndustryId;
      const key = `${ind}|${w.version}`;
      if (!cache.site || cache.site.key !== key) {
        const sat = popSAT(m, w);
        const scores = new Uint8Array(m.width * m.height);
        // every other tile (sites are many tiles wide), filled 2x2
        for (let y = 0; y < m.height; y += 2) for (let x = 0; x < m.width; x += 2) {
          const i = y * m.width + x;
          const t = m.terrain[i];
          if (t === Terrain.Water || t === Terrain.Steep || t === Terrain.Cliff) continue;
          const sc = evaluateSite(m, w, g.fields, ind, x, y, sat).score;
          scores[i] = sc;
          if (x + 1 < m.width) scores[i + 1] = sc;
          if (y + 1 < m.height) { scores[i + m.width] = sc; if (x + 1 < m.width) scores[i + m.width + 1] = sc; }
        }
        cache.site = { key, scores };
      }
      const s = cache.site.scores;
      return { key: `site|${key}`, fn: (i) => s[i] > 0 && m.terrain[i] !== Terrain.Water ? ramp(s[i] / 100, 0.55) : null };
    }
  }
}

export function overlayLegend(id: OverlayId): string {
  switch (id) {
    case "elevation": return "Blue = river level (~216 m) → red = hilltops (~390 m)";
    case "terrain": return "Blue floodplain · green flat · yellow hillside · orange steep · red bluff · purple upland";
    case "coal": return "Black = Pittsburgh seam outcrops (drift mines) · brown = seam underground";
    case "transport": return "Black = rail open this year · purple = future rail line · yellow = streets & pikes · faint = where streets will come";
    case "population": return "Residents per tile (up to ~70)";
    case "landValue": return "Cheap (blue) → expensive (red)";
    case "pollution": return "Soot and smoke from the works";
    case "none": return "";
    default: return "Site score for the footprint's north-west corner. Click a tile to see why.";
  }
}
