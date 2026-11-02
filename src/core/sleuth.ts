// Seed blocks grown by SLEUTH (v0.25, experimental; the "sleuth" growth model).
//
// SLEUTH (Clarke, UC Santa Barbara) grows cities by four rules each cycle — spontaneous growth, new spreading
// centres, edge growth and road-influenced growth — governed by five coefficients (dispersion, breed, spread,
// slope resistance, road gravity) that modify themselves in booms and busts. Here a cycle is a season and the
// rules work on blocks:
//
//   spontaneous      a few scattered farmhouses before 1880 (dispersion)
//   spreading centre the seed list (seeds.ts): history decides where neighbourhoods start; company rows open
//                    beside running works and unnamed patches near them (breed)
//   edge growth      each block annexes the best tiles on its frontier (spread, slope); blocks take any shape
//   road-influenced  a walk along streets and streetcar lines from a block's edge; the path is annexed
//                    (road gravity); a streetcar suburb seed opens early when the town reaches it
//   self-modification boom and bust follow the census curve and the Depression and closures; slope resistance
//                    falls as steps, inclines and streetcars arrive; road gravity rises with streetcars and cars
//
// A block is ONE update unit: it holds its people, community mix, density stage and averages (access, land
// value, smoke, health) and is updated once a season. Tiles are its output: written only when it annexes
// land, people arrive or leave, or a community changes. When blocks touch they join a ward (union-find), but
// each block keeps its own update. Real annexations by Pittsburgh (1868, 1872, 1907) happen in play.

import { ANCHORS, anchorAt, G, GROUPS, immigrationPressure, pickGroup } from "./ancestry";
import { simBand } from "./band";
import { blockGrid, blockOf, sampleBlock } from "./blocks";
import { bump, pushHeadline } from "./business";
import { districts } from "./districts";
import { latLonToTile, regionTarget } from "./features";
import type { GameState } from "./game";
import { lotBlocked } from "./growth";
import { inBounds } from "./map";
import { NG } from "./neighbourhood";
import { Rng, tileNoise } from "./rng";
import { RIVALS } from "./rivals";
import { SEED_TYPES, seedsFor, type PlacedSeed, type SeedType } from "./seeds";
import { buildCivic, churchFor, civicDue, fringeOk, fringeSub, isYard, LotSub, mainAxis, platAngle, platStreet, seamStreet, SHOP_CLOSED, squareTiles } from "./platlayout";
import { habitable, Terrain } from "./terrain";
import { densityCap, HouseSub, POP_CAP, ShopSub, Street, terrainCap, Use, useForPop, type World } from "./town";

// ---------------------------------------------------------------- state

export interface Coefficients { dispersion: number; breed: number; spread: number; slope: number; road: number }

/** calibrated starting coefficients (0–100, as in SLEUTH): tests/calibrate.test.ts, coarse 2×2×2 then fine pass,
 * best mean Lee–Sallee 0.305 against v0.24 (v0.24 against itself, another seed: 0.46) */
export const BASE_COEF: Coefficients = { dispersion: 20, breed: 30, spread: 15, slope: 30, road: 90 };
let baseCoef: Coefficients = BASE_COEF;
/** for calibration runs: the coefficients new games start from */
export function setBaseCoef(c: Coefficients) { baseCoef = c; }

export interface Block {
  id: number;
  seed: string;
  name: string;
  type: SeedType;
  opened: number;
  /** union-find parent (a block id); a ward is the set of blocks with the same root */
  ward: number;
  /** seed tile */
  x: number; y: number;
  /** most land it will take */
  size: number;
  /** street-grid orientation: 0 = rows run east–west, 1 = north–south, 2 and 3 = the diagonals (v0.26) */
  angle: number;
  /** the main street runs along the rows (0) or across them (1) */
  main?: number;
  /** the lot set aside for the plat's church (v0.26) */
  res?: number[];
  /** civic land laid out so far: church, school, park, cemetery */
  civ?: string[];
  /** no room for civic land last time: look again from this year */
  civTry?: number;
  /** villas built (suburbs) */
  villas?: number;
  /** houses standing empty since the closures, and when they emptied: [tile, year] */
  vacant?: [number, number][];
  /** land held, tiles with houses, people, people by community */
  land: number; built: number; pop: number; byGroup: number[];
  /** brick rowhouses allowed (the block has filled out) */
  dense: boolean;
  /** averages over its land, refreshed yearly or when it grows by a tenth */
  access: number; lv: number; smoke: number; health: number; sampledAt: number;
  /** taken into a city (Pittsburgh) by annexation, and when */
  city?: string; cityYear?: number;
  /** opened beside this works (company rows) */
  works?: string;
  /** fill cursors into the lot order: lots before `full` are full, before `built` built on (saved with the block,
   *  so a loaded game resumes where the saved one was; reset each year and when people leave) */
  full?: number; builtTo?: number;
}

export interface SleuthState {
  coef: Coefficients;
  base: Coefficients;
  blocks: Block[];
  opened: Record<string, number>;
  /** annexations already made, by municipality name */
  annexed: Record<string, number>;
  /** company rows by works id */
  rows: Record<string, number>;
  patches: number;
  lastRate: number;
}

/**
 * Runtime index of the blocks' tiles and frontiers, rebuilt from world.blockId when a game is loaded. Everything in
 * it is a function of the saved state alone (tiles in index order; frontier = every unclaimed tile touching the
 * block; lots ordered by a fixed weight; scores recomputed each season), so a loaded game plays on exactly as the
 * one that was saved.
 */
interface Runtime {
  w: World; tiles: number[][]; front: Set<number>[];
  /** each block's lots, best first by a fixed weight (ties by tile index), with the weights; null until needed */
  order: (number[] | null)[];
  weight: (number[] | null)[];
  /** the year the frontier scores were worked out in */
  scoreYear: number;
  /** frontier scores within a year; a tile's entry is dropped when a neighbour is annexed (NaN: fails compactness) */
  score: Map<number, number>[];
}
const runtimes = new WeakMap<GameState, Runtime>();

export function blocksOf(g: GameState): Block[] { return g.sleuth?.blocks ?? []; }
export function blockAt(g: GameState, i: number): Block | null { const id = g.world.blockId?.[i]; return id ? g.sleuth!.blocks[id - 1] : null; }

function rt(g: GameState): Runtime {
  let r = runtimes.get(g);
  if (r && r.w === g.world) return r;
  const bs = blocksOf(g), w = g.world, n = w.pop.length;
  r = { w, tiles: bs.map(() => []), front: bs.map(() => new Set<number>()), order: bs.map(() => null), weight: bs.map(() => null), score: bs.map(() => new Map<number, number>()), scoreYear: -1 };
  if (!w.blockId) w.blockId = new Uint16Array(n);
  const id = w.blockId;
  for (let i = 0; i < n; i++) if (id[i]) r.tiles[id[i] - 1].push(i);
  runtimes.set(g, r);
  // frontiers and lot orders exist for every block from the start (so a loaded game holds the same as the saved one)
  for (const b of bs) { rebuildFrontier(g, b); fillOrder(g, b); }
  return r;
}

// ---------------------------------------------------------------- set-up

