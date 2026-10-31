// Game state and the seasonal turn loop. First pass: found a works, produce each season,
// pay wages, spread smoke, and let the town grow toward the jobs along real street alignments.

import { INDUSTRIES, type IndustryId } from "./industries";
import { type GameMap, inBounds, recomputeElevation, resetMap, tilesFor } from "./map";
import { RIVALS } from "./rivals";
import { Rng, tileNoise } from "./rng";
import { evaluateSite, footprintTiles, popSAT, siteFields, type SiteFields } from "./site";
import { habitable, Terrain } from "./terrain";
import { calendar, SEASON_EFFECTS, TOTAL_TURNS, type Calendar } from "./time";
import { activateFeatures, activateStreets, addSteps, CivicSub, densityCap, terrainCap, generateTown, growRegion, HouseSub, POP_CAP, recomputeLandValue, Street, Use, useForPop, walkField, WALK_MIN_PER_COST, type World } from "./town";
import { HILLSIDES, INCLINES, PARKS, tileLine } from "./features";
import { EFFECTS, eventsFor, type HistEvent, type Mod, modMult } from "./events";
import { GROUPS, immigrationPressure, pickGroup } from "./ancestry";

export type RiverSide = "N" | "S" | "E" | "W";
export type PlantStatus = "running" | "idle" | "strike" | "flooded";

export interface Company {
  name: string;
  industry: IndustryId;
  cash: number;
  x: number; y: number;
  footprint: number;
  techs: string[];
  employees: number;
  produced: number;
  seasonsOperating: number;
  lastSeason?: SeasonReport;
  riverSide: RiverSide;
  status: PlantStatus;
  strikeTurns: number;
  library: boolean;
  /** migrants settled since the last civic building went up */
  civicDue: number;
}

export interface RivalState {
  id: string;
  ownerId: number;
  x: number; y: number;
  footprint: number;
  active: boolean;
  riverSide: RiverSide;
}

export interface SeasonReport {
  produced: number;
  revenue: number;
  inputCost: number;
  wages: number;
  profit: number;
  workersWanted: number;
  workersHired: number;
  migrants: number;
  notes: string[];
}

export interface GameState {
  seed: number;
  map: GameMap;
  world: World;
  fields: SiteFields;
  turn: number;
  company?: Company;
  rivals: RivalState[];
  log: { turn: number; text: string }[];
  /** walking cost from the works to every tile (Infinity beyond an hour) */
  access?: Float64Array;
  inclinesBuilt: number;
  /** timed modifiers from historical events */
  mods: Mod[];
  /** events that fired at the start of the current turn (for headlines) */
  headlines: HistEvent[];
  /** set by a flood event for this season */
  floodNow?: number;
  /** true once the last season (Winter 1985) has been played */
  over?: boolean;
  stats: GameStats;
}

export interface GameStats {
  peakPop: number; peakPopYear: number;
  peakEmployees: number; peakEmployeesYear: number;
  peakCash: number; peakCashYear: number;
  totalProfit: number;
  strikes: number;
  foundedYear?: number;
}

export const STARTING_CASH = 100000;
const WAGE_PER_SEASON_1850 = 60;
const PARTICIPATION = 0.32;

let fieldsCache: { map: GameMap; fields: SiteFields } | null = null;

export function newGame(map: GameMap, seed: number): GameState {
  resetMap(map);
  const world = generateTown(map, seed, 1850);
  if (!fieldsCache || fieldsCache.map !== map) fieldsCache = { map, fields: siteFields(map) };
  const g: GameState = { seed, map, world, fields: fieldsCache.fields, turn: 0, rivals: [], log: [{ turn: 0, text: `Spring 1850. Seed ${seed}.` }], inclinesBuilt: 0, mods: [], headlines: [],
    stats: { peakPop: 0, peakPopYear: 1850, peakEmployees: 0, peakEmployeesYear: 1850, peakCash: 0, peakCashYear: 1850, totalProfit: 0, strikes: 0 } };
  g.stats.peakPop = totalPopulation(g);
  fireEvents(g);
  return g;
}

