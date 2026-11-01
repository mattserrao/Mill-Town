// Roads and bridges from the works to the large places around it.
//
// A road is a pike: horsecars run on it from 1859 and streetcars 1890–1955, so it shortens the trip to the works
// (more men in reach) and new houses settle along it. Where the way crosses a river without a bridge, the road
// brings its own bridge, drawn as a real span. You pay for it, or lobby the city to build it as public works
// (influence instead of cash, and it takes longer). The game suggests the road that brings the most people
// within reach for the money; every season it may change as the town grows.

import { bump } from "./business";
import { districts, zoneName } from "./districts";
import { cal, commuteWeight, type GameState, log, updateAccess, updateWorksAccess, allWorks, walkMinutes } from "./game";
import { inBounds, type Span } from "./map";
import { activeBridge, MinHeap, modeCost, Street, Use, zoneCensus } from "./town";
import { Terrain, TRAVEL_COST } from "./terrain";
import { priceLevel } from "./time";
import { buildCommuteNow } from "./game";

export const ROAD_PER_TILE = 120;     // 1850 dollars per 30 m of new pike (grading, macadam)
export const BRIDGE_PER_TILE = 2600;  // per 30 m of span
export const LOBBY_INFLUENCE = 15;    // and as much again for a bridge
const MIN_POP = 1200;                 // a "large local area"

export interface RoadTarget { zone: number; name: string; x: number; y: number; pop: number }

export interface RoadPlan {
  to: string; zone: number;
  /** tiles from the works gate to the place */
  path: number[];
  newTiles: number; bridgeTiles: number; displaced: number;
  cost: number;
  /** minutes from the works to the place now, and with the road */
  before: number; after: number;
  /** people who would take a job at the works because of it (the place's people × the change in willingness) */
  gain: number;
  bridges: { a: [number, number]; b: [number, number] }[];
  ok: boolean; reason?: string;
  /** a new river crossing straight to the place (rather than round by the old bridges) */
  bridge?: boolean;
}

export interface PendingRoad { plan: RoadPlan; due: number }

/** the large named places, by population (this season) */
export function roadTargets(g: GameState): RoadTarget[] {
  const m = g.map, w = g.world, d = districts(m), cen = zoneCensus(m, w);
  const out: RoadTarget[] = [];
  for (let z = 0; z < d.zones; z++) {
    const c = cen[z];
    if (!c || c.tot < MIN_POP) continue;
    const zn = zoneName(d, z, w.year);
    if (!zn.named) continue;
    // the place's centre: where its people live (weighted), snapped to a lived-in tile
    let sx = 0, sy = 0;
    for (let k = d.zoneStart[z]; k < d.zoneStart[z + 1]; k++) { const i = d.zoneTiles[k], p = w.pop[i]; sx += (i % m.width) * p; sy += ((i / m.width) | 0) * p; }
    const cx = sx / c.tot, cy = sy / c.tot;
    let best = -1, bd = Infinity;
    for (let k = d.zoneStart[z]; k < d.zoneStart[z + 1]; k++) {
      const i = d.zoneTiles[k];
      if (!w.pop[i] && !w.street[i]) continue;
      const dd = Math.hypot((i % m.width) - cx, ((i / m.width) | 0) - cy);
      if (dd < bd) { bd = dd; best = i; }
    }
    if (best >= 0) out.push({ zone: z, name: zn.name, x: best % m.width, y: (best / m.width) | 0, pop: Math.round(c.tot) });
  }
  return out.sort((a, b) => b.pop - a.pop);
}

const BLOCKED = new Set<number>([Use.Industry, Use.Rival, Use.Landmark, Use.Civic, Use.Incline, Use.Commerce]);

