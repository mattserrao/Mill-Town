// The environment: smoke in the air, filth in the rivers, and what they do to people.
//
// Air:    every works (yours and the rivals'), every home burning coal, the railroads and the traffic emit smoke into
//         4×4-tile blocks. Smoke drifts east on the westerlies and clears each season, more slowly on valley floors
//         in autumn and winter (inversions) and quickly on the ridges. Long-term exposure (the per-tile
//         `pollution` the town has always used: soot, land value) is a running average of the air.
// Water:  works outfalls and town sewage load the rivers; the load flows downstream (to the Point on the Mon and
//         Allegheny, away from it on the Ohio) and slowly clears. Until filtration (1908) the riverside towns drink it.
// Health: air + water + crowding. Unrest: poor health, crowding and the grievances of the era.

import { B, blockGrid, blockOf, blockStatics, disperse, percentile, upsample } from "./blocks";
import type { GameMap } from "./map";
import { Terrain } from "./terrain";
import { Use, type World } from "./town";

export interface Plant { x: number; y: number; fp: number; output: number; pollutionPerUnit: number; owner: string; /** river outfall multiplier (dumping ×3, treatment ×0.4) */ outfall?: number }

export interface Env {
  /** smoke in the air this season, per block */
  air: Float32Array;
  /** commuter trips through each block (set by the commute model) */
  traffic: Float32Array;
  trafficNorm: number;
  /** 0..1 per block, updated yearly */
  health: Float32Array;
  unrest: Float32Array;
  /** river pollution on water tiles */
  river: Float32Array;
  /** tons moving along water / rail tiles this season (set by the freight model) */
  freight: Float32Array;
  freightNorm: number;
  /** where this season's smoke came from, for the query card */
  shares: { works: number; homes: number; rail: number; traffic: number };
}

export function newEnv(m: GameMap): Env {
  const g = blockGrid(m), n = m.width * m.height;
  return {
    air: new Float32Array(g.n), traffic: new Float32Array(g.n), trafficNorm: 1,
    health: new Float32Array(g.n).fill(1), unrest: new Float32Array(g.n),
    river: new Float32Array(n), freight: new Float32Array(n), freightNorm: 1,
    shares: { works: 0, homes: 0, rail: 0, traffic: 0 },
  };
}

const SEASON_HEAT = [0.9, 0.3, 1.1, 1.8]; // spring, summer, autumn, winter: coal in the kitchen range and the grate
/** household coal smoke by year: the 1884–91 natural-gas boom, then smoke control from 1946 */
export function homeCoal(year: number): number {
  if (year >= 1884 && year < 1891) return 0.35;
  if (year < 1946) return 1;
  if (year < 1953) return 1 - (year - 1946) * 0.11;
  return 0.15;
}
const HOME_K = 0.001;         // smoke per person per season (×heat ×coal era)
const WORKS_K = 0.4;            // smoke per unit of plant pollution
const COMMERCE_K = 0.06;      // per shop / office / church boiler per season (×heat ×coal era)
const RAIL_K = 0.012;          // per open rail tile per season, steam era
const TRAFFIC_K = 0.0009;      // per trip unit, motor era
/** smoke → the long-term soot index the town uses (`world.pollution`) */
export const SOOT_SCALE = 0.3;
const SOOT_ALPHA = 0.1;        // ~2.5 years memory

/** One season of air: emit, hold (inversions), disperse, and fold into long-term soot. */
export function updateAir(m: GameMap, w: World, env: Env, plants: Plant[], season: number, mult: number) {
  const g = blockGrid(m), st = blockStatics(m);
  const E = new Float32Array(g.n);
  let works = 0, homes = 0, rail = 0, traffic = 0;
  for (const p of plants) {
    const amt = p.output * p.pollutionPerUnit * WORKS_K * mult;
    // spread over the blocks the works covers
    const bs: number[] = [];
    for (let y = p.y; y < p.y + p.fp; y += B) for (let x = p.x; x < p.x + p.fp; x += B) bs.push(blockOf(g, Math.min(m.width - 1, x), Math.min(m.height - 1, y)));
    for (const b of bs) E[b] += amt / bs.length;
    works += amt;
  }
  const heat = SEASON_HEAT[season] * homeCoal(w.year) * mult;
  const steam = w.year < 1955 ? 1 : Math.max(0, 1 - (w.year - 1955) / 8); // diesels replace steam
  for (let y = 0; y < m.height; y++) {
    const row = y * m.width, brow = (y / B | 0) * g.bw;
    for (let x = 0; x < m.width; x++) {
      const i = row + x;
      if (w.pop[i]) { const e = w.pop[i] * HOME_K * heat; E[brow + (x / B | 0)] += e; homes += e; }
      else if (w.use[i] === Use.Commerce || w.use[i] === Use.Civic) { const e = COMMERCE_K * heat; E[brow + (x / B | 0)] += e; homes += e; } // boilers of shops, offices, hotels, churches
    }
  }
  if (steam) for (const i of openRail(m, w.year)) { const e = RAIL_K * steam * mult; E[blockOf(g, i % m.width, (i / m.width) | 0)] += e; rail += e; }
  const motor = w.year < 1915 ? 0 : Math.min(1, (w.year - 1915) / 35);
  if (motor) for (let b = 0; b < g.n; b++) if (env.traffic[b]) { const e = env.traffic[b] * TRAFFIC_K * motor * mult; E[b] += e; traffic += e; }
  env.shares = { works, homes, rail, traffic };

  // hold: valley floors keep their smoke under autumn/winter inversions; ridges and open water clear
  const inversion = season >= 2 ? 0.35 : 0.1;
  const a = env.air;
  for (let b = 0; b < g.n; b++) {
    const r = Math.max(0.25, Math.min(0.85, 0.5 + st.trap[b] * inversion - st.ridge[b] * 0.15 - st.water[b] * 0.05));
    a[b] = a[b] * r + E[b];
  }
  // four steps of drift and spread per season: a works' smoke reaches the next mill town
  const t = disperse(g, a);
  disperse(g, t, a);
  disperse(g, a, t);
  disperse(g, t, a); // back into env.air

  // long-term exposure per tile
  const p = w.pollution, k = SOOT_SCALE * SOOT_ALPHA;
  upsample(m, env.air, (i, v) => { p[i] = p[i] * (1 - SOOT_ALPHA) + v * k; });
}

