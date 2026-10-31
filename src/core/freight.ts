// Freight. Every works needs coal, ore, limestone, sand or iron hauled in from outside the valley:
//
//   Upper Monongahela  coal and Connellsville coke, by barge down through the Mon locks
//   Allegheny          limestone, glass sand and (early) local ores, by barge
//   Ohio               Lake Superior ore by way of the Lake Erie ports, by barge up the Ohio (from the 1880s)
//   railroads          any of it, wherever an open line reaches the edge of the map
//   wagon              from the nearest dock or siding when the works has neither
//
// Each river and the railroads have a seasonal capacity (locks and dams raise it over the decades; low water
// in summer and ice in winter cut it). All the works in the valley share it: when a lane is over-full, every
// shipper gets the same fraction and pays a congestion premium. Your output is limited by the scarcest input.

import { percentile } from "./blocks";
import type { Good } from "./industries";
import { inBounds, type GameMap } from "./map";
import { Terrain } from "./terrain";

export type GatewayId = "upper_mon" | "allegheny" | "ohio";
export const GATEWAYS: Record<GatewayId, { name: string; river: RegExp }> = {
  upper_mon: { name: "Upper Monongahela", river: /Monongahela/ },
  allegheny: { name: "Allegheny", river: /Allegheny/ },
  ohio: { name: "Ohio (Lake Erie ore)", river: /Ohio/ },
};

/** where each good comes from by river, by year (the supply-chain map uses the same routes) */
export function sourceRiver(good: Good, year: number): GatewayId {
  switch (good) {
    case "coal": case "coke": return "upper_mon";
    case "ore": return year < 1880 ? "allegheny" : "ohio";
    case "limestone": case "sand": return "allegheny";
    default: return "ohio";
  }
}

/** tons a lane can carry per season (locks and dams raise it over the decades) */
function riverCapacity(gw: GatewayId, year: number): number {
  if (gw === "upper_mon") return year < 1880 ? 15000 : year < 1905 ? 30000 : year < 1932 ? 60000 : 100000;
  if (gw === "allegheny") return year < 1885 ? 8000 : year < 1934 ? 16000 : 35000;
  return year < 1885 ? 12000 : year < 1929 ? 30000 : 70000;
}
function railCapacity(m: GameMap, year: number): number {
  let lines = 0;
  for (const l of Object.values(m.railLines)) if (l.year <= year) lines++;
  return lines * 8000 * (year < 1900 ? 1 : year < 1925 ? 1.5 : 2);
}

export const PRICE = (year: number) => 3 * (1 + (year - 1850) * 0.004); // $ per ton at the mine / quarry
// $ per ton: a fixed charge for the haul beyond the edge of the map, plus the run inside it.
// Barges are the cheap way to move coal and ore; the railroads cost more but don't freeze or run dry.
const COST = {
  river: (tiles: number, year: number) => (0.6 + 0.0045 * tiles) * (1 + (year - 1850) * 0.002),
  rail: (tiles: number, year: number) => (1.5 + 0.007 * tiles) * (year < 1870 ? 1.4 : 1) * (1 + (year - 1850) * 0.002),
  wagon: (tiles: number) => 0.6 + 0.06 * tiles,
};

// ---------------------------------------------------------------- networks

interface Statics { river: Record<GatewayId, Int32Array> }
const staticCache = new WeakMap<GameMap, Statics>();

