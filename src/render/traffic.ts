// Life on the map: people, wagons, streetcars, cars and trucks on the streets and bridges; trains on
// the open rail lines; steamboats and towboats on the rivers. A pool of agents lives around the camera;
// nothing is simulated off screen, but what you see reads the simulation:
//
//   streets  where the commute model sends people (env.traffic); a third of them are going somewhere — to
//            the nearest works or downtown along the travel-time fields — and vanish at the gate. Shift
//            change at dawn and dusk; thin, lit traffic at night. Pickets at the gate of a works on strike,
//            idle men on the corners of towns whose mill closed, nobody on a flooded floodplain.
//   rails    trains run where the freight goes, straight through junctions toward the busier track, and
//            back out of a dead end; a cut of cars stands at a works siding that ships by rail.
//   rivers   boats run up or down the river along the channel; fewer in winter (ice), some laid up.
//
// Street figures are cached sprites (figures.ts); trains and boats are drawn live as oriented boxes.

import { snapToRail } from "../core/lines";
import { blockGrid, blockOf } from "../core/blocks";
import { allWorks, cal, type GameState, type Works } from "../core/game";
import { siteAccess } from "../core/freight";
import type { GameMap, Span } from "../core/map";
import { RIVALS } from "../core/rivals";
import { Rng } from "../core/rng";
import { Terrain } from "../core/terrain";
import { SEASON_EFFECTS } from "../core/time";
import { Street, Use } from "../core/town";
import { barrelFig, type Facing, type Fig, frontOf, glowSprite, type Look, motorEra, obox, ooff, poolLook, placardFig, sh, type VehicleSpec, vehicleFig, walkerFig } from "./figures";
import { type Camera, BASE_M, heightAt, HH, HW, project, ZPX } from "./iso";
import { windFor } from "./pollution";
import { stageOf } from "./renderer";
import { waterFields } from "./waterfields";

type Kind = "walker" | "wagon" | "carriage" | "horsecar" | "streetcar" | "auto" | "truck" | "train" | "steamboat" | "tow";
/** wander: drifts along the busy streets; in: heading to a job centre; out: heading home from a works; idle: out of work, standing about */
type Role = "wander" | "in" | "out" | "idle";
type CarType = "steam" | "tender" | "diesel" | "hopper" | "box" | "jenny" | "gon" | "flat" | "tank" | "covered" | "caboose" | "coach" | "baggage";
interface Car { type: CarType; len: number; col: string; col2?: string }

interface Agent {
  kind: Kind;
  x: number; y: number;        // current tile
  px: number; py: number;      // previous tile
  nx: number; ny: number;      // next tile
  t: number;                   // progress from the current tile toward the next, 0..1
  speed: number;               // tiles per second
  col: string;
  seed: number;                // 0..1, per-agent variety (animation phase)
  alpha: number;               // fades in on arrival, out on leaving
  dying?: boolean;
  dist: number;                // distance travelled (drives the walking / wheel animation)
  hx: number; hy: number;      // last heading (tile space), for facing when stopped
  // street
  role: Role;
  look?: Look;
  spec?: VehicleSpec;
  dest?: number;               // job centre index (in / out)
  cm?: GameState["commute"];   // the commute fields the destination belongs to
  best?: number; stall?: number; life?: number; wait?: number;
  // trains
  trail?: [number, number][];  // tiles behind the head, newest first
  cars?: Car[];
  need?: number;               // trail length to keep (tiles)
  rev?: boolean;               // shoving: the locomotive is at the far end
  puffT?: number;
  // boats
  fx?: number; fy?: number;    // continuous position
  ang?: number;                // heading (radians, tile space)
  wantX?: number; wantY?: number; // smoothed desired heading
  sgn?: number;                // +1 away from the Point along the rivers, -1 toward it
  free?: number;               // seconds of holding course (through the confluence)
  stuck?: number;
  moored?: boolean;
  barges?: string[];           // barge cargo colours (tows)
  len?: number;
}

interface Puff { x: number; y: number; h: number; ox: number; oy: number; age: number; life: number; r: number; c: number; a: number }
interface PicketSite { key: string; block: number[]; cx: number; cy: number; ex: number; ey: number; ox: number; oy: number; figs: { look: Look; fx: number; fy: number; march?: number; placard?: number }[]; barrel: [number, number] }
interface ParkedCut { cars: { x: number; y: number; dx: number; dy: number; car: Car }[]; steam: boolean; puffT: number; loco: number }
interface Centre { j: number; x: number; y: number; r: number; works: boolean; running: boolean }

const DIR4 = [[1, 0], [-1, 0], [0, 1], [0, -1]] as const;
const DIR8 = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]] as const;
const RIVAL_IDS = new Set(RIVALS.map((r) => r.id));
const isWorksName = (n: string) => n === "p" || n.startsWith("p:") || RIVAL_IDS.has(n);
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
/** light colours: lamp, headlamp, tail lamp, fire, trolley spark */
const LIGHT_RGB = ["255,206,130", "255,236,190", "255,60,40", "255,140,50", "190,215,255"];

export class Traffic {
  private agents: Agent[] = [];
  private shore: Uint8Array;           // water tiles: distance to land (capped)
  private down: Float32Array;          // water tiles: distance along the rivers from the Point
  private deck = new Map<number, number>(); // bridge tiles → deck height (m)
  private deckYear = -1;
  private snapCache = new Map<number, [number, number]>();
  private railSpans: Span[] = [];
  /** street tiles a picket crowd stands in (vehicles keep out) */
  private blocked = new Set<number>();
  /** street agents on each tile this frame (people and vehicles keep their distance instead of swarming) */
  private occ = new Map<number, number>();
  private rng = new Rng("traffic");
  private last = 0;
  private dt = 0;
  private puffs: Puff[] = [];
  /** set by the app: is a screen point covered by something nearer than tile depth d (renderer.occluded) */
  occluded?: (sx: number, sy: number, d: number) => boolean;
  /** set by the app: is this tile inside a works (trains don't run through the mills) */
  worksTile?: (i: number) => boolean;
  private pickets: PicketSite[] = [];
  private parked: ParkedCut[] = [];
  private sceneKey = "";
  private parkedKey = "";
  private centres: Centre[] = [];
  private slump: [number, number, number, number][] = [];
  private floodAll = false;
  private floodNear: [number, number, number][] = [];
  private night = 0;
  private surge = 0;
  private year = 1850;
  private wind: { x: number; y: number; s: number } = { x: 1, y: -0.2, s: 1 };
  /** lights gathered while drawing: x, y, radius, alpha, colour index */
  private lights: number[] = [];
  /** set once main.ts draws the lights after the night tint (drawLights) */
  private lightsAfterTint = false;

  /** forget everything from the last game (New town): agents, the freight field and the bridge decks */
  reset() {
    this.agents = []; this.puffs = []; this.pickets = []; this.parked = []; this.blocked.clear();
    this.sceneKey = ""; this.parkedKey = "";
    this.freightTurn = -1; this.freightBlock = undefined;
    this.deck.clear(); this.deckYear = -1; this.snapCache.clear();
  }

  constructor(private m: GameMap) {
    const f = waterFields(m);
    this.shore = f.shore; this.down = f.down;
  }