/** start the block model on a fresh 1850 valley (or an older save): open the 1850 seeds and give them the town */
export function initSleuth(g: GameState) {
  const m = g.map, w = g.world, n = w.pop.length;
  w.blockId = new Uint16Array(n);
  g.sleuth = { coef: { ...baseCoef }, base: { ...baseCoef }, blocks: [], opened: {}, annexed: {}, rows: {}, patches: 0, lastRate: 0 };
  runtimes.delete(g);
  const year = w.year;
  const open = seedsFor(m).filter((s) => s.opens <= year);
  for (const s of open) openBlock(g, s, false);
  // the existing town: developed tiles (and the streets between them) go to the nearest open seed over land,
  // crossing gaps of up to 3 open tiles (which stay open), within 160 tiles
  const band = simBand(m).mask, id = w.blockId, from = new Int32Array(n), steps = new Int32Array(n).fill(-1), gap = new Uint8Array(n), q = new Int32Array(n);
  let h = 0, t = 0;
  for (const b of g.sleuth.blocks) { const i = b.y * m.width + b.x; if (steps[i] < 0) { steps[i] = 0; from[i] = b.id; q[t++] = i; if (isAnnexable(g, i, true)) id[i] = b.id; } }
  while (h < t) {
    const i = q[h++], x = i % m.width, y = (i / m.width) | 0;
    if (steps[i] >= 160) continue;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const xx = x + dx, yy = y + dy;
      if ((!dx && !dy) || !inBounds(m, xx, yy)) continue;
      const j = yy * m.width + xx;
      if (steps[j] >= 0 || !band[j] || m.terrain[j] === Terrain.Water) continue;
      const developed = w.pop[j] > 0 || w.use[j] === Use.Commerce || w.use[j] === Use.Civic || w.street[j] > 0;
      const gj = developed ? 0 : gap[i] + 1;
      if (gj > 3) continue;
      steps[j] = steps[i] + 1; gap[j] = gj; from[j] = from[i];
      if (developed && isAnnexable(g, j, true)) id[j] = from[i];
      q[t++] = j;
    }
  }
  runtimes.delete(g);
  const r = rt(g);
  for (const b of g.sleuth.blocks) resync(g, b, r.tiles[b.id - 1]);
  for (const b of g.sleuth.blocks) sampleFields(g, b, g.commute?.access);
}

function openBlock(g: GameState, s: PlacedSeed | { id: string; name: string; type: SeedType; size: number; x: number; y: number }, annexCore = true, works?: string): Block | null {
  const st = g.sleuth!, m = g.map, w = g.world;
  if (st.opened[s.id] !== undefined) return null;
  const b: Block = {
    id: st.blocks.length + 1, seed: s.id, name: s.name, type: s.type, opened: w.year, ward: st.blocks.length + 1,
    x: s.x, y: s.y, size: s.size, angle: platAngle(m, s.x, s.y), land: 0, built: 0, pop: 0, byGroup: new Array(NG).fill(0),
    dense: s.type === "core", access: 0, lv: 0, smoke: 0, health: 1, sampledAt: 0, works,
  };
  b.main = mainAxis(b, worksPoints(g));
  if (!b.name) b.name = nameFor(g, b);
  st.blocks.push(b);
  st.opened[s.id] = b.id;
  const r = runtimes.get(g);
  if (r) { r.tiles.push([]); r.front.push(new Set()); r.order.push(null); r.weight.push(null); r.score.push(new Map()); fillOrder(g, b); }
  if (annexCore) {
    const i = s.y * m.width + s.x;
    if (!w.blockId![i] && isAnnexable(g, i, true)) annex(g, b, i);
    else rebuildFrontier(g, b);
    layOutSquare(g, b);
    grow(g, b, Math.min(16, Math.max(4, Math.round(b.size * 0.05))), new Rng(`${g.seed}:open:${s.id}`));
    sampleFields(g, b, g.commute?.access);
  }
  return b;
}

function nameFor(g: GameState, b: Block): string {
  const d = districts(g.map), z = d.nb[b.y * g.map.width + b.x];
  const near = z >= 0 ? d.nbs[z].name : "the valley";
  return b.type === "patch" ? `${near} patch` : b.type === "company" ? `${near} company rows` : near;
}

// ---------------------------------------------------------------- land

const NEVER = new Uint8Array(64);
for (const u of [Use.Industry, Use.Rival, Use.Landmark, Use.Incline, Use.Park, Use.Wharf, Use.Mine, Use.Cemetery]) NEVER[u] = 1;

/** can a block take this tile? (`steepOk`: the block builds on steep ground) */
let bandMask: { m: unknown; mask: Uint8Array } | null = null;
function isAnnexable(g: GameState, i: number, steepOk: boolean): boolean {
  const m = g.map, w = g.world;
  if (!bandMask || bandMask.m !== m) bandMask = { m, mask: simBand(m).mask };
  if (w.blockId![i] || !bandMask.mask[i] || w.owner[i] || NEVER[w.use[i]]) return false;
  const t = m.terrain[i];
  if (t === Terrain.Water || t === Terrain.Cliff) return false;
  if (t === Terrain.Steep && !steepOk) return false;
  return true;
}

/** land a block could ever take (outside the band, water and cliffs never): the frontier holds only these */
function everAnnexable(g: GameState, i: number): boolean {
  const m = g.map;
  if (!bandMask || bandMask.m !== m) bandMask = { m, mask: simBand(m).mask };
  const t = m.terrain[i];
  return bandMask.mask[i] === 1 && t !== Terrain.Water && t !== Terrain.Cliff;
}

function steepOkFor(g: GameState, b: Block): boolean {
  // the critical slope falls with the era: hillside blocks from the start, every block from 1900
  return SEED_TYPES[b.type].steep || g.world.year >= 1900;
}

/** take a tile into a block: its houses and people join; neighbours join the frontier; touching blocks join the ward */
function annex(g: GameState, b: Block, i: number) {
  const m = g.map, w = g.world, r = rt(g), W = m.width, x = i % W, y = (i / W) | 0;
  w.blockId![i] = b.id;
  insertSorted(r.tiles[b.id - 1], i);
  r.front[b.id - 1].delete(i);
  b.land++;
  if (w.pop[i]) { b.pop += w.pop[i]; b.byGroup[w.eth[i]] += w.pop[i]; b.built++; }
  // the plat lays out its land (platlayout.ts): its own streets where the map has none, a seam street where it meets a
  // plat on another angle, a suburb's yards, the woods left in its ravines
  if (!w.pop[i] && !w.street[i] && !m.road[i] && w.use[i] <= Use.Farm) {
    const st = platStreet(g, b, x, y) || (SEED_TYPES[b.type].lanes && seamStreet(g, b, x, y, g.sleuth!.blocks) ? Street.Lane : 0);
    if (st) { w.street[i] = st; w.use[i] = Use.Empty; w.sub[i] = 0; }
    else if (isYard(b, x, y)) { w.use[i] = Use.Empty; w.sub[i] = LotSub.Yard; }
    else if (SEED_TYPES[b.type].loose > 0.05 && lotBlocked(m, w.seed)[i]) { w.use[i] = Use.Forest; w.sub[i] = 0; }
  }
  // the new lot takes its place in the block's order
  const had = r.order[b.id - 1] !== null, ord = fillOrder(g, b), v = lotWeight(g, b, i);
  if (had && v > -Infinity) {
    const at = insertLot(ord, r.weight[b.id - 1]!, v, i);
    // a lot that lands ahead of the cursors is still to be filled
    if (at < (b.full ?? 0)) b.full = at;
    if (at < (b.builtTo ?? 0)) b.builtTo = at;
  }
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    const xx = x + dx, yy = y + dy;
    if ((!dx && !dy) || !inBounds(m, xx, yy)) continue;
    const j = yy * W + xx, o = w.blockId![j];
    r.score[b.id - 1].delete(j); // its neighbours in the block changed
    if (!o) { if (everAnnexable(g, j)) r.front[b.id - 1].add(j); }
    else if (o !== b.id) join(g, b.id, o);
  }
}

