// Seeded 1850 town generation and the dynamic per-tile world layers.
// Towns grow along today's real street network (old streets mostly survive), farms take the flats
// and uplands, woods the hillsides. Pikes between towns follow real arterial alignments; rivers
// are crossed only on the bridges that existed (or by ferry).

import { blockGrid, blockOf, upsample } from "./blocks";
import { DIAMOND, INCLINES, latLonToTile, PARKS, tileLine } from "./features";
import { type GameMap, idx, inBounds, tilesFor } from "./map";
import { Rng, tileNoise, valueNoise } from "./rng";
import { anchorAt, G, GROUPS, pickGroup, SETTLED_1850 } from "./ancestry";
import { habitable, Terrain, TRAVEL_COST } from "./terrain";
import { districts } from "./districts";

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
  Park = 15,     // public park
}

/** sub-types: houses / rowhouses */
export const enum HouseSub { Normal = 0, Estate = 1, Company = 2, Shanty = 3, Boarding = 4 }
/** sub-types: commerce */
export const enum ShopSub { Tavern = 1, Store = 2, Hotel = 3, Bank = 4, Market = 5, Warehouse = 6, Block = 7, Office = 8, Bakery = 9, Butcher = 10, Kosher = 11, Saloon = 12, Barber = 13 }
/** sub-types: civic */
export const enum CivicSub { Church = 0, OnionChurch = 1, School = 2, Firehouse = 3, Library = 4, TwinChurch = 5, Synagogue = 6, BlackChurch = 7, Hall = 8 }

export const USE_NAMES: Record<number, string> = {
  0: "Open land", 1: "Woods", 2: "Farm", 3: "Cottages", 4: "Frame houses", 5: "Brick rowhouses",
  6: "Church", 7: "Your works", 8: "Rival works", 9: "Wharf", 10: "Landmark", 11: "Bare rock",
  12: "Business", 13: "Coal mine", 14: "Incline", 15: "Park",
};
export const SUB_NAMES: Record<number, Record<number, string>> = {
  3: { 1: "Estate", 2: "Company houses", 3: "Shanties" },
  4: { 1: "Mansion", 2: "Company double houses", 3: "Shanties", 4: "Boarding house" },
  5: { 4: "Boarding houses" },
  6: { 0: "Church", 1: "Church (onion domes)", 2: "School", 3: "Firehouse", 4: "Library", 5: "Church (twin towers)", 6: "Synagogue", 7: "Church (AME)", 8: "Social hall" },
  12: { 1: "Tavern", 2: "General store", 3: "Hotel", 4: "Bank", 5: "Market house", 6: "Warehouse", 7: "Commercial block", 8: "Office building", 9: "Bakery", 10: "Butcher shop", 11: "Kosher butcher", 12: "Saloon", 13: "Barbershop" },
};

export const enum Street { None = 0, Lane = 1, Pike = 2, Bridge = 3, Steps = 4 }

export const STRUCTURES = ["", "blockhouse", "courthouse", "arsenal", "penitentiary",
  // dated landmarks (src/core/landmarks.ts): one sprite per kind, struct:<kind>
  "hospital", "library", "college", "tower", "museum", "conservatory", "ballpark", "stadium", "arena", "terminal", "chapel",
  "school", "theatre", "observatory", "zoo", "amusement", "airport", "plant", "office", "housing", "fountain", "factory",
  "shipyard", "planetarium", "church", "hall", "ruin1", "ruin2", "ruin3", "ruin4"] as const;
export type StructureKind = (typeof STRUCTURES)[number];
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

/**
 * How dense a lot may get. Brick rowhouse blocks belong to the city cores (Pittsburgh, Allegheny,
 * Birmingham) and the main streets; elsewhere — the mill towns, the outskirts — frame houses.
 */
