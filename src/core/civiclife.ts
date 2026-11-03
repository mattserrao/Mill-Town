// v0.27 Civic life: the city's services, its fires, its dead, and the days it turns out into the streets.
//
//   services   engine houses, station houses, borough buildings and union halls, laid out ward by ward as the wards
//              fill (seed blocks, sleuth.ts). Volunteer companies until the paid department (1870); motor engines
//              from 1915. City police from 1857; the boroughs keep a lockup in the borough building.
//   fire       a risk for every block each season: frame houses, crowding and the furnaces nearby raise it; an engine
//              house in reach, water mains and your company's brigade cut it. A fire spreads lot to lot (brick slows
//              it, streets stop most of it) and burns the houses down to charred lots, which the town rebuilds.
//   cemeteries the real burying grounds open on their dates and fill with the valley's dead (a death rate by year,
//              the sickly wards worse, the works' accidents, the fires, 1918); the plats' own grounds fill too, and
//              keep the faith of the parish that laid them out. Your family has a plot: the founder's parents first,
//              then each head as they die — headstones, an obelisk, a mausoleum as the family's name grows.
//   happenings funerals, parades and feast days, engine runs, election crowds: what the streets show this season
//              (drawn by render/gatherings in traffic.ts).

import { type ActionDef, bump, pushHeadline } from "./business";
import { CEMETERIES, cemeteryName, DATED_DEAD, DATED_FIRES, Faith, SERVICE_DATES, VOLUNTEER_COMPANIES } from "./civicdata";
import { pickName } from "./family";
import { latLonToTile } from "./features";
import { allWorks, cal, type GameState, log } from "./game";
import { G } from "./ancestry";
import { legacy } from "./legacy";
import { mark } from "./ledger";
import { inBounds } from "./map";
import { type Block, blockAt, blocksOf, resyncBlock, serviceLot, tilesOf, wardOf } from "./sleuth";
import { LotSub } from "./platlayout";
import { nameNow, RIVALS } from "./rivals";
import { Rng, tileNoise } from "./rng";
import { Terrain } from "./terrain";
import { priceLevel } from "./time";
import { CivicSub, HouseSub, Use } from "./town";
import { placeLandmark } from "./landmarks";
import { stepDist, HEX6 } from "./hex";

// ---------------------------------------------------------------- state

export type ServiceKind = "fire" | "police" | "hall" | "union";
export interface Service { tile: number; kind: ServiceKind; name: string; year: number; funded?: boolean; num?: number }
export interface Grave { name: string; born: number; died: number; line?: string }
export interface FireRec { year: number; season: number; x: number; y: number; tiles: number; dead: number; name: string; cause: string }
export type HappenKind = "funeral" | "parade" | "engine" | "election" | "feast";
export interface Happening {
  kind: HappenKind; name: string;
  /** where it starts and (processions) where it goes: tile indices */
  a: number; b?: number;
  /** the turn it's over */
  until: number;
  /** community (feast days, a parish funeral) */
  group?: number;
  /** how many walk */
  n?: number;
}

export interface CivState {
  services: Service[];
  /** burials so far in each real cemetery (by CEMETERIES index) */
  buried: number[];
  /** burials in the plats' own grounds, by block id */
  plat: Record<string, number>;
  /** real cemeteries laid out (ids) */
  laid: string[];
  /** each real cemetery's tiles, middle first, as laid out (by CEMETERIES index); tiles since given over to
   *  something else are skipped */
  grounds?: number[][];
  plot?: { cem: number; tile: number; graves: Grave[]; level: number };
  fires: FireRec[];
  /** burning lots: [tile, turn the flames are out] */
  burning: [number, number][];
  /** each block's fire risk a season (index block id − 1), worked out each spring */
  risk: number[];
  /** the year your company fire brigade was founded */
  brigade?: number;
  /** deaths waiting to be buried at the year's end, where they died: [x, y, n] */
  queued: [number, number, number][];
  happen: Happening[];
}

export function civOf(g: GameState): CivState {
  return (g.civ ??= { services: [], buried: CEMETERIES.map(() => 0), plat: {}, laid: [], fires: [], burning: [], risk: [], queued: [], happen: [] });
}

/** cemetery tile sub: fill 0–3 (bits 0–1), faith (bits 2–3), a real cemetery (bit 4), the family plot (bit 5), faith fixed (bit 6) */
export const CEM_FILL = 3, CEM_FAITH = 12, CEM_RURAL = 16, CEM_PLOT = 32, CEM_FIXED = 64;
const faithSub = (f: Faith) => (f << 2) & CEM_FAITH;
export const cemFaith = (sub: number): Faith => ((sub & CEM_FAITH) >> 2) as Faith;

/** the faith a community buries its dead by (for its parish grounds and which cemetery it uses) */
export function faithOf(gid: number): Faith {
  switch (gid) {
    case G.IRISH: case G.SLOVAK: case G.POLISH: case G.HUNGARIAN: case G.ITALIAN: case G.LITH: return Faith.Catholic;
    case G.RUSYN: case G.CROAT: return Faith.Orthodox;
    case G.JEWISH: return Faith.Jewish;
    default: return Faith.Mixed;
  }
}

// ---------------------------------------------------------------- the season and the year

/** every season, after the town's own work: fires, the flames dying down, what's in the streets */
export function civicLifeSeason(g: GameState) {
  if (!g.sleuth) return;
  const civ = civOf(g);
  // the flames are out: the lots stand charred
  if (civ.burning.length) civ.burning = civ.burning.filter(([, t]) => t > g.turn);
  civ.happen = civ.happen.filter((h) => h.until > g.turn);
  fireSeason(g);
  datedDisasters(g);
  seasonHappenings(g);
}

/** the disasters history set on their dates: their dead buried with a funeral, the fires lit where they began */
function datedDisasters(g: GameState) {
  const year = cal(g).year, season = g.turn % 4, W = g.map.width;
  for (const d of DATED_DEAD) if (d.year === year && d.season === season) { const [x, y] = tileOf(g, d.at); queueDead(g, x, y, d.dead, { name: d.name }); }
  for (const f of DATED_FIRES) {
    if (f.year !== year || f.season !== season) continue;
    const [x, y] = tileOf(g, f.at);
    if (!inBounds(g.map, x, y)) continue;
    // the nearest burnable lot to the spot
    let at = -1, bd = Infinity;
    for (let dy = -6; dy <= 6; dy++) for (let dx = -6; dx <= 6; dx++) {
      const xx = x + dx, yy = y + dy;
      if (!inBounds(g.map, xx, yy)) continue;
      const i = yy * W + xx, u = g.world.use[i];
      if (((u >= Use.Cottage && u <= Use.Rowhouses) || u === Use.Commerce) && Math.abs(dx) + Math.abs(dy) < bd) { bd = Math.abs(dx) + Math.abs(dy); at = i; }
    }
    const b = at >= 0 ? blockAt(g, at) : null;
    if (b) ignite(g, b, new Rng(`${g.seed}:datedfire:${f.year}`), { at, size: f.size, name: f.name, cause: f.cause });
  }
}