  /** deck heights over water for the bridges standing this year */
  private updateDecks(year: number, built: Span[] = []) {
    // keyed by year and by how many bridges you've built (each adds a span)
    if (year * 1000 + built.length === this.deckYear) return;
    this.deckYear = year * 1000 + built.length;
    this.deck.clear(); this.snapCache.clear();
    this.railSpans = [];
    for (const sp of [...this.m.spans, ...built]) {
      const st = stageOf(sp, year);
      if (!st) continue;
      if (sp.kind === "rail") this.railSpans.push(sp);
      const prof = spanProfile(this.m, sp, st.type, st.year);
      const len = Math.hypot(sp.b[0] - sp.a[0], sp.b[1] - sp.a[1]);
      for (let k = 0; k <= len * 4; k++) {
        const f = k / (len * 4);
        const x = Math.floor(sp.a[0] + (sp.b[0] - sp.a[0]) * f), y = Math.floor(sp.a[1] + (sp.b[1] - sp.a[1]) * f);
        const i = y * this.m.width + x;
        this.deck.set(i, Math.max(this.deck.get(i) ?? -Infinity, prof(f)));
      }
    }
    // diagonal spans rasterize as staircases: give neighbouring water tiles the deck height too,
    // so street agents on TIGER ramp tiles ride the deck rather than the river
    const extra: [number, number][] = [];
    for (const [i, h] of this.deck) {
      const x = i % this.m.width, y = (i / this.m.width) | 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const j = (y + dy) * this.m.width + x + dx;
        if (!this.deck.has(j) && this.m.terrain[j] === Terrain.Water) extra.push([j, h]);
      }
    }
    for (const [j, h] of extra) this.deck.set(j, Math.max(this.deck.get(j) ?? -Infinity, h));
  }

  /** a street tile an agent may use: never open water unless a standing deck covers it, nor a flooded floodplain */
  private streetOk(w: GameState["world"], j: number): number {
    const s = w.street[j];
    if (!s) return 0;
    const t = this.m.terrain[j];
    if (t === Terrain.Water && !this.deck.has(j)) return 0;
    if (t === Terrain.Floodplain && (this.floodAll || this.floodNear.length) && !this.deck.has(j)) {
      if (this.floodAll) return 0;
      const x = j % this.m.width, y = (j / this.m.width) | 0;
      for (const [fx, fy, r] of this.floodNear) if (Math.abs(x - fx) < r && Math.abs(y - fy) < r) return 0;
    }
    return s;
  }

  /** ground (or deck) height under a continuous position */
  private hAt(fx: number, fy: number): number {
    const m = this.m;
    const x = Math.max(0, Math.min(m.width - 1, Math.floor(fx))), y = Math.max(0, Math.min(m.height - 1, Math.floor(fy)));
    const i = y * m.width + x;
    const d = this.deck.get(i);
    if (d !== undefined) return d + 0.6;
    if (m.terrain[i] === Terrain.Water) return m.waterLevel[i];
    return heightAt(m, fx, fy);
  }

  /** visible tile range (approx.) */
  private view(cam: Camera, cw: number, ch: number) {
    const corners = [[0, 0], [cw, 0], [cw, ch], [0, ch]].map(([px, py]) => {
      const wx = cam.x + px / cam.zoom, wy = cam.y + py / cam.zoom + (260 - BASE_M) * ZPX;
      const a = wx / HW, b = wy / HH;
      return [(a + b) / 2, (b - a) / 2];
    });
    const m = this.m;
    return {
      x0: Math.max(0, Math.floor(Math.min(...corners.map((c) => c[0]))) - 6), x1: Math.min(m.width - 1, Math.ceil(Math.max(...corners.map((c) => c[0]))) + 12),
      y0: Math.max(0, Math.floor(Math.min(...corners.map((c) => c[1]))) - 6), y1: Math.min(m.height - 1, Math.ceil(Math.max(...corners.map((c) => c[1]))) + 12),
    };
  }

  private cam: Camera = { x: 0, y: 0, zoom: 1 };
  private cw = 1;
  private ch = 1;
  /** a tile on screen (with a margin) */
  private tileInView(x: number, y: number, margin = 80) {
    const i = Math.max(0, Math.min(this.m.height - 1, y)) * this.m.width + Math.max(0, Math.min(this.m.width - 1, x));
    const [wx, wy] = project(x + 0.5, y + 0.5, this.m.elevation[i]);
    const sx = (wx - this.cam.x) * this.cam.zoom, sy = (wy - this.cam.y) * this.cam.zoom;
    return sx > -margin && sy > -margin && sx < this.cw + margin && sy < this.ch + margin;
  }
  private inView(a: Agent) {
    if (this.tileInView(a.x, a.y)) return true;
    if (a.kind === "train" && a.trail?.length) { const [x, y] = a.trail[Math.min(a.trail.length - 1, a.need ?? 0)]; return this.tileInView(x, y, 120); }
    if (a.kind === "tow" && a.ang !== undefined) return this.tileInView(Math.floor(a.fx! + Math.cos(a.ang) * 2.5), Math.floor(a.fy! + Math.sin(a.ang) * 2.5), 120);
    return false;
  }

  counts() {
    let trains = 0, boats = 0, traffic = 0;
    for (const a of this.agents) { if (a.kind === "train") trains++; else if (a.kind === "steamboat" || a.kind === "tow") boats++; else if (a.kind !== "walker") traffic++; }
    return { trains, boats, traffic };
  }

  // ------------------------------------------------------------ simulation
  update(g: GameState, cam: Camera, cw: number, ch: number, now: number, night = 0) {
    const dt = Math.min(0.1, this.last ? (now - this.last) / 1000 : 0);
    this.last = now; this.dt = dt;
    const year = g.world.year;
    this.year = year;
    this.updateDecks(year, g.spans ?? []);
    this.cam = cam; this.cw = cw; this.ch = ch;
    this.night = night;
    // shift change: the hour either side of dawn and dusk (only when the day turns)
    this.surge = clamp01(1 - Math.abs(night - 0.5) / 0.22);
    this.updateScene(g);
    this.wind = windFor(g); // the same wind as the plumes and haze
    const v = this.view(cam, cw, ch);
    const z = cam.zoom;
    // zoomed out, only the big movers stay: trains and river craft (and the smoke, drawn elsewhere);
    // people, horses, wagons, streetcars and cars appear from 0.375× in, where they're legible
    const small = z >= SMALL_AGENT_ZOOM;
    const w = g.world;
    this.agents = this.agents.filter((a) => {
      if (a.dying && a.alpha <= 0) return false;
      if (!(small || BIG.has(a.kind)) || !this.inView(a)) return false;
      if (!BIG.has(a.kind) && !this.streetOk(w, a.y * this.m.width + a.x)) return false; // the water came up
      return true;
    });
    const tiles = (cw * ch) / (2048 * z * z); // tiles on screen
    // night empties the streets to ~15%; the shift change fills them again for a while
    const density = Math.max(0.15, 1 - 0.85 * night) + 0.45 * this.surge;
    const season = cal(g).season;
    const river = SEASON_EFFECTS[season].river; // ice in winter, low water in summer
    const want = {
      street: small ? Math.min(420, tiles * 0.9 * density) : 0,
      train: Math.min(z >= 0.25 ? 6 : 10, tiles / 1500 + 1),
      boat: Math.min(z >= 0.25 ? 14 : 22, tiles / 900 + 2) * (season === "Winter" ? 0.45 : Math.min(1, 0.4 + 0.6 * river)),
    };
    this.occ.clear();
    for (const a of this.agents) if (!a.dying && !BIG.has(a.kind) && a.kind !== "train") { const k = a.y * this.m.width + a.x; this.occ.set(k, (this.occ.get(k) ?? 0) + 1); }
    let streetN = 0, trainN = 0, boatN = 0, mooredN = 0;
    for (const a of this.agents) { if (a.dying) continue; if (a.kind === "train") trainN++; else if (a.moored) mooredN++; else if (a.kind === "steamboat" || a.kind === "tow") boatN++; else streetN++; }
    // in winter some boats lie tied up along the banks
    const wantMoored = season === "Winter" ? Math.min(8, tiles / 1800 + 1) : 0;
    for (let tries = 0; tries < 60 && mooredN < wantMoored; tries++) if (this.spawnBoat(g, v, true)) mooredN++;
    if (mooredN > wantMoored) { const b = this.agents.find((a) => a.moored && !a.dying); if (b) b.dying = true; }
    for (let tries = 0; tries < 150 && streetN < want.street; tries++) if (this.spawnStreet(g, v)) streetN++;
    for (let tries = 0; tries < 40 && trainN < want.train; tries++) if (this.spawnTrain(g, v)) trainN++;
    for (let tries = 0; tries < 40 && boatN < want.boat; tries++) if (this.spawnBoat(g, v, false)) boatN++;
    // too many for the hour (night falling): a few at a time turn in for the night
    if (streetN > want.street * 1.1 + 4) {
      // people on foot go in first (commuters only once the shift change is over); cars and streetcars stay longest
      let excess = Math.min(6, streetN - Math.ceil(want.street));
      const n = this.agents.length;
      let walkers = 0;
      for (const a of this.agents) if (a.kind === "walker" && !a.dying) walkers++;
      const keepWalkers = want.street * 0.12; // a few stay out under the lamps
      for (let pass = 0; pass < 3 && excess > 0; pass++) {
        for (let k = 0; k < n && excess > 0; k++) {
          const a = this.agents[(k * 7919 + (now | 0)) % n];
          if (a.dying || BIG.has(a.kind)) continue;
          const commuter = a.role === "in" || a.role === "out";
          if (a.kind === "walker" && walkers <= keepWalkers && pass < 2) continue;
          if (pass === 0 && ((a.kind !== "walker" && !(a.kind === "wagon" && night > 0.5)) || commuter)) continue;
          if (pass === 1 && (a.kind !== "walker" || this.surge > 0.05)) continue;
          if (a.kind === "walker") walkers--;
          if (pass === 2 && commuter && this.surge > 0.05) continue;
          a.dying = true; excess--;
        }
      }
    }
    // shift change: people already about set off for the works, or home from them
    if (this.surge > 0.05 && this.centres.length) {
      const n = this.agents.length;
      let conv = this.rng.next() < this.surge * dt * 25 ? 1 + this.rng.int(0, 2) : 0;
      for (let k = 0; k < 12 && conv > 0 && n; k++) {
        const a = this.agents[this.rng.int(0, n - 1)];
        if (a.dying || BIG.has(a.kind) || a.role !== "wander" || a.kind === "streetcar" || a.kind === "horsecar" || a.kind === "wagon") continue;
        if (this.makeCommuter(g, a, this.rng.chance(0.5))) conv--;
      }
    }
    // the river freezes or runs low: boats beyond the season's count tie up (fade out)
    if (boatN > want.boat + 1) {
      const b = this.agents.find((a) => (a.kind === "tow" || a.kind === "steamboat") && !a.moored && !a.dying);
      if (b) b.dying = true;
    }
    for (const a of this.agents) {
      a.alpha = a.dying ? a.alpha - dt * 2.2 : Math.min(1, a.alpha + dt * 2.5);
      if (a.kind === "steamboat" || a.kind === "tow") this.stepBoat(a, dt);
      else this.step(g, a, dt);
    }
    // smoke and steam from the stacks drift off on the wind
    const ws = this.wind.s;
    for (const p of this.puffs) { const up = 1 - Math.min(1, p.age / p.life) * 0.5; p.age += dt; p.ox += this.wind.x * ws * 9 * dt * (1.5 - up); p.oy += this.wind.y * ws * 2.5 * dt - 13 * up * dt; } // rise off the stack, then lean with the wind (windFor, shared with the plumes)
    if (this.puffs.length) this.puffs = this.puffs.filter((p) => p.age < p.life);
  }

  // ------------------------------------------------------------ what the simulation says
  /** strikes, closures, floods and job centres: recomputed when the season or a works' status changes */
  private updateScene(g: GameState) {
    const mine = g.company ? allWorks(g.company) : [];
    const striking: { id: string; x: number; y: number; fp: number; side: string; force?: number }[] = [];
    // guards or troops on your side of the picket line (the strike's force front)
    const force = Math.max(0, ...Object.values(g.unions ?? {}).map((u) => u?.siege?.force ?? 0));
    const forceLevel = force >= 0.9 ? 2 : force >= 0.3 ? 1 : 0;
    for (const w of mine) if (w.status === "strike" || w.status === "lockout") striking.push({ id: w.id, x: w.x, y: w.y, fp: w.footprint, side: w.riverSide, force: forceLevel });
    for (const r of g.rivals) if (r.active && !r.closed && !r.owned && (r.strikeUntil ?? 0) > g.turn) striking.push({ id: r.id, x: r.x, y: r.y, fp: r.footprint, side: r.riverSide });
    const flooded = mine.filter((w) => w.status === "flooded");
    const key = `${g.seed}|${g.turn}|${striking.map((s) => `${s.id}${s.force ?? ""}`).join(",")}|${flooded.length}|${g.floodNow ?? "-"}|${g.commute.year}|${g.jobless}`;
    if (key === this.sceneKey) return;
    this.sceneKey = key;
    // floods
    this.floodAll = g.floodNow !== undefined;
    this.floodNear = flooded.map((w) => [w.x + (w.footprint >> 1), w.y + (w.footprint >> 1), 28] as [number, number, number]);
    // destinations: the works (not those on strike) and downtown
    const out = new Set(striking.map((s) => s.id));
    this.centres = [];
    g.commute.centers.forEach((c, j) => {
      const works = isWorksName(c.name);
      if (!works && c.name !== "Downtown") return;
      if (out.has(c.name)) return;
      const pl = g.plants.find((p) => p.owner === c.name);
      const fp = pl?.fp ?? (works ? 8 : 0);
      this.centres.push({ j, x: c.x, y: c.y, r: works ? fp / 2 + 2.5 : 7, works, running: !!pl && pl.output > 0 });
    });
    for (const a of this.agents) if ((a.role === "in" || a.role === "out") && !this.centres.some((c) => c.j === a.dest)) a.role = "wander";
    // closed mills and the jobless: fewer vehicles, more men standing about
    this.slump = [];
    for (const r of g.rivals) if (r.closed) this.slump.push([r.x + (r.footprint >> 1), r.y + (r.footprint >> 1), 34, 0.75]);
    if (g.company && g.jobless > 200) {
      const s = Math.min(0.85, g.jobless / 4000);
      for (const w of mine) this.slump.push([w.x + (w.footprint >> 1), w.y + (w.footprint >> 1), 38, s]);
    }
    // picket lines
    this.blocked.clear();
    const keep = new Map(this.pickets.map((p) => [p.key, p]));
    this.pickets = striking.map((s) => keep.get(`${s.id}@${s.x},${s.y}:${s.force ?? 0}`) ?? this.makePicket(g.world, `${s.id}@${s.x},${s.y}:${s.force ?? 0}`, s.x, s.y, s.fp, s.side, g.world.year, s.force ?? 0)).filter((p): p is PicketSite => !!p);
    for (const p of this.pickets) for (const i of p.block) this.blocked.add(i);
    // parked cuts of cars at the sidings (once a season)
    const pk = `${g.seed}|${g.turn}|${striking.length}`;
    if (pk !== this.parkedKey) { this.parkedKey = pk; this.parked = this.makeParked(g, mine); }
  }

  /** the crowd outside the gate of a works on strike (the gate is on the landward side, as plants.ts lays it out) */
  private makePicket(w: GameState["world"], key: string, x: number, y: number, fp: number, side: string, year: number, force = 0): PicketSite | null {
    const m = this.m;
    const toL = (a: number, b: number): [number, number] => side === "N" ? [b, a] : side === "S" ? [b, fp - 1 - a] : side === "W" ? [a, b] : [fp - 1 - a, b];
    const [lx, ly] = toL(fp - 1, 1);
    const [ox, oy] = side === "N" ? [0, 1] : side === "S" ? [0, -1] : side === "W" ? [1, 0] : [-1, 0];
    const gx = x + lx + 0.5 + ox * 1.5, gy = y + ly + 0.5 + oy * 1.5;
    // the street (or open ground) just outside the gate: that's where they stand
    const spots: [number, number, number][] = [];
    for (let dy = -6; dy <= 6; dy++) for (let dx = -6; dx <= 6; dx++) {
      const tx = Math.floor(gx) + dx, ty = Math.floor(gy) + dy;
      if (tx < 0 || ty < 0 || tx >= m.width || ty >= m.height) continue;
      if (tx >= x && ty >= y && tx < x + fp && ty < y + fp) continue;
      const i = ty * m.width + tx;
      if (m.terrain[i] === Terrain.Water || m.rail[i]) continue;
      const u = w.use[i];
      const score = w.street[i] && w.street[i] !== Street.Steps ? 3 : u === Use.Empty || u === Use.Farm ? 1 : 0;
      if (!score) continue;
      const d = Math.hypot(tx + 0.5 - gx, ty + 0.5 - gy);
      if (d > 6) continue;
      spots.push([tx, ty, score * 2 - d]);
    }
    if (!spots.length) return null;
    spots.sort((p, q) => q[2] - p[2]);
    const [sx0, sy0] = spots[0];
    const cx = sx0 + 0.5, cy = sy0 + 0.5;
    // march up and down the street
    const along = (dx: number, dy: number) => { const xx = sx0 + dx, yy = sy0 + dy; return xx >= 0 && yy >= 0 && xx < m.width && yy < m.height && !!w.street[yy * m.width + xx]; };
    const [ex, ey] = along(1, 0) || along(-1, 0) ? [1, 0] : along(0, 1) || along(0, -1) ? [0, 1] : [-oy, ox];
    const r = new Rng(key);
    const figs: PicketSite["figs"] = [];
    for (let k = 0; k < 9; k++) figs.push({ look: poolLook(year, () => r.next(), true), fx: 0, fy: 0, march: (k / 9) * Math.PI * 2, placard: k % 3 === 1 ? k : undefined });
    // and a crowd standing about, a few to a spot
    const near = spots.slice(0, 7);
    for (let k = 0; k < 18 && near.length; k++) {
      const [tx, ty] = near[k % near.length];
      figs.push({ look: poolLook(year, () => r.next(), r.chance(0.8)), fx: tx + 0.15 + r.next() * 0.7, fy: ty + 0.15 + r.next() * 0.7, placard: k === 3 || k === 10 ? k : undefined });
    }
    // guards (Pinkertons, company police: dark coats) or troops (blue, then khaki) between the crowd and the gate
    if (force) {
      const troops = force >= 2, old = year < 1917;
      const look: Look = { key: troops ? `troop${old ? "b" : "k"}` : "guard", female: false, hat: troops ? (old ? "#2a3446" : "#5a5a34") : "#16181e", hair: "#2a2420", skin: "#d8a882", top: troops ? (old ? "#2c3a56" : "#6a6a3a") : "#1e2430", low: troops ? (old ? "#2a3446" : "#5a5a34") : "#1a1e26", long: false };
      const n = troops ? 10 : 6;
      for (let k = 0; k < n; k++) { const t = (k - (n - 1) / 2) * 0.55; figs.push({ look, fx: gx - ox * 0.6 + ex * t, fy: gy - oy * 0.6 + ey * t }); }
    }
    // the crowd holds the street: no wagons or cars through it

    const bt = near[0] ?? spots[0];
    const barrel: [number, number] = [bt[0] + 0.5, bt[1] + 0.5];
    // the crowd holds the street: no wagons or cars through it
    const block = spots.slice(0, 5).map(([tx, ty]) => ty * m.width + tx);
    return { key, block, cx, cy, ex, ey, ox: -ey, oy: ex, figs, barrel };
  }

  /** a cut of cars standing at each works that ships by rail: on the siding if there is one, else beside the main line */
  private makeParked(g: GameState, mine: Works[]): ParkedCut[] {
    const m = this.m, year = g.world.year, out: ParkedCut[] = [];
    for (const w of mine) {
      if (w.status === "strike" || w.status === "lockout") continue;
      const rail = (w.freight?.lanes ?? []).filter((l) => l.mode === "rail" && l.delivered > 0);
      if (!rail.length) continue;
      const types: CarType[] = [];
      for (const l of rail) {
        const t: CarType = l.good === "ore" ? (year >= 1880 ? "jenny" : "hopper") : l.good === "sand" ? (year >= 1950 ? "covered" : "box") : l.good === "limestone" ? "gon" : "hopper";
        types.push(t);
      }
      const make = (n: number) => Array.from({ length: n }, (_, k) => carOf(types[k % types.length], year, this.rng));
      let path: [number, number][] = [];
      if (w === g.company && w.spur) {
        // along the siding drawn from the works to the main line
        const [tx, ty] = w.spur;
        const ex = Math.max(w.x, Math.min(w.x + w.footprint, tx + 0.5)), ey = Math.max(w.y, Math.min(w.y + w.footprint, ty + 0.5));
        if (Math.hypot(tx + 0.5 - ex, ty + 0.5 - ey) >= 1) path = [[tx + 0.5, ty + 0.5], [ex, ey]];
      }
      if (!path.length) {
        const acc = siteAccess(m, { x: w.x, y: w.y, fp: w.footprint, spur: w.spur }, year).rail;
        if (!acc || acc.wagon > 0) continue;
        // the nearest rail tile on dry land (not out on a bridge)
        let t0 = acc.tile;
        const land = (i: number) => m.terrain[i] !== Terrain.Water && !this.deck.has(i);
        if (!land(t0)) {
          let bd = Infinity;
          for (let dy = -6; dy <= 6; dy++) for (let dx = -6; dx <= 6; dx++) {
            const xx = (t0 % m.width) + dx, yy = ((t0 / m.width) | 0) + dy, j = yy * m.width + xx;
            if (xx < 0 || yy < 0 || xx >= m.width || yy >= m.height || !this.railOpen(g, j) || !land(j)) continue;
            const d = Math.hypot(xx + 0.5 - (w.x + w.footprint / 2), yy + 0.5 - (w.y + w.footprint / 2));
            if (d < bd) { bd = d; t0 = j; }
          }
          if (!land(t0)) continue;
        }
        const x0 = t0 % m.width, y0 = (t0 / m.width) | 0;
        const fwd = this.railWalk(g, x0, y0, null, 7, true), back = this.railWalk(g, x0, y0, fwd[1] ?? null, 7, true);
        const tilesPath = [...back.slice(1).reverse(), ...fwd];
        if (tilesPath.length < 3) continue;
        const pts = tilesPath.map(([x, y]) => this.snap(x, y));
        // beside the main line, on the works side: a siding
        const wx = w.x + w.footprint / 2, wy = w.y + w.footprint / 2;
        const [ax, ay] = pts[0], [bx, by] = pts[pts.length - 1];
        const l = Math.hypot(bx - ax, by - ay) || 1, nx = -(by - ay) / l, ny = (bx - ax) / l;
        const sgn = ((wx - ax) * nx + (wy - ay) * ny) > 0 ? 1 : -1;
        path = pts.map(([x, y]) => [x + nx * sgn * 0.3, y + ny * sgn * 0.3]);
      }
      const cars = this.layCars(path, [carOf(year >= 1955 ? "diesel" : "steam", year, this.rng, true), ...make(12)])
        .filter((c) => { const i = Math.floor(c.y) * m.width + Math.floor(c.x); return m.terrain[i] !== Terrain.Water && !this.deck.has(i); });
      if (cars.length > 1) out.push({ cars, steam: year < 1955, puffT: 0, loco: 0 });
    }
    return out;
  }

  /** place cars nose to tail along a polyline from its start; stops when the line runs out */
  private layCars(path: [number, number][], cars: Car[]) {
    const out: ParkedCut["cars"] = [];
    const cum = [0];
    for (let k = 1; k < path.length; k++) cum.push(cum[k - 1] + Math.hypot(path[k][0] - path[k - 1][0], path[k][1] - path[k - 1][1]));
    const total = cum[cum.length - 1];
    const at = (s: number): [number, number] => {
      let k = 1;
      while (k < cum.length - 1 && cum[k] < s) k++;
      const f = (s - cum[k - 1]) / ((cum[k] - cum[k - 1]) || 1);
      return [path[k - 1][0] + (path[k][0] - path[k - 1][0]) * f, path[k - 1][1] + (path[k][1] - path[k - 1][1]) * f];
    };
    let s = 0.15;
    for (const car of cars) {
      if (s + car.len > total - 0.1) break;
      const [fx, fy] = at(s), [bx, by] = at(s + car.len);
      const l = Math.hypot(fx - bx, fy - by) || 1;
      out.push({ x: (fx + bx) / 2, y: (fy + by) / 2, dx: (fx - bx) / l, dy: (fy - by) / l, car });
      s += car.len + 0.035;
    }
    return out;
  }

  /** walk along open rail from a tile, as straight as possible, avoiding `from` */
  private railWalk(g: GameState, x: number, y: number, from: [number, number] | null, n: number, landOnly = false): [number, number][] {
    const m = this.m, out: [number, number][] = [[x, y]];
    const seen = new Set<number>([y * m.width + x]);
    if (from) seen.add(from[1] * m.width + from[0]);
    let ddx = from ? x - from[0] : 0, ddy = from ? y - from[1] : 0;
    for (let k = 0; k < n; k++) {
      let best: [number, number] | null = null, bs = -Infinity;
      for (const [dx, dy] of DIR8) {
        const xx = x + dx, yy = y + dy, j = yy * m.width + xx;
        if (xx < 0 || yy < 0 || xx >= m.width || yy >= m.height || seen.has(j) || !this.railOpen(g, j)) continue;
        if (landOnly && (m.terrain[j] === Terrain.Water || this.deck.has(j))) continue;
        const s = (dx * ddx + dy * ddy) / (Math.hypot(dx, dy) * (Math.hypot(ddx, ddy) || 1)) + this.rng.next() * 0.01;
        if (s > bs) { bs = s; best = [xx, yy]; }
      }
      if (!best || (k > 0 && bs < 0.3)) break;
      // don't wander onto a neighbouring parallel track's tiles
      for (const [dx, dy] of DIR8) seen.add((y + dy) * m.width + x + dx);
      ddx = best[0] - x; ddy = best[1] - y;
      [x, y] = best;
      out.push(best);
    }
    return out;
  }

  private freightBlock?: Float32Array;
  private freightTurn = -1;
  /** commuter traffic at a tile, 0..~1.5 (1 = the busiest 5% of the valley) */
  private busy(g: GameState, x: number, y: number): number {
    const bg = blockGrid(this.m);
    return Math.min(1.5, g.env.traffic[blockOf(bg, x, y)] / (g.env.trafficNorm || 1));
  }
  /** freight moving through a tile's block, 0..~1.5 (block max, so a route a tile wide still counts) */
  private cargo(g: GameState, x: number, y: number): number {
    const bg = blockGrid(this.m);
    if (this.freightTurn !== g.turn || !this.freightBlock) {
      const f = new Float32Array(bg.n), m = this.m;
      for (let i = 0; i < g.env.freight.length; i++) { const v = g.env.freight[i]; if (v > 0) { const b = blockOf(bg, i % m.width, (i / m.width) | 0); if (v > f[b]) f[b] = v; } }
      // spread a block either side so boats on the far side of a wide river still see the traffic
      const out = new Float32Array(bg.n);
      for (let by = 0; by < bg.bh; by++) for (let bx = 0; bx < bg.bw; bx++) {
        let mx = 0;
        for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) { const xx = bx + dx, yy = by + dy; if (xx >= 0 && yy >= 0 && xx < bg.bw && yy < bg.bh) mx = Math.max(mx, f[yy * bg.bw + xx]); }
        out[by * bg.bw + bx] = mx;
      }
      this.freightBlock = out; this.freightTurn = g.turn;
    }
    return Math.min(1.5, this.freightBlock[blockOf(bg, x, y)] / (g.env.freightNorm || 1));
  }
  /** slack times: 0 (normal) .. ~0.8 near a closed mill or a works that laid men off */
  private slumpAt(x: number, y: number): number {
    let s = 0;
    for (const [sx, sy, r, k] of this.slump) { const d = Math.hypot(x - sx, y - sy); if (d < r) s = Math.max(s, k * (1 - (d / r) * 0.6)); }
    return s;
  }

  /** a random tile under a random point of the screen */
  private randomTile(_v?: unknown): [number, number] {
    const m = this.m, c = this.cam;
    const wx = c.x + (this.rng.next() * this.cw) / c.zoom, wy = c.y + (this.rng.next() * this.ch) / c.zoom;
    let h = 260, x = 0, y = 0;
    for (let k = 0; k < 3; k++) {
      const a = wx / HW, b = (wy + (h - BASE_M) * ZPX) / HH;
      x = Math.floor((a + b) / 2); y = Math.floor((b - a) / 2);
      if (x < 0 || y < 0 || x >= m.width || y >= m.height) return [0, 0];
      h = m.elevation[y * m.width + x];
    }
    return [x, y];
  }

  private newAgent(kind: Kind, x: number, y: number, speed: number, col: string): Agent {
    return { kind, x, y, px: x, py: y, nx: x, ny: y, t: 1, speed, col, seed: this.rng.next(), alpha: 0, dist: 0, hx: 1, hy: 0, role: "wander" };
  }

  private spawnStreet(g: GameState, _v: ReturnType<Traffic["view"]>): boolean {
    const m = this.m, w = g.world, y = w.year, rng = this.rng;
    const [x, yy] = this.randomTile();
    const i = yy * m.width + x;
    const st = this.streetOk(w, i);
    if (!st) return false;
    if ((this.occ.get(i) ?? 0) >= 2) return false; // already two on this stretch of street
    const night = this.night, surge = this.surge;
    // people and vehicles appear where the commute model sends them (a little everywhere, a lot on the busy routes)
    const busy = this.busy(g, x, yy);
    if (rng.next() > 0.12 + 0.88 * Math.min(1, busy)) return false;
    const pike = st === Street.Pike;
    // at night, people on foot keep to the lit main streets
    const slump = this.slump.length ? this.slumpAt(x, yy) : 0;
    // ---- commuters: to the nearest works or downtown, or home from the works at the shift change
    const commShare = night > 0.8 ? 0.2 : 0.28 + 0.22 * surge;
    let role: Role = "wander", dest: number | undefined, best = Infinity;
    if (st !== Street.Steps && rng.chance(commShare * (1 - slump * 0.6)) && this.centres.length) {
      const c = this.commuteTo(g, x, yy, surge > 0.05 && rng.chance(0.5));
      if (c) [role, dest, best] = c;
    }
    // ---- what it is
    const r = rng.next();
    let kind: Kind;
    if (st === Street.Steps) kind = "walker";
    else if (role === "in" || role === "out") {
      // men going to the mill: on foot in the walking city, by car later
      const carP = y < 1915 ? 0.04 : y < 1950 ? 0.25 + (y - 1915) * 0.01 : 0.8;
      kind = r < carP ? (y < 1915 ? "carriage" : "auto") : "walker";
      if (night > 0.6 && kind === "walker" && (!pike || rng.chance(0.5))) return false;
    } else if (slump > 0.05 && rng.chance(slump * 0.6)) { kind = "walker"; role = "idle"; }
    else {
      const walkerP = (y < 1915 ? 0.6 : y < 1940 ? 0.45 : 0.3) * (1 - 0.75 * night);
      const carsLit = y >= 1910;
      if (pike && y >= 1890 && y < 1955 && r < 0.12 + 0.25 * night) kind = "streetcar";
      else if (pike && y >= 1859 && y < 1890 && r < 0.1) kind = "horsecar";
      else if (r < walkerP) kind = "walker";
      else if (y < 1910) kind = night > 0.5 ? "carriage" : rng.chance(0.75) ? "wagon" : "carriage";
      else if (y < 1925) kind = rng.chance(0.5) ? "auto" : rng.chance(0.5) ? (night > 0.5 ? "auto" : "wagon") : "truck";
      else kind = rng.chance(night > 0.5 ? 0.9 : y >= 1950 ? 0.82 : 0.75) ? "auto" : "truck";
      if (night > 0.5 && kind === "walker" && !pike) return false;
      if (night > 0.6 && !carsLit && kind !== "walker" && kind !== "horsecar" && kind !== "streetcar" && rng.chance(0.5)) return false;
      if (slump > 0 && kind !== "walker" && rng.chance(slump * 0.5)) return false; // fewer vehicles in a town out of work
    }
    // country lanes and side streets take one vehicle to a stretch (no convoys of wagons on a farm road)
    if (kind !== "walker" && (this.occ.get(i) ?? 0) >= (pike ? 2 : 1)) return false;
    if (kind !== "walker" && this.pickets.some((p) => Math.abs(p.cx - x) < 5 && Math.abs(p.cy - yy) < 5)) return false; // traffic keeps clear of the picket line
    const speed = { walker: 0.45, wagon: 0.8, carriage: 1.1, horsecar: 0.85, streetcar: 1.4, auto: y < 1915 ? 1.5 : 2.4, truck: y < 1930 ? 1.3 : 1.8 }[kind as "walker"];
    const a = this.newAgent(kind, x, yy, speed * (0.8 + rng.next() * 0.4), "");
    a.role = role;
    if (role === "in" || role === "out") { a.dest = dest; a.cm = g.commute; a.best = best; a.stall = 0; a.life = 14 + rng.int(0, 22); }
    this.occ.set(i, (this.occ.get(i) ?? 0) + 1);
    if (role === "idle") { a.speed *= 0.6; a.wait = rng.next() * 4; }
    if (kind === "walker") a.look = poolLook(y, () => rng.next(), role === "in" || role === "out" || (role === "idle" && rng.chance(0.7)));
    else a.spec = this.vehicleSpec(kind, y);
    // start facing along a street, not out of a wall
    const opts = DIR4.filter(([dx, dy]) => { const xx = x + dx, y2 = yy + dy; return xx >= 0 && y2 >= 0 && xx < m.width && y2 < m.height && this.streetOk(w, y2 * m.width + xx); });
    if (opts.length) { const [dx, dy] = rng.pick(opts); a.px = x - dx; a.py = yy - dy; a.nx = x + dx; a.ny = yy + dy; a.t = rng.next(); a.hx = dx; a.hy = dy; }
    this.agents.push(a);
    return true;
  }

  /** where a commuter from this tile goes: the nearest works or downtown (or, going home, away from a works nearby) */
  private commuteTo(g: GameState, x: number, y: number, home: boolean): [Role, number, number] | null {
    const b = blockOf(blockGrid(this.m), x, y), f = g.commute.fields;
    let best = Infinity, dest = -1;
    for (const c of this.centres) {
      if (home && !(c.works && c.running)) continue;
      const v = f[c.j]?.[b] ?? Infinity;
      if (v < best) { best = v; dest = c.j; }
    }
    if (dest < 0) return null;
    if (home && best < 14) return ["out", dest, best];
    if (!home && best < 70 && best > 1.2) return ["in", dest, best];
    return null;
  }
  private makeCommuter(g: GameState, a: Agent, home: boolean): boolean {
    const c = this.commuteTo(g, a.x, a.y, home);
    if (!c) return false;
    [a.role, a.dest, a.best] = c;
    a.cm = g.commute; a.stall = 0; a.life = 14 + this.rng.int(0, 22);
    return true;
  }

  private specPools = new Map<string, VehicleSpec[]>();
  /** a vehicle from a small fixed fleet per kind and period (the sprite cache fills once, up front) */
  private vehicleSpec(kind: Kind, y: number): VehicleSpec {
    const era = kind === "auto" || kind === "truck" ? motorEra(y) : kind === "streetcar" ? (y < 1920 ? 0 : 1) : 0;
    const key = `${kind}${era}`;
    let pool = this.specPools.get(key);
    if (!pool) {
      const r = new Rng(key);
      pool = Array.from({ length: kind === "auto" ? 10 : 6 }, () => this.makeSpec(kind, y, r));
      this.specPools.set(key, pool);
      for (const sp of pool) for (const f of [0, 1, 2, 3] as const) for (const fr of [0, 1]) { vehicleFig(sp, f, fr, false); if (kind === "streetcar" || kind === "horsecar") vehicleFig(sp, f, fr, true); }
    }
    return this.rng.pick(pool);
  }

  private makeSpec(kind: Kind, y: number, rng: Rng): VehicleSpec {
    const horse = rng.pick(["#5a3a22", "#3a2a1e", "#7a5a3a", "#c8c0b0"]);
    switch (kind) {
      case "wagon": return { kind, era: 0, col: rng.pick(["#8a6a48", "#6a5a3a", "#5a6a7a", "#7a3a2a"]), col2: "", horse, load: rng.int(0, 2) };
      case "carriage": return { kind, era: 0, col: rng.pick(["#1e1e22", "#3a2a2a", "#2a2e3a", "#3a1e1e"]), col2: "", horse };
      case "horsecar": return { kind, era: 0, col: rng.pick(["#c8a040", "#8a3a2a", "#2e5a3a"]), col2: "#5a4a3a", horse };
      case "streetcar": return { kind, era: y < 1920 ? 0 : 1, col: rng.pick(y < 1920 ? ["#c8a040", "#2e5a3a"] : ["#c8582a", "#d8a030", "#2e5a3a"]), col2: "" };
      case "auto": {
        const e = motorEra(y);
        const col = e <= 1 ? rng.pick(["#1e1e22", "#1e1e22", "#2a2a30", "#3a2a2a", "#2a3a2e"]) : e === 2 ? rng.pick(["#1e1e22", "#3a2a2a", "#2a3a4a", "#3a4a3a", "#6a5a48", "#5a2a2a", "#7a7a72"])
          : e === 3 ? rng.pick(["#c84a3a", "#3a6aa8", "#e8e0c8", "#4a8a5a", "#e8c040", "#8ab8c8", "#e8a0a0", "#2a2a30", "#7a3a5a"])
          : rng.pick(["#c8a040", "#6a7a3a", "#7a4a2a", "#a8a8a8", "#e8e4dc", "#2a3a5a", "#6a2a2a", "#3a5a3a", "#c86a2a"]);
        return { kind, era: e, col, col2: e === 3 && rng.chance(0.5) ? "#f0ece0" : e === 4 && rng.chance(0.35) ? rng.pick(["#2a2420", "#e8e4dc"]) : col };
      }
      default: {
        const e = motorEra(y);
        const col = rng.pick(e <= 1 ? ["#3a4a2e", "#4a3a2a", "#2a2a30"] : ["#4a5a3a", "#5a4a3a", "#3a3a40", "#8a3a2a", "#2e4a6a", "#e8e4dc"]);
        const col2 = e <= 1 ? rng.pick(["#3a3026", "#5a4a38", "#2a2a2a"]) : e === 2 ? rng.pick(["#7a6a5a", "#5a6a4a", "#8a8070", "#6a3a2a"]) : rng.pick(["#c8c8c0", "#d8d4c8", "#a8a8a8", "#c84a3a", "#e8e0c8"]);
        return { kind: "truck", era: e >= 3 && rng.chance(0.55) ? 2 : Math.min(3, e), col, col2 };
      }
    }
  }

  private spawnTrain(g: GameState, _v: ReturnType<Traffic["view"]>): boolean {
    const m = this.m, rng = this.rng, year = g.world.year;
    const [x, y] = this.randomTile();
    const i = y * m.width + x;
    if (!this.railOpen(g, i)) return false;
    if (rng.next() > 0.25 + 0.75 * Math.min(1, this.cargo(g, x, y))) return false; // trains run where the freight goes
    const passenger = rng.chance(0.3);
    const cars = consist(year, passenger, rng);
    const total = cars.reduce((s, c) => s + c.len + 0.035, 0);
    const a = this.newAgent("train", x, y, passenger ? 2.3 : 1.4, "");
    a.cars = cars; a.need = Math.ceil(total) + 3; a.puffT = 0;
    // lay the train out behind the head, along the track, so it appears whole
    const fwd = this.railWalk(g, x, y, null, 1);
    if (fwd.length < 2) return false;
    const back = this.railWalk(g, x, y, fwd[1], a.need);
    a.trail = back.slice(0, a.need + 1);
    a.nx = fwd[1][0]; a.ny = fwd[1][1];
    if (a.trail.length > 1) { a.px = a.trail[1][0]; a.py = a.trail[1][1]; }
    // which way is busier? run toward the freight
    a.t = 0;
    a.hx = a.nx - x; a.hy = a.ny - y;
    this.agents.push(a);
    return true;
  }

  private spawnBoat(g: GameState, _v: ReturnType<Traffic["view"]>, moored: boolean): boolean {
    const m = this.m, rng = this.rng;
    const [x, y] = this.randomTile();
    const i = y * m.width + x;
    if (m.terrain[i] !== Terrain.Water || this.down[i] < 0) return false;
    if (moored ? (this.shore[i] < 1 || this.shore[i] > 2) : this.shore[i] < 3) return false;
    const year = g.world.year;
    const cargo = this.cargo(g, x, y);
    if (!moored && rng.next() > 0.2 + 0.8 * Math.min(1, cargo)) return false; // tows work the freight lanes
    const kind: Kind = year < 1870 || (year < 1930 && rng.chance(cargo > 0.3 ? 0.2 : 0.5)) ? "steamboat" : "tow";
    const flow = this.flowDir(x, y);
    if (!flow) return false;
    const sgn = rng.chance(0.5) ? 1 : -1;
    const a = this.newAgent(kind, x, y, kind === "tow" ? 0.22 + rng.next() * 0.06 : 0.42 + rng.next() * 0.1,
      kind === "steamboat" ? "#ece7da" : year < 1940 ? rng.pick(["#3a3a3e", "#4a3a2e"]) : rng.pick(["#c8402a", "#2a4a7a", "#3a3a3e", "#d8a030"]));
    a.fx = x + 0.5; a.fy = y + 0.5;
    a.sgn = sgn; a.ang = Math.atan2(flow[1] * sgn, flow[0] * sgn); a.wantX = Math.cos(a.ang); a.wantY = Math.sin(a.ang);
    a.free = 0; a.stuck = 0; a.moored = moored; a.puffT = 0;
    if (moored) a.speed = 0;
    if (kind === "tow") {
      const name = m.waterNames[String(m.water[i])] ?? "";
      const n = (moored ? 1 : 2) + rng.int(0, 3) * 2;
      a.barges = Array.from({ length: n }, () => bargeCargo(name, year, rng));
    }
    this.agents.push(a);
    return true;
  }

  private railOpen(g: GameState, i: number) {
    const m = this.m, r = m.rail[i];
    return r > 0 && (m.railLines[String(r)]?.year ?? 9999) <= g.world.year;
  }

  // ------------------------------------------------------------ moving
  private step(g: GameState, a: Agent, dt: number) {
    if (a.wait && a.wait > 0) { a.wait -= dt; return; }
    const v = a.speed * dt * (a.dying && a.kind !== "train" ? 0.6 : 1);
    a.t += v; a.dist += v;
    let guard = 0;
    while (a.t >= 1 && guard++ < 4) {
      a.t -= 1;
      if (a.kind !== "train") { const W = this.m.width, o = a.y * W + a.x, n = a.ny * W + a.nx; this.occ.set(o, Math.max(0, (this.occ.get(o) ?? 1) - 1)); this.occ.set(n, (this.occ.get(n) ?? 0) + 1); }
      a.px = a.x; a.py = a.y; a.x = a.nx; a.y = a.ny;
      if (a.trail) { a.trail.unshift([a.x, a.y]); if (a.trail.length > (a.need ?? 0) + 2) a.trail.pop(); }
      if (a.kind !== "train") this.arrive(g, a);
      const nxt = a.kind === "train" ? this.chooseTrain(g, a) : this.chooseStreet(g, a);
      if (!nxt) {
        if (a.kind === "train") { this.reverse(g, a); break; }
        a.nx = a.px; a.ny = a.py; // turn back
      } else { a.nx = nxt[0]; a.ny = nxt[1]; }
      if (a.role === "idle" && this.rng.chance(0.45)) { a.wait = 2 + this.rng.next() * 6; a.t = 0; break; }
    }
  }

  /** a commuter at a new tile: there yet? lost? */
  private arrive(g: GameState, a: Agent) {
    if (a.role !== "in" && a.role !== "out") return;
    if (a.cm !== g.commute || a.dest === undefined) { a.role = "wander"; return; }
    const c = this.centres.find((c) => c.j === a.dest);
    const f = g.commute.fields[a.dest];
    if (!c || !f) { a.role = "wander"; return; }
    const v = f[blockOf(blockGrid(this.m), a.x, a.y)];
    if (a.role === "in") {
      // through the gate: anywhere on the works' edge (a seeded reach, so they don't all bunch at one spot)
      if (Math.hypot(a.x + 0.5 - c.x, a.y + 0.5 - c.y) < c.r + 1 + a.seed * 3 || v < 0.8 + a.seed * 1.5) { a.dying = true; return; }
      if (v < (a.best ?? Infinity) - 0.01) { a.best = v; a.stall = 0; } else if (++a.stall! > 40) a.role = "wander";
    } else if (--a.life! <= 0) a.dying = true; // home
  }

  private chooseStreet(g: GameState, a: Agent): [number, number] | null {
    const m = this.m, w = g.world, bg = blockGrid(m);
    const opts: [number, number, number][] = [];
    const back = (x: number, y: number) => x === a.px && y === a.py;
    // commuters: which way is downhill (or uphill, going home) on the travel-time field
    let gx = 0, gy = 0, f: Float32Array | undefined, fc = 0;
    if ((a.role === "in" || a.role === "out") && a.dest !== undefined && (f = g.commute.fields[a.dest])) {
      const bx = (a.x / 4) | 0, by = (a.y / 4) | 0;
      fc = f[by * bg.bw + bx];
      let best = fc, sgn = a.role === "in" ? 1 : -1;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const xx = bx + dx, yy = by + dy;
        if ((!dx && !dy) || xx < 0 || yy < 0 || xx >= bg.bw || yy >= bg.bh) continue;
        const v = f[yy * bg.bw + xx];
        if (!isFinite(v)) continue;
        if (sgn * (best - v) > 0) { best = v; gx = dx; gy = dy; }
      }
      const l = Math.hypot(gx, gy) || 1; gx /= l; gy /= l;
    }
    for (const [dx, dy] of DIR4) {
      const x = a.x + dx, y = a.y + dy;
      if (x < 0 || y < 0 || x >= m.width || y >= m.height) continue;
      const s = this.streetOk(w, y * m.width + x);
      if (!s || (s === Street.Steps && a.kind !== "walker")) continue;
      if (a.kind !== "walker" && this.blocked.size && this.blocked.has(y * m.width + x)) continue;
      const straight = x - a.x === a.x - a.px && y - a.y === a.y - a.py;
      let wgt = back(x, y) ? 0.04 : straight ? 2.5 : 1;
      const crowd = this.occ.get(y * m.width + x) ?? 0;
      if (crowd) wgt /= 1 + crowd * 1.6; // step round a crowd where there's another way
      if (f) {
        const v = f[blockOf(bg, x, y)];
        const sgn = a.role === "in" ? 1 : -1;
        wgt *= Math.exp(2.4 * (dx * gx + dy * gy)) * (sgn * (fc - v) > 0.01 ? 3 : sgn * (fc - v) < -0.01 ? 0.25 : 1);
      } else wgt *= 0.35 + this.busy(g, x, y); // follow the commuters' routes
      opts.push([x, y, wgt]);
    }
    return this.pickOpt(opts);
  }

  private chooseTrain(g: GameState, a: Agent): [number, number] | null {
    const m = this.m, fr = g.env.freight, norm = g.env.freightNorm || 1;
    const opts: [number, number, number][] = [];
    const hx = a.x - a.px, hy = a.y - a.py, hl = Math.hypot(hx, hy) || 1;
    for (const [dx, dy] of DIR8) {
      const x = a.x + dx, y = a.y + dy;
      if (x < 0 || y < 0 || x >= m.width || y >= m.height || (x === a.px && y === a.py)) continue;
      const j = y * m.width + x;
      if (!this.railOpen(g, j)) continue;
      const c = (dx * hx + dy * hy) / (Math.hypot(dx, dy) * hl);
      if (c < -0.1) continue; // no reversing through a junction
      // straight on is the main line; a gentle curve is fine; a sharp turn is a siding
      let wgt = c > 0.9 ? 8 : c > 0.6 ? 3 : 0.12;
      // and toward the busier track: freight on this tile and a couple further on
      const x2 = x + dx * 2, y2 = y + dy * 2;
      const ahead = (fr[j] + (x2 >= 0 && y2 >= 0 && x2 < m.width && y2 < m.height ? fr[y2 * m.width + x2] : 0)) / norm;
      wgt *= 0.3 + Math.min(1.5, ahead);
      opts.push([x, y, wgt]);
    }
    return this.pickOpt(opts);
  }

  private pickOpt(opts: [number, number, number][]): [number, number] | null {
    if (!opts.length) return null;
    let sum = 0; for (const o of opts) sum += o[2];
    let r = this.rng.next() * sum;
    for (const o of opts) { r -= o[2]; if (r <= 0) return [o[0], o[1]]; }
    return [opts[0][0], opts[0][1]];
  }

  /** end of the line: the train backs out the way it came (the engine now shoves from the far end) */
  private reverse(g: GameState, a: Agent) {
    let tr = a.trail ?? [];
    if (tr.length < 3) { a.dying = true; return; }
    // keep only the track under the train, so the new head is where the last car stands
    const total = (a.cars ?? []).reduce((s, c) => s + c.len + 0.035, 0);
    let run = 0, cut = tr.length;
    for (let q = 1; q < tr.length; q++) {
      const p0 = this.snap(tr[q - 1][0], tr[q - 1][1]), p1 = this.snap(tr[q][0], tr[q][1]);
      run += Math.hypot(p1[0] - p0[0], p1[1] - p0[1]);
      if (run >= total) { cut = q + 1; break; }
    }
    tr = tr.slice(0, Math.max(3, cut));
    const r = tr.slice().reverse();
    a.trail = r;
    [a.x, a.y] = r[0];
    [a.px, a.py] = r[1];
    a.rev = !a.rev;
    a.t = 0;
    const nxt = this.chooseTrain(g, a);
    if (!nxt) { a.dying = true; return; }
    [a.nx, a.ny] = nxt;
  }

  /** downstream-from-the-Point direction of the river at a tile (unit vector), from the water-distance field */
  private flowDir(x: number, y: number): [number, number] | null {
    const m = this.m, d = this.down;
    const at = (xx: number, yy: number, c: number) => { if (xx < 0 || yy < 0 || xx >= m.width || yy >= m.height) return c; const v = d[yy * m.width + xx]; return v >= 0 ? v : c; };
    const c = d[y * m.width + x];
    if (c < 0) return null;
    let gx = 0, gy = 0;
    for (const r of [1, 3]) { gx += at(x + r, y, c) - at(x - r, y, c); gy += at(x, y + r, c) - at(x, y - r, c); }
    const l = Math.hypot(gx, gy);
    return l < 0.01 ? null : [gx / l, gy / l];
  }

  private stepBoat(a: Agent, dt: number) {
    if (a.moored || a.dying) return;
    const m = this.m;
    const x = Math.floor(a.fx!), y = Math.floor(a.fy!), i = y * m.width + x;
    let dx = Math.cos(a.ang!), dy = Math.sin(a.ang!);
    // along the river (up or down), through the confluence at the Point on the same heading
    let wx = dx, wy = dy;
    if (a.free! > 0) a.free! -= dt;
    else {
      if (a.sgn! < 0 && this.down[i] >= 0 && this.down[i] < 7) { a.free = 9; a.sgn = 1; }
      const fl = this.flowDir(x, y);
      if (fl) { wx = fl[0] * a.sgn!; wy = fl[1] * a.sgn!; }
    }
    // hold the middle of the channel: steer away from the nearer bank
    const sv = (xx: number, yy: number) => (xx < 0 || yy < 0 || xx >= m.width || yy >= m.height ? 0 : this.shore[yy * m.width + xx]);
    let sx = 0, sy = 0;
    for (const r of [2, 4]) { sx += sv(x + r, y) - sv(x - r, y); sy += sv(x, y + r) - sv(x, y - r); }
    const sl = Math.hypot(sx, sy);
    const wc = clamp01((8 - this.shore[i]) / 8) * 1.3;
    if (sl > 0) { wx += (sx / sl) * wc; wy += (sy / sl) * wc; }
    // look ahead for the bank
    const look = a.kind === "tow" ? 2.2 + (a.barges?.length ?? 0) * 0.25 : 1.6;
    const ax = Math.floor(a.fx! + dx * look), ay = Math.floor(a.fy! + dy * look);
    const blocked = sv(ax, ay) < 2;
    const wl = Math.hypot(wx, wy) || 1;
    // the desired heading changes slowly (tows hold their course)
    const ease = Math.min(1, dt * (blocked ? 2 : a.kind === "tow" ? 0.5 : 0.9));
    a.wantX = a.wantX! + (wx / wl - a.wantX!) * ease; a.wantY = a.wantY! + (wy / wl - a.wantY!) * ease;
    const want = Math.atan2(a.wantY!, a.wantX!);
    let da = want - a.ang!;
    while (da > Math.PI) da -= Math.PI * 2;
    while (da < -Math.PI) da += Math.PI * 2;
    const rate = (a.kind === "tow" ? 0.3 : 0.6) * (blocked ? 2.5 : 1);
    a.ang! += Math.max(-rate * dt, Math.min(rate * dt, da));
    dx = Math.cos(a.ang!); dy = Math.sin(a.ang!);
    const v = a.speed * dt * (blocked ? 0.35 : 1);
    const nx = a.fx! + dx * v, ny = a.fy! + dy * v;
    if (sv(Math.floor(nx), Math.floor(ny)) >= 1) { a.fx = nx; a.fy = ny; a.dist += v; a.stuck = 0; }
    else if ((a.stuck! += dt) > 2.5) { a.sgn = -a.sgn!; a.stuck = 0; a.free = 0; a.wantX = -a.wantX!; a.wantY = -a.wantY!; }
    a.x = Math.floor(a.fx!); a.y = Math.floor(a.fy!);
    // smoke from the stacks
    const steam = a.kind === "steamboat" || this.year < 1940;
    a.puffT! -= dt;
    if (a.puffT! <= 0) {
      a.puffT = steam ? 0.2 : 0.35;
      const wl2 = m.waterLevel[a.y * m.width + a.x];
      if (a.kind === "steamboat") for (const c of [-0.09, 0.09]) this.puff(a.fx! + dx * 0.36 - dy * c, a.fy! + dy * 0.36 + dx * c, wl2, 27, true);
      else if (steam) for (const c of [-0.05, 0.05]) this.puff(a.fx! - dy * c, a.fy! + dx * c, wl2, 24, true);
      else for (const c of [-0.06, 0.06]) this.puff(a.fx! - dx * 0.2 - dy * c, a.fy! - dy * 0.2 + dx * c, wl2, 16, false, 0.3);
    }
  }

  private puff(x: number, y: number, h: number, z: number, dark: boolean, alpha = 0.55, steam = false) {
    if (this.puffs.length > 500) return;
    this.puffs.push({ x, y, h, ox: (this.rng.next() - 0.5) * 1.5, oy: -z, age: 0, life: dark ? 3.2 : 2.2, r: steam ? 1.5 : 2, c: steam ? 200 : dark ? 52 + this.rng.next() * 30 : 120, a: alpha });
  }

  /** a rail tile snapped onto the drawn (vector) track */
  private snap(x: number, y: number): [number, number] {
    const i = y * this.m.width + x;
    let p = this.snapCache.get(i);
    if (!p) {
      // out on a bridge: onto the line of the span (the bridge is drawn straight from end to end)
      for (const sp of this.railSpans) {
        if (p) break;
        const [ax, ay] = sp.a, [bx, by] = sp.b, dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy || 1;
        const t = ((x + 0.5 - ax) * dx + (y + 0.5 - ay) * dy) / L2;
        if (t < 0 || t > 1) continue;
        const cx = ax + dx * t, cy = ay + dy * t;
        if (Math.hypot(cx - x - 0.5, cy - y - 0.5) < 1.0) p = [cx, cy];
      }
      if (!p) p = (this.m.terrain[i] !== Terrain.Water && snapToRail(this.m, x + 0.5, y + 0.5, this.deckYear)) || [x + 0.5, y + 0.5];
      this.snapCache.set(i, p);
    }
    return p;
  }

  // ------------------------------------------------------------ drawing
  /** river craft: drawn under the bridges so decks pass over them */
  drawBoats(ctx: CanvasRenderingContext2D, cam: Camera, time: number) {
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const boats = this.agents.filter((a) => a.kind === "steamboat" || a.kind === "tow");
    boats.sort((p, q) => p.fx! + p.fy! - (q.fx! + q.fy!));
    for (const a of boats) {
      ctx.globalAlpha = Math.max(0, Math.min(1, a.alpha));
      this.drawBoat(ctx, cam, a, time);
    }
    ctx.restore();
  }

  /** street lights of the traffic (head lamps, lit windows, fires): call after the night tint */
  drawLights(ctx: CanvasRenderingContext2D, _cam: Camera, night: number) {
    this.lightsAfterTint = true;
    this.flushLights(ctx, night, 0.6);
  }

  private flushLights(ctx: CanvasRenderingContext2D, night: number, gain: number) {
    const L = this.lights;
    if (!L.length || night < 0.05) { L.length = 0; return; }
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = "lighter";
    for (let k = 0; k < L.length; k += 5) {
      const r = L[k + 2];
      ctx.globalAlpha = Math.min(1, L[k + 3] * night * gain);
      ctx.drawImage(glowSprite(LIGHT_RGB[L[k + 4]]), L[k] - r, L[k + 1] - r, r * 2, r * 2);
    }
    ctx.restore();
    L.length = 0;
  }
  private light(x: number, y: number, r: number, a: number, c: number) { this.lights.push(x, y, r, a, c); }

  draw(ctx: CanvasRenderingContext2D, cam: Camera, _g: GameState, time: number, night = 0) {
    const z = cam.zoom, m = this.m;
    const S = (fx: number, fy: number, h: number): [number, number] => { const [wx, wy] = project(fx, fy, h); return [(wx - cam.x) * z, (wy - cam.y) * z]; };
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const lit = night > 0.35;
    // trains first (they're longer, under the street traffic); boats are drawn before the bridges (drawBoats)
    for (const p of this.parked) this.drawParked(ctx, p, S, z, lit);
    const trains = this.agents.filter((a) => a.kind === "train");
    trains.sort((p, q) => p.x + p.y - (q.x + q.y));
    for (const a of trains) { ctx.globalAlpha = Math.max(0, Math.min(1, a.alpha)); this.drawTrain(ctx, a, S, z, lit); }
    ctx.globalAlpha = 1;
    if (z >= SMALL_AGENT_ZOOM) {
      // people and vehicles, back to front
      type D = { d: number; a?: Agent; fx: number; fy: number; tx: number; ty: number; pk?: PicketSite; fig?: PicketSite["figs"][number]; barrel?: boolean };
      const list: D[] = [];
      for (const a of this.agents) {
        if (BIG.has(a.kind)) continue;
        const p = this.place(a);
        list.push({ d: p[0] + p[1], a, fx: p[0], fy: p[1], tx: p[2], ty: p[3] });
      }
      for (const pk of this.pickets) {
        if (!this.tileInView(Math.floor(pk.cx), Math.floor(pk.cy), 120)) continue;
        for (const f of pk.figs) {
          let fx = f.fx, fy = f.fy, tx = 0, ty = 0;
          if (f.march !== undefined) {
            const th = time * 0.22 + f.march;
            fx = pk.cx + pk.ex * Math.cos(th) * 1.2 + pk.ox * Math.sin(th) * 0.22;
            fy = pk.cy + pk.ey * Math.cos(th) * 1.2 + pk.oy * Math.sin(th) * 0.22;
            tx = -pk.ex * Math.sin(th) * 1.2 + pk.ox * Math.cos(th) * 0.22; ty = -pk.ey * Math.sin(th) * 1.2 + pk.oy * Math.cos(th) * 0.22;
          }
          list.push({ d: fx + fy, fx, fy, tx, ty, pk, fig: f });
        }
        if (lit) list.push({ d: pk.barrel[0] + pk.barrel[1], fx: pk.barrel[0], fy: pk.barrel[1], tx: 0, ty: 0, pk, barrel: true });
      }
      list.sort((p, q) => p.d - q.d);
      const k = z;
      ctx.imageSmoothingEnabled = false;
      const blit = (f: Fig, sx: number, sy: number) =>
        ctx.drawImage(f.c, f.sx, f.sy, f.w, f.h, Math.round(sx - f.ax * k), Math.round(sy - f.ay * k), Math.round(f.w * k), Math.round(f.h * k));
      for (const e of list) {
        const h = this.hAt(e.fx, e.fy);
        const [sx, sy] = S(e.fx, e.fy, h);
        if (sx < -60 || sy < -60 || sx > this.cw + 60 || sy > this.ch + 80) continue;
        // behind a building on a nearer tile: hidden (feet and chest both covered)
        if (this.occluded && this.occluded(sx, sy - 2 * z, Math.floor(e.fx) + Math.floor(e.fy)) && this.occluded(sx, sy - 7 * z, Math.floor(e.fx) + Math.floor(e.fy))) continue;
        if (e.barrel) {
          blit(barrelFig(), sx, sy);
          const fl = Math.sin(time * 13 + e.fx) * Math.sin(time * 7.3);
          ctx.fillStyle = fl > 0 ? "#ffd060" : "#ff9030";
          ctx.fillRect(Math.round(sx - 2 * k), Math.round(sy - (10 + fl * 2) * k), Math.max(1, Math.round(4 * k)), Math.max(1, Math.round((3 + fl) * k)));
          ctx.fillStyle = "#ff6020"; ctx.fillRect(Math.round(sx - 1 * k), Math.round(sy - (12 + fl * 2) * k), Math.max(1, Math.round(2 * k)), Math.max(1, Math.round(2 * k)));
          this.light(sx, sy - 9 * k, (30 + fl * 4) * k, 0.9, 3);
          continue;
        }
        if (e.fig) {
          const marching = e.fig.march !== undefined;
          const front = marching ? e.tx + e.ty > 0 : true;
          const frame = marching ? (((time * 2.6 + e.fig.march!) | 0) & 1) : ((time * 0.7 + e.fx * 3) % 5 < 0.4 ? 1 : 2);
          blit(walkerFig(e.fig.look, front, frame), sx, sy);
          if (e.fig.placard !== undefined) blit(placardFig(e.fig.placard), sx + 2 * k, sy - 6 * k);
          continue;
        }
        const a = e.a!;
        ctx.globalAlpha = Math.max(0, Math.min(1, a.alpha));
        if (a.kind === "walker") {
          const moving = !(a.wait && a.wait > 0) && a.speed > 0;
          const frame = moving ? (((a.dist * 5.5 + a.seed * 2) | 0) & 1) : 2;
          const front = a.hx + a.hy > 0;
          blit(walkerFig(a.look!, front, frame), sx, sy - (moving && frame === 1 ? k : 0));
        } else {
          const tl = Math.hypot(a.hx, a.hy) || 1;
          const f: Facing = Math.abs(a.hx) > Math.abs(a.hy) ? (a.hx > 0 ? 0 : 2) : (a.hy > 0 ? 1 : 3);
          const sp = a.spec!;
          const horse = sp.kind === "wagon" || sp.kind === "carriage" || sp.kind === "horsecar";
          const frame = ((a.dist * (horse ? 4 : 8)) | 0) & 1;
          // a soft shadow under the body
          ctx.fillStyle = "rgba(0,0,0,0.18)";
          ctx.beginPath(); ctx.ellipse(sx, sy + k, (sp.kind === "streetcar" || (sp.kind === "truck" && sp.era === 3) ? 13 : 8) * k, 3.5 * k, 0, 0, Math.PI * 2); ctx.fill();
          blit(vehicleFig(sp, f, frame, lit), sx, sy);
          if (night > 0.25) {
            const ux = a.hx / tl, uy = a.hy / tl;
            const fr = frontOf(sp.kind, sp.era);
            if (sp.kind === "auto" || sp.kind === "truck" || sp.kind === "streetcar") {
              if (this.year >= 1910 || sp.kind === "streetcar") {
                const [lx, ly] = S(e.fx + ux * (fr + 0.03), e.fy + uy * (fr + 0.03), h);
                ctx.fillStyle = "#fff4c8"; ctx.fillRect(Math.round(lx - k), Math.round(ly - 4 * k), Math.max(1, Math.round(2 * k)), Math.max(1, Math.round(k)));
                const [bx, by] = S(e.fx + ux * (fr + 0.32), e.fy + uy * (fr + 0.32), h);
                this.light(lx, ly - 3 * k, 6 * k, 0.9, 1);
                this.light(bx, by - k, 13 * k, 0.45, 1); // the pool of light ahead
                if (this.year >= 1925 && sp.kind !== "streetcar") { const [rx, ry] = S(e.fx - ux * fr, e.fy - uy * fr, h); this.light(rx, ry - 3 * k, 4 * k, 0.7, 2); }
              }
              if (sp.kind === "streetcar" && this.rng.chance(0.03)) {
                // a spark at the trolley wire
                const [px, py] = S(e.fx - ux * (fr + 0.1), e.fy - uy * (fr + 0.1), h);
                ctx.fillStyle = "#e8f0ff"; ctx.fillRect(Math.round(px - k), Math.round(py - 23 * k), Math.max(1, Math.round(3 * k)), Math.max(1, Math.round(2 * k)));
                this.light(px, py - 22 * k, 16 * k, 1, 4);
              }
              if (sp.kind === "streetcar") this.light(sx, sy - 7 * k, 14 * k, 0.35, 0);
            } else {
              // a lantern on the wagon
              const [lx, ly] = S(e.fx + ux * 0.02, e.fy + uy * 0.02, h);
              ctx.fillStyle = "#ffd890"; ctx.fillRect(Math.round(lx), Math.round(ly - 8 * k), Math.max(1, Math.round(k)), Math.max(1, Math.round(k)));
              this.light(lx, ly - 8 * k, 7 * k, 0.6, 0);
            }
          }
        }
        ctx.globalAlpha = 1;
      }
      ctx.imageSmoothingEnabled = false;
    }
    // smoke and steam above everything on the ground
    this.drawPuffs(ctx, S, z);
    ctx.restore();
    if (!this.lightsAfterTint) this.flushLights(ctx, night, 1.6);
    void m;
  }

  /** a street figure's position (rounded through the corners) and heading */
  private place(a: Agent): [number, number, number, number] {
    const m0x = (a.px + a.x) / 2 + 0.5, m0y = (a.py + a.y) / 2 + 0.5;
    const cx = a.x + 0.5, cy = a.y + 0.5;
    const m1x = (a.x + a.nx) / 2 + 0.5, m1y = (a.y + a.ny) / 2 + 0.5;
    const s = Math.min(1, a.t), u = 1 - s;
    let fx = u * u * m0x + 2 * u * s * cx + s * s * m1x, fy = u * u * m0y + 2 * u * s * cy + s * s * m1y;
    let tx = 2 * u * (cx - m0x) + 2 * s * (m1x - cx), ty = 2 * u * (cy - m0y) + 2 * s * (m1y - cy);
    const tl = Math.hypot(tx, ty);
    if (tl > 0.05) { tx /= tl; ty /= tl; a.hx = tx; a.hy = ty; } else { tx = a.hx; ty = a.hy; }
    // keep to the right-hand side of the street (people on the sidewalk); streetcars run down the middle
    const side = a.kind === "walker" ? (a.role === "idle" ? 0.24 + a.seed * 0.12 : 0.12 + a.seed * 0.24) : a.kind === "streetcar" || a.kind === "horsecar" ? 0 : 0.13;
    fx += -ty * side; fy += tx * side;
    return [fx, fy, tx, ty];
  }

  private drawPuffs(ctx: CanvasRenderingContext2D, S: (x: number, y: number, h: number) => [number, number], k: number) {
    for (const p of this.puffs) {
      const f = p.age / p.life;
      const [sx, sy] = S(p.x, p.y, p.h);
      const x = sx + p.ox * k, y = sy + p.oy * k;
      if (x < -40 || y < -60 || x > this.cw + 40 || y > this.ch + 40) continue;
      const r = (p.r + Math.sqrt(f) * 9) * k; // swells as it rises, like the plant plumes
      const c = p.c + f * 70;
      ctx.fillStyle = `rgba(${c | 0},${(c - 3) | 0},${(c - 6) | 0},${(p.a * (1 - f)).toFixed(3)})`;
      ctx.beginPath(); ctx.ellipse(x, y, r * 1.2, r, 0, 0, Math.PI * 2); ctx.fill();
    }
  }

  private drawTrain(ctx: CanvasRenderingContext2D, a: Agent, S: (x: number, y: number, h: number) => [number, number], k: number, lit: boolean) {
    const tr = a.trail ?? [];
    if (!tr.length || !a.cars) return;
    // the track behind the head, snapped onto the drawn rails
    const c0 = this.snap(a.x, a.y), n0 = this.snap(a.nx, a.ny);
    const t = Math.min(1, a.t);
    const pts: [number, number][] = [[c0[0] + (n0[0] - c0[0]) * t, c0[1] + (n0[1] - c0[1]) * t]];
    for (const [x, y] of tr) pts.push(this.snap(x, y));
    const cum = [0];
    for (let q = 1; q < pts.length; q++) cum.push(cum[q - 1] + Math.hypot(pts[q][0] - pts[q - 1][0], pts[q][1] - pts[q - 1][1]));
    let seg = 1;
    const at = (s: number): [number, number] => {
      while (seg < cum.length - 1 && cum[seg] < s) seg++;
      const f = Math.min(1, (s - cum[seg - 1]) / ((cum[seg] - cum[seg - 1]) || 1));
      return [pts[seg - 1][0] + (pts[seg][0] - pts[seg - 1][0]) * f, pts[seg - 1][1] + (pts[seg][1] - pts[seg - 1][1]) * f];
    };
    const total = cum[cum.length - 1];
    const cars = a.rev ? a.cars.slice().reverse() : a.cars;
    const items: { x: number; y: number; dx: number; dy: number; car: Car; flip: boolean }[] = [];
    let s = 0;
    for (const car of cars) {
      if (s + car.len > total) break;
      const [fx, fy] = at(s), [bx, by] = at(s + car.len);
      const l = Math.hypot(fx - bx, fy - by) || 1;
      items.push({ x: (fx + bx) / 2, y: (fy + by) / 2, dx: (fx - bx) / l, dy: (fy - by) / l, car, flip: !!a.rev });
      s += car.len + 0.035;
    }
    items.sort((p, q) => p.x + p.y - (q.x + q.y));
    for (const it of items) {
      const h = this.hAt(it.x, it.y);
      const [sx, sy] = S(it.x, it.y, h);
      if (sx < -80 || sy < -80 || sx > this.cw + 80 || sy > this.ch + 80) continue;
      // a car inside a works' walls, or behind a building, isn't drawn
      const ti = Math.floor(it.y) * this.m.width + Math.floor(it.x);
      if (this.worksTile?.(ti)) continue;
      if (this.occluded && this.occluded(sx, sy - 2 * k, Math.floor(it.x) + Math.floor(it.y)) && this.occluded(sx, sy - 8 * k, Math.floor(it.x) + Math.floor(it.y))) continue;
      const dx = it.flip && isLoco(it.car.type) ? -it.dx : it.dx, dy = it.flip && isLoco(it.car.type) ? -it.dy : it.dy;
      drawCar(ctx, it.car, sx, sy, k, dx, dy, lit);
      if (isLoco(it.car.type)) {
        const front = it.car.len / 2;
        if (it.car.type === "steam") {
          a.puffT! -= this.dt / Math.max(1, cars.filter((c) => c.type === "steam").length);
          if (a.puffT! <= 0) { a.puffT = 0.11 + this.rng.next() * 0.05; this.puff(it.x + dx * (front - 0.05), it.y + dy * (front - 0.05), h, 16, true, 0.6); }
        } else if (it.car.type === "diesel" && this.rng.chance(this.dt * 2)) this.puff(it.x, it.y, h, 12, false, 0.2);
        if (lit) {
          const [lx, ly] = ooff(k, dx, dy, front + 0.01, 0, 8.5);
          const [bx, by] = ooff(k, dx, dy, front + 0.5, 0, 0);
          ctx.fillStyle = "#fff4c8"; ctx.fillRect(Math.round(sx + lx - k), Math.round(sy + ly - k), Math.max(1, Math.round(2 * k)), Math.max(1, Math.round(2 * k)));
          this.light(sx + lx, sy + ly, 8 * k, 1, 1);
          this.light(sx + bx, sy + by, 20 * k, 0.35, 1);
        }
      } else if (lit && (it.car.type === "coach" || it.car.type === "caboose")) this.light(sx, sy - 7 * k, 12 * k, 0.4, 0);
    }
  }

  private drawParked(ctx: CanvasRenderingContext2D, p: ParkedCut, S: (x: number, y: number, h: number) => [number, number], k: number, lit: boolean) {
    const sorted = p.cars.slice().sort((a, b) => a.x + a.y - (b.x + b.y));
    for (const c of sorted) {
      const h = this.hAt(c.x, c.y);
      const [sx, sy] = S(c.x, c.y, h);
      if (sx < -80 || sy < -80 || sx > this.cw + 80 || sy > this.ch + 80) continue;
      drawCar(ctx, c.car, sx, sy, k, c.dx, c.dy, lit);
      if (c.car.type === "steam") {
        // the switcher simmers
        p.puffT -= this.dt;
        if (p.puffT <= 0) { p.puffT = 0.6 + this.rng.next() * 0.5; this.puff(c.x + c.dx * 0.2, c.y + c.dy * 0.2, h, 14, false, 0.22, true); }
      }
      if (lit && isLoco(c.car.type)) this.light(sx, sy - 9 * k, 9 * k, 0.6, 0);
    }
  }

  private drawBoat(ctx: CanvasRenderingContext2D, cam: Camera, a: Agent, time: number) {
    const k = cam.zoom, m = this.m;
    const fx = a.fx!, fy = a.fy!;
    const wl = m.waterLevel[a.y * m.width + a.x];
    const [wx0, wy0] = project(fx, fy, wl);
    const sx = (wx0 - cam.x) * k, sy = (wy0 - cam.y) * k;
    if (sx < -260 * k || sy < -200 * k || sx > this.cw + 260 * k || sy > this.ch + 200 * k) return;
    // behind a wharf, a warehouse or a bridge pier on the near bank: the hull and the stack both covered
    if (this.occluded && this.occluded(sx, sy - 3 * k, Math.floor(fx) + Math.floor(fy)) && this.occluded(sx, sy - 12 * k, Math.floor(fx) + Math.floor(fy))) return;
    const dx = Math.cos(a.ang!), dy = Math.sin(a.ang!);
    const night = this.night, lit = night > 0.35;
    const O = (al: number, c: number, z = 0) => { const [ox, oy] = ooff(k, dx, dy, al, c, z); return [sx + ox, sy + oy] as [number, number]; };
    const box = (a0: number, a1: number, c0: number, c1: number, z0: number, z1: number, col: string, top?: string) => obox(ctx, sx, sy, k, dx, dy, a0, a1, c0, c1, z0, z1, col, top);
    const steamboat = a.kind === "steamboat";
    const stern = steamboat ? -0.72 : -0.42;
    const moving = !a.moored;
    // wake: churned water at the stern and a V spreading behind
    if (moving) {
      const sp = Math.min(1.2, a.speed / 0.3);
      ctx.lineWidth = Math.max(1, 1.3 * k);
      // the V of the wake, fading as it spreads
      for (let q = 0; q < 3; q++) {
        ctx.strokeStyle = `rgba(225,238,245,${(0.3 - q * 0.09).toFixed(2)})`;
        ctx.beginPath();
        for (const side of [-1, 1]) {
          const p0 = O(stern - q * 0.35 * sp + 0.05, side * (0.15 + q * 0.13)), p1 = O(stern - (q + 1) * 0.35 * sp, side * (0.28 + q * 0.13));
          ctx.moveTo(p0[0], p0[1]); ctx.lineTo(p1[0], p1[1]);
        }
        ctx.stroke();
      }
      ctx.strokeStyle = "rgba(225,238,245,0.16)"; ctx.lineWidth = Math.max(1, 3.5 * k);
      const q0 = O(stern, 0), q1 = O(stern - 0.9 * sp, 0);
      ctx.beginPath(); ctx.moveTo(q0[0], q0[1]); ctx.lineTo(q1[0], q1[1]); ctx.stroke();
      if (a.kind === "tow") {
        // a bow wave off the head of the raft
        const [bx, by] = O(0.3 + 0.93 * Math.ceil(a.barges!.length / 2) + 0.02, 0);
        ctx.fillStyle = "rgba(235,244,248,0.3)"; ctx.beginPath(); ctx.ellipse(bx, by, 8 * k, 3 * k, 0, 0, Math.PI * 2); ctx.fill();
      }
      const ch = 0.35 + 0.15 * Math.sin(time * 9 + a.seed * 9);
      const [cx, cy] = O(stern - 0.12, 0);
      ctx.fillStyle = `rgba(235,244,248,${ch.toFixed(2)})`;
      ctx.beginPath(); ctx.ellipse(cx, cy, 7 * k, 3 * k, 0, 0, Math.PI * 2); ctx.fill();
    }
    // parts back to front (by depth along the heading)
    type Part = { d: number; draw: () => void };
    const parts: Part[] = [];
    const depth = (al: number, c: number) => (dx * al - dy * c) + (dy * al + dx * c);
    const paddle = (a0: number, a1: number, w: number) => {
      box(a0, a1, -w, w, 0, 9, "#8a2e24", "#6a2018");
      if (moving) for (let q = 0; q < 2; q++) { const ph = ((time * 1.6 + q * 0.5 + a.seed) % 1) * 7.5; box(a0 - 0.005, a1 + 0.005, -w - 0.004, w + 0.004, ph, ph + 1, "#4a1610"); }
    };
    const win = lit ? "#ffd27a" : "#3a4048";
    if (a.kind === "tow") {
      const n = a.barges!.length, cols = Math.ceil(n / 2);
      for (let q = 0; q < n; q++) {
        const col = q >> 1, c = n === 1 ? 0 : q % 2 ? 0.155 : -0.155, al = 0.3 + 0.46 + col * 0.93;
        const cargo = a.barges![q];
        parts.push({ d: depth(al, c), draw: () => {
          box(al - 0.46, al + 0.46, c - 0.15, c + 0.15, 0, 3, "#4a3a2a", "#6a5640");
          if (cargo === "covered") box(al - 0.42, al + 0.42, c - 0.12, c + 0.12, 3, 6, "#6a6a6e");
          else if (cargo !== "empty") { box(al - 0.39, al + 0.39, c - 0.11, c + 0.11, 3, 4.5, sh(cargo, 0.8)); box(al - 0.33, al + 0.33, c - 0.06, c + 0.06, 4.5, 5.6, cargo); }
        } });
      }
      void cols;
      const steam = this.year < 1940;
      parts.push({ d: depth(-0.1, 0), draw: () => {
        if (steam) paddle(-0.55, -0.4, 0.14);
        box(-0.42, 0.28, -0.15, 0.15, 0, 2.5, a.col);
        box(-0.36, 0.14, -0.125, 0.125, 2.5, 4.3, "#efe9da");
        box(-0.36, 0.14, -0.125, 0.125, 4.3, 5.6, win);
        box(-0.36, 0.14, -0.125, 0.125, 5.6, 6.5, "#efe9da", "#cfc8b8");
        box(-0.3, 0.04, -0.1, 0.1, 6.5, 9.5, "#efe9da");
        box(-0.12, 0.02, -0.07, 0.07, 9.5, 11.5, "#efe9da");
        box(-0.12, 0.02, -0.07, 0.07, 11.5, 12.8, win);
        box(-0.13, 0.03, -0.075, 0.075, 12.8, 13.6, "#3a3a3e");
        for (const c of [-0.05, 0.05]) box(steam ? -0.02 : -0.22, steam ? 0.02 : -0.18, c - 0.018, c + 0.018, 9.5, steam ? 24 : 15, "#1e1e22");
      } });
      if (lit) { const [lx, ly] = O(0.3 + 0.93 * cols, 0, 4); this.light(lx, ly, 18 * k, 0.5, 1); }
    } else {
      parts.push({ d: depth(-0.6, 0), draw: () => paddle(-0.78, -0.6, 0.16) });
      parts.push({ d: depth(0, 0), draw: () => {
        box(-0.6, 0.62, -0.17, 0.17, 0, 2, "#2c2a28");
        box(-0.55, 0.52, -0.16, 0.16, 2, 3.4, a.col);
        box(-0.5, 0.42, -0.15, 0.15, 3.4, 4.8, win);
        box(-0.52, 0.5, -0.165, 0.165, 4.8, 5.6, a.col, "#f4f0e6");
        box(-0.42, 0.3, -0.13, 0.13, 5.6, 7, a.col);
        box(-0.4, 0.28, -0.125, 0.125, 7, 8.2, win);
        box(-0.43, 0.31, -0.14, 0.14, 8.2, 9, a.col, "#f4f0e6");
        box(-0.12, 0.16, -0.07, 0.07, 9, 11.5, a.col);
        box(0.06, 0.16, -0.05, 0.05, 11.5, 15, "#f4f0e6", "#3a3a3e");
        for (const c of [-0.09, 0.09]) { box(0.33, 0.39, c - 0.018, c + 0.018, 5.6, 25, "#1c1a1a"); box(0.32, 0.4, c - 0.026, c + 0.026, 25, 27, "#2a2422"); }
      } });
      if (lit) { const [lx, ly] = O(0, 0, 6); this.light(lx, ly, 26 * k, 0.45, 0); }
    }
    parts.sort((p, q) => p.d - q.d);
    for (const p of parts) p.draw();
  }
}

