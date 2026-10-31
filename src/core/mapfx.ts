// Map effects of events: communities arriving or leaving, explosions, clearances, epidemics (worse in crowded
// wards, softened near hospitals), and dated landmarks. Registered as hooks for effects.ts.

import { HOOKS } from "./effects";
import { allLandmarks } from "./eventdata";
import { cal, type GameState, log, settleMigrants } from "./game";
import { hospitals, placeLandmark } from "./landmarks";
import { inBounds } from "./map";
import { placeNamed } from "./places";
import { ShopSub, STRUCTURES, Use } from "./town";
import { teamEvent } from "./sports";

HOOKS.landmark = (g, id, state) => {
  const def = allLandmarks().find((l) => l.id === id);
  if (!def) { log(g, `(no landmark ${id})`); return; }
  const fresh = !g.landmarks.some((l) => l.id === id);
  placeLandmark(g, def, state ?? "open");
  if (fresh && def.kind === "housing") houseProject(g, id, 2600);
};

HOOKS.migrate = (g, group, people, places) => {
  let done = 0;
  const per = Math.round(Math.abs(people) / Math.max(1, places.length));
  for (const name of places) {
    const p = placeNamed(g.map, name);
    if (!p) continue;
    if (people > 0) done += settleMigrants(g, p.x, p.y, Math.ceil(p.r) + 8, per, group);
    else done += leave(g, p.x, p.y, Math.ceil(p.r) + 8, per, group);
  }
  return done;
};

/** people of a community leave a place (homes empty out) */
function leave(g: GameState, cx: number, cy: number, r: number, count: number, group: number): number {
  const { map: m, world: w } = g;
  let left = count;
  for (let y = cy - r; y <= cy + r && left > 0; y++) for (let x = cx - r; x <= cx + r && left > 0; x++) {
    if (!inBounds(m, x, y)) continue;
    const i = y * m.width + x;
    if (w.eth[i] !== group || !w.pop[i]) continue;
    const take = Math.min(w.pop[i], left);
    w.pop[i] -= take; left -= take;
  }
  if (left < count) w.version++;
  return count - left;
}

/** ruined tiles: [tile, turn they may be rebuilt] */
const RUINS = new WeakMap<GameState, [number, number][]>();

HOOKS.blast = (g, place, radiusM, ruinSeasons) => {
  const p = placeNamed(g.map, place);
  if (!p) return;
  const { map: m, world: w } = g;
  const r = radiusM / m.metersPerTile;
  const list = RUINS.get(g) ?? [];
  for (let y = Math.floor(p.y - r * 2); y <= p.y + r * 2; y++) for (let x = Math.floor(p.x - r * 2); x <= p.x + r * 2; x++) {
    if (!inBounds(m, x, y)) continue;
    const i = y * m.width + x, d = Math.hypot(x - p.x, y - p.y);
    if (d > r * 2) continue;
    const u = w.use[i];
    if (u === Use.Industry || u === Use.Rival || u === Use.Landmark) continue;
    if (d <= r) {
      // the blast itself: everything flattened
      if (u >= Use.Cottage && u <= Use.Commerce) { w.pop[i] = 0; w.use[i] = Use.Rock; list.push([i, g.turn + ruinSeasons]); }
    } else if (w.pop[i]) w.pop[i] = Math.floor(w.pop[i] * 0.7); // windows out, families gone to relatives
  }
  RUINS.set(g, list);
  w.version++;
};

/** ruins come back as open lots when their time is up (called each season) */
export function clearRuins(g: GameState) {
  const list = RUINS.get(g);
  if (!list?.length) return;
  const keep: [number, number][] = [];
  for (const [i, until] of list) {
    if (until > g.turn) { keep.push([i, until]); continue; }
    if (g.world.use[i] === Use.Rock) g.world.use[i] = Use.Empty;
  }
  RUINS.set(g, keep);
  g.world.version++;
}

