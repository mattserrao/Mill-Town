// Seeded 1850 town generation and the dynamic per-tile world layers.
// Towns grow along today's real street network (old streets mostly survive), farms take the flats
// and uplands, woods the hillsides. Pikes between towns follow real arterial alignments; rivers
// are crossed only on the bridges that existed (or by ferry).

import { DIAMOND, HILLSIDES, INCLINES, latLonToTile, regionTarget, tileLine } from "./features";
import { type GameMap, idx, inBounds, sat, satSum, tilesFor } from "./map";
import { Rng, tileNoise, valueNoise } from "./rng";
import { habitable, Terrain, TRAVEL_COST } from "./terrain";

export const enum Use {
  Empty = 0,
  Forest = 1,
  Farm = 2,
  Cottage = 3,   // scattered houses
  Houses = 4,    // frame houses
  Rowhouses = 5, // dense brick
  Civic = 6,     // church / market
  Industry = 7,  // your works
  Rival = 8,     // rival works
  Wharf = 9,     // stone river landing
  Landmark = 10, // historic structure
  Rock = 11,     // bare bluff
  Commerce = 12, // shops, taverns, hotels, banks, market (sub)
  Mine = 13,     // drift mine with tipple
  Incline = 14,  // inclined plane railway (sub = incline id)
}

/** sub-types: houses / rowhouses */
export const enum HouseSub { Normal = 0, Estate = 1, Company = 2, Shanty = 3, Boarding = 4 }
/** sub-types: commerce */
export const enum ShopSub { Tavern = 1, Store = 2, Hotel = 3, Bank = 4, Market = 5 }
/** sub-types: civic */
export const enum CivicSub { Church = 0, OnionChurch = 1, School = 2, Firehouse = 3, Library = 4 }

export const USE_NAMES: Record<number, string> = {
  0: "Open land", 1: "Woods", 2: "Farm", 3: "Cottages", 4: "Frame houses", 5: "Brick rowhouses",
  6: "Church", 7: "Your works", 8: "Rival works", 9: "Wharf", 10: "Landmark", 11: "Bare rock",
  12: "Business", 13: "Coal mine", 14: "Incline",
};
export const SUB_NAMES: Record<number, Record<number, string>> = {
  3: { 1: "Estate", 2: "Company houses", 3: "Shanties" },
  4: { 1: "Mansion", 2: "Company double houses", 3: "Shanties" },
  5: { 4: "Boarding houses" },
  6: { 0: "Church", 1: "Church (onion domes)", 2: "School", 3: "Firehouse", 4: "Library" },
  12: { 1: "Tavern", 2: "General store", 3: "Hotel", 4: "Bank", 5: "Market house" },
};

export const enum Street { None = 0, Lane = 1, Pike = 2, Bridge = 3, Steps = 4 }

export const STRUCTURES = ["", "blockhouse", "courthouse", "arsenal", "penitentiary"] as const;
const STRUCTURE_SIZE: Record<string, number> = { blockhouse: 1, courthouse: 2, arsenal: 3, penitentiary: 3 };

/** 1850 settlements (populations approximate; ± variation by seed). Reach in metres. */
export const SETTLEMENTS_1850: { landmark: string; pop: number; reachM: number }[] = [
  { landmark: "The Point (Pittsburgh)", pop: 46000, reachM: 1800 },
  { landmark: "Allegheny City", pop: 21000, reachM: 1500 },
  { landmark: "Birmingham (South Side)", pop: 3500, reachM: 700 },
  { landmark: "Lawrenceville", pop: 2500, reachM: 600 },
  { landmark: "East Liberty", pop: 1000, reachM: 450 },
  { landmark: "McKeesport", pop: 1400, reachM: 450 },
  { landmark: "Hazelwood", pop: 300, reachM: 250 },
  { landmark: "Braddock", pop: 300, reachM: 250 },
  { landmark: "Homestead", pop: 120, reachM: 180 },
  { landmark: "Duquesne", pop: 100, reachM: 180 },
  { landmark: "Clairton", pop: 100, reachM: 180 },
];

export const POP_CAP = { cottage: 8, houses: 24, rowhouses: 70 };

/** Hillside lots hold frame houses, not brick blocks: hillside 24 people, steep 14. */
export function terrainCap(t: number): number {
  return t === Terrain.Steep ? 14 : t === Terrain.Slope ? POP_CAP.houses : POP_CAP.rowhouses;
}