/** distance along the water from each gateway (the river's tiles at the map edge) */
function statics(m: GameMap): Statics {
  let s = staticCache.get(m);
  if (s) return s;
  const W = m.width, H = m.height, n = W * H;
  const river = {} as Record<GatewayId, Int32Array>;
  for (const id of Object.keys(GATEWAYS) as GatewayId[]) {
    const re = GATEWAYS[id].river;
    const d = new Int32Array(n).fill(-1), q = new Int32Array(n);
    let h = 0, t = 0;
    for (let i = 0; i < n; i++) {
      const x = i % W, y = (i / W) | 0;
      if ((x === 0 || y === 0 || x === W - 1 || y === H - 1) && m.terrain[i] === Terrain.Water && re.test(m.waterNames[String(m.water[i])] ?? "")) { d[i] = 0; q[t++] = i; }
    }
    while (h < t) {
      const i = q[h++], x = i % W, y = (i / W) | 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const j = ny * W + nx;
        if (d[j] < 0 && m.terrain[j] === Terrain.Water) { d[j] = d[i] + 1; q[t++] = j; }
      }
    }
    river[id] = d;
  }
  s = { river };
  staticCache.set(m, s);
  return s;
}

let railCache: { m: GameMap; year: number; d: Int32Array } | null = null;
/** distance along open rail lines from wherever they leave the map */
function railDist(m: GameMap, year: number): Int32Array {
  if (railCache && railCache.m === m && railCache.year === year) return railCache.d;
  const W = m.width, H = m.height, n = W * H;
  const open = (i: number) => m.rail[i] > 0 && (m.railLines[String(m.rail[i])]?.year ?? 9999) <= year;
  const d = new Int32Array(n).fill(-1), q = new Int32Array(n);
  let h = 0, t = 0;
  for (let i = 0; i < n; i++) {
    const x = i % W, y = (i / W) | 0;
    if ((x <= 1 || y <= 1 || x >= W - 2 || y >= H - 2) && open(i)) { d[i] = 0; q[t++] = i; }
  }
  while (h < t) {
    const i = q[h++], x = i % W, y = (i / W) | 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const nx = x + dx, ny = y + dy;
      if ((!dx && !dy) || nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const j = ny * W + nx;
      if (d[j] < 0 && open(j)) { d[j] = d[i] + 1; q[t++] = j; }
    }
  }
  railCache = { m, year, d };
  return d;
}

export interface Site {
  x: number; y: number; fp: number; spur?: [number, number];
  /** a private dock: a water tile right at the works, and first call on the barges */
  dock?: [number, number];
}

/** nearest tile (to the footprint) where `ok` holds, within `r` tiles; returns [tile, distance] */
function nearest(m: GameMap, s: Site, r: number, ok: (i: number) => boolean): [number, number] {
  let best = -1, bd = Infinity;
  for (let y = s.y - r; y < s.y + s.fp + r; y++) for (let x = s.x - r; x < s.x + s.fp + r; x++) {
    if (!inBounds(m, x, y)) continue;
    const i = y * m.width + x;
    if (!ok(i)) continue;
    const dx = Math.max(s.x - x, 0, x - (s.x + s.fp - 1)), dy = Math.max(s.y - y, 0, y - (s.y + s.fp - 1));
    const d = Math.hypot(dx, dy);
    if (d < bd) { bd = d; best = i; }
  }
  return [best, bd];
}

export interface Access {
  /** water tile by the works for each gateway reachable, with distance along the river */
  dock?: { tile: number; wagon: number; dist: Partial<Record<GatewayId, number>> };
  rail?: { tile: number; wagon: number; dist: number };
}

/** how a works site connects to the rivers and railroads (wagon distance included if it isn't right there) */
export function siteAccess(m: GameMap, s: Site, year: number): Access {
  const st = statics(m), rd = railDist(m, year);
  const out: Access = {};
  let [dock, dd] = nearest(m, s, 30, (i) => m.terrain[i] === Terrain.Water);
  if (s.dock) { dock = s.dock[1] * m.width + s.dock[0]; dd = 0; }
  if (dock >= 0) {
    const dist: Partial<Record<GatewayId, number>> = {};
    for (const id of Object.keys(GATEWAYS) as GatewayId[]) if (st.river[id][dock] >= 0) dist[id] = st.river[id][dock];
    out.dock = { tile: dock, wagon: dd <= 3 ? 0 : dd, dist };
  }
  let railTile = -1, rdd = Infinity;
  if (s.spur && rd[s.spur[1] * m.width + s.spur[0]] >= 0) { railTile = s.spur[1] * m.width + s.spur[0]; rdd = 0; }
  else [railTile, rdd] = nearest(m, s, 40, (i) => rd[i] >= 0);
  if (railTile >= 0) out.rail = { tile: railTile, wagon: rdd <= 3 ? 0 : rdd, dist: rd[railTile] };
  return out;
}