/** Fire the historical events for the current season (headline, log, effects). */
export function fireEvents(g: GameState) {
  const c = cal(g);
  g.headlines = eventsFor(c.year, c.season);
  g.floodNow = undefined;
  for (const e of g.headlines) {
    log(g, `${e.name}. ${e.description}`);
    for (const ef of EFFECTS[e.name] ?? []) {
      if ("mods" in ef) for (const [kind, mult, dur] of ef.mods) g.mods.push({ kind, mult, until: g.turn + dur, source: e.name });
      else if ("flood" in ef) g.floodNow = ef.flood;
      else if ("epidemic" in ef) {
        const w = g.world;
        for (let i = 0; i < w.pop.length; i++) if (w.pop[i] > 30) w.pop[i] = Math.round(w.pop[i] * (1 - ef.epidemic * 2));
        w.version++;
      }
    }
  }
  g.mods = g.mods.filter((m) => m.until > g.turn);
}

export const mod = (g: GameState, k: Parameters<typeof modMult>[1]) => modMult(g.mods, k, g.turn);

export function cal(g: GameState): Calendar {
  return calendar(g.turn);
}

export function foundCompany(g: GameState, industry: IndustryId, x: number, y: number, name?: string): { ok: boolean; reason?: string } {
  if (g.company) return { ok: false, reason: "Company already founded" };
  const rep = evaluateSite(g.map, g.world, g.fields, industry, x, y);
  if (!rep.ok) return { ok: false, reason: rep.reasons.join("; ") };
  if (rep.cost > STARTING_CASH) return { ok: false, reason: `Costs $${rep.cost.toLocaleString()}, you have $${STARTING_CASH.toLocaleString()}` };
  const ind = INDUSTRIES[industry];
  claimFootprint(g, x, y, rep.footprint, 1, Use.Industry);
  g.company = {
    name: name ?? `${ind.name} Co.`,
    industry,
    cash: STARTING_CASH - rep.cost,
    x, y,
    footprint: rep.footprint,
    techs: [ind.tech[0].id],
    employees: 0,
    produced: 0,
    seasonsOperating: 0,
    riverSide: riverSideOf(g.map, x, y, rep.footprint),
    status: "running",
    strikeTurns: 0,
    library: false,
    civicDue: 0,
  };
  g.stats.foundedYear = cal(g).year;
  log(g, `Founded ${g.company.name} (${ind.startsAs}) for $${rep.cost.toLocaleString()}.`);
  recomputeLandValue(g.map, g.world);
  updateAccess(g);
  return { ok: true };
}

// ---------------------------------------------------------------- commuting

const MAX_WALK_MIN = 60;

/** Recompute walking times from the works (after streets, steps or inclines change). */
export function updateAccess(g: GameState) {
  const c = g.company;
  if (!c) { g.access = undefined; return; }
  g.access = walkField(g.map, g.world, c.x + (c.footprint >> 1), c.y + (c.footprint >> 1), MAX_WALK_MIN / WALK_MIN_PER_COST);
}

export function walkMinutes(g: GameState, i: number): number {
  const a = g.access?.[i];
  return a === undefined || !isFinite(a) ? Infinity : a * WALK_MIN_PER_COST;
}

/** Share of a tile's working men who'll take a job at the works, by walking time. */
export function commuteWeight(min: number): number {
  if (min <= 15) return 1;
  if (min <= 40) return 1 - (0.8 * (min - 15)) / 25;
  if (min <= MAX_WALK_MIN) return 0.2 * (1 - (min - 40) / (MAX_WALK_MIN - 40));
  return 0;
}

export const STEPS_COST = 4000;
export const INCLINE_COST = 60000;

/** Build public steps from the nearest unserved hillside houses down to the street. */
export function buildSteps(g: GameState): { ok: boolean; reason?: string } {
  const c = g.company;
  if (!c) return { ok: false, reason: "No company" };
  if (c.cash < STEPS_COST) return { ok: false, reason: `Needs $${STEPS_COST.toLocaleString()}` };
  const made = addSteps(g.map, g.world, 1, [c.x + (c.footprint >> 1), c.y + (c.footprint >> 1), 70], true);
  if (!made) return { ok: false, reason: "No hillside houses near the works need steps" };
  c.cash -= STEPS_COST;
  updateAccess(g);
  log(g, `${c.name} builds a flight of public steps up the hillside.`);
  return { ok: true };
}