/** each spring: new grounds, the year's dead, the services the wards have earned, the year's fire risk, the laws */
export function civicLifeYear(g: GameState, quiet = false) {
  if (!g.sleuth) return;
  const civ = civOf(g), year = cal(g).year;
  layCemeteries(g, year, quiet);
  burials(g, year);
  familyGraves(g, year, quiet);
  services(g, year, quiet);
  fireRisk(g, year);
  barracks(g, year, quiet);
  penitentiary(g, year, quiet);
  milestones(g, year, quiet);
  // burnt lots nobody has rebuilt on go to plain cleared lots after three years
  if ((year & 1) === 0) {
    const w = g.world;
    for (const b of blocksOf(g)) for (const i of tilesOf(g, b)) if (w.use[i] === Use.Empty && w.sub[i] === LotSub.Burnt && year - w.built[i] >= 3) w.sub[i] = LotSub.Cleared;
  }
  if (civ.fires.length > 60) civ.fires = civ.fires.slice(-60);
}

// ---------------------------------------------------------------- cemeteries

const tileOf = (g: GameState, at: [number, number]): [number, number] => latLonToTile(g.map, at[0], at[1]);

/** the tiles of each real cemetery, middle first (kept in the state as they were laid out) */
function cemeteryTiles(g: GameState): number[][] {
  const civ = civOf(g);
  civ.grounds ??= [];
  while (civ.grounds.length < CEMETERIES.length) civ.grounds.push([]);
  return civ.grounds;
}

/** lay out the real cemeteries due by this year: a ground of their acreage around the real spot, on open land */
function layCemeteries(g: GameState, year: number, quiet: boolean) {
  const civ = civOf(g), m = g.map, w = g.world, W = m.width;
  CEMETERIES.forEach((c, k) => {
    if (year < c.open || civ.laid.includes(c.id)) return;
    civ.laid.push(c.id);
    while (civ.buried.length < CEMETERIES.length) civ.buried.push(0);
    const [cx, cy] = tileOf(g, c.at);
    if (!inBounds(m, cx, cy)) return;
    const want = Math.max(4, Math.round((c.acres * 4046.86) / (m.metersPerTile * m.metersPerTile)));
    // grow out from the middle over open ground, farms, woods and scattered cottages (never streets, works, rails)
    const ok = (i: number) => {
      const u = w.use[i];
      if (m.terrain[i] === Terrain.Water || m.terrain[i] === Terrain.Cliff || m.rail[i] || m.road[i] === 2 || m.bridge[i] || w.street[i] || w.owner[i]) return false;
      return u === Use.Empty || u === Use.Forest || u === Use.Farm || (u === Use.Cottage && w.sub[i] !== HouseSub.Estate) || (u === Use.Houses && w.pop[i] <= 10 && year <= 1860);
    };
    const seen = new Set<number>(), out: number[] = [];
    const start = cy * W + cx;
    let frontier: number[] = [start];
    seen.add(start);
    const R = Math.sqrt(want / Math.PI) * 1.9;
    while (frontier.length && out.length < want) {
      frontier.sort((p, q) => stepDist((p % W) - cx, ((p / W) | 0) - cy) - stepDist((q % W) - cx, ((q / W) | 0) - cy) || p - q);
      const next: number[] = [];
      for (const i of frontier) {
        if (out.length >= want) break;
        const x = i % W, y = (i / W) | 0;
        if (stepDist(x - cx, y - cy) > R) continue;
        if (ok(i)) out.push(i);
        if (m.terrain[i] === Terrain.Water) continue;
        for (const [dx, dy] of HEX6) {
          const xx = x + dx, yy = y + dy;
          if (!inBounds(m, xx, yy)) continue;
          const j = yy * W + xx;
          if (!seen.has(j)) { seen.add(j); next.push(j); }
        }
      }
      frontier = next;
    }
    const touched = new Set<Block>();
    for (const i of out) {
      const b = blockAt(g, i); if (b && w.pop[i]) touched.add(b);
      w.use[i] = Use.Cemetery; w.pop[i] = 0; w.built[i] = year; w.street[i] = 0;
      w.sub[i] = CEM_RURAL | CEM_FIXED | faithSub(c.faith); w.was[i] = k + 1; w.eth[i] = 0;
    }
    for (const b of touched) resyncBlock(g, b);
    w.version++;
    cemeteryTiles(g)[k] = out; // already middle first: the search grew out from the middle
    if (!quiet && out.length && year === c.open) log(g, `${cemeteryName(c, year)} is consecrated (${c.acres} acres).`);
  });
}

/** deaths a year per 1,000 people (Pittsburgh's were among the country's worst until filtration) */
const DEATH_RATE: [number, number][] = [[1850, 30], [1870, 26], [1890, 23], [1900, 21], [1908, 19], [1914, 15.5], [1917, 15], [1918, 25], [1919, 15], [1930, 12.5], [1950, 10.5], [1990, 10.8]];
export function deathRate(year: number): number {
  for (let k = 1; k < DEATH_RATE.length; k++) {
    const [y0, r0] = DEATH_RATE[k - 1], [y1, r1] = DEATH_RATE[k];
    if (year <= y1) return year === 1918 ? 25 : r0 + ((year - y0) / (y1 - y0)) * (r1 - r0);
  }
  return DEATH_RATE[DEATH_RATE.length - 1][1];
}

/** the real cemetery a block's dead are carried to: the nearest open one of their faith, else the nearest */
function cemeteryFor(g: GameState, x: number, y: number, faith: Faith): number {
  const civ = civOf(g), lists = cemeteryTiles(g);
  let best = -1, bd = Infinity, any = -1, ad = Infinity;
  CEMETERIES.forEach((c, k) => {
    if (!civ.laid.includes(c.id) || !lists[k]?.length) return;
    const [cx, cy] = tileOf(g, c.at), d = stepDist(cx - x, cy - y);
    if (d < ad) { ad = d; any = k; }
    const fits = c.faith === faith || (faith === Faith.Mixed && c.faith === Faith.Mixed) || (faith === Faith.Orthodox && c.faith === Faith.Catholic);
    if (fits && d < bd && d < 220) { bd = d; best = k; }
  });
  return best >= 0 ? best : any;
}

/** where a block's dead go: the open grounds of their faith within reach, shared by size over distance (a gravity model) */
function cemeteryShares(g: GameState, x: number, y: number, faith: Faith): [number, number][] {
  const civ = civOf(g), lists = cemeteryTiles(g), out: [number, number][] = [];
  let tot = 0;
  CEMETERIES.forEach((c, k) => {
    if (!civ.laid.includes(c.id) || !lists[k]?.length) return;
    const fits = c.faith === faith || (faith === Faith.Orthodox && c.faith === Faith.Catholic);
    const [cx, cy] = tileOf(g, c.at), d = stepDist(cx - x, cy - y);
    if (!fits || d > 220) return;
    const wt = lists[k].length / Math.max(12, d) ** 1.6;
    out.push([k, wt]); tot += wt;
  });
  if (!out.length) { const k = cemeteryFor(g, x, y, faith); return k >= 0 ? [[k, 1]] : []; }
  return out.map(([k, wt]) => [k, wt / tot]);
}