export interface World {
  seed: number;
  year: number;
  pop: Uint16Array;
  use: Uint8Array;
  street: Uint8Array;      // Street
  structure: Uint8Array;   // index into STRUCTURES at the drawn tile, 255 = part of a structure
  owner: Uint8Array;       // 0 private/town, 1 player, 2+ rivals
  pollution: Float32Array;
  landValue: Float32Array;
  sub: Uint8Array;         // building sub-type (HouseSub / ShopSub / CivicSub / incline id)
  built: Uint16Array;      // year the current building went up (drives its architectural style)
  settlements: { name: string; x: number; y: number; pop: number }[];
  /** bumped whenever tiles change, so renderers can drop caches */
  version: number;
}

export function useForPop(p: number): Use {
  // (company and shanty lots are capped below the rowhouse threshold by the game)
  return p > POP_CAP.houses ? Use.Rowhouses : p > POP_CAP.cottage ? Use.Houses : Use.Cottage;
}

const DX = [1, -1, 0, 0, 1, 1, -1, -1];
const DY = [0, 0, 1, -1, 1, -1, 1, -1];

/** Dijkstra over terrain from a source, preferring today's streets. */
export function costField(m: GameMap, sx: number, sy: number, maxCost: number): Float64Array {
  const n = m.width * m.height;
  const dist = new Float64Array(n).fill(Infinity);
  const heap = new MinHeap();
  const s = idx(m, sx, sy);
  dist[s] = 0;
  heap.push(s, 0);
  while (heap.size) {
    const [i, d] = heap.pop();
    if (d > dist[i] || d > maxCost) continue;
    const x = i % m.width, y = (i / m.width) | 0;
    for (let k = 0; k < 8; k++) {
      const nx = x + DX[k], ny = y + DY[k];
      if (!inBounds(m, nx, ny)) continue;
      const j = ny * m.width + nx;
      const t = m.terrain[j];
      if (t === Terrain.Water && !m.bridge[j]) continue;
      const base = t === Terrain.Water ? 1 : TRAVEL_COST[t];
      const step = base * (m.road[j] ? 0.55 : 1) * (k >= 4 ? 1.414 : 1);
      const nd = d + step;
      if (nd < dist[j]) { dist[j] = nd; heap.push(j, nd); }
    }
  }
  return dist;
}

export function activeBridge(m: GameMap, i: number, year: number): boolean {
  const b = m.bridge[i];
  return b > 0 && (m.bridges[String(b)]?.year ?? 9999) <= year;
}