let railCache: { m: GameMap; year: number; tiles: number[] } | null = null;
/** rail tiles on lines open in `year` */
function openRail(m: GameMap, year: number): number[] {
  if (railCache && railCache.m === m && railCache.year === year) return railCache.tiles;
  const open = new Set<number>();
  for (const [id, l] of Object.entries(m.railLines)) if (l.year <= year) open.add(Number(id));
  const tiles: number[] = [];
  for (let i = 0; i < m.rail.length; i++) if (m.rail[i] && open.has(m.rail[i])) tiles.push(i);
  railCache = { m, year, tiles };
  return tiles;
}

// ---------------------------------------------------------------- rivers

interface RiverStatics {
  order: Int32Array;            // water tiles, upstream first
  up: Int32Array[];             // per position in `order`: positions of upstream neighbours
  pos: Int32Array;              // tile → position in order (-1 = not water)
  nearWater: Int32Array;        // tile → nearest water tile
  nearDist: Uint16Array;        // tiles to it
}
const riverCache = new WeakMap<GameMap, RiverStatics>();

function riverStatics(m: GameMap): RiverStatics {
  let r = riverCache.get(m);
  if (r) return r;
  const n = m.width * m.height, W = m.width;
  // distance along the water from the Point
  const point = m.landmarks.find((l) => l.name.startsWith("The Point"));
  const d = new Int32Array(n).fill(-1);
  const q = new Int32Array(n);
  let h = 0, t = 0;
  let start = -1, bd = Infinity;
  for (let i = 0; i < n; i++) if (m.terrain[i] === Terrain.Water && point) {
    const dd = Math.hypot((i % W) - point.x, ((i / W) | 0) - point.y);
    if (dd < bd) { bd = dd; start = i; }
  }
  if (start >= 0) { d[start] = 0; q[t++] = start; }
  while (h < t) {
    const i = q[h++], x = i % W, y = (i / W) | 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= m.height) continue;
      const j = ny * W + nx;
      if (d[j] < 0 && m.terrain[j] === Terrain.Water) { d[j] = d[i] + 1; q[t++] = j; }
    }
  }
  // flow position: the Mon and the Allegheny flow to the Point, the Ohio away from it
  const flow = new Float64Array(n);
  const water: number[] = [];
  for (let i = 0; i < n; i++) {
    if (m.terrain[i] !== Terrain.Water || d[i] < 0) continue;
    const name = m.waterNames[String(m.water[i])] ?? "";
    flow[i] = /Ohio/.test(name) ? d[i] : -d[i];
    water.push(i);
  }
  water.sort((a, b) => flow[a] - flow[b]);
  const pos = new Int32Array(n).fill(-1);
  water.forEach((i, k) => (pos[i] = k));
  const up: Int32Array[] = water.map((i) => {
    const x = i % W, y = (i / W) | 0, l: number[] = [];
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= m.height) continue;
      const j = ny * W + nx;
      if (pos[j] >= 0 && flow[j] < flow[i]) l.push(pos[j]);
    }
    return Int32Array.from(l);
  });
  // nearest water tile for every land tile (multi-source BFS)
  const nearWater = new Int32Array(n).fill(-1), nearDist = new Uint16Array(n).fill(65535);
  h = 0; t = 0;
  for (const i of water) { nearWater[i] = i; nearDist[i] = 0; q[t++] = i; }
  while (h < t) {
    const i = q[h++], x = i % W, y = (i / W) | 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= m.height) continue;
      const j = ny * W + nx;
      if (nearDist[j] === 65535) { nearDist[j] = nearDist[i] + 1; nearWater[j] = nearWater[i]; q[t++] = j; }
    }
  }
  r = { order: Int32Array.from(water), up, pos, nearWater, nearDist };
  riverCache.set(m, r);
  return r;
}

