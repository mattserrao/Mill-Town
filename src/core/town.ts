// Seeded town generation and the dynamic per-tile world layers.

import { type GameMap, idx, inBounds } from "./map";
import { Rng, tileNoise, valueNoise } from "./rng";
import { Terrain, TRAVEL_COST } from "./terrain";

export const enum Use {
  Empty = 0,
  Forest = 1,
  Farm = 2,
  Cottage = 3,   // scattered houses
  Houses = 4,    // frame houses
  Rowhouses = 5, // dense brick
  Civic = 6,     // church / market / courthouse
  Industry = 7,  // company plant
  Rival = 8,     // rival plant
}

export const USE_NAMES: Record<number, string> = {
  0: "Open land",
  1: "Woods",
  2: "Farm",
  3: "Cottages",
  4: "Frame houses",
  5: "Brick rowhouses",
  6: "Church / market",
  7: "Your works",
  8: "Rival works",
};

/** 1850 settlements (populations approximate; ± variation by seed). */
export const SETTLEMENTS_1850: { landmark: string; pop: number; radius: number }[] = [
  { landmark: "The Point (Pittsburgh)", pop: 46000, radius: 14 },
  { landmark: "Allegheny City", pop: 21000, radius: 12 },
  { landmark: "Birmingham (South Side)", pop: 3500, radius: 7 },
  { landmark: "Lawrenceville", pop: 2500, radius: 6 },
  { landmark: "East Liberty", pop: 1000, radius: 5 },
  { landmark: "McKeesport", pop: 1400, radius: 5 },
  { landmark: "Hazelwood", pop: 300, radius: 3 },
  { landmark: "Braddock", pop: 300, radius: 3 },
  { landmark: "Homestead", pop: 120, radius: 2 },
  { landmark: "Duquesne", pop: 100, radius: 2 },
  { landmark: "Clairton", pop: 100, radius: 2 },
];

export interface World {
  seed: number;
  pop: Uint16Array;       // residents per tile
  use: Uint8Array;        // Use
  road: Uint8Array;       // 0 none, 1 road, 2 bridge
  owner: Uint8Array;      // 0 private/town, 1 player, 2+ rivals
  pollution: Float32Array;// 0..1+
  landValue: Float32Array;// $ per tile
  settlementOf: Uint8Array; // index+1 into settlements, 0 = rural
  settlements: { name: string; x: number; y: number; pop: number }[];
}

const DENSE_CAP = 260; // people per 85 m tile in an 1850 brick district

function habitable(t: number) {
  return t === Terrain.Floodplain || t === Terrain.Flat || t === Terrain.Slope || t === Terrain.Upland;
}

/** Dijkstra over terrain from a source. Returns cost field (Infinity where unreachable). */
export function costField(m: GameMap, sx: number, sy: number, maxCost: number, bridgeCost = 40): Float64Array {
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
      const step = (t === Terrain.Water ? bridgeCost : TRAVEL_COST[t]) * (k >= 4 ? 1.414 : 1)
        + Math.abs(m.level[j] - m.level[i]) * 0.6;
      const nd = d + step;
      if (nd < dist[j]) { dist[j] = nd; heap.push(j, nd); }
    }
  }
  return dist;
}

const DX = [1, -1, 0, 0, 1, 1, -1, -1];
const DY = [0, 0, 1, -1, 1, -1, 1, -1];