export function generateTown(m: GameMap, seed: number, year = 1850): World {
  const n = m.width * m.height;
  const rng = new Rng(seed).fork("town");
  const w: World = {
    seed, year,
    pop: new Uint16Array(n),
    use: new Uint8Array(n),
    street: new Uint8Array(n),
    structure: new Uint8Array(n),
    owner: new Uint8Array(n),
    pollution: new Float32Array(n),
    landValue: new Float32Array(n),
    sub: new Uint8Array(n),
    built: new Uint16Array(n),
    settlements: [],
    version: 1,
  };

  // ---- landmark structures reserve their ground first
  for (const lm of m.landmarks) {
    if (!lm.kind.startsWith("structure:")) continue;
    const type = lm.kind.slice(10);
    const sidx = STRUCTURES.indexOf(type as (typeof STRUCTURES)[number]);
    const sz = STRUCTURE_SIZE[type] ?? 1;
    for (let dy = 0; dy < sz; dy++) for (let dx = 0; dx < sz; dx++) {
      const x = lm.x + dx, y = lm.y + dy;
      if (!inBounds(m, x, y)) continue;
      const i = y * m.width + x;
      if (m.terrain[i] === Terrain.Water) continue;
      w.use[i] = Use.Landmark;
      w.structure[i] = dx === sz - 1 && dy === sz - 1 ? sidx : 255;
    }
  }
  // ---- wharves
  for (let i = 0; i < n; i++) if (m.special[i] === 1) { w.use[i] = Use.Wharf; }

  // ---- settlements: spread along today's streets outward from each centre
  const nearRoad = new Uint8Array(n);
  for (let y = 0; y < m.height; y++) for (let x = 0; x < m.width; x++) {
    if (!m.road[y * m.width + x]) continue;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++)
      if (inBounds(m, x + dx, y + dy)) nearRoad[(y + dy) * m.width + x + dx] = 1;
  }
  SETTLEMENTS_1850.forEach((s, si) => {
    const lm = m.landmarks.find((l) => l.name === s.landmark);
    if (!lm) return;
    const target = Math.round(s.pop * rng.range(0.8, 1.25));
    const reach = tilesFor(m, s.reachM);
    const field = costField(m, lm.x, lm.y, reach * 1.6);
    const cands: { i: number; score: number }[] = [];
    for (let i = 0; i < n; i++) {
      if (!isFinite(field[i]) || !habitable(m.terrain[i]) || w.pop[i] > 0 || w.use[i]) continue;
      if (m.road[i]) continue; // street tiles stay streets
      const x = i % m.width, y = (i / m.width) | 0;
      const jitter = valueNoise(seed, x, y, 9, si + 1) * reach * 0.25 + tileNoise(seed, x, y, si) * 2;
      const offStreet = nearRoad[i] ? 0 : reach * 0.15;
      const hill = m.terrain[i] === Terrain.Slope ? reach * 0.12 : 0;
      cands.push({ i, score: field[i] + jitter + offStreet + hill });
    }
    cands.sort((a, b) => a.score - b.score);
    let left = target, placed = 0;
    const coreTiles = Math.max(6, target / 60);
    for (const c of cands) {
      if (left <= 0) break;
      const core = Math.max(0.06, 1 - placed / (coreTiles * 2.2));
      const slopeMult = m.terrain[c.i] === Terrain.Slope ? 0.5 : 1;
      const p = Math.min(left, Math.max(2, Math.round(POP_CAP.rowhouses * core * slopeMult * rng.range(0.75, 1.1))));
      w.pop[c.i] = p;
      w.use[c.i] = useForPop(p);
      left -= p;
      placed++;
    }
    w.settlements.push({ name: s.landmark, x: lm.x, y: lm.y, pop: target - Math.max(0, left) });
    // the well-off build at the edge of the bigger towns, on good ground
    if (target >= 1000) {
      for (let k = Math.floor(placed * 0.55); k < placed; k++) {
        const ci = cands[k].i;
        const t = m.terrain[ci];
        if (w.use[ci] === Use.Houses && (t === Terrain.Flat || t === Terrain.Upland || t === Terrain.Slope) && rng.chance(0.14)) {
          w.sub[ci] = HouseSub.Estate; w.pop[ci] = 8;
        }
      }
    }
    // churches: one per ~4000 people, at well-ranked tiles
    const churches = Math.max(1, Math.round(target / 4000));
    for (let k = 0; k < churches && k * 7 < cands.length; k++) {
      const c = cands[Math.min(cands.length - 1, Math.floor((k * placed) / churches) + (k ? 3 : 0))];
      if (w.pop[c.i] > 0) { w.use[c.i] = Use.Civic; w.pop[c.i] = 0; }
    }
  });

  // ---- streets: today's streets inside settled areas, plus bridges standing in this year
  activateStreets(m, w);

  // ---- businesses along the main streets of the bigger towns
  const big = new Set(w.settlements.filter((s) => s.pop >= 1000).map((s) => s.name));
  for (let i = 0; i < n; i++) {
    if (w.use[i] !== Use.Rowhouses && w.use[i] !== Use.Houses) continue;
    if (w.sub[i]) continue;
    const x = i % m.width, y = (i / m.width) | 0;
    let pike = false, lane = false;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      if (!inBounds(m, x + dx, y + dy)) continue;
      const st = w.street[(y + dy) * m.width + x + dx];
      if (st === Street.Pike) pike = true;
      if (st === Street.Lane) lane = true;
    }
    if (!pike && !lane) continue;
    const r = tileNoise(seed, x, y, 301);
    if (r > (pike ? 0.16 : 0.05)) continue;
    let near = w.settlements[0], nd = Infinity;
    for (const st of w.settlements) { const d = Math.hypot(st.x - x, st.y - y); if (d < nd) { nd = d; near = st; } }
    if (!big.has(near.name)) continue;
    const k = tileNoise(seed, x, y, 302);
    const pgh = near.name.startsWith("The Point");
    w.use[i] = Use.Commerce;
    w.sub[i] = k < 0.36 ? ShopSub.Tavern : k < 0.78 ? ShopSub.Store : k < 0.92 || !pgh ? ShopSub.Hotel : ShopSub.Bank;
  }
  // market house on the Diamond
  {
    const [dx, dy] = latLonToTile(m, DIAMOND[0], DIAMOND[1]);
    if (inBounds(m, dx, dy) && m.terrain[dy * m.width + dx] !== Terrain.Water) {
      const i = dy * m.width + dx;
      w.use[i] = Use.Commerce; w.sub[i] = ShopSub.Market; w.pop[i] = 0; w.street[i] = 0;
    }
  }

  // ---- countryside: fields in cells, woods on hillsides
  for (let i = 0; i < n; i++) {
    if (w.use[i] || w.street[i]) continue;
    const t = m.terrain[i];
    if (t === Terrain.Water) continue;
    const x = i % m.width, y = (i / m.width) | 0;
    if (t === Terrain.Cliff) { w.use[i] = tileNoise(seed, x, y, 77) < 0.55 ? Use.Rock : Use.Forest; continue; }
    if (t === Terrain.Steep) { w.use[i] = Use.Forest; continue; }
    const cx = Math.floor(x / 7), cy = Math.floor(y / 5);
    const cell = tileNoise(seed, cx, cy, 101);
    const flatish = t === Terrain.Flat || t === Terrain.Upland || t === Terrain.Floodplain;
    const woods = valueNoise(seed, x, y, 14, 102);
    if (flatish && cell > 0.3 && woods < 0.62) w.use[i] = Use.Farm;
    else if (t === Terrain.Slope && cell > 0.75 && woods < 0.5) w.use[i] = Use.Farm;
    else if (woods > 0.38 || t === Terrain.Slope) w.use[i] = Use.Forest;
    else w.use[i] = Use.Empty;
  }
  // farmhouses: one near the middle of some field cells
  for (let i = 0; i < n; i++) {
    if (w.use[i] !== Use.Farm) continue;
    const x = i % m.width, y = (i / m.width) | 0;
    if (x % 7 === 3 && y % 5 === 2 && tileNoise(seed, x, y, 103) < 0.45) { w.use[i] = Use.Cottage; w.pop[i] = rng.int(4, 8); }
  }

  // ---- drift mines on the Pittsburgh seam where it outcrops near the river and the towns
  {
    const mines: [number, number][] = [];
    const riverNear = (x: number, y: number) => {
      for (let dy = -12; dy <= 12; dy += 2) for (let dx = -12; dx <= 12; dx += 2)
        if (inBounds(m, x + dx, y + dy) && m.terrain[(y + dy) * m.width + x + dx] === Terrain.Water) return true;
      return false;
    };
    const order: number[] = [];
    for (let i = 0; i < n; i++) if (m.coal[i] === 2 && (m.terrain[i] === Terrain.Slope || m.terrain[i] === Terrain.Steep) && !w.street[i] && w.use[i] <= Use.Farm) order.push(i);
    order.sort((a, b) => tileNoise(seed, a, 0, 401) - tileNoise(seed, b, 0, 401));
    for (const i of order) {
      if (mines.length >= 16) break;
      const x = i % m.width, y = (i / m.width) | 0;
      if (mines.some(([a, b]) => Math.hypot(a - x, b - y) < 18)) continue;
      if (!w.settlements.some((s) => Math.hypot(s.x - x, s.y - y) < 110)) continue;
      if (!riverNear(x, y)) continue;
      mines.push([x, y]);
      w.use[i] = Use.Mine; w.pop[i] = 0;
    }
  }

  // ---- building ages: 1850's houses went up over the previous sixty years
  for (let i = 0; i < n; i++) {
    if (w.use[i] >= Use.Cottage && w.use[i] <= Use.Civic || w.use[i] === Use.Commerce)
      w.built[i] = 1850 - Math.floor(tileNoise(seed, i, 7, 501) * 60);
  }
  activateFeatures(m, w);

  // ---- pikes between settlements (nearest-first spanning tree)
  const order = w.settlements.slice();
  const connected = [order.shift()!];
  while (order.length) {
    let best = 0, bestFrom = connected[0], bestD = Infinity;
    order.forEach((s, k) => connected.forEach((c) => {
      const d = Math.hypot(s.x - c.x, s.y - c.y);
      if (d < bestD) { bestD = d; best = k; bestFrom = c; }
    }));
    const s = order.splice(best, 1)[0];
    carveRoad(m, w, bestFrom.x, bestFrom.y, s.x, s.y);
    connected.push(s);
  }

  recomputeLandValue(m, w);
  return w;
}