function rebuildFrontier(g: GameState, b: Block) {
  const m = g.map, w = g.world, r = rt(g), f = r.front[b.id - 1], W = m.width;
  f.clear();
  r.score[b.id - 1].clear();
  for (const i of r.tiles[b.id - 1]) {
    const x = i % W, y = (i / W) | 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const xx = x + dx, yy = y + dy;
      if ((!dx && !dy) || !inBounds(m, xx, yy)) continue;
      const j = yy * W + xx;
      if (!w.blockId![j] && everAnnexable(g, j)) f.add(j);
    }
  }
  // a block with no land yet starts from its seed tile
  if (!r.tiles[b.id - 1].length) f.add(b.y * W + b.x);
}

/**
 * Edge growth: annex the `n` best frontier tiles. Each tile is scored on slope resistance, a street or road beside
 * it, jobs within reach, flat ground, how many of its neighbours the block already holds (compactness: 2 of 8, or
 * 1 along a street, so ribbons follow roads but no lone spikes grow), the block's grid, smoke and a little noise.
 */
function grow(g: GameState, b: Block, n: number, rng: Rng): number {
  const m = g.map, w = g.world, r = rt(g), f = r.front[b.id - 1], W = m.width, st = g.sleuth!;
  if (b.land >= b.size || n <= 0) return 0;
  const access = g.commute?.access, bg = blockGrid(m);
  const slopeK = (st.coef.slope / 100) * 2.2, steepOk = steepOkFor(g, b);
  // scores use only what holds for the year (the map's roads, the block's own lane grid, this year's access and
  // noise) and the block's own tiles, so the cache kept through the year matches a fresh one after loading a save
  const cache = r.score[b.id - 1], lanes = SEED_TYPES[b.type].lanes;
  let made = 0;
  for (let round = 0; round < 3 && made < n && f.size; round++) {
    const scored: [number, number][] = [];
    for (const i of f) {
      if (w.blockId![i]) { f.delete(i); cache.delete(i); continue; }
      if (!isAnnexable(g, i, steepOk)) continue;
      const c = cache.get(i);
      if (c !== undefined) { if (c === c) scored.push([c, i]); continue; }
      const x = i % W, y = (i / W) | 0;
      let k = 0, road = false;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx, yy = y + dy;
        if (!inBounds(m, xx, yy)) continue;
        const j = yy * W + xx;
        if ((dx || dy) && w.blockId![j] === b.id) k++;
        if (m.road[j] || (lanes && onLane(g, b, xx, yy))) road = true;
      }
      if (b.land > 0 && k < 2 && !(k >= 1 && road)) { cache.set(i, NaN); continue; }
      const t = m.terrain[i];
      const s = -slopeK * (m.slope[i] / 30) + (road ? 0.6 : 0) + (access ? 1.6 * sampleBlock(bg, access, x, y) : 0)
        + (t === Terrain.Floodplain || t === Terrain.Flat ? 0.3 : 0) + 0.18 * k - 0.004 * Math.hypot(x - b.x, y - b.y)
        + 0.35 * tileNoise(g.seed + w.year, x, y, 801);
      cache.set(i, s);
      scored.push([s, i]);
    }
    if (!scored.length) break;
    // annex a slice at a time so compactness is re-checked as the block fills in: the best `take` (score, then index)
    const take = Math.min(n - made, scored.length, Math.max(1, Math.ceil(scored.length / 3), Math.ceil(n / 2)), b.size - b.land);
    for (const [, i] of topK(scored, take)) { annex(g, b, i); made++; }
    void rng;
  }
  if (made && b.land > b.sampledAt * 1.1) sampleFields(g, b, access);
  return made;
}

const better = (a: [number, number], c: [number, number]) => a[0] > c[0] || (a[0] === c[0] && a[1] < c[1]);
/** the k best of a list (score descending, then tile index ascending), without sorting all of it */
function topK(list: [number, number][], k: number): [number, number][] {
  if (k <= 0) return [];
  if (k >= list.length) return list.slice().sort((a, c) => c[0] - a[0] || a[1] - c[1]);
  const top: [number, number][] = [];
  for (const e of list) {
    if (top.length === k && !better(e, top[k - 1])) continue;
    let p = top.length < k ? top.length : k - 1;
    if (top.length < k) top.push(e);
    while (p > 0 && better(e, top[p - 1])) { top[p] = top[p - 1]; p--; }
    top[p] = e;
  }
  return top;
}

/** road-influenced growth: walk out along streets and pikes from the block's edge and annex the path */
function roadWalk(g: GameState, b: Block, rng: Rng): number {
  const m = g.map, w = g.world, r = rt(g), W = m.width, st = g.sleuth!;
  const tiles = r.tiles[b.id - 1];
  if (!tiles.length || b.land >= b.size) return 0;
  const steps = Math.round(4 + (st.coef.road / 100) * 14 * SEED_TYPES[b.type].road);
  // start from a block tile on a street
  let cur = -1;
  for (let k = 0; k < 12 && cur < 0; k++) { const i = tiles[rng.int(0, tiles.length - 1)]; if (w.street[i] || m.road[i]) cur = i; }
  if (cur < 0) return 0;
  const steepOk = steepOkFor(g, b);
  // a walk reaches no further from the seed than the block could ever spread (no runaway ribbons)
  const reach = 8 + Math.sqrt(b.size) * 0.9;
  let made = 0, prev = -1;
  for (let s = 0; s < steps && b.land < b.size; s++) {
    const x = cur % W, y = (cur / W) | 0, opts: number[] = [];
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const xx = x + dx, yy = y + dy;
      if ((!dx && !dy) || !inBounds(m, xx, yy)) continue;
      const j = yy * W + xx;
      if (j === prev || !(w.street[j] || m.road[j])) continue;
      if (w.blockId![j] && w.blockId![j] !== b.id) { join(g, b.id, w.blockId![j]); continue; }
      // away from the seed, but within reach
      const d = Math.hypot(xx - b.x, yy - b.y);
      if (d >= Math.hypot(x - b.x, y - b.y) && d <= reach) opts.push(j);
    }
    if (!opts.length) break;
    prev = cur; cur = opts[rng.int(0, opts.length - 1)];
    if (!w.blockId![cur] && isAnnexable(g, cur, steepOk)) { annex(g, b, cur); made++; }
    // the lots either side of the line
    const cx = cur % W, cy = (cur / W) | 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const xx = cx + dx, yy = cy + dy;
      if (!inBounds(m, xx, yy) || b.land >= b.size) continue;
      const j = yy * W + xx;
      if (!w.blockId![j] && isAnnexable(g, j, steepOk) && !w.street[j] && !m.road[j]) { annex(g, b, j); made++; }
    }
  }
  return made;
}

// ---------------------------------------------------------------- wards (union-find)

export function wardOf(g: GameState, id: number): number {
  const bs = g.sleuth!.blocks;
  let r = id;
  while (bs[r - 1].ward !== r) r = bs[r - 1].ward;
  let c = id;
  while (bs[c - 1].ward !== r) { const nx = bs[c - 1].ward; bs[c - 1].ward = r; c = nx; }
  return r;
}

function join(g: GameState, a: number, b: number) {
  const ra = wardOf(g, a), rb = wardOf(g, b);
  if (ra === rb) return;
  const bs = g.sleuth!.blocks, A = bs[ra - 1], B = bs[rb - 1];
  // the older block names the ward
  const older = A.opened < B.opened || (A.opened === B.opened && A.id < B.id) ? A : B, newer = older === A ? B : A;
  newer.ward = older.id;
}

// ---------------------------------------------------------------- people