/** Build an inclined plane from a street near the works up to the hillside houses the longest walk away. */
export function buildIncline(g: GameState): { ok: boolean; reason?: string } {
  const c = g.company;
  if (!c) return { ok: false, reason: "No company" };
  if (cal(g).year < 1870) return { ok: false, reason: "Inclines come to Pittsburgh in 1870" };
  if (c.cash < INCLINE_COST) return { ok: false, reason: `Needs $${INCLINE_COST.toLocaleString()}` };
  const { map: m, world: w } = g;
  if (!g.access) updateAccess(g);
  const cx = c.x + (c.footprint >> 1), cy = c.y + (c.footprint >> 1);
  // foot: a street close to the works; head: hillside houses up to ~1 km away that are a long walk now
  let bottom = -1, top = -1, best = -Infinity, bd = 0;
  const MAXL = 22; // ~650 m: as long as Pittsburgh's longest inclines
  for (let y = cy - 45; y <= cy + 45; y += 2) for (let x = cx - 45; x <= cx + 45; x += 2) {
    if (!inBounds(m, x, y)) continue;
    const b = y * m.width + x;
    if (!w.street[b] || w.street[b] === Street.Steps || w.street[b] === Street.Bridge || walkMinutes(g, b) > 15) continue;
    for (let ty = y - MAXL; ty <= y + MAXL; ty += 2) for (let tx = x - MAXL; tx <= x + MAXL; tx += 2) {
      if (!inBounds(m, tx, ty)) continue;
      const t = ty * m.width + tx;
      const len = Math.hypot(tx - x, ty - y);
      if (!w.pop[t] || len < 5 || len > MAXL || w.use[t] === Use.Incline) continue;
      const rise = m.elevation[t] - m.elevation[b];
      if (rise < 35) continue;
      // houses served: populated tiles within 6 tiles of the head
      let served = 0;
      for (let dy = -6; dy <= 6; dy += 2) for (let dx = -6; dx <= 6; dx += 2) if (inBounds(m, tx + dx, ty + dy)) served += w.pop[(ty + dy) * m.width + tx + dx];
      const saving = Math.min(90, walkMinutes(g, t)) - (walkMinutes(g, b) + len * 0.15);
      const score = saving * Math.sqrt(served + 1) * 0.2 + rise * 0.1 - len * 0.3;
      if (score <= best || saving < 8) continue;
      const line = tileLine(x, y, tx, ty);
      if (line.some(([lx, ly]) => { const j = ly * m.width + lx; const u = w.use[j]; return m.terrain[j] === Terrain.Water || u === Use.Industry || u === Use.Rival || u === Use.Civic || u === Use.Landmark || u === Use.Incline || u === Use.Commerce; })) continue;
      best = score; bottom = b; top = t; bd = len;
    }
  }
  if (top < 0) return { ok: false, reason: "No hillside houses above the works that an incline would bring closer" };
  const tx = top % m.width, ty = (top / m.width) | 0;
  const id = 100 + g.inclinesBuilt++;
  const path = tileLine(bottom % m.width, (bottom / m.width) | 0, tx, ty);
  const name = `${c.name.replace(/ Co\.$/, "")} Incline${g.inclinesBuilt > 1 ? ` No. ${g.inclinesBuilt}` : ""}`;
  w.inclines.push({ id, name, year: cal(g).year, path });
  for (const [x, y] of path) {
    const i = y * m.width + x;
    w.use[i] = Use.Incline; w.sub[i] = id; w.pop[i] = 0; w.street[i] = 0; w.built[i] = cal(g).year;
  }
  w.version++;
  c.cash -= INCLINE_COST;
  updateAccess(g);
  log(g, `${c.name} opens the ${name}, ${(bd * m.metersPerTile).toFixed(0)} m up the hill.`);
  return { ok: true };
}