export function generateTown(m: GameMap, seed: number): World {
  const n = m.width * m.height;
  const rng = new Rng(seed).fork("town");
  const w: World = {
    seed,
    pop: new Uint16Array(n),
    use: new Uint8Array(n),
    road: new Uint8Array(n),
    owner: new Uint8Array(n),
    pollution: new Float32Array(n),
    landValue: new Float32Array(n),
    settlementOf: new Uint8Array(n),
    settlements: [],
  };

  // ---- settlements: spread population outward along cheap terrain from each centre
  SETTLEMENTS_1850.forEach((s, si) => {
    const lm = m.landmarks.find((l) => l.name === s.landmark);
    if (!lm) return;
    const target = Math.round(s.pop * rng.range(0.8, 1.25));
    const field = costField(m, lm.x, lm.y, s.radius * 4, 60);
    const cands: { i: number; score: number }[] = [];
    for (let i = 0; i < n; i++) {
      if (!isFinite(field[i]) || !habitable(m.terrain[i]) || w.pop[i] > 0) continue;
      const x = i % m.width, y = (i / m.width) | 0;
      const jitter = valueNoise(seed, x, y, 6, si + 1) * 3 + tileNoise(seed, x, y, si) * 1.5;
      const terrainPenalty = m.terrain[i] === Terrain.Slope ? 2.5 : 0;
      cands.push({ i, score: field[i] + jitter + terrainPenalty });
    }
    cands.sort((a, b) => a.score - b.score);
    let left = target;
    let placed = 0;
    for (const c of cands) {
      if (left <= 0) break;
      // density falls off with rank: dense core, thinner edges
      const core = Math.max(0.08, 1 - placed / Math.max(8, target / 120));
      const slopeMult = m.terrain[c.i] === Terrain.Slope ? 0.5 : 1;
      const p = Math.min(left, Math.max(8, Math.round(DENSE_CAP * core * slopeMult * rng.range(0.7, 1.1))));
      w.pop[c.i] = p;
      w.settlementOf[c.i] = si + 1;
      left -= p;
      placed++;
    }
    w.settlements.push({ name: s.landmark, x: lm.x, y: lm.y, pop: target - Math.max(0, left) });
    // civic building at the centre (nearest habitable tile)
    const centre = cands[0];
    if (centre) w.use[centre.i] = Use.Civic;
  });

  // ---- tile use from population, then farms and woods in the countryside
  for (let i = 0; i < n; i++) {
    if (w.use[i] === Use.Civic) continue;
    const t = m.terrain[i];
    const x = i % m.width, y = (i / m.width) | 0;
    const p = w.pop[i];
    if (p >= 140) w.use[i] = Use.Rowhouses;
    else if (p >= 40) w.use[i] = Use.Houses;
    else if (p > 0) w.use[i] = Use.Cottage;
    else if (t === Terrain.Water) w.use[i] = Use.Empty;
    else if (t === Terrain.Steep) w.use[i] = Use.Forest;
    else {
      const farmNoise = valueNoise(seed, x, y, 9, 101);
      const woodNoise = valueNoise(seed, x, y, 7, 102);
      const flatish = t === Terrain.Flat || t === Terrain.Upland || t === Terrain.Floodplain;
      if (flatish && farmNoise > 0.42) w.use[i] = Use.Farm;
      else if (woodNoise > 0.45 || t === Terrain.Slope) w.use[i] = Use.Forest;
      else w.use[i] = Use.Empty;
      // a few farmhouses
      if (w.use[i] === Use.Farm && tileNoise(seed, x, y, 103) < 0.06) w.pop[i] = rng.int(4, 9);
    }
  }

  // ---- roads: connect settlements (nearest-first spanning tree) with least-cost paths
  const order = w.settlements.slice();
  const connected = [order.shift()!];
  while (order.length) {
    let best = -1, bestFrom = connected[0], bestD = Infinity;
    order.forEach((s, k) => connected.forEach((c) => {
      const d = Math.hypot(s.x - c.x, s.y - c.y);
      if (d < bestD) { bestD = d; best = k; bestFrom = c; }
    }));
    const s = order.splice(best, 1)[0];
    carveRoad(m, w, bestFrom.x, bestFrom.y, s.x, s.y);
    connected.push(s);
  }

  // ---- land value
  recomputeLandValue(m, w);
  return w;
}

export function carveRoad(m: GameMap, w: World, x0: number, y0: number, x1: number, y1: number) {
  const n = m.width * m.height;
  const dist = new Float64Array(n).fill(Infinity);
  const prev = new Int32Array(n).fill(-1);
  const heap = new MinHeap();
  const s = idx(m, x0, y0), goal = idx(m, x1, y1);
  dist[s] = 0;
  heap.push(s, 0);
  while (heap.size) {
    const [i, d] = heap.pop();
    if (i === goal) break;
    if (d > dist[i]) continue;
    const x = i % m.width, y = (i / m.width) | 0;
    for (let k = 0; k < 4; k++) { // 4-neighbour roads read better in iso
      const nx = x + DX[k], ny = y + DY[k];
      if (!inBounds(m, nx, ny)) continue;
      const j = ny * m.width + nx;
      const t = m.terrain[j];
      const base = t === Terrain.Water ? 25 : TRAVEL_COST[t];
      const reuse = w.road[j] ? 0.35 : 1; // prefer existing roads
      const nd = d + base * reuse + Math.abs(m.level[j] - m.level[i]) * 0.8;
      if (nd < dist[j]) { dist[j] = nd; prev[j] = i; heap.push(j, nd); }
    }
  }
  for (let i = goal; i !== -1; i = prev[i]) {
    if (!w.road[i]) w.road[i] = m.terrain[i] === Terrain.Water ? 2 : 1;
    if (w.use[i] === Use.Forest || w.use[i] === Use.Farm) w.use[i] = Use.Empty;
  }
}

export function recomputeLandValue(m: GameMap, w: World) {
  const n = m.width * m.height;
  // neighbourhood population (box blur radius 4)
  const R = 4;
  const nb = new Float32Array(n);
  for (let y = 0; y < m.height; y++) for (let x = 0; x < m.width; x++) {
    let sum = 0;
    for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
      const nx = x + dx, ny = y + dy;
      if (inBounds(m, nx, ny)) sum += w.pop[ny * m.width + nx];
    }
    nb[y * m.width + x] = sum;
  }
  for (let i = 0; i < n; i++) {
    const t = m.terrain[i];
    if (t === Terrain.Water) { w.landValue[i] = 0; continue; }
    const base = t === Terrain.Floodplain ? 180 : t === Terrain.Flat ? 150 : t === Terrain.Upland ? 120 : t === Terrain.Slope ? 70 : 30;
    const urban = Math.sqrt(nb[i]) * 9;
    const dirty = 1 - Math.min(0.6, w.pollution[i] * 0.5);
    w.landValue[i] = Math.round((base + urban + w.pop[i] * 4) * dirty);
  }
}

// ---------------------------------------------------------------- small binary heap
class MinHeap {
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
        let m = i;
        if (l < a.length && k[l] < k[m]) m = l;
        if (r < a.length && k[r] < k[m]) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]]; [k[m], k[i]] = [k[i], k[m]];
        i = m;
      }
    }
    return top;
  }
}
