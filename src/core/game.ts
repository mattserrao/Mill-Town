// Game state and the seasonal turn loop. First pass: found a works, produce each season,
// pay wages, spread smoke, and let the town grow toward the jobs along real street alignments.

import { INDUSTRIES, type IndustryId } from "./industries";
import { type GameMap, inBounds, recomputeElevation, resetMap, tilesFor } from "./map";
import { RIVALS } from "./rivals";
import { Rng, tileNoise } from "./rng";
import { evaluateSite, footprintTiles, popSAT, siteFields, type SiteFields } from "./site";
import { habitable, Terrain } from "./terrain";
import { calendar, SEASON_EFFECTS, TOTAL_TURNS, type Calendar } from "./time";
import { activateFeatures, activateStreets, addSteps, CivicSub, densityCap, terrainCap, generateTown, civicSeason, HouseSub, POP_CAP, recomputeLandValue, Street, Use, useForPop, type World } from "./town";
import { HILLSIDES, INCLINES, PARKS, regionTarget, tileLine } from "./features";
import { blockCosts, buildCommute, type Commute, jobCenters, runTrips, travelField, type WorksSite } from "./commute";
import { growByDesire } from "./growth";
import { shipSeason, type Shipper, type ShipResult, spurOption } from "./freight";
import { type Business, businessSeason, type Decision, DECISIONS, newBusiness, policyEffects, type PolicyEffects, type PublicWorks, resolveDecision } from "./business";
import { advanceResearch, marketFactor, rivalMult, rivalTechs, techStanding } from "./market";
import { rivalSeason } from "./rivalai";
import { EFFECTS, eventsFor, type HistEvent, type Mod, modMult } from "./events";
import { GROUPS, immigrationPressure, pickGroup } from "./ancestry";
import { type History, newHistory, recordHistory } from "./neighbourhood";
import { type Env, newEnv, type Plant, SOOT_SCALE, updateAir, updateHealth, updateRivers } from "./environment";
import { blockGrid, blockOf } from "./blocks";

export type RiverSide = "N" | "S" | "E" | "W";
export type PlantStatus = "running" | "idle" | "strike" | "flooded" | "lockout";

/** something built beside a works: more furnaces and mills, or a private dock */
export interface Annex { kind: "expand" | "dock" | "housing"; x: number; y: number; fp: number; year: number }

/** One works: the first one you founded, or one you bought or built later. */
export interface Works {
  /** "p" for the first works, "p:1", "p:2"… for the others */
  id: string;
  name: string;
  industry: IndustryId;
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
  /** average health (0..1) and unrest (0..1) of the workforce within walking distance */
  health: number;
  unrest: number;
  /** rail siding built by the player: the rail tile it reaches */
  spur?: [number, number];
  /** a private dock: the water tile it serves */
  dock?: [number, number];
  /** this season's shipping: lanes, delivered share, costs */
  freight?: ShipResult;
  /** a process being built: id and seasons left */
  research?: { id: string; left: number };
  annexes: Annex[];
  /** bought from this rival */
  fromRival?: string;
  /** minutes from this works to every block (the first works uses g.access) */
  access?: Float32Array;
  founded: number;
}

export interface Company extends Works {
  cash: number;
  library: boolean;
  /** migrants settled since the last civic building went up */
  civicDue: number;
  /** standings, policies, actions and the record of decisions */
  biz: Business;
  /** your other works */
  others: Works[];
  /** owed to the bank (a Mellon loan), repaid from profits */
  debt: number;
  /** last season's accounts for the whole company */
  totals?: SeasonReport;
  /** seasons in a row with an overdrawn account */
  redSeasons?: number;
  /** the receivers have taken the works: the game is over */
  bankrupt?: boolean;
}

export interface RivalState {
  id: string;
  ownerId: number;
  x: number; y: number;
  footprint: number;
  active: boolean;
  riverSide: RiverSide;
  /** bought by you: now one of your works */
  owned?: boolean;
  /** extra capacity from expansions (0.2 = +20%) */
  expand: number;
  /** fires, strikes, poaching and the like: output multiplier until a turn */
  damage: { mult: number; until: number; why: string }[];
  /** how much they hold against you (caught sabotage, raids) */
  grudge: number;
  /** what they did last (for the panel) */
  lastMove?: string;
}

