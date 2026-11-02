// Seeds (v0.25, experimental): where and when the valley's neighbourhoods began. Each seed grows one block
// (src/core/sleuth.ts): a free-form area of lots that annexes the land around it and is updated as one unit.
//
// The list joins what the game already knew (the 1850 settlements, the hillside neighbourhoods) with the plats,
// mill towns and streetcar suburbs of the Pittsburgh district. Coal patches are generated at seam outcrops;
// company rows open beside a works once it is running (and when the player plats company housing).
// Dates are the platting, the works that made the town, or the streetcar that opened it, to the nearest few
// years (general histories of the Pittsburgh neighbourhoods and Mon Valley boroughs); positions are the
// historic centre. `size` is the most land the block will take, in 30 m tiles (one deep house lot each).

import { simBand } from "./band";
import { HILLSIDES, latLonToTile } from "./features";
import type { GameMap } from "./map";
import { tileNoise } from "./rng";

export type SeedType = "core" | "mill" | "plat" | "hillside" | "patch" | "company" | "suburb";

export interface SeedTypeDef {
  label: string;
  /** densest the block's houses get */
  maxUse: "houses" | "rowhouses";
  /** builds on steep ground from the start (hillsides), else only once the era allows */
  steep: boolean;
  /** share of its land the block leaves unbuilt (gardens, ravines, the slope between terraces) */
  loose: number;
  /** lays its own lanes on its grid where the road data has none */
  lanes: boolean;
  /** how strongly it reaches out along streets and streetcar lines (× road gravity) */
  road: number;
  /** how readily it annexes land (× spread) */
  spread: number;
}

export const SEED_TYPES: Record<SeedType, SeedTypeDef> = {
  core: { label: "City core", maxUse: "rowhouses", steep: false, loose: 0.04, lanes: true, road: 0.6, spread: 1.2 },
  mill: { label: "Mill town", maxUse: "rowhouses", steep: false, loose: 0.08, lanes: true, road: 0.6, spread: 1.3 },
  plat: { label: "Plat", maxUse: "rowhouses", steep: false, loose: 0.06, lanes: true, road: 0.5, spread: 1.0 },
  hillside: { label: "Hillside", maxUse: "houses", steep: true, loose: 0.3, lanes: false, road: 0.3, spread: 0.9 },
  patch: { label: "Coal patch", maxUse: "houses", steep: false, loose: 0.1, lanes: false, road: 0.2, spread: 0.8 },
  company: { label: "Company rows", maxUse: "houses", steep: false, loose: 0.05, lanes: true, road: 0.2, spread: 1.4 },
  suburb: { label: "Streetcar suburb", maxUse: "houses", steep: false, loose: 0.15, lanes: false, road: 1.6, spread: 1.0 },
};

export interface Seed {
  id: string;
  name: string;
  lat: number;
  lon: number;
  /** year it opens (or the 1850 settlements: already there) */
  opens: number;
  type: SeedType;
  /** most tiles the block will take */
  size: number;
  /** a streetcar suburb can open up to 6 years early when another block reaches within 30 tiles */
  early?: boolean;
}

/** a seed placed on the map */
export interface PlacedSeed extends Seed { x: number; y: number }

/** the 1850 settlements (src/core/town.ts SETTLEMENTS_1850), as seeds placed at their map landmarks */
const SETTLED: [string, string, SeedType, number][] = [
  ["The Point (Pittsburgh)", "Pittsburgh", "core", 2200],
  ["Allegheny City", "Allegheny City", "core", 1800],
  ["Birmingham (South Side)", "Birmingham", "plat", 700],
  ["Lawrenceville", "Lawrenceville", "plat", 600],
  ["East Liberty", "East Liberty", "plat", 500],
  ["McKeesport", "McKeesport", "mill", 1100],
  ["Hazelwood", "Hazelwood", "plat", 350],
  ["Braddock", "Braddock", "mill", 700],
  ["Homestead", "Homestead", "mill", 800],
  ["Duquesne", "Duquesne", "mill", 550],
  ["Clairton", "Clairton", "mill", 600],
];