/** Which side of a footprint faces the river (where the dock goes). */
export function riverSideOf(m: GameMap, x: number, y: number, fp: number): RiverSide {
  const count = (x0: number, y0: number, x1: number, y1: number) => {
    let c = 0;
    for (let yy = y0; yy <= y1; yy++) for (let xx = x0; xx <= x1; xx++)
      if (inBounds(m, xx, yy) && m.terrain[yy * m.width + xx] === Terrain.Water) c++;
    return c;
  };
  const sides: [RiverSide, number][] = [
    ["N", count(x, y - 4, x + fp - 1, y - 1)], ["S", count(x, y + fp, x + fp - 1, y + fp + 3)],
    ["W", count(x - 4, y, x - 1, y + fp - 1)], ["E", count(x + fp, y, x + fp + 3, y + fp - 1)],
  ];
  sides.sort((a, b) => b[1] - a[1]);
  return sides[0][0];
}

/** Technologies a rival would be running in a given year. */
export function techsForYear(ind: IndustryId, year: number): string[] {
  return INDUSTRIES[ind].tech.filter((t) => t.year <= year - 2).map((t) => t.id);
}

/** Fund a public library near the works (the Carnegie gambit). */
export const LIBRARY_COST = 40000;
export function fundLibrary(g: GameState): { ok: boolean; reason?: string } {
  const c = g.company;
  if (!c) return { ok: false, reason: "No company" };
  if (c.library) return { ok: false, reason: "Already funded a library" };
  if (cal(g).year < 1880) return { ok: false, reason: "Libraries become a thing in the 1880s" };
  if (c.cash < LIBRARY_COST) return { ok: false, reason: `Needs $${LIBRARY_COST.toLocaleString()}` };
  const at = placeCivic(g, c.x + (c.footprint >> 1), c.y + (c.footprint >> 1), CivicSub.Library);
  if (!at) return { ok: false, reason: "No site for a library near the works" };
  c.cash -= LIBRARY_COST;
  c.library = true;
  log(g, `${c.name} funds a free public library for the town.`);
  return { ok: true };
}

/** Most numerous community within r tiles. */
export function dominantGroup(g: GameState, cx: number, cy: number, r: number): number {
  const { map: m, world: w } = g;
  const c = new Float64Array(GROUPS.length);
  for (let y = cy - r; y <= cy + r; y += 2) for (let x = cx - r; x <= cx + r; x += 2) {
    if (!inBounds(m, x, y)) continue;
    const i = y * m.width + x;
    if (w.pop[i] && w.eth[i]) c[w.eth[i]] += w.pop[i];
  }
  let best = 1;
  for (let k = 1; k < c.length; k++) if (c[k] > c[best]) best = k;
  return best;
}

/** Put a civic building on a settled lot near (cx, cy) that fronts a street. */
function placeCivic(g: GameState, cx: number, cy: number, sub: CivicSub): boolean {
  const { map: m, world: w } = g;
  let best = -1, bd = Infinity;
  for (let r = 3; r <= 45 && best < 0; r += 6) {
    for (let y = cy - r; y <= cy + r; y++) for (let x = cx - r; x <= cx + r; x++) {
      if (!inBounds(m, x, y)) continue;
      const i = y * m.width + x;
      const u = w.use[i];
      if (u !== Use.Houses && u !== Use.Rowhouses && u !== Use.Cottage) continue;
      if (w.owner[i] || !nearStreet(g, x, y)) continue;
      const d = Math.hypot(x - cx, y - cy) + tileNoise(g.seed, x, y, 77) * 3;
      if (d < bd) { bd = d; best = i; }
    }
  }
  if (best < 0) return false;
  w.use[best] = Use.Civic;
  w.sub[best] = sub;
  if (sub === CivicSub.School || sub === CivicSub.Firehouse || sub === CivicSub.Library) w.eth[best] = 0;
  w.pop[best] = 0;
  w.built[best] = cal(g).year;
  w.version++;
  return true;
}

/** Take the land, clear it, and grade it flat (vertex heights averaged). */
function claimFootprint(g: GameState, x: number, y: number, fp: number, owner: number, use: Use) {
  const { map: m, world: w } = g;
  const V = m.width + 1;
  let sum = 0, cnt = 0;
  for (let vy = y; vy <= y + fp; vy++) for (let vx = x; vx <= x + fp; vx++) { sum += m.vert[vy * V + vx]; cnt++; }
  const level = sum / cnt;
  // inner vertices flat; edge vertices meet the surrounding ground halfway (an embankment)
  for (let vy = y; vy <= y + fp; vy++) for (let vx = x; vx <= x + fp; vx++) {
    const edge = vx === x || vy === y || vx === x + fp || vy === y + fp;
    const k = vy * V + vx;
    m.vert[k] = edge ? (m.vert[k] + level) / 2 : level;
  }
  recomputeElevation(m);
  for (let dy = 0; dy < fp; dy++) for (let dx = 0; dx < fp; dx++) {
    const i = (y + dy) * m.width + (x + dx);
    w.owner[i] = owner;
    w.use[i] = use;
    w.pop[i] = 0;
    w.street[i] = 0;
    w.sub[i] = 0;
  }
  w.version++;
}