/** a block's faith: its largest community's */
function blockFaith(b: Block): Faith {
  let best = 1, bp = -1;
  for (let k = 1; k < b.byGroup.length; k++) if (b.byGroup[k] > bp) { bp = b.byGroup[k]; best = k; }
  return faithOf(best);
}

/** the year's dead to their graves, and the grounds' stones brought up to date */
function burials(g: GameState, year: number) {
  const civ = civOf(g), w = g.world, rate = deathRate(year - 1) / 1000;
  while (civ.buried.length < CEMETERIES.length) civ.buried.push(0);
  const own = new Map<number, Block>();
  for (const b of blocksOf(g)) {
    if (!b.pop) continue;
    const dead = b.pop * rate * (0.7 + (1 - b.health) * 0.9);
    let toReal = dead;
    if (b.civ?.includes("cemetery")) { civ.plat[b.id] = (civ.plat[b.id] ?? 0) + dead * 0.5; toReal = dead * 0.5; own.set(b.id, b); }
    for (const [k, share] of cemeteryShares(g, b.x, b.y, blockFaith(b))) civ.buried[k] += toReal * share;
  }
  for (const [x, y, n] of civ.queued) { const k = cemeteryFor(g, x, y, Faith.Mixed); if (k >= 0) civ.buried[k] += n; }
  civ.queued = [];
  // the stones: each ground fills from its middle outward
  const lists = cemeteryTiles(g);
  let changed = false;
  lists.forEach((l, k) => {
    const per = 60, b = civ.buried[k] ?? 0;
    l.forEach((i, r) => {
      if (w.use[i] !== Use.Cemetery || (w.sub[i] & CEM_PLOT)) return;
      const lv = Math.max(0, Math.min(3, Math.floor((b - r * per) / (per / 3))));
      const s = (w.sub[i] & ~CEM_FILL) | lv;
      if (s !== w.sub[i]) { w.sub[i] = s; changed = true; }
    });
  });
  // the plats' grounds (and the parish they belong to: the faith of the community that laid them out)
  for (const b of blocksOf(g)) {
    if (!b.civ?.includes("cemetery")) continue;
    const n = civ.plat[b.id] ?? 0, ts = tilesOf(g, b).filter((i) => w.use[i] === Use.Cemetery);
    const per = 60, f = faithSub(blockFaith(b));
    ts.forEach((i, r) => {
      let s = w.sub[i];
      if (!(s & CEM_FIXED)) s = (s & ~CEM_FAITH) | f | CEM_FIXED;
      s = (s & ~CEM_FILL) | Math.max(0, Math.min(3, Math.floor((n - r * per) / (per / 3)) + 1));
      if (s !== w.sub[i]) { w.sub[i] = s; changed = true; }
    });
  }
  if (changed) w.version++;
}

/** deaths away from home (the works, a fire, a riot) to be buried at the year's end */
export function queueDead(g: GameState, x: number, y: number, n: number, funeral?: { name: string; group?: number }) {
  if (!g.sleuth || n <= 0) return;
  const civ = civOf(g);
  civ.queued.push([x, y, n]);
  if (funeral) addFuneral(g, x, y, Math.min(40, 8 + n * 4), funeral.name, funeral.group);
}

/** the name, the faith and the burials of the cemetery at a tile (for the query panel) */
export function cemeteryAt(g: GameState, i: number): { name: string; who: string; buried: number; rural: boolean; plot: boolean } | null {
  const w = g.world;
  if (w.use[i] !== Use.Cemetery) return null;
  const civ = civOf(g), plot = civ.plot && civ.plot.tile === i;
  if ((w.sub[i] & CEM_RURAL) && w.was[i]) {
    const k = w.was[i] - 1, c = CEMETERIES[k];
    if (c) return { name: cemeteryName(c, cal(g).year), who: c.who, buried: Math.round(civ.buried[k] ?? 0), rural: !!c.rural, plot: !!plot };
  }
  const b = blockAt(g, i);
  const f = cemFaith(w.sub[i]);
  const who = f === Faith.Catholic ? "the parish's Catholic dead" : f === Faith.Orthodox ? "the parish's Orthodox and Greek Catholic dead" : f === Faith.Jewish ? "the congregation's dead" : "the town's dead";
  return { name: b ? `${b.name} burying ground` : "Burying ground", who, buried: Math.round(b ? civ.plat[b.id] ?? 0 : 0), rural: false, plot: false };
}

// ---------------------------------------------------------------- the family plot