/** Route a road from the works to a place: cheapest ground, existing streets free, a new bridge where needed. */
export function planRoad(g: GameState, t: RoadTarget, newBridge = false): RoadPlan {
  const m = g.map, w = g.world, c = g.company!, W = m.width, year = w.year;
  const fail = (reason: string): RoadPlan => ({ to: t.name, zone: t.zone, path: [], newTiles: 0, bridgeTiles: 0, displaced: 0, cost: 0, before: 0, after: 0, gain: 0, bridges: [], ok: false, reason });
  // start at the works gate on the side facing the place
  let start = -1, sd = Infinity;
  for (let y = c.y - 1; y <= c.y + c.footprint; y++) for (let x = c.x - 1; x <= c.x + c.footprint; x++) {
    if (x >= c.x && x < c.x + c.footprint && y >= c.y && y < c.y + c.footprint) continue;
    if (!inBounds(m, x, y)) continue;
    const i = y * W + x;
    if (m.terrain[i] === Terrain.Water || BLOCKED.has(w.use[i]) && !w.street[i]) continue;
    const dd = Math.hypot(x - t.x, y - t.y);
    if (dd < sd) { sd = dd; start = i; }
  }
  if (start < 0) return fail("No way out of the works");
  const goal = t.y * W + t.x;
  const n = W * m.height;
  const gc = new Float64Array(n).fill(Infinity), prev = new Int32Array(n).fill(-1);
  const H = (i: number) => 0.2 * Math.hypot((i % W) - t.x, ((i / W) | 0) - t.y);
  const heap = new MinHeap();
  gc[start] = 0; heap.push(start, H(start));
  const DX = [1, -1, 0, 0], DY = [0, 0, 1, -1];
  let found = false;
  while (heap.size) {
    const i = heap.popMin();
    if (i === goal) { found = true; break; }
    if (heap.topKey - H(i) > gc[i] + 1e-9) continue;
    const x = i % W, y = (i / W) | 0;
    for (let k = 0; k < 4; k++) {
      const nx = x + DX[k], ny = y + DY[k];
      if (!inBounds(m, nx, ny)) continue;
      const j = ny * W + nx;
      const s = w.street[j];
      let cost: number;
      if (m.terrain[j] === Terrain.Water) cost = s === Street.Bridge || activeBridge(m, j, year) ? (newBridge ? 40 : 0.2) : newBridge ? 2.5 : 7; // a new bridge is dear (unless that's the point)
      else if (s && s !== Street.Steps) cost = 0.2;
      else if (BLOCKED.has(w.use[j]) || w.owner[j]) cost = Infinity;
      else cost = TRAVEL_COST[m.terrain[j]] + w.pop[j] / 8; // go round houses where it can
      if (!isFinite(cost)) continue;
      const ng = gc[i] + cost;
      if (ng < gc[j]) { gc[j] = ng; prev[j] = i; heap.push(j, ng + H(j)); }
    }
  }
  if (!found) return fail("No route");
  const path: number[] = [];
  for (let i = goal; i !== -1; i = prev[i]) path.push(i);
  path.reverse();
  let newTiles = 0, bridgeTiles = 0, displaced = 0;
  const bridges: RoadPlan["bridges"] = [];
  let runStart = -1;
  for (let k = 0; k < path.length; k++) {
    const i = path[k];
    const water = m.terrain[i] === Terrain.Water && w.street[i] !== Street.Bridge && !activeBridge(m, i, year);
    if (water) { bridgeTiles++; if (runStart < 0) runStart = k; }
    else {
      if (runStart >= 0) {
        // a span from the bank before the water to the bank after it
        const a = path[Math.max(0, runStart - 1)], b = i;
        bridges.push({ a: [(a % W) + 0.5, ((a / W) | 0) + 0.5], b: [(b % W) + 0.5, ((b / W) | 0) + 0.5] });
        runStart = -1;
      }
      if (m.terrain[i] === Terrain.Water) continue; // an existing bridge
      if (w.street[i] !== Street.Pike && w.street[i] !== Street.Bridge) newTiles++;
      if (!w.street[i]) displaced += w.pop[i];
    }
  }
  const pl = priceLevel(year);
  const cost = Math.round((newTiles * ROAD_PER_TILE + bridgeTiles * BRIDGE_PER_TILE) * pl + displaced * 20 * pl);
  // minutes along the road (by the modes of the year) against the trip today
  const before = Math.min(90, walkMinutes(g, goal));
  const after = Math.min(before, (path.length / 4) * modeCost(year, true, true));
  const gain = Math.round(t.pop * Math.max(0, commuteWeight(after) - commuteWeight(before)));
  if (!newTiles && !bridgeTiles) return { ...fail("Already connected by a main road"), before, after: before };
  if (newBridge && !bridgeTiles) return fail("No new crossing needed");
  return { to: t.name, zone: t.zone, path, newTiles, bridgeTiles, displaced, cost, before, after, gain, bridges, ok: true, bridge: newBridge || undefined };
}

