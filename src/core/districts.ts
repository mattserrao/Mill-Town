// Cities and neighbourhoods. Every land tile belongs to the municipality whose centre it can reach first over
// land (the rivers are the natural boundaries), and to the nearest named neighbourhood. Municipalities change
// over the years: Pittsburgh absorbs Lawrenceville, East Liberty and Hazelwood (1868), Birmingham (1872) and
// Allegheny City (1907); the mill towns incorporate as boroughs when the mills arrive.
//
// Neighbourhoods are also where communities build: once enough of a community has settled in one, it gets its
// boarding houses, then its own shops, a church, a school and a social hall (see town.ts communityBuildings).
// Land outside any neighbourhood is split into square rural zones for the same purpose.

import { ANCHORS } from "./ancestry";
import { HILLSIDES, latLonToTile } from "./features";
import type { GameMap } from "./map";
import { Terrain } from "./terrain";

export interface Municipality { name: string; x: number; y: number; incorporated: number; annexed?: [number, string] }
export interface Neighbourhood { name: string; x: number; y: number }

// the town landmarks on the map, with when they became boroughs/cities and when Pittsburgh took them in
const MUNI: Record<string, { name: string; incorporated: number; annexed?: [number, string] }> = {
  "The Point (Pittsburgh)": { name: "Pittsburgh", incorporated: 1816 },
  "Allegheny City": { name: "Allegheny City", incorporated: 1840, annexed: [1907, "Pittsburgh"] },
  Lawrenceville: { name: "Lawrenceville", incorporated: 1834, annexed: [1868, "Pittsburgh"] },
  "East Liberty": { name: "East Liberty", incorporated: 1850, annexed: [1868, "Pittsburgh"] },
  "Birmingham (South Side)": { name: "Birmingham", incorporated: 1826, annexed: [1872, "Pittsburgh"] },
  Hazelwood: { name: "Hazelwood", incorporated: 1850, annexed: [1868, "Pittsburgh"] },
  Homestead: { name: "Homestead", incorporated: 1880 },
  Munhall: { name: "Munhall", incorporated: 1901 },
  Rankin: { name: "Rankin", incorporated: 1892 },
  Braddock: { name: "Braddock", incorporated: 1867 },
  Duquesne: { name: "Duquesne", incorporated: 1891 },
  McKeesport: { name: "McKeesport", incorporated: 1842 },
  Clairton: { name: "Clairton", incorporated: 1903 },
};

export interface Districts {
  /** municipality index per tile (−1: water or open country) */
  muni: Int16Array;
  munis: Municipality[];
  /** neighbourhood index per tile (−1: none) */
  nb: Int16Array;
  nbs: Neighbourhood[];
  /** zone per tile for community building: the neighbourhood, or a square rural cell; −1 for water */
  zone: Int32Array;
  /** tiles of each zone: zoneTiles.subarray(zoneStart[z], zoneStart[z + 1]) */
  zoneTiles: Int32Array;
  zoneStart: Int32Array;
  zones: number;
}

const MUNI_REACH = 110; // tiles (~2 mi) a borough reaches over land
const NB_REACH = 40;    // tiles (~¾ mi) a neighbourhood reaches
export const RURAL_CELL = 20;

/** multi-source breadth-first growth over land (8-connected), each tile to the first seed to reach it */
function grow(m: GameMap, seeds: [number, number][], reach: number): Int16Array {
  const W = m.width, H = m.height, n = W * H;
  const owner = new Int16Array(n).fill(-1), dist = new Int16Array(n).fill(-1), q = new Int32Array(n);
  let h = 0, t = 0;
  seeds.forEach(([x, y], k) => {
    // a seed on the water snaps to the nearest land tile
    let best = -1, bd = Infinity;
    for (let dy = -6; dy <= 6; dy++) for (let dx = -6; dx <= 6; dx++) {
      const xx = x + dx, yy = y + dy;
      if (xx < 0 || yy < 0 || xx >= W || yy >= H || m.terrain[yy * W + xx] === Terrain.Water) continue;
      const d = dx * dx + dy * dy;
      if (d < bd) { bd = d; best = yy * W + xx; }
    }
    if (best >= 0 && owner[best] < 0) { owner[best] = k; dist[best] = 0; q[t++] = best; }
  });
  while (h < t) {
    const i = q[h++], x = i % W, y = (i / W) | 0;
    if (dist[i] >= reach) continue;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      const xx = x + dx, yy = y + dy;
      if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
      const j = yy * W + xx;
      if (owner[j] >= 0 || m.terrain[j] === Terrain.Water) continue;
      owner[j] = owner[i]; dist[j] = dist[i] + 1; q[t++] = j;
    }
  }
  return owner;
}