/** the plot: laid with the founder's parents in the first year, the heads beside them as they die */
function familyGraves(g: GameState, year: number, quiet: boolean) {
  const f = g.family, civ = civOf(g);
  if (!f || !g.company) return;
  if (!civ.plot) {
    const k = CEMETERIES.findIndex((c) => c.id === "allegheny" && civ.laid.includes(c.id));
    const kk = k >= 0 ? k : CEMETERIES.findIndex((c) => civ.laid.includes(c.id) && c.faith === Faith.Mixed);
    const lists = cemeteryTiles(g);
    if (kk < 0 || !lists[kk]?.length) return;
    // on the high ground near the middle
    const inner = lists[kk].slice(0, Math.max(4, Math.floor(lists[kk].length * 0.25)));
    const tile = inner.reduce((a, i) => (g.map.elevation[i] > g.map.elevation[a] ? i : a), inner[0]);
    const founder = f.heads[0], rng = new Rng(`${g.seed}:plot:${founder.first}`);
    const fb = founder.born - 26 - rng.int(0, 6), mb = fb + 2 + rng.int(0, 5);
    const nb = (y: number) => Math.max(1800, y);
    const graves: Grave[] = [
      { name: `${pickName(rng, "m", nb(fb))} ${f.surname}`, born: fb, died: Math.max(CEMETERIES[kk].open, founder.from - 1 - rng.int(0, 4)), line: `${founder.first}'s father` },
      { name: `${pickName(rng, "f", nb(mb))} ${f.surname}`, born: mb, died: Math.min(year, founder.from + rng.int(1, 12)), line: `${founder.first}'s mother` },
    ];
    // a mother who outlives the founding is buried when her year comes
    civ.plot = { cem: kk, tile, graves: graves.filter((gr) => gr.died <= year), level: 0 };
    if (graves[1].died > year) (civ.plot as { pending?: Grave[] }).pending = [graves[1]];
    g.world.sub[tile] |= CEM_PLOT;
    g.world.version++;
  }
  const plot = civ.plot as NonNullable<CivState["plot"]> & { pending?: Grave[] };
  if (plot.pending?.length) {
    for (const gr of plot.pending) if (gr.died <= year) { plot.graves.push(gr); if (!quiet) log(g, `${gr.name} is buried in the family plot at ${CEMETERIES[plot.cem].name}.`); }
    plot.pending = plot.pending.filter((gr) => gr.died > year);
    if (!plot.pending.length) delete plot.pending;
  }
  // the heads who have stepped down die in their time; the head of the family lives to see the next era in
  const heads = f.heads;
  heads.forEach((h, k) => {
    if (h.died !== undefined || k === heads.length - 1) return;
    const age = year - h.born, rng = new Rng(`${g.seed}:death:${h.first}:${h.born}:${year}`);
    const p = age < 55 ? 0.005 : age < 65 ? 0.02 : age < 72 ? 0.05 : age < 80 ? 0.11 : age < 88 ? 0.22 : 1;
    if (!rng.chance(p)) return;
    h.died = year;
    const name = `${h.first} ${f.surname}`;
    plot.graves.push({ name, born: h.born, died: year, line: h.verdict ?? `head of the family ${h.from}–${h.to ?? year}` });
    if (quiet) return;
    if (k === 0) pushHeadline(g, `${name} Dead at ${age}`, `The founder of ${g.company!.name} is buried in the family plot at ${CEMETERIES[plot.cem].name}. The works stand still for the funeral; the men line the road.`, "Society");
    else log(g, `${name} dies, aged ${age}, and is buried in the family plot at ${CEMETERIES[plot.cem].name}.`);
    const [px, py] = [plot.tile % g.map.width, (plot.tile / g.map.width) | 0];
    addFuneral(g, g.company!.x + (g.company!.footprint >> 1), g.company!.y + (g.company!.footprint >> 1), 30, `${name}'s funeral`, undefined, plot.tile);
    void px; void py;
  });
  // headstones, then an obelisk, then a mausoleum as the family's name grows
  const lg = legacy(g);
  const level = lg.fortune >= 72 || (lg.total >= 62 && plot.graves.length >= 4) ? 2 : lg.fortune >= 50 || plot.graves.length >= 4 ? 1 : 0;
  if (level > plot.level) { plot.level = level; g.world.version++; if (!quiet && level === 2) log(g, `A mausoleum rises over the ${f.surname} plot at ${CEMETERIES[plot.cem].name}.`); }
}

// ---------------------------------------------------------------- services

/** a block's name as a place (company rows and plats go by the town they belong to) */
const placeName = (b: Block) => b.name.replace(/\s+(company rows|company plat|plat|coal patch|patch|hillside|rows)$/i, "").replace(/\s*\(.*\)$/, "");
const isCity = (b: Block) => !!b.city || (b.type === "core" && /Point|Pittsburgh|Allegheny/.test(b.name));
const svcOf = (g: GameState, kind: ServiceKind) => civOf(g).services.filter((s) => s.kind === kind && g.world.use[s.tile] === Use.Civic);
const SUB: Record<ServiceKind, CivicSub> = { fire: CivicSub.Firehouse, police: CivicSub.Police, hall: CivicSub.BoroughHall, union: CivicSub.UnionHall };

/** put up a public building on a lot (taking a frame house if it must) */
function raise(g: GameState, b: Block, i: number, kind: ServiceKind, name: string, funded = false): Service {
  const w = g.world, year = cal(g).year;
  w.use[i] = Use.Civic; w.sub[i] = SUB[kind]; w.pop[i] = 0; w.built[i] = year; w.eth[i] = 0; w.was[i] = 0;
  resyncBlock(g, b);
  w.version++;
  const s: Service = { tile: i, kind, name, year, funded: funded || undefined };
  civOf(g).services.push(s);
  return s;
}

/** fire reach in tiles: horses ~600 m, motors ~1 km */
export const fireReach = (year: number) => (year >= SERVICE_DATES.motorFire ? 32 : 22);
/** how much of a fire an engine house in reach puts out: volunteers, the paid steamers, the motor pumpers */
export const fireSkill = (year: number, city: boolean) => (year >= SERVICE_DATES.motorFire ? 0.72 : year >= SERVICE_DATES.paidFire && city ? 0.55 : year >= 1885 ? 0.45 : 0.32);

function wardBlocks(g: GameState): Map<number, Block[]> {
  const out = new Map<number, Block[]>();
  for (const b of blocksOf(g)) { if (!b.pop) continue; const k = wardOf(g, b.id); const l = out.get(k); if (l) l.push(b); else out.set(k, [b]); }
  return out;
}

function nearestSvc(g: GameState, list: Service[], x: number, y: number): number {
  const W = g.map.width;
  let d = Infinity;
  for (const s of list) d = Math.min(d, stepDist((s.tile % W) - x, ((s.tile / W) | 0) - y));
  return d;
}