function log(g: GameState, text: string) {
  g.log.push({ turn: g.turn, text });
}

function techMods(c: Company) {
  const ind = INDUSTRIES[c.industry];
  const mods = { capacity: 0, efficiency: 0, pollution: 0, workersPerUnit: 0 };
  for (const t of ind.tech) if (c.techs.includes(t.id)) {
    mods.capacity += t.effects.capacity ?? 0;
    mods.efficiency += t.effects.efficiency ?? 0;
    mods.pollution += t.effects.pollution ?? 0;
    mods.workersPerUnit += t.effects.workersPerUnit ?? 0;
  }
  return mods;
}

export function advanceTurn(g: GameState): void {
  if (g.over) return;
  const c0 = cal(g);
  const last = g.turn >= TOTAL_TURNS - 1;
  const rng = new Rng(g.seed).fork(`turn${g.turn}`);
  const fx = SEASON_EFFECTS[c0.season];

  if (g.company) runCompany(g, rng, fx.river, fx.floodRisk);
  spawnRivals(g, c0.year);
  decayPollution(g, mod(g, "pollution") < 0.9 ? 0.95 : 0.985);
  naturalGrowth(g, rng);
  if (last) {
    // Winter 1985 was the last season: the game ends here and the clock stays put
    g.over = true;
    g.headlines = [];
    updateStats(g, c0.year);
    log(g, "The end of the steel era. Your story in the valley is over.");
    g.world.version++;
    return;
  }

  g.turn++;
  const c1 = cal(g);
  g.world.year = c1.year;
  {
    const plants: [number, number][] = g.rivals.map((r) => [r.x + r.footprint / 2, r.y + r.footprint / 2]);
    if (g.company) plants.push([g.company.x + g.company.footprint / 2, g.company.y + g.company.footprint / 2]);
    if (c1.year < 1975) growRegion(g.map, g.world, plants, totalPopulation(g), g.turn % 4);
  }
  if (c1.year !== c0.year) {
    activateStreets(g.map, g.world);
    activateFeatures(g.map, g.world);
    recomputeLandValue(g.map, g.world);
    for (const [, l] of Object.entries(g.map.railLines)) if (l.year === c1.year) log(g, `The ${l.name} opens.`);
    for (const [, b] of Object.entries(g.map.bridges)) if (b.year === c1.year) log(g, `The ${b.name} opens.`);
    for (const inc of INCLINES) if (inc.year === c1.year) log(g, `The ${inc.name} opens.`);
    for (const pk of PARKS) if (pk.year === c1.year) log(g, `${pk.name} is laid out as a public park.`);
    for (const h of HILLSIDES) if (h.year === c1.year) log(g, `Houses begin to climb the hillside at ${h.name}.`);
    updateAccess(g);
  }
  if (c1.era.id !== c0.era.id) log(g, `A new era begins: ${c1.era.name}.`);
  fireEvents(g);
  updateStats(g, c1.year);
  g.world.version++;
}

function updateStats(g: GameState, year: number) {
  const st = g.stats, c = g.company;
  const pop = totalPopulation(g);
  if (pop > st.peakPop) { st.peakPop = pop; st.peakPopYear = year; }
  if (!c) return;
  if (c.employees > st.peakEmployees) { st.peakEmployees = c.employees; st.peakEmployeesYear = year; }
  if (c.cash > st.peakCash) { st.peakCash = c.cash; st.peakCashYear = year; }
  if (c.lastSeason) st.totalProfit += c.lastSeason.profit;
}

