// Seeded 1850 town generation and the dynamic per-tile world layers.
// Towns grow along today's real street network (old streets mostly survive), farms take the flats
// and uplands, woods the hillsides. Pikes between towns follow real arterial alignments; rivers
// are crossed only on the bridges that existed (or by ferry).

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
}

export const USE_NAMES: Record<number, string> = {
  0: "Open land", 1: "Woods", 2: "Farm", 3: "Cottages", 4: "Frame houses", 5: "Brick rowhouses",
  6: "Church", 7: "Your works", 8: "Rival works", 9: "Wharf", 10: "Landmark", 11: "Bare rock",
};

export const enum Street { None = 0, Lane = 1, Pike = 2, Bridge = 3 }

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
  settlements: { name: string; x: number; y: number; pop: number }[];
  /** bumped whenever tiles change, so renderers can drop caches */
  version: number;
}

export function useForPop(p: number): Use {
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
    // churches: one per ~4000 people, at well-ranked tiles
    const churches = Math.max(1, Math.round(target / 4000));
    for (let k = 0; k < churches && k * 7 < cands.length; k++) {
      const c = cands[Math.min(cands.length - 1, Math.floor((k * placed) / churches) + (k ? 3 : 0))];
      if (w.pop[c.i] > 0) { w.use[c.i] = Use.Civic; w.pop[c.i] = 0; }
    }
  });

  // ---- streets: today's streets inside settled areas, plus bridges standing in this year
  activateStreets(m, w);

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

/** Streets appear on today's road alignments where the town has grown around them. */
export function activateStreets(m: GameMap, w: World) {
  const W = m.width;
  for (let y = 0; y < m.height; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x;
    if (activeBridge(m, i, w.year)) { w.street[i] = m.terrain[i] === Terrain.Water ? Street.Bridge : Street.Pike; continue; }
    if (!m.road[i] || w.street[i] || m.terrain[i] === Terrain.Water) continue;
    let settled = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (!inBounds(m, x + dx, y + dy)) continue;
      const u = w.use[(y + dy) * W + x + dx];
      if (u >= Use.Cottage && u <= Use.Civic || u === Use.Wharf || u === Use.Landmark) settled++;
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
    if (w.pop[i] && w.use[i] !== Use.Landmark && w.use[i] !== Use.Civic) {
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