/** the wards earn their engine houses, station houses, borough buildings and union halls */
function services(g: GameState, year: number, quiet: boolean) {
  const W = g.map.width, wards = wardBlocks(g), civ = civOf(g);
  const fires = svcOf(g, "fire"), police = svcOf(g, "police"), halls = svcOf(g, "hall"), unions = svcOf(g, "union");
  const steel = steelWorks(g);
  let n = 0;
  for (const [root, bs] of [...wards.entries()].sort((p, q) => p[0] - q[0])) {
    if (n >= 8) break;
    const P = bs.reduce((s, b) => s + b.pop, 0);
    const head = blocksOf(g)[root - 1] ?? bs[0];
    const city = bs.some(isCity);
    const inWard = (s: Service) => { const b = blockAt(g, s.tile); return !!b && wardOf(g, b.id) === root; };
    const biggest = [...bs].sort((p, q) => q.pop - p.pop || p.id - q.id);
    // an engine house for every ~8,000 people (one at 1,200), where the ward is furthest from one
    const wantFire = P < 1200 ? 0 : Math.min(8, 1 + Math.floor((P - 1200) / 8000));
    if (fires.filter(inWard).length < wantFire && (year + root) % 2 === 0) {
      const b = biggest.reduce((a, c) => (nearestSvc(g, fires, c.x, c.y) > nearestSvc(g, fires, a.x, a.y) ? c : a), biggest[0]);
      const i = nearestSvc(g, fires, b.x, b.y) > fireReach(year) * 0.7 ? serviceLot(g, b) : -1;
      if (i >= 0) {
        const paid = city && year >= SERVICE_DATES.paidFire;
        const num = civ.services.filter((s) => s.kind === "fire").length + 1;
        const vol = VOLUNTEER_COMPANIES[(num - 1) % VOLUNTEER_COMPANIES.length];
        const name = paid ? `Engine Company No. ${fires.filter((s) => s.num).length + 1}` : city ? `${vol} Fire Company` : `${placeName(head)} Volunteer Fire Company`;
        const s = raise(g, b, i, "fire", name);
        if (paid) s.num = fires.filter((x) => x.num).length + 1;
        fires.push(s); n++;
        if (!quiet) log(g, `${name} opens an engine house in ${b.name}.`);
      }
    }
    // city police: a station house for every ~16,000 people (one at 4,000), from 1857
    if (city && year >= SERVICE_DATES.police) {
      const want = P < 4000 ? 0 : Math.min(5, 1 + Math.floor((P - 4000) / 16000));
      if (police.filter(inWard).length < want && (year + root) % 3 === 0) {
        const b = biggest.reduce((a, c) => (nearestSvc(g, police, c.x, c.y) > nearestSvc(g, police, a.x, a.y) ? c : a), biggest[0]);
        const i = nearestSvc(g, police, b.x, b.y) > 26 ? serviceLot(g, b) : -1;
        if (i >= 0) { const s = raise(g, b, i, "police", `${placeName(b)} Police Station`); police.push(s); n++; if (!quiet) log(g, `A police station house opens in ${b.name}.`); }
      }
    }
    // a borough: its borough building (council chamber, the burgess's court, the lockup)
    if (!city && P >= 2000 && year >= 1855 && !halls.some(inWard) && bs.some((b) => b.type === "mill" || b.type === "core" || b.type === "plat")) {
      const i = serviceLot(g, biggest[0]);
      if (i >= 0) { const s = raise(g, biggest[0], i, "hall", `${placeName(head)} Borough Building`); halls.push(s); n++; if (!quiet) log(g, `${placeName(head)} puts up a borough building, with a lockup in the basement.`); }
    }
    // a union hall in a mill ward by a steel works: the Amalgamated's lodges (1877–92), the Steelworkers' locals (from 1937)
    const lodgeEra = (year >= SERVICE_DATES.amalgamated + 1 && year <= 1892) || year >= SERVICE_DATES.swoc + 1;
    if (lodgeEra && P >= 900 && !unions.some(inWard)) {
      const b = biggest.find((x) => steel.some(([sx, sy]) => stepDist(sx - x.x, sy - x.y) < 34));
      if (b) {
        const i = serviceLot(g, b);
        if (i >= 0) {
          const name = year <= 1892 ? `${placeName(b)} Lodge, Amalgamated Association` : `Steelworkers' Hall (${placeName(b)})`;
          const s = raise(g, b, i, "union", name); unions.push(s); n++;
          if (!quiet) log(g, year <= 1892 ? `The iron and steel workers of ${b.name} open a lodge hall of the Amalgamated Association.` : `The Steelworkers open a union hall in ${b.name}.`);
        }
      }
    }
  }
  // after Homestead the Amalgamated's lodges fold: their halls become plain social halls
  if (year === 1893 || (year > 1893 && year < 1900 && (year & 1))) {
    for (const s of civ.services) if (s.kind === "union" && s.year <= 1892 && g.world.use[s.tile] === Use.Civic && g.world.sub[s.tile] === CivicSub.UnionHall) {
      if (tileNoise(g.seed, s.tile, year, 941) < 0.5) continue;
      g.world.sub[s.tile] = CivicSub.Hall; s.name = `${s.name.split(" Lodge")[0]} Hall (the lodge has folded)`; g.world.version++;
    }
  }
  void W;
}

function steelWorks(g: GameState): [number, number][] {
  const out: [number, number][] = [];
  for (const r of g.rivals) { const d = RIVALS.find((x) => x.id === r.id); if (r.active && !r.closed && !r.offmap && d?.industry === "steel") out.push([r.x + r.footprint / 2, r.y + r.footprint / 2]); }
  if (g.company) for (const w of allWorks(g.company)) if (w.industry === "steel") out.push([w.x + w.footprint / 2, w.y + w.footprint / 2]);
  return out;
}

/** the service building at a tile (for the query panel) */
export function serviceAt(g: GameState, i: number): Service | null {
  return g.civ?.services.find((s) => s.tile === i && g.world.use[i] === Use.Civic) ?? null;
}

/** what the station houses do: they calm the wards around them a little (read by updateHealth beside hoodBoosts) */
export function civicBoosts(g: GameState): { x: number; y: number; r: number; water: number; health: number; unrest: number }[] {
  if (!g.civ) return [];
  const W = g.map.width, out: { x: number; y: number; r: number; water: number; health: number; unrest: number }[] = [];
  for (const s of g.civ.services) if ((s.kind === "police" || s.kind === "hall") && g.world.use[s.tile] === Use.Civic) out.push({ x: s.tile % W, y: (s.tile / W) | 0, r: s.kind === "police" ? 24 : 16, water: 1, health: 0, unrest: s.kind === "police" ? (s.funded ? -0.03 : -0.02) : -0.01 });
  return out;
}

// ---------------------------------------------------------------- fire

/** how hot a works runs, for the sparks it throws (furnaces, glass tanks and stills worst) */
const HEAT: Record<string, number> = { steel: 1, glass: 0.9, chemicals: 0.8, aluminium: 0.7, metalworks: 0.6, power: 0.5, nuclear: 0.1, medicine: 0.05, research: 0.05 };

interface Hot { x: number; y: number; heat: number; name: string; mine: boolean }
function hotWorks(g: GameState): Hot[] {
  const out: Hot[] = [];
  for (const r of g.rivals) {
    const d = RIVALS.find((x) => x.id === r.id);
    if (!d || !r.active || r.closed || r.offmap) continue;
    out.push({ x: r.x + r.footprint / 2, y: r.y + r.footprint / 2, heat: HEAT[d.industry] ?? 0.3, name: nameNow(d, cal(g).year, r.name, r.nameYear), mine: !!r.owned });
  }
  if (g.company) for (const w of allWorks(g.company)) if (w.employees > 0) out.push({ x: w.x + w.footprint / 2, y: w.y + w.footprint / 2, heat: HEAT[w.industry] ?? 0.3, name: w.name, mine: true });
  return out;
}
/** sparks and cinders: full within 6 tiles of a works, gone by 40 */
const sparks = (d: number) => Math.max(0, Math.min(1, 1 - (d - 6) / 34));

/** each spring: each block's chance of a fire in a season */
function fireRisk(g: GameState, year: number) {
  const civ = civOf(g), w = g.world, hot = hotWorks(g), fires = svcOf(g, "fire");
  const era = year < 1900 ? 1 : year < 1930 ? 0.8 : year < 1960 ? 0.5 : 0.35;
  civ.risk = [];
  for (const b of blocksOf(g)) {
    if (!b.pop || b.built < 4) { civ.risk[b.id - 1] = 0; continue; }
    const tiles = tilesOf(g, b);
    let frame = 0, built = 0;
    for (let k = 0; k < tiles.length; k += Math.max(1, Math.floor(tiles.length / 60))) { const u = w.use[tiles[k]]; if (u === Use.Cottage || u === Use.Houses) { frame++; built++; } else if (u === Use.Rowhouses || u === Use.Commerce) built++; }
    const fr = built ? frame / built : 0.5;
    let ind = 0;
    for (const h of hot) ind = Math.max(ind, h.heat * sparks(stepDist(h.x - b.x, h.y - b.y)));
    const cover = Math.max(0, 1 - nearestSvc(g, fires, b.x, b.y) / fireReach(year)) * fireSkill(year, isCity(b));
    civ.risk[b.id - 1] = (0.003 + 0.022 * ind) * (0.35 + fr) * Math.min(1.5, b.pop / 600) * era * (1 - 0.6 * cover);
  }
}