/** Nearest lowest (dir -1) or highest (dir 1) dry tile within r — stations sit at the foot and the brow. */
function snapHeight(m: GameMap, x: number, y: number, r: number, dir: number): [number, number] {
  let best: [number, number] = [x, y], bv = -Infinity;
  for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
    const nx = x + dx, ny = y + dy;
    if (!inBounds(m, nx, ny) || dx * dx + dy * dy > r * r) continue;
    const i = ny * m.width + nx;
    if (m.terrain[i] === Terrain.Water) continue;
    const v = m.elevation[i] * dir - Math.hypot(dx, dy) * 0.4;
    if (v > bv) { bv = v; best = [nx, ny]; }
  }
  return best;
}

/** Inclines open in their year: track tiles from the river-level station up the bluff. */
export function activateFeatures(m: GameMap, w: World) {
  for (const inc of INCLINES) {
    if (inc.year > w.year) continue;
    const [x0, y0] = snapHeight(m, ...latLonToTile(m, inc.lower[0], inc.lower[1]), 12, -1);
    const [x1, y1] = snapHeight(m, ...latLonToTile(m, inc.upper[0], inc.upper[1]), 10, 1);
    for (const [x, y] of tileLine(x0, y0, x1, y1)) {
      if (!inBounds(m, x, y)) continue;
      const i = y * m.width + x;
      if (w.use[i] === Use.Incline || m.terrain[i] === Terrain.Water) continue;
      w.use[i] = Use.Incline; w.sub[i] = inc.id; w.pop[i] = 0; w.street[i] = 0;
      if (!w.built[i]) w.built[i] = inc.year;
    }
  }
}

