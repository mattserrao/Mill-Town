// Plat layout (v0.26): how each seed block lays out its land, so a city core, a mill town, company rows, a streetcar
// suburb and a hillside look different, and where two plats meet their grids clash.
//
//   grid      each plat's own angle (0°, 90°, or the 45° diagonals) taken from the real roads at its seed, its own
//             offset (lines counted from its seed), and spacing by type
//   main      one main street per plat through the seed, drawn as a pike; in a mill town or company rows it runs
//             toward the works; shops come to it first
//   alleys    rear alleys between the street rows in city cores, plats and mill towns
//   seams     where a plat meets another of a different angle, a street runs along the join
//   suburbs   after 1900 their streets curve; every other lot is a yard; a few villas on the high ground
//   hillsides streets follow the contours (every 9 m of height); steep lots get the public steps instead
//   civic     at founding a square (a market in cores and mill towns, a green with a bandstand in plats and suburbs);
//             later a church lot, a school, a park and a cemetery as the plat grows
//   edges     a fringe of gardens and orchards (a scrapyard or brickyard near the works and rail) beyond the built edge
//   decline   after 1975 empty houses stand boarded; after six years they are cleared to bare lots; main-street shops
//             close and are cleared in turn
//
// Everything here is decided from the plat (its seed, angle, type, founding year) and the map, so a loaded game lays
// out land exactly as the saved one would.

import { GROUPS } from "./ancestry";
import type { GameState } from "./game";
import { inBounds, type GameMap } from "./map";
import { tileNoise } from "./rng";
import { SEED_TYPES, type SeedType } from "./seeds";
import { Terrain } from "./terrain";
import { CivicSub, HouseSub, ShopSub, Street, Use, type World } from "./town";

/** what the layout needs to know about a plat (a Block in sleuth.ts) */
export interface PlatRef {
  id: number; type: SeedType; x: number; y: number; opened: number;
  /** 0: rows run east–west; 1: north–south; 2 and 3: the two diagonals */
  angle: number;
  /** the main street runs along the rows (0) or across them (1) */
  main?: number;
}

/** street spacing by type: rows between streets, rows between cross streets, alleys between the rows */
export const SPACING: Record<SeedType, { rows: number; cross: number; alleys: boolean }> = {
  core: { rows: 6, cross: 8, alleys: true },
  plat: { rows: 5, cross: 10, alleys: true },
  mill: { rows: 5, cross: 10, alleys: true },
  company: { rows: 4, cross: 16, alleys: false },
  suburb: { rows: 8, cross: 14, alleys: false },
  hillside: { rows: 0, cross: 0, alleys: false },
  patch: { rows: 99, cross: 99, alleys: false },
};

/** Park sub-types (Use.Park): the city's parks, and the squares plats set aside */
export const enum ParkSub { Park = 0, Paved = 1, Green = 2, Bandstand = 3 }
/** Farm sub-types at a plat's edge */
export const enum FarmSub { Fields = 0, Garden = 1, Orchard = 2, Scrapyard = 3, Brickyard = 4 }
/** Empty-lot sub-types inside plats */
export const enum LotSub { Open = 0, Cleared = 1, Yard = 2, Weeds = 3, Scrub = 4 }
/** a closed shop keeps its kind in the low bits */
export const SHOP_CLOSED = 32;

const mod = (a: number, n: number) => ((a % n) + n) % n;

/** the plat's local coordinates of (x, y): along the rows (which row) and across them */
export function local(p: PlatRef, x: number, y: number): [number, number] {
  const dx = x - p.x, dy = y - p.y;
  switch (p.angle) {
    case 1: return [dx, dy];
    case 2: return [dx + dy, dx - dy];
    case 3: return [dx - dy, dx + dy];
    default: return [dy, dx];
  }
}

/** the street grid's spacing for a plat (diagonal grids are spaced wider, as their lines run closer) */
function spacing(p: PlatRef) {
  const s = SPACING[p.type], k = p.angle >= 2 ? 1.4 : 1;
  return { rows: Math.round(s.rows * k), cross: Math.round(s.cross * k), alleys: s.alleys };
}

/**
 * The plat's angle from the real roads within 10 tiles of its seed: the principal axis of their tiles (a
 * structure tensor), snapped to 0°, 45°, 90° or 135°; with no clear direction, the more common of east–west and
 * north–south adjacencies.
 */
