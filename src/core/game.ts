// Game state and the seasonal turn loop. Deliberately simple first pass:
// found a works, produce each season, pay wages, spread pollution, and let the town grow toward the jobs.

import { INDUSTRIES, type IndustryId } from "./industries";
import { type GameMap, inBounds } from "./map";
import { RIVALS } from "./rivals";
import { Rng } from "./rng";
import { evaluateSite, popSAT, siteFields, type SiteFields } from "./site";
import { Terrain } from "./terrain";
import { calendar, SEASON_EFFECTS, type Calendar } from "./time";
import { generateTown, recomputeLandValue, Use, type World } from "./town";

export interface Company {
  name: string;
  industry: IndustryId;
  cash: number;
  x: number; y: number;      // footprint NW corner
  footprint: number;
  techs: string[];
  employees: number;
  produced: number;          // lifetime units
  seasonsOperating: number;
  lastSeason?: SeasonReport;
}

export interface RivalState {
  id: string;
  ownerId: number;           // value used in world.owner
  x: number; y: number;
  footprint: number;
  active: boolean;
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
}

export const STARTING_CASH = 100000;
const WAGE_PER_SEASON_1850 = 60; // ~$0.75/day * 80 working days
const PARTICIPATION = 0.32;     // share of residents who'll take mill work

export function newGame(map: GameMap, seed: number): GameState {
  const world = generateTown(map, seed);
  return { seed, map, world, fields: siteFields(map), turn: 0, rivals: [], log: [{ turn: 0, text: `Spring 1850. Seed ${seed}.` }] };
}

export function cal(g: GameState): Calendar {
  return calendar(g.turn);
}

export function foundCompany(g: GameState, industry: IndustryId, x: number, y: number, name?: string): { ok: boolean; reason?: string } {
  if (g.company) return { ok: false, reason: "Company already founded" };
  const rep = evaluateSite(g.map, g.world, g.fields, industry, x, y);
  if (!rep.ok) return { ok: false, reason: rep.reasons.join("; ") };
  if (rep.cost > STARTING_CASH) return { ok: false, reason: `Costs $${rep.cost.toLocaleString()}, you have $${STARTING_CASH.toLocaleString()}` };
  const ind = INDUSTRIES[industry];
  claimFootprint(g, x, y, ind.site.footprint, 1, Use.Industry);
  g.company = {
    name: name ?? `${ind.name} Co.`,
    industry,
    cash: STARTING_CASH - rep.cost,
    x, y,
    footprint: ind.site.footprint,
    techs: [ind.tech[0].id],
    employees: 0,
    produced: 0,
    seasonsOperating: 0,
  };
  log(g, `Founded ${g.company.name} (${ind.startsAs}) for $${rep.cost.toLocaleString()}.`);
  recomputeLandValue(g.map, g.world);
  return { ok: true };
}