/** the fire risk of a block (for the fire layer and the query panel) */
export function blockRisk(g: GameState, b: Block): number { return g.civ?.risk[b.id - 1] ?? 0; }

const SEASON_FIRE = [0.9, 0.8, 1.1, 1.6]; // spring, summer, autumn, winter (stoves and lamps)
const CAUSES = ["an overturned coal-oil lamp", "a stove in a back kitchen", "a livery stable", "a planing mill", "boys with matches", "a chimney fire"];

function fireSeason(g: GameState) {
  const civ = civOf(g), season = g.turn % 4, rng = new Rng(`${g.seed}:fire:${g.turn}`);
  if (!civ.risk.length) return;
  const sm = SEASON_FIRE[season];
  for (const b of blocksOf(g)) {
    const r = civ.risk[b.id - 1] ?? 0;
    if (!r || !b.pop || !rng.chance(r * sm)) continue;
    ignite(g, b, rng);
  }
}

/** a fire breaks out in a block: where it starts, how far it runs, what it leaves */
export function ignite(g: GameState, b: Block, rng: Rng, opts: { at?: number; size?: number; name?: string; cause?: string } = {}): FireRec | null {
  const m = g.map, w = g.world, W = m.width, year = cal(g).year, civ = civOf(g);
  const tiles = tilesOf(g, b);
  const burnable = (i: number) => { const u = w.use[i]; return (u >= Use.Cottage && u <= Use.Rowhouses) || u === Use.Commerce || (u === Use.Civic && w.sub[i] !== CivicSub.Firehouse); };
  const hot = hotWorks(g);
  let src: Hot | null = null, sd = Infinity;
  for (const h of hot) { const d = stepDist(h.x - b.x, h.y - b.y); if (h.heat * sparks(d) > 0.25 && d < sd) { sd = d; src = h; } }
  // where it starts: near the furnaces if they threw the sparks, else a lot anywhere in the block
  let start = opts.at ?? -1;
  if (start < 0) {
    const cands = tiles.filter(burnable);
    if (!cands.length) return null;
    if (src && rng.chance(0.65)) start = cands.reduce((a, i) => (stepDist((i % W) - src!.x, ((i / W) | 0) - src!.y) < stepDist((a % W) - src!.x, ((a / W) | 0) - src!.y) ? i : a), cands[0]);
    else start = cands[rng.int(0, cands.length - 1)];
  }
  const cause = opts.cause ?? (src && rng.chance(0.65) ? `sparks from the ${src.name}` : CAUSES[rng.int(0, CAUSES.length - 1)]);
  // the engines: how much each lot is defended
  const fires = svcOf(g, "fire"), reach = fireReach(year), skill = fireSkill(year, isCity(b));
  const c = g.company, cx = c ? c.x + c.footprint / 2 : -999, cy = c ? c.y + c.footprint / 2 : -999;
  const brigade = civ.brigade !== undefined;
  const water = (i: number) => { const x = i % W, y = (i / W) | 0; return c && c.hood?.water && stepDist(x - cx, y - cy) < 40 ? 0.12 : year >= 1910 ? 0.1 : 0; };
  const defend = (i: number) => {
    const x = i % W, y = (i / W) | 0;
    const d = nearestSvc(g, fires, x, y);
    let s = Math.max(0, 1 - d / reach) * skill + water(i);
    if (brigade && stepDist(x - cx, y - cy) < 40) s += 0.25;
    return Math.min(0.92, s);
  };
  const spreadP = (i: number) => {
    const u = w.use[i];
    const base = u === Use.Cottage ? 0.8 : u === Use.Houses ? 0.74 : u === Use.Commerce ? 0.46 : u === Use.Civic ? 0.3 : 0.22;
    return base * (1 - defend(i)) * (year >= 1950 ? 0.6 : 1);
  };
  const cap = opts.size ?? 160;
  const burnt: number[] = [start], seen = new Set<number>([start]);
  let front = [start], gen = 0;
  while (front.length && burnt.length < cap && gen < 18) {
    const next: number[] = [];
    for (const i of front) {
      const x = i % W, y = (i / W) | 0;
      for (const [dx, dy] of HEX6) {
        const xx = x + dx, yy = y + dy;
        if (!inBounds(m, xx, yy)) continue;
        let j = yy * W + xx, jump = 1;
        // a street or alley in the way: it jumps across only now and then
        if (!burnable(j) && (w.street[j] || m.road[j])) {
          const x2 = xx + dx, y2 = yy + dy;
          if (!inBounds(m, x2, y2)) continue;
          j = y2 * W + x2; jump = 0.3;
        }
        if (seen.has(j) || !burnable(j)) continue;
        seen.add(j);
        if (rng.chance(spreadP(j) * jump * (opts.size ? 1.25 : 1))) { burnt.push(j); next.push(j); if (burnt.length >= cap) break; }
      }
      if (burnt.length >= cap) break;
    }
    front = next; gen++;
  }
  // what it leaves: charred lots, the families burnt out, the dead
  let people = 0;
  const touched = new Set<Block>();
  for (const i of burnt) {
    people += w.pop[i];
    const bb = blockAt(g, i); if (bb) touched.add(bb);
    w.use[i] = Use.Empty; w.sub[i] = LotSub.Burnt; w.pop[i] = 0; w.built[i] = year; w.structure[i] = 0;
    civ.burning.push([i, g.turn + 1]);
  }
  for (const bb of touched) resyncBlock(g, bb);
  w.version++;
  const dead = Math.round(people * (year < 1900 ? 0.004 : 0.002) + rng.next() * (burnt.length > 30 ? 3 : 0.6));
  const x: number = start % W, y: number = (start / W) | 0;
  const name = opts.name ?? `The ${b.name} Fire of ${year}`;
  const rec: FireRec = { year, season: g.turn % 4, x, y, tiles: burnt.length, dead, name, cause };
  civ.fires.push(rec);
  if (dead) queueDead(g, x, y, dead, { name: `the funeral of the fire's dead` });
  // an engine run to the fire
  if (fires.length) {
    const fh = fires.reduce((a, s) => (stepDist((s.tile % W) - x, ((s.tile / W) | 0) - y) < stepDist((a.tile % W) - x, ((a.tile / W) | 0) - y) ? s : a), fires[0]);
    if (stepDist((fh.tile % W) - x, ((fh.tile / W) | 0) - y) < reach * 2) civ.happen.push({ kind: "engine", name: fh.name, a: fh.tile, b: start, until: g.turn + 1 });
  }
  const homes = burnt.length, families = Math.round(people / 5);
  const mine = !!src?.mine && cause.startsWith("sparks");
  if (homes >= 18) {
    pushHeadline(g, `Fire Sweeps ${b.name}`, `${name} burns ${homes} lots${families ? ` and turns ${families.toLocaleString()} families into the street` : ""}${dead ? `; ${dead} dead` : ""}. It began with ${cause}.${brigade && stepDist(x - cx, y - cy) < 40 ? ` The ${c!.name} fire brigade held the line.` : fires.length ? "" : " There is no engine house within reach."}`, "Disaster");
  } else if (homes >= 4) log(g, `Fire in ${b.name}: ${homes} lots burn (${cause}).`);
  if (c && mine && homes >= 4) {
    bump(g, "reputation", -Math.min(8, 1 + homes / 12));
    mark(g, { id: `fire${year}`, side: "public", kind: "grievance", weight: Math.min(10, 2 + homes / 10), text: `burned out ${b.name} with the sparks from the works` });
  } else if (c && brigade && homes >= 4 && stepDist(x - cx, y - cy) < 40) bump(g, "reputation", 1);
  g.morale = Math.max(0, g.morale - Math.min(4, homes / 15));
  return rec;
}

