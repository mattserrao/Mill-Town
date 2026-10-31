// Neighbourhood history: who lives where, and when each community first arrived.
//
// The map is divided into 8×8-tile cells (240 m). Every five years the population of each ancestry group
// in every cell is recorded, and the first year a group reaches a foothold in a cell (its "seed") is kept.
// A neighbourhood view adds up the cells around a place to show how it was seeded and how it grew.

import { ANCHORS, anchorAt, GROUPS } from "./ancestry";
import { latLonToTile } from "./features";
import type { GameMap } from "./map";
import { Use, type World } from "./town";

export const CELL = 8;
export const NG = GROUPS.length; // includes 0 (none)
/** people of one group in a cell that count as a foothold */
const SEED_MIN = 25;
export const SNAPSHOT_YEARS = 5;

export interface History {
  cw: number; ch: number;
  years: number[];
  /** per snapshot: population by cell and group, [cell * NG + group] */
  snaps: Uint16Array[];
  /** first year each group had a foothold in each cell (0 = never) */
  seeded: Uint16Array;
}

export function newHistory(m: GameMap): History {
  const cw = Math.ceil(m.width / CELL), ch = Math.ceil(m.height / CELL);
  return { cw, ch, years: [], snaps: [], seeded: new Uint16Array(cw * ch * NG) };
}

function census(m: GameMap, w: World, h: History): Uint32Array {
  const out = new Uint32Array(h.cw * h.ch * NG);
  for (let y = 0; y < m.height; y++) for (let x = 0; x < m.width; x++) {
    const i = y * m.width + x;
    if (!w.pop[i]) continue;
    const c = ((y / CELL) | 0) * h.cw + ((x / CELL) | 0);
    out[c * NG + w.eth[i]] += w.pop[i];
  }
  return out;
}

/** Update footholds every year; keep a full snapshot every five years (and in 1850). */
export function recordHistory(m: GameMap, w: World, h: History) {
  const now = census(m, w, h);
  for (let k = 0; k < now.length; k++) if (now[k] >= SEED_MIN && !h.seeded[k]) h.seeded[k] = w.year;
  if (h.years.length && w.year - h.years[h.years.length - 1] < SNAPSHOT_YEARS) return;
  const snap = new Uint16Array(now.length);
  for (let k = 0; k < now.length; k++) snap[k] = Math.min(65535, now[k]);
  h.years.push(w.year);
  h.snaps.push(snap);
}

// ---------------------------------------------------------------- neighbourhood reports

export interface Area { name: string; named: boolean; x: number; y: number; r: number }

const NEAR_RADIUS = 10; // tiles (300 m) for places without a named neighbourhood

/** The neighbourhood a tile belongs to: a named one if it's inside one, otherwise the area around it. */
export function areaAt(m: GameMap, x: number, y: number): Area {
  const a = anchorAt(m, x, y);
  if (a) {
    const [ax, ay] = latLonToTile(m, a.lat, a.lon);
    return { name: a.name, named: true, x: ax, y: ay, r: a.radiusM / m.metersPerTile };
  }
  let near = "", nd = Infinity;
  for (const l of m.landmarks) {
    if (l.kind !== "town" && l.kind !== "hill") continue;
    const d = Math.hypot(l.x - x, l.y - y);
    if (d < nd) { nd = d; near = l.name.replace(/ \(.*\)$/, ""); }
  }
  for (const an of ANCHORS) {
    const [ax, ay] = latLonToTile(m, an.lat, an.lon);
    const d = Math.hypot(ax - x, ay - y);
    if (d < nd) { nd = d; near = an.name; }
  }
  const km = (nd * m.metersPerTile) / 1000;
  return { name: km < 0.4 ? near : `${km.toFixed(1)} km from ${near}`, named: false, x, y, r: NEAR_RADIUS };
}

export interface AreaReport {
  area: Area;
  pop: number;
  /** people by group, now */
  groups: number[];
  /** footholds: groups in arrival order */
  arrivals: { group: number; year: number }[];
  /** population by group at each snapshot year */
  series: { year: number; groups: number[] }[];
  homes: { label: string; n: number }[];
  places: { label: string; group: number }[];
  shops: number;
  avgBuilt: number;
  pollution: number;
  landValue: number;
}