// ---------------------------------------------------------------- walking: streets, steps, inclines, grade

/**
 * Walking cost field from (sx, sy) in "flat street tiles" (30 m each, ~0.4 min).
 * Streets wind up hills (gentle grade penalty), public steps climb directly, inclines lift for free,
 * open hillside is slow; rivers only on bridges (ferry otherwise).
 */
export function walkField(m: GameMap, w: World, sx: number, sy: number, maxCost: number): Float64Array {
  const n = m.width * m.height;
  const dist = new Float64Array(n).fill(Infinity);
  const heap = new MinHeap();
  const s = idx(m, sx, sy);
  dist[s] = 0;
  heap.push(s, 0);
  while (heap.size) {
    const [i, d] = heap.pop();
    if (d > dist[i] || d > maxCost) continue;
    const x = i % m.width, y = (i / m.width) | 0;
    for (let k = 0; k < 8; k++) {
      const nx = x + DX[k], ny = y + DY[k];
      if (!inBounds(m, nx, ny)) continue;
      const j = ny * m.width + nx;
      const t = m.terrain[j];
      const dh = Math.abs(m.elevation[j] - m.elevation[i]);
      let c: number;
      if (t === Terrain.Water) c = w.street[j] === Street.Bridge ? 1 : 30;
      else if (w.use[j] === Use.Incline && w.use[i] === Use.Incline) c = 0.4;
      else if (w.street[j] === Street.Steps) c = 1.3 + dh * 0.12;
      else if (w.street[j]) c = 1 + dh * 0.22;
      else c = TRAVEL_COST[t] * 1.6 + dh * 0.35;
      const nd = d + c * (k >= 4 ? 1.414 : 1);
      if (nd < dist[j]) { dist[j] = nd; heap.push(j, nd); }
    }
  }
  return dist;
}

export const WALK_MIN_PER_COST = 0.4;

/** Lots a growing town may take. Steep lots only where a hillside neighbourhood is open (or pressure is high). */
function lotOk(m: GameMap, w: World, i: number, steepOk: boolean) {
  const t = m.terrain[i];
  if (w.owner[i] || w.street[i] || m.road[i] && !steepOk) return false;
  const u = w.use[i];
  if (u === Use.Civic || u === Use.Landmark || u === Use.Wharf || u === Use.Commerce || u === Use.Mine || u === Use.Incline || u === Use.Industry || u === Use.Rival) return false;
  if (m.road[i]) return false;
  return habitable(t) || (steepOk && t === Terrain.Steep);
}