HOOKS.clearance = (g, place, radiusM, to) => {
  const p = placeNamed(g.map, place);
  if (!p) return 0;
  const { map: m, world: w } = g;
  const r = radiusM / m.metersPerTile;
  const moved = new Map<number, number>();
  for (let y = Math.floor(p.y - r); y <= p.y + r; y++) for (let x = Math.floor(p.x - r); x <= p.x + r; x++) {
    if (!inBounds(m, x, y) || Math.hypot(x - p.x, y - p.y) > r) continue;
    const i = y * m.width + x, u = w.use[i];
    if (!(u >= Use.Cottage && u <= Use.Rowhouses) && u !== Use.Commerce) continue;
    if (w.pop[i]) moved.set(w.eth[i], (moved.get(w.eth[i]) ?? 0) + w.pop[i]);
    w.pop[i] = 0; w.use[i] = Use.Empty; w.sub[i] = 0;
  }
  let total = 0;
  for (const [grp, n] of moved) { total += n; HOOKS.migrate?.(g, grp, n, to); }
  w.version++;
  log(g, `${total.toLocaleString()} people are moved out of ${place}.`);
  return total;
};

HOOKS.epidemic = (g, share, place) => {
  const { map: m, world: w } = g;
  const p = place ? placeNamed(m, place) : null;
  const hs = hospitals(g);
  for (let i = 0; i < w.pop.length; i++) {
    if (w.pop[i] <= 30) continue; // the crowded tiles
    const x = i % m.width, y = (i / m.width) | 0;
    if (p && Math.hypot(x - p.x, y - p.y) > p.r * 2 + 20) continue;
    const near = hs.some((h) => Math.abs(h.x - x) < 50 && Math.abs(h.y - y) < 50);
    w.pop[i] = Math.round(w.pop[i] * (1 - share * 2 * (near ? 0.5 : 1)));
  }
  w.version++;
};

HOOKS.team = (g, team, act, ground, name) => teamEvent(g, team, act, ground, name);

/** the fixed 1850 structures (courthouse, arsenal) burn and are rebuilt */
const BURNT = new WeakMap<GameState, Map<number, number>>();
HOOKS.structure = (g, kind, state) => {
  const w = g.world, burnt = BURNT.get(g) ?? new Map<number, number>();
  const idx = STRUCTURES.indexOf(kind);
  if (state === "ruin") {
    for (let i = 0; i < w.structure.length; i++) if (w.structure[i] === idx) { burnt.set(i, idx); w.structure[i] = STRUCTURES.indexOf("ruin2"); }
  } else for (const [i, k] of burnt) if (k === idx) { w.structure[i] = idx; burnt.delete(i); }
  BURNT.set(g, burnt);
  w.version++;
};

/** Prohibition: taverns and saloons put up the shutters (a store or barbershop out front); Repeal reopens them */
HOOKS.taverns = (g, act) => {
  const w = g.world;
  if (act === "close") {
    for (let i = 0; i < w.use.length; i++) {
      if (w.use[i] !== Use.Commerce || (w.sub[i] !== ShopSub.Tavern && w.sub[i] !== ShopSub.Saloon)) continue;
      g.dryShops.push([i, w.sub[i]]);
      w.sub[i] = (i & 1) ? ShopSub.Store : ShopSub.Barber; // the speakeasy is in the back room
    }
    log(g, `${g.dryShops.length.toLocaleString()} taverns and saloons go dry.`);
  } else {
    let n = 0;
    for (const [i, sub] of g.dryShops) if (w.use[i] === Use.Commerce) { w.sub[i] = sub; n++; }
    g.dryShops = [];
    log(g, `${n.toLocaleString()} taverns reopen their doors.`);
  }
  w.version++;
};

/**
 * Public housing (from the Housing Authority, 1937): the projects go up on their dates, each replacing a crowded
 * block. Unlike other landmarks a project keeps its people — more of them than the old frame houses held.
 */