export interface SeasonReport {
  produced: number;
  revenue: number;
  inputCost: number;
  wages: number;
  /** repairs, salaries, interest on the plant: paid whether the works runs or not */
  upkeep: number;
  /** safety men, fines and the like, less what the company store earns */
  other: number;
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
  /** minutes from the works to every block (walk / streetcar / car by year) */
  access?: Float32Array;
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
  /** neighbourhood composition over time (5-yearly) and when each community first arrived */
  history: History;
  /** air, rivers, health, unrest, traffic and freight fields */
  env: Env;
  /** works running this season (yours and the rivals'), for smoke and outfalls */
  plants: Plant[];
  /** travel-time fields from the job centres (rebuilt yearly) */
  commute: Commute;
  lastGrowth?: { placed: number; byGroup: number[] };
  /** river improvements won by lobbying */
  publicWorks: PublicWorks;
  /** a historical moment waiting for your decision */
  pendingDecision?: Decision;
  /** permanent share of the market lost to imports (the 1959 strike) */
  priceLoss?: number;
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
    stats: { peakPop: 0, peakPopYear: 1850, peakEmployees: 0, peakEmployeesYear: 1850, peakCash: 0, peakCashYear: 1850, totalProfit: 0, strikes: 0 },
    history: newHistory(map), env: newEnv(map), plants: [], commute: undefined as unknown as Commute, publicWorks: { locks: {} } };
  g.commute = buildCommute(map, world, centersFor(g));
  recordHistory(map, world, g.history);
  warmEnvironment(g);
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
    const dec = DECISIONS[e.name]?.(g);
    if (dec && !g.pendingDecision) g.pendingDecision = dec;
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
    health: 1,
    unrest: 0,
    biz: newBusiness(cal(g).year),
    id: "p",
    annexes: [],
    others: [],
    debt: 0,
    founded: cal(g).year,
  };
  g.stats.foundedYear = cal(g).year;
  g.commute = buildCommute(g.map, g.world, centersFor(g));
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
  // travel time on the block grid by the modes of the year (walk, streetcar, car), steps and inclines included
  g.access = travelField(g.map, blockCosts(g.map, g.world), c.x + (c.footprint >> 1), c.y + (c.footprint >> 1));
}

/** minutes from a tile to the works (Infinity beyond reach); another works' field if given */
export function walkMinutes(g: GameState, i: number, acc = g.access): number {
  if (!acc) return Infinity;
  const W = g.map.width, b = blockOf(blockGrid(g.map), i % W, (i / W) | 0);
  const a = acc[b];
  return a > MAX_WALK_MIN ? Infinity : a;
}

/** travel times from one of your other works */
export function updateWorksAccess(g: GameState, w: Works) {
  w.access = travelField(g.map, blockCosts(g.map, g.world), w.x + (w.footprint >> 1), w.y + (w.footprint >> 1));
}

/** every works you own, the first one first */
export const allWorks = (c: Company): Works[] => [c, ...c.others];
export const totalEmployees = (c: Company) => allWorks(c).reduce((s, w) => s + w.employees, 0);

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
  w.was[best] = w.eth[best];
  w.version++;
  return true;
}

