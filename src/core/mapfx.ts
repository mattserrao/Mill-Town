// Map effects of events: communities arriving or leaving, explosions, clearances, epidemics (worse in crowded
// wards, softened near hospitals), and dated landmarks. Registered as hooks for effects.ts.

import { HOOKS } from "./effects";
import { allLandmarks } from "./eventdata";
import { type GameState, log, settleMigrants } from "./game";
import { hospitals, placeLandmark } from "./landmarks";
import { inBounds } from "./map";
import { placeNamed } from "./places";
import { Use } from "./town";
import { teamEvent } from "./sports";

HOOKS.landmark = (g, id, state) => {
  const def = allLandmarks().find((l) => l.id === id);
  if (!def) { log(g, `(no landmark ${id})`); return; }
  placeLandmark(g, def, state ?? "open");
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