const SEWAGE_K = 0.00004;
const OUTFALL_K = 0.05;
/** river pollution at which drinking it is as bad as it gets */
export const RIVER_REF = 1.2;

/** One season of river water: outfalls and sewage, carried downstream. */
export function updateRivers(m: GameMap, w: World, env: Env, plants: Plant[], sewageMult = 1) {
  const r = riverStatics(m);
  const load = new Float32Array(r.order.length);
  for (const p of plants) {
    const c = (p.y + (p.fp >> 1)) * m.width + p.x + (p.fp >> 1);
    const wi = r.nearWater[c];
    if (wi >= 0 && r.nearDist[c] < 40 && r.pos[wi] >= 0) load[r.pos[wi]] += p.output * p.pollutionPerUnit * OUTFALL_K * (p.outfall ?? 1);
  }
  // town sewage runs to the nearest river (sewers emptied straight into the rivers)
  for (let i = 0; i < w.pop.length; i++) {
    if (!w.pop[i] || r.nearDist[i] > 80) continue;
    const wi = r.nearWater[i];
    if (wi >= 0 && r.pos[wi] >= 0) load[r.pos[wi]] += w.pop[i] * SEWAGE_K * sewageMult;
  }
  const v = new Float32Array(r.order.length);
  for (let k = 0; k < r.order.length; k++) {
    const u = r.up[k];
    let s = 0;
    for (let j = 0; j < u.length; j++) s += v[u[j]];
    v[k] = load[k] + (u.length ? (s / u.length) * 0.997 : 0);
  }
  env.river.fill(0);
  for (let k = 0; k < r.order.length; k++) env.river[r.order[k]] = v[k];
}

/** how much a tile's people suffer from drinking river water this year (0..1) */
export function drinkingRisk(m: GameMap, env: Env, i: number, year: number): number {
  const r = riverStatics(m);
  if (r.nearDist[i] > 120) return 0;
  const wi = r.nearWater[i];
  const filtered = year < 1908 ? 1 : year < 1915 ? 0.35 : 0.1; // Pittsburgh's sand filtration plant, 1908
  return Math.min(1, (env.river[wi] / RIVER_REF) * filtered);
}

// ---------------------------------------------------------------- health and unrest

/** grievances of the era independent of place: the twelve-hour day, the Depression, the union years, the layoffs */
export function eraGrievance(year: number): number {
  if (year < 1877) return 0.05;
  if (year < 1923) return 0.18;
  if (year < 1930) return 0.08;
  if (year < 1937) return 0.22;
  if (year < 1979) return 0.0;
  return 0.25;
}

/** Yearly: health from air, water and crowding; unrest from health, crowding and the era. */
export function updateHealth(m: GameMap, w: World, env: Env, hospitals: { x: number; y: number }[] = [], boosts: { x: number; y: number; r: number; water: number; health: number; unrest: number }[] = []) {
  const g = blockGrid(m);
  const air = new Float32Array(g.n), water = new Float32Array(g.n), pop = new Float32Array(g.n), homes = new Float32Array(g.n);
  for (let y = 0; y < m.height; y++) for (let x = 0; x < m.width; x++) {
    const i = y * m.width + x, b = blockOf(g, x, y);
    if (!w.pop[i]) continue;
    pop[b] += w.pop[i];
    air[b] += w.pollution[i] * w.pop[i];
    water[b] += drinkingRisk(m, env, i, w.year) * w.pop[i];
    const u = w.use[i];
    if (u >= Use.Cottage && u <= Use.Rowhouses) homes[b]++;
  }
  const grievance = eraGrievance(w.year);
  for (let b = 0; b < g.n; b++) {
    if (!pop[b]) { env.health[b] = 1; env.unrest[b] = 0; continue; }
    const airT = Math.min(1, air[b] / pop[b] / 1.2);
    const waterT = water[b] / pop[b];
    const crowd = Math.max(0, Math.min(1, pop[b] / Math.max(1, homes[b]) / 50 - 0.3));
    // a hospital within reach (about 1½ miles) takes the edge off sickness
    const bx = (b % g.bw) * 4 + 2, by = Math.floor(b / g.bw) * 4 + 2;
    const care = hospitals.some((h) => Math.abs(h.x - bx) < 50 && Math.abs(h.y - by) < 50) ? 0.08 : 0;
    // a company's investments in its neighbourhood (src/core/hood.ts): mains and sewers, care, amenity
    let wMult = 1, plus = 0, calm = 0;
    for (const o of boosts) if (Math.abs(o.x - bx) <= o.r && Math.abs(o.y - by) <= o.r) { wMult *= o.water; plus += o.health; calm += o.unrest; }
    const health = Math.max(0.15, Math.min(1, 1 - 0.35 * airT - 0.45 * waterT * wMult - 0.25 * crowd + care + plus));
    env.health[b] = health;
    env.unrest[b] = Math.max(0, Math.min(1, 0.5 * (1 - health) + 0.25 * crowd + grievance - calm));
  }
}

export { percentile };