// ---------------------------------------------------------------- trains

const isLoco = (t: CarType) => t === "steam" || t === "diesel";

/** a car of a type, coloured for the year */
function carOf(type: CarType, year: number, rng: Rng, switcher = false): Car {
  const pick = <T,>(a: readonly T[]) => rng.pick(a);
  switch (type) {
    case "steam": return { type, len: switcher ? 0.42 : 0.55, col: year < 1880 ? pick(["#2e4a3a", "#6a2a22", "#3a3a5a"]) : "#1e1e22", col2: year < 1880 ? "#8a2a22" : "#2a2a2e" };
    case "tender": return { type, len: 0.32, col: year < 1880 ? pick(["#2e4a3a", "#6a2a22"]) : "#222226" };
    case "diesel": {
      const cols = year < 1968 ? ["#26362c", "#2c3c5a", "#3a3e44", "#1e1e22"] : year < 1976 ? ["#1e1e22", "#2c3c5a", "#3a3e44"] : ["#22406e", "#22406e", "#e8c030", "#1e1e22"];
      return { type, len: switcher ? 0.4 : 0.52, col: pick(cols), col2: year < 1962 ? "#d8b040" : "#c8c8c0" };
    }
    case "hopper": return { type, len: 0.38, col: pick(["#26262a", "#2e2a28", "#4a2e24"]) };
    case "box": return { type, len: 0.42, col: pick(["#7a3a28", "#6a3a2a", "#8a4a32", "#5a4a3a"]) };
    case "jenny": return { type, len: 0.28, col: pick(["#5a3424", "#4a2e22"]) };
    case "gon": return { type, len: 0.42, col: pick(["#3a3a3e", "#4a3a30"]) };
    case "flat": return { type, len: 0.44, col: "#4a4038" };
    case "tank": return { type, len: 0.38, col: pick(["#1e1e22", "#1e1e22", "#c8c8c0"]) };
    case "covered": return { type, len: 0.4, col: pick(["#8a8a88", "#9a948a"]) };
    case "caboose": return { type, len: 0.34, col: year < 1960 ? "#a8322a" : pick(["#a8322a", "#e8c030", "#22406e"]) };
    case "baggage": return { type, len: 0.5, col: year < 1890 ? "#7a5a2e" : pick(["#6a2a22", "#26362c"]) };
    default: return { type: "coach", len: 0.55, col: year < 1890 ? pick(["#7a5a2e", "#8a6a3a", "#5a3a22"]) : pick(["#6a2a22", "#26362c", "#6a2a22"]) };
  }
}