/** houses a block's tile can hold now */
function tileCap(g: GameState, b: Block, i: number): number {
  const stage = b.dense && SEED_TYPES[b.type].maxUse === "rowhouses" ? POP_CAP.rowhouses : POP_CAP.houses;
  return Math.min(stage, terrainCap(g.map.terrain[i]), densityCap(g.map, g.world, i));
}

/**
 * A lot's fixed weight for filling: frontage on a mapped road or on the block's own lane grid, flat ground, noise,
 * nearness to the seed. Only things that never change, so the order is the same however the block got here.
 * −Infinity: the lot stays open (a mapped road, a ravine or garden, the block's looseness, a cliff).
 */
function lotWeight(g: GameState, b: Block, i: number): number {
  const m = g.map, w = g.world, W = m.width, def = SEED_TYPES[b.type];
  if (m.road[i]) return -Infinity;
  const x = i % W, y = (i / W) | 0, t = m.terrain[i];
  if (isYard(b, x, y) || platStreet(g, b, x, y)) return -Infinity;
  if (lotBlocked(m, w.seed)[i] && def.loose > 0.05) return -Infinity;               // ravines and gardens stay open
  if (tileNoise(w.seed + 17, x, y, 802) < def.loose) return -Infinity;                 // the block's own looseness
  if (t === Terrain.Water || t === Terrain.Cliff) return -Infinity;
  let front = 0;
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const xx = x + dx, yy = y + dy;
    if (!inBounds(m, xx, yy)) continue;
    if (m.road[yy * W + xx] || onLane(g, b, xx, yy)) front = 1;
  }
  return front * 1.0 + (t === Terrain.Flat || t === Terrain.Floodplain ? 0.3 : 0) + 0.4 * tileNoise(w.seed, x, y, 803) - 0.003 * Math.hypot(x - b.x, y - b.y);
}

/** is (x, y) on the block's own lane grid? (lanes every 5 rows along its angle, cross streets every 12) */
function onLane(g: GameState, b: Block, x: number, y: number): boolean {
  return platStreet(g, b, x, y) !== 0;
}

/** can people live on this lot now? (the things that change: streets, buildings, steep ground before 1900) */
function lotOpen(g: GameState, b: Block, i: number): boolean {
  const m = g.map, w = g.world, u = w.use[i];
  if (w.street[i] || u === Use.Civic || u === Use.Commerce || NEVER[u] || w.owner[i] || b.res?.includes(i)) return false;
  if (!w.pop[i]) {
    const t = m.terrain[i];
    if (!habitable(t) && !(t === Terrain.Steep && (SEED_TYPES[b.type].steep || w.year >= 1900))) return false;
  }
  return true;
}

function insertSorted(a: number[], v: number) {
  let lo = 0, hi = a.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (a[mid] < v) lo = mid + 1; else hi = mid; }
  a.splice(lo, 0, v);
}

/** insert lot i (weight v) into the order: weight descending, then tile index ascending */
function insertLot(order: number[], weight: number[], v: number, i: number): number {
  let lo = 0, hi = order.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (weight[mid] > v || (weight[mid] === v && order[mid] < i)) lo = mid + 1; else hi = mid; }
  order.splice(lo, 0, i); weight.splice(lo, 0, v);
  return lo;
}

/** the block's lots, best first */
function fillOrder(g: GameState, b: Block): number[] {
  const r = rt(g), k = b.id - 1;
  let o = r.order[k];
  if (o) return o;
  const wt: [number, number][] = [];
  for (const i of r.tiles[k]) { const v = lotWeight(g, b, i); if (v > -Infinity) wt.push([v, i]); }
  wt.sort((a, c) => c[0] - a[0] || a[1] - c[1]);
  o = wt.map((p) => p[1]);
  r.order[k] = o; r.weight[k] = wt.map((p) => p[0]);
  return o;
}

/** settle `count` people of community `gid` on the block's best lots; returns how many found homes */
function settle(g: GameState, b: Block, gid: number, count: number, newness: number, plants: [number, number][]): number {
  const w = g.world, W = g.map.width, year = w.year, order = fillOrder(g, b);
  let left = count;
  const put = (i: number, add: number) => {
    const p = w.pop[i];
    if (!p) {
      w.eth[i] = gid; w.built[i] = year; b.built++;
      const x = i % W, y = (i / W) | 0;
      w.sub[i] = b.type === "company" ? HouseSub.Company : newness > 0.4 && plants.some(([px, py]) => Math.hypot(px - x, py - y) < 12) ? HouseSub.Shanty : HouseSub.Normal;
      // a streetcar suburb's high ground: a few villas (v0.26)
      if (b.type === "suburb" && (b.villas ?? 0) < 4 && g.map.elevation[i] > g.map.elevation[b.y * W + b.x] + 12 && tileNoise(w.seed, x, y, 907) < 0.3) {
        w.sub[i] = HouseSub.Estate; b.villas = (b.villas ?? 0) + 1;
        w.pop[i] = Math.min(8, left); w.use[i] = Use.Houses; left -= w.pop[i]; b.pop += w.pop[i]; b.byGroup[gid] += w.pop[i];
        return;
      }
    }
    w.pop[i] = p + add;
    w.use[i] = useForPop(w.pop[i]);
    left -= add; b.pop += add; b.byGroup[gid] += add;
  };
  // 1. homes of their own people with room, among the block's best lots (a bounded look from the full-lot cursor)
  let allFull = true;
  for (let o = b.full ?? 0, scanned = 0; o < order.length && left > 0 && scanned < 300; o++) {
    const i = order[o], open = lotOpen(g, b, i), p = w.pop[i], cap = open ? tileCap(g, b, i) : 0;
    // lots that are full, or closed (a lane, a church), are passed for good until the yearly reset
    if (allFull) { if (p >= cap) { b.full = o + 1; continue; } allFull = false; }
    if (!p || !open) continue;
    scanned++;
    if (w.eth[i] !== gid) continue; // share a home with your own
    const add = Math.min(cap - p, left, 10);
    if (add > 0) put(i, add);
  }
  // 2. empty lots, in order (a cursor past every lot that has been built on)
  for (let o = b.builtTo ?? 0; o < order.length && left > 0; o++) {
    const i = order[o];
    if (w.pop[i] || !lotOpen(g, b, i)) { if (o === (b.builtTo ?? 0)) b.builtTo = o + 1; continue; }
    const add = Math.min(tileCap(g, b, i), left, 18);
    if (add > 0) put(i, add);
    if (o === (b.builtTo ?? 0)) b.builtTo = o + 1;
  }
  // a block that has filled out goes up in brick
  if (!b.dense && b.built > 30 && b.pop / Math.max(1, b.built) > POP_CAP.houses * 0.65) b.dense = true;
  return count - left;
}

/** take `count` people out of a block (sickness, leaving), from random homes */
function unsettle(g: GameState, b: Block, count: number, rng: Rng, empty = false) {
  const w = g.world, r = rt(g), tiles = r.tiles[b.id - 1];
  b.full = 0;
  if (empty) b.builtTo = 0;
  for (let k = 0; k < count * 8 + 20 && count > 0 && tiles.length; k++) {
    const i = tiles[rng.int(0, tiles.length - 1)], p = w.pop[i];
    if (!p || w.use[i] < Use.Cottage || w.use[i] > Use.Rowhouses || w.sub[i] === HouseSub.Estate) continue;
    const take = empty ? p : Math.min(p - 1, Math.max(1, Math.ceil(p * 0.05)), count);
    if (take <= 0) continue;
    w.pop[i] = p - take; b.pop -= take; b.byGroup[w.eth[i]] -= take; count -= take;
    if (!w.pop[i]) b.built--;
  }
}