function runCompany(g: GameState, rng: Rng, riverMult: number, floodRisk: number) {
  const c = g.company!;
  const m = g.map;
  const ind = INDUSTRIES[c.industry];
  const mods = techMods(c);
  const cx = c.x + (c.footprint >> 1), cy = c.y + (c.footprint >> 1);
  const notes: string[] = [];

  const capacity = ind.baseCapacity * (1 + mods.capacity);
  const wpu = Math.max(0.03, ind.workersPerUnit * (1 + mods.workersPerUnit));
  const workersWanted = Math.round(capacity * wpu);
  const R = tilesFor(m, ind.site.laborRadiusM);
  if (!g.access) updateAccess(g);
  // the labor pool is everyone within an hour's walk, weighted by how long the walk is
  let pool = 0;
  const RR = 160;
  for (let y = cy - RR; y <= cy + RR; y++) for (let x = cx - RR; x <= cx + RR; x++) {
    if (!inBounds(m, x, y)) continue;
    const i = y * m.width + x;
    if (g.world.pop[i]) pool += g.world.pop[i] * commuteWeight(walkMinutes(g, i));
  }
  const workersHired = Math.round(Math.min(workersWanted, pool * PARTICIPATION));
  let output = Math.min(capacity, workersHired / wpu);
  const year0 = cal(g).year;
  c.status = "running";
  if (c.strikeTurns > 0) {
    c.strikeTurns--;
    output = 0;
    c.status = "strike";
    notes.push("The men are out on strike. The works stand cold.");
  } else if (year0 >= 1877 && c.employees > 300 && rng.chance((0.02 + Math.min(0.04, c.employees / 60000)) * mod(g, "strike"))) {
    c.strikeTurns = rng.int(0, 2);
    g.stats.strikes++;
    output = 0;
    c.status = "strike";
    notes.push("Strike! The men walked out over wages and hours.");
    log(g, `Strike at ${c.name}.`);
  }
  if (ind.site.riverWithinM) output *= riverMult;
  if (riverMult < 1) notes.push(riverMult <= 0.5 ? "River ice cut barge deliveries." : "Low water slowed barges.");

  let flood = 0;
  for (let dy = 0; dy < c.footprint; dy++) for (let dx = 0; dx < c.footprint; dx++)
    if (m.terrain[(c.y + dy) * m.width + c.x + dx] === Terrain.Floodplain) flood++;
  if (flood && g.floodNow !== undefined) {
    output *= g.floodNow;
    c.status = "flooded";
    notes.push("The great flood put the works under water.");
  } else if (flood && rng.chance(floodRisk)) {
    output *= 0.6;
    c.status = "flooded";
    notes.push("Flood! The works stood in water for weeks.");
    log(g, "Flood damaged the works.");
  }
  output = Math.floor(output);
  if (output === 0 && c.status === "running") c.status = "idle";

  const year = cal(g).year;
  const haul = 1 + Math.min(1, (g.fields.coal[cy * m.width + cx] * m.metersPerTile) / ind.site.coalWithinM) * 0.5;
  const unitInput = Object.values(ind.inputs).reduce((a, b) => a + (b ?? 0), 0) * 5 * haul * (1 - mods.efficiency);
  output = Math.floor(output * Math.min(1, mod(g, "output")));
  const price = ind.basePrice * (1 + (year - 1850) * 0.004) * mod(g, "price");
  const wage = WAGE_PER_SEASON_1850 * (1 + (year - 1850) * 0.012) * mod(g, "wage");

  const revenue = Math.round(output * price);
  const inputCost = Math.round(output * unitInput);
  const wages = Math.round(workersHired * wage);
  const profit = revenue - inputCost - wages;
  c.cash += profit;
  c.employees = workersHired;
  c.produced += output;
  c.seasonsOperating++;

  const pol = output * ind.pollutionPerUnit * (1 + mods.pollution) * mod(g, "pollution");
  const reachM = 250 + Math.sqrt(c.produced) * 6;
  spreadPollution(g, cx, cy, pol, Math.min(tilesFor(m, reachM), 120));

  const shortfall = Math.max(0, workersWanted - workersHired);
  const migrants = settleMigrants(g, cx, cy, R, Math.round((shortfall / PARTICIPATION * 0.35 + workersHired * 0.05) * mod(g, "migrants") * Math.min(1.8, Math.max(0.5, 0.5 + immigrationPressure(year0) * 0.25))));
  if (migrants > 0) notes.push(`${migrants} newcomers settled near the works.`);
  // a growing mill town needs churches, schools and firehouses
  c.civicDue += migrants;
  if (c.civicDue >= 1500) {
    c.civicDue = 0;
    const kinds: CivicSub[] = [GROUPS[dominantGroup(g, cx, cy, 30)].church as CivicSub];
    if (year0 >= 1865) kinds.push(CivicSub.School);
    if (year0 >= 1870) kinds.push(CivicSub.Firehouse);
    const kind = kinds[rng.int(0, kinds.length - 1)];
    if (placeCivic(g, cx, cy, kind)) log(g, `The town near the works builds a new ${kind === CivicSub.School ? "school" : kind === CivicSub.Firehouse ? "firehouse" : kind === CivicSub.Synagogue ? "synagogue" : "church"}.`);
  }

  c.lastSeason = { produced: output, revenue, inputCost, wages, profit, workersWanted, workersHired, migrants, notes };
}