/** the fire's history at a lot (for the query panel): the fire that left it charred */
export function fireAt(g: GameState, i: number): FireRec | null {
  const w = g.world, W = g.map.width;
  if (!g.civ || w.use[i] !== Use.Empty || w.sub[i] !== LotSub.Burnt) return null;
  const x = i % W, y = (i / W) | 0;
  let best: FireRec | null = null, bd = Infinity;
  for (const f of g.civ.fires) if (f.year === w.built[i]) { const d = stepDist(f.x - x, f.y - y); if (d < bd) { bd = d; best = f; } }
  return best;
}

// ---------------------------------------------------------------- police, prisons, the laws

/** the Coal and Iron Police: a barracks at your gate while the company keeps them (1865–1931) */
function barracks(g: GameState, year: number, quiet: boolean) {
  const c = g.company;
  if (!c) return;
  for (const w of allWorks(c)) {
    const id = `barracks:${w.id}`, have = g.landmarks.find((l) => l.id === id);
    const want = c.biz.policy.police && year >= 1865 && year < SERVICE_DATES.coalIronEnd && w.employees > 0;
    if (want && (!have || have.state !== "open")) {
      const gate: [number, number] = [w.x + w.footprint, w.y + w.footprint];
      if (placeLandmark(g, { id, name: `Coal and Iron Police barracks (${w.name})`, kind: "barracks", place: w.name, tile: gate }) && !quiet && !have) log(g, `The company police put up a barracks at the gate of ${w.name}.`);
    } else if (!want && have?.state === "open") placeLandmark(g, { id, name: have.name, kind: "barracks", place: w.name }, "closed");
  }
}

/** the old penitentiary on the Allegheny Commons gives way to the new one at Woods Run (1882): the Commons get their ground back */
function penitentiary(g: GameState, year: number, quiet: boolean) {
  if (year < 1882 || g.flags.penMoved) return;
  g.flags.penMoved = true;
  const w = g.world, idx = 4; // STRUCTURES "penitentiary"
  const lm = g.map.landmarks.find((l) => l.kind === "structure:penitentiary");
  if (lm) {
    for (let dy = 0; dy < 3; dy++) for (let dx = 0; dx < 3; dx++) {
      const x: number = lm.x + dx, y: number = lm.y + dy;
      if (!inBounds(g.map, x, y)) continue;
      const i = y * g.map.width + x;
      if (w.use[i] !== Use.Landmark || (w.structure[i] !== idx && w.structure[i] !== 255)) continue;
      w.use[i] = Use.Park; w.sub[i] = 0; w.structure[i] = 0;
    }
    w.version++;
  }
  if (!quiet) log(g, "The Western Penitentiary moves out of Allegheny to its new walls at Woods Run; the old ground goes back to the Commons.");
}

/** the dates that change how the city is run */
function milestones(g: GameState, year: number, quiet: boolean) {
  const civ = civOf(g);
  if (year === SERVICE_DATES.paidFire) {
    // the city's volunteer companies become numbered engine companies of the paid department
    let k = 0;
    for (const s of civ.services) if (s.kind === "fire" && !s.num) { const b = blockAt(g, s.tile); if (b && isCity(b)) { s.num = ++k; s.name = `Engine Company No. ${k}`; } }
    if (!quiet) pushHeadline(g, "A Paid Fire Department", `The councils disband the volunteer companies — and their brawls at every blaze — for a paid department of ${k || "a few"} engine companies with steam engines and horses. The boroughs keep their volunteers.`, "Infrastructure");
  }
  if (quiet) return;
  if (year === SERVICE_DATES.police) log(g, "Pittsburgh joins its night watch and day police into one force under a chief of police.");
  if (year === SERVICE_DATES.motorFire) log(g, "The engine companies trade their horses for motor pumpers.");
  if (year === SERVICE_DATES.schoolLaw) pushHeadline(g, "Every Child to School", "Pennsylvania's compulsory attendance law sends children under thirteen to school; truant officers make the rounds of the mill towns. Boys in the works cost a company its good name.", "Society");
  if (year === SERVICE_DATES.statePolice) pushHeadline(g, "The State Police", "After the anthracite strike the legislature creates a mounted state police — the 'Cossacks' to the miners. When the sheriff calls, troopers ride in, not militia.", "Labor");
  if (year === SERVICE_DATES.schoolCode) log(g, "The School Code ends the ward school boards: one Board of Public Education runs the city's schools.");
  if (year === SERVICE_DATES.coalIronEnd) pushHeadline(g, "Company Police Abolished", "Governor Pinchot revokes the commissions of the Coal and Iron Police. The companies' private forces can no longer make arrests.", "Labor");
  if (year >= 1921 && year <= 1932 && g.dryShops.length && (year % 3 === 0)) {
    const b = blocksOf(g).filter((x) => x.pop > 3000).sort((p, q) => q.pop - p.pop)[(year >> 2) % 5];
    if (b) log(g, `Dry agents raid the speakeasies of ${b.name}; the ward boss has them open again within the week.`);
  }
}

// ---------------------------------------------------------------- happenings: what the streets show

function addFuneral(g: GameState, x: number, y: number, n: number, name: string, group?: number, to?: number) {
  const civ = civOf(g), W = g.map.width, w = g.world;
  if (civ.happen.filter((h) => h.kind === "funeral").length >= 4) return;
  // from the nearest church to the nearest burying ground
  let ch = -1, cd = Infinity, ce = to ?? -1, ed = Infinity;
  const R = 40;
  for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
    const xx = x + dx, yy = y + dy;
    if (!inBounds(g.map, xx, yy)) continue;
    const i = yy * W + xx, d = Math.abs(dx) + Math.abs(dy);
    if (w.use[i] === Use.Civic && w.sub[i] !== CivicSub.Firehouse && w.sub[i] !== CivicSub.Police && w.sub[i] !== CivicSub.School && d < cd) { cd = d; ch = i; }
    if (to === undefined && w.use[i] === Use.Cemetery && d < ed) { ed = d; ce = i; }
  }
  if (ch < 0) ch = y * W + x;
  if (ce < 0) return;
  civ.happen.push({ kind: "funeral", name, a: ch, b: ce, until: g.turn + 1, n, group });
}