/** board up `homes` houses (the collapse: families leave, the house stands empty) */
function emptyHomes(g: GameState, b: Block, homes: number, rng: Rng) {
  const w = g.world, tiles = rt(g).tiles[b.id - 1];
  if (homes > 0) { b.full = 0; b.builtTo = 0; }
  for (let k = 0; k < homes * 8 + 20 && homes > 0 && tiles.length; k++) {
    const i = tiles[rng.int(0, tiles.length - 1)], p = w.pop[i];
    if (!p || w.use[i] < Use.Cottage || w.use[i] > Use.Rowhouses || w.sub[i] === HouseSub.Estate) continue;
    w.pop[i] = 0; b.pop -= p; b.byGroup[w.eth[i]] -= p; b.built--; homes--;
    (b.vacant ??= []).push([i, w.year]);
  }
}

/** refresh a block's totals from its tiles (events and works change tiles directly) */
function resync(g: GameState, b: Block, tiles: number[]) {
  const w = g.world;
  b.land = tiles.length; b.pop = 0; b.built = 0; b.byGroup = new Array(NG).fill(0);
  for (const i of tiles) if (w.pop[i]) { b.pop += w.pop[i]; b.built++; b.byGroup[w.eth[i]] += w.pop[i]; }
  if (!b.dense && b.built > 30 && b.pop / Math.max(1, b.built) > POP_CAP.houses * 0.65) b.dense = true;
}

/** a block's averages, sampled from the block-grid fields at up to 48 of its tiles */
function sampleFields(g: GameState, b: Block, access?: Float32Array) {
  const tiles = rt(g).tiles[b.id - 1], m = g.map, w = g.world, bg = blockGrid(m);
  if (!tiles.length) { if (access) b.access = sampleBlock(bg, access, b.x, b.y); return; }
  const step = Math.max(1, Math.floor(tiles.length / 48));
  let a = 0, lv = 0, sm = 0, h = 0, n = 0;
  for (let k = 0; k < tiles.length; k += step) {
    const i = tiles[k], x = i % m.width, y = (i / m.width) | 0;
    if (access) a += sampleBlock(bg, access, x, y);
    lv += w.landValue[i]; sm += w.pollution[i]; h += g.env.health[blockOf(bg, x, y)]; n++;
  }
  if (access) b.access = a / n;
  b.lv = lv / n; b.smoke = sm / n; b.health = Math.min(1, h / n + (b.city ? 0.05 : 0)); b.sampledAt = b.land;
}

// ---------------------------------------------------------------- the season

export interface SleuthReport { placed: number; byGroup: number[]; annexed: number; opened: number }

/**
 * One season of growth under the block model: open seeds, the season's arrivals shared among blocks (v0.24's
 * community scoring, once per block), blocks short of room annex land, road walks, turnover, self-modification.
 */
export function sleuthSeason(g: GameState, access: Float32Array, plants: [number, number][], room: number, season: number): SleuthReport {
  if (!g.sleuth) initSleuth(g);
  const st = g.sleuth!, w = g.world, m = g.map, year = w.year, r = rt(g);
  const rng = new Rng(`${g.seed}:sleuth:${year}:${season}`);
  void access; // blocks read the commute's access through their sampled averages
  if (r.scoreYear !== year) { for (const c of r.score) c.clear(); r.scoreYear = year; } // a new year: new access and noise

  const byGroup = new Array(NG).fill(0);
  let placed = 0, annexed = 0, opened = 0;
  selfModify(g);

  // ---- new spreading centres: the seeds whose year has come; company rows by running works; unnamed patches
  for (const s of seedsFor(m)) if (st.opened[s.id] === undefined && year >= s.opens) { if (openBlock(g, s)) opened++; }
  for (const s of seedsFor(m)) if (s.early && st.opened[s.id] === undefined && year >= s.opens - 6 && season === 0 && reached(g, s.x, s.y, 30)) { if (openBlock(g, s)) opened++; }
  opened += companyRows(g, rng);
  // ---- spontaneous: scattered farmhouses before 1880
  if (year < 1880) spontaneous(g, rng);

  const blocks = st.blocks.filter((b) => b.land > 0 || r.front[b.id - 1].size);
  // ---- who is coming (as v0.24): newcomers by this year's waves, locals by today's make-up
  if (room > 0 && blocks.length) {
    const groupTot = new Array(NG).fill(0);
    let total = 0;
    for (const b of blocks) for (let k = 1; k < NG; k++) { groupTot[k] += b.byGroup[k]; total += b.byGroup[k]; }
    const waves = GROUPS.map((gr) => (gr.id ? gr.wave(year) + 0.01 : 0));
    const waveSum = waves.reduce((a, c) => a + c, 0) || 1;
    const newFrac = Math.min(0.8, 0.3 + immigrationPressure(year) * 0.15);
    const people = GROUPS.map((gr) => (gr.id ? room * (newFrac * waves[gr.id] / waveSum + (1 - newFrac) * (total ? groupTot[gr.id] / total : 0)) : 0));
    const newness = GROUPS.map((gr) => (gr.id ? Math.min(1, (waves[gr.id] / waveSum) / ((total ? groupTot[gr.id] / total : 0) + 0.03) / 3) : 0));
    const order = GROUPS.map((gr) => gr.id).filter((gI) => gI && people[gI] >= 15).sort((a, c) => people[c] - people[a]);
    // ward totals for chain migration across neighbouring blocks
    const wardPop = new Map<number, number[]>();
    for (const b of blocks) { const k = wardOf(g, b.id); const a = wardPop.get(k) ?? new Array(NG).fill(0); for (let q = 0; q < NG; q++) a[q] += b.byGroup[q]; wardPop.set(k, a); }
    for (const gI of order) {
      const nw = newness[gI];
      const lvK = 0.45 - 1.0 * nw, polK = -(1.0 - 1.25 * nw);
      // score each block for this community once
      const scores = blocks.map((b) => {
        const wp = wardPop.get(wardOf(g, b.id))!, wt = wp.reduce((a, c) => a + c, 0);
        const own = b.pop ? b.byGroup[gI] / b.pop : 0, ward = wt ? wp[gI] / wt : 0;
        const a = anchorAt(m, b.x, b.y);
        let pull = 0;
        if (a) for (const [gid, f, from, to] of a.prefs) if (gid === gI && year >= (from ?? 0) && year <= (to ?? 9999)) pull += 0.35 * Math.log(f);
        const full = b.land >= b.size ? 0.6 : 0;
        return 1.6 * b.access + 1.8 * Math.pow(0.6 * own + 0.4 * ward, 0.8) + (own > 0.25 ? 0.3 : 0) + pull + lvK * Math.min(1, b.lv / 250)
          + polK * Math.min(1.5, b.smoke) + (year - b.opened < 12 ? 0.25 : 0) - full + 0.3 * tileNoise(g.seed + year * 4 + season, b.id, gI, 804);
      });
      let left = Math.round(people[gI]);
      // chunks to the best blocks; a block's score falls a little with each chunk, so arrivals spread
      for (let tries = 0; left > 0 && tries < 40; tries++) {
        let best = -1;
        for (let k = 0; k < blocks.length; k++) if (scores[k] > -1e8 && (best < 0 || scores[k] > scores[best])) best = k;
        if (best < 0) break;
        const b = blocks[best], chunk = Math.min(left, 80 + Math.round(people[gI] / 6));
        let got = settle(g, b, gI, chunk, nw, plants);
        if (got < chunk && b.land < b.size) {
          // short of room: annex land (edge growth, spread × demand), then a road walk, and try again
          // (land is taken a few seasons ahead, so a block isn't back at its frontier every season)
          const need = Math.ceil((chunk - got) / (b.dense ? 30 : 16));
          const n = Math.max(6, Math.round(need * 5 * (st.coef.spread / 50) * SEED_TYPES[b.type].spread));
          annexed += grow(g, b, n, rng);
          if (year >= 1859 && rng.chance((st.coef.road / 100) * SEED_TYPES[b.type].road * (year >= 1890 ? 1 : 0.4))) annexed += roadWalk(g, b, rng);
          got += settle(g, b, gI, chunk - got, nw, plants);
        }
        left -= got; placed += got; byGroup[gI] += got;
        scores[best] -= got < chunk ? 1e9 : 0.12;
      }
    }
  }
  // ---- turnover: each block's households move up and out; newcomers take their homes
  for (const b of blocks) turnoverBlock(g, b, rng, season);
  st.lastRate = annexed / Math.max(1, blocks.reduce((a, b) => a + b.land, 0));
  if (placed || annexed) w.version++;
  return { placed, byGroup, annexed, opened };
}