/**
 * Grow `count` people around (cx, cy) within `reach` walking cost, along today's streets.
 * Fills existing lots first, then opens new ones nearest first. Returns people placed.
 */
export function growAround(m: GameMap, w: World, cx: number, cy: number, reach: number, count: number, opts: {
  steep: boolean; seed: number; plants?: [number, number][]; cap?: number;
}): number {
  if (count <= 0) return 0;
  const field = walkField(m, w, cx, cy, reach);
  const nearRoad = (x: number, y: number) => {
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++)
      if (inBounds(m, x + dx, y + dy) && (m.road[(y + dy) * m.width + x + dx] || w.street[(y + dy) * m.width + x + dx])) return true;
    return false;
  };
  const cands: { i: number; s: number }[] = [];
  const R = Math.ceil(reach);
  for (let y = Math.max(0, cy - R); y <= Math.min(m.height - 1, cy + R); y++) for (let x = Math.max(0, cx - R); x <= Math.min(m.width - 1, cx + R); x++) {
    const i = y * m.width + x;
    if (!isFinite(field[i]) || !lotOk(m, w, i, opts.steep)) continue;
    const cap = Math.min(opts.cap ?? POP_CAP.rowhouses, terrainCap(m.terrain[i]));
    if (w.pop[i] >= cap) continue;
    const onStreet = nearRoad(x, y);
    if (!onStreet && w.pop[i] === 0) continue; // houses front onto streets
    // hillsides keep wooded ravines and gaps between the terraces
    const t = m.terrain[i];
    if (w.pop[i] === 0 && (t === Terrain.Steep || t === Terrain.Slope) && valueNoise(opts.seed & 0xffff, x, y, 5, 612) > (t === Terrain.Steep ? 0.55 : 0.68)) continue;
    const steepPenalty = m.terrain[i] === Terrain.Steep ? 2 : m.terrain[i] === Terrain.Slope ? 0.8 : 0;
    cands.push({ i, s: field[i] + steepPenalty + tileNoise(opts.seed, x, y, 611) * 4 - (w.pop[i] > 0 ? 3 : 0) });
  }
  cands.sort((a, b) => a.s - b.s);
  let left = count;
  for (const { i } of cands) {
    if (left <= 0) break;
    const cap = Math.min(opts.cap ?? POP_CAP.rowhouses, terrainCap(m.terrain[i]));
    const fresh = w.pop[i] === 0;
    const add = Math.min(cap - w.pop[i], left, fresh ? 18 : 10);
    if (add <= 0) continue;
    w.pop[i] += add;
    left -= add;
    w.use[i] = useForPop(w.pop[i]);
    if (fresh) {
      w.built[i] = w.year;
      const x = i % m.width, y = (i / m.width) | 0;
      const near = opts.plants?.some(([px, py]) => Math.hypot(px - x, py - y) < 12);
      w.sub[i] = near ? HouseSub.Shanty : 0;
    }
  }
  if (left < count) w.version++;
  return count - left;
}

/** Yearly regional growth: the city and the mill towns grow toward the historical population, up the hillsides. */
export function growRegion(m: GameMap, w: World, plants: [number, number][], currentPop: number) {
  const target = regionTarget(w.year);
  const room = Math.round((target - currentPop) * 0.6);
  if (room <= 0) return;
  const shares: { x: number; y: number; reach: number; weight: number; steep: boolean }[] = [];
  for (const h of HILLSIDES) {
    if (w.year < h.year) continue;
    const ramp = w.year <= h.peak ? 1 : Math.max(0.15, 1 - (w.year - h.peak) / 30);
    const [x, y] = latLonToTile(m, h.lat, h.lon);
    shares.push({ x, y, reach: (h.radiusM / m.metersPerTile) * 1.8, weight: h.weight * ramp * 1.6, steep: true });
  }
  for (const s of w.settlements) shares.push({ x: s.x, y: s.y, reach: 70, weight: s.pop > 5000 ? 1.2 : 0.35, steep: false });
  for (const [x, y] of plants) shares.push({ x: Math.round(x), y: Math.round(y), reach: 60, weight: 1.0, steep: w.year >= 1880 });
  const total = shares.reduce((a, s) => a + s.weight, 0);
  for (const s of shares) {
    const n = Math.round((room * s.weight) / total);
    growAround(m, w, s.x, s.y, s.reach, n, { steep: s.steep, seed: w.seed + w.year, plants });
  }
  addSteps(m, w);
}