let cache: { key: string; plans: RoadPlan[] } | null = null;
/** The roads worth building now, best value first (cached for the season). */
export function roadPlans(g: GameState): RoadPlan[] {
  const c = g.company;
  if (!c) return [];
  // refreshed each year, not each season (the town's version moves nearly every season as it grows, and
  // planning routes ten roads and bridges is too dear to repeat four times a year)
  const key = `${g.seed}:${g.world.year}:${c.x},${c.y}:${(g.publicWorks.roads ?? []).length}:${allWorks(c).length}`;
  if (cache?.key === key) return cache.plans;
  const pending = new Set((g.publicWorks.roads ?? []).map((r) => r.plan.zone));
  // the places that would gain most from a quicker trip, nearest first among equals; route the best few
  const cands = roadTargets(g).filter((t) => !pending.has(t.zone)).map((t) => {
    const now = Math.min(90, walkMinutes(g, t.y * g.map.width + t.x));
    const crow = Math.hypot(t.x - c.x, t.y - c.y) * 1.3;
    const best = (crow / 4) * modeCost(g.world.year, true, true);
    return { t, upside: t.pop * Math.max(0, commuteWeight(best) - commuteWeight(now)) };
  }).filter((x) => x.upside > 50).sort((a, b) => b.upside - a.upside).slice(0, 6);
  const plans = cands.map((x) => planRoad(g, x.t)).filter((p) => p.ok && p.gain > 30)
    .sort((a, b) => b.gain / Math.max(1, b.cost) - a.gain / Math.max(1, a.cost));
  // bridges: places across a river whose trip goes round by an old bridge, or by ferry, and would be much
  // quicker over a new one near the works
  const across = roadTargets(g).filter((t) => !pending.has(t.zone) && crossesRiver(g, c.x + (c.footprint >> 1), c.y + (c.footprint >> 1), t.x, t.y)).slice(0, 4);
  for (const t of across) {
    const b = planRoad(g, t, true);
    if (b.ok && b.gain > 50 && b.after < b.before - 4) plans.push(b);
  }
  cache = { key, plans };
  return plans;
}

/** does the straight line between two tiles cross open water? */
function crossesRiver(g: GameState, x0: number, y0: number, x1: number, y1: number): boolean {
  const n = Math.ceil(Math.hypot(x1 - x0, y1 - y0));
  let run = 0;
  for (let k = 0; k <= n; k++) {
    const x = Math.round(x0 + ((x1 - x0) * k) / n), y = Math.round(y0 + ((y1 - y0) * k) / n);
    if (g.map.terrain[y * g.map.width + x] === Terrain.Water) { if (++run >= 3) return true; } else run = 0;
  }
  return false;
}

