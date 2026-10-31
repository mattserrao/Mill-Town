// Who lives where: ancestry by lot, immigration waves by year, chain migration, and the
// neighbourhoods that each community made its own. Dates and shares approximate.

import { latLonToTile } from "./features";
import { type GameMap, inBounds } from "./map";
import { Rng } from "./rng";

export interface Group {
  id: number;
  name: string;
  colour: [number, number, number];
  /** church sub-type (CivicSub) this community builds */
  church: number;
  /** what its social hall is called */
  hall: string;
  /** arrivals weight by year */
  wave: (y: number) => number;
  /** music style key (see audio) */
  music: string;
}

const bell = (peak: number, width: number, h = 1) => (y: number) => h * Math.exp(-(((y - peak) / width) ** 2));
const window = (from: number, to: number, f: (y: number) => number) => (y: number) => (y < from || y > to ? 0 : f(y));
/** European arrivals stop during WWI and after the 1921/1924 quota laws */
const european = (f: (y: number) => number) => (y: number) => (y >= 1914 && y <= 1919 ? 0.08 : y >= 1924 ? 0.05 : y >= 1921 ? 0.3 : 1) * f(y);

// CivicSub values: 0 steeple church, 1 onion-dome church, 5 twin-tower church, 6 synagogue, 7 Black church
export const GROUPS: Group[] = [
  { id: 0, name: "—", colour: [0, 0, 0], church: 0, hall: "", wave: () => 0, music: "" },
  { id: 1, name: "Old stock (Anglo & Scots-Irish)", colour: [196, 180, 140], church: 0, hall: "Masonic Hall", wave: (y) => (y < 1880 ? 1.2 - (y - 1850) * 0.025 : 0.45) + (y > 1925 ? 0.5 : 0), music: "parlor" },
  { id: 2, name: "Irish", colour: [70, 160, 90], church: 0, hall: "Ancient Order of Hibernians", wave: european(bell(1855, 18, 1.4)), music: "irish" },
  { id: 3, name: "German", colour: [220, 190, 60], church: 0, hall: "Turnverein", wave: european((y) => bell(1855, 14, 1.3)(y) + bell(1884, 8, 0.8)(y)), music: "german" },
  { id: 4, name: "African American", colour: [150, 90, 170], church: 7, hall: "Elks Lodge", wave: (y) => 0.12 + bell(1922, 7, 1.6)(y) + bell(1945, 10, 1.0)(y), music: "jazz" },
  { id: 5, name: "Slovak", colour: [60, 120, 210], church: 5, hall: "Sokol Hall", wave: european(window(1875, 1985, bell(1902, 13, 1.5))), music: "polka" },
  { id: 6, name: "Polish", colour: [210, 60, 70], church: 5, hall: "Polish Falcons Nest", wave: european(window(1878, 1985, bell(1905, 12, 1.4))), music: "polka" },
  { id: 7, name: "Hungarian", colour: [90, 170, 70], church: 5, hall: "Hungarian Reformed Hall", wave: european(window(1878, 1985, bell(1900, 11, 0.9))), music: "csardas" },
  { id: 8, name: "Rusyn & Ukrainian", colour: [80, 200, 210], church: 1, hall: "Greek Catholic Union Hall", wave: european(window(1880, 1985, bell(1905, 11, 0.9))), music: "slavic" },
  { id: 9, name: "Croatian & Serbian", colour: [230, 130, 40], church: 1, hall: "Croatian Fraternal Union", wave: european(window(1885, 1985, bell(1908, 10, 0.8))), music: "tamburitza" },
  { id: 10, name: "Italian", colour: [40, 150, 80], church: 5, hall: "Sons of Italy", wave: european(window(1880, 1985, bell(1908, 12, 1.2))), music: "italian" },
  { id: 11, name: "Jewish", colour: [100, 140, 230], church: 6, hall: "Workmen's Circle", wave: european(window(1880, 1985, bell(1906, 11, 0.8))), music: "klezmer" },
  { id: 12, name: "Lithuanian", colour: [180, 200, 70], church: 5, hall: "Lithuanian Citizens Club", wave: european(window(1885, 1985, bell(1906, 9, 0.5))), music: "polka" },
];

