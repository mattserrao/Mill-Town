// Site evaluation: how good is this tile as the north-west corner of a new plant?

import { INDUSTRIES, type IndustryId } from "./industries";
import { type GameMap, distanceField, inBounds, sat, satSum, tilesFor, vh } from "./map";
import { BUILD_COST_MULT, Coal, Terrain } from "./terrain";
import type { World } from "./town";
import { Use } from "./town";

export interface SiteFields {
  river: Uint16Array; // tiles to nearest river tile
  coal: Uint16Array;  // tiles to nearest coal outcrop
}

export function siteFields(m: GameMap): SiteFields {
  return {
    river: distanceField(m, (i) => m.terrain[i] === Terrain.Water && /River/.test(m.waterNames[String(m.water[i])] ?? "")),
    coal: distanceField(m, (i) => m.coal[i] === Coal.Outcrop),
  };
}

export interface SiteReport {
  ok: boolean;
  score: number; // 0..100
  reasons: string[];
  cost: number;
  labor: number;
  riverM: number;
  coalM: number;
  reliefM: number;
  displaced: number;
  footprint: number;
}

export function footprintTiles(m: GameMap, industry: IndustryId) {
  return tilesFor(m, INDUSTRIES[industry].site.footprintM);
}

export const popSAT = (m: GameMap, w: World) => sat(m, w.pop);

/** Evaluate placing `industry` with its footprint's north-west corner at (x, y). */
export function evaluateSite(m: GameMap, w: World, f: SiteFields, industry: IndustryId, x: number, y: number, pSat?: Float64Array): SiteReport {
  const ind = INDUSTRIES[industry];
  const fp = footprintTiles(m, industry);
  const mpt = m.metersPerTile;
  const reasons = new Set<string>();
  let ok = true;
  let land = 0, grading = 0, displaced = 0;
  let minRiver = 0xffff, minCoal = 0xffff;
  let lo = Infinity, hi = -Infinity;

  for (let dy = 0; dy < fp && ok; dy++) for (let dx = 0; dx < fp; dx++) {
    const tx = x + dx, ty = y + dy;
    if (!inBounds(m, tx, ty)) { ok = false; reasons.add("Off the map"); break; }
    const i = ty * m.width + tx;
    minRiver = Math.min(minRiver, f.river[i]);
    minCoal = Math.min(minCoal, f.coal[i]);
    const mult = BUILD_COST_MULT[m.terrain[i]];
    if (!isFinite(mult)) { ok = false; reasons.add(m.terrain[i] === Terrain.Water ? "Footprint runs into the river" : "Too steep to build"); break; }
    if (w.owner[i] !== 0) { ok = false; reasons.add("Land already owned by a company"); break; }
    if (w.use[i] === Use.Civic || w.use[i] === Use.Landmark) { ok = false; reasons.add("A church or landmark is in the way"); break; }
    land += w.landValue[i];
    grading += 120 * mult;
    displaced += w.pop[i];
    for (const [vx, vy] of [[tx, ty], [tx + 1, ty], [tx, ty + 1], [tx + 1, ty + 1]]) { const h = vh(m, vx, vy); lo = Math.min(lo, h); hi = Math.max(hi, h); }
  }
  const relief = isFinite(hi) ? hi - lo : 0;
  if (ok && relief > ind.site.maxReliefM) { ok = false; reasons.add(`Ground too uneven (${relief.toFixed(0)} m of relief)`); }
  const riverM = minRiver * mpt, coalM = minCoal * mpt;
  if (ok && ind.site.riverWithinM && riverM > ind.site.riverWithinM) { ok = false; reasons.add(`No river frontage (${riverM} m away)`); }

  const R = tilesFor(m, ind.site.laborRadiusM);
  const labor = Math.round(satSum(m, pSat ?? popSAT(m, w), x - R, y - R, x + fp - 1 + R, y + fp - 1 + R));
  grading += relief * fp * fp * 40;
  const cost = Math.round(ind.startCost + land + grading + displaced * 15);

  const riverScore = ind.site.riverWithinM ? Math.max(0, 1 - riverM / (ind.site.riverWithinM + mpt)) : 1;
  const coalScore = Math.max(0, 1 - coalM / ind.site.coalWithinM);
  const workersNeeded = ind.baseCapacity * ind.workersPerUnit;
  const laborScore = Math.min(1, labor / (workersNeeded * 4));
  const costScore = Math.max(0, 1 - (cost - ind.startCost) / ind.startCost);
  const flatScore = 1 - relief / (ind.site.maxReliefM + 1);
  let score = 100 * (0.25 * riverScore + 0.2 * coalScore + 0.25 * laborScore + 0.15 * costScore + 0.15 * flatScore);
  if (!ok) score = 0;
  else {
    if (coalScore < 0.3) reasons.add("Coal is far — higher fuel haulage");
    if (laborScore < 0.5) reasons.add("Thin labor pool — wages will be higher");
    if (displaced > 0) reasons.add(`Displaces ${displaced} residents`);
    if (relief > 2) reasons.add(`Needs grading (${relief.toFixed(0)} m)`);
    if (reasons.size === 0) reasons.add("Good site");
  }
  return { ok, score: Math.round(score), reasons: [...reasons], cost, labor, riverM, coalM, reliefM: relief, displaced, footprint: fp };
}