export const PROJECTS: { id: string; name: string; place: string; year: number; people: number }[] = [
  { id: "addison_terrace", name: "Addison Terrace", place: "Addison Terrace", year: 1940, people: 900 },
  { id: "bedford_dwellings", name: "Bedford Dwellings", place: "Bedford Dwellings", year: 1940, people: 1100 },
  { id: "broadhead_manor", name: "Broadhead Manor", place: "Broadhead Manor", year: 1940, people: 400 },
  { id: "harrison_village", name: "Harrison Village (McKeesport)", place: "Harrison Village", year: 1940, people: 600 },
  { id: "allegheny_dwellings", name: "Allegheny Dwellings", place: "Allegheny Dwellings", year: 1941, people: 700 },
  { id: "arlington_heights", name: "Arlington Heights", place: "Arlington Heights", year: 1942, people: 1500 },
  { id: "glen_hazel", name: "Glen Hazel", place: "Glen Hazel", year: 1942, people: 900 },
  { id: "st_clair_village", name: "St. Clair Village", place: "St. Clair Village", year: 1953, people: 1600 },
  { id: "northview_heights", name: "Northview Heights", place: "Northview Heights", year: 1962, people: 1400 },
  { id: "garfield_heights", name: "Garfield Heights", place: "Garfield Heights", year: 1964, people: 1000 },
];

/** fill a housing landmark's tiles with people (the old block's community stays on) */
export function houseProject(g: GameState, id: string, people: number) {
  const l = g.landmarks.find((x) => x.id === id);
  if (!l) return;
  const { map: m, world: w } = g;
  // the most common community around the site moves in
  const count = new Map<number, number>();
  for (let y = l.y - 6; y < l.y + l.size + 6; y++) for (let x = l.x - 6; x < l.x + l.size + 6; x++) {
    if (!inBounds(m, x, y)) continue;
    const i = y * m.width + x;
    if (w.pop[i]) count.set(w.eth[i], (count.get(w.eth[i]) ?? 0) + w.pop[i]);
  }
  const eth = [...count].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 0;
  const per = Math.round(people / (l.size * l.size));
  for (let j = 0; j < l.size; j++) for (let k = 0; k < l.size; k++) {
    const i = (l.y + j) * m.width + l.x + k;
    w.pop[i] = per; w.eth[i] = eth;
  }
  w.version++;
}

/** each season: projects due this year go up, if the Housing Authority exists */
export function publicHousing(g: GameState) {
  if (!g.flags.housingAuthority) return;
  const year = cal(g).year;
  for (const p of PROJECTS) {
    if (p.year > year || g.landmarks.some((l) => l.id === p.id)) continue;
    if (placeLandmark(g, { id: p.id, name: p.name, kind: "housing", place: p.place }, "open")) {
      houseProject(g, p.id, p.people);
      log(g, `The Housing Authority opens ${p.name}: ${p.people.toLocaleString()} people in new brick flats.`);
    }
  }
}

/** Redevelopment (URA, 1946+): the cheapest housing beside the player's works is cleared; its people are moved out */
HOOKS.ura = (g) => {
  const c = g.company;
  if (!c) return "No works.";
  const { map: m, world: w } = g;
  const cx = c.x + c.footprint / 2, cy = c.y + c.footprint / 2, R = c.footprint / 2 + 14;
  const cand: [number, number][] = [];
  for (let y = Math.floor(cy - R); y <= cy + R; y++) for (let x = Math.floor(cx - R); x <= cx + R; x++) {
    if (!inBounds(m, x, y)) continue;
    const i = y * m.width + x, u = w.use[i];
    if (!(u >= Use.Cottage && u <= Use.Rowhouses) || w.owner[i]) continue;
    cand.push([i, w.landValue[i] + Math.hypot(x - cx, y - cy) * 3]);
  }
  if (!cand.length) return "There is no housing near the works to clear.";
  cand.sort((a, b) => a[1] - b[1]);
  const moved = new Map<number, number>();
  for (const [i] of cand.slice(0, 36)) {
    if (w.pop[i]) moved.set(w.eth[i], (moved.get(w.eth[i]) ?? 0) + w.pop[i]);
    w.pop[i] = 0; w.use[i] = Use.Empty; w.sub[i] = 0;
  }
  let total = 0;
  for (const [grp, n] of moved) { total += n; HOOKS.migrate?.(g, grp, n, ["Homewood", "East Liberty", "Beltzhoover", "South Hills"]); }
  w.version++;
  return `The Authority clears ${Math.min(36, cand.length)} lots beside the works; ${total.toLocaleString()} people are moved to Homewood, East Liberty and the South Hills.`;
};