// ---------------------------------------------------------------- the plats' year (v0.26, platlayout.ts)

/** the works on the map, as points (for mill towns' main streets and company rows) */
function worksPoints(g: GameState): [number, number][] {
  const pts: [number, number][] = g.rivals.filter((r) => !r.offmap).map((r) => [r.x + r.footprint / 2, r.y + r.footprint / 2]);
  if (g.company) pts.push([g.company.x + g.company.footprint / 2, g.company.y + g.company.footprint / 2]);
  return pts;
}

/** the square a plat sets aside at founding (a market or a green), and the lot beside it kept for its church */
function layOutSquare(g: GameState, b: Block) {
  const w = g.world, m = g.map;
  const sq = squareTiles(g, b);
  let placed = 0;
  for (const t of sq) {
    if (w.blockId![t.i] && w.blockId![t.i] !== b.id) continue;
    if (!w.blockId![t.i]) { if (!isAnnexable(g, t.i, false) || w.pop[t.i] || m.road[t.i] || w.street[t.i]) continue; annex(g, b, t.i); }
    if (w.pop[t.i] || w.street[t.i] || w.use[t.i] > Use.Farm) continue;
    w.use[t.i] = t.use; w.sub[t.i] = t.sub; w.built[t.i] = w.year; placed++;
  }
  // the church lot: on the main street beside the square
  if (placed && b.type !== "patch") {
    for (const t of sq) {
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const x = (t.i % m.width) + dx, y = ((t.i / m.width) | 0) + dy;
        if (!inBounds(m, x, y)) continue;
        const j = y * m.width + x;
        if (w.blockId![j] && w.blockId![j] !== b.id) continue;
        if (w.street[j] || m.road[j] || w.use[j] > Use.Farm || w.pop[j] || platStreet(g, b, x, y)) continue;
        if (!w.blockId![j]) { if (!isAnnexable(g, j, false)) continue; annex(g, b, j); }
        b.res = [j];
        return;
      }
    }
  }
}

/**
 * Once a year, each plat: builds the civic land it has grown into (its church on the lot it kept, a school, a park,
 * a cemetery at its edge); opens shops on its main street; rebuilds old shanties as houses once it has filled; keeps a
 * fringe of gardens and orchards at its edge; and after 1975 clears the houses that have stood empty six years.
 */
function platYear(g: GameState, b: Block) {
  const w = g.world, m = g.map, W = m.width, year = w.year, r = rt(g), tiles = r.tiles[b.id - 1];
  if (!tiles.length) return;
  const rng = new Rng(`${g.seed}:plat:${b.id}:${year}`);
  // the slow work (civic land, shops, rebuilding, the fringe) comes round every third year, the blocks staggered
  const turn = (year + b.id) % 3 === 0;
  // ---- civic land
  if (turn) for (const kind of civicDue(b.type, b.pop, b.land, year)) {
    if (b.civ?.includes(kind)) continue;
    // a plat with no room for it looks again every fourth year, not every year
    if (b.civTry && year < b.civTry) continue;
    const at = civicLots(g, b, kind);
    if (!at.length) { b.civTry = year + 4; continue; }
    for (const i of at) buildCivic(w, i, kind, churchFor(b.byGroup));
    (b.civ ??= []).push(kind);
    if (kind === "church") b.res = [];
    resync(g, b, tiles);
    w.version++;
  }
  // ---- main-street shops: one for every 400 people, on lots fronting its main street
  if (turn && b.pop >= 300 && year < 1975 && b.type !== "patch" && b.type !== "hillside") {
    let shops = 0;
    for (const i of tiles) if (w.use[i] === Use.Commerce && !(w.sub[i] & SHOP_CLOSED)) shops++;
    let want = Math.min(12, Math.floor(b.pop / 400)) - shops;
    for (const i of tiles) {
      if (want <= 0) break;
      if (w.use[i] !== Use.Houses && w.use[i] !== Use.Rowhouses) continue;
      if (w.sub[i] === HouseSub.Estate || !frontsMain(g, b, i) || rng.next() > 0.35) continue;
      b.pop -= w.pop[i]; b.byGroup[w.eth[i]] -= w.pop[i]; b.built--;
      w.use[i] = Use.Commerce; w.sub[i] = rng.chance(0.4) ? ShopSub.Tavern : ShopSub.Store; w.pop[i] = 0; w.was[i] = w.eth[i]; w.built[i] = year;
      want--;
    }
  }
  // ---- old shanties rebuilt as houses once the plat has filled out
  if (turn && year - b.opened >= 15 && b.built > 20 && b.pop / b.built > 14) {
    for (const i of tiles) if (w.sub[i] === HouseSub.Shanty && w.pop[i] && year - w.built[i] >= 15) { w.sub[i] = HouseSub.Normal; w.built[i] = year; }
  }
  // ---- the fringe: gardens and orchards beyond the built edge (a scrapyard or brickyard near works and rail)
  if (turn && year - b.opened >= 3 && year < 1960 && b.type !== "patch") {
    let n = 0;
    for (const i of r.front[b.id - 1]) {
      if (n >= 60) break;
      if (!fringeOk(g, i) || tileNoise(w.seed + b.id, i % W, (i / W) | 0, 906) > 0.55) continue;
      w.use[i] = Use.Farm; w.sub[i] = fringeSub(g, i % W, (i / W) | 0); n++;
    }
  }
  // ---- the decline: houses empty six years are cleared to bare lots; main-street shops close, then are cleared
  if (year >= 1975 && b.vacant?.length) {
    b.vacant = b.vacant.filter(([i, y0]) => {
      if (w.pop[i]) return false; // someone moved back in
      if (year - y0 < 6) return true;
      w.use[i] = Use.Empty; w.sub[i] = LotSub.Cleared; w.built[i] = year; w.street[i] = 0;
      return false;
    });
  }
  if (year >= 1975 && steelTown(g, b, steelWorks(g))) {
    for (const i of tiles) {
      if (w.use[i] !== Use.Commerce) continue;
      if (w.sub[i] & SHOP_CLOSED) { if (year - w.built[i] >= 6) { w.use[i] = Use.Empty; w.sub[i] = LotSub.Cleared; w.built[i] = year; } continue; }
      if (rng.chance(0.12)) { w.sub[i] |= SHOP_CLOSED; w.built[i] = year; }
    }
  }
}

/** does lot i front its plat's main street? */
function frontsMain(g: GameState, b: Block, i: number): boolean {
  const m = g.map, w = g.world, W = m.width, x = i % W, y = (i / W) | 0;
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const xx = x + dx, yy = y + dy;
    if (!inBounds(m, xx, yy)) continue;
    const j = yy * W + xx;
    if (w.street[j] === Street.Pike && w.blockId![j] === b.id) return true;
  }
  return false;
}