export function densityCap(m: GameMap, w: World, i: number): number {
  const x = i % m.width, y = (i / m.width) | 0;
  for (const s of w.settlements) {
    const core = s.name.startsWith("The Point") ? 60 : s.name === "Allegheny City" ? 45 : s.name.startsWith("Birmingham") ? 28 : 0;
    if (core && Math.hypot(s.x - x, s.y - y) < core) return POP_CAP.rowhouses;
  }
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const nx = x + dx, ny = y + dy;
    if (inBounds(m, nx, ny) && w.street[ny * m.width + nx] === Street.Pike) return 48;
  }
  return POP_CAP.houses;
}

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
  eth: Uint8Array;         // community (ancestry group id) of the lot's residents or congregation
  sub: Uint8Array;         // building sub-type (HouseSub / ShopSub / CivicSub / incline id)
  built: Uint16Array;      // year the current building went up (drives its architectural style)
  /** the community that built a church / hall / school / shop (eth may change later, or go to 0 = closed) */
  was: Uint8Array;
  /** per 8×8-tile cell: the community that holds it (≥ 45% of ≥ 150 people), whose style its new houses take; 0 = mixed */
  kit: Uint8Array;
  settlements: { name: string; x: number; y: number; pop: number }[];
  /** inclines in service: tile path from the foot to the head */
  inclines: { id: number; name: string; year: number; path: [number, number][] }[];
  /** parks laid out ahead of their year (funded by you): not laid again when the year comes */
  parks?: string[];
  /** bumped whenever tiles change, so renderers can drop caches */
  version: number;
}

export function useForPop(p: number): Use {
  // (company and shanty lots are capped below the rowhouse threshold by the game)
  return p > POP_CAP.houses ? Use.Rowhouses : p > POP_CAP.cottage ? Use.Houses : Use.Cottage;
}

/**
 * Minutes to cross 120 m: on foot, by horsecar (1859–90) or electric streetcar (1890–1955) on the main roads,
 * or by car as it spreads from the 1920s (a blend: the share of commuters who drive).
 */
