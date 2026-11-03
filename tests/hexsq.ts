// The Mon Valley map is authored on a 720 x 720 square-tile grid; the game runs on hexagons (parseMap resamples it).
// Tests that name a place by its old square-tile position convert it with sq().
import { cellAt } from "../src/core/hex";
import { type GameMap, srcToHex } from "../src/core/map";

/** the hex cell holding the centre of square-map tile (x, y) */
export const sq = (map: GameMap, x: number, y: number): [number, number] => cellAt(...srcToHex(map, x + 0.5, y + 0.5));

import type { GameState } from "../src/core/game";
import type { IndustryId } from "../src/core/industries";
import { evaluateSite } from "../src/core/site";

/**
 * The best legal site for an industry within `r` steps of square-map tile (x, y). A footprint is a rhombus of
 * hexes now, so the exact old corner may not touch the river; the nearest site that does is what the tests mean.
 */
export function okSite(g: GameState, industry: IndustryId, x: number, y: number, r = 10): [number, number] {
  return okSiteNear(g, industry, ...sq(g.map, x, y), r);
}
/** the same, around hex cell (cx, cy) */
export function okSiteNear(g: GameState, industry: IndustryId, cx: number, cy: number, r = 10): [number, number] {
  let best: [number, number] = [cx, cy], bs = -1;
  for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
    const rep = evaluateSite(g.map, g.world, g.fields, industry, cx + dx, cy + dy);
    const s = rep.ok ? rep.score - Math.hypot(dx, dy) * 0.5 : -1;
    if (s > bs) { bs = s; best = [cx + dx, cy + dy]; }
  }
  return best;
}