/**
 * Public steps: where houses have climbed a hillside, run a flight of steps straight down the slope
 * to the nearest street below (Pittsburgh has hundreds of these).
 */
export function addSteps(m: GameMap, w: World, maxNew = 24, around?: [number, number, number], any = false): number {
  const W = m.width;
  let made = 0;
  const tops: number[] = [];
  for (let i = 0; i < w.pop.length; i++) {
    if (!w.pop[i] || (m.terrain[i] !== Terrain.Steep && m.terrain[i] !== Terrain.Slope)) continue;
    const x = i % W, y = (i / W) | 0;
    if (around && Math.hypot(x - around[0], y - around[1]) > around[2]) continue;
    if (!any) {
      if (tileNoise(w.seed, Math.floor(x / 6), Math.floor(y / 6), 707) > 0.75) continue; // ~one candidate per 6x6 block
      if (x % 6 !== 3 || y % 6 !== 3) continue;
    }
    tops.push(i);
  }
  if (around) tops.sort((a, b) => Math.hypot((a % W) - around[0], ((a / W) | 0) - around[1]) - Math.hypot((b % W) - around[0], ((b / W) | 0) - around[1]));
  for (const top of tops) {
    if (made >= maxNew) break;
    const tx = top % W, ty = (top / W) | 0;
    // already served?
    let served = false;
    for (let dy = -4; dy <= 4 && !served; dy++) for (let dx = -4; dx <= 4; dx++)
      if (inBounds(m, tx + dx, ty + dy) && w.street[(ty + dy) * W + tx + dx] === Street.Steps) { served = true; break; }
    if (served) continue;
    // walk downhill greedily through non-built tiles until a street at least 12 m lower
    const path: number[] = [];
    let cur = top, ok = false;
    const h0 = m.elevation[top];
    for (let step = 0; step < 30; step++) {
      const x = cur % W, y = (cur / W) | 0;
      let best = -1, bh = m.elevation[cur];
      for (let k = 0; k < 4; k++) {
        const nx = x + DX[k], ny = y + DY[k];
        if (!inBounds(m, nx, ny)) continue;
        const j = ny * W + nx;
        if (m.terrain[j] === Terrain.Water) continue;
        if (m.elevation[j] < bh - 0.5) { bh = m.elevation[j]; best = j; }
      }
      if (best < 0) break;
      cur = best;
      if (w.street[cur] && w.street[cur] !== Street.Steps && h0 - m.elevation[cur] >= 12) { ok = true; break; }
      const u = w.use[cur];
      if (u === Use.Civic || u === Use.Landmark || u === Use.Industry || u === Use.Rival || u === Use.Commerce) break;
      path.push(cur);
    }
    if (!ok || path.length < 3) continue;
    for (const j of path) {
      w.street[j] = Street.Steps;
      if (w.use[j] === Use.Forest || w.use[j] === Use.Farm || w.use[j] === Use.Rock) w.use[j] = Use.Empty;
      if (w.pop[j]) { w.pop[j] = 0; w.use[j] = Use.Empty; }
    }
    made++;
  }
  if (made) w.version++;
  return made;
}

/** Streets appear on today's road alignments where the town has grown around them. */
export function activateStreets(m: GameMap, w: World) {
  const W = m.width;
  for (let y = 0; y < m.height; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x;
    if (activeBridge(m, i, w.year)) { w.street[i] = m.terrain[i] === Terrain.Water ? Street.Bridge : Street.Pike; continue; }
    if (!m.road[i] || w.street[i] || m.terrain[i] === Terrain.Water || w.use[i] === Use.Incline) continue;
    let settled = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (!inBounds(m, x + dx, y + dy)) continue;
      const u = w.use[(y + dy) * W + x + dx];
      if (u >= Use.Cottage && u <= Use.Civic || u === Use.Wharf || u === Use.Landmark || u === Use.Commerce) settled++;
    }
    if (settled >= 2) {
      w.street[i] = m.road[i] === 2 ? Street.Pike : Street.Lane;
      if (w.use[i] === Use.Forest || w.use[i] === Use.Farm) w.use[i] = Use.Empty;
    }
  }
  w.version++;
}

