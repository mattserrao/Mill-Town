// Site evaluation: how good is this tile as the corner of a new plant for an industry?

import { INDUSTRIES, type IndustryId } from "./industries";
import { type GameMap, distanceField, inBounds } from "./map";
import { BUILD_COST_MULT, Coal, Terrain } from "./terrain";
import type { World } from "./town";
import { Use } from "./town";

export interface SiteFields {
  river: Uint16Array; // tiles to nearest river tile
  coal: Uint16Array;  // tiles to nearest coal outcrop
}

export function siteFields(m: GameMap): SiteFields {
  return {
    river: distanceField(m, (i) => m.terrain[i] === Terrain.Water && m.water[i] > 0 &&
      /River/.test(m.waterNames[String(m.water[i])] ?? "")),
    coal: distanceField(m, (i) => m.coal[i] === Coal.Outcrop),
  };
}

export interface SiteReport {
  ok: boolean;
  score: number; // 0..100
  reasons: string[];
  cost: number;  // land + grading + plant
  labor: number; // residents in catchment
  riverDist: number;
  coalDist: number;
}

/** Evaluate placing `industry` with its footprint's north-west corner at (x, y). */
/** Summed-area table of population, for fast labor-catchment queries. */
export function popSAT(m: GameMap, w: World): Float64Array {
  const W = m.width + 1;
  const sat = new Float64Array(W * (m.height + 1));
  for (let y = 0; y < m.height; y++) {
    let row = 0;
    for (let x = 0; x < m.width; x++) {
      row += w.pop[y * m.width + x];
      sat[(y + 1) * W + x + 1] = sat[y * W + x + 1] + row;
    }
  }
  return sat;
}

function satSum(m: GameMap, sat: Float64Array, x0: number, y0: number, x1: number, y1: number) {
  const W = m.width + 1;
  x0 = Math.max(0, x0); y0 = Math.max(0, y0);
  x1 = Math.min(m.width - 1, x1); y1 = Math.min(m.height - 1, y1);
  if (x1 < x0 || y1 < y0) return 0;
  return sat[(y1 + 1) * W + x1 + 1] - sat[y0 * W + x1 + 1] - sat[(y1 + 1) * W + x0] + sat[y0 * W + x0];
}

export function evaluateSite(m: GameMap, w: World, f: SiteFields, industry: IndustryId, x: number, y: number, sat?: Float64Array): SiteReport {
  const ind = INDUSTRIES[industry];
  const fp = ind.site.footprint;
  const reasons: string[] = [];
  let ok = true;
  let land = 0, grading = 0, displaced = 0;
  let minRiver = 0xffff, minCoal = 0xffff;
  const levels = new Set<number>();

  for (let dy = 0; dy < fp; dy++) for (let dx = 0; dx < fp; dx++) {
    const tx = x + dx, ty = y + dy;
    if (!inBounds(m, tx, ty)) { ok = false; reasons.push("Off the map"); continue; }
    const i = ty * m.width + tx;
    minRiver = Math.min(minRiver, f.river[i]);
    minCoal = Math.min(minCoal, f.coal[i]);
    const mult = BUILD_COST_MULT[m.terrain[i]];
    if (!isFinite(mult)) { ok = false; reasons.push(m.terrain[i] === Terrain.Water ? "Footprint in the river" : "Too steep to build"); continue; }
    if (w.owner[i] !== 0) { ok = false; reasons.push("Land already owned by a company"); continue; }
    if (w.use[i] === Use.Civic) { ok = false; reasons.push("Church or market in the way"); continue; }
    land += w.landValue[i];
    grading += 400 * mult;
    displaced += w.pop[i];
    levels.add(m.level[i]);
  }
  const relief = levels.size ? Math.max(...levels) - Math.min(...levels) : 0;
  if (relief > 2) { ok = false; reasons.push(`Uneven ground (${relief} levels)`); }
  if (ind.site.riverWithin && minRiver > ind.site.riverWithin) { ok = false; reasons.push(`No river frontage (${minRiver} tiles away)`); }

  // labor catchment
  const R = ind.site.laborRadius;
  const labor = satSum(m, sat ?? popSAT(m, w), x - R, y - R, x + fp - 1 + R, y + fp - 1 + R);

  const cost = Math.round(ind.startCost + land + grading + displaced * 15);
  // score
  const riverScore = ind.site.riverWithin ? Math.max(0, 1 - minRiver / (ind.site.riverWithin + 1)) : 1;
  const coalScore = Math.max(0, 1 - minCoal / ind.site.coalWithin);
  const workersNeeded = ind.baseCapacity * ind.workersPerUnit;
  const laborScore = Math.min(1, labor / (workersNeeded * 4));
  const costScore = Math.max(0, 1 - (cost - ind.startCost) / ind.startCost);
  const flatScore = 1 - relief / 3;
  let score = 100 * (0.25 * riverScore + 0.2 * coalScore + 0.25 * laborScore + 0.15 * costScore + 0.15 * flatScore);
  if (!ok) score = 0;
  if (ok) {
    if (coalScore < 0.3) reasons.push("Coal is far — higher fuel haulage");
    if (laborScore < 0.5) reasons.push("Thin labor pool — wages will be higher");
    if (displaced > 0) reasons.push(`Displaces ${displaced} residents`);
    if (reasons.length === 0) reasons.push("Good site");
  }
  return { ok, score: Math.round(score), reasons: [...new Set(reasons)], cost, labor, riverDist: minRiver, coalDist: minCoal };
}