export const G = { OLD: 1, IRISH: 2, GERMAN: 3, BLACK: 4, SLOVAK: 5, POLISH: 6, HUNGARIAN: 7, RUSYN: 8, CROAT: 9, ITALIAN: 10, JEWISH: 11, LITH: 12 } as const;

/**
 * Neighbourhoods each community made its own. Weight multiplies that group's chance of settling
 * within `radiusM`, from `from` (to `to`).
 */
export interface Anchor { name: string; lat: number; lon: number; radiusM: number; prefs: [number, number, number?, number?][] }

export const ANCHORS: Anchor[] = [
  { name: "Deutschtown", lat: 40.4545, lon: -80.0010, radiusM: 700, prefs: [[G.GERMAN, 6]] },
  { name: "Troy Hill", lat: 40.4600, lon: -79.9880, radiusM: 600, prefs: [[G.GERMAN, 8]] },
  { name: "Spring Hill", lat: 40.4640, lon: -79.9960, radiusM: 600, prefs: [[G.GERMAN, 6]] },
  { name: "Lawrenceville", lat: 40.4670, lon: -79.9600, radiusM: 900, prefs: [[G.IRISH, 5], [G.POLISH, 4, 1885], [G.GERMAN, 2]] },
  { name: "Polish Hill", lat: 40.4555, lon: -79.9655, radiusM: 500, prefs: [[G.POLISH, 12, 1880]] },
  { name: "Strip District", lat: 40.4520, lon: -79.9780, radiusM: 500, prefs: [[G.POLISH, 5, 1880], [G.ITALIAN, 3, 1890], [G.IRISH, 3]] },
  { name: "Bloomfield", lat: 40.4615, lon: -79.9495, radiusM: 600, prefs: [[G.ITALIAN, 12, 1885], [G.GERMAN, 2]] },
  { name: "Hill District", lat: 40.4450, lon: -79.9820, radiusM: 1000, prefs: [[G.BLACK, 3], [G.JEWISH, 9, 1882, 1940], [G.ITALIAN, 3, 1890], [G.BLACK, 14, 1916]] },
  { name: "South Side", lat: 40.4270, lon: -79.9750, radiusM: 900, prefs: [[G.GERMAN, 4], [G.POLISH, 4, 1880], [G.SLOVAK, 4, 1880], [G.LITH, 6, 1885], [G.RUSYN, 3, 1885]] },
  { name: "South Side Slopes", lat: 40.4215, lon: -79.9770, radiusM: 1000, prefs: [[G.SLOVAK, 5, 1880], [G.POLISH, 4, 1880], [G.RUSYN, 4, 1885], [G.GERMAN, 2]] },
  { name: "Hazelwood", lat: 40.4060, lon: -79.9400, radiusM: 800, prefs: [[G.IRISH, 4], [G.HUNGARIAN, 5, 1885], [G.BLACK, 3, 1916]] },
  { name: "Homestead", lat: 40.4060, lon: -79.9120, radiusM: 1100, prefs: [[G.SLOVAK, 6, 1880], [G.RUSYN, 5, 1885], [G.HUNGARIAN, 3, 1880], [G.BLACK, 5, 1916], [G.JEWISH, 2, 1890]] },
  { name: "Braddock", lat: 40.4030, lon: -79.8680, radiusM: 900, prefs: [[G.SLOVAK, 8, 1878], [G.HUNGARIAN, 3, 1880], [G.BLACK, 4, 1916], [G.IRISH, 2]] },
  { name: "Duquesne", lat: 40.3800, lon: -79.8580, radiusM: 800, prefs: [[G.CROAT, 9, 1888], [G.HUNGARIAN, 4, 1885], [G.SLOVAK, 3, 1885]] },
  { name: "McKeesport", lat: 40.3480, lon: -79.8640, radiusM: 1100, prefs: [[G.HUNGARIAN, 7, 1880], [G.SLOVAK, 4, 1880], [G.JEWISH, 3, 1885], [G.BLACK, 3, 1916]] },
  { name: "Clairton", lat: 40.2950, lon: -79.8820, radiusM: 900, prefs: [[G.ITALIAN, 7, 1900], [G.CROAT, 5, 1900], [G.SLOVAK, 3, 1900], [G.BLACK, 3, 1916]] },
  { name: "East Liberty", lat: 40.4610, lon: -79.9250, radiusM: 800, prefs: [[G.OLD, 4], [G.ITALIAN, 3, 1900], [G.BLACK, 3, 1950]] },
];