/** a train for the year: engine(s), then cars by what the valley ships */
function consist(year: number, passenger: boolean, rng: Rng): Car[] {
  const dieselP = year < 1946 ? 0 : year >= 1960 ? 1 : (year - 1946) / 14;
  const diesel = rng.chance(dieselP);
  const out: Car[] = [];
  if (diesel) { const n = passenger ? 1 + (rng.chance(0.4) ? 1 : 0) : 1 + rng.int(0, 2); const d = carOf("diesel", year, rng); for (let k = 0; k < n; k++) out.push({ ...d }); }
  else { out.push(carOf("steam", year, rng), carOf("tender", year, rng)); }
  if (passenger) {
    out.push(carOf("baggage", year, rng));
    const n = 3 + rng.int(0, 4), c = carOf("coach", year, rng);
    for (let k = 0; k < n; k++) out.push({ ...c });
    return out;
  }
  const n = 8 + rng.int(0, 14);
  // unit trains of coal or ore are common; otherwise a mixed freight
  const unit = rng.chance(0.45) ? (year >= 1880 && rng.chance(0.4) ? "jenny" : "hopper") : null;
  for (let k = 0; k < n; k++) {
    let t: CarType;
    if (unit) t = unit;
    else {
      const r = rng.next();
      t = r < 0.3 ? "hopper" : r < 0.5 ? "box" : r < 0.62 ? "gon" : r < 0.72 ? (year >= 1880 ? "jenny" : "hopper") : r < 0.8 ? (year >= 1880 ? "tank" : "box") : r < 0.9 ? (year >= 1950 ? "covered" : "box") : "flat";
    }
    out.push(carOf(t, year, rng));
  }
  if (year < 1985) out.push(carOf("caboose", year, rng));
  return out;
}