export function platAngle(m: GameMap, x: number, y: number): number {
  let n = 0, sx = 0, sy = 0;
  const pts: [number, number][] = [];
  for (let dy = -10; dy <= 10; dy++) for (let dx = -10; dx <= 10; dx++) {
    const xx = x + dx, yy = y + dy;
    if (!inBounds(m, xx, yy) || !m.road[yy * m.width + xx]) continue;
    pts.push([dx, dy]); sx += dx; sy += dy; n++;
  }
  if (n < 6) return 0;
  const mx = sx / n, my = sy / n;
  let cxx = 0, cyy = 0, cxy = 0;
  for (const [a, b] of pts) { cxx += (a - mx) ** 2; cyy += (b - my) ** 2; cxy += (a - mx) * (b - my); }
  const aniso = Math.sqrt((cxx - cyy) ** 2 + 4 * cxy * cxy) / (cxx + cyy || 1);
  if (aniso > 0.25) {
    // principal direction (degrees, 0 = east), snapped to 45°: east–west roads → rows east–west (0), and so on
    const th = (0.5 * Math.atan2(2 * cxy, cxx - cyy) * 180) / Math.PI;
    const k = mod(Math.round(th / 45), 4);
    return k === 0 ? 0 : k === 2 ? 1 : k === 1 ? 2 : 3;
  }
  let ew = 0, ns = 0;
  for (const [a, b] of pts) {
    if (inBounds(m, x + a + 1, y + b) && m.road[(y + b) * m.width + x + a + 1]) ew++;
    if (inBounds(m, x + a, y + b + 1) && m.road[(y + b + 1) * m.width + x + a]) ns++;
  }
  return ns > ew ? 1 : 0;
}

/** which way the main street runs: toward the nearest works for mill towns and company rows, else along the rows */
export function mainAxis(p: PlatRef, works: [number, number][]): number {
  if ((p.type !== "mill" && p.type !== "company") || !works.length) return 0;
  let best = works[0], bd = Infinity;
  for (const wk of works) { const d = Math.hypot(wk[0] - p.x, wk[1] - p.y); if (d < bd) { bd = d; best = wk; } }
  const dx = best[0] - p.x, dy = best[1] - p.y;
  // direction of the rows and of the cross streets for each angle
  const rowDir: [number, number] = p.angle === 1 ? [0, 1] : p.angle === 2 ? [1, -1] : p.angle === 3 ? [1, 1] : [1, 0];
  const crossDir: [number, number] = [-rowDir[1], rowDir[0]];
  const along = Math.abs(dx * rowDir[0] + dy * rowDir[1]) / Math.hypot(...rowDir), across = Math.abs(dx * crossDir[0] + dy * crossDir[1]) / Math.hypot(...crossDir);
  return along >= across ? 0 : 1;
}

/**
 * The street (if any) a plat lays on an empty tile it annexes. Mapped roads come first (no plat street within two
 * tiles of one); then the main street, the grid, alleys, curving suburban streets and hillside contours.
 */
const roadNear = new WeakMap<GameMap, Uint8Array>();
/** 1 within two tiles of a mapped road (computed once per map) */
function nearRoad(m: GameMap): Uint8Array {
  let f = roadNear.get(m);
  if (f) return f;
  const W = m.width, H = m.height;
  f = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (!m.road[y * W + x]) continue;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) { const xx = x + dx, yy = y + dy; if (xx >= 0 && yy >= 0 && xx < W && yy < H) f[yy * W + xx] = 1; }
  }
  roadNear.set(m, f);
  return f;
}

export function platStreet(g: GameState, p: PlatRef, x: number, y: number): number {
  const m = g.map, def = SEED_TYPES[p.type];
  if (!def.lanes && p.type !== "suburb" && p.type !== "hillside") return 0;
  if (nearRoad(m)[y * m.width + x]) return 0;
  if (p.type === "hillside") return contourStreet(m, p, x, y) ? Street.Lane : 0;
  let [along, across] = local(p, x, y);
  if (p.type === "suburb" && p.opened >= 1900) along += Math.round(2 * Math.sin(across / 7 + p.id)); // curving streets
  const s = spacing(p);
  const mainLine = (p.main ?? 0) === 0 ? along === 0 : across === 0;
  if (mainLine) return Street.Pike;
  if (mod(along, s.rows) === 0 || mod(across, s.cross) === 0) return Street.Lane;
  if (s.alleys && s.rows >= 5 && mod(along, s.rows) === Math.floor(s.rows / 2)) return Street.Alley;
  return 0;
}

/** a hillside street: on a 9 m contour (the upper side of where the height crosses it), where the slope allows */
function contourStreet(m: GameMap, p: PlatRef, x: number, y: number): boolean {
  const i = y * m.width + x;
  if (m.slope[i] > 20) return false; // too steep: the public steps go there
  const k = Math.floor(m.elevation[i] / 9);
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const xx = x + dx, yy = y + dy;
    if (inBounds(m, xx, yy) && Math.floor(m.elevation[yy * m.width + xx] / 9) < k) return true;
  }
  void p;
  return false;
}

/** where this plat meets another laid on a different angle, a street runs along the join (laid by the younger plat) */
export function seamStreet(g: GameState, p: PlatRef, x: number, y: number, plats: PlatRef[]): boolean {
  const m = g.map, id = g.world.blockId!;
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const xx = x + dx, yy = y + dy;
    if (!inBounds(m, xx, yy)) continue;
    const o = id[yy * m.width + xx];
    if (o && o !== p.id && o < p.id && plats[o - 1].angle !== p.angle) return true;
  }
  return false;
}

/** a suburb keeps every other lot as a yard (lawn and trees) */
export function isYard(p: PlatRef, x: number, y: number): boolean {
  if (p.type !== "suburb") return false;
  const [along, across] = local(p, x, y);
  return mod(along + across, 2) === 1 && mod(along, SPACING.suburb.rows) !== 0;
}