/**
 * Where a plat puts civic land: its church on the lot it kept (else a lot on its main street); a school 6–12 tiles
 * from the seed on a street; a park on a 2×2 of open land near its middle; a cemetery on a 2×3 at its edge, slope or
 * not. Empty lots first; a school or church may take a house.
 */
function civicLots(g: GameState, b: Block, kind: string): number[] {
  const m = g.map, w = g.world, W = m.width, tiles = rt(g).tiles[b.id - 1];
  const open = (i: number) => w.blockId![i] === b.id && !w.street[i] && !m.road[i] && w.use[i] <= Use.Farm && !w.pop[i] && !b.res?.includes(i) && m.terrain[i] !== Terrain.Water;
  const d = (i: number) => Math.hypot((i % W) - b.x, ((i / W) | 0) - b.y);
  const onStreet = (i: number) => { const x = i % W, y = (i / W) | 0; for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { if (!inBounds(m, x + dx, y + dy)) continue; const j = (y + dy) * W + x + dx; if (w.street[j] || m.road[j]) return true; } return false; };
  if (kind === "church") {
    if (b.res?.length && w.blockId![b.res[0]] === b.id && !w.pop[b.res[0]] && w.use[b.res[0]] <= Use.Farm) return [b.res[0]];
    const c = tiles.filter((i) => (open(i) || w.use[i] === Use.Houses) && frontsMain(g, b, i));
    return c.length ? [c.reduce((a, i) => (d(i) < d(a) ? i : a))] : [];
  }
  if (kind === "school") {
    const c = tiles.filter((i) => open(i) && onStreet(i) && d(i) >= 6 && d(i) <= 12);
    return c.length ? [c[0]] : [];
  }
  // a cluster: park 2×2 near the middle, cemetery 2×3 at the edge
  const [cw, ch] = kind === "park" ? [2, 2] : [3, 2];
  let best: number[] = [], bs = -Infinity;
  for (const i of tiles) {
    if (!open(i)) continue;
    const x = i % W, y = (i / W) | 0, cl: number[] = [];
    for (let dy = 0; dy < ch && cl.length >= 0; dy++) for (let dx = 0; dx < cw; dx++) { const xx = x + dx, yy = y + dy; if (inBounds(m, xx, yy) && open(yy * W + xx) && m.terrain[yy * W + xx] !== Terrain.Cliff) cl.push(yy * W + xx); }
    if (cl.length < cw * ch) continue;
    const score = kind === "park" ? -d(i) : d(i);
    if (score > bs) { bs = score; best = cl; }
  }
  return best;
}

function steelWorks(g: GameState): [number, number][] {
  return g.rivals.filter((r) => RIVALS.find((d) => d.id === r.id)?.industry === "steel").map((r) => [r.x + r.footprint / 2, r.y + r.footprint / 2]);
}

/** births and deaths per block (and after 1975 the steel towns empty), in place of v0.24's sampled tiles */
export function sleuthNatural(g: GameState) {
  if (!g.sleuth) return;
  const w = g.world, year = w.year, rng = new Rng(`${g.seed}:sleuthnat:${g.turn}`);
  const steel: [number, number][] = g.rivals.filter((r) => RIVALS.find((d) => d.id === r.id)?.industry === "steel").map((r) => [r.x + r.footprint / 2, r.y + r.footprint / 2]);
  for (const b of g.sleuth.blocks) {
    if (!b.pop) continue;
    if (year >= 1975) {
      // a steel town: any of its land within ~1.3 km of a steel works (v0.24's 45 tiles), judged by the block's
      // seed and the far corners of its land
      if (steelTown(g, b, steel)) {
        emptyHomes(g, b, Math.round(b.built * 0.008 + rng.next() * 0.9), rng);
        unsettle(g, b, Math.round(b.pop * 0.0075), rng);
      }
      continue;
    }
    // the same expected change as v0.24's sampling: +5% on 0.58% of homes where healthy, −5% on 1.16% where sickly
    const born = b.pop * 0.0058 * 0.05 * b.health, died = b.health < 0.6 ? b.pop * 0.0116 * (0.6 - b.health) * 1.5 * 0.05 : 0;
    const net = Math.round(born - died + (rng.next() - 0.5));
    if (net > 0) { let gid = 1, best = -1; for (let k = 1; k < NG; k++) if (b.byGroup[k] > best) { best = b.byGroup[k]; gid = k; } settle(g, b, gid, net, 0, []); }
    else if (net < 0) unsettle(g, b, -net, rng);
  }
  w.version++;
}

/** yearly: totals resynced from the tiles, averages resampled, real annexations, early suburbs */
export function sleuthYear(g: GameState) {
  if (!g.sleuth) return;
  const r = rt(g), y = g.world.year;
  for (const b of g.sleuth.blocks) { resync(g, b, r.tiles[b.id - 1]); sampleFields(g, b, g.commute?.access); b.full = 0; b.builtTo = 0; }
  // the plats' own year (v0.26): civic land, main-street shops, houses upgraded, the fringe, the decline
  for (const b of g.sleuth.blocks) platYear(g, b);

  void y;
  annexations(g);
}

function steelTown(g: GameState, b: Block, steel: [number, number][]): boolean {
  const tiles = rt(g).tiles[b.id - 1], W = g.map.width;
  const pts: [number, number][] = [[b.x, b.y]];
  for (let k = 0; k < tiles.length; k += Math.max(1, Math.floor(tiles.length / 24))) pts.push([tiles[k] % W, (tiles[k] / W) | 0]);
  return steel.some(([px, py]) => pts.some(([x, y]) => Math.abs(px - x) < 45 && Math.abs(py - y) < 45));
}

function turnoverBlock(g: GameState, b: Block, rng: Rng, season: number) {
  if (b.built < 4) return;
  const m = g.map, w = g.world, tiles = rt(g).tiles[b.id - 1], W = m.width;
  const a = anchorAt(m, b.x, b.y);
  const active = a?.prefs.some(([, , from, to]) => w.year >= (from ?? 0) && w.year <= (to ?? 9999) && (from ?? 0) > 1850);
  // the same yearly share of homes as v0.24 (3% where a community is arriving, else 0.6%), a quarter a season
  const n = Math.round(b.built * (active ? 0.03 : 0.006) / 4 + rng.next() * 0.9);
  for (let k = 0; k < n; k++) {
    const i = tiles[rng.int(0, tiles.length - 1)];
    if (!w.pop[i] || w.use[i] < Use.Cottage || w.use[i] > Use.Rowhouses || w.sub[i] === HouseSub.Estate) continue;
    const gid = pickGroup(m, w.eth, w.pop, i % W, (i / W) | 0, w.year, rng, active ? 3 : 10);
    if (gid !== w.eth[i]) { b.byGroup[w.eth[i]] -= w.pop[i]; b.byGroup[gid] += w.pop[i]; w.eth[i] = gid; }
  }
  void season;
}

/**
 * SLEUTH's self-modification, tied to the valley: in a boom (the census curve climbing fast) spread and breed
 * rise ×1.01 a season; in a bust (the Depression, the closures after 1975) they fall ×0.9; otherwise they drift
 * back. Slope resistance falls as steps, inclines and streetcars arrive; road gravity rises with streetcars and cars.
 */