/** plats, mill towns and suburbs: id, name, lat, lon, opens, type, size */
const LISTED: [string, string, number, number, number, SeedType, number, boolean?][] = [
  // the Allegheny's north shore and the North Side hills
  ["manchester", "Manchester", 40.4565, -80.0265, 1850, "plat", 400],
  ["deutschtown", "Deutschtown", 40.4560, -79.9985, 1850, "plat", 300],
  ["woods-run", "Woods Run", 40.4730, -80.0320, 1870, "plat", 250],
  ["fineview", "Fineview", 40.4625, -80.0020, 1880, "hillside", 180],
  ["perry-hilltop", "Perry Hilltop", 40.4715, -80.0110, 1890, "hillside", 260],
  ["spring-garden", "Spring Garden", 40.4655, -79.9860, 1870, "hillside", 160],
  // the Strip, the Hill and Oakland
  ["strip", "The Strip", 40.4515, -79.9840, 1850, "plat", 300],
  ["jl-rows", "J&L rows (South Side)", 40.4260, -79.9650, 1855, "company", 150],
  ["bloomfield", "Bloomfield", 40.4610, -79.9500, 1868, "plat", 350],
  ["oakland", "Oakland", 40.4440, -79.9560, 1870, "plat", 500],
  ["soho", "Soho", 40.4400, -79.9780, 1860, "hillside", 200],
  // the East End
  ["shadyside", "Shadyside", 40.4540, -79.9350, 1875, "suburb", 500, true],
  ["homewood", "Homewood", 40.4555, -79.8990, 1870, "suburb", 500, true],
  ["wilkinsburg", "Wilkinsburg", 40.4415, -79.8820, 1871, "suburb", 600, true],
  ["squirrel-hill", "Squirrel Hill", 40.4380, -79.9230, 1890, "suburb", 700, true],
  ["point-breeze", "Point Breeze", 40.4470, -79.9070, 1880, "suburb", 300, true],
  ["garfield", "Garfield", 40.4650, -79.9400, 1890, "suburb", 300, true],
  ["larimer", "Larimer", 40.4690, -79.9180, 1880, "plat", 250],
  ["regent-square", "Regent Square", 40.4320, -79.8960, 1915, "suburb", 200, true],
  ["upper-lawrenceville", "Upper Lawrenceville", 40.4750, -79.9580, 1860, "plat", 300],
  ["herron-hill", "Herron Hill", 40.4520, -79.9650, 1880, "hillside", 200],
  ["braddock-hills", "Braddock Hills", 40.4180, -79.8600, 1920, "suburb", 250, true],
  // the Mon's north bank above Hazelwood
  ["glenwood", "Glenwood", 40.4010, -79.9330, 1880, "plat", 150],
  ["hays", "Hays", 40.3920, -79.9330, 1890, "patch", 120],
  ["swissvale", "Swissvale", 40.4230, -79.8830, 1880, "suburb", 400, true],
  ["rankin", "Rankin", 40.4120, -79.8810, 1880, "mill", 300],
  ["east-pittsburgh", "East Pittsburgh", 40.3960, -79.8390, 1895, "mill", 350],
  // Homestead and the Mon's south bank
  ["munhall", "Munhall", 40.3950, -79.9000, 1880, "mill", 500],
  ["homestead-park", "Homestead Park", 40.3880, -79.9300, 1910, "suburb", 200, true],
  ["west-homestead", "West Homestead", 40.3995, -79.9130, 1890, "mill", 250],
  ["west-mifflin", "West Mifflin", 40.3600, -79.8900, 1920, "suburb", 300, true],
  ["dravosburg", "Dravosburg", 40.3500, -79.8860, 1890, "plat", 150],
  // McKeesport and up the Mon and the Yough
  ["christy-park", "Christy Park", 40.3330, -79.8400, 1900, "mill", 200],
  ["port-vue", "Port Vue", 40.3370, -79.8700, 1890, "suburb", 200, true],
  ["versailles", "Versailles", 40.3150, -79.8300, 1890, "plat", 200],
  ["glassport", "Glassport", 40.3240, -79.8920, 1890, "mill", 300],
  ["wilson", "Wilson", 40.3020, -79.8790, 1905, "mill", 150],
  // the South Side's hills and the South Hills
  ["allentown", "Allentown", 40.4220, -79.9880, 1870, "hillside", 250],
  ["knoxville", "Knoxville", 40.4150, -79.9900, 1877, "hillside", 300],
  ["beltzhoover", "Beltzhoover", 40.4210, -80.0000, 1885, "hillside", 250],
  ["mt-oliver", "Mount Oliver", 40.4140, -79.9850, 1890, "suburb", 250, true],
  ["beechview", "Beechview", 40.4110, -80.0250, 1909, "suburb", 500, true],
  ["dormont", "Dormont", 40.3960, -80.0330, 1909, "suburb", 400, true],
  ["banksville", "Banksville", 40.4060, -80.0380, 1910, "suburb", 200, true],
  // the West End
  ["temperanceville", "Temperanceville", 40.4430, -80.0340, 1850, "plat", 300],
  ["chateau", "Chateau", 40.4520, -80.0200, 1850, "plat", 200],
  ["elliott", "Elliott", 40.4400, -80.0450, 1880, "hillside", 200],
  ["sheraden", "Sheraden", 40.4550, -80.0560, 1890, "suburb", 300, true],
  ["esplen", "Esplen", 40.4600, -80.0450, 1880, "mill", 150],
];