// ---------------------------------------------------------------- squares and civic land

/**
 * The square a plat sets aside at founding, beside its main street next to the seed: 2×2 (3×3 for a city core).
 * Cores and mill towns get a market (a market house on paving); plats and suburbs a green with a bandstand.
 * Returns the tiles and what each becomes.
 */
export function squareTiles(g: GameState, p: PlatRef): { i: number; use: Use; sub: number }[] {
  const t = p.type;
  if (t !== "core" && t !== "mill" && t !== "plat" && t !== "suburb") return [];
  const m = g.map, W = m.width, n = t === "core" ? 3 : 2, market = t === "core" || t === "mill";
  const out: { i: number; use: Use; sub: number }[] = [];
  for (let dy = -6; dy <= 6; dy++) for (let dx = -6; dx <= 6; dx++) {
    const x = p.x + dx, y = p.y + dy;
    if (!inBounds(m, x, y)) continue;
    const [along, across] = local(p, x, y);
    const [a, c] = (p.main ?? 0) === 0 ? [along, across] : [across, along];
    // the side of the main street away from the river: rows 1..n beside it, columns 1..n along it from the seed
    if (a < 1 || a > n || c < 1 || c > n) continue;
    const i = y * W + x;
    const centre = a === Math.ceil(n / 2) && c === Math.ceil(n / 2);
    out.push(market ? { i, use: centre ? Use.Commerce : Use.Park, sub: centre ? ShopSub.Market : ParkSub.Paved }
      : { i, use: Use.Park, sub: centre ? ParkSub.Bandstand : ParkSub.Green });
  }
  return out;
}

/** the community whose church a plat builds: its largest */
export function churchFor(byGroup: number[]): number {
  let best = 1, bp = -1;
  for (let k = 1; k < byGroup.length; k++) if (byGroup[k] > bp) { bp = byGroup[k]; best = k; }
  return best;
}

/** what a plat of this size and age has set aside (a list of kinds), by type */
export type CivicKind = "market" | "church" | "school" | "park" | "cemetery";
export function civicDue(t: SeedType, pop: number, land: number, year: number): CivicKind[] {
  const out: CivicKind[] = [];
  // a market house on its own square for the cores and mill towns (cleared from houses if it has to be)
  if ((t === "core" || t === "mill") && pop >= 1000 && year < 1950) out.push("market");
  if (t !== "patch" && pop >= 700) out.push("church");
  if ((t === "plat" || t === "mill" || t === "suburb" || t === "core") && pop >= 1200 && year >= 1870) out.push("school");
  if ((t === "suburb" || t === "core" || land >= 400) && land >= 200 && t !== "patch" && t !== "company") out.push("park");
  if (land >= 150) out.push("cemetery");
  return out;
}

/** turn tile i into a civic lot of `kind` (churches for the plat's largest community) */
export function buildCivic(w: World, i: number, kind: Exclude<CivicKind, "market">, gid: number) {
  w.pop[i] = 0; w.built[i] = w.year;
  if (kind === "church") { w.use[i] = Use.Civic; w.sub[i] = GROUPS[gid]?.church ?? CivicSub.Church; w.eth[i] = gid; w.was[i] = gid; }
  else if (kind === "school") { w.use[i] = Use.Civic; w.sub[i] = CivicSub.School; w.eth[i] = 0; }
  else if (kind === "park") { w.use[i] = Use.Park; w.sub[i] = ParkSub.Green; }
  else { w.use[i] = Use.Cemetery; w.sub[i] = 0; }
}

// ---------------------------------------------------------------- edges

/** the fringe a plat keeps at its edge: gardens and orchards, a scrapyard or brickyard near works or rail */
export function fringeSub(g: GameState, x: number, y: number): number {
  const m = g.map, w = g.world, W = m.width;
  let industry = false;
  for (let dy = -9; dy <= 9 && !industry; dy += 3) for (let dx = -9; dx <= 9; dx += 3) {
    const xx = x + dx, yy = y + dy;
    if (!inBounds(m, xx, yy)) continue;
    const j = yy * W + xx;
    if (w.use[j] === Use.Industry || w.use[j] === Use.Rival || m.rail[j]) { industry = true; break; }
  }
  const r = tileNoise(w.seed + 31, x >> 1, y >> 1, 905);
  if (industry && r < 0.26) return r < 0.12 ? FarmSub.Scrapyard : FarmSub.Brickyard;
  return r < 0.72 ? FarmSub.Garden : FarmSub.Orchard;
}

/** is (x, y) open country a plat's fringe can take? */
export function fringeOk(g: GameState, i: number): boolean {
  const m = g.map, w = g.world;
  const u = w.use[i], t = m.terrain[i];
  return (u === Use.Farm || u === Use.Empty || u === Use.Forest) && !w.street[i] && !m.road[i] && !w.owner[i] && !w.pop[i]
    && t !== Terrain.Water && t !== Terrain.Cliff && t !== Terrain.Steep && !w.blockId![i];
}

export { HouseSub };