/** the parades and feast days of the season (each spring, summer and autumn), and election crowds in the autumn */
function seasonHappenings(g: GameState) {
  const civ = civOf(g), c = cal(g), year = c.year, season = g.turn % 4, W = g.map.width, w = g.world;
  const big = blocksOf(g).filter((b) => b.pop >= 1500 && (b.type === "core" || b.type === "mill")).sort((p, q) => q.pop - p.pop || p.id - q.id);
  const at = (b: Block) => b.y * W + b.x;
  const until = g.turn + 1;
  const push = (h: Omit<Happening, "until">) => civ.happen.push({ ...h, until });
  const down = big[0];
  if (!down) return;
  if (season === 0) {
    if (year >= 1868) push({ kind: "parade", name: "Decoration Day parade", a: at(down), n: 30 });
    if (year === 1865) push({ kind: "parade", name: "the victory parade: the Union is saved", a: at(down), n: 46 });
    if (year === 1919) push({ kind: "parade", name: "the 'Welcome Home' parade for the boys of the 80th Division", a: at(down), n: 50 });
    // St. Patrick's Day, where the Irish are many
    if (year < 1868 && blocksOf(g).reduce((s, b) => s + b.byGroup[G.IRISH], 0) > 2500) push({ kind: "parade", name: "St. Patrick's Day parade", a: at(down), n: 26, group: G.IRISH });
    else { const irish = [...blocksOf(g)].filter((b) => b.pop >= 800 && b.byGroup[G.IRISH] / b.pop > 0.3).sort((p, q) => q.byGroup[G.IRISH] - p.byGroup[G.IRISH] || p.id - q.id)[0]; if (irish) push({ kind: "parade", name: "St. Patrick's Day parade", a: at(irish), n: 26, group: G.IRISH }); }
  }
  if (season === 1) {
    push({ kind: "parade", name: "Fourth of July parade", a: at(big[1] ?? down), n: 34 });
    // the feast days: an Italian festa, a Slavic parish's procession, wherever the community holds a block
    const feast = [...blocksOf(g)].filter((b) => b.pop >= 600 && b.kit && b.kit >= 5).sort((p, q) => q.pop - p.pop || p.id - q.id).slice(0, 2);
    for (const b of feast) push({ kind: "feast", name: b.kit === G.ITALIAN ? `the festa of ${b.name}` : `the parish procession in ${b.name}`, a: at(b), n: 24, group: b.kit });
  }
  if (season === 2) {
    if (year >= 1882) push({ kind: "parade", name: year >= 1894 ? "Labor Day parade" : "the workingmen's parade", a: at(big[0]), n: 40 });
    if (year === 1945) push({ kind: "parade", name: "V-J Day: the city pours into the streets", a: at(down), n: 60 });
    if ((year & 1) === 0) for (const s of civ.services.filter((x) => (x.kind === "hall" || x.kind === "police") && w.use[x.tile] === Use.Civic).slice(0, 4)) push({ kind: "election", name: "Election day", a: s.tile, n: 14 });
  }
  if (season === 3 && year === 1918) push({ kind: "parade", name: "Armistice Day: the whistles blow and the mills empty", a: at(down), n: 60 });
}

// ---------------------------------------------------------------- your actions

const yr = (g: GameState) => cal(g).year;
const cost = (g: GameState, v: number) => Math.round((v * priceLevel(yr(g))) / 100) * 100;
/** the block nearest your works, for a building you pay for */
function blockByWorks(g: GameState): Block | null {
  const c = g.company;
  if (!c) return null;
  const cx = c.x + c.footprint / 2, cy = c.y + c.footprint / 2;
  let best: Block | null = null, bd = Infinity;
  for (const b of blocksOf(g)) { if (b.pop < 150) continue; const d = stepDist(b.x - cx, b.y - cy); if (d < bd) { bd = d; best = b; } }
  return best && bd < 60 ? best : null;
}

export const CIVIC_ACTIONS: ActionDef[] = [
  {
    id: "civ_brigade", group: "Neighbourhood", name: "Company fire brigade",
    blurb: "Hose carts, a steam pumper and drilled men at the works: fires within ~1.2 km of it spread far less. Reputation +2.",
    cost: (g) => cost(g, 6000),
    blocked: (g) => (!g.sleuth ? "Not in this town model" : g.civ?.brigade !== undefined ? "Already founded" : null),
    run: (g) => { civOf(g).brigade = yr(g); bump(g, "reputation", 2); return `${g.company!.name} drills its own fire brigade.`; },
  },
  {
    id: "civ_firehouse", group: "Neighbourhood", name: "Give the town an engine house",
    blurb: "Pay for an engine house and its engine in the neighbourhood by your works. Reputation +2, morale +1.",
    cost: (g) => cost(g, 9000),
    blocked: (g) => { const b = blockByWorks(g); if (!b) return "No neighbourhood by the works yet"; return nearestSvc(g, svcOf(g, "fire"), b.x, b.y) < 8 ? "There's an engine house close by already" : null; },
    run: (g) => {
      const b = blockByWorks(g)!, i = serviceLot(g, b);
      if (i < 0) return "No lot for it: the money goes to the volunteers' new engine.";
      const s = raise(g, b, i, "fire", `${g.company!.name.split(" ")[0]} Hose Company (${b.name})`, true);
      bump(g, "reputation", 2); g.morale = Math.min(100, g.morale + 1);
      return `${s.name} opens its doors.`;
    },
  },
  {
    id: "civ_police", group: "Neighbourhood", name: "Pay for a police station",
    blurb: "A station house by the works, paid by the company: the wards around it are quieter (unrest down) and the city owes you (influence +3). The men read it as a company station: labour −3.",
    cost: (g) => cost(g, 15000),
    blocked: (g) => { if (yr(g) < SERVICE_DATES.police) return `From ${SERVICE_DATES.police}`; const b = blockByWorks(g); if (!b) return "No neighbourhood by the works yet"; return nearestSvc(g, svcOf(g, "police"), b.x, b.y) < 10 ? "There's a station house close by already" : null; },
    run: (g) => {
      const b = blockByWorks(g)!, i = serviceLot(g, b);
      if (i < 0) return "No lot for it: the money goes to the city's police fund.";
      raise(g, b, i, "police", `${placeName(b)} Police Station`, true);
      bump(g, "influence", 3); bump(g, "labour", -3);
      mark(g, { id: "policeStation", side: "labour", kind: "grievance", weight: 3, text: "put a police station at the mill gate" });
      return `A police station house opens in ${b.name}, paid for by ${g.company!.name}.`;
    },
  },
];