/** Take the land, clear it, and grade it flat (vertex heights averaged). */
export function claimFootprint(g: GameState, x: number, y: number, fp: number, owner: number, use: Use) {
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

export function log(g: GameState, text: string) {
  g.log.push({ turn: g.turn, text });
}

/** each expansion adds 30% of the original capacity */
export const ANNEX_CAPACITY = 0.3;

export function techMods(c: Works) {
  const ind = INDUSTRIES[c.industry];
  const mods = { capacity: c.annexes.filter((a) => a.kind === "expand").length * ANNEX_CAPACITY, efficiency: 0, pollution: 0, workersPerUnit: 0, labour: 1 };
  for (const t of ind.tech) if (c.techs.includes(t.id)) {
    mods.capacity += t.effects.capacity ?? 0;
    mods.efficiency += t.effects.efficiency ?? 0;
    mods.pollution += t.effects.pollution ?? 0;
    mods.workersPerUnit += t.effects.workersPerUnit ?? 0;
    mods.labour *= 1 + (t.effects.workersPerUnit ?? 0);
  }
  return mods;
}

export function advanceTurn(g: GameState): void {
  if (g.over) return;
  const c0 = cal(g);
  const last = g.turn >= TOTAL_TURNS - 1;
  const rng = new Rng(g.seed).fork(`turn${g.turn}`);
  const fx = SEASON_EFFECTS[c0.season];

  // a decision left open takes the course history took
  if (g.pendingDecision) resolveDecision(g, rng.fork("decision"));
  g.plants = [];
  spawnRivals(g, c0.year);
  // the rivals make their moves (by personality) before the season's work
  rivalSeason(g, rng.fork("rivals"));
  const rivals = rivalPlants(g, c0.year);
  if (g.company) runCompany(g, rng, fx.river, fx.floodRisk, rivals);
  else shipSeason(g.map, c0.year, fx.river, rivalShippers(g, rivals), g.env.freight, "p", g.publicWorks.locks);
  g.plants.push(...rivals);
  const season = g.turn % 4;
  updateAir(g.map, g.world, g.env, g.plants, season, mod(g, "pollution"));
  updateRivers(g.map, g.world, g.env, g.plants);
  naturalGrowth(g, rng);
  if (g.company?.bankrupt && !last) {
    g.over = true;
    g.headlines = [{ year: c0.year, season: c0.season, name: `Receivers Take ${g.company.name}`, description: `After ${RECEIVERSHIP} seasons overdrawn, the bank has put ${g.company.name} into receivership. The works will be sold.`, category: "Labor" }];
    updateStats(g, c0.year);
    log(g, `${g.company.name} is in receivership. Your story in the valley is over.`);
    g.world.version++;
    return;
  }
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
  const s1 = g.turn % 4;
  if (c1.year !== c0.year) g.commute = buildCommute(g.map, g.world, centersFor(g));
  {
    const plants: [number, number][] = g.rivals.map((r) => [Math.round(r.x + r.footprint / 2), Math.round(r.y + r.footprint / 2)]);
    if (g.company) plants.push([Math.round(g.company.x + g.company.footprint / 2), Math.round(g.company.y + g.company.footprint / 2)]);
    {
      // the census curve sets how many arrive this season; desirability sets where
      // (after 1975 the curve falls; newcomers only replace losses where the valley is below it)
      const room = Math.round((regionTarget(c1.year + (s1 + 1) / 4) - totalPopulation(g)) * (c1.year < 1975 ? 0.12 : 0.04));
      g.lastGrowth = growByDesire(g.map, g.world, g.commute.access, plants, room, s1);
    }
    civicSeason(g.map, g.world, s1);
    g.env.trafficNorm = runTrips(g.map, g.world, g.commute, g.env.traffic, rng.fork("trips"));
    if (s1 === 1 || s1 === 3) recomputeLandValue(g.map, g.world);
  }
  if (c1.year !== c0.year) {
    activateStreets(g.map, g.world);
    activateFeatures(g.map, g.world);
    for (const [, l] of Object.entries(g.map.railLines)) if (l.year === c1.year) log(g, `The ${l.name} opens.`);
    for (const [, b] of Object.entries(g.map.bridges)) if (b.year === c1.year) log(g, `The ${b.name} opens.`);
    for (const inc of INCLINES) if (inc.year === c1.year) log(g, `The ${inc.name} opens.`);
    for (const pk of PARKS) if (pk.year === c1.year) log(g, `${pk.name} is laid out as a public park.`);
    for (const h of HILLSIDES) if (h.year === c1.year) log(g, `Houses begin to climb the hillside at ${h.name}.`);
    recordHistory(g.map, g.world, g.history);
    updateHealth(g.map, g.world, g.env);
    updateAccess(g);
    if (g.company) for (const w of g.company.others) updateWorksAccess(g, w);
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
  if (c.cash > st.peakCash) { st.peakCash = c.cash; st.peakCashYear = year; }
  const emp = totalEmployees(c);
  if (emp > st.peakEmployees) { st.peakEmployees = emp; st.peakEmployeesYear = year; }
  if (c.totals) st.totalProfit += c.totals.profit;
}

/** per-unit upkeep of a works' capacity each season, as a share of the 1850 price (repairs, salaries, interest) */
export const UPKEEP = 0.05;
/** prices rise 0.8% a year (wages 1.2%): only better processes keep a works ahead */
export const PRICE_TREND = 0.008;
/** seasons in the red before the bank takes the works */
export const RECEIVERSHIP = 8;

interface WorksPlan {
  w: Works; capacity: number; wpu: number; workersWanted: number; workersHired: number;
  output: number; notes: string[]; needs: Shipper["needs"];
}

/** Labour, strikes and floods at one works: what it could make this season, and the inputs it needs. */
function planWorks(g: GameState, w: Works, rng: Rng, pe: PolicyEffects, floodRisk: number, lockedOut: boolean): WorksPlan {
  const m = g.map;
  const ind = INDUSTRIES[w.industry];
  const mods = techMods(w);
  const cx = w.x + (w.footprint >> 1), cy = w.y + (w.footprint >> 1);
  const notes: string[] = [];
  const capacity = ind.baseCapacity * (1 + mods.capacity);
  // bigger plant needs fewer men per ton (the Bessemer converter, the open hearth): men grow with capacity^0.8;
  // labour-saving processes each cut the men per ton by their share; long shifts need fewer men
  const wpu = Math.max(0.02, ind.workersPerUnit * mods.labour) * pe.wpuMult * Math.pow(1 + mods.capacity, -0.2);
  const workersWanted = Math.round(capacity * wpu);
  const main = w === g.company;
  if (main && !g.access) updateAccess(g);
  if (!main && !w.access) updateWorksAccess(g, w);
  const acc = main ? g.access : w.access;
  // the labor pool is everyone within an hour's travel, weighted by how long it takes
  let pool = 0, healthSum = 0, unrestSum = 0;
  const RR = 160, bg = blockGrid(m);
  for (let y = cy - RR; y <= cy + RR; y++) for (let x = cx - RR; x <= cx + RR; x++) {
    if (!inBounds(m, x, y)) continue;
    const i = y * m.width + x;
    if (!g.world.pop[i]) continue;
    const wgt = g.world.pop[i] * commuteWeight(walkMinutes(g, i, acc));
    if (!wgt) continue;
    pool += wgt;
    const b = blockOf(bg, x, y);
    healthSum += g.env.health[b] * wgt; unrestSum += g.env.unrest[b] * wgt;
  }
  // the workforce's health sets how much a shift gets done; its grievances, how likely a walkout is
  w.health = pool ? healthSum / pool : 1;
  w.unrest = pool ? unrestSum / pool : 0;
  // other works share the pool with the first one where their districts overlap: count a little less
  const workersHired = Math.round(Math.min(workersWanted, pool * PARTICIPATION * pe.participationMult * (main ? 1 : 0.8)));
  let output = Math.min(capacity, workersHired / wpu);
  const year = cal(g).year;
  w.status = "running";
  if (lockedOut) {
    output = 0;
    w.status = "lockout";
    notes.push("The gates are locked. The works is dark.");
  } else if (w.strikeTurns > 0) {
    w.strikeTurns--;
    output = 0;
    w.status = "strike";
    notes.push("The men are out on strike. The works stand cold.");
  } else if (year >= 1877 && w.employees > 300 && rng.chance((0.02 + Math.min(0.04, w.employees / 60000)) * mod(g, "strike") * (0.4 + 1.6 * w.unrest) * pe.strikeMult)) {
    w.strikeTurns = rng.int(1, 3); // long enough to negotiate, call the Pinkertons or bring in strikebreakers
    g.stats.strikes++;
    output = 0;
    w.status = "strike";
    notes.push("Strike! The men walked out over wages and hours.");
    log(g, `Strike at ${w.name}.`);
  }
  output *= 0.75 + 0.25 * w.health;

  let flood = 0;
  for (let dy = 0; dy < w.footprint; dy++) for (let dx = 0; dx < w.footprint; dx++)
    if (m.terrain[(w.y + dy) * m.width + w.x + dx] === Terrain.Floodplain) flood++;
  if (flood && g.floodNow !== undefined) {
    output *= g.floodNow;
    w.status = "flooded";
    notes.push("The great flood put the works under water.");
  } else if (flood && rng.chance(floodRisk)) {
    output *= 0.6;
    w.status = "flooded";
    notes.push("Flood! The works stood in water for weeks.");
    log(g, `Flood damaged ${w.name}.`);
  }
  output = Math.floor(output * Math.min(1, mod(g, "output")));
  if (output === 0 && w.status === "running") w.status = "idle";
  const needs: Shipper["needs"] = {};
  for (const [good, per] of Object.entries(ind.inputs)) needs[good as keyof typeof needs] = output * (per ?? 0);
  return { w, capacity, wpu, workersWanted, workersHired, output, notes, needs };
}

/** Sell what the works made with what arrived; the works' own accounts for the season. */
function settleWorks(g: GameState, p: WorksPlan, fr: ShipResult | undefined, riverMult: number, pe: PolicyEffects): SeasonReport {
  const { w } = p;
  const ind = INDUSTRIES[w.industry];
  const mods = techMods(w);
  const year = cal(g).year;
  let output = p.output;
  w.freight = fr;
  if (fr) {
    output = Math.floor(output * fr.delivered);
    if (riverMult < 1 && fr.lanes.some((l) => l.mode === "river")) p.notes.push(riverMult <= 0.5 ? "Ice on the rivers: barge capacity halved." : "Low water: barges run light.");
    for (const n of fr.notes.slice(0, 2)) p.notes.push(n);
  }
  const era = 1 + (year - 1850) * PRICE_TREND;
  const standing = techStanding(g, w);
  const price = ind.basePrice * era * mod(g, "price") * pe.priceMult * (w.industry === "steel" ? 1 - (g.priceLoss ?? 0) : 1) * standing.factor * marketFactor(g, w.industry);
  const wage = WAGE_PER_SEASON_1850 * (1 + (year - 1850) * 0.012) * mod(g, "wage") * pe.wageMult;
  const revenue = Math.round(output * price);
  // what was bought and hauled, less what better furnaces save (and more if someone has cornered the supply)
  const inputCost = Math.round(fr ? (fr.purchaseCost + fr.freightCost) * (1 - mods.efficiency) * pe.inputCostMult * mod(g, "input") : 0);
  // no work, no pay: strikers and locked-out men draw nothing from the company
  const working = w.status !== "lockout" && w.status !== "strike";
  const wages = working ? Math.round(p.workersHired * wage) : 0;
  const upkeep = Math.round(p.capacity * ind.basePrice * UPKEEP * (1 + (year - 1850) * 0.008));
  const profit = revenue - inputCost - wages - upkeep;
  if (standing.behind.length && w.seasonsOperating % 4 === 0) p.notes.push(`Behind the industry (${standing.behind.map((t) => t.name).join(", ")}): prices ${Math.round((1 - standing.factor) * 100)}% under the rivals'.`);
  w.employees = working ? p.workersHired : 0;
  w.produced += output;
  w.seasonsOperating++;
  g.plants.push({ x: w.x, y: w.y, fp: w.footprint, output, pollutionPerUnit: ind.pollutionPerUnit * Math.max(0.1, 1 + mods.pollution) * pe.pollutionMult, owner: w.id, outfall: pe.outfallMult });
  const done = advanceResearch(g, w);
  if (done) p.notes.push(done);
  return { produced: output, revenue, inputCost, wages, upkeep, other: 0, profit, workersWanted: p.workersWanted, workersHired: p.workersHired, migrants: 0, notes: p.notes };
}

function runCompany(g: GameState, rng: Rng, riverMult: number, floodRisk: number, rivals: Plant[]) {
  const c = g.company!;
  const m = g.map;
  const ind = INDUSTRIES[c.industry];
  const cx = c.x + (c.footprint >> 1), cy = c.y + (c.footprint >> 1);
  const pe = policyEffects(g);
  const year0 = cal(g).year;
  const lockedOut = c.biz.lockout > 0;
  if (lockedOut) c.biz.lockout--;

  // every works plans its season; then all the inputs ship together with the rivals'
  const plans = allWorks(c).map((w, k) => planWorks(g, w, rng.fork(`works${k}`), pe, floodRisk, lockedOut));
  const ship = shipSeason(m, year0, riverMult, [
    ...rivalShippers(g, rivals),
    ...plans.map((p) => ({ id: p.w.id, site: { x: p.w.x, y: p.w.y, fp: p.w.footprint, spur: p.w.spur, dock: p.w.dock }, needs: p.needs })),
  ], g.env.freight, "p", g.publicWorks.locks);
  g.env.freightNorm = ship.norm;
  const reports = plans.map((p) => settleWorks(g, p, ship.players[p.w.id], riverMult, pe));
  const sum = (k: "revenue" | "inputCost" | "wages" | "upkeep" | "produced" | "workersHired" | "workersWanted") => reports.reduce((s, r) => s + r[k], 0);

  // the season's business: meters drift, accidents, inspectors; safety men cost money; the company store earns
  const biz = businessSeason(g, rng.fork("biz"), allWorks(c).reduce((s, w) => s + w.employees, 0));
  // the bank takes its share of the profits until the loan is paid
  const before = sum("revenue") - sum("inputCost") - sum("wages") - sum("upkeep");
  const repay = c.debt > 0 ? Math.min(c.debt, Math.max(Math.round(c.debt * 0.05), Math.round(Math.max(0, before) * 0.25))) : 0;
  c.debt -= repay;
  const other = Math.round(biz.extraCost + biz.fines - sum("wages") * pe.storeIncomeShare + repay);
  const profit = before - other;
  c.cash += profit;
  const main = reports[0];
  main.other = other;
  main.profit -= other;
  for (const n of biz.notes) main.notes.push(n);
  if (repay) main.notes.push(`$${repay.toLocaleString()} repaid to the bank.`);
  // in the red too long and the bank sends in the receivers
  c.redSeasons = c.cash < 0 ? (c.redSeasons ?? 0) + 1 : 0;
  if (c.redSeasons >= RECEIVERSHIP / 2 && c.redSeasons < RECEIVERSHIP) main.notes.push(`Overdrawn for ${c.redSeasons} seasons: the bank will take the works after ${RECEIVERSHIP}.`);
  if (c.redSeasons >= RECEIVERSHIP) c.bankrupt = true;

  // newcomers come where the works are short of men
  let migrants = 0;
  plans.forEach((p, k) => {
    const shortfall = Math.max(0, p.workersWanted - p.workersHired);
    const n = settleMigrants(g, p.w.x + (p.w.footprint >> 1), p.w.y + (p.w.footprint >> 1), tilesFor(m, INDUSTRIES[p.w.industry].site.laborRadiusM),
      Math.round((shortfall / PARTICIPATION * 0.35 + p.workersHired * 0.05) * mod(g, "migrants") * Math.min(1.8, Math.max(0.5, 0.5 + immigrationPressure(year0) * 0.25))));
    reports[k].migrants = n;
    if (n > 0) reports[k].notes.push(`${n} newcomers settled near the works.`);
    migrants += n;
  });
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
  // families brought by recruiting agents or as strikebreakers
  for (const [gid, n] of c.biz.recruits.splice(0)) {
    const placed = settleMigrants(g, cx, cy, tilesFor(m, ind.site.laborRadiusM), n, gid);
    if (placed) main.notes.push(`${placed} ${GROUPS[gid].name} newcomers arrived for the works.`);
  }
  plans.forEach((p, k) => { p.w.lastSeason = reports[k]; });
  c.totals = {
    produced: sum("produced"), revenue: sum("revenue"), inputCost: sum("inputCost"), wages: sum("wages"), upkeep: sum("upkeep"), other, profit,
    workersWanted: sum("workersWanted"), workersHired: sum("workersHired"), migrants, notes: main.notes,
  };
}

/** Add people near (cx,cy): fill existing homes first, then new lots beside streets. */
function settleMigrants(g: GameState, cx: number, cy: number, r: number, count: number, group?: number): number {
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
      w.eth[i] = group ?? pickGroup(m, w.eth, w.pop, i % m.width, (i / m.width) | 0, w.year, ethRng(g));
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
    // the steel towns: within ~1.3 km of a steel works (yours if it's steel, and the rivals')
    const steel: [number, number][] = g.rivals.filter((r) => RIVALS.find((d) => d.id === r.id)?.industry === "steel").map((r) => [r.x + r.footprint / 2, r.y + r.footprint / 2]);
    if (g.company) for (const w of allWorks(g.company)) if (w.industry === "steel") steel.push([w.x + w.footprint / 2, w.y + w.footprint / 2]);
    const W = g.map.width;
    for (let i = 0; i < n; i++) {
      if (!w.pop[i] || w.use[i] < Use.Cottage || w.use[i] > Use.Rowhouses || w.sub[i] === HouseSub.Estate) continue;
      const x = i % W, y = (i / W) | 0;
      const millTown = steel.some(([px, py]) => Math.abs(px - x) < 45 && Math.abs(py - y) < 45);
      // the steel towns lose about a third of their people over the decade (empty houses stand boarded up)
      if (millTown && rng.chance(0.008)) w.pop[i] = 0;
      else if (millTown && rng.chance(0.5)) w.pop[i] = Math.floor(w.pop[i] * 0.985);
    }
    w.version++;
    return;
  }
  const bg = blockGrid(g.map), W = g.map.width;
  // disease: where air, water and crowding are worst, people die faster than they're born
  for (let k = 0; k < 6000; k++) {
    const i = rng.int(0, n - 1);
    if (!w.pop[i]) continue;
    const h = g.env.health[blockOf(bg, i % W, (i / W) | 0)];
    if (h < 0.6 && rng.chance((0.6 - h) * 1.5)) w.pop[i] = Math.max(1, Math.floor(w.pop[i] * 0.95));
  }
  for (let k = 0; k < 3000; k++) {
    const i = rng.int(0, n - 1);
    const cap = Math.min(capFor(w.sub[i]), terrainCap(g.map.terrain[i]), densityCap(g.map, w, i));
    // families grow where it's healthy
    if (w.pop[i] > 0 && !rng.chance(g.env.health[blockOf(bg, i % W, (i / W) | 0)])) continue;
    if (w.pop[i] > 0 && w.pop[i] < cap && (w.use[i] >= Use.Cottage && w.use[i] <= Use.Rowhouses)) {
      w.pop[i] = Math.min(cap, Math.ceil(w.pop[i] * 1.05));
      w.use[i] = useForPop(w.pop[i]);
    }
  }
}

/** The rivals' input needs this season, for the shared river and rail lanes. */
function rivalShippers(_g: GameState, rivals: Plant[]): Shipper[] {
  return rivals.map((p) => {
    const def = RIVALS.find((d) => d.id === p.owner)!;
    const needs: Shipper["needs"] = {};
    for (const [good, per] of Object.entries(INDUSTRIES[def.industry].inputs)) needs[good as keyof typeof needs] = p.output * (per ?? 0);
    return { id: p.owner, site: { x: p.x, y: p.y, fp: p.fp }, needs };
  });
}

export const SPUR_BASE = 10000, SPUR_PER_TILE = 400;
/** Cost and reach of a rail siding from the works to the nearest open line, if one is worth building. */
export function spurQuote(g: GameState): { cost: number; len: number } | null {
  const c = g.company;
  if (!c) return null;
  const o = spurOption(g.map, { x: c.x, y: c.y, fp: c.footprint, spur: c.spur }, cal(g).year);
  return o ? { cost: SPUR_BASE + SPUR_PER_TILE * o.len, len: o.len } : null;
}

/** Build a rail siding from the works to the nearest open line. */
export function buildSpur(g: GameState): { ok: boolean; reason?: string } {
  const c = g.company;
  if (!c) return { ok: false, reason: "No company" };
  const o = spurOption(g.map, { x: c.x, y: c.y, fp: c.footprint, spur: c.spur }, cal(g).year);
  if (!o) return { ok: false, reason: c.spur ? "The works already has a siding" : "No open railroad within reach (or the works is already beside one)" };
  const cost = SPUR_BASE + SPUR_PER_TILE * o.len;
  if (c.cash < cost) return { ok: false, reason: `Needs $${cost.toLocaleString()}` };
  c.cash -= cost;
  c.spur = o.to;
  g.world.version++;
  log(g, `${c.name} lays a ${Math.round(o.len * g.map.metersPerTile)} m rail siding to the main line.`);
  return { ok: true };
}

/** Job centres for the commute model: every works (by the jobs it offers), downtown and the town centres. */
function centersFor(g: GameState) {
  const mine = g.company ? allWorks(g.company) : [];
  const works: WorksSite[] = g.plants.map((p) => {
    const own = mine.find((w) => w.id === p.owner);
    const ind = own ? own.industry : RIVALS.find((d) => d.id === p.owner)?.industry ?? "steel";
    return { x: p.x, y: p.y, fp: p.fp, jobs: own ? Math.max(own.employees, 100) : p.output * INDUSTRIES[ind].workersPerUnit, name: p.owner };
  });
  if (g.company && !g.plants.some((p) => p.owner === "p")) works.push({ x: g.company.x, y: g.company.y, fp: g.company.footprint, jobs: Math.max(100, g.company.employees), name: "p" });
  return jobCenters(g.map, g.world, works, totalPopulation(g));
}

/** The rivals' works this season: their output from the technology of the day. */
function rivalPlants(g: GameState, year: number): Plant[] {
  const out: Plant[] = [];
  for (const r of g.rivals) {
    const def = RIVALS.find((d) => d.id === r.id);
    if (!def || !r.active) continue;
    const ind = INDUSTRIES[def.industry];
    let cap = 1, pol = 1;
    for (const id of rivalTechs(def.industry, def.id, year)) { const t = ind.tech.find((x) => x.id === id); cap += t?.effects.capacity ?? 0; pol += t?.effects.pollution ?? 0; }
    const struck = year === 1892 && (r.id === "frick" || r.id === "carnegie");
    const closed = year >= 1983 && def.industry === "steel";
    const running = struck || closed ? 0 : year >= 1979 && def.industry === "steel" ? 0.55 : 0.85;
    out.push({ x: r.x, y: r.y, fp: r.footprint, output: ind.baseCapacity * cap * running * rivalMult(g, r), pollutionPerUnit: ind.pollutionPerUnit * Math.max(0.1, pol), owner: r.id });
  }
  return out;
}

/** Start the air and rivers in their 1850 state (the city's coal fires have been burning for decades). */
function warmEnvironment(g: GameState) {
  for (let k = 0; k < 8; k++) { updateAir(g.map, g.world, g.env, [], k % 4, 1); updateRivers(g.map, g.world, g.env, []); }
  // long-term soot: the settled average of those seasons
  const bg = blockGrid(g.map), p = g.world.pollution, m = g.map;
  const avg = new Float32Array(bg.n);
  for (let k = 0; k < 4; k++) { updateAir(m, g.world, g.env, [], k, 1); for (let b = 0; b < bg.n; b++) avg[b] += g.env.air[b] / 4; }
  for (let y = 0; y < m.height; y++) for (let x = 0; x < m.width; x++) p[y * m.width + x] = avg[blockOf(bg, x, y)] * SOOT_SCALE;
  updateHealth(m, g.world, g.env);
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
    g.rivals.push({ id: def.id, ownerId, x: best.x, y: best.y, footprint: fp, active: true, riverSide: riverSideOf(g.map, best.x, best.y, fp), expand: 0, damage: [], grudge: 0 });
    log(g, `${def.figures.join(" & ")} open ${def.company} near ${def.site}.`);
  }
}

export function totalPopulation(g: GameState): number {
  let s = 0;
  for (const p of g.world.pop) s += p;
  return s;
}