function spreadPollution(g: GameState, cx: number, cy: number, amount: number, r: number) {
  const { map: m, world: w } = g;
  const norm = 1 / Math.max(1, r * r * 0.25);
  for (let y = cy - r; y <= cy + r; y++) for (let x = cx - r; x <= cx + r; x++) {
    if (!inBounds(m, x, y)) continue;
    const d = Math.hypot(x - cx, y - cy);
    if (d > r) continue;
    const drift = x >= cx ? 1.25 : 0.8; // westerlies carry smoke east
    w.pollution[y * m.width + x] += amount * drift * (1 - d / (r + 1)) ** 2 * norm * 0.6;
  }
}

function decayPollution(g: GameState, k: number) {
  const p = g.world.pollution;
  for (let i = 0; i < p.length; i++) if (p[i] > 0) p[i] *= k;
}

/** Add people near (cx,cy): fill existing homes first, then new lots beside streets. */
function settleMigrants(g: GameState, cx: number, cy: number, r: number, count: number): number {
  if (count <= 0) return 0;
  const { map: m, world: w } = g;
  const cands: { i: number; d: number }[] = [];
  for (let y = cy - r; y <= cy + r; y++) for (let x = cx - r; x <= cx + r; x++) {
    if (!inBounds(m, x, y)) continue;
    const i = y * m.width + x;
    if (w.owner[i] || w.street[i] || !habitable(m.terrain[i])) continue;
    const u = w.use[i];
    if (u === Use.Civic || u === Use.Landmark || u === Use.Wharf || u === Use.Commerce || u === Use.Park || u === Use.Incline || u === Use.Mine) continue;
    // prefer lots on today's street grid (where the real town grew)
    const streetBonus = m.road[i] ? 6 : nearStreet(g, x, y) ? -3 : 4;
    cands.push({ i, d: Math.hypot(x - cx, y - cy) + (m.terrain[i] === Terrain.Slope ? 4 : 0) + streetBonus });
  }
  cands.sort((a, b) => a.d - b.d);
  let left = count;
  for (const { i } of cands) {
    if (left <= 0) break;
    const room = Math.min(capFor(w.sub[i]), terrainCap(m.terrain[i]), densityCap(m, w, i)) - w.pop[i];
    if (room <= 0) continue;
    const add = Math.min(room, left, 12);
    const fresh = w.pop[i] === 0;
    w.pop[i] += add;
    left -= add;
    w.use[i] = useForPop(w.pop[i]);
    if (fresh && w.use[i] === Use.Cottage) w.use[i] = Use.Houses;
    const x = i % m.width, y = (i / m.width) | 0;
    const d = Math.hypot(x - cx, y - cy);
    if (fresh) {
      w.built[i] = g.world.year;
      w.eth[i] = pickGroup(m, w.eth, w.pop, i % m.width, (i / m.width) | 0, w.year, ethRng(g));
      w.sub[i] = d <= 10 && w.landValue[i] < 60 ? HouseSub.Shanty : d <= 28 && g.world.year >= 1855 ? HouseSub.Company : HouseSub.Normal;
    } else if (w.use[i] === Use.Rowhouses) {
      if (w.sub[i] === HouseSub.Shanty || w.sub[i] === HouseSub.Company) { w.sub[i] = d <= 18 ? HouseSub.Boarding : HouseSub.Normal; w.built[i] = g.world.year; }
    }
  }
  if (left < count) w.version++;
  return count - left;
}

