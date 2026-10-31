// Data overlays for examining the map.

import type { GameState } from "../core/game";
import { INDUSTRIES, type IndustryId } from "../core/industries";
import { evaluateSite, popSAT } from "../core/site";
import { Terrain } from "../core/terrain";
import type { OverlayFn } from "../render/renderer";

export type OverlayId = "none" | "elevation" | "terrain" | "coal" | "population" | "landValue" | "pollution" | `site:${IndustryId}`;

export const OVERLAYS: { id: OverlayId; label: string }[] = [
  { id: "none", label: "None" },
  { id: "elevation", label: "Elevation" },
  { id: "terrain", label: "Terrain class" },
  { id: "coal", label: "Coal seam" },
  { id: "population", label: "Population" },
  { id: "landValue", label: "Land value" },
  { id: "pollution", label: "Pollution" },
  ...(Object.keys(INDUSTRIES) as IndustryId[]).map((k) => ({ id: `site:${k}` as OverlayId, label: `Site: ${INDUSTRIES[k].name}` })),
];

type RGBA = [number, number, number, number];

/** Five-stop ramp, t in [0,1]. */
function ramp(t: number, a = 0.6): RGBA {
  const stops: [number, number, number][] = [[49, 54, 149], [69, 117, 180], [254, 224, 144], [244, 109, 67], [165, 0, 38]];
  t = Math.max(0, Math.min(0.9999, t)) * (stops.length - 1);
  const k = Math.floor(t), f = t - k;
  const c0 = stops[k], c1 = stops[k + 1];
  return [Math.round(c0[0] + (c1[0] - c0[0]) * f), Math.round(c0[1] + (c1[1] - c0[1]) * f), Math.round(c0[2] + (c1[2] - c0[2]) * f), a];
}

export interface SiteCache { key: string; scores: Uint8Array }

export function makeOverlay(id: OverlayId, g: GameState, cache: { site?: SiteCache }): OverlayFn {
  const m = g.map, w = g.world;
  switch (id) {
    case "none": return null;
    case "elevation": {
      let lo = Infinity, hi = -Infinity;
      for (const e of m.elevation) { if (e < lo) lo = e; if (e > hi) hi = e; }
      return (i) => m.terrain[i] === Terrain.Water ? null : ramp((m.elevation[i] - lo) / (hi - lo), 0.55);
    }
    case "terrain": {
      const pal: Record<number, RGBA> = { 1: [120, 200, 255, 0.45], 2: [140, 230, 120, 0.4], 3: [240, 200, 90, 0.4], 4: [220, 70, 60, 0.5], 5: [200, 140, 255, 0.4] };
      return (i) => pal[m.terrain[i]] ?? null;
    }
    case "coal":
      return (i) => m.coal[i] === 2 ? [20, 20, 20, 0.75] : m.coal[i] === 1 ? [70, 60, 50, 0.35] : null;
    case "population":
      return (i) => w.pop[i] > 0 ? ramp(Math.sqrt(w.pop[i] / 300), 0.6) : null;
    case "landValue":
      return (i) => m.terrain[i] === Terrain.Water ? null : ramp(w.landValue[i] / 1500, 0.5);
    case "pollution":
      return (i) => w.pollution[i] > 0.005 ? ramp(Math.min(1, w.pollution[i] / 6), 0.6) : null;
    default: {
      const ind = id.slice(5) as IndustryId;
      const key = `${ind}|${g.turn}|${g.rivals.length}|${g.company ? 1 : 0}`;
      if (!cache.site || cache.site.key !== key) {
        const sat = popSAT(m, w);
        const scores = new Uint8Array(m.width * m.height);
        for (let y = 0; y < m.height; y++) for (let x = 0; x < m.width; x++) {
          const i = y * m.width + x;
          const t = m.terrain[i];
          if (t === Terrain.Water || t === Terrain.Steep) continue;
          scores[i] = evaluateSite(m, w, g.fields, ind, x, y, sat).score;
        }
        cache.site = { key, scores };
      }
      const s = cache.site.scores;
      return (i) => s[i] > 0 ? ramp(s[i] / 100, 0.55) : null;
    }
  }
}

export function overlayLegend(id: OverlayId): string {
  switch (id) {
    case "elevation": return "Blue = river level (~216 m) → red = hilltops (~390 m)";
    case "terrain": return "Blue floodplain · green flat · yellow hillside · red steep bluff · purple upland";
    case "coal": return "Black = Pittsburgh seam outcrops (drift mines) · brown = seam underground";
    case "population": return "Residents per tile (up to ~300)";
    case "landValue": return "Cheap (blue) → expensive (red)";
    case "pollution": return "Soot and smoke from the works";
    case "none": return "";
    default: return "Site score for the footprint's north-west corner. Click a tile to see why.";
  }
}