export function areaReport(m: GameMap, w: World, h: History | undefined, area: Area): AreaReport {
  const groups = new Array(NG).fill(0);
  const homes = new Map<string, number>();
  const places: { label: string; group: number }[] = [];
  let pop = 0, shops = 0, builtSum = 0, builtN = 0, pol = 0, lv = 0, tiles = 0;
  const R = Math.ceil(area.r);
  for (let y = area.y - R; y <= area.y + R; y++) for (let x = area.x - R; x <= area.x + R; x++) {
    if (x < 0 || y < 0 || x >= m.width || y >= m.height || Math.hypot(x - area.x, y - area.y) > area.r) continue;
    const i = y * m.width + x, u = w.use[i];
    tiles++; pol += w.pollution[i]; lv += w.landValue[i];
    if (w.pop[i]) { pop += w.pop[i]; groups[w.eth[i]] += w.pop[i]; }
    if (u >= Use.Cottage && u <= Use.Rowhouses) {
      const label = homeLabel(u, w.sub[i], w.pop[i]);
      homes.set(label, (homes.get(label) ?? 0) + 1);
      if (w.built[i]) { builtSum += w.built[i]; builtN++; }
    } else if (u === Use.Commerce) shops++;
    else if (u === Use.Civic) places.push({ label: civicLabel(w.sub[i], w.eth[i]), group: w.eth[i] });
  }
  // history from the cells whose centres fall inside the area
  const series: AreaReport["series"] = [];
  const arrivals = new Map<number, number>();
  if (h) {
    const cells: number[] = [];
    for (let cy = 0; cy < h.ch; cy++) for (let cx = 0; cx < h.cw; cx++) {
      const mx = cx * CELL + CELL / 2, my = cy * CELL + CELL / 2;
      if (Math.hypot(mx - area.x, my - area.y) <= area.r + CELL * 0.5) cells.push(cy * h.cw + cx);
    }
    h.snaps.forEach((s, k) => {
      const gs = new Array(NG).fill(0);
      for (const c of cells) for (let gI = 1; gI < NG; gI++) gs[gI] += s[c * NG + gI];
      series.push({ year: h.years[k], groups: gs });
    });
    for (const c of cells) for (let gI = 1; gI < NG; gI++) {
      const yr = h.seeded[c * NG + gI];
      if (yr && (!arrivals.has(gI) || yr < arrivals.get(gI)!)) arrivals.set(gI, yr);
    }
  }
  // a community "seeded" the area only if it became a real presence there (≥ 4% at some point)
  const peakShare = (gI: number) => Math.max(pop ? groups[gI] / pop : 0, ...series.map((p) => { const t = p.groups.reduce((a, b) => a + b, 0); return t ? p.groups[gI] / t : 0; }));
  return {
    area, pop, groups,
    arrivals: [...arrivals].filter(([gI]) => peakShare(gI) >= 0.04).map(([group, year]) => ({ group, year })).sort((a, b) => a.year - b.year || b.group - a.group),
    series,
    homes: [...homes].map(([label, n]) => ({ label, n })).sort((a, b) => b.n - a.n),
    places, shops,
    avgBuilt: builtN ? Math.round(builtSum / builtN) : 0,
    pollution: tiles ? pol / tiles : 0,
    landValue: tiles ? lv / tiles : 0,
  };
}

function homeLabel(use: number, sub: number, pop: number): string {
  if (!pop && sub !== 1) return "Empty / boarded up";
  if (sub === 1) return use === Use.Houses ? "Mansions" : "Estates";
  if (sub === 2) return "Company houses";
  if (sub === 3) return "Shanties";
  if (sub === 4) return "Boarding houses";
  return use === Use.Rowhouses ? "Brick rowhouses" : use === Use.Houses ? "Frame houses" : "Cottages";
}

export function civicLabel(sub: number, eth: number): string {
  const g = GROUPS[eth];
  const who = g && eth ? (eth === 1 ? "Protestant" : g.name.split(" (")[0]) : "";
  switch (sub) {
    case 2: return "School";
    case 3: return "Firehouse";
    case 4: return "Library";
    case 6: return "Synagogue";
    case 7: return "AME church";
    case 8: return g && eth ? g.hall : "Social hall";
    case 1: return `${who} church (onion domes)`.trim();
    case 5: return `${who} church (twin towers)`.trim();
    default: return `${who} church`.trim();
  }
}