let ethRngCache: { turn: number; rng: Rng } | null = null;
function ethRng(g: GameState) {
  if (!ethRngCache || ethRngCache.turn !== g.turn) ethRngCache = { turn: g.turn, rng: new Rng(`${g.seed}:eth:${g.turn}`) };
  return ethRngCache.rng;
}

/** Company doubles and shanty patches stay low-density; ordinary lots can fill up to rowhouses. */
function capFor(sub: number) {
  return sub === HouseSub.Shanty ? 16 : sub === HouseSub.Company ? POP_CAP.houses : POP_CAP.rowhouses;
}

function nearStreet(g: GameState, x: number, y: number) {
  const m = g.map;
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++)
    if (inBounds(m, x + dx, y + dy) && g.world.street[(y + dy) * m.width + x + dx]) return true;
  return false;
}

function naturalGrowth(g: GameState, rng: Rng) {
  const w = g.world;
  const n = w.pop.length;
  if (w.year >= 1975) {
    // the collapse: families leave the mill towns; empty houses stand boarded up
    const plants: [number, number][] = g.rivals.map((r) => [r.x + r.footprint / 2, r.y + r.footprint / 2]);
    if (g.company) plants.push([g.company.x + g.company.footprint / 2, g.company.y + g.company.footprint / 2]);
    const W = g.map.width;
    for (let i = 0; i < n; i++) {
      if (!w.pop[i] || w.use[i] < Use.Cottage || w.use[i] > Use.Rowhouses || w.sub[i] === HouseSub.Estate) continue;
      const x = i % W, y = (i / W) | 0;
      const millTown = w.pollution[i] > 0.05 || plants.some(([px, py]) => Math.abs(px - x) < 45 && Math.abs(py - y) < 45);
      if (rng.chance(millTown ? 0.025 : 0.004)) w.pop[i] = 0;
      else if (millTown) w.pop[i] = Math.floor(w.pop[i] * 0.98);
    }
    w.version++;
    return;
  }
  for (let k = 0; k < 3000; k++) {
    const i = rng.int(0, n - 1);
    const cap = Math.min(capFor(w.sub[i]), terrainCap(g.map.terrain[i]), densityCap(g.map, w, i));
    if (w.pop[i] > 0 && w.pop[i] < cap && (w.use[i] >= Use.Cottage && w.use[i] <= Use.Rowhouses)) {
      w.pop[i] = Math.min(cap, Math.ceil(w.pop[i] * 1.05));
      w.use[i] = useForPop(w.pop[i]);
    }
  }
}

function spawnRivals(g: GameState, year: number) {
  for (const def of RIVALS) {
    if (def.entryYear !== year || g.rivals.some((r) => r.id === def.id)) continue;
    const lm = g.map.landmarks.find((l) => l.name === def.site);
    if (!lm) continue;
    const ps = popSAT(g.map, g.world);
    let best: { x: number; y: number; s: number } | null = null;
    const R = 24;
    for (let dy = -R; dy <= R; dy += 2) for (let dx = -R; dx <= R; dx += 2) {
      const x = lm.x + dx, y = lm.y + dy;
      const rep = evaluateSite(g.map, g.world, g.fields, def.industry, x, y, ps);
      if (!rep.ok) continue;
      const s = rep.score - Math.hypot(dx, dy) * 0.8;
      if (!best || s > best.s) best = { x, y, s };
    }
    if (!best) continue;
    const fp = footprintTiles(g.map, def.industry);
    const ownerId = 2 + g.rivals.length;
    claimFootprint(g, best.x, best.y, fp, ownerId, Use.Rival);
    g.rivals.push({ id: def.id, ownerId, x: best.x, y: best.y, footprint: fp, active: true, riverSide: riverSideOf(g.map, best.x, best.y, fp) });
    log(g, `${def.figures.join(" & ")} open ${def.company} near ${def.site}.`);
  }
}

export function totalPopulation(g: GameState): number {
  let s = 0;
  for (const p of g.world.pop) s += p;
  return s;
}