function claimFootprint(g: GameState, x: number, y: number, fp: number, owner: number, use: Use) {
  const { map: m, world: w } = g;
  for (let dy = 0; dy < fp; dy++) for (let dx = 0; dx < fp; dx++) {
    const i = (y + dy) * m.width + (x + dx);
    w.owner[i] = owner;
    w.use[i] = use;
    w.pop[i] = 0;
  }
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

/** Residents within radius of a point (Chebyshev). */
function laborPool(g: GameState, cx: number, cy: number, r: number) {
  const { map: m, world: w } = g;
  let sum = 0;
  for (let y = cy - r; y <= cy + r; y++) for (let x = cx - r; x <= cx + r; x++)
    if (inBounds(m, x, y)) sum += w.pop[y * m.width + x];
  return sum;
}

export function advanceTurn(g: GameState): void {
  const c0 = cal(g);
  const rng = new Rng(g.seed).fork(`turn${g.turn}`);
  const fx = SEASON_EFFECTS[c0.season];

  if (g.company) runCompany(g, rng, fx.river, fx.floodRisk);
  spawnRivals(g, c0.year);
  decayPollution(g);
  naturalGrowth(g, rng);
  if (g.turn % 4 === 3) recomputeLandValue(g.map, g.world);

  g.turn++;
  const c1 = cal(g);
  if (c1.era.id !== c0.era.id) log(g, `A new era begins: ${c1.era.name}.`);
}

function runCompany(g: GameState, rng: Rng, riverMult: number, floodRisk: number) {
  const c = g.company!;
  const ind = INDUSTRIES[c.industry];
  const mods = techMods(c);
  const cx = c.x + (c.footprint >> 1), cy = c.y + (c.footprint >> 1);
  const notes: string[] = [];

  const capacity = ind.baseCapacity * (1 + mods.capacity);
  const wpu = Math.max(0.03, ind.workersPerUnit * (1 + mods.workersPerUnit));
  const workersWanted = Math.round(capacity * wpu);
  const pool = laborPool(g, cx, cy, ind.site.laborRadius) * PARTICIPATION;
  const workersHired = Math.round(Math.min(workersWanted, pool));
  let output = Math.min(capacity, workersHired / wpu);
  if (ind.site.riverWithin) output *= riverMult;
  if (riverMult < 1) notes.push(riverMult <= 0.5 ? "River ice cut barge deliveries." : "Low water slowed barges.");

  // floods hit floodplain plants in spring
  let floodTiles = 0;
  for (let dy = 0; dy < c.footprint; dy++) for (let dx = 0; dx < c.footprint; dx++)
    if (g.map.terrain[(c.y + dy) * g.map.width + c.x + dx] === Terrain.Floodplain) floodTiles++;
  if (floodTiles && rng.chance(floodRisk)) {
    output *= 0.6;
    notes.push("Flood! The works stood in water for weeks.");
    log(g, "Flood damaged the works.");
  }
  output = Math.floor(output);

  const year = cal(g).year;
  const haul = 1 + Math.min(1, g.fields.coal[cy * g.map.width + cx] / ind.site.coalWithin) * 0.5;
  const unitInput = Object.values(ind.inputs).reduce((a, b) => a + (b ?? 0), 0) * 5 * haul * (1 - mods.efficiency);
  const price = ind.basePrice * (1 + (year - 1850) * 0.004);
  const wage = WAGE_PER_SEASON_1850 * (1 + (year - 1850) * 0.012);

  const revenue = Math.round(output * price);
  const inputCost = Math.round(output * unitInput);
  const wages = Math.round(workersHired * wage);
  const profit = revenue - inputCost - wages;
  c.cash += profit;
  c.employees = workersHired;
  c.produced += output;
  c.seasonsOperating++;

  // pollution: local first, reach grows with scale
  const pol = output * ind.pollutionPerUnit * (1 + mods.pollution);
  const reach = Math.round(3 + Math.sqrt(c.produced) / 40);
  spreadPollution(g, cx, cy, pol, Math.min(reach, 40));

  // the town answers the jobs: migrants settle near the works
  const shortfall = Math.max(0, workersWanted - workersHired);
  const migrants = settleMigrants(g, cx, cy, ind.site.laborRadius, Math.round(shortfall / PARTICIPATION * 0.35 + workersHired * 0.05));
  if (migrants > 0) notes.push(`${migrants} newcomers settled near the works.`);

  c.lastSeason = { produced: output, revenue, inputCost, wages, profit, workersWanted, workersHired, migrants, notes };
}

function spreadPollution(g: GameState, cx: number, cy: number, amount: number, r: number) {
  const { map: m, world: w } = g;
  for (let y = cy - r; y <= cy + r; y++) for (let x = cx - r; x <= cx + r; x++) {
    if (!inBounds(m, x, y)) continue;
    const d = Math.hypot(x - cx, y - cy);
    if (d > r) continue;
    // smoke drifts east with the prevailing westerlies
    const drift = x >= cx ? 1.25 : 0.8;
    w.pollution[y * m.width + x] += amount * drift * (1 - d / (r + 1)) ** 2 * 0.05;
  }
}

function decayPollution(g: GameState) {
  const p = g.world.pollution;
  for (let i = 0; i < p.length; i++) if (p[i] > 0) p[i] *= 0.985;
}

const CAP_BY_USE: Partial<Record<number, number>> = { 0: 60, 2: 40, 3: 60, 4: 140, 5: 300 };

/** Add `count` people to habitable tiles nearest (cx,cy), densifying as they fill. Returns people placed. */
function settleMigrants(g: GameState, cx: number, cy: number, r: number, count: number): number {
  if (count <= 0) return 0;
  const { map: m, world: w } = g;
  const cands: { i: number; d: number }[] = [];
  for (let y = cy - r; y <= cy + r; y++) for (let x = cx - r; x <= cx + r; x++) {
    if (!inBounds(m, x, y)) continue;
    const i = y * m.width + x;
    const t = m.terrain[i];
    if (w.owner[i] || t === Terrain.Water || t === Terrain.Steep) continue;
    if (w.use[i] === Use.Civic) continue;
    const roadBonus = w.road[i] ? -2 : 0;
    cands.push({ i, d: Math.hypot(x - cx, y - cy) + (t === Terrain.Slope ? 3 : 0) + roadBonus });
  }
  cands.sort((a, b) => a.d - b.d);
  let left = count;
  for (const { i } of cands) {
    if (left <= 0) break;
    const cap = 300;
    const room = cap - w.pop[i];
    if (room <= 0) continue;
    const add = Math.min(room, left, 40);
    w.pop[i] += add;
    left -= add;
    const p = w.pop[i];
    w.use[i] = p >= 140 ? Use.Rowhouses : p >= 40 ? Use.Houses : Use.Cottage;
  }
  return count - left;
}

function naturalGrowth(g: GameState, rng: Rng) {
  // ~1.5%/yr in settled tiles, applied per season on a random sample
  const { world: w } = g;
  const n = w.pop.length;
  for (let k = 0; k < 400; k++) {
    const i = rng.int(0, n - 1);
    if (w.pop[i] > 0 && w.pop[i] < (CAP_BY_USE[w.use[i]] ?? 300)) w.pop[i] = Math.min(65535, Math.ceil(w.pop[i] * 1.06));
  }
}

function spawnRivals(g: GameState, year: number) {
  for (const def of RIVALS) {
    if (def.entryYear !== year || g.rivals.some((r) => r.id === def.id)) continue;
    const lm = g.map.landmarks.find((l) => l.name === def.site);
    if (!lm) continue;
    // best valid site near the historic location
    const sat = popSAT(g.map, g.world);
    let best: { x: number; y: number; s: number } | null = null;
    for (let dy = -10; dy <= 10; dy++) for (let dx = -10; dx <= 10; dx++) {
      const x = lm.x + dx, y = lm.y + dy;
      const rep = evaluateSite(g.map, g.world, g.fields, def.industry, x, y, sat);
      if (!rep.ok) continue;
      const s = rep.score - Math.hypot(dx, dy) * 2;
      if (!best || s > best.s) best = { x, y, s };
    }
    if (!best) continue;
    const fp = INDUSTRIES[def.industry].site.footprint;
    const ownerId = 2 + g.rivals.length;
    claimFootprint(g, best.x, best.y, fp, ownerId, Use.Rival);
    g.rivals.push({ id: def.id, ownerId, x: best.x, y: best.y, footprint: fp, active: true });
    log(g, `${def.figures.join(" & ")} open ${def.company} near ${def.site}.`);
  }
}

export function totalPopulation(g: GameState): number {
  let s = 0;
  for (const p of g.world.pop) s += p;
  return s;
}