// ---------------------------------------------------------------- the season's shipping

export interface Shipper { id: string; site: Site; needs: Partial<Record<Good, number>> }
export interface Lane { good: Good; mode: "river" | "rail"; gateway?: GatewayId; tons: number; delivered: number; costPerTon: number; util: number }
export interface ShipResult { lanes: Lane[]; delivered: number; freightCost: number; purchaseCost: number; notes: string[] }

type LinkId = GatewayId | "rail";

/**
 * Ship every works' inputs for the season. Rivals take their cheapest lane; the player too, overflowing
 * to the next lane when the first is full. Returns the player's result and marks freight along the routes.
 */
export function shipSeason(m: GameMap, year: number, riverFactor: number, shippers: Shipper[], freight: Float32Array, playerId = "p", locks: Partial<Record<GatewayId, number>> = {}, capMult: (link: string) => number = () => 1): { player?: ShipResult; players: Record<string, ShipResult>; norm: number } {
  // the player's works are "p", "p:1", "p:2"…
  const mine = (id: string) => id === playerId || id.startsWith(playerId + ":");
  // locks and dams won by lobbying add 35% each to a river's capacity
  const lk = (gw: GatewayId) => 1 + 0.35 * (locks[gw] ?? 0);
  const cap: Record<LinkId, number> = {
    upper_mon: riverCapacity("upper_mon", year) * riverFactor * lk("upper_mon") * capMult("upper_mon"),
    allegheny: riverCapacity("allegheny", year) * riverFactor * lk("allegheny") * capMult("allegheny"),
    ohio: riverCapacity("ohio", year) * riverFactor * lk("ohio") * capMult("ohio"),
    rail: railCapacity(m, year) * capMult("rail"),
  };
  type Opt = { link: LinkId; mode: "river" | "rail"; gateway?: GatewayId; costPerTon: number; path: [number, Int32Array] };
  const st = statics(m), rd = railDist(m, year);
  const options = (s: Shipper, good: Good): Opt[] => {
    const a = siteAccess(m, s.site, year), out: Opt[] = [];
    const gw = sourceRiver(good, year);
    if (a.dock && a.dock.dist[gw] !== undefined) out.push({ link: gw, mode: "river", gateway: gw, costPerTon: COST.river(a.dock.dist[gw]!, year) + (a.dock.wagon ? COST.wagon(a.dock.wagon) : 0), path: [a.dock.tile, st.river[gw]] });
    if (a.rail) out.push({ link: "rail", mode: "rail", costPerTon: COST.rail(a.rail.dist, year) + (a.rail.wagon ? COST.wagon(a.rail.wagon) : 0), path: [a.rail.tile, rd] });
    return out.sort((p, q) => p.costPerTon - q.costPerTon);
  };
  // first pass: everyone books their cheapest lane
  const demand: Record<LinkId, number> = { upper_mon: 0, allegheny: 0, ohio: 0, rail: 0 };
  const bookings: { s: Shipper; good: Good; tons: number; opts: Opt[]; k: number }[] = [];
  for (const s of shippers) for (const [good, tons] of Object.entries(s.needs) as [Good, number][]) {
    if (!tons) continue;
    const opts = options(s, good);
    if (!opts.length) { bookings.push({ s, good, tons, opts, k: -1 }); continue; }
    demand[opts[0].link] += tons;
    bookings.push({ s, good, tons, opts, k: 0 });
  }
  // the player overflows from a full lane to the next one
  const util = (l: LinkId) => (cap[l] > 0 ? demand[l] / cap[l] : Infinity);
  for (const b of bookings) {
    if (!mine(b.s.id) || b.k < 0) continue;
    while (b.k + 1 < b.opts.length && util(b.opts[b.k].link) > 1 && util(b.opts[b.k + 1].link) < util(b.opts[b.k].link)) {
      demand[b.opts[b.k].link] -= b.tons; b.k++; demand[b.opts[b.k].link] += b.tons;
    }
  }
  // deliver: an over-full lane gives everyone the same fraction, at a congestion premium
  for (let i = 0; i < freight.length; i++) freight[i] *= 0.5;
  const players: Record<string, ShipResult> = {};
  const W = m.width;
  for (const b of bookings) {
    let delivered = 0, costPerTon = Infinity, u = 0;
    let lane: Lane | undefined;
    if (b.k >= 0) {
      const o = b.opts[b.k];
      u = util(o.link);
      // a private dock gets first call on the barges when the river is over-full
      const prio = o.mode === "river" && b.s.site.dock ? 1.3 : 1;
      delivered = b.tons * Math.min(1, prio / Math.max(u, 1e-9));
      costPerTon = o.costPerTon * (1 + 1.5 * Math.max(0, u - 0.7));
      lane = { good: b.good, mode: o.mode, gateway: o.gateway, tons: b.tons, delivered, costPerTon, util: u };
      // mark the route: follow the distance field from the works back to the edge of the map
      let i = o.path[0];
      const d = o.path[1];
      for (let step = 0; step < 2000 && i >= 0 && d[i] > 0; step++) {
        freight[i] += delivered;
        const x = i % W, y = (i / W) | 0;
        let next = -1;
        for (let dy = -1; dy <= 1 && next < 0; dy++) for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= W || ny >= m.height) continue;
          const j = ny * W + nx;
          if (d[j] >= 0 && d[j] < d[i]) { next = j; break; }
        }
        i = next;
      }
    }
    if (!mine(b.s.id)) continue;
    const player = (players[b.s.id] ??= { lanes: [], delivered: 1, freightCost: 0, purchaseCost: 0, notes: [] });
    if (lane) {
      player.lanes.push(lane);
      player.freightCost += lane.delivered * lane.costPerTon;
      player.purchaseCost += lane.delivered * PRICE(year);
      player.delivered = Math.min(player.delivered, lane.delivered / b.tons);
      if (lane.delivered < b.tons * 0.995) player.notes.push(`${lane.mode === "river" ? GATEWAYS[lane.gateway!].name + " barges" : "The railroads"} over-full: ${Math.round((1 - lane.delivered / b.tons) * 100)}% of the ${b.good} didn't arrive.`);
    } else {
      // no dock and no siding within reach: haul everything by wagon from the nearest town (slow and dear)
      player.lanes.push({ good: b.good, mode: "rail", tons: b.tons, delivered: b.tons * 0.5, costPerTon: COST.wagon(60), util: 0 });
      player.freightCost += b.tons * 0.5 * COST.wagon(60);
      player.purchaseCost += b.tons * 0.5 * PRICE(year);
      player.delivered = Math.min(player.delivered, 0.5);
      player.notes.push(`No river landing or railroad near the works: ${b.good} comes by wagon.`);
    }
  }
  return { player: players[playerId], players, norm: percentile(freight, 0.95) };
}

/**
 * The nearest open rail line a spur could reach from the works (within ~1.2 km), with its length in tiles,
 * or null if the works already has a siding or no line is in reach.
 */
export function spurOption(m: GameMap, s: Site, year: number): { to: [number, number]; len: number } | null {
  const rd = railDist(m, year);
  const [direct] = nearest(m, s, 3, (i) => rd[i] >= 0);
  if (direct >= 0 || s.spur) return null;
  const [t, d] = nearest(m, s, 40, (i) => rd[i] >= 0);
  if (t < 0) return null;
  return { to: [t % m.width, (t / m.width) | 0], len: Math.ceil(d) };
}