const cache = new WeakMap<GameMap, Districts>();

export function districts(m: GameMap): Districts {
  const hit = cache.get(m);
  if (hit) return hit;
  const W = m.width, H = m.height, n = W * H;
  const towns = m.landmarks.filter((l) => l.kind === "town" && MUNI[l.name]);
  const munis: Municipality[] = towns.map((l) => ({ ...MUNI[l.name], x: l.x, y: l.y }));
  const muni = grow(m, towns.map((l) => [l.x, l.y]), MUNI_REACH);
  // neighbourhoods: the named ones (ancestry anchors and hillsides) and the town centres not already named
  const nbs: Neighbourhood[] = [];
  const addNb = (name: string, x: number, y: number) => {
    if (nbs.some((o) => o.name === name || Math.hypot(o.x - x, o.y - y) < 10)) return;
    nbs.push({ name, x, y });
  };
  for (const a of ANCHORS) { const [x, y] = latLonToTile(m, a.lat, a.lon); addNb(a.name, x, y); }
  for (const h of HILLSIDES) { const [x, y] = latLonToTile(m, h.lat, h.lon); addNb(h.name, x, y); }
  for (const l of towns) addNb(l.name === "The Point (Pittsburgh)" ? "Downtown" : l.name.replace(/ \(.*\)$/, ""), l.x, l.y);
  const inMap = nbs.filter((b) => b.x >= 0 && b.y >= 0 && b.x < W && b.y < H);
  const nb = grow(m, inMap.map((b) => [b.x, b.y]), NB_REACH);
  // zones: neighbourhoods first, then square rural cells for everything else on land
  const zone = new Int32Array(n).fill(-1);
  const cw = Math.ceil(W / RURAL_CELL);
  for (let i = 0; i < n; i++) {
    if (m.terrain[i] === Terrain.Water) continue;
    zone[i] = nb[i] >= 0 ? nb[i] : inMap.length + (((i / W) | 0) / RURAL_CELL | 0) * cw + ((i % W) / RURAL_CELL | 0);
  }
  const zones = inMap.length + cw * Math.ceil(H / RURAL_CELL);
  const count = new Int32Array(zones + 1);
  for (let i = 0; i < n; i++) if (zone[i] >= 0) count[zone[i] + 1]++;
  for (let z = 0; z < zones; z++) count[z + 1] += count[z];
  const zoneStart = count.slice();
  const fill = count.slice(0, zones);
  const zoneTiles = new Int32Array(zoneStart[zones]);
  for (let i = 0; i < n; i++) if (zone[i] >= 0) zoneTiles[fill[zone[i]]++] = i;
  const d: Districts = { muni, munis, nb, nbs: inMap, zone, zoneTiles, zoneStart, zones };
  cache.set(m, d);
  return d;
}

/** what a municipality is called in a year (after annexation, the city that took it in) */
export function cityName(d: Districts, k: number, year: number): string {
  if (k < 0) return "Open country";
  const mu = d.munis[k];
  if (mu.annexed && year >= mu.annexed[0]) return mu.annexed[1];
  if (year < mu.incorporated) return `${mu.name} (township)`;
  return mu.name;
}

/** the municipality key for drawing boundaries: tiles with the same key are one city that year */
export function cityKey(d: Districts, k: number, year: number): number {
  if (k < 0) return -1;
  const mu = d.munis[k];
  if (mu.annexed && year >= mu.annexed[0]) { const into = d.munis.findIndex((o) => o.name === mu.annexed![1]); return into >= 0 ? into : k; }
  return k;
}

export function zoneName(d: Districts, z: number, year: number): { name: string; city: string; named: boolean } {
  const t = d.zoneTiles[d.zoneStart[z]];
  const city = t === undefined ? "" : cityName(d, d.muni[t], year);
  if (z < d.nbs.length) return { name: d.nbs[z].name, city, named: true };
  return { name: t === undefined || d.muni[t] < 0 ? "Open country" : `Outside ${city.replace(/ \(township\)$/, "")}`, city, named: false };
}