/** Total European arrival pressure (drives how many newcomers the mills attract). */
export function immigrationPressure(year: number): number {
  let s = 0;
  for (const g of GROUPS) if (g.id >= 2 && g.id !== G.BLACK) s += g.wave(year);
  return s;
}

interface AnchorTile { x: number; y: number; r: number; a: Anchor }
let anchorCache: { m: GameMap; list: AnchorTile[] } | null = null;
function anchors(m: GameMap): AnchorTile[] {
  if (anchorCache?.m === m) return anchorCache.list;
  const list = ANCHORS.map((a) => { const [x, y] = latLonToTile(m, a.lat, a.lon); return { x, y, r: a.radiusM / m.metersPerTile, a }; });
  anchorCache = { m, list };
  return list;
}

const anchorIdxCache = new WeakMap<GameMap, Int16Array>();
/** Anchor index per tile (−1 = none), computed once per map. */
export function anchorIndex(m: GameMap): Int16Array {
  let a = anchorIdxCache.get(m);
  if (a) return a;
  const list = anchors(m);
  a = new Int16Array(m.width * m.height).fill(-1);
  const best = new Float32Array(m.width * m.height).fill(Infinity);
  list.forEach((t, k) => {
    for (let y = Math.max(0, Math.floor(t.y - t.r)); y <= Math.min(m.height - 1, Math.ceil(t.y + t.r)); y++)
      for (let x = Math.max(0, Math.floor(t.x - t.r)); x <= Math.min(m.width - 1, Math.ceil(t.x + t.r)); x++) {
        const d = Math.hypot(t.x - x, t.y - y), i = y * m.width + x;
        if (d < t.r && d < best[i]) { best[i] = d; a![i] = k; }
      }
  });
  anchorIdxCache.set(m, a);
  return a;
}

/** Anchor neighbourhood a tile belongs to (nearest within radius), if any. */
export function anchorAt(m: GameMap, x: number, y: number): Anchor | null {
  if (x < 0 || y < 0 || x >= m.width || y >= m.height) return null;
  const k = anchorIndex(m)[y * m.width + x];
  return k >= 0 ? anchors(m)[k].a : null;
}

/**
 * Pick the community of new residents on a lot: arrival waves for the year, times chain migration
 * (people settle near their own), times the neighbourhood's own pull.
 */
export function pickGroup(m: GameMap, eth: Uint8Array, pop: Uint16Array, x: number, y: number, year: number, rng: Rng, chain = 25): number {
  const near = new Float64Array(GROUPS.length);
  let total = 0;
  for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) {
    if (!inBounds(m, x + dx, y + dy)) continue;
    const i = (y + dy) * m.width + x + dx;
    if (eth[i] && pop[i]) { near[eth[i]] += pop[i]; total += pop[i]; }
  }
  const a = anchorAt(m, x, y);
  const w = new Float64Array(GROUPS.length);
  let sum = 0;
  for (const g of GROUPS) {
    if (!g.id) continue;
    let v = g.wave(year) + 0.02;
    if (total > 0) v *= 1 + chain * (near[g.id] / total) ** 1.5;
    if (a) for (const [gid, k, from, to] of a.prefs) if (gid === g.id && year >= (from ?? 0) && year <= (to ?? 9999)) v *= k;
    w[g.id] = v;
    sum += v;
  }
  let r = rng.next() * sum;
  for (let k = 1; k < w.length; k++) { r -= w[k]; if (r <= 0) return k; }
  return 1;
}

/** 1850 make-up of each settlement (by landmark name). */
export const SETTLED_1850: Record<string, [number, number][]> = {
  "The Point (Pittsburgh)": [[G.OLD, 45], [G.IRISH, 28], [G.GERMAN, 20], [G.BLACK, 7]],
  "Allegheny City": [[G.GERMAN, 42], [G.OLD, 38], [G.IRISH, 15], [G.BLACK, 5]],
  "Birmingham (South Side)": [[G.GERMAN, 48], [G.OLD, 32], [G.IRISH, 20]],
  "Lawrenceville": [[G.IRISH, 50], [G.OLD, 30], [G.GERMAN, 20]],
  "East Liberty": [[G.OLD, 80], [G.GERMAN, 15], [G.IRISH, 5]],
};