export function modeCost(year: number, street: boolean, pike: boolean): number {
  let walk = street ? 1.5 : 3.6;
  if (pike) {
    if (year >= 1890 && year < 1955) walk = 0.55;
    else if (year >= 1859 && year < 1890) walk = 0.9;
  }
  if (street && year >= 1920) {
    const car = Math.min(1, (year - 1920) / 40);
    walk = Math.min(walk, 1.5 * (1 - car) + 0.3 * car);
  }
  return walk;
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
    eth: new Uint8Array(n),
    built: new Uint16Array(n),
    was: new Uint8Array(n),
    kit: new Uint8Array(Math.ceil(m.width / 8) * Math.ceil(m.height / 8)),
    settlements: [],
    inclines: [],
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
      // 1850 make-up, in clustered blocks, pulled toward each community's own neighbourhoods
      {
        const mix = SETTLED_1850[s.landmark] ?? [[G.OLD, 82], [G.IRISH, 10], [G.GERMAN, 8]];
        const x = c.i % m.width, y = (c.i / m.width) | 0;
        const an = anchorAt(m, x, y);
        const ws = mix.map(([gid, wt]) => { let v = wt; if (an) for (const [ag, k, from] of an.prefs) if (ag === gid && (from ?? 0) <= 1850) v *= k; return v; });
        const tot = ws.reduce((a, b) => a + b, 0);
        let r = valueNoise(seed, x, y, 4, 900 + si) * 0.7 + tileNoise(seed, x, y, 901) * 0.3;
        r *= tot;
        let gid = mix[0][0];
        for (let k = 0; k < mix.length; k++) { r -= ws[k]; if (r <= 0) { gid = mix[k][0]; break; } }
        w.eth[c.i] = gid;
      }
    }
    w.settlements.push({ name: s.landmark, x: lm.x, y: lm.y, pop: target - Math.max(0, left) });
    // the well-off build at the edge of the bigger towns, on good ground
    if (target >= 1000) {
      for (let k = Math.floor(placed * 0.55); k < placed; k++) {
        const ci = cands[k].i;
        const t = m.terrain[ci];
        if (w.use[ci] === Use.Houses && (t === Terrain.Flat || t === Terrain.Upland || t === Terrain.Slope) && rng.chance(0.14)) {
          w.sub[ci] = HouseSub.Estate; w.pop[ci] = 8; w.eth[ci] = G.OLD;
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
  // downtown: warehouses along the wharves, commercial blocks on the streets
  {
    const mask = downtownMask(m);
    for (let i = 0; i < n; i++) {
      if (!mask[i] || (w.use[i] !== Use.Rowhouses && w.use[i] !== Use.Houses)) continue;
      const x = i % m.width, y = (i / m.width) | 0;
      let wharf = false;
      for (let dy = -4; dy <= 4 && !wharf; dy++) for (let dx = -4; dx <= 4; dx++) if (inBounds(m, x + dx, y + dy) && m.special[(y + dy) * m.width + x + dx] === 1) { wharf = true; break; }
      const r = tileNoise(seed, x, y, 303);
      if (wharf && r < 0.65) { w.use[i] = Use.Commerce; w.sub[i] = ShopSub.Warehouse; w.pop[i] = 0; }
      else if (r < 0.22) { w.use[i] = Use.Commerce; w.sub[i] = ShopSub.Block; w.pop[i] = 0; }
    }
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
    if (x % 7 === 3 && y % 5 === 2 && tileNoise(seed, x, y, 103) < 0.45) { w.use[i] = Use.Cottage; w.pop[i] = rng.int(4, 8); w.eth[i] = tileNoise(seed, x, y, 104) < 0.8 ? G.OLD : G.GERMAN; }
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
  updateKits(m, w);
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

/** A park laid out on its ground: open land becomes park (streets, water and big buildings are left). */
export function layPark(m: GameMap, w: World, pk: (typeof PARKS)[number]) {
  {
    const [cx, cy] = latLonToTile(m, pk.lat, pk.lon);
    const r = pk.radiusM / m.metersPerTile;
    for (let y = Math.floor(cy - r); y <= cy + r; y++) for (let x = Math.floor(cx - r); x <= cx + r; x++) {
      if (!inBounds(m, x, y) || Math.hypot(x - cx, y - cy) > r * (0.85 + tileNoise(7, x >> 2, y >> 2, 9) * 0.3)) continue;
      const i = y * m.width + x;
      const u = w.use[i];
      if (m.terrain[i] === Terrain.Water || w.street[i] || u === Use.Landmark || u === Use.Civic || u === Use.Industry || u === Use.Rival || u === Use.Incline || u === Use.Commerce) continue;
      w.use[i] = Use.Park; w.pop[i] = 0; w.sub[i] = 0;
    }
    w.version++;
  }
}

/** Inclines open in their year: track tiles from the river-level station up the bluff. */
export function activateFeatures(m: GameMap, w: World) {
  for (const pk of PARKS) if (pk.year === w.year && !w.parks?.includes(pk.name)) layPark(m, w, pk);
  for (const inc of INCLINES) {
    if (inc.year > w.year) continue;
    if (w.inclines.some((r) => r.id === inc.id)) continue;
    const [x0, y0] = snapHeight(m, ...latLonToTile(m, inc.lower[0], inc.lower[1]), 12, -1);
    const [x1, y1] = snapHeight(m, ...latLonToTile(m, inc.upper[0], inc.upper[1]), 10, 1);
    w.inclines.push({ id: inc.id, name: inc.name, year: inc.year, path: tileLine(x0, y0, x1, y1) });
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
      else if (w.street[j]) { const f = modeCost(w.year, true, w.street[j] === Street.Pike) / 1.5; c = f * (1 + dh * 0.22); } // streetcars and cars shrink the walk
      else c = TRAVEL_COST[t] * 1.6 + dh * 0.35;
      const nd = d + c * (k >= 4 ? 1.414 : 1);
      if (nd < dist[j]) { dist[j] = nd; heap.push(j, nd); }
    }
  }
  return dist;
}

/**
 * The town's slower civic work, spread over the year (Micropolis-style phases): succession runs on a quarter of
 * the map each season; steps, downtown rebuilding and churches/halls once a year, in Spring.
 * (Where newcomers settle is decided by the growth model in growth.ts.)
 */
export function civicSeason(m: GameMap, w: World, season: number) {
  turnover(m, w, season);
  if (season !== 0) return;
  addSteps(m, w);
  rebuildDowntown(m, w);
  updateKits(m, w);
  communityBuildings(m, w);
}

/** Which community holds each 8×8 cell (≥ 45% of at least 150 people): new houses there are built in its style. */
export function updateKits(m: GameMap, w: World) {
  const C = 8, cw = Math.ceil(m.width / C), ch = Math.ceil(m.height / C), NGr = GROUPS.length;
  const pop = new Float32Array(cw * ch * NGr), tot = new Float32Array(cw * ch);
  for (let y = 0; y < m.height; y++) {
    const crow = ((y / C) | 0) * cw, row = y * m.width;
    for (let x = 0; x < m.width; x++) { const i = row + x; if (w.pop[i]) { const c = crow + ((x / C) | 0); pop[c * NGr + w.eth[i]] += w.pop[i]; tot[c] += w.pop[i]; } }
  }
  let changed = false;
  for (let c = 0; c < cw * ch; c++) {
    let best = 0, bp = 0;
    for (let gI = 1; gI < NGr; gI++) if (pop[c * NGr + gI] > bp) { bp = pop[c * NGr + gI]; best = gI; }
    const k = tot[c] >= 150 && bp / tot[c] >= 0.45 ? best : 0;
    if (w.kit[c] !== k) { w.kit[c] = k; changed = true; }
  }
  if (changed) w.version++;
}

/**
 * Succession: each year some households move up and out, and newcomers take their homes —
 * faster in the neighbourhoods each new community was drawn to (the Hill, the South Side, the mill towns).
 */
export function turnover(m: GameMap, w: World, season = -1) {
  const rng = new Rng(`${w.seed}:turn:${w.year}:${season}`);
  let changed = 0;
  for (let i = 0; i < w.pop.length; i++) {
    // phased: each season handles the rows of one quarter of the 8-row bands (every tile once a year)
    if (season >= 0 && ((((i / m.width) | 0) >> 3) & 3) !== season) continue;
    if (!w.pop[i] || w.use[i] < Use.Cottage || w.use[i] > Use.Rowhouses || w.sub[i] === HouseSub.Estate) continue;
    const x = i % m.width, y = (i / m.width) | 0;
    const a = anchorAt(m, x, y);
    const active = a?.prefs.some(([, , from, to]) => w.year >= (from ?? 0) && w.year <= (to ?? 9999) && (from ?? 0) > 1850);
    if (!rng.chance(active ? 0.03 : 0.006)) continue;
    const gid = pickGroup(m, w.eth, w.pop, x, y, w.year, rng, active ? 3 : 10);
    if (gid !== w.eth[i]) { w.eth[i] = gid; changed++; }
  }
  if (changed) w.version++;
}

// ---------------------------------------------------------------- churches and halls

/**
 * Each community builds its own church and social hall once enough of its people live together:
 * Slovak and Polish twin-tower churches, Rusyn and Serbian onion domes, synagogues, AME churches,
 * Sokol halls, Turnvereins, Hibernian halls.
 */
/**
 * Each community builds its own institutions as it grows, in the order they came historically:
 *   boarding houses for the single men who came first (≥ 120 people in a 480 m cell),
 *   its own shops (≥ 300): bakery, butcher, kosher butcher, saloon, barber — by community,
 *   a church (≥ 700): Slovak and Polish twin towers, Rusyn and Serbian onion domes, synagogues, AME churches,
 *   a parish school once the church stands (≥ 1,200, Catholic parishes),
 *   a social hall once the church stands (≥ 450, from 1870): Sokol, Turnverein, Hibernians, Sons of Italy…
 * When the neighbourhood changes hands, the buildings stay: a church the newcomers can use becomes their parish,
 * otherwise it closes; shops change hands or close.
 */
const PARISH_SCHOOL = new Set<number>([2, 3, 5, 6, 7, 8, 9, 10, 12]); // groups with parish schools (Catholic, Orthodox-Catholic, Lutheran)
const GROUP_SHOPS: Record<number, ShopSub[]> = {
  2: [ShopSub.Saloon], 3: [ShopSub.Bakery, ShopSub.Saloon], 4: [ShopSub.Barber], 5: [ShopSub.Butcher, ShopSub.Saloon],
  6: [ShopSub.Butcher, ShopSub.Saloon], 7: [ShopSub.Butcher, ShopSub.Bakery], 8: [ShopSub.Butcher], 9: [ShopSub.Saloon, ShopSub.Butcher],
  10: [ShopSub.Bakery, ShopSub.Barber], 11: [ShopSub.Kosher, ShopSub.Bakery], 12: [ShopSub.Butcher],
};
const CHURCHES = new Set<number>([CivicSub.Church, CivicSub.OnionChurch, CivicSub.TwinChurch, CivicSub.Synagogue, CivicSub.BlackChurch]);

/**
 * How many of each building a community of `p` people in one neighbourhood earns (shops of each kind, churches,
 * parish schools, social halls); boarding houses come first while it has no church.
 */
export function communityTargets(p: number, gid: number, year: number, churches: number) {
  return {
    shops: p >= 300 ? Math.min(3, 1 + Math.floor(p / 2500)) : 0,
    church: p >= 700 ? Math.min(4, 1 + Math.floor((p - 700) / 4000)) : 0,
    school: churches && p >= 1200 && year >= 1865 && PARISH_SCHOOL.has(gid) ? Math.min(3, 1 + Math.floor((p - 1200) / 5000)) : 0,
    hall: churches && p >= 450 && year >= 1870 ? Math.min(3, 1 + Math.floor(p / 6000)) : 0,
  };
}

export interface ZoneCensus { pop: Float64Array; tot: number; church: Int16Array; hall: Int16Array; school: Int16Array; boarding: Int16Array; shops: Map<number, Map<number, number>> }

/** who lives in each zone and what each community has built there */
export function zoneCensus(m: GameMap, w: World): ZoneCensus[] {
  const d = districts(m), NGr = GROUPS.length;
  const out: ZoneCensus[] = [];
  for (let z = 0; z < d.zones; z++) {
    const s = d.zoneStart[z], e = d.zoneStart[z + 1];
    if (s === e) { out.push(null as unknown as ZoneCensus); continue; }
    const c: ZoneCensus = { pop: new Float64Array(NGr), tot: 0, church: new Int16Array(NGr), hall: new Int16Array(NGr), school: new Int16Array(NGr), boarding: new Int16Array(NGr), shops: new Map() };
    for (let k = s; k < e; k++) {
      const i = d.zoneTiles[k], g = w.eth[i];
      if (w.pop[i]) { c.pop[g] += w.pop[i]; c.tot += w.pop[i]; }
      if (!g) continue;
      const u = w.use[i];
      if (u === Use.Civic) {
        if (CHURCHES.has(w.sub[i])) c.church[g]++;
        else if (w.sub[i] === CivicSub.Hall) c.hall[g]++;
        else if (w.sub[i] === CivicSub.School) c.school[g]++;
      } else if (u === Use.Commerce && w.sub[i] >= ShopSub.Bakery) {
        const mm = c.shops.get(g) ?? new Map<number, number>(); mm.set(w.sub[i], (mm.get(w.sub[i]) ?? 0) + 1); c.shops.set(g, mm);
      } else if ((u === Use.Houses || u === Use.Rowhouses) && w.sub[i] === HouseSub.Boarding) c.boarding[g]++;
    }
    out.push(c);
  }
  return out;
}

let zoneCursor = 0;
export function communityBuildings(m: GameMap, w: World, maxNew = 10) {
  const d = districts(m), NGr = GROUPS.length;
  const census = zoneCensus(m, w);
  // the best lot in a zone for a new building of community g: one of its homes on a street (a corner for a shop)
  const lotFor = (z: number, g: number, corner: boolean) => {
    let best = -1, bp = -1;
    for (let k = d.zoneStart[z]; k < d.zoneStart[z + 1]; k++) {
      const i = d.zoneTiles[k];
      if (w.eth[i] !== g || !(w.use[i] === Use.Houses || w.use[i] === Use.Rowhouses) || w.owner[i] || w.sub[i] === HouseSub.Boarding) continue;
      const x = i % m.width, y = (i / m.width) | 0;
      let st = 0, ax = false, ay = false;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (inBounds(m, x + dx, y + dy) && w.street[(y + dy) * m.width + x + dx]) { st++; if (dx) ax = true; else ay = true; }
      if (!st || (corner && !(ax && ay) && st < 2)) continue;
      // spread a community's buildings out: prefer lots away from its others
      const score = w.pop[i] + tileNoise(w.year, x, y, 61) * 20;
      if (score > bp) { bp = score; best = i; }
    }
    return best;
  };
  const build = (i: number, use: Use, sub: number, g: number) => {
    w.use[i] = use; w.sub[i] = sub; w.eth[i] = g; w.was[i] = g; w.pop[i] = 0; w.built[i] = w.year;
  };
  let made = 0;
  for (let n = 0; n < d.zones && made < maxNew; n++) {
    const z = (zoneCursor + n) % d.zones;
    const c = census[z];
    if (!c || c.tot < 120) continue;
    for (let gid = 1; gid < NGr && made < maxNew; gid++) {
      const p = c.pop[gid];
      if (p < 120) continue;
      const t = communityTargets(p, gid, w.year, c.church[gid]);
      // 1. boarding houses while the community is young here (no church yet)
      if (!c.church[gid] && c.boarding[gid] < 2 && w.year >= 1860 && gid !== 1) {
        const i = lotFor(z, gid, false);
        if (i >= 0) { w.sub[i] = HouseSub.Boarding; c.boarding[gid]++; made++; }
      }
      // 2. its own shops
      const have = c.shops.get(gid) ?? new Map<number, number>();
      for (const sub of GROUP_SHOPS[gid] ?? []) {
        if (made >= maxNew || (have.get(sub) ?? 0) >= t.shops) continue;
        if (sub === ShopSub.Saloon && w.year >= 1920 && w.year < 1933) continue; // Prohibition
        const i = lotFor(z, gid, true);
        if (i < 0) break;
        build(i, Use.Commerce, sub, gid);
        have.set(sub, (have.get(sub) ?? 0) + 1); c.shops.set(gid, have);
        made++;
      }
      // 3. churches, then 4. parish schools and 5. social halls once a church stands
      if (made < maxNew && c.church[gid] < t.church) {
        const i = lotFor(z, gid, false);
        if (i >= 0) { build(i, Use.Civic, GROUPS[gid].church, gid); c.church[gid]++; made++; }
      }
      if (made < maxNew && c.school[gid] < t.school) {
        const i = lotFor(z, gid, false);
        if (i >= 0) { build(i, Use.Civic, CivicSub.School, gid); c.school[gid]++; made++; }
      }
      if (made < maxNew && c.hall[gid] < t.hall) {
        const i = lotFor(z, gid, false);
        if (i >= 0) { build(i, Use.Civic, CivicSub.Hall, gid); c.hall[gid]++; made++; }
      }
    }
  }
  zoneCursor = (zoneCursor + 7) % Math.max(1, d.zones);
  // succession: a community's buildings in a neighbourhood it has left pass to the newcomers (or close)
  for (let z = 0; z < d.zones; z++) {
    const c = census[z];
    if (!c || c.tot < 200) continue;
    let top = 0, tp = 0;
    for (let gI = 1; gI < NGr; gI++) if (c.pop[gI] > tp) { tp = c.pop[gI]; top = gI; }
    for (let k = d.zoneStart[z]; k < d.zoneStart[z + 1]; k++) {
      const i = d.zoneTiles[k], g = w.eth[i];
      if (w.use[i] !== Use.Civic || !g || !(CHURCHES.has(w.sub[i]) || w.sub[i] === CivicSub.Hall)) continue;
      if (c.pop[g] / c.tot > 0.12) continue;
      if (CHURCHES.has(w.sub[i]) && top && GROUPS[top].church === w.sub[i] && c.church[top] < communityTargets(tp, top, w.year, 1).church) { w.eth[i] = top; c.church[top]++; } // becomes their parish
      else w.eth[i] = 0; // closed (the building stands)
      if (CHURCHES.has(w.sub[i])) c.church[g] = Math.max(0, c.church[g] - 1); else c.hall[g] = Math.max(0, c.hall[g] - 1);
      made++;
    }
  }
  if (made) w.version++;
  return made;
}

// ---------------------------------------------------------------- downtown

let downtownCache: { m: GameMap; mask: Uint8Array } | null = null;

/** Flat land on the Point side of the rivers within ~1.6 km of the Point: the commercial core. */
export function downtownMask(m: GameMap): Uint8Array {
  if (downtownCache?.m === m) return downtownCache.mask;
  const mask = new Uint8Array(m.width * m.height);
  const p = m.landmarks.find((l) => l.name.startsWith("The Point"));
  if (p) {
    const q = [p.y * m.width + p.x];
    mask[q[0]] = 1;
    while (q.length) {
      const i = q.pop()!;
      const x = i % m.width, y = (i / m.width) | 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy;
        if (!inBounds(m, nx, ny) || Math.hypot(nx - p.x, ny - p.y) > 55) continue;
        const j = ny * m.width + nx;
        const t = m.terrain[j];
        if (mask[j] || !(t === Terrain.Flat || t === Terrain.Floodplain)) continue;
        mask[j] = 1;
        q.push(j);
      }
    }
  }
  downtownCache = { m, mask };
  return mask;
}

/** Downtown turns over: rowhouses give way to commercial blocks, then office buildings that grow taller by era. */
export function rebuildDowntown(m: GameMap, w: World) {
  if (w.year < 1855) return;
  const mask = downtownMask(m);
  const p = m.landmarks.find((l) => l.name.startsWith("The Point"))!;
  const rng = new Rng(`${w.seed}:dt:${w.year}`);
  let changed = 0;
  // the skyline grows slowly: ~1 office building per 2 years from 1880, then faster after 1945
  let offices = 0;
  for (let i = 0; i < mask.length; i++) if (mask[i] && w.use[i] === Use.Commerce && w.sub[i] === ShopSub.Office) offices++;
  const officeCap = w.year < 1880 ? 0 : Math.round((Math.min(w.year, 1945) - 1880) * 0.5 + Math.max(0, w.year - 1945) * 0.8);
  for (let i = 0; i < mask.length; i++) {
    if (!mask[i]) continue;
    const u = w.use[i];
    if (u !== Use.Rowhouses && u !== Use.Commerce) continue;
    if (u === Use.Commerce && (w.sub[i] === ShopSub.Market || w.sub[i] === ShopSub.Bank)) continue;
    const x = i % m.width, y = (i / m.width) | 0;
    const near = 1 - Math.hypot(x - p.x, y - p.y) / 55;
    if (tileNoise(w.seed, x, y, 801) > 0.25 + near * 0.5) continue; // some blocks stay residential
    let street = false;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (inBounds(m, x + dx, y + dy) && w.street[(y + dy) * m.width + x + dx]) street = true;
    if (!street) continue;
    const age = w.year - (w.built[i] || 1850);
    const office = w.year >= 1880 && near > 0.4 && offices < officeCap;
    const want = office ? ShopSub.Office : ShopSub.Block;
    if (u === Use.Commerce && w.sub[i] === want && age < 35) continue;
    if (u === Use.Commerce && w.sub[i] === ShopSub.Office && age < 45) continue;
    if (!rng.chance(office ? 0.01 + near * 0.02 : 0.02)) continue;
    if (want === ShopSub.Office && !(u === Use.Commerce && w.sub[i] === ShopSub.Office)) offices++;
    w.use[i] = Use.Commerce; w.sub[i] = want; w.pop[i] = 0; w.built[i] = w.year;
    changed++;
  }
  if (changed) w.version++;
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
      if (t === Terrain.Water) c = activeBridge(m, j, w.year) || w.street[j] === Street.Bridge ? 0.3 : 40; // ferry
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

/**
 * Land value. The neighbourhood part (how built-up the area is) is a 4×4-tile block field, smoothed over ~250 m;
 * the lot's own terrain, frontage and people are added per tile, and long-term smoke takes its share.
 * Run every other season.
 */
export function recomputeLandValue(m: GameMap, w: World) {
  const g = blockGrid(m);
  const bp = new Float32Array(g.n);
  for (let y = 0; y < m.height; y++) for (let x = 0; x < m.width; x++) bp[blockOf(g, x, y)] += w.pop[y * m.width + x];
  // people within ~2 blocks (the old 8-tile radius)
  const urban = new Float32Array(g.n);
  for (let by = 0; by < g.bh; by++) for (let bx = 0; bx < g.bw; bx++) {
    let s = 0;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
      const xx = bx + dx, yy = by + dy;
      if (xx >= 0 && yy >= 0 && xx < g.bw && yy < g.bh) s += bp[yy * g.bw + xx];
    }
    urban[by * g.bw + bx] = Math.sqrt(s) * 2.2;
  }
  const BASE = [0, 0, 0, 0, 0, 0, 0, 0];
  BASE[Terrain.Floodplain] = 60; BASE[Terrain.Flat] = 50; BASE[Terrain.Upland] = 40; BASE[Terrain.Slope] = 22; BASE[Terrain.Steep] = 8;
  upsample(m, urban, (i, u) => {
    const t = m.terrain[i];
    if (t === Terrain.Water) { w.landValue[i] = 0; return; }
    const dirty = 1 - Math.min(0.6, w.pollution[i] * 0.5);
    w.landValue[i] = Math.round(((BASE[t] || 8) + u + w.pop[i] * 3 + (w.street[i] ? 20 : 0)) * dirty);
  });
}

// ---------------------------------------------------------------- binary heap
export class MinHeap {
  private ids = new Int32Array(1024);
  private keys = new Float64Array(1024);
  private n = 0;
  get size() { return this.n; }
  push(id: number, key: number) {
    if (this.n === this.ids.length) {
      const ids = new Int32Array(this.n * 2); ids.set(this.ids); this.ids = ids;
      const keys = new Float64Array(this.n * 2); keys.set(this.keys); this.keys = keys;
    }
    const a = this.ids, k = this.keys;
    let i = this.n++;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (k[p] <= key) break;
      a[i] = a[p]; k[i] = k[p];
      i = p;
    }
    a[i] = id; k[i] = key;
  }
  /** pops the smallest; read it from `top` / `topKey` */
  popMin(): number {
    const a = this.ids, k = this.keys;
    const id = a[0];
    this.topKey = k[0];
    const n = --this.n;
    if (n > 0) {
      const lid = a[n], lk = k[n];
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        if (l >= n) break;
        const r = l + 1;
        const c = r < n && k[r] < k[l] ? r : l;
        if (k[c] >= lk) break;
        a[i] = a[c]; k[i] = k[c];
        i = c;
      }
      a[i] = lid; k[i] = lk;
    }
    return id;
  }
  topKey = 0;
  pop(): [number, number] { const id = this.popMin(); return [id, this.topKey]; }
}