/** Lay the road (and its bridges) on the map. */
function layRoad(g: GameState, p: RoadPlan) {
  const m = g.map, w = g.world, year = w.year;
  for (const i of p.path) {
    if (m.terrain[i] === Terrain.Water) { if (!activeBridge(m, i, year)) w.street[i] = Street.Bridge; continue; }
    if (w.street[i] === Street.Steps) continue;
    w.street[i] = Street.Pike;
    if (w.use[i] === Use.Forest || w.use[i] === Use.Farm || w.use[i] === Use.Rock) w.use[i] = Use.Empty;
    if (w.pop[i]) { w.pop[i] = 0; w.use[i] = Use.Empty; }
  }
  for (const b of p.bridges) {
    const span: Span = { id: 100000 + (g.spans?.length ?? 0), kind: "road", name: `${g.company?.name.split(/[ ,&]/)[0] ?? p.to} Bridge`, stages: [{ year, type: year < 1870 ? "covered" : year < 1925 ? "truss" : "arch" }], a: b.a, b: b.b };
    (g.spans ??= []).push(span);
  }
  w.version++;
  g.roadsBuilt = (g.roadsBuilt ?? 0) + 1;
  updateAccess(g);
  if (g.company) for (const wk of allWorks(g.company).slice(1)) updateWorksAccess(g, wk);
  buildCommuteNow(g);
  cache = null;
}

/** null if the road can be ordered now, otherwise why not */
export function roadBlocked(g: GameState, p: RoadPlan, how: "pay" | "lobby"): string | null {
  const c = g.company;
  if (!c) return "Found your company first";
  if (!p.ok) return p.reason ?? "No route";
  if (c.biz.actionsLeft <= 0) return "No actions left this season";
  if (how === "pay") return c.cash < p.cost ? `Needs ${"$" + p.cost.toLocaleString("en-US")}` : null;
  const inf = lobbyInfluence(p);
  if (c.biz.meters.influence < inf) return `Needs influence ${inf}`;
  if ((g.publicWorks.roads ?? []).length) return "The city is already building a road for you";
  return null;
}
export const lobbyInfluence = (p: RoadPlan) => LOBBY_INFLUENCE + (p.bridgeTiles ? LOBBY_INFLUENCE : 0);
export const lobbySeasons = (p: RoadPlan) => (p.bridgeTiles ? 8 : 4);

/** Pay for the road now, or lobby the city to build it as public works. */
export function orderRoad(g: GameState, p: RoadPlan, how: "pay" | "lobby"): { ok: boolean; text: string } {
  const why = roadBlocked(g, p, how);
  if (why) return { ok: false, text: why };
  const c = g.company!;
  c.biz.actionsLeft--;
  const what = `a road to ${p.to}${p.bridges.length ? " with a new bridge" : ""}`;
  if (how === "pay") {
    c.cash -= p.cost;
    layRoad(g, p);
    g.morale = Math.min(100, g.morale + 1);
    bump(g, "reputation", p.bridges.length ? 3 : 1);
    log(g, `${c.name} builds ${what}.`);
    c.biz.record.push(`${cal(g).season} ${cal(g).year}: built ${what}`);
    return { ok: true, text: `${what[0].toUpperCase()}${what.slice(1)} is open.` };
  }
  bump(g, "influence", -lobbyInfluence(p));
  (g.publicWorks.roads ??= []).push({ plan: p, due: g.turn + lobbySeasons(p) });
  log(g, `The city agrees to build ${what} for ${c.name}.`);
  c.biz.record.push(`${cal(g).season} ${cal(g).year}: lobbied for ${what}`);
  cache = null;
  return { ok: true, text: `The city will build ${what} in ${lobbySeasons(p)} seasons.` };
}

/** Each season: public works the city promised you open when they're due. */
export function roadsSeason(g: GameState) {
  const due = (g.publicWorks.roads ?? []).filter((r) => r.due <= g.turn);
  if (!due.length) return;
  g.publicWorks.roads = (g.publicWorks.roads ?? []).filter((r) => r.due > g.turn);
  for (const r of due) {
    // re-route on today's map (the town has moved on), keeping the place
    const t = roadTargets(g).find((x) => x.zone === r.plan.zone);
    const p = t ? planRoad(g, t) : r.plan;
    if (!p.ok) continue;
    layRoad(g, p);
    g.morale = Math.min(100, g.morale + 1);
    log(g, `The city opens a road to ${p.to}${p.bridges.length ? " and a new bridge" : ""}.`);
  }
}