function selfModify(g: GameState) {
  const st = g.sleuth!, y = g.world.year, c = st.coef, b = st.base;
  const growth = (regionTarget(y + 1) - regionTarget(y)) / Math.max(1, regionTarget(y));
  const bust = (y >= 1930 && y < 1940) || y >= 1975 || growth < 0;
  const boom = !bust && growth > 0.02;
  for (const k of ["spread", "breed"] as const) {
    if (boom) c[k] = Math.min(b[k] * 2, c[k] * 1.01);
    else if (bust) c[k] = Math.max(b[k] * 0.3, c[k] * 0.9);
    else c[k] += (b[k] - c[k]) * 0.05;
  }
  c.slope = b.slope * (y < 1870 ? 1 : y < 1890 ? 0.85 : y < 1920 ? 0.7 : 0.6);
  c.road = Math.min(100, b.road * (y < 1859 ? 0.3 : y < 1890 ? 0.6 : y < 1920 ? 1.2 : 1.6));
  c.dispersion = y < 1880 ? b.dispersion : b.dispersion * 0.2;
}

/** has any block reached within r tiles of (x, y)? (sampled on a coarse grid) */
function reached(g: GameState, x: number, y: number, r: number): boolean {
  const m = g.map, id = g.world.blockId!;
  for (let dy = -r; dy <= r; dy += 3) for (let dx = -r; dx <= r; dx += 3) if (inBounds(m, x + dx, y + dy) && id[(y + dy) * m.width + x + dx]) return true;
  return false;
}

function spontaneous(g: GameState, rng: Rng) {
  const m = g.map, w = g.world, band = simBand(m), sp = band.spans, n = Math.round((g.sleuth!.coef.dispersion / 100) * 6);
  for (let k = 0; k < n; k++) {
    const s = rng.int(0, sp.length / 3 - 1) * 3, y = sp[s], x = rng.int(sp[s + 1], sp[s + 2] - 1), i = y * m.width + x;
    if (w.pop[i] || w.use[i] > Use.Farm || w.street[i] || m.road[i] || w.blockId![i] || !habitable(m.terrain[i]) || w.owner[i]) continue;
    w.pop[i] = rng.int(4, 8); w.use[i] = Use.Cottage; w.eth[i] = G.OLD; w.built[i] = w.year;
  }
}

/** company rows beside each works once it has run two years; now and then an unnamed patch near one (breed) */
function companyRows(g: GameState, rng: Rng): number {
  const st = g.sleuth!, w = g.world;
  const works: { id: string; x: number; y: number; fp: number }[] = g.rivals.filter((r) => r.active && !r.closed && !r.offmap).map((r) => ({ id: r.id, x: r.x, y: r.y, fp: r.footprint }));
  if (g.company && (g.company.seasonsOperating ?? 0) >= 8) works.push({ id: "player", x: g.company.x, y: g.company.y, fp: g.company.footprint });
  let made = 0;
  for (const wk of works) {
    if (st.rows[wk.id] !== undefined) continue;
    if (wk.id !== "player" && !rng.chance(0.15)) continue;
    const spot = besideWorks(g, wk.x, wk.y, wk.fp);
    if (!spot) { st.rows[wk.id] = 0; continue; }
    const b = openBlock(g, { id: `rows-${wk.id}`, name: "", type: "company", size: 90, x: spot[0], y: spot[1] }, true, wk.id);
    st.rows[wk.id] = b?.id ?? 0;
    if (b) made++;
  }
  // breed: an unnamed patch near a works
  if (works.length && st.patches < 30 && rng.chance((st.coef.breed / 100) * 0.08)) {
    const wk = works[rng.int(0, works.length - 1)];
    const spot = besideWorks(g, wk.x + rng.int(-25, 25), wk.y + rng.int(-25, 25), wk.fp);
    if (spot) { const b = openBlock(g, { id: `patch-bred-${st.patches}`, name: "", type: "patch", size: 40, x: spot[0], y: spot[1] }); if (b) { st.patches++; made++; } }
  }
  void w;
  return made;
}

/** an open, buildable tile 6–20 tiles from a works footprint, not already in a block */
function besideWorks(g: GameState, x: number, y: number, fp: number): [number, number] | null {
  const m = g.map, w = g.world, cx = x + fp / 2, cy = y + fp / 2;
  let best: [number, number] | null = null, bd = Infinity;
  for (let dy = -20; dy <= 20; dy += 2) for (let dx = -20; dx <= 20; dx += 2) {
    const xx = Math.round(cx + dx), yy = Math.round(cy + dy);
    if (!inBounds(m, xx, yy)) continue;
    const d = Math.hypot(dx, dy) - fp / 2;
    if (d < 6 || d > 20) continue;
    const i = yy * m.width + xx;
    if (!isAnnexable(g, i, false) || w.pop[i] || !habitable(m.terrain[i])) continue;
    if (d < bd) { bd = d; best = [xx, yy]; }
  }
  return best;
}

// ---------------------------------------------------------------- annexation by the city

/**
 * In the year a borough was annexed by Pittsburgh (districts.ts: Lawrenceville, East Liberty, Hazelwood 1868;
 * Birmingham 1872; Allegheny City 1907) its blocks join the city's ward. City water and sewers lift their health
 * a little; if your works stands in the borough, its council's favours are gone (influence −3) but city wages and
 * the police steady the men a little (labour +2).
 */
function annexations(g: GameState) {
  const st = g.sleuth!, m = g.map, y = g.world.year, d = districts(m);
  const city = st.blocks.find((b) => b.seed === "pittsburgh");
  for (let k = 0; k < d.munis.length; k++) {
    const mu = d.munis[k];
    if (!mu.annexed || mu.annexed[0] !== y || st.annexed[mu.name]) continue;
    st.annexed[mu.name] = y;
    const taken = st.blocks.filter((b) => d.muni[b.y * m.width + b.x] === k);
    for (const b of taken) { b.city = mu.annexed[1]; b.cityYear = y; if (city) join(g, city.id, b.id); }
    const people = taken.reduce((a, b) => a + b.pop, 0);
    pushHeadline(g, `${mu.annexed[1]} Annexes ${mu.name}`,
      `${mu.name} becomes part of ${mu.annexed[1]}${people ? `, bringing ${Math.round(people / 100) * 100} people under city hall` : ""}. City water and sewers follow; the borough council's favours end.`, "Politics");
    const c = g.company;
    if (c && d.muni[(c.y + (c.footprint >> 1)) * m.width + c.x + (c.footprint >> 1)] === k) { bump(g, "influence", -3); bump(g, "labour", 2); }
  }
}

// ---------------------------------------------------------------- the player's plats

/** the player plats company housing (projects.ts): the plat is a seed; its block grows outward from there */
export function platCompanyHousing(g: GameState, x: number, y: number, size: number): Block | null {
  if (!g.sleuth) return null;
  const n = Object.keys(g.sleuth.opened).filter((k) => k.startsWith("plat-player")).length;
  return openBlock(g, { id: `plat-player-${n}`, name: `${g.company?.name.replace(/\.$/, "") ?? "Company"} plat`, type: "company", size: Math.max(60, size * size * 6), x, y }, true, "player");
}

// ---------------------------------------------------------------- reports

/** how far the land, as a shape, fills its bounding box (1 = a full rectangle) — for the shape measure */
export function blockFill(g: GameState, b: Block): number {
  const tiles = rt(g).tiles[b.id - 1], W = g.map.width;
  if (!tiles.length) return 1;
  let x0 = W, x1 = 0, y0 = Infinity, y1 = 0;
  for (const i of tiles) { const x = i % W, y = (i / W) | 0; x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  return tiles.length / ((x1 - x0 + 1) * (y1 - y0 + 1));
}

export function blockTiles(g: GameState, b: Block): readonly number[] { return rt(g).tiles[b.id - 1]; }

/** saving rounds the commute's access (save.ts): scores worked out from the unrounded values are dropped */
export function sleuthSaving(g: GameState) { const r = runtimes.get(g); if (r) { for (const c of r.score) c.clear(); r.scoreYear = -1; } }

export { ANCHORS, latLonToTile };