/** what a barge carries on each river: coal down the Mon, sand and gravel on the Allegheny, ore up the Ohio */
function bargeCargo(river: string, year: number, rng: Rng): string {
  if (rng.chance(0.12)) return "empty";
  if (year >= 1950 && rng.chance(0.15)) return "covered";
  if (/Allegheny/.test(river)) return rng.pick(["#c8b080", "#b8a070", "#8a8478", "#1e1f24"]);
  if (/Ohio/.test(river)) return rng.chance(year >= 1880 ? 0.5 : 0.1) ? "#8a4424" : "#22232a";
  return rng.chance(0.85) ? "#22232a" : "#4a4a52"; // coal, coke
}

/** one car (or engine) as a few oriented boxes; front along +(dx, dy) */
function drawCar(ctx: CanvasRenderingContext2D, c: Car, sx: number, sy: number, k: number, dx: number, dy: number, lit: boolean) {
  const L = c.len / 2;
  const B = (a0: number, a1: number, c0: number, c1: number, z0: number, z1: number, col: string, top?: string) => obox(ctx, sx, sy, k, dx, dy, a0, a1, c0, c1, z0, z1, col, top);
  // shadow
  B(-L, L, -0.06, 0.08, 0, 0.5, "#1a1816", "rgba(0,0,0,0.25)");
  switch (c.type) {
    case "steam": {
      const early = c.col !== "#1e1e22";
      B(-L, L, -0.068, 0.068, 1, 3.5, c.col2 ?? "#2a2a2e");
      B(-L + 0.15, L - 0.02, -0.052, 0.052, 3.5, 9, early ? "#3a3a40" : c.col);
      B(L - 0.08, L - 0.01, -0.054, 0.054, 3.5, 9.2, "#3a3a3e");
      B(-L, -L + 0.15, -0.07, 0.07, 2, 11.5, early ? c.col : "#26262c");
      B(-L - 0.01, -L + 0.16, -0.076, 0.076, 11.5, 12.5, "#141416");
      if (lit) B(-L + 0.02, -L + 0.13, -0.071, 0.071, 8, 10, "#ffd27a");
      B(-0.02, 0.04, -0.022, 0.022, 9, 11.5, early ? "#c8a040" : c.col);
      B(L - 0.07, L - 0.03, -0.018, 0.018, 9, 13.5, "#1a1a1c");
      if (early) B(L - 0.09, L - 0.01, -0.032, 0.032, 13.5, 16, "#2a2a2e"); // balloon stack
      break;
    }
    case "tender": B(-L, L, -0.066, 0.066, 1.5, 7, c.col); B(-L + 0.03, L - 0.06, -0.05, 0.05, 7, 8.2, "#141416"); break;
    case "diesel": {
      const gp = c.col2 === "#c8c8c0";
      if (gp) {
        B(-L, L, -0.07, 0.07, 1, 2.8, "#26262a");
        B(-L, L - 0.16, -0.055, 0.055, 2.8, 8.5, c.col);
        B(L - 0.16, L - 0.05, -0.068, 0.068, 2.8, 11, c.col);
        B(L - 0.15, L - 0.06, -0.069, 0.069, 8.5, 10, lit ? "#ffd27a" : "#8ca0a8");
        B(L - 0.05, L, -0.05, 0.05, 2.8, 7, c.col);
      } else {
        B(-L, L, -0.068, 0.068, 1, 10, c.col);
        B(-L, L, -0.069, 0.069, 5, 6, c.col2 ?? "#d8b040");
        B(L - 0.06, L - 0.01, -0.06, 0.06, 7.5, 9.3, lit ? "#ffd27a" : "#8ca0a8");
      }
      break;
    }
    case "hopper": B(-L, L, -0.066, 0.066, 1.5, 7, c.col); B(-L + 0.03, L - 0.03, -0.05, 0.05, 7, 8.4, "#141416"); break;
    case "box": B(-L, L, -0.068, 0.068, 1.5, 9.5, c.col); B(-0.05, 0.05, -0.069, 0.069, 2, 8.5, sh(c.col, 0.82)); break;
    case "jenny": B(-L, L, -0.064, 0.064, 1.5, 5.5, c.col); B(-L + 0.03, L - 0.03, -0.045, 0.045, 5.5, 7, "#8a4424"); break;
    case "gon": B(-L, L, -0.066, 0.066, 1.5, 5, c.col); B(-L + 0.04, L - 0.04, -0.05, 0.05, 5, 5.8, "#7a7a80"); break;
    case "flat": B(-L, L, -0.066, 0.066, 1.5, 3, c.col); for (const q of [-0.12, 0.12]) B(q - 0.06, q + 0.06, -0.045, 0.045, 3, 6.5, "#8a8a90"); break;
    case "tank": B(-L, L, -0.06, 0.06, 1.5, 3, "#26262a"); B(-L + 0.02, L - 0.02, -0.058, 0.058, 3, 8, c.col); B(-0.03, 0.03, -0.025, 0.025, 8, 9.5, c.col); break;
    case "covered": B(-L, L, -0.066, 0.066, 1.5, 9, c.col); break;
    case "caboose": B(-L, L, -0.066, 0.066, 1.5, 8.5, c.col); B(-0.06, 0.06, -0.05, 0.05, 8.5, 11.5, c.col, "#3a3a3a"); if (lit) B(-0.055, 0.055, -0.051, 0.051, 9.3, 10.6, "#ffd27a"); break;
    case "baggage": B(-L, L, -0.068, 0.068, 1.5, 9.5, c.col); B(-L, L, -0.055, 0.055, 9.5, 10.5, "#2e2e30"); break;
    case "coach": {
      B(-L, L, -0.068, 0.068, 1.5, 4.5, c.col);
      B(-L + 0.03, L - 0.03, -0.066, 0.066, 4.5, 7.5, lit ? "#ffd27a" : "#3a4048");
      B(-L, L, -0.068, 0.068, 7.5, 9, c.col);
      B(-L, L, -0.055, 0.055, 9, 10.5, "#2e2e30");
      break;
    }
  }
}

/** Deck height profile (m) along a span, f = 0..1 — shared with the bridge renderer. */
/** below this zoom, small street agents (people, horses, cars) are not shown */
export const SMALL_AGENT_ZOOM = 0.375;
const BIG = new Set<string>(["train", "steamboat", "tow"]);

export function spanProfile(m: GameMap, sp: Span, type: string, built: number) {
  const elevAt = (x: number, y: number) => m.elevation[Math.max(0, Math.min(m.height - 1, Math.floor(y))) * m.width + Math.max(0, Math.min(m.width - 1, Math.floor(x)))];
  const [ax, ay] = sp.a, [bx, by] = sp.b;
  const gA = elevAt(ax, ay), gB = elevAt(bx, by);
  const wl = m.waterLevel[Math.floor((ay + by) / 2) * m.width + Math.floor((ax + bx) / 2)] || Math.min(gA, gB) - 8;
  const clear = sp.kind === "rail" ? 17 : type === "covered" ? 9 : built >= 1920 ? 22 : 14;
  const lift = Math.max(0, wl + clear - Math.min(gA, gB));
  return (t: number) => gA + (gB - gA) * t + lift * Math.pow(Math.sin(Math.PI * t), 0.45);
}
