// Game state and the seasonal turn loop. First pass: found a works, produce each season,
// pay wages, spread smoke, and let the town grow toward the jobs along real street alignments.

import { INDUSTRIES, type IndustryId } from "./industries";
import { type GameMap, inBounds, recomputeElevation, resetMap, tilesFor } from "./map";
import { RIVALS } from "./rivals";
import { Rng } from "./rng";
import { evaluateSite, footprintTiles, popSAT, siteFields, type SiteFields } from "./site";
import { habitable, Terrain } from "./terrain";
import { calendar, SEASON_EFFECTS, type Calendar } from "./time";
import { activateStreets, generateTown, POP_CAP, recomputeLandValue, Use, useForPop, type World } from "./town";

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
}

export interface RivalState {
  id: string;
  ownerId: number;
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
const WAGE_PER_SEASON_1850 = 60;
const PARTICIPATION = 0.32;

let fieldsCache: { map: GameMap; fields: SiteFields } | null = null;

export function newGame(map: GameMap, seed: number): GameState {
  resetMap(map);
  const world = generateTown(map, seed, 1850);
  if (!fieldsCache || fieldsCache.map !== map) fieldsCache = { map, fields: siteFields(map) };
  return { seed, map, world, fields: fieldsCache.fields, turn: 0, rivals: [], log: [{ turn: 0, text: `Spring 1850. Seed ${seed}.` }] };
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
  };
  log(g, `Founded ${g.company.name} (${ind.startsAs}) for $${rep.cost.toLocaleString()}.`);
  recomputeLandValue(g.map, g.world);
  return { ok: true };
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
  const c0 = cal(g);
  const rng = new Rng(g.seed).fork(`turn${g.turn}`);
  const fx = SEASON_EFFECTS[c0.season];

  if (g.company) runCompany(g, rng, fx.river, fx.floodRisk);
  spawnRivals(g, c0.year);
  decayPollution(g);
  naturalGrowth(g, rng);

  g.turn++;
  const c1 = cal(g);
  if (c1.year !== c0.year) {
    g.world.year = c1.year;
    activateStreets(g.map, g.world);
    recomputeLandValue(g.map, g.world);
    for (const [, l] of Object.entries(g.map.railLines)) if (l.year === c1.year) log(g, `The ${l.name} opens.`);
    for (const [, b] of Object.entries(g.map.bridges)) if (b.year === c1.year) log(g, `The ${b.name} opens.`);
  }
  if (c1.era.id !== c0.era.id) log(g, `A new era begins: ${c1.era.name}.`);
  g.world.version++;
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
  let pool = 0;
  for (let y = cy - R; y <= cy + R; y++) for (let x = cx - R; x <= cx + R; x++) if (inBounds(m, x, y)) pool += g.world.pop[y * m.width + x];
  const workersHired = Math.round(Math.min(workersWanted, pool * PARTICIPATION));
  let output = Math.min(capacity, workersHired / wpu);
  if (ind.site.riverWithinM) output *= riverMult;
  if (riverMult < 1) notes.push(riverMult <= 0.5 ? "River ice cut barge deliveries." : "Low water slowed barges.");

  let flood = 0;
  for (let dy = 0; dy < c.footprint; dy++) for (let dx = 0; dx < c.footprint; dx++)
    if (m.terrain[(c.y + dy) * m.width + c.x + dx] === Terrain.Floodplain) flood++;
  if (flood && rng.chance(floodRisk)) {
    output *= 0.6;
    notes.push("Flood! The works stood in water for weeks.");
    log(g, "Flood damaged the works.");
  }
  output = Math.floor(output);

  const year = cal(g).year;
  const haul = 1 + Math.min(1, (g.fields.coal[cy * m.width + cx] * m.metersPerTile) / ind.site.coalWithinM) * 0.5;
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

  const pol = output * ind.pollutionPerUnit * (1 + mods.pollution);
  const reachM = 250 + Math.sqrt(c.produced) * 6;
  spreadPollution(g, cx, cy, pol, Math.min(tilesFor(m, reachM), 120));

  const shortfall = Math.max(0, workersWanted - workersHired);
  const migrants = settleMigrants(g, cx, cy, R, Math.round(shortfall / PARTICIPATION * 0.35 + workersHired * 0.05));
  if (migrants > 0) notes.push(`${migrants} newcomers settled near the works.`);

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

function decayPollution(g: GameState) {
  const p = g.world.pollution;
  for (let i = 0; i < p.length; i++) if (p[i] > 0) p[i] *= 0.985;
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
    if (u === Use.Civic || u === Use.Landmark || u === Use.Wharf) continue;
    // prefer lots on today's street grid (where the real town grew)
    const streetBonus = m.road[i] ? 6 : nearStreet(g, x, y) ? -3 : 4;
    cands.push({ i, d: Math.hypot(x - cx, y - cy) + (m.terrain[i] === Terrain.Slope ? 4 : 0) + streetBonus });
  }
  cands.sort((a, b) => a.d - b.d);
  let left = count;
  for (const { i } of cands) {
    if (left <= 0) break;
    const room = POP_CAP.rowhouses - w.pop[i];
    if (room <= 0) continue;
    const add = Math.min(room, left, 12);
    w.pop[i] += add;
    left -= add;
    w.use[i] = useForPop(w.pop[i]);
  }
  if (left < count) w.version++;
  return count - left;
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
  for (let k = 0; k < 3000; k++) {
    const i = rng.int(0, n - 1);
    if (w.pop[i] > 0 && w.pop[i] < POP_CAP.rowhouses && (w.use[i] >= Use.Cottage && w.use[i] <= Use.Rowhouses)) {
      w.pop[i] = Math.ceil(w.pop[i] * 1.05);
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
    g.rivals.push({ id: def.id, ownerId, x: best.x, y: best.y, footprint: fp, active: true });
    log(g, `${def.figures.join(" & ")} open ${def.company} near ${def.site}.`);
  }
}

export function totalPopulation(g: GameState): number {
  let s = 0;
  for (const p of g.world.pop) s += p;
  return s;
}