/** A* road between two points; follows real arterials, crosses rivers only on bridges (else ferry). */
export function carveRoad(m: GameMap, w: World, x0: number, y0: number, x1: number, y1: number) {
  const n = m.width * m.height;
  const g = new Float64Array(n).fill(Infinity);
  const prev = new Int32Array(n).fill(-1);
  const heap = new MinHeap();
  const s = idx(m, x0, y0), goal = idx(m, x1, y1);
  const H = (i: number) => 0.25 * (Math.abs((i % m.width) - x1) + Math.abs(((i / m.width) | 0) - y1));
  g[s] = 0;
  heap.push(s, H(s));
  while (heap.size) {
    const [i, f] = heap.pop();
    if (i === goal) break;
    if (f - H(i) > g[i] + 1e-9) continue;
    const x = i % m.width, y = (i / m.width) | 0;
    for (let k = 0; k < 4; k++) {
      const nx = x + DX[k], ny = y + DY[k];
      if (!inBounds(m, nx, ny)) continue;
      const j = ny * m.width + nx;
      const t = m.terrain[j];
      let c: number;
      if (t === Terrain.Water) c = activeBridge(m, j, w.year) ? 0.3 : 40; // ferry
      else if (w.street[j]) c = 0.25;
      else c = TRAVEL_COST[t] * (m.road[j] === 2 ? 0.3 : m.road[j] === 1 ? 0.6 : 1);
      const ng = g[i] + c;
      if (ng < g[j]) { g[j] = ng; prev[j] = i; heap.push(j, ng + H(j)); }
    }
  }
  for (let i = goal; i !== -1; i = prev[i]) {
    if (m.terrain[i] === Terrain.Water) continue; // ferry crossing: no road on water
    if (!w.street[i]) w.street[i] = Street.Pike;
    if (w.use[i] === Use.Forest || w.use[i] === Use.Farm || w.use[i] === Use.Rock) w.use[i] = Use.Empty;
    if (w.pop[i] && w.use[i] !== Use.Landmark && w.use[i] !== Use.Civic && w.use[i] !== Use.Commerce) {
      // the road takes the lot; people move next door
      w.pop[i] = 0;
      w.use[i] = Use.Empty;
    }
  }
  w.version++;
}

export function recomputeLandValue(m: GameMap, w: World) {
  const n = m.width * m.height;
  const s = sat(m, w.pop);
  const R = 8;
  for (let i = 0; i < n; i++) {
    const t = m.terrain[i];
    if (t === Terrain.Water) { w.landValue[i] = 0; continue; }
    const x = i % m.width, y = (i / m.width) | 0;
    const base = t === Terrain.Floodplain ? 60 : t === Terrain.Flat ? 50 : t === Terrain.Upland ? 40 : t === Terrain.Slope ? 22 : 8;
    const nb = satSum(m, s, x - R, y - R, x + R, y + R);
    const urban = Math.sqrt(nb) * 2.2;
    const dirty = 1 - Math.min(0.6, w.pollution[i] * 0.5);
    w.landValue[i] = Math.round((base + urban + w.pop[i] * 3 + (w.street[i] ? 20 : 0)) * dirty);
  }
}

// ---------------------------------------------------------------- binary heap
export class MinHeap {
  private ids: number[] = [];
  private keys: number[] = [];
  get size() { return this.ids.length; }
  push(id: number, key: number) {
    const a = this.ids, k = this.keys;
    a.push(id); k.push(key);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (k[p] <= k[i]) break;
      [a[p], a[i]] = [a[i], a[p]]; [k[p], k[i]] = [k[i], k[p]];
      i = p;
    }
  }
  pop(): [number, number] {
    const a = this.ids, k = this.keys;
    const top: [number, number] = [a[0], k[0]];
    const lastId = a.pop()!, lastK = k.pop()!;
    if (a.length) {
      a[0] = lastId; k[0] = lastK;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1, r = l + 1;
        let mm = i;
        if (l < a.length && k[l] < k[mm]) mm = l;
        if (r < a.length && k[r] < k[mm]) mm = r;
        if (mm === i) break;
        [a[mm], a[i]] = [a[i], a[mm]]; [k[mm], k[i]] = [k[i], k[mm]];
        i = mm;
      }
    }
    return top;
  }
}