/**
 * Sizes above are the historic core; a block may spread to SIZE_SCALE times that as the district fills in
 * (patches and company rows keep their size).
 */
export const SIZE_SCALE = 2.4;
const scaled = (t: SeedType, n: number) => (t === "patch" || t === "company" ? n : Math.round(n * SIZE_SCALE));

/** generated coal patches: one per 40×40-tile cell with a seam outcrop in the band, at most this many */
const PATCHES = 28;
const PATCH_CELL = 40;

const cache = new WeakMap<GameMap, PlacedSeed[]>();

/** every seed on the map (static ones; company rows open as works run) */
export function seedsFor(m: GameMap): PlacedSeed[] {
  const hit = cache.get(m);
  if (hit) return hit;
  const out: PlacedSeed[] = [];
  const band = simBand(m).mask;
  const ok = (x: number, y: number) => x >= 0 && y >= 0 && x < m.width && y < m.height && band[y * m.width + x] === 1;
  const add = (s: Seed, x: number, y: number) => { if (ok(x, y) && !out.some((o) => o.id === s.id)) out.push({ ...s, x, y }); };
  for (const [lm, name, type, size] of SETTLED) {
    const l = m.landmarks.find((q) => q.name === lm);
    if (l) add({ id: name.toLowerCase().replace(/[^a-z]+/g, "-"), name, lat: l.lat, lon: l.lon, opens: 1850, type, size: scaled(type, size) }, l.x, l.y);
  }
  for (const h of HILLSIDES) {
    const [x, y] = latLonToTile(m, h.lat, h.lon);
    const r = h.radiusM / m.metersPerTile;
    add({ id: `hill-${h.name.toLowerCase().replace(/[^a-z]+/g, "-")}`, name: h.name, lat: h.lat, lon: h.lon, opens: h.year, type: "hillside", size: scaled("hillside", Math.round(Math.PI * r * r * 0.45)) }, x, y);
  }
  for (const [id, name, lat, lon, opens, type, size, early] of LISTED) {
    const [x, y] = latLonToTile(m, lat, lon);
    add({ id, name, lat, lon, opens, type, size: scaled(type, size), early }, x, y);
  }
  // coal patches: a seam outcrop (map.coal 2) on buildable ground in the band, one per cell, opening 1850–1885
  const W = m.width, cells = new Map<number, number>();
  for (let i = 0; i < W * m.height; i++) {
    if (m.coal[i] !== 2 || !band[i] || m.terrain[i] === 0 || m.terrain[i] >= 4) continue;
    const x = i % W, y = (i / W) | 0, c = ((y / PATCH_CELL) | 0) * 1000 + ((x / PATCH_CELL) | 0);
    if (!cells.has(c) && !out.some((o) => Math.hypot(o.x - x, o.y - y) < 25)) cells.set(c, i);
  }
  let k = 0;
  for (const i of [...cells.values()].sort((a, b) => tileNoise(7, a % W, (a / W) | 0, 71) - tileNoise(7, b % W, (b / W) | 0, 71))) {
    if (k >= PATCHES) break;
    const x = i % W, y = (i / W) | 0;
    out.push({ id: `patch-${x}-${y}`, name: "", lat: 0, lon: 0, opens: 1850 + Math.round(tileNoise(9, x, y, 72) * 35), type: "patch", size: 40, x, y });
    k++;
  }
  cache.set(m, out);
  return out;
}
