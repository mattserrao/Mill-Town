// Smooth-terrain isometric renderer.
// The map is cut into 16x16-tile chunks. Each chunk is software-rasterized once per zoom level:
// every tile is two lit, textured triangles over its four real corner heights (no steps between
// tiles), followed by its sprites, all painted back-to-front into one pixel buffer.
// Chunks are cached (LRU) and re-rendered progressively when the world changes.

import { clutterSprites } from "./clutter";
import { roadDist, roadIndex } from "./roads";
import { SEASONS, type SeasonLook, seasonGround, seasonLook, seasonSprite } from "./seasons";
import { DETAIL, shadowKind, shadowShape, terrainLight } from "./light";
import { lineIndex, segDist, type Seg } from "../core/lines";
import { shoreDist, shoreField, wetAt } from "../core/shore";
import { rivalRunning, techsForYear, type GameState, type Works } from "../core/game";
import { INDUSTRIES, type IndustryId } from "../core/industries";
import { type GameMap, Special } from "../core/map";
import { RIVALS } from "../core/rivals";
import { Terrain } from "../core/terrain";
import { CivicSub, HouseSub, STRUCTURES, Street, Use } from "../core/town";
import { ANCHORS, G, latinRite } from "../core/ancestry";
import { latLonToTile } from "../core/features";
import { FarmSub, LotSub, ParkSub, SHOP_CLOSED } from "../core/platlayout";
import { CEM_FILL, CEM_FIXED, CEM_PLOT, CEM_RURAL, cemFaith } from "../core/civiclife";
import { buildHouse, houseKey, styleForYear, type HouseKind } from "./houses";
import { type Camera, BASE_M, heightAt, HH, HW, placeLabelRects, project, RELIEF, tileCorners, ZOOMS, ZPX } from "./iso";
import { type Portal, portals } from "../core/tunnels";
import { buildPortal, portalKey } from "./portals";
import { buildPlant, type Emitter, emittersFor, layoutAnnex, layoutPlant, type PlantCtx, plantKey, type PlantTile } from "./plants";
import { buildSprites, cropSprite, scaleSprite, type Sprite, type SpriteBuf } from "./sprites";
import { drawFire, drawPlume, rivalLook, type SmokeLook, smokeLook, windFor } from "./pollution";

interface PlantRef { t: PlantTile; c: PlantCtx; years: number }
/** an emitter placed on the map; `group` indexes the works it belongs to (its smoke look for the season) */
interface LiveEmitter extends Emitter { wx: number; wy: number; seed: number; running: boolean; group: number }
/** whose smoke an emitter group is: one of your works, or a rival by id */
type EmitterOwner = { works: Works } | { rival: string };

export type OverlayFn = ((i: number) => [number, number, number, number] | null) | null;

export interface ViewOptions {
  overlay: OverlayFn;
  overlayKey: string;
  grid: boolean;
}

export interface Marks {
  hover: { x: number; y: number } | null;
  selected: { x: number; y: number } | null;
  footprint: { x: number; y: number; size: number; ok: boolean } | null;
  labels: boolean;
}

const CS = 16;              // chunk size in tiles
const PAD_TOP = 420;        // room for tall sprites (stacks, smoke, spires), zoom-1 px
const PAD_X = 48;
/** cached chunk pixels: about three screens' worth at the current zoom, within these bounds */
const BUDGET_MIN_PX = 12e6, BUDGET_MAX_PX = 40e6;
/** generated house and plant sprites (the source canvas and its scaled buffers), least recently used first out */
const GEN_BUDGET_BYTES = 64e6;
/** chunks and scaled buffers of a zoom you've left are dropped this long after the change */
const OTHER_ZOOM_MS = 3000;
interface GenSprite { sp: Sprite; bufs: Map<number, SpriteBuf>; bytes: number }
const FRAME_MS = 28;        // raster budget per frame

/**
 * A drawn chunk. `depth` holds, per pixel, what was drawn there last: 0 nothing, 1 ground (and bridge decks),
 * otherwise 2 + the tile depth (x + y) of the object — so moving figures can tell when a building stands in front.
 */
interface Chunk { canvas: HTMLCanvasElement; ox: number; oy: number; key: string; px: number; depth: Uint16Array; w: number; shade?: HTMLCanvasElement }

// ---------------------------------------------------------------- colour helpers
const rgb = (r: number, g: number, b: number) => (r << 16) | (g << 8) | b;
function hash(x: number, y: number, c = 0): number {
  let h = (x * 374761393) ^ (y * 668265263) ^ (c * 2147483647);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
const pick = (pal: number[], n: number) => pal[Math.min(pal.length - 1, Math.floor(n * pal.length))];
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((b) => (b + 0.5) / 16 - 0.5);

const PAL = {
  grass: [0x6f9a3e, 0x7aa646, 0x668f39, 0x80aa4a, 0x729e40],
  meadow: [0x86a84e, 0x93b45a, 0x7c9e48, 0x8eae52],
  woods: [0x3c5a2a, 0x46622e, 0x52583a, 0x40602c, 0x5a6236],
  lot: [0x7a9a48, 0x86905a, 0x6e9040, 0x8a8a58],
  town: [0x7a6650, 0x6e5c48, 0x856e56, 0x76604c],
  yard: [0x3a3634, 0x46403c, 0x302c2a, 0x54402e, 0x403a36],
  rock: [0x8a7a62, 0x9a8a70, 0x7a6a56, 0x86806c, 0x6e6658],
  paved: [0xb8b0a0, 0xaca492, 0xc0b8a8],
  sand: [0xa08e66, 0x948258, 0xaa9a72],
  wet: [0x6a5e46, 0x5e523e],
  crops: [
    [0xc8aa5a, 0xb89a4c, 0xd4b866], // wheat
    [0x5e8a38, 0x4c7430, 0x6a9640], // corn
    [0x7a5a3a, 0x664a30, 0x86664a], // plowed
    [0x9cb45a, 0x8aa24e, 0xaabe66], // hay
    [0x78a448, 0x6c9840, 0x84ac50], // pasture
  ],
};
const WATER = [0x33668e, 0x366b94, 0x306188, 0x386e96];
/**
 * A bridge's paint in a given year. Pittsburgh's downtown bridges went Aztec Gold (the city's black and gold) from
 * 1975: the Three Sisters that year, then the West End, Fort Pitt and Fort Duquesne bridges in the 1978–81 repaint.
 * Before that the Sisters wore a silver superstructure over green deck girders; other steel was grey or black.
 */
const GOLD_FROM: Record<string, number> = {
  "Sixth Street Bridge": 1975, "Seventh Street Bridge": 1975, "Ninth Street Bridge": 1975, "South Tenth Street Bridge": 1975,
  "West End Bridge": 1978, "Fort Pitt Bridge": 1979, "Fort Duquesne Bridge": 1981,
};
const SISTERS = new Set(["Sixth Street Bridge", "Seventh Street Bridge", "Ninth Street Bridge"]);
export function bridgePaint(name: string, rail: boolean, built: number, year: number): { steel: string; girder: string } {
  if (rail) return { steel: built < 1890 ? "#3e3e46" : "#4e525c", girder: "#4a4440" };
  const gold = GOLD_FROM[name];
  if (gold !== undefined && year >= gold) return { steel: "#c8a23a", girder: "#a8842a" };
  if (SISTERS.has(name) && built >= 1920) return { steel: "#a4a8ac", girder: "#4e6a48" };
  return { steel: built >= 1890 ? "#5a6470" : "#3e3e46", girder: "#4a4440" };
}

/** -1 not yet built, 0 open, 1 open with lamps, 2 closed and boarded up */
function portalState(p: Portal, year: number): number {
  if (year < p.t.opened) return -1;
  if (p.t.closed !== undefined && year > p.t.closed) return 2;
  return p.t.kind === "road" || year >= 1920 ? 1 : 0;
}

/** draw natural river banks along the smooth shoreline (core/shore) rather than the tile edges */
export let SMOOTH_SHORE = true;
/** a ground shader's flag on a colour: draw it at full light whatever the slope (river water on a bank tile) */
const UNLIT = 0x1000000;
export function setSmoothShore(on: boolean) { SMOOTH_SHORE = on; }

/** open water `d` tiles out from the shoreline: deep blue with ripples, a shallow band and a broken line of foam at the edge */
function waterPx(d: number, gx: number, gy: number): number {
  if (d < 0.045 && hash(gx, gy, 5) < 0.4) return 0x9cc0d4;
  if (d < 0.13 + hash(gx >> 2, gy >> 2, 28) * 0.04) return 0x3f7598;
  const r = hash(gx >> 2, gy, 4);
  if (r > 0.97 && (gx & 3) < 3) return 0x6f9cc0;
  return pick(WATER, hash(gx >> 2, gy >> 1, 3));
}
/** the bank `-d` tiles in from the shoreline: wet mud at the waterline, then a ragged strip of sand or gravel, then `ground` */
function bankPx(d: number, gx: number, gy: number, ground = -1): number {
  if (d > -0.07) return pick(PAL.wet, hash(gx, gy, 25));
  if (d > -0.2 - hash(gx >> 2, gy >> 2, 27) * 0.1 || ground < 0) return pick(PAL.sand, hash(gx, gy, 26));
  return ground;
}

// 8 neighbour directions (dx, dy)
/** a roadway's surface by era: 0 packed dirt, 1 Belgian block, 2 brick, 3 asphalt (with a centre line from 1940) */
function paving(pave: number, gx: number, gy: number, ds: number, roadW: number, along: number): number {
  if (pave === 0) return hash(gx, gy, 29) < 0.12 ? 0x7a6a4e : 0x8e7c5a;
  if (pave === 1) return (gx % 3 === 0 || gy % 2 === 0) ? 0x5e5a54 : hash(gx >> 1, gy >> 1, 28) < 0.5 ? 0x8a867e : 0x7a766e;
  if (pave === 2) return (gy % 3 === 0) ? 0x6a4c40 : ((gx + Math.floor(gy / 3) * 3) % 6 === 0) ? 0x70503f : hash(gx >> 2, gy >> 1, 33) < 0.5 ? 0x8a6250 : 0x7e5a4a;
  if (ds < 0.012 && (Math.floor(along * 7) & 1) && roadW > 0.15) return 0xd8d0a8;
  const r = hash(gx, gy, 34);
  return r < 0.06 ? 0x3a3a3e : hash(gx >> 3, gy >> 2, 35) < 0.12 ? 0x4e4c4a : 0x46464a;
}
/** worn ground between city buildings: bare earth, cinders and tufts of grass */
function trodden(gx: number, gy: number): number {
  const r = hash(gx, gy, 38);
  return r < 0.08 ? 0x4e4a40 : hash(gx >> 1, gy >> 1, 39) < 0.3 ? 0x6e7a40 : r < 0.55 ? 0x7a6c56 : 0x6e6250;
}
/** sidewalk: flagstone / brick pavers (concrete reads the same at this size), with a joint every few px */
function sidewalk(gx: number, gy: number): number {
  return (gx % 4 === 0 || gy % 3 === 0) ? 0x8e887a : hash(gx >> 2, gy >> 1, 36) < 0.5 ? 0xb4ac9a : 0xa8a090;
}

const N8: [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];

export class Renderer {
  private base: Map<string, Sprite>;
  private scaled = new Map<string, SpriteBuf>();
  private chunks = new Map<string, Chunk>();
  private chunkHeights: Float32Array; // min,max per chunk
  private ncx: number;
  private ncy: number;
  private bridgeAxis = new Map<number, "a" | "b">();
  private rivalIndustry = new Map<number, IndustryId>();
  private plants = new Map<number, PlantRef>();
  private emitters: LiveEmitter[] = [];
  /** per emitter group: whose works it is, and its smoke look this season (recomputed once a season) */
  private emitterOwners: EmitterOwner[] = [];
  private looks: SmokeLook[] = [];
  private looksKey = "";
  private plantsKey = "";
  /** generated sprites by key (Map order = recency), and their total bytes */
  private gen = new Map<string, GenSprite>();
  private genBytes = 0;
  /** generated sprites built so far (a rising count while standing still means the budget is too small) */
  built = 0;
  /** the raster scale in use, the one before it, and when it changed */
  private curScale = 0;
  private prevScale = 0;
  private scaleAt = 0;
  private budgetPx = BUDGET_MIN_PX;
  pending = 0;

  constructor(private map: GameMap) {
    this.base = buildSprites();
    for (const [k, sp] of clutterSprites()) this.base.set(k, sp);
    this.ncx = Math.ceil(map.width / CS);
    this.ncy = Math.ceil(map.height / CS);
    this.chunkHeights = new Float32Array(this.ncx * this.ncy * 2);
    this.updateHeights();
    // bridge orientation from the extent of each bridge's tiles
    const ext = new Map<number, number[]>();
    for (let i = 0; i < map.bridge.length; i++) {
      const b = map.bridge[i];
      if (!b) continue;
      const x = i % map.width, y = (i / map.width) | 0;
      const e = ext.get(b) ?? [x, x, y, y];
      e[0] = Math.min(e[0], x); e[1] = Math.max(e[1], x); e[2] = Math.min(e[2], y); e[3] = Math.max(e[3], y);
      ext.set(b, e);
    }
    for (const [b, e] of ext) this.bridgeAxis.set(b, e[1] - e[0] >= e[3] - e[2] ? "a" : "b");
  }

  /** call after terrain heights change (grading) */
  /** bumped when the terrain is regraded, so the hills' shadows are worked out again */
  heightsVersion = 0;
  /** 0 day … 1 full night, set by the caller before draw() (v0.31: the shadow layer fades with it) */
  night = 0;
  private slagN = 0;
  updateHeights() {
    this.heightsVersion++;
    const m = this.map, V = m.width + 1;
    for (let cy = 0; cy < this.ncy; cy++) for (let cx = 0; cx < this.ncx; cx++) {
      let lo = Infinity, hi = -Infinity;
      for (let y = cy * CS; y <= Math.min(m.height, cy * CS + CS); y++) for (let x = cx * CS; x <= Math.min(m.width, cx * CS + CS); x++) {
        const h = m.vert[y * V + x];
        if (h < lo) lo = h;
        if (h > hi) hi = h;
      }
      const k = (cy * this.ncx + cx) * 2;
      this.chunkHeights[k] = lo;
      this.chunkHeights[k + 1] = hi;
    }
  }

  worldBounds() {
    const m = this.map;
    return {
      left: -m.height * HW - 100,
      right: m.width * HW + 100,
      top: -(m.maxHeight - BASE_M) * ZPX - PAD_TOP,
      bottom: (m.width + m.height) * HH + 200,
    };
  }

  /** v0.31: the season's look for this frame (0 green, 1 autumn, 2 winter) and the recoloured sprites for it */
  private look: SeasonLook = 0;
  private seasonal = new Map<string, SpriteBuf | null>();
  private sprite(key: string, s: number): SpriteBuf | null {
    const b = this.spriteRaw(key, s);
    if (!b || this.look === 0) return b;
    const k = `${key}@${s}`;
    let v = this.seasonal.get(k);
    if (v === undefined) {
      if (this.seasonal.size > 6000) this.seasonal.clear();
      v = seasonSprite(key, b, this.look);
      this.seasonal.set(k, v);
    }
    return v ?? b;
  }
  private spriteRaw(key: string, s: number): SpriteBuf | null {
    // houses and plants are generated per variant: kept in a byte-budgeted LRU
    if (key.charCodeAt(1) === 124 && (key.startsWith("H|") || key.startsWith("P|") || key.startsWith("T|"))) {
      let e = this.gen.get(key);
      if (e) { this.gen.delete(key); this.gen.set(key, e); }
      else {
        const sp = cropSprite(key.startsWith("H|") ? buildHouse(key) : key.startsWith("T|") ? buildPortal(key) : buildPlant(key));
        this.built++;
        e = { sp, bufs: new Map(), bytes: sp.canvas.width * sp.canvas.height * 4 };
        this.gen.set(key, e);
        this.genBytes += e.bytes;
      }
      let b = e.bufs.get(s);
      if (!b) {
        b = scaleSprite(e.sp, s);
        e.bufs.set(s, b);
        e.bytes += b.px.byteLength; this.genBytes += b.px.byteLength;
      }
      if (this.genBytes > GEN_BUDGET_BYTES) this.trimGenerated(key);
      return b;
    }
    const k = `${key}@${s}`;
    let b = this.scaled.get(k);
    if (!b) {
      const sp = this.base.get(key);
      if (!sp) return null;
      b = scaleSprite(sp, s);
      this.scaled.set(k, b);
    }
    return b;
  }

  /** drop the least recently used generated sprites until under budget (never the one just asked for) */
  private trimGenerated(keep: string) {
    for (const [k, e] of this.gen) {
      if (this.genBytes <= GEN_BUDGET_BYTES * 0.85) break;
      if (k === keep) continue;
      this.gen.delete(k);
      this.genBytes -= e.bytes;
    }
  }

  /** the zoom changed: keep scaled buffers for this scale and the last one only */
  private setScale(s: number) {
    if (s === this.curScale) return;
    this.prevScale = this.curScale; this.curScale = s; this.scaleAt = performance.now();
    const keep = (x: number) => x === s || x === this.prevScale;
    for (const k of [...this.scaled.keys()]) if (!keep(Number(k.slice(k.lastIndexOf("@") + 1)))) this.scaled.delete(k);
    for (const e of this.gen.values()) for (const [x, b] of e.bufs) if (!keep(x)) { e.bufs.delete(x); e.bytes -= b.px.byteLength; this.genBytes -= b.px.byteLength; }
  }

  /** memory held by the caches, for profiling (bytes) */
  memory() {
    let scaled = 0, chunks = 0;
    for (const b of this.scaled.values()) scaled += b.px.byteLength;
    for (const c of this.chunks.values()) chunks += c.px * 4;
    return { built: this.built, generated: this.genBytes, generatedCount: this.gen.size, scaled, scaledCount: this.scaled.size, chunks, chunkCount: this.chunks.size, chunkBudget: this.budgetPx * 4 };
  }

  /** Resolve every plant's layout (player + rivals) for this world state. */
  private updatePlants(g: GameState) {
    const c = g.company;
    // only what the plant drawings depend on: layout, status, how full the yards are, and the year (soot, rival tech)
    const fillOf = (co: NonNullable<typeof c>) => Math.min(2, Math.round(((co.lastSeason?.produced ?? 0) / INDUSTRIES[co.industry].baseCapacity) * 2));
    const extra = c ? [...c.others.map((w) => `${w.id}:${w.x},${w.y}:${w.techs.length}:${w.status}:${w.research?.id ?? ""}`), ...c.annexes.map((a) => `${a.kind}${a.x},${a.y}`), c.research?.id ?? ""].join(";") : "";
    const key = `${c ? `${c.x},${c.y},${c.industry}` : ""}|${c?.status}|${c?.techs.join(",")}|${c ? fillOf(c) : 0}|${g.rivals.length}|${g.rivals.filter((r) => r.owned).length}|${g.rivals.map((r) => `${r.closed ? 1 : 0}${(r.strikeUntil ?? 0) > g.turn ? 1 : 0}`).join("")}|${extra}|${g.world.year}`;
    if (key === this.plantsKey) return;
    this.plantsKey = key;
    this.plants.clear();
    this.emitters = [];
    this.emitterOwners = [];
    this.looksKey = "";
    const m = this.map;
    const add = (x0: number, y0: number, fp: number, ctx: PlantCtx, running: boolean, years: number, annex = false, owner: EmitterOwner = { rival: "" }) => {
      const group = this.emitterOwners.push(owner) - 1;
      const lay = annex ? layoutAnnex(ctx) : layoutPlant(ctx);
      for (let ly = 0; ly < fp; ly++) for (let lx = 0; lx < fp; lx++) {
        const t = lay[ly * fp + lx];
        const x = x0 + lx, y = y0 + ly;
        if (x >= m.width || y >= m.height) continue;
        this.plants.set(y * m.width + x, { t, c: ctx, years });
        for (const e of emittersFor(t.part)) {
          const h = m.elevation[y * m.width + x];
          const [wx, wy] = project(x + e.u, y + e.v, h);
          this.emitters.push({ ...e, wx, wy: wy - e.z, seed: (x * 31 + y * 17 + Math.round(e.u * 40) * 7 + Math.round(e.v * 40) * 3) % 997, running, group });
        }
      }
    };
    if (c) {
      const capacity = INDUSTRIES[c.industry].baseCapacity;
      const fill = Math.min(2, Math.round(((c.lastSeason?.produced ?? 0) / capacity) * 2));
      add(c.x, c.y, c.footprint, { ind: c.industry, techs: c.techs, fp: c.footprint, side: c.riverSide, owner: "p", status: c.status, fill, research: c.research?.id },
        c.status === "running" || c.status === "flooded", c.seasonsOperating / 4, false, { works: c });
      c.annexes.filter((a) => a.kind === "expand").forEach((a, wing) =>
        add(a.x, a.y, a.fp, { ind: c.industry, techs: c.techs, fp: a.fp, side: c.riverSide, owner: "p", status: c.status, fill, wing }, c.status === "running", (g.world.year - a.year) * 1, true, { works: c }));
      for (const w of c.others)
        add(w.x, w.y, w.footprint, { ind: w.industry, techs: w.techs, fp: w.footprint, side: w.riverSide, owner: "p", status: w.status, fill: w.status === "running" ? fillOf(w as never) : 0, research: w.research?.id },
          w.status === "running" || w.status === "flooded", g.world.year - w.founded + (w.fromRival ? 10 : 0), false, { works: w });
    }
    for (const r of g.rivals) {
      const def = RIVALS.find((d) => d.id === r.id);
      if (!def) continue;
      this.rivalIndustry.set(r.ownerId, def.industry);
      if (r.owned) continue;
      // Homestead, 1892: the lockout at the Frick/Carnegie works
      const status = (r.strikeUntil ?? 0) > g.turn ? "strike" : r.closed || rivalRunning(def, g.world.year) === 0 || (def.opens !== undefined && g.world.year < def.opens) ? "idle" : "running";
      add(r.x, r.y, r.footprint, { ind: def.industry, techs: techsForYear(def.industry, g.world.year), fp: r.footprint, side: r.riverSide, owner: r.id, status, fill: status === "running" ? 1 : 0 },
        status === "running", g.world.year - def.entryYear, false, { rival: r.id });
    }
  }

  /**
   * Each works' smoke look for the season (year, waste policy, how hard it ran, layoffs): computed once per
   * emitter group when the season, the policy or the plants change, not per frame.
   */
  private updateLooks(g: GameState) {
    const c = g.company;
    const key = `${this.plantsKey}|${g.turn}|${c?.biz.policy.waste}|${c ? c.biz.layoffUntil > g.turn : ""}`;
    if (key === this.looksKey) return;
    this.looksKey = key;
    this.looks = this.emitterOwners.map((o) => ("works" in o ? smokeLook(g, o.works) : rivalLook(g, o.rival)));
  }

  // ------------------------------------------------------------ frame
  /** Draw the view. Returns true if more chunks still need rendering (call again next frame). */
  draw(ctx: CanvasRenderingContext2D, cam: Camera, g: GameState, view: ViewOptions, marks: Marks): boolean {
    const cw = ctx.canvas.width, ch = ctx.canvas.height;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = "#1b1d22";
    ctx.fillRect(0, 0, cw, ch);
    ctx.imageSmoothingEnabled = false;
    placeLabelRects.length = 0;
    if ((g.world.slagN ?? 0) !== this.slagN) { this.slagN = g.world.slagN ?? 0; this.updateHeights(); }
    const look = DETAIL > 0 && SEASONS ? seasonLook(g.turn) : 0;
    if (look !== this.look) { this.look = look; this.seasonal.clear(); }
    this.updatePlants(g);

    const s = Math.min(1, cam.zoom);
    this.setScale(s);
    const k = cam.zoom / s; // extra pixel scaling for zoom > 1
    const tail = `|${view.overlayKey}|${view.grid}|r${RELIEF}|d${DETAIL}|s${this.look}`;
    const vis: { cx: number; cy: number; d: number }[] = [];
    const vx0 = cam.x, vy0 = cam.y, vx1 = cam.x + cw / cam.zoom, vy1 = cam.y + ch / cam.zoom;
    const midx = (vx0 + vx1) / 2, midy = (vy0 + vy1) / 2;
    for (let cy = 0; cy < this.ncy; cy++) for (let cx = 0; cx < this.ncx; cx++) {
      const x0 = cx * CS, y0 = cy * CS;
      const left = (x0 - (y0 + CS)) * HW - PAD_X, right = (x0 + CS - y0) * HW + PAD_X;
      if (right < vx0 || left > vx1) continue;
      const hk = (cy * this.ncx + cx) * 2;
      const top = (x0 + y0) * HH - (this.chunkHeights[hk + 1] - BASE_M) * ZPX - PAD_TOP;
      const bottom = (x0 + y0 + 2 * CS) * HH - (this.chunkHeights[hk] - BASE_M) * ZPX + 400;
      if (bottom < vy0 || top > vy1) continue;
      const ccx = (x0 - y0) * HW, ccy = (x0 + y0 + CS) * HH;
      vis.push({ cx, cy, d: Math.hypot(ccx - midx, ccy - midy) });
    }

    // render missing / stale chunks, nearest first, within the frame budget
    const t0 = performance.now();
    let missing = 0, rendered = 0;
    for (const c of [...vis].sort((a, b) => a.d - b.d)) {
      const key = `${s}:${c.cx},${c.cy}`;
      const have = this.chunks.get(key);
      // each chunk re-renders only when what it shows has changed (dirty-chunk tracking by content signature)
      const version = this.chunkSig(g, c.cx, c.cy) + tail;
      if (have && have.key === version) continue;
      // a stale chunk waits for the next frame when this one wouldn't fit the budget (a zoom-1 chunk can
      // take 20–40 ms, so the check is on the expected cost, not just on the time already spent); a chunk
      // not drawn at all gets twice the budget before it waits
      const spent = performance.now() - t0;
      // at least one chunk is always rendered a frame, or a chunk dearer than the budget would never be redrawn
      if (have && rendered > 0 && spent + this.chunkMs > FRAME_MS) { missing++; continue; }
      if (!have && rendered > 0 && spent > FRAME_MS * 2) { missing++; continue; }
      rendered++;
      const c0 = performance.now();
      const ch2 = this.renderChunk(g, c.cx, c.cy, s, view, version);
      this.chunkMs = this.chunkMs * 0.7 + (performance.now() - c0) * 0.3;
      this.chunks.delete(key);
      this.chunks.set(key, ch2);
    }
    // the cache holds about three screens of chunks at this zoom
    let visPx = 0;
    for (const c of vis) visPx += this.chunks.get(`${s}:${c.cx},${c.cy}`)?.px ?? 0;
    this.budgetPx = Math.max(BUDGET_MIN_PX, Math.min(BUDGET_MAX_PX, visPx * 3), visPx * 1.3);
    this.evict(s);

    vis.sort((a, b) => (a.cx + a.cy) - (b.cx + b.cy) || a.cx - b.cx);
    // Upscaled zooms are nearest-neighbour (the flag is reset whenever the canvas is resized, and by
    // any save/restore elsewhere, so set it right before the blits). The camera offset is snapped to a
    // whole device pixel once, and each chunk's own offset separately, so neighbouring chunks keep a
    // fixed relationship while panning and the pixel grid doesn't shimmer at non-integer zooms (1.5×).
    ctx.imageSmoothingEnabled = false;
    const camX = Math.round(cam.x * cam.zoom), camY = Math.round(cam.y * cam.zoom);
    this.drawn = [];
    for (const c of vis) {
      const key = `${s}:${c.cx},${c.cy}`;
      const chn = this.chunks.get(key);
      if (!chn) {
        // v0.28: not drawn at this zoom yet (just zoomed or jumped): show the same chunk from another zoom,
        // scaled, rather than the bare background, until it's ready
        let alt: Chunk | undefined, as = 0;
        for (const z2 of ZOOMS) { const s2 = Math.min(1, z2); if (s2 === s || s2 === as) continue; const c2 = this.chunks.get(`${s2}:${c.cx},${c.cy}`); if (c2 && (!alt || Math.abs(Math.log(s2 / s)) < Math.abs(Math.log(as / s)))) { alt = c2; as = s2; } }
        if (alt) {
          const f = cam.zoom / as;
          ctx.imageSmoothingEnabled = f < 1;
          ctx.drawImage(alt.canvas, Math.round(alt.ox * f) - camX, Math.round(alt.oy * f) - camY, Math.round(alt.canvas.width * f), Math.round(alt.canvas.height * f));
          ctx.imageSmoothingEnabled = false;
        }
        continue;
      }
      this.chunks.delete(key);
      this.chunks.set(key, chn); // LRU touch
      const dx = Math.round(chn.ox * k) - camX, dy = Math.round(chn.oy * k) - camY;
      this.drawn.push({ c: chn, dx, dy, k });
      if (k === 1) ctx.drawImage(chn.canvas, dx, dy);
      else ctx.drawImage(chn.canvas, dx, dy, Math.round(chn.canvas.width * k), Math.round(chn.canvas.height * k));
      // the shadows, fading as the light goes (there are no sun shadows at night)
      if (chn.shade && this.night < 0.97) {
        ctx.globalAlpha = 1 - this.night;
        if (k === 1) ctx.drawImage(chn.shade, dx, dy);
        else ctx.drawImage(chn.shade, dx, dy, Math.round(chn.canvas.width * k), Math.round(chn.canvas.height * k));
        ctx.globalAlpha = 1;
      }
    }

    this.drawMarks(ctx, cam, marks);
    this.pending = missing;
    return missing > 0;
  }

  /** running estimate of one chunk's raster time at the current zoom, ms */
  private chunkMs = 10;

  /** the chunks blitted this frame and where (front to back is the end of the list) */
  private drawn: { c: Chunk; dx: number; dy: number; k: number }[] = [];

  /**
   * Is a point on the screen covered by something standing in front of tile depth `d` (a building, a plant, a
   * tree on a tile nearer the viewer)? Looks through this frame's chunks from the front.
   */
  occluded(sx: number, sy: number, d: number): boolean {
    const D = this.drawn;
    for (let n = D.length - 1; n >= 0; n--) {
      const e = D[n];
      const px = Math.floor((sx - e.dx) / e.k), py = Math.floor((sy - e.dy) / e.k);
      if (px < 0 || py < 0 || px >= e.c.w) continue;
      const i = py * e.c.w + px;
      if (i >= e.c.depth.length) continue;
      const v = e.c.depth[i];
      if (!v) continue;          // transparent here: a chunk further back may have drawn it
      return v >= 2 && v - 2 > d;
    }
    return false;
  }

  invalidateAll() {
    this.chunks.clear();
    this.sigs.clear();
  }

  private sigs = new Map<number, { stamp: string; sig: string }>();

  // ------------------------------------------------------------ tunnels
  private tunnelIdx: { portal: Map<number, Portal>; approach: Map<number, Portal>; near: Map<number, Portal> } | null = null;
  /** portal tiles and the tiles of their cuttings, by tile index */
  private tunnelTiles() {
    if (this.tunnelIdx) return this.tunnelIdx;
    const portal = new Map<number, Portal>(), approach = new Map<number, Portal>(), near = new Map<number, Portal>();
    for (const p of portals(this.map)) {
      portal.set(p.y * this.map.width + p.x, p);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) near.set((p.y + dy) * this.map.width + p.x + dx, p);
      for (const j of p.approach) if (!approach.has(j)) approach.set(j, p);
    }
    return (this.tunnelIdx = { portal, approach, near });
  }
  /** which tunnels touching a chunk are open/closed this year (so a chunk re-renders when one opens or closes) */
  private tunnelSig(cx: number, cy: number, year: number): string {
    let s = "";
    const x0 = cx * CS - 1, y0 = cy * CS - 1, x1 = cx * CS + CS, y1 = cy * CS + CS;
    for (const p of portals(this.map)) {
      if (p.x < x0 - 6 || p.x > x1 + 6 || p.y < y0 - 6 || p.y > y1 + 6) continue;
      s += portalState(p, year) + 1;
    }
    return s;
  }
  private portalKeyFor(p: Portal, year: number): string {
    const m = this.map, V = m.width + 1, x = p.x, y = p.y;
    const hT = m.vert[y * V + x], hR = m.vert[y * V + x + 1], hL = m.vert[(y + 1) * V + x], hB = m.vert[(y + 1) * V + x + 1];
    const hc = (hT + hR + hL + hB) / 4;
    const q = (h: number) => Math.max(-80, Math.min(100, Math.round(((h - hc) * ZPX) / 3) * 3));
    const st = portalState(p, year);
    const t = p.t;
    return portalKey({
      look: t.look, bores: t.bores, face: p.face, kind: t.kind, g: [q(hT), q(hR), q(hB), q(hL)],
      state: st === 2 ? 2 : st === 1 ? 1 : 0,
      H: Math.round((t.kind === "trolley" ? 10 : t.bores === 2 ? 13 : 12) * ZPX),
    });
  }
  private ws: [number, number, number] = [0, 0, 0];

  /**
   * A signature of everything a chunk's pixels depend on: the tiles in it and one tile around it
   * (streets and rows look at their neighbours), quantized the way the renderer quantizes them.
   * Cached per world version, so it's computed once per chunk per turn.
   */
  private chunkSig(g: GameState, cx: number, cy: number): string {
    const w = g.world, m = this.map, W = m.width;
    const stamp = `${w.version}|${this.plantsKey}`;
    const id = cy * this.ncx + cx;
    const hit = this.sigs.get(id);
    if (hit && hit.stamp === stamp) return hit.sig;
    let h1 = 0x811c9dc5 | 0, h2 = 0x1b873593 | 0, plant = false, rails = 0;
    const lix = lineIndex(m);
    const mix = (v: number) => { h1 = Math.imul(h1 ^ v, 0x01000193); h2 = Math.imul(h2 ^ v, 0x5bd1e995) ^ (h2 >>> 15); };
    const x0 = Math.max(0, cx * CS - 1), y0 = Math.max(0, cy * CS - 1);
    const x1 = Math.min(W - 1, cx * CS + CS), y1 = Math.min(m.height - 1, cy * CS + CS);
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const i = y * W + x;
      const p = w.pollution[i];
      mix(w.use[i] | (w.sub[i] << 5) | (w.street[i] << 10) | ((w.pop[i] > 0 ? 1 : 0) << 14) | (w.structure[i] << 15) | (w.eth[i] << 24));
      if (((x | y) & 7) === 0) mix(w.kit[(y >> 3) * Math.ceil(W / 8) + (x >> 3)] + 7919);
      if (w.slag?.[i]) mix(w.slag[i] * 7919 + 13);
      mix(w.built[i] | ((p < 0.15 ? 0 : p < 0.4 ? 1 : p < 0.5 ? 2 : p < 1.2 ? 3 : 4) << 12) | (Math.min(8, Math.floor(p * 6)) << 16) | (w.owner[i] << 20));
      if (this.plants.has(i)) plant = true;
      if (m.rail[i] && (m.railLines[String(m.rail[i])]?.year ?? 9999) <= w.year) rails++;
      const vs = lix.get(i);
      if (vs) for (const sg of vs) if (sg.kind === "rail" && (m.railLines[String(sg.line)]?.year ?? 9999) <= w.year) rails += 64;
    }
    for (const b of g.company?.holdings?.biz ?? []) if (b.x >= x0 && b.x <= x1 && b.y >= y0 && b.y <= y1) mix(b.y * W + b.x + b.id.length * 131071);
    // year-gated looks: gas → electric lamps and timber → concrete steps in 1910
    const sig = `${(h1 >>> 0).toString(36)}${(h2 >>> 0).toString(36)}|${rails}|${w.year >= 1910 ? 1 : 0}${[1865, 1885, 1890, 1900, 1905, 1915, 1925, 1935, 1940].filter((y) => w.year >= y).length}|${plant ? this.plantsKey : ""}|${this.tunnelSig(cx, cy, w.year)}`;
    this.sigs.set(id, { stamp, sig });
    return sig;
  }

  private evict(s: number) {
    let total = 0;
    const old = performance.now() - this.scaleAt > OTHER_ZOOM_MS, prefix = `${s}:`;
    // a dropped chunk's canvas is emptied as well as forgotten: the browser frees a canvas's pixels lazily,
    // and a zoom burst could hold hundreds of megabytes of them until it got round to it
    const drop = (k: string, c: Chunk) => { this.chunks.delete(k); c.canvas.width = 0; c.canvas.height = 0; };
    for (const [k, c] of this.chunks) {
      // a zoom you left a few seconds ago: its chunks go
      if (old && !k.startsWith(prefix)) { drop(k, c); continue; }
      total += c.px;
    }
    for (const [k, c] of this.chunks) {
      if (total <= this.budgetPx) break;
      drop(k, c);
      total -= c.px;
    }
  }

  // ------------------------------------------------------------ chunk rasterization
  private renderChunk(g: GameState, cx: number, cy: number, s: number, view: ViewOptions, version: string): Chunk {
    const m = this.map, w = g.world, W = m.width, H = m.height, V = W + 1;
    const x0 = cx * CS, y0 = cy * CS, x1 = Math.min(W, x0 + CS), y1 = Math.min(H, y0 + CS);
    const hk = (cy * this.ncx + cx) * 2;
    const lo = this.chunkHeights[hk], hi = this.chunkHeights[hk + 1];
    const edge = x1 === W || y1 === H;
    const skirtBottom = m.minHeight - 14;
    const ox = Math.floor(((x0 - y1) * HW - PAD_X) * s);
    const oy = Math.floor(((x0 + y0) * HH - (hi - BASE_M) * ZPX - PAD_TOP) * s);
    const ex = Math.ceil(((x1 - y0) * HW + PAD_X) * s);
    const ey = Math.ceil(((x1 + y1) * HH - ((edge ? skirtBottom : lo) - BASE_M) * ZPX + 12) * s);
    const cw = Math.max(1, ex - ox), ch = Math.max(1, ey - oy);
    const buf = new Uint32Array(cw * ch);
    const depth = new Uint16Array(cw * ch);
    // v0.31: which diagonal row of tiles drew each ground pixel (+1), so sprites can be drawn after all the ground
    // (the cast-shadow pass lies between) and still be hidden by the ground of nearer tiles on a hill
    const gdep = new Uint16Array(cw * ch);
    // v0.31 (High, closer zooms): which pixels are open water, for the daytime reflections
    const wmask = DETAIL >= 2 && s >= 0.5 && !view.overlay ? new Uint8Array(cw * ch) : null;
    let triWater = false;
    // v0.31: how much each pixel is shaded (hills, cast shadows, a sprite in a hill's shadow), 0..255, drawn as its
    // own layer over the chunk so the shadows can fade out at night
    const shadeA = DETAIL >= 1 && !view.overlay ? new Uint8Array(cw * ch) : null;
    let objDepth = 1;
    const year = w.year;
    const pxu = 1 / (HW * s * 1.2); // ~ uv units per pixel

    const P = (fx: number, fy: number, h: number): [number, number] => {
      const [sx, sy] = project(fx, fy, h);
      return [sx * s - ox, sy * s - oy];
    };
    const railActive = (i: number) => m.rail[i] > 0 && (m.railLines[String(m.rail[i])]?.year ?? 9999) <= year;

    // --- triangle rasterizer: flat light, per-pixel texture
    const tri = (
      ax: number, ay: number, bx: number, by: number, qx: number, qy: number,
      au: number, av: number, ah: number, bu: number, bv: number, bh: number, qu: number, qv: number, qh: number,
      light: number, tex: (u: number, v: number, h: number, gx: number, gy: number) => number, tint: number, tintA: number,
      sa = 1, sb = 1, sq = 1, gd = 0,
    ) => {
      const minX = Math.max(0, Math.floor(Math.min(ax, bx, qx))), maxX = Math.min(cw - 1, Math.ceil(Math.max(ax, bx, qx)));
      const minY = Math.max(0, Math.floor(Math.min(ay, by, qy))), maxY = Math.min(ch - 1, Math.ceil(Math.max(ay, by, qy)));
      const area = (bx - ax) * (qy - ay) - (by - ay) * (qx - ax);
      if (Math.abs(area) < 1e-9) return;
      const inv = 1 / area;
      const tr = (tint >> 16) & 255, tg = (tint >> 8) & 255, tb = tint & 255;
      for (let py = minY; py <= maxY; py++) {
        const yy = py + 0.5;
        for (let px = minX; px <= maxX; px++) {
          const xx = px + 0.5;
          const w0 = ((bx - xx) * (qy - yy) - (by - yy) * (qx - xx)) * inv;
          const w1 = ((qx - xx) * (ay - yy) - (qy - yy) * (ax - xx)) * inv;
          const w2 = 1 - w0 - w1;
          if (w0 < -1e-4 || w1 < -1e-4 || w2 < -1e-4) continue;
          const u = w0 * au + w1 * bu + w2 * qu, v = w0 * av + w1 * bv + w2 * qv, h = w0 * ah + w1 * bh + w2 * qh;
          let c = tex(u, v, h, px + ox, py + oy);
          if (wmask && (triWater || c & UNLIT) && (c & 255) > ((c >> 16) & 255) + 25) wmask[py * cw + px] = 1;
          // water drawn over the corner of a sloping bank tile is lit like the river, not like the slope
          const sh = w0 * sa + w1 * sb + w2 * sq;
          // v0.31: shadow goes to its own layer (so it can fade at night); without one it's multiplied in
          let k = (c & UNLIT ? (shadeA ? 1 : 1 - (1 - sh) * 0.5) : shadeA ? light : light * sh) + BAYER[((py & 3) << 2) | (px & 3)] * 0.07;
          if (shadeA) shadeA[py * cw + px] = sh >= 1 ? 0 : Math.round((1 - sh) * (c & UNLIT ? 128 : 255));
          c &= 0xffffff;
          k = Math.round(k * 14) / 14;
          let r = ((c >> 16) & 255) * k, gg = ((c >> 8) & 255) * k, b = (c & 255) * k;
          if (tintA > 0) { r += (tr - r) * tintA; gg += (tg - gg) * tintA; b += (tb - b) * tintA; }
          buf[py * cw + px] = 0xff000000 | (Math.min(255, b) << 16) | (Math.min(255, gg) << 8) | Math.min(255, r);
          depth[py * cw + px] = 1;
          gdep[py * cw + px] = gd;
        }
      }
    };

    const blit = (key: string, fx: number, fy: number, hOff = 0, dLim = 65535, mul = 1) => {
      const sb = this.sprite(key, s);
      if (!sb) return;
      const mr = Math.round(mul * 256);
      const tx = Math.min(W - 1, Math.floor(fx)), ty = Math.min(H - 1, Math.floor(fy));
      const u = fx - tx, v = fy - ty;
      const a = m.vert[ty * V + tx], b = m.vert[ty * V + tx + 1], c = m.vert[(ty + 1) * V + tx], d = m.vert[(ty + 1) * V + tx + 1];
      const h = (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v + hOff;
      const [sx, sy] = P(fx, fy, h);
      const dx = Math.round(sx - sb.ax), dy = Math.round(sy - sb.ay);
      for (let yy = 0; yy < sb.h; yy++) {
        const by_ = dy + yy;
        if (by_ < 0 || by_ >= ch) continue;
        const row = yy * sb.w, drow = by_ * cw;
        for (let xx = 0; xx < sb.w; xx++) {
          const bx_ = dx + xx;
          if (bx_ < 0 || bx_ >= cw) continue;
          let p = sb.px[row + xx];
          const al = p >>> 24;
          if (!al) continue;
          if (gdep[drow + bx_] > dLim) continue; // the ground of a nearer tile (a hill) is in front
          if (shadeA) { if (al >= 128) shadeA[drow + bx_] = 256 - mr; }
          else if (mr < 256) p = (p & 0xff000000) | ((((p >> 16) & 255) * mr >> 8) << 16) | ((((p >> 8) & 255) * mr >> 8) << 8) | ((p & 255) * mr >> 8);
          if (al >= 128) depth[drow + bx_] = objDepth;
          if (al === 255 || !sb.soft) { buf[drow + bx_] = p | 0xff000000; continue; }
          const q = buf[drow + bx_], f = al / 255;
          const r = (q & 255) + ((p & 255) - (q & 255)) * f;
          const gg = ((q >> 8) & 255) + (((p >> 8) & 255) - ((q >> 8) & 255)) * f;
          const bb = ((q >> 16) & 255) + (((p >> 16) & 255) - ((q >> 16) & 255)) * f;
          buf[drow + bx_] = 0xff000000 | (bb << 16) | (gg << 8) | r;
        }
      }
    };

    // light: from screen-left and above (faces toward -x and +y are lit)
    const L = [-0.6, 0.6, 1.0];
    const LN = Math.hypot(L[0], L[1], L[2]);
    const lightOf = (nx: number, ny: number, nz: number) => {
      const d = (nx * L[0] + ny * L[1] + nz * L[2]) / (Math.hypot(nx, ny, nz) * LN);
      return 0.42 + 0.78 * Math.max(0, d);
    };
    const MPT = m.metersPerTile;
    const SHADE_K = Math.sqrt(RELIEF);

    const tilesD = (x1 - x0) + (y1 - y0) - 1;
    // v0.31 light: hill shadows and occlusion per vertex (Med and High), cast shadows of sprites (High)
    const TL = DETAIL >= 1 ? terrainLight(m, this.heightsVersion) : null;
    const vshade = (j: number, water: boolean) => TL ? 1 - (TL.shadow[j] * 0.34 + TL.ao[j] * 0.2) * (water ? 0.6 : 1) : 1;
    const placed: { key: string; fx: number; fy: number; h: number; d: number; od: number; mul: number }[] = [];
    for (let d = 0; d < tilesD; d++) {
      for (let tx = Math.max(x0, x0 + d - (y1 - y0 - 1)); tx <= Math.min(x1 - 1, x0 + d); tx++) {
        const ty = y0 + d - (tx - x0);
        const i = ty * W + tx;
        const hT = m.vert[ty * V + tx], hR = m.vert[ty * V + tx + 1], hL = m.vert[(ty + 1) * V + tx], hB = m.vert[(ty + 1) * V + tx + 1];
        const [Tx, Ty] = P(tx, ty, hT), [Rx, Ry] = P(tx + 1, ty, hR), [Lx, Ly] = P(tx, ty + 1, hL), [Bx, By] = P(tx + 1, ty + 1, hB);
        let tex = this.groundShader(g, tx, ty, i, pxu, view.grid, railActive);
        if (DETAIL > 0 && m.terrain[i] === Terrain.Water) tex = withCurrent(tex, riverAxis(m, tx, ty));
        if (this.look) {
          let bank = false;
          if (m.terrain[i] === Terrain.Water) for (const [dx, dy] of N8) { const nx = tx + dx, ny = ty + dy; if (nx >= 0 && ny >= 0 && nx < W && ny < m.height && m.terrain[ny * W + nx] !== Terrain.Water) { bank = true; break; } }
          const land = (dx: number, dy: number) => { const nx = tx + dx, ny = ty + dy; return nx >= 0 && ny >= 0 && nx < W && ny < m.height && m.terrain[ny * W + nx] !== Terrain.Water; };
          const lW = land(-1, 0), lE = land(1, 0), lN = land(0, -1), lS = land(0, 1);
          const corners: [number, number][] = [];
          if (land(-1, -1)) corners.push([0, 0]); if (land(1, -1)) corners.push([1, 0]); if (land(-1, 1)) corners.push([0, 1]); if (land(1, 1)) corners.push([1, 1]);
          const shoreD = (u: number, v: number) => {
            let d = 9;
            if (lW) d = Math.min(d, u); if (lE) d = Math.min(d, 1 - u); if (lN) d = Math.min(d, v); if (lS) d = Math.min(d, 1 - v);
            for (const [cx, cy] of corners) d = Math.min(d, Math.hypot(u - cx, v - cy));
            return d;
          };
          tex = seasonGround(tex, this.look, { soot: Math.max(0, w.pollution[i] - 0.15), street: !!w.street[i], steep: m.terrain[i] === Terrain.Cliff, bank, shoreD });
        }
        let tint = 0, tintA = 0;
        const pol = w.pollution[i];
        if (pol > 0.02 && m.terrain[i] !== Terrain.Water) { tint = 0x2e2824; tintA = Math.min(0.55, pol * 0.35); }
        if (view.overlay) {
          const o = view.overlay(i);
          // wash the ground out to a neutral grey so the data colours stand apart from grass and brick
          if (o) { tint = rgb(o[0], o[1], o[2]); tintA = o[3]; }
          else if (m.terrain[i] === Terrain.Water) { tint = 0x40566e; tintA = 0.45; }
          else { tint = 0x8c8a86; tintA = 0.62; }
        }
        const isWater = m.terrain[i] === Terrain.Water;
        triWater = isWater;
        // shade by the slopes as drawn (stretched by the hill relief, eased so the far sides don't go black)
        const l1 = isWater ? 1 : lightOf(-MPT * (hR - hT) * SHADE_K, -MPT * (hL - hT) * SHADE_K, MPT * MPT);
        const l2 = isWater ? 1 : lightOf(MPT * (hL - hB) * SHADE_K, MPT * (hR - hB) * SHADE_K, MPT * MPT);
        const jT = ty * V + tx, sT = vshade(jT, isWater), sR = vshade(jT + 1, isWater), sL = vshade(jT + V, isWater), sB = vshade(jT + V + 1, isWater);
        const gd = tx + ty + 1;
        tri(Tx, Ty, Rx, Ry, Lx, Ly, 0, 0, hT, 1, 0, hR, 0, 1, hL, l1, tex, tint, tintA, sT, sR, sL, gd);
        tri(Lx, Ly, Rx, Ry, Bx, By, 0, 1, hL, 1, 0, hR, 1, 1, hB, l2, tex, tint, tintA, sL, sR, sB, gd);

        // map-edge skirt (diorama base)
        if (ty === H - 1 || tx === W - 1) {
          const sk = (ax: number, ay: number, bx: number, by: number, ha: number, hb: number, lit: number) => {
            const [a2x, a2y] = [ax, ay + (ha - skirtBottom) * ZPX * s], [b2x, b2y] = [bx, by + (hb - skirtBottom) * ZPX * s];
            const st = (_u: number, _v: number, hh: number, gx: number, gy: number) => {
              if (isWater && hh > ha - 4) return 0x24486a;
              const band = Math.floor(hh / 3) & 3;
              return [0x8a6a48, 0x7a5c3e, 0x94744e, 0x6e523a][band] + (hash(gx, gy, 9) < 0.1 ? 0x080808 : 0);
            };
            tri(ax, ay, bx, by, b2x, b2y, 0, 0, ha, 1, 0, hb, 1, 1, skirtBottom, lit, st, 0, 0);
            tri(ax, ay, b2x, b2y, a2x, a2y, 0, 0, ha, 1, 1, skirtBottom, 0, 1, skirtBottom, lit, st, 0, 0);
          };
          if (ty === H - 1) sk(Lx, Ly, Bx, By, hL, hB, 0.95);
          if (tx === W - 1) sk(Bx, By, Rx, Ry, hB, hR, 0.68);
        }

        // with a data overlay on, show the ground (SimCity-style data map): only bridges stay
        const sf = SMOOTH_SHORE && m.terrain[i] !== Terrain.Water ? shoreField(m) : null;
        for (const sp of this.tileSprites(g, tx, ty, i)) if (!view.overlay || sp.key.startsWith("bridge:")) {
          // no trees standing in the river where the smooth bank gave the corner of the tile to the water
          if (sf && sp.key.startsWith("tree:") && wetAt(sf, tx + sp.u, ty + sp.v, this.ws)[0] > 0.42) continue;
          // bridge decks count as ground (traffic runs on them); everything else stands in front of what's behind it
          const od = sp.key.startsWith("bridge:") ? 1 : 2 + Math.floor(tx + sp.u) + Math.floor(ty + sp.v);
          // a building or tree standing in a hill's shadow is shaded with it
          const mul = TL ? 1 - TL.shadow[jT + (sp.u > 0.5 ? 1 : 0) + (sp.v > 0.5 ? V : 0)] * 0.3 : 1;
          placed.push({ key: sp.key, fx: tx + sp.u, fy: ty + sp.v, h: sp.h ?? 0, d: gd, od, mul });
        }
      }
    }

    // cast shadows on the ground (High): each sprite's shadow is thrown screen-right (the sun is low in the south-west)
    if (DETAIL >= 2 && !view.overlay && placed.length) {
      const mask = new Uint8Array(cw * ch);
      // the tiles just off the chunk's screen-left edges throw their shadows into it too (they're cast, not drawn)
      const casters = placed.slice();
      for (let ty = y0; ty < Math.min(H, y1 + 4); ty++) for (let tx = Math.max(0, x0 - 4); tx < x1; tx++) {
        if (tx >= x0 && ty < y1) continue;
        const i = ty * W + tx;
        for (const sp of this.tileSprites(g, tx, ty, i)) casters.push({ key: sp.key, fx: tx + sp.u, fy: ty + sp.v, h: sp.h ?? 0, d: tx + ty + 1, od: 0, mul: 1 });
      }
      for (const pl of casters) {
        const kind = shadowKind(pl.key);
        if (!kind) continue;
        const sb = this.sprite(pl.key, s);
        if (!sb) continue;
        const sh = shadowShape(sb, kind);
        if (!sh) continue;
        const [sx, sy] = P(pl.fx, pl.fy, heightAt(m, pl.fx, pl.fy) + pl.h);
        const ax = Math.round(sx), ay = Math.round(sy);
        const R = sh.runs;
        for (let k = 0; k < R.length; k += 3) {
          const yy = ay + R[k];
          if (yy < 0 || yy >= ch) continue;
          const row = yy * cw;
          for (let xx = Math.max(0, ax + R[k + 1]); xx <= Math.min(cw - 1, ax + R[k + 2]); xx++) {
            const g2 = gdep[row + xx];
            // only on ground, and not up the face of a hill that stands in front of the sprite
            if (g2 && g2 <= pl.d + 2 && mask[row + xx] < 1) mask[row + xx] = 1;
          }
        }
        const C = sh.contact;
        for (let k = 0; k < C.length; k += 2) {
          const yy = ay + C[k], xx = ax + C[k + 1];
          if (yy < 0 || yy >= ch || xx < 0 || xx >= cw) continue;
          if (gdep[yy * cw + xx]) mask[yy * cw + xx] = 2;
        }
      }
      for (let p = 0; p < mask.length; p++) {
        const mk = mask[p];
        if (!mk) continue;
        const f = mk === 2 ? 150 : 172; // /256; a cool shadow, a darker line at the foot
        if (shadeA) { shadeA[p] = 255 - (((255 - shadeA[p]) * f) >> 8); continue; }
        const q = buf[p];
        const r = (q & 255) * f >> 8, gg = ((q >> 8) & 255) * f >> 8, b = Math.min(255, (((q >> 16) & 255) * (f + 14)) >> 8);
        buf[p] = 0xff000000 | (b << 16) | (gg << 8) | r;
      }
    }
    for (const pl of placed) { objDepth = pl.od; blit(pl.key, pl.fx, pl.fy, pl.h, pl.d, pl.mul); }

    // daytime reflections (High): the far bank and what stands on it, mirrored in the water below the shoreline,
    // rippled and fading with distance from the bank (the boats and bridges are drawn live and aren't reflected)
    if (wmask) {
      const fade = Math.round(56 * s);
      for (let px = 0; px < cw; px++) {
        let edge = -1;
        for (let py = 0; py < ch; py++) {
          const p = py * cw + px;
          if (!wmask[p] || depth[p] >= 2) { edge = buf[p] >>> 24 ? py : -1; continue; }
          if (edge < 0) continue;
          const k = py - edge;
          if (k > fade) continue;
          const sy = edge - k;
          if (sy < 0) continue;
          const sx = Math.min(cw - 1, Math.max(0, px + Math.round(Math.sin((py + ox) * 0.9 + (oy & 7)) * 1.2)));
          const q = buf[sy * cw + sx];
          if (!(q >>> 24)) continue;
          const f = 0.32 * (1 - k / fade);
          const c0 = buf[p];
          const r = (c0 & 255) * (1 - f) + (q & 255) * f * 0.8;
          const gg = ((c0 >> 8) & 255) * (1 - f) + ((q >> 8) & 255) * f * 0.85;
          const b = ((c0 >> 16) & 255) * (1 - f) + ((q >> 16) & 255) * f * 0.95;
          buf[p] = 0xff000000 | (Math.round(b) << 16) | (Math.round(gg) << 8) | Math.round(r);
        }
      }
    }

    const canvas = document.createElement("canvas");
    canvas.width = cw; canvas.height = ch;
    const c2 = canvas.getContext("2d")!;
    c2.putImageData(new ImageData(new Uint8ClampedArray(buf.buffer), cw, ch), 0, 0);
    let shade: HTMLCanvasElement | undefined;
    if (shadeA) {
      // a cool, dark blue at the shade's alpha: drawn over the chunk it multiplies the colour by (1 - alpha)
      const sb = new Uint32Array(cw * ch);
      let any = false;
      for (let p = 0; p < sb.length; p++) { const a = shadeA[p]; if (a && buf[p] >>> 24) { sb[p] = (a << 24) | 0x2a1c14; any = true; } }
      if (any) {
        shade = document.createElement("canvas");
        shade.width = cw; shade.height = ch;
        shade.getContext("2d")!.putImageData(new ImageData(new Uint8ClampedArray(sb.buffer), cw, ch), 0, 0);
      }
    }
    return { canvas, ox, oy, key: version, px: cw * ch * (shade ? 2 : 1), depth, w: cw, shade };
  }

  // ------------------------------------------------------------ ground textures
  private groundShader(g: GameState, x: number, y: number, i: number, pxu: number, grid: boolean, railActive: (i: number) => boolean) {
    const m = this.map, w = g.world, W = m.width, H = m.height;
    const t = m.terrain[i];
    const use = w.use[i];
    const at = (dx: number, dy: number) => {
      const nx = x + dx, ny = y + dy;
      return nx >= 0 && ny >= 0 && nx < W && ny < H ? ny * W + nx : -1;
    };
    // neighbour masks for linear features
    const mask = (f: (j: number) => boolean) => {
      let mk = 0;
      N8.forEach(([dx, dy], k) => { const j = at(dx, dy); if (j >= 0 && f(j)) mk |= 1 << k; });
      // drop diagonals already implied by orthogonal neighbours
      for (let k = 4; k < 8; k++) {
        const [dx, dy] = N8[k];
        const ox = N8.findIndex(([a, b]) => a === dx && b === 0), oy = N8.findIndex(([a, b]) => a === 0 && b === dy);
        if (mk & (1 << ox) || mk & (1 << oy)) mk &= ~(1 << k);
      }
      return mk;
    };
    const lineDist = (mk: number, u: number, v: number) => {
      // a plain 90° turn is drawn as a chamfer from edge-midpoint to edge-midpoint, so tile-by-tile
      // staircases (creeks, rails, streets running on the diagonal) read as straight 45° lines
      const L = lCorner(mk, true);
      if (L) {
        const [a, b] = orient(L, u, v);
        // segment (1, .5) → (.5, 1) in oriented coords
        let tt = ((a - 1) * -0.5 + (b - 0.5) * 0.5) / 0.5;
        tt = Math.max(0, Math.min(1, tt));
        return [Math.hypot(a - (1 - 0.5 * tt), b - (0.5 + 0.5 * tt)), tt * Math.SQRT1_2];
      }
      let best = Math.hypot(u - 0.5, v - 0.5);
      let along = 0;
      for (let k = 0; k < 8; k++) {
        if (!(mk & (1 << k))) continue;
        const [dx, dy] = N8[k];
        const ex = dx * 0.5, ey = dy * 0.5;
        const len2 = ex * ex + ey * ey;
        let tt = ((u - 0.5) * ex + (v - 0.5) * ey) / len2;
        tt = Math.max(0, Math.min(1, tt));
        const d = Math.hypot(u - 0.5 - ex * tt, v - 0.5 - ey * tt);
        if (d < best) { best = d; along = tt * Math.sqrt(len2); }
      }
      return [best, along];
    };

    /**
     * If the only orthogonal neighbours in `mk` are two perpendicular ones (an L), return their directions
     * (sx: +1 east / -1 west, sy: +1 south / -1 north). `strict`: no other neighbours at all (lines);
     * otherwise (shorelines) the two opposite sides must be clear.
     */
    function lCorner(mk: number, strict: boolean): [number, number] | null {
      const orth = mk & 15;
      if (strict && mk !== orth) return null;
      const sx = orth & 1 ? 1 : orth & 2 ? -1 : 0, sy = orth & 4 ? 1 : orth & 8 ? -1 : 0;
      if (!sx || !sy || (orth & 3) === 3 || (orth & 12) === 12) return null;
      return [sx, sy];
    }
    const orient = ([sx, sy]: [number, number], u: number, v: number) => [sx > 0 ? u : 1 - u, sy > 0 ? v : 1 - v];

    /** distance (uv) from (u,v) to the nearest edge/corner shared with a neighbour in `mk` (no diagonal suppression) */
    const rawMask = (f: (j: number) => boolean) => {
      let mk = 0;
      N8.forEach(([dx, dy], k) => { const j = at(dx, dy); if (j >= 0 && f(j)) mk |= 1 << k; });
      return mk;
    };
    const edgeDist = (mk: number, u: number, v: number) => {
      let d = 9;
      if (mk & 1) d = Math.min(d, 1 - u);
      if (mk & 2) d = Math.min(d, u);
      if (mk & 4) d = Math.min(d, 1 - v);
      if (mk & 8) d = Math.min(d, v);
      if (mk & 16) d = Math.min(d, Math.hypot(1 - u, 1 - v));
      if (mk & 32) d = Math.min(d, Math.hypot(1 - u, v));
      if (mk & 64) d = Math.min(d, Math.hypot(u, 1 - v));
      if (mk & 128) d = Math.min(d, Math.hypot(u, v));
      return d;
    };
    const water = t === Terrain.Water;

    if (water) {
      const landMask = rawMask((j) => m.terrain[j] !== Terrain.Water);
      const shoreL = lCorner(landMask, false);
      // a notch between two wharf tiles is filled with quay paving, so the quay runs on the 45° line too
      const quay = shoreL && [at(shoreL[0], 0), at(0, shoreL[1])].every((j) => j >= 0 && (m.special[j] === Special.Wharf || w.use[j] === Use.Wharf));
      const polluted = Math.min(8, Math.floor(w.pollution[i] * 6)) * 0.05; // stepped, so chunk signatures stay stable
      // a natural bank: the shoreline is the smooth curve through the staircase (core/shore), not the tile edges.
      // Quays and wharves keep their straight stone edges.
      const wharfNear = landMask && N8.some(([dx, dy]) => { const j = at(dx, dy); return j >= 0 && (m.special[j] === Special.Wharf || w.use[j] === Use.Wharf); });
      if (SMOOTH_SHORE && landMask && !wharfNear) {
        const sf = shoreField(m), ws: [number, number, number] = [0, 0, 0];
        return (u: number, v: number, _h: number, gx: number, gy: number) => {
          const d = shoreDist(wetAt(sf, x + u, y + v, ws));
          if (d < 0) return bankPx(d, gx, gy);
          let c = waterPx(d, gx, gy);
          if (polluted > 0) c = rgb(((c >> 16) & 255) * (1 - polluted) + 70 * polluted, ((c >> 8) & 255) * (1 - polluted) + 64 * polluted, (c & 255) * (1 - polluted) + 50 * polluted);
          return c;
        };
      }
      return (u: number, v: number, _h: number, gx: number, gy: number) => {
        let c = pick(WATER, hash(gx >> 2, gy >> 1, 3));
        const r = hash(gx >> 2, gy, 4);
        if (r > 0.97 && (gx & 3) < 3) c = 0x6f9cc0; // ripple
        if (landMask) {
          let dl = edgeDist(landMask, u, v);
          if (shoreL) {
            // a water tile poking out between two land sides: cut its corner into a 45° bank
            const [a, b] = orient(shoreL, u, v);
            const dc = (1.5 - a - b) * Math.SQRT1_2;
            if (dc < 0) {
              if (quay) return dc > -0.04 ? 0x4a463e : (gx % 3 === 0 || gy % 2 === 0) ? 0x5c5850 : hash(Math.floor(gx / 3) + ((Math.floor(gy / 2) & 1) ? 1 : 0), gy >> 1, 18) < 0.5 ? 0x8e8a80 : 0x7a766e;
              return dc > -0.06 ? pick(PAL.wet, hash(gx, gy, 25)) : pick(PAL.sand, hash(gx, gy, 26));
            }
            dl = Math.min(dl, dc);
          }
          if (dl < 0.05 && hash(gx, gy, 5) < 0.35) c = 0x9cc0d4;
          else if (dl < 0.14) c = 0x3f7598;
        }
        if (polluted > 0) c = rgb(((c >> 16) & 255) * (1 - polluted) + 70 * polluted, ((c >> 8) & 255) * (1 - polluted) + 64 * polluted, (c & 255) * (1 - polluted) + 50 * polluted);
        return c;
      };
    }

    // base ground by land use
    let base: (u: number, v: number, h: number, gx: number, gy: number) => number;
    switch (use) {
      case Use.Forest: base = (_u, _v, _h, gx, gy) => pick(PAL.woods, hash(gx >> 1, gy >> 1, 6)); break;
      case Use.Farm: {
        const fsub = w.sub[i];
        if (fsub === FarmSub.Garden) { base = (_u, v, _h, gx, gy) => ((Math.floor((y + v) * 7) & 1) ? (hash(gx, gy, 910) < 0.6 ? 0x4e7a32 : 0x5e8a3a) : (hash(gx, gy, 911) < 0.5 ? 0x6a5236 : 0x5c4630)); break; }
        if (fsub === FarmSub.Orchard) { base = (_u, _v, _h, gx, gy) => (hash(gx >> 1, gy >> 1, 912) < 0.5 ? 0x6e9a40 : 0x78a448); break; }
        if (fsub === FarmSub.Scrapyard) { base = (_u, _v, _h, gx, gy) => { const r = hash(gx, gy, 913); return r < 0.3 ? 0x5a4a3a : r < 0.6 ? 0x6e5a44 : 0x4a4640; }; break; }
        if (fsub === FarmSub.Brickyard) { base = (_u, _v, _h, gx, gy) => (hash(gx, gy, 914) < 0.5 ? 0x9a5a3e : 0xa86a4a); break; }
        const fx = Math.floor(x / 7), fy = Math.floor(y / 5);
        const crop = PAL.crops[Math.floor(hash(fx, fy, w.seed & 0xffff) * PAL.crops.length)];
        const along = hash(fx, fy, 11) < 0.5;
        const hedgeU = x % 7 === 0, hedgeV = y % 5 === 0;
        base = (u, v, _h, gx, gy) => {
          if ((hedgeU && u < 0.07) || (hedgeV && v < 0.07)) return hash(gx, gy, 12) < 0.7 ? 0x3e5a2a : 0x4e6a34;
          const row = along ? (y + v) * 9 : (x + u) * 9;
          const stripe = Math.floor(row) & 1;
          return crop[stripe ? 0 : hash(gx, gy, 13) < 0.8 ? 1 : 2];
        };
        break;
      }
      case Use.Cottage: case Use.Houses: base = (_u, _v, _h, gx, gy) => pick(PAL.lot, hash(gx >> 1, gy, 14)); break;
      case Use.Rowhouses: case Use.Civic: base = (_u, _v, _h, gx, gy) => pick(PAL.town, hash(gx, gy, 15)); break;
      case Use.Industry: case Use.Rival: {
        const pr = this.plants.get(i);
        const gr = pr?.t.ground ?? "yard";
        const flooded = pr?.c.status === "flooded";
        if (gr === "dock") base = (u, v, _h, gx, gy) => {
          const along = pr?.t.axis === "v" ? v : u;
          return (Math.floor(along * 16) & 1) ? (hash(gx, gy, 40) < 0.2 ? 0x5a4632 : 0x6e5840) : 0x7a6448;
        };
        else if (gr === "paved") base = (_u, _v, _h, gx, gy) => pick(PAL.paved, hash(gx >> 1, gy, 17));
        else if (gr === "spur") {
          const ax = pr?.t.axis ?? "u";
          base = (u, v, _h, gx, gy) => {
            const d = Math.abs((ax === "u" ? v : u) - 0.5), along = ax === "u" ? u : v;
            if (d < 0.13) {
              let c = hash(gx, gy, 30) < 0.5 ? 0x6a6258 : 0x5c544a;
              if (d < 0.09 && (Math.floor(along / 0.07) & 1) === 0) c = 0x4a3626;
              if (Math.abs(d - 0.045) < pxu * 0.9) c = 0xa8a8b0;
              return c;
            }
            return pick(PAL.yard, hash(gx, gy, 16));
          };
        } else base = (_u, _v, _h, gx, gy) => (flooded && hash(gx >> 3, gy >> 2, 41) < 0.45 ? 0x4a6a80 : pick(PAL.yard, hash(gx, gy, 16)));
        break;
      }
      case Use.Cemetery: base = (u, v, _h, gx, gy) => {
        // mown grass with gravel walks (the rural cemeteries' drives wind)
        if (w.sub[i] & CEM_RURAL) { const c = (Math.sin((x + u) * 0.31) + Math.cos((y + v) * 0.23) + Math.sin((x + y + u + v) * 0.17)) * 0.9; if (Math.abs(c - Math.round(c)) < 0.035) return hash(gx, gy, 915) < 0.4 ? 0xb0a48a : 0xc0b49a; return hash(gx >> 1, gy >> 1, 916) < 0.5 ? 0x5a863a : 0x649044; }
        if (Math.abs(u - 0.5) < 0.05 && (x + y) % 2 === 0) return hash(gx, gy, 915) < 0.4 ? 0xb0a48a : 0xc0b49a;
        return hash(gx >> 1, gy >> 1, 916) < 0.5 ? 0x5e8a3e : 0x689448;
      }; break;
      case Use.Park: if (w.sub[i] === ParkSub.Paved) { base = (_u, _v, _h, gx, gy) => ((gx % 4 === 0 || gy % 2 === 0) ? 0x8e887c : hash(gx >> 2, gy >> 1, 917) < 0.5 ? 0xb4ac9c : 0xa8a090); break; }
        base = (u, v, _h, gx, gy) => {
        const path = ((x + y) % 4 === 0 && Math.abs(u - v) < 0.07) || ((x - y + 400) % 4 === 0 && Math.abs(u + v - 1) < 0.07);
        if (path) return hash(gx, gy, 44) < 0.3 ? 0xb8a888 : 0xc8b898;
        return hash(gx >> 1, gy >> 1, 45) < 0.5 ? 0x7cb04c : 0x86b854;
      }; break;
      case Use.Mine: base = (_u, _v, _h, gx, gy) => (hash(gx, gy, 42) < 0.5 ? 0x3a3630 : pick(PAL.woods, hash(gx >> 1, gy >> 1, 6))); break;
      case Use.Commerce: base = (_u, _v, _h, gx, gy) => pick(PAL.paved, hash(gx >> 1, gy, 43) * 0.5 + 0.2); break;
      case Use.Landmark: base = (_u, _v, _h, gx, gy) => pick(PAL.paved, hash(gx >> 1, gy, 17)); break;
      case Use.Wharf: base = (_u, _v, _h, gx, gy) => {
        const sx = Math.floor(gx / 3) + ((Math.floor(gy / 2) & 1) ? 1 : 0);
        if (gx % 3 === 0 || gy % 2 === 0) return 0x5c5850;
        return hash(sx, gy >> 1, 18) < 0.5 ? 0x8e8a80 : 0x7a766e;
      }; break;
      case Use.Rock: {
        if (w.slag?.[i]) {
          // v0.31: a slag dump — grey-tan cinders, crusted darker, fresh pale runs where the ladles tipped
          const lvl = w.slag[i];
          base = (_u, _v, h, gx, gy) => {
            const r = hash(gx, gy, 960);
            if (r < 0.06) return 0x4a463e;
            if (hash(gx >> 2, gy, 961) < 0.08 + lvl * 0.004) return 0xb4aa94; // a fresh run
            const band = Math.floor(h / 1.5 + hash(gx >> 3, gy >> 2, 962) * 0.8) & 3;
            return [0x7a7468, 0x857e70, 0x6e695e, 0x8e8676][band];
          };
          break;
        }
        // bare bluff: soft, broken strata (not hard contour bands), with a ragged, chamfered edge into the
        // woods or fields next to it so a chain of rock tiles doesn't read as a staircase
        const soft = rawMask((j) => w.use[j] !== Use.Rock && m.terrain[j] !== Terrain.Water);
        const corner = lCorner(soft, false);
        base = (u, v, h, gx, gy) => {
          if (soft) {
            let d = edgeDist(soft, u, v);
            if (corner) { const [a, b] = orient(corner, u, v); d = Math.min(d, (1.5 - a - b) * Math.SQRT1_2); }
            const reach = 0.18 + hash(gx >> 2, gy >> 2, 47) * 0.22;
            if (d < reach && hash(gx >> 1, gy >> 1, 48) < 1 - d / reach) return pick(PAL.woods, hash(gx >> 1, gy >> 1, 6));
          }
          const band = Math.floor(h / 4 + hash(gx >> 3, gy >> 2, 49) * 0.9);
          const c = PAL.rock[(band + (hash(band, 0, 19) * 2 | 0)) % 3 + 0];
          return hash(gx, gy, 20) < 0.08 ? 0x6e6658 : hash(gx >> 1, gy >> 1, 21) < 0.16 ? 0x5e7a3a : c;
        };
        break;
      }
      default: {
        if (use === Use.Empty && w.sub[i] === LotSub.Burnt) { base = (_u, _v, _h, gx, gy) => { const r = hash(gx, gy, 934); return r < 0.3 ? 0x2a2420 : r < 0.6 ? 0x3e3630 : 0x4e4438; }; break; }
        if (use === Use.Empty && w.sub[i] === LotSub.Cleared) { base = (_u, _v, _h, gx, gy) => { const r = hash(gx, gy, 918); return r < 0.08 ? 0x8a7a6a : r < 0.16 ? 0x5a4e40 : hash(gx >> 1, gy >> 1, 919) < 0.5 ? 0x8a7a58 : 0x7e6e50; }; break; }
        if (use === Use.Empty && w.sub[i] === LotSub.Weeds) { base = (_u, _v, _h, gx, gy) => { const r = hash(gx, gy, 921); return r < 0.25 ? 0x8a7a50 : r < 0.6 ? 0x7a8a46 : hash(gx >> 1, gy >> 1, 922) < 0.5 ? 0x6a8a3c : 0x94884e; }; break; }
        if (use === Use.Empty && w.sub[i] === LotSub.Scrub) { base = (_u, _v, _h, gx, gy) => (hash(gx >> 1, gy >> 1, 923) < 0.5 ? 0x5a7a34 : 0x668a3a); break; }
        if (use === Use.Empty && w.sub[i] === LotSub.Yard) { base = (_u, _v, _h, gx, gy) => (hash(gx >> 1, gy >> 1, 920) < 0.5 ? 0x74a646 : 0x80b050); break; }
        const pal = t === Terrain.Floodplain ? PAL.meadow : PAL.grass;
        // v0.31: an open lot in the thick of the city is worn bare, not lawn
        let townN = 0;
        for (const [dx, dy] of N8) { const j = at(dx, dy); if (j >= 0) { const u2 = w.use[j]; if (u2 === Use.Rowhouses || u2 === Use.Commerce || u2 === Use.Industry || u2 === Use.Civic) townN++; } }
        if (use === Use.Empty && townN >= 3) { const heavy = townN >= 5; base = (_u, _v, _h, gx, gy) => (heavy || hash(gx >> 2, gy >> 1, 37) < 0.6 ? trodden(gx, gy) : pick(pal, hash(gx >> 1, gy >> 1, 23))); break; }
        base = (_u, _v, _h, gx, gy) => {
          const r = hash(gx, gy, 22);
          if (r > 0.995) return 0xe8e0a0;
          if (r > 0.99) return 0xd8b0c8;
          return pick(pal, hash(gx >> 1, gy >> 1, 23) * 0.6 + r * 0.4);
        };
      }
    }
    if (t === Terrain.Cliff && use === Use.Forest) {
      const b0 = base;
      base = (u, v, h, gx, gy) => (hash(gx >> 2, gy >> 1, 24) < 0.35 ? PAL.rock[(Math.floor(h / 2.5)) % 5] : b0(u, v, h, gx, gy));
    } else if (DETAIL > 0 && m.slope[i] >= 20 && (use === Use.Forest || use === Use.Empty) && !w.street[i]) {
      // v0.31: the steep hillsides show their bones — sandstone and shale ledges breaking out of the woods in level
      // bands (the strata run flat under the hills), a dark overhang under each
      const b0 = base, strong = Math.min(1, (m.slope[i] - 18) / 16);
      base = (u, v, h, gx, gy) => {
        const f = h / 4.5 + hash(gx >> 4, gy >> 3, 963) * 0.5;
        const fr = f - Math.floor(f);
        if (fr < 0.2 && hash(gx >> 2, Math.floor(f), 964) < 0.55 * strong) return fr < 0.05 ? 0x4e4436 : hash(gx, gy, 965) < 0.3 ? 0x8a7a5e : 0xa0906e;
        return b0(u, v, h, gx, gy);
      };
    }

    // linear features
    const inclineLine = this.inclineLineNear(w, x, y);
    const stairs = w.street[i] === Street.Steps || (w.street[i] > 0 && m.slope[i] >= 24);
    const streetMask = w.street[i] ? mask((j) => w.street[j] > 0) : 0;
    const dense = use === Use.Rowhouses || w.street[i] && [at(1, 0), at(-1, 0), at(0, 1), at(0, -1)].some((j) => j >= 0 && w.use[j] === Use.Rowhouses);
    const alley = w.street[i] === Street.Alley;
    const streetW = w.street[i] === Street.Pike ? 0.17 : alley ? 0.07 : dense ? 0.26 : 0.14;
    // v0.31 city streets: a narrower roadway with kerbs and sidewalks; paving by era (0 dirt, 1 Belgian block,
    // 2 brick, 3 asphalt) — main roads and the old city first
    const year = w.year;
    const pike = w.street[i] === Street.Pike;
    const pave = year >= (pike ? 1915 : dense ? 1925 : 1935) ? 3 : year >= (pike ? 1885 : dense ? 1890 : 1905) ? 2 : year >= (dense || pike ? 1865 : 9999) ? 1 : 0;
    const roadW = pike ? 0.2 : 0.17, walkW = roadW + 0.13;
    const hydrant = DETAIL > 0 && year >= 1875 && hash(x, y, 966) < 0.3;
    // creeks and rails come from the source vectors where the map has them (smooth on any angle);
    // otherwise from the raster masks
    const vec = m.lines.creek.length > 0 || m.lines.rail.length > 0;
    const segs = vec ? lineIndex(m).get(i) ?? [] : [];
    const creekSegs = segs.filter((sg) => sg.kind === "creek");
    const railSegs = segs.filter((sg) => sg.kind === "rail" && (m.railLines[String(sg.line)]?.year ?? 9999) <= w.year);
    const nearest = (list: Seg[], u: number, v: number): [number, number] => {
      let bd = 9, ba = 0;
      for (const sg of list) { const [d, a] = segDist(sg, x + u, y + v); if (d < bd) { bd = d; ba = a; } }
      return [bd, ba];
    };
    // v0.32: roads as smooth lines across tiles (render/roads.ts); their roadway also runs over the corners of the
    // tiles beside a street where a staircase is cut into a diagonal or a hairpin rounded
    const roadSegs = roadIndex(m, w).get(i) ?? [];
    const nearestRoad = (u: number, v: number): [number, number] => {
      let bd = 9, ba = 0;
      for (const sg of roadSegs) { const [d, a] = roadDist(sg, x + u, y + v); if (d < bd) { bd = d; ba = a; } }
      return [bd, ba];
    };
    const roadHere = roadSegs.length > 0 && !w.street[i] && t !== Terrain.Water && !m.rail[i] && use !== Use.Industry && use !== Use.Wharf;
    const rail = vec ? (railSegs.length ? 0 : -1) : railActive(i) ? mask((j) => railActive(j)) : -1;
    const creekMask = vec ? (creekSegs.length ? 0 : -1) : m.creek[i] ? mask((j) => m.creek[j] > 0 || m.terrain[j] === Terrain.Water) : -1;
    const waterMask = rawMask((j) => m.terrain[j] === Terrain.Water);
    const wharf = m.special[i] === Special.Wharf;
    const paved = wharf || use === Use.Wharf;
    const waterL = paved || (!w.street[i] && !w.owner[i]) ? lCorner(waterMask, false) : null;
    // open ground along a natural bank: the river may take part of the tile, up to the smooth shoreline
    const natural = use === Use.Empty || use === Use.Forest || use === Use.Farm || use === Use.Rock || (use === Use.Park && w.sub[i] !== ParkSub.Paved);
    const smoothBank = SMOOTH_SHORE && waterMask !== 0 && !paved && natural && !w.street[i] && !w.owner[i] && !w.structure[i] && rail < 0
      && !N8.some(([dx, dy]) => { const j = at(dx, dy); return j >= 0 && (m.special[j] === Special.Wharf || w.use[j] === Use.Wharf); });
    const sf = smoothBank ? shoreField(m) : null, ws: [number, number, number] = [0, 0, 0];

    // the cutting in front of a tunnel portal: the roadway (or track) running out from the bores
    const tpi = this.tunnelTiles().portal.get(i);
    const head = tpi && (tpi.face === "x-" || tpi.face === "y-") ? tpi : undefined;
    const ap = this.tunnelTiles().approach.get(i) ?? head;
    const apSt = ap ? portalState(ap, w.year) : -1;
    const apAlongU = ap ? ap.face[0] === "x" : false;
    const apLanes = ap?.t.bores === 2 ? [0.27, 0.73] : [0.5], apW = ap?.t.bores === 2 ? 0.17 : 0.2;

    return (u: number, v: number, h: number, gx: number, gy: number) => {
      let c = base(u, v, h, gx, gy);
      if (apSt >= 0) {
        const across = apAlongU ? v : u, along = apAlongU ? u : v;
        if (head) {
          // the back of a portal: the road runs in under the headwall's coping, the hill closes over it
          const b = 1 - along;
          if (b < 0.2) return c;
          if (b < 0.27) return b < 0.215 ? 0x8a8070 : hash(gx, gy, 941) < 0.2 ? 0xa89c84 : 0xc4b89e;
          if (b < 0.3) return 0x1a1a1e;
        }
        for (const lc of apLanes) {
          const d = Math.abs(across - lc);
          if (d > apW + 0.05) continue;
          if (d > apW) { c = 0x8a8478; break; } // kerb / shoulder
          if (ap!.t.kind === "road") { c = ap!.t.look === "concrete" ? (d < 0.012 && (Math.floor(along * 6) & 1) ? 0xe8e4d8 : 0x4a4a4e) : 0x8e8a80; break; }
          if (apSt === 2) { c = hash(gx, gy, 940) < 0.3 ? 0x4e6a34 : 0x5e5a44; break; }
          c = ap!.t.kind === "trolley" ? 0x8a8478 : hash(gx, gy, 30) < 0.5 ? 0x6a6258 : 0x5c544a;
          if (d < 0.15 && (Math.floor(along / 0.06) & 1) === 0) c = ap!.t.kind === "trolley" ? 0x7a746a : 0x4a3626;
          if (Math.abs(d - 0.06) < pxu * 0.9) c = 0xa8a8b0;
          break;
        }
        if (ap!.t.bores === 2 && ap!.t.kind === "road" && Math.abs(across - 0.5) < 0.02) c = 0xb8b4a8;
      }
      // a paved wharf takes the 45° line along the water too (no sawtooth of square tiles), with a stone edge
      if (waterMask && paved && waterL) {
        const [a, b] = orient(waterL, u, v);
        const dc = (1.5 - a - b) * Math.SQRT1_2;
        if (dc < 0) return dc > -0.05 ? 0x3f7598 : pick(WATER, hash(gx >> 2, gy >> 1, 3));
        if (dc < 0.04) return 0x4a463e;
      }
      if (sf) {
        const d = shoreDist(wetAt(sf, x + u, y + v, ws));
        if (d >= 0) return waterPx(d, gx, gy) | UNLIT;
        if (d > -0.3) c = bankPx(d, gx, gy, c);
      } else if (waterMask && !paved) {
        let dw = edgeDist(waterMask, u, v);
        if (waterL) {
          // a point of land between two water sides: the river takes the corner (45° bank)
          const [a, b] = orient(waterL, u, v);
          const dc = (1.5 - a - b) * Math.SQRT1_2;
          if (dc < 0) return dc > -0.05 ? 0x3f7598 : pick(WATER, hash(gx >> 2, gy >> 1, 3));
          dw = Math.min(dw, dc);
        }
        if (dw < 0.08) c = pick(PAL.wet, hash(gx, gy, 25));
        else if (dw < 0.24 + hash(gx >> 2, gy >> 2, 27) * 0.08) c = pick(PAL.sand, hash(gx, gy, 26));
      }
      if (creekMask >= 0) {
        const [dc] = vec ? nearest(creekSegs, u, v) : lineDist(creekMask, u, v);
        // at least a pixel wide when zoomed out, so creeks read as lines rather than dashes
        const cw = Math.max(0.06, pxu * 0.8);
        if (dc < cw) c = hash(gx, gy, 27) < 0.15 ? 0x8cb4d4 : 0x467aa0;
        else if (dc < cw + 0.04) c = 0x5e6a44;
      }
      if (inclineLine) {
        // the cleared right-of-way, straight from foot to head (the trestle itself is drawn live, over it)
        const [di] = segDist({ kind: "rail", line: 0, ax: inclineLine[0], ay: inclineLine[1], bx: inclineLine[2], by: inclineLine[3], s0: 0 }, x + u, y + v);
        if (di < 0.24) c = hash(gx, gy, 46) < 0.5 ? 0x6a5e48 : 0x5e5440;
      }
      if (w.street[i] && stairs) {
        // Pittsburgh city steps: concrete or timber treads with landings and pipe handrails
        const [ds, along] = roadSegs.length ? nearestRoad(u, v) : lineDist(streetMask, u, v);
        const landing = (Math.floor(along / 0.25) & 1) === 1 && (along % 0.25) < 0.06;
        const wood = w.year < 1910;
        if (ds < 0.09) c = landing ? (wood ? 0x9a8a6a : 0xb0aca4) : (Math.floor(along / 0.03) & 1) ? (wood ? 0x8a7a5e : 0xa8a49c) : (wood ? 0x5e4e3a : 0x6e6a64);
        else if (Math.abs(ds - 0.11) < pxu * 1.2) c = wood ? 0x3a3028 : 0x4a5a6a;
      } else if (roadHere) {
        // the edge of a smoothed road crossing this tile's corner
        const [ds, along] = nearestRoad(u, v);
        const rw = dense ? roadW : streetW;
        if (ds < rw) c = pave >= 3 ? paving(3, gx, gy, ds, rw, along) : pave >= 1 && dense ? paving(pave, gx, gy, ds, rw, along) : ds > rw - pxu * 1.5 ? 0x6e5e44 : hash(gx, gy, 29) < 0.12 ? 0x7a6a4e : 0x92805e;
      } else if (w.street[i]) {
        const [ds, along] = roadSegs.length && !alley ? nearestRoad(u, v) : lineDist(streetMask, u, v);
        if (alley) {
          // a rear alley: a narrow dirt track between the backs of the lots (brick in the old city after 1900)
          if (ds < streetW) c = dense && year >= 1900 ? ((gx % 4 === 0 || gy % 2 === 0) ? 0x6a4a3e : 0x8a5a46) : hash(gx, gy, 29) < 0.2 ? 0x8a7a5a : 0xa8966e;
        } else if (dense) {
          // v0.31: a city street — the roadway (paved by era), a stone kerb, the sidewalk, then the areaways to the house fronts
          if (ds < roadW) c = paving(pave, gx, gy, ds, roadW, along);
          else if (ds < roadW + Math.max(pxu * 1.2, 0.018)) c = year < 1870 ? 0x8a7a62 : 0xb4ae9e; // kerb
          else if (ds < walkW) c = hydrant && Math.abs(ds - roadW - 0.04) < 0.022 && Math.abs(along - 0.3) < 0.03 ? 0xb8382a : sidewalk(gx, gy);
          else if (use === Use.Empty && w.sub[i] === 0) c = ds < walkW + 0.06 ? (hash(gx >> 1, gy, 31) < 0.55 ? 0x76695a : 0x6a5e50) : trodden(gx, gy); // areaways, trodden
        } else if (ds < streetW) {
          if (pave >= 3 || (pave >= 2 && w.street[i] === Street.Pike)) {
            // a paved country road: asphalt (or brick on the pike) with gravel shoulders
            c = ds > streetW - pxu * 2 ? (hash(gx, gy, 32) < 0.5 ? 0x9a9078 : 0x8a826c) : paving(w.street[i] === Street.Pike ? pave : 3, gx, gy, ds, streetW, along);
          } else if (pave >= 2 && w.street[i] !== Street.Pike && w.pop[i] + (dense ? 1 : 0) > 0) {
            // macadam: crushed stone, rolled
            c = ds > streetW - pxu * 1.5 ? 0x7a7060 : hash(gx, gy, 29) < 0.2 ? 0x9a927e : 0xaaa28c;
          } else {
            c = ds > streetW - pxu * 1.5 ? 0x6e5e44 : hash(gx, gy, 29) < 0.12 ? 0x7a6a4e : 0x92805e;
            if (Math.abs(ds - streetW * 0.45) < pxu * 0.8) c = 0x7e6c50; // wheel ruts
          }
        }
      }
      if (rail >= 0) {
        const [dr, along] = vec ? nearest(railSegs, u, v) : lineDist(rail, u, v);
        if (dr < 0.13) {
          c = hash(gx, gy, 30) < 0.5 ? 0x6a6258 : 0x5c544a; // ballast
          if (dr < 0.09 && (Math.floor(along / 0.07) & 1) === 0) c = 0x4a3626; // ties
          if (Math.abs(dr - 0.045) < pxu * 0.9) c = 0xa8a8b0; // rails
        }
      }
      if (grid && (u < pxu || v < pxu)) c = rgb(((c >> 16) & 255) * 0.82, ((c >> 8) & 255) * 0.82, (c & 255) * 0.82);
      return c;
    };
  }

  /** What is drawn on a tile (sprite keys and the plant part, if any), for the query tool. */
  tileObjects(g: GameState, x: number, y: number): { keys: string[]; plant?: { part: string; owner: string } } {
    this.updatePlants(g);
    const i = y * this.map.width + x;
    const pr = this.plants.get(i);
    return { keys: this.tileSprites(g, x, y, i).map((s) => s.key), plant: pr ? { part: pr.t.part, owner: pr.c.owner } : undefined };
  }

  // ------------------------------------------------------------ sprites per tile
  private houseSpecFor(g: GameState, x: number, y: number, i: number, kind: HouseKind, sub: number, closed = false) {
    const m = this.map, w = g.world, W = m.width, V = W + 1;
    const st = (dx: number, dy: number) => {
      const nx = x + dx, ny = y + dy;
      return nx >= 0 && ny >= 0 && nx < W && ny < m.height && w.street[ny * W + nx] > 0;
    };
    let o: "a" | "b" = "a", front: "+" | "-" = "+";
    if (st(0, 1)) { o = "a"; front = "+"; }
    else if (st(1, 0)) { o = "b"; front = "+"; }
    else if (st(0, -1)) { o = "a"; front = "-"; }
    else if (st(-1, 0)) { o = "b"; front = "-"; }
    else { o = hash(x, y, 50) < 0.5 ? "a" : "b"; front = "+"; }
    const corner = (st(0, 1) || st(0, -1)) && (st(1, 0) || st(-1, 0)) ? 1 : 0;
    const hT = m.vert[y * V + x], hR = m.vert[y * V + x + 1], hL = m.vert[(y + 1) * V + x], hB = m.vert[(y + 1) * V + x + 1];
    const hc = (hT + hR + hL + hB) / 4;
    // the corners quantized to 3 px at full size, 6 px when the sprite is drawn at a quarter size or less (where a
    // 3 px step is under a pixel, and the finer keys only multiplied the sprites a hilly view had to build)
    const step = this.curScale <= 0.25 ? 6 : 3;
    const q = (h: number) => Math.max(-60, Math.min(60, Math.round(((h - hc) * ZPX) / step) * step));
    const ground: [number, number, number, number] = [q(hT), q(hR), q(hB), q(hL)];
    const pol = w.pollution[i];
    let soot = pol < 0.15 ? 0 : pol < 0.5 ? 1 : pol < 1.2 ? 2 : 3;
    const housing = kind !== "civic" && kind !== "shop";
    const boarded = closed || (housing && w.pop[i] === 0 && kind !== "mansion") ? 1 : 0;
    let style = styleForYear(w.built[i] || 1850);
    // v0.26: the plat's own look. Its old heart (the inner third around the seed) reads a period older and dirtier;
    // a company row is one design repeated down the block.
    const bid = w.blockId?.[i], blk = bid ? g.sleuth?.blocks[bid - 1] : undefined;
    let vv = -1;
    if (blk) {
      const r = Math.sqrt(blk.land / Math.PI), d = Math.hypot(x - blk.x, y - blk.y);
      if (housing && blk.land > 30 && d < 0.3 * r) { style = Math.max(0, style - 1); soot = Math.min(3, soot + 1); }
      if (kind === "company") vv = Math.floor(hash(blk.id, 7, 51) * 6);
    }
    // the community's style: houses whose families belong to the community that holds this part of town
    const kc = w.kit[((y / 8) | 0) * Math.ceil(W / 8) + ((x / 8) | 0)];
    // churches, halls, schools and community shops: the community that built them (it stays theirs to look at after they leave)
    // under the seed-block model the plat's majority community sets the style, not the 8×8 cell (v0.26)
    const pk = g.growthModel === "sleuth" && w.blockId?.[i] ? (g.sleuth?.blocks[w.blockId[i] - 1]?.kit ?? 0) : kc;
    const kit = housing ? (pk && w.eth[i] === pk ? pk : 0) : (w.was[i] || w.eth[i] || 0);
    // at a quarter size the six variants and the community's kit are a pixel or two apart: fewer keys, the same look
    const small = this.curScale <= 0.25;
    const v = vv >= 0 ? (small ? vv & 1 : vv) : small ? Math.floor(hash(x, y, 51) * 2) : Math.floor(hash(x, y, 51) * 6);
    return houseKey({ kind, sub, style, o, front, corner, v, g: ground, lift: 0, fnd: 0, soot, boarded, kit: small && housing ? 0 : kit });
  }

  private denseStreet(g: GameState, x: number, y: number) {
    const m = this.map, w = g.world, W = m.width;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= m.height) continue;
      const u2 = w.use[ny * W + nx];
      if (u2 === Use.Rowhouses || u2 === Use.Commerce) return true;
    }
    return false;
  }

  // ------------------------------------------------------------ v0.31 clutter and industrial landforms
  /** wires along straight streets (telegraph on the pikes from the 1850s, electric in town from the 1890s, the
   * trolley wire on the car lines 1890–1960) and billboards along the main roads from 1905 */
  private clutter(g: GameState, x: number, y: number, i: number, out: { key: string; u: number; v: number; h?: number }[]) {
    const m = this.map, w = g.world, W = m.width, yr = w.year, st = w.street[i];
    const S = (dx: number, dy: number) => { const nx = x + dx, ny = y + dy; return nx >= 0 && ny >= 0 && nx < W && ny < m.height ? w.street[ny * W + nx] : 0; };
    if (st && st !== Street.Bridge && st !== Street.Steps && st !== Street.Alley && m.slope[i] < 14) {
      const ew = (S(1, 0) || S(-1, 0)) && !S(0, 1) && !S(0, -1), ns = (S(0, 1) || S(0, -1)) && !S(1, 0) && !S(-1, 0);
      if (ew || ns) {
        const o = ew ? "a" : "b", dense = this.denseStreet(g, x, y), pike = st === Street.Pike;
        const kind = pike && dense && yr >= 1890 && yr < 1960 ? "trolley" : (dense && yr >= 1890) || (yr >= 1915 && (w.pop[i] > 0 || this.near(g, x, y, (j) => w.pop[j] > 0))) ? "elec" : pike && yr >= 1850 ? "tel" : "";
        // (wires are a pixel line: at half size and below they only scratch the map)
        if (kind && this.curScale >= 0.75 && (DETAIL >= 2 || dense)) out.push({ key: `wire:${kind}:${o}:${(ew ? x : y) % 2 === 0 ? 1 : 0}`, u: 0.5, v: 0.5 });
      }
    }
    return out;
  }
  private near(_g: GameState, x: number, y: number, f: (j: number) => boolean): boolean {
    const m = this.map, W = m.width;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const nx = x + dx, ny = y + dy; if (nx >= 0 && ny >= 0 && nx < W && ny < m.height && f(ny * W + nx)) return true; }
    return false;
  }
  /** v0.31: the big rail yards (where the rails lie thickest), and beside each the tile its roundhouse stands on */
  private yards: Map<number, number> | null = null; // site tile → the yard's busiest rail tile
  private yardSites(): Map<number, number> {
    if (this.yards) return this.yards;
    const m = this.map, W = m.width, H = m.height, out = new Map<number, number>();
    const R = 3, dens = new Uint16Array(W * H);
    for (let y = R; y < H - R; y++) for (let x = R; x < W - R; x++) {
      if (!m.rail[y * W + x]) continue;
      let c = 0;
      for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) if (m.rail[(y + dy) * W + x + dx]) c++;
      dens[y * W + x] = c;
    }
    const peaks = Array.from(dens.keys()).filter((i) => dens[i] >= 19).sort((a, b) => dens[b] - dens[a]);
    const chosen: number[] = [];
    for (const i of peaks) {
      const x = i % W, y = (i / W) | 0;
      if (chosen.some((j) => Math.hypot((j % W) - x, ((j / W) | 0) - y) < 22)) continue;
      // the nearest open, level tile off the tracks within a few tiles
      let best = -1, bd = Infinity;
      for (let dy = -5; dy <= 5; dy++) for (let dx = -5; dx <= 5; dx++) {
        const xx = x + dx, yy = y + dy;
        if (xx < 1 || yy < 1 || xx >= W - 1 || yy >= H - 1) continue;
        const j = yy * W + xx;
        if (m.rail[j] || m.terrain[j] === Terrain.Water || m.slope[j] > 8) continue;
        let byRail = false;
        for (const [ax, ay] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (m.rail[(yy + ay) * W + xx + ax]) byRail = true;
        if (!byRail) continue;
        const d = Math.hypot(dx, dy);
        if (d < bd) { bd = d; best = j; }
      }
      if (best >= 0) { chosen.push(i); out.set(best, i); }
    }
    this.yards = out;
    return out;
  }
  /** next to a drift mine */
  private byMine(g: GameState, x: number, y: number): boolean { return this.near(g, x, y, (j) => g.world.use[j] === Use.Mine); }
  /** a strip mine on an open hilltop in the country, from 1942 (the war's coal) */
  private stripMine(g: GameState, x: number, y: number, i: number): boolean {
    const m = this.map, w = g.world;
    if (w.year < 1942 || m.elevation[i] < 330 || m.slope[i] > 10) return false;
    if (hash(x >> 3, y >> 3, 970 + (w.seed & 0xff)) > 0.06) return false;
    if (this.near(g, x, y, (j) => w.pop[j] > 0 || w.street[j] > 0)) return false;
    return hash(x, y >> 1, 971) < 0.75;
  }
  /** an open lot by the works or the mines: coke ovens by a mine (1850–1930), ore by a steel works' dock, billboards on the pike */
  private industrialLot(g: GameState, x: number, y: number, _i: number): string | null {
    const m = this.map, w = g.world, W = m.width, yr = w.year;
    const h = hash(x, y, 972 + (w.seed & 0xff));
    if (yr < 1930 && this.byMine(g, x, y) && h < 0.5) {
      const o = this.near(g, x, y, (j) => g.world.use[j] === Use.Mine && (j % W) !== x) ? "b" : "a";
      return `coke:${o}:${Math.floor(hash(x, y, 973) * 3)}`;
    }
    if (h < 0.55 && this.near(g, x, y, (j) => { const pr = this.plants.get(j); return pr?.t.ground === "dock" && pr.c.ind === "steel" && pr.c.status !== "idle"; })) return `ore:${Math.floor(hash(x, y, 974) * 2)}`;
    if (yr >= 1905 && h < 0.16 && this.near(g, x, y, (j) => w.street[j] === Street.Pike)) {
      const o = this.near(g, x, y, (j) => w.street[j] === Street.Pike && (j % W) !== x) ? "a" : "b";
      return `bill:${o}:${Math.floor(hash(x, y, 975) * 4)}`;
    }
    return null;
  }

  private tileSprites(g: GameState, x: number, y: number, i: number): { key: string; u: number; v: number; h?: number }[] {
    const m = this.map, w = g.world, W = m.width;
    const out: { key: string; u: number; v: number; h?: number }[] = [];
    const n = (c: number) => hash(x, y, c + (w.seed & 0xff));
    const use = w.use[i];
    const t = m.terrain[i];
    const sub = w.sub[i];

    // v0.31: the roundhouse at a big yard (from 1865, on open ground the town hasn't taken)
    if (DETAIL > 0 && w.year >= 1865 && (use === Use.Empty || use === Use.Forest || use === Use.Farm) && !w.pop[i] && !w.street[i] && this.yardSites().has(i)) {
      out.push({ key: `rhouse:${Math.floor(hash(x, y, 976) * 3)}`, u: 0.5, v: 0.5 });
      return out;
    }
    // a tunnel portal fills its tile; its cutting runs out over the next few (no trees or buildings in the road)
    const tp = this.tunnelTiles();
    const pt = tp.portal.get(i);
    if (pt && portalState(pt, w.year) >= 0) {
      // a portal facing the camera is drawn over the terrain (drawPortals); one facing away is hidden by its own
      // hill (the ground shader draws its road running up under the headwall's coping)
      return out;
    }
    const ap = tp.approach.get(i);
    if (ap && portalState(ap, w.year) >= 0) return out;
    // the slope round a portal is cleared: no trees on the eight tiles about it
    const near = tp.near.get(i);
    if (near && portalState(near, w.year) >= 0 && use === Use.Forest) return out;

    // v0.28: a business you own stands on its tile (in place of the trees or the field)
    const held = holdingKey(g, i);
    if (held) { out.push({ key: held, u: 0.5, v: 0.5 }); return out; }

    switch (use) {
      case Use.Forest: {
        const high = m.elevation[i] > 320 || t === Terrain.Steep || t === Terrain.Cliff;
        // v0.31: the strip mines of the 1940s on the open hilltops out in the country, and gob beside the drift mines
        if (DETAIL > 0 && this.stripMine(g, x, y, i)) { out.push({ key: `strip:${Math.floor(n(42) * 2)}`, u: 0.5, v: 0.5 }); break; }
        if (DETAIL > 0 && this.byMine(g, x, y) && n(43) < 0.45) { out.push({ key: `gob:${Math.floor(n(44) * 2)}`, u: 0.5, v: 0.5 }); break; }
        // v0.31: the woods by site. Sycamore and silver maple on the river bottoms, hemlock in the cool north-facing
        // hollows, oak and hickory up on the hills; trees near the works thin out and yellow in the smoke. Trees
        // stand in clumps and glades, not evenly.
        const Vv = W + 1;
        const north = (m.vert[(y + 1) * Vv + x] + m.vert[(y + 1) * Vv + x + 1] - m.vert[y * Vv + x] - m.vert[y * Vv + x + 1]) / 2;
        let wet = t === Terrain.Floodplain;
        if (!wet) for (const [dx, dy] of N8) { const nx = x + dx, ny = y + dy; if (nx >= 0 && ny >= 0 && nx < W && ny < m.height && m.terrain[ny * W + nx] === Terrain.Water) { wet = true; break; } }
        const shady = north > 4 && m.slope[i] >= 8;
        const pol = w.pollution[i];
        const clump = hash(x >> 2, y >> 2, 35 + (w.seed & 0xff)) * 0.6 + hash(x >> 1, y >> 1, 36) * 0.4;
        const count = DETAIL === 0 ? 3 + Math.floor(n(2) * 3) : Math.max(1, Math.round(1.5 + clump * 4.5 + n(2) - (pol > 0.8 ? 1.5 : 0)));
        for (let k = 0; k < count; k++) {
          const u = 0.15 + hash(x * 7 + k, y, 31) * 0.7, v = 0.15 + hash(x, y * 7 + k, 32) * 0.7;
          const r = hash(x + k, y - k, 33);
          let sp = high ? (r < 0.55 ? "pine" : r < 0.85 ? "oak" : "bush") : (r < 0.45 ? "oak" : r < 0.8 ? "maple" : r < 0.92 ? "pine" : "bush");
          if (DETAIL > 0) {
            if (wet) sp = r < 0.45 ? "sycamore" : r < 0.8 ? "maple" : r < 0.9 ? "oak" : "bush";
            else if (shady) sp = r < 0.55 ? "hemlock" : r < 0.8 ? "oak" : r < 0.9 ? "maple" : "bush";
            else if (high) sp = r < 0.6 ? "oak" : r < 0.75 ? "maple" : r < 0.88 ? "pine" : "bush";
            if (pol > 0.5 && hash(x - k, y + k, 37) < Math.min(0.8, (pol - 0.4) * 0.7)) sp = "sick";
          }
          const nv = sp === "bush" || sp === "sumac" || sp === "sick" ? 2 : 3;
          out.push({ key: `tree:${sp}${Math.floor(hash(k, x + y, 34) * nv)}`, u, v });
        }
        break;
      }
      case Use.Empty:
        if (DETAIL > 0 && !w.street[i] && !sub && t !== Terrain.Water) {
          const ind = this.industrialLot(g, x, y, i);
          if (ind) { out.push({ key: ind, u: 0.5, v: 0.5 }); break; }
        }
        if (sub === LotSub.Weeds) { if (n(3) < 0.4) out.push({ key: DETAIL > 0 && n(4) < 0.5 ? `tree:sumac${Math.floor(n(5) * 2)}` : "tree:bush0", u: 0.25 + n(6) * 0.5, v: 0.25 + n(7) * 0.5 }); break; }
        if (sub === LotSub.Scrub) { for (let k = 0; k < 2; k++) if (n(3 + k) < 0.75) out.push({ key: n(5 + k) < 0.5 ? (DETAIL > 0 ? `tree:sumac${k}` : `tree:bush${k}`) : `tree:maple${Math.floor(n(9 + k) * 2)}`, u: 0.2 + n(11 + k) * 0.6, v: 0.2 + n(13 + k) * 0.6 }); break; }
        if (sub === LotSub.Burnt) { out.push({ key: `lot:burnt${Math.floor(n(3) * 4)}`, u: 0.5, v: 0.5 }); break; }
        if (sub === LotSub.Cleared) { if (n(3) < 0.12) out.push({ key: "tree:bush0", u: 0.3 + n(6) * 0.4, v: 0.3 + n(7) * 0.4 }); break; }
        if (sub !== LotSub.Yard) { if (!w.street[i] && t !== Terrain.Water && n(3) < 0.18) out.push({ key: n(4) < 0.5 ? "tree:bush0" : `tree:oak${Math.floor(n(5) * 3)}`, u: 0.3 + n(6) * 0.4, v: 0.3 + n(7) * 0.4 }); break; }
        if (n(8) < 0.35) out.push({ key: `tree:${n(9) < 0.5 ? "oak" : "maple"}${Math.floor(n(10) * 3)}`, u: 0.3 + n(11) * 0.4, v: 0.3 + n(12) * 0.4 });
        break;
      case Use.Farm:
        if (sub === FarmSub.Orchard) { for (const [u, v] of [[0.28, 0.28], [0.72, 0.28], [0.28, 0.72], [0.72, 0.72]]) out.push({ key: `tree:${n(8) < 0.5 ? "oak" : "maple"}0`, u, v }); break; }
        if (sub === FarmSub.Scrapyard) { if (n(8) < 0.6) out.push({ key: "yard:scrap", u: 0.5, v: 0.5 }); break; }
        if (sub === FarmSub.Brickyard) { if (n(8) < 0.5) out.push({ key: "yard:kiln", u: 0.5, v: 0.5 }); break; }
        if (sub === FarmSub.Garden) break;
        if (x % 7 === 0 && y % 5 === 0 && n(8) < 0.7) out.push({ key: `tree:oak${Math.floor(n(9) * 3)}`, u: 0.12, v: 0.12 });
        break;
      case Use.Cottage: {
        if (sub === HouseSub.Shanty) { out.push({ key: this.houseSpecFor(g, x, y, i, "shanty", sub), u: 0.5, v: 0.5 }); break; }
        if (sub === HouseSub.Company) { out.push({ key: this.houseSpecFor(g, x, y, i, "company", sub), u: 0.5, v: 0.5 }); break; }
        let nearStreet = false;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const nx = x + dx, ny = y + dy; if (nx >= 0 && ny >= 0 && nx < W && ny < m.height && w.street[ny * W + nx]) nearStreet = true; }
        if (!nearStreet && w.pop[i] >= 4) out.push({ key: `farm:${Math.floor(n(11) * 2)}`, u: 0.5, v: 0.5 });
        else out.push({ key: this.houseSpecFor(g, x, y, i, "cottage", sub), u: 0.5, v: 0.5 });
        break;
      }
      case Use.Houses: {
        const kind: HouseKind = sub === HouseSub.Estate ? (w.pollution[i] < 0.4 ? "mansion" : "house") : sub === HouseSub.Company ? "company" : sub === HouseSub.Shanty ? "shanty" : sub === HouseSub.Boarding ? "boarding" : "house";
        out.push({ key: this.houseSpecFor(g, x, y, i, kind, sub), u: 0.5, v: 0.5 });
        break;
      }
      case Use.Rowhouses:
        out.push({ key: this.houseSpecFor(g, x, y, i, sub === HouseSub.Boarding ? "boarding" : "row", sub), u: 0.5, v: 0.5 });
        break;
      case Use.Civic:
        // Croatian & Serbian parishes: most Croatian churches were Latin-rite (twin towers), the Serbian Orthodox ones onion-domed
        out.push({ key: this.houseSpecFor(g, x, y, i, "civic", sub === CivicSub.OnionChurch && (w.was[i] || w.eth[i]) === G.CROAT && latinRite(i) ? CivicSub.TwinChurch : sub as CivicSub), u: 0.5, v: 0.5 });
        break;
      case Use.Commerce:
        out.push({ key: this.houseSpecFor(g, x, y, i, "shop", (sub & 31) || 2, (sub & SHOP_CLOSED) !== 0), u: 0.5, v: 0.5 });
        break;
      case Use.Mine:
        out.push({ key: `mine:${Math.floor(n(12) * 2)}`, u: 0.5, v: 0.5 });
        break;
      case Use.Cemetery: {
        // v0.27: the stones by the ground's faith and how full it is; the family plot; the rural cemeteries' old trees
        if (sub & CEM_PLOT) { out.push({ key: `cem:plot${g.civ?.plot?.level ?? 0}`, u: 0.5, v: 0.5 }); break; }
        const fill = sub & CEM_FILL, rural = (sub & CEM_RURAL) !== 0;
        if (!(sub & CEM_FIXED)) out.push({ key: `cem:stones${Math.floor(n(22) * 2)}`, u: 0.5, v: 0.5 }); // a v0.26 save, until the spring
        else if (fill) out.push({ key: `cem:${rural ? "r" : ""}${cemFaith(sub)}${fill}${rural && fill === 3 && n(28) < 0.08 ? 1 : 0}`, u: 0.5, v: 0.5 });
        if (n(23) < (rural ? 0.38 : 0.2)) out.push({ key: `tree:${rural && n(27) < 0.4 ? "oak" : "maple"}${Math.floor(n(24) * 3)}`, u: 0.2 + n(25) * 0.6, v: 0.2 + n(26) * 0.6 });
        break;
      }
      case Use.Park:
        if (sub === ParkSub.Bandstand) { out.push({ key: "park:bandstand", u: 0.5, v: 0.5 }); break; }
        if (sub === ParkSub.Paved) { if (n(22) < 0.15) out.push({ key: "struct:fountain", u: 0.5, v: 0.5 }); break; }
        if (sub === ParkSub.Green && n(22) < 0.7) out.push({ key: `tree:${n(23) < 0.5 ? "oak" : "maple"}${Math.floor(n(24) * 3)}`, u: 0.25 + n(25) * 0.5, v: 0.25 + n(26) * 0.5 });
        if (sub === ParkSub.Green) break;
        if (n(22) < 0.55) out.push({ key: `tree:${n(23) < 0.6 ? "oak" : "maple"}${Math.floor(n(24) * 3)}`, u: 0.25 + n(25) * 0.5, v: 0.25 + n(26) * 0.5 });
        if (n(27) < 0.08) out.push({ key: "park:bandstand", u: 0.5, v: 0.5 });
        break;
      case Use.Incline: {
        // stations at either end, a car part-way up
        let nb = 0;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const nx = x + dx, ny = y + dy; if ((dx || dy) && nx >= 0 && ny >= 0 && nx < W && ny < m.height && w.use[ny * W + nx] === Use.Incline && w.sub[ny * W + nx] === sub) nb++; }
        if (nb <= 1) out.push({ key: "incline:station", u: 0.5, v: 0.5 });
        break;
      }
      case Use.Landmark: {
        const st = w.structure[i];
        if (st > 0 && st < 255) out.push({ key: `struct:${STRUCTURES[st]}`, u: 0.5, v: 0.5 });
        break;
      }
      case Use.Rock:
        if (w.slag?.[i]) {
          // the dump's face (an edge tile) shows the tipped runs; its flat top the dump track and a ladle car
          let edge = false;
          for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const nx = x + dx, ny = y + dy; if (nx >= 0 && ny >= 0 && nx < W && ny < m.height && !(w.slag[ny * W + nx] >= w.slag[i] - 2)) edge = true; }
          if (edge || n(40) < 0.35) out.push({ key: `slag:${edge ? 1 : 0}:${Math.floor(n(41) * 4)}`, u: 0.5, v: 0.5 });
        }
        break;
      case Use.Wharf:
        if (n(18) < 0.3) out.push({ key: `wharf:${Math.floor(n(19) * 3)}`, u: 0.5, v: 0.5 });
        break;
      case Use.Industry:
      case Use.Rival: {
        const pr = this.plants.get(i);
        if (pr && pr.t.part) {
          const soot = Math.min(3, Math.floor(pr.years / 12) + 1);
          out.push({ key: plantKey(pr.t, pr.c, soot, Math.floor(n(14) * 3)), u: 0.5, v: 0.5 });
        } else if (DETAIL > 0 && pr?.t.ground === "spur" && pr.c.status !== "idle" && n(45) < 0.7) {
          // v0.31: a string of cars standing on the works' siding (hoppers in, gondolas and boxcars out)
          out.push({ key: `cars:${pr.t.axis === "v" ? "b" : "a"}:${Math.floor(n(46) * 4)}`, u: 0.5, v: 0.5 });
        }
        break;
      }
    }

    // gas (later electric) street lamps along busy streets
    if (w.street[i] && w.street[i] !== Street.Bridge && (x * 3 + y) % 4 === 0 && this.denseStreet(g, x, y))
      out.push({ key: w.year >= 1910 ? "lamp:elec" : "lamp:gas", u: 0.5, v: 0.5 });
    if (DETAIL > 0) this.clutter(g, x, y, i, out);

    if (t === Terrain.Water) {
      // bridges are drawn whole as smooth spans (drawBridges), not per tile
      if (!(w.street[i] === Street.Bridge || (m.rail[i] && (m.railLines[String(m.rail[i])]?.year ?? 9999) <= w.year))) {
        // barges moored at plant docks; steamboats at the wharves; coal barges on the Mon
        let dock = false, nearWharf = false, dockInd = "";
        for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= W || ny >= m.height) continue;
          const j = ny * W + nx;
          const pl = Math.abs(dx) <= 1 && Math.abs(dy) <= 1 ? this.plants.get(j) : undefined;
          if (pl?.t.ground === "dock" && pl.c.status !== "idle") { dock = true; dockInd = pl.c.ind; } // a closed works' dock is empty
          if (m.special[j] === Special.Wharf) nearWharf = true;
        }
        const axis = riverAxis(m, x, y);
        // cargo (sprite variant, see BARGE_CARGO): 0 coal, 1 iron ore, 2 limestone/sand
        const r = n(22);
        const cargo = dockInd === "steel" ? (r < 0.5 ? 0 : r < 0.85 ? 1 : 2) : dockInd === "glass" ? (r < 0.3 ? 0 : 2) : dockInd === "power" ? 0 : dockInd ? (r < 0.6 ? 0 : 2) : r < 0.75 ? 0 : r < 0.9 ? 1 : 2;
        // v0.31: from the 1880s the coal came down in tows, and lay at the landings in rafts of barges waiting to be unloaded
        if (DETAIL > 0 && w.year >= 1880 && (dock || nearWharf) && (x + y) % 3 === 0 && n(27) < (dock ? 0.45 : 0.18)) out.push({ key: `fleet:${axis}:${Math.floor(n(28) * 3)}`, u: 0.5, v: 0.5 });
        else if (dock && (x + y) % 2 === 0) out.push({ key: `boat:barge:${axis}:${cargo}`, u: 0.5, v: 0.5 });
        else if ((x + y) % 2 === 0 && n(24) < 0.4) {
          // packets at the wharves until the railroads and the Depression end them (~1930); then a moored towboat now and then
          // moored where there's room, not on a lattice, and not quite parallel
          const ju = 0.35 + n(25) * 0.3, jv = 0.35 + n(26) * 0.3;
          if (nearWharf && n(20) < 0.3) { if (w.year < 1930) out.push({ key: `boat:steam:${axis}`, u: ju, v: jv }); else if (n(23) < 0.35) out.push({ key: `boat:barge:${axis}:${cargo}`, u: ju, v: jv }); }
          else if (n(21) < 0.006) out.push({ key: `boat:barge:${axis}:${cargo}`, u: 0.5, v: 0.5 });
        }
      }
    }
    if (out.length > 1) out.sort((a, b) => a.u + a.v - (b.u + b.v));
    return out;
  }

  // ------------------------------------------------------------ bridges (whole spans, drawn live)
  /**
   * Each bridge is one straight span from abutment to abutment with a smooth vertical profile
   * (bank height at the ends, navigation clearance over the channel), piers in the river, and a
   * superstructure by type: covered timber, wire suspension, lenticular truss, through truss, arch.
   */
  drawBridges(ctx: CanvasRenderingContext2D, cam: Camera, g: GameState) {
    const m = this.map, z = cam.zoom, year = g.world.year;
    const cw = ctx.canvas.width, ch = ctx.canvas.height;
    const S = (x: number, y: number, h: number): [number, number] => { const [wx, wy] = project(x, y, h); return [(wx - cam.x) * z, (wy - cam.y) * z]; };
    const elevAt = (x: number, y: number) => m.elevation[Math.max(0, Math.min(m.height - 1, Math.floor(y))) * m.width + Math.max(0, Math.min(m.width - 1, Math.floor(x)))];
    const live = [...m.spans, ...(g.spans ?? [])].map((sp) => ({ sp, st: stageOf(sp, year) })).filter((o) => o.st)
      .sort((p, q) => (p.sp.a[0] + p.sp.a[1] + p.sp.b[0] + p.sp.b[1]) - (q.sp.a[0] + q.sp.a[1] + q.sp.b[0] + q.sp.b[1]));
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.lineJoin = "round";
    for (const { sp, st } of live) {
      const type = st!.type, built = st!.year;
      const [ax, ay] = sp.a, [bx, by] = sp.b;
      const A = S(ax, ay, 260), B = S(bx, by, 260);
      if (Math.max(A[0], B[0]) < -200 || Math.min(A[0], B[0]) > cw + 200 || Math.max(A[1], B[1]) < -300 || Math.min(A[1], B[1]) > ch + 300) continue;
      const len = Math.hypot(bx - ax, by - ay);
      const ux = (bx - ax) / len, uy = (by - ay) / len;
      const rail = sp.kind === "rail";
      const halfW = (rail ? 0.16 : type === "arch" && built >= 1940 ? 0.32 : 0.22);
      // which side faces the viewer (larger x + y)
      let px = -uy * halfW, py = ux * halfW;
      if (px + py < 0) { px = -px; py = -py; }
      const gA = elevAt(ax, ay), gB = elevAt(bx, by);
      const wl = m.waterLevel[Math.floor((ay + by) / 2) * m.width + Math.floor((ax + bx) / 2)] || Math.min(gA, gB) - 8;
      const clear = rail ? 17 : type === "covered" ? 9 : built >= 1920 ? 22 : 14;
      const lift = Math.max(0, wl + clear - Math.min(gA, gB));
      const N = Math.max(8, Math.round(len * 4));
      const hAt = (t: number) => gA + (gB - gA) * t + lift * Math.pow(Math.sin(Math.PI * t), 0.45);
      const at = (t: number, side: number, dz = 0): [number, number] => S(ax + (bx - ax) * t + px * side, ay + (by - ay) * t + py * side, hAt(t) + dz);
      const ts: number[] = []; for (let k = 0; k <= N; k++) ts.push(k / N);
      const paint = bridgePaint(sp.name, rail, built, year);
      const steel = paint.steel;
      const lw = (w: number) => Math.max(1, w * z);
      const line = (pts: [number, number][], col: string, w: number) => { ctx.strokeStyle = col; ctx.lineWidth = lw(w); ctx.beginPath(); pts.forEach(([x, y], k) => (k ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.stroke(); };
      const seg = (p: [number, number], q: [number, number], col: string, w: number) => line([p, q], col, w);
      const poly = (pts: [number, number][], col: string) => { ctx.fillStyle = col; ctx.beginPath(); pts.forEach(([x, y], k) => (k ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.closePath(); ctx.fill(); };

      // piers (only where the ground under the span is river)
      const nP = Math.max(1, Math.round(len / 3.6));
      const piers: number[] = [];
      for (let k = 1; k < nP; k++) piers.push(k / nP);
      if (type === "suspension" && !rail) { piers.length = 0; piers.push(0.2, 0.8); }
      const pierCol = built < 1900 ? "#8a8272" : "#9a968c";
      for (const t of piers) {
        const fx = ax + (bx - ax) * t, fy = ay + (by - ay) * t;
        const base = Math.min(hAt(t), elevAt(fx, fy) < wl + 1 ? wl - 1 : elevAt(fx, fy));
        const top = hAt(t) - 1.5;
        const f0 = S(fx - px * 1.1, fy - py * 1.1, top), f1 = S(fx + px * 1.1, fy + py * 1.1, top);
        const b0 = S(fx - px * 1.1, fy - py * 1.1, base), b1 = S(fx + px * 1.1, fy + py * 1.1, base);
        poly([f0, f1, b1, b0], pierCol);
        const thick = 3 * z;
        poly([f1, [f1[0] + thick, f1[1] - thick / 2], [b1[0] + thick, b1[1] - thick / 2], b1], shade6(pierCol, 0.7));
      }

      // superstructure drawing for one side (-1 far, +1 near)
      const side = (s: number) => {
        if (type === "covered") {
          const H = 5.5;
          const bottom = ts.map((t) => at(t, s)), topPts = ts.map((t) => at(t, s, H));
          poly([...bottom, ...topPts.reverse()], s > 0 ? "#8a3e2a" : "#6a2e20");
          for (let k = 2; k < N; k += 3) { const q = at(k / N, s, 2.5); ctx.fillStyle = "#2a1a14"; ctx.fillRect(q[0] - lw(1), q[1] - lw(1), lw(2), lw(1.5)); }
        } else if (type === "truss") {
          const H = rail ? 9 : 8;
          const top = ts.map((t) => at(t, s, H));
          line(top, steel, 1.6);
          line(ts.map((t) => at(t, s, 0.3)), steel, 1.4);
          const panels = Math.max(4, Math.round(len * 1.6));
          for (let k = 0; k <= panels; k++) {
            const t = k / panels;
            seg(at(t, s, 0.3), at(t, s, H), steel, 1);
            if (k < panels) seg(at(k % 2 ? t : (k + 1) / panels, s, 0.3), at(k % 2 ? (k + 1) / panels : t, s, H), steel, 0.8);
          }
        } else if (type === "lenticular") {
          // Smithfield Street: lens-shaped trusses over each span
          const spans = [0, ...piers, 1];
          for (let k = 0; k + 1 < spans.length; k++) {
            const t0 = spans[k], t1 = spans[k + 1];
            const up: [number, number][] = [], dn: [number, number][] = [];
            for (let j = 0; j <= 16; j++) { const t = t0 + ((t1 - t0) * j) / 16, f = Math.sin((Math.PI * j) / 16); up.push(at(t, s, 1 + f * 9)); dn.push(at(t, s, 1 - f * 4)); }
            line(up, steel, 1.8); line(dn, steel, 1.4);
            for (let j = 1; j < 16; j += 2) seg(up[j], dn[j], steel, 0.7);
            const portal = at(t0, s, 0), portal2 = at(t0, s, 10);
            seg(portal, portal2, "#7a6a5a", 2.2);
          }
        } else if (type === "suspension") {
          const towers = [0.2, 0.8], TH = rail ? 20 : 18;
          for (const t of towers) seg(at(t, s, -1), at(t, s, TH), built >= 1920 ? steel : "#8a8272", built >= 1920 ? 2.4 : 3.2);
          const cable: [number, number][] = [];
          for (const t of ts) {
            let zc: number;
            if (t < 0.2) zc = TH * (t / 0.2) ** 1.4;
            else if (t > 0.8) zc = TH * ((1 - t) / 0.2) ** 1.4;
            else { const u = (t - 0.5) / 0.3; zc = 2 + (TH - 2) * u * u; }
            cable.push(at(t, s, zc));
          }
          // the 1920s eyebar chains carry the paint (gold Sisters); older wire cables stay dark
          const painted = !rail && built >= 1920;
          line(cable, painted ? steel : "#2a2a2e", painted ? 1.7 : 1.3);
          for (let k = 1; k < N; k++) { const t = k / N; if (k % 2) continue; seg(at(t, s, 0.5), cable[k], painted ? shade6(steel, 0.8) : "#4a4a50", 0.6); }
          ctx.fillStyle = "#2a2a2e";
          line(ts.map((t) => at(t, s, 1.2)), "#3a3a40", 0.8);
        } else if (type === "arch") {
          if (built >= 1940) {
            // tied arch above the deck
            const arch: [number, number][] = ts.map((t) => at(t, s, 2 + Math.sin(Math.PI * Math.min(1, Math.max(0, (t - 0.1) / 0.8))) * 16 * (t > 0.1 && t < 0.9 ? 1 : 0)));
            line(arch, steel, 2.4);
            for (let k = 2; k < N - 1; k += 2) { const t = k / N; if (t > 0.12 && t < 0.88) seg(at(t, s, 0.5), arch[k], steel, 0.7); }
          } else {
            // deck arch springing from the piers, spandrel columns up to the deck
            const t0 = 0.12, t1 = 0.88;
            const arch: [number, number][] = [];
            for (let j = 0; j <= 24; j++) { const t = t0 + ((t1 - t0) * j) / 24; const f = Math.sin((Math.PI * j) / 24); const zz = (wl + 2 - hAt(t)) * (1 - f) - 0.8 * f; arch.push(at(t, s, zz)); }
            line(arch, s > 0 ? "#8a96a4" : steel, 3);
            for (let j = 2; j < 24; j += 2) { const t = t0 + ((t1 - t0) * j) / 24; seg(arch[j], at(t, s, 0), steel, 1); }
          }
          line(ts.map((t) => at(t, s, 1)), "#c8c4b8", 0.8); // railing
        }
      };

      // far side, deck, fascia, near side, covered roof
      side(-1);
      const far = ts.map((t) => at(t, -1)), near = ts.map((t) => at(t, 1));
      const deckCol = rail ? "#3e3a36" : type === "covered" ? "#7a5a3a" : built >= 1920 ? "#6a6a6a" : "#8a7656";
      poly([...far, ...[...near].reverse()], deckCol);
      if (!rail && z >= 0.375) line(ts.map((t) => at(t, 0, 0.05)), built >= 1920 ? "#c8c040" : "#6e5c44", 0.5);
      if (rail && z >= 0.375) { line(ts.map((t) => at(t, -0.3, 0.1)), "#a8a8b0", 0.6); line(ts.map((t) => at(t, 0.3, 0.1)), "#a8a8b0", 0.6); }
      const fasc = ts.map((t) => at(t, 1, -1.8));
      poly([...near, ...[...fasc].reverse()], type === "covered" ? "#5a2a1c" : paint.girder);
      side(1);
      if (type === "covered") {
        const rf = ts.map((t) => at(t, -1, 5.5)), rn = ts.map((t) => at(t, 1, 5.5)), ridge = ts.map((t) => at(t, 0, 8));
        poly([...rf, ...[...ridge].reverse()], "#4a4038");
        poly([...ridge, ...[...rn].reverse()], "#5e5248");
      }
      if (type === "truss" && z >= 0.375) {
        for (let k = 0; k <= N; k += 3) seg(at(k / N, -1, rail ? 9 : 8), at(k / N, 1, rail ? 9 : 8), steel, 0.7);
      }
    }
    ctx.restore();
  }

  // ------------------------------------------------------------ tunnel portals (drawn live over the terrain)
  private portalSprites = new Map<string, Sprite>();
  /**
   * Portals that face the camera, drawn after the terrain like the bridges: a portal is cut into a slope, and
   * on a 30 m grid the hill beside a one-tile cutting would otherwise bury it.
   */
  drawPortals(ctx: CanvasRenderingContext2D, cam: Camera, g: GameState) {
    const m = this.map, z = cam.zoom, year = g.world.year, V = m.width + 1;
    const cw = ctx.canvas.width, ch = ctx.canvas.height;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.imageSmoothingEnabled = false;
    const list = portals(m).filter((p) => (p.face === "x+" || p.face === "y+") && portalState(p, year) >= 0).sort((p, q) => p.x + p.y - (q.x + q.y));
    for (const p of list) {
      const hc = (m.vert[p.y * V + p.x] + m.vert[p.y * V + p.x + 1] + m.vert[(p.y + 1) * V + p.x] + m.vert[(p.y + 1) * V + p.x + 1]) / 4;
      const [wx, wy] = project(p.x + 0.5, p.y + 0.5, hc);
      const sx = (wx - cam.x) * z, sy = (wy - cam.y) * z;
      if (sx < -200 || sx > cw + 200 || sy < -200 || sy > ch + 400) continue;
      const key = this.portalKeyFor(p, year);
      let sp = this.portalSprites.get(key);
      if (!sp) { sp = cropSprite(buildPortal(key)); this.portalSprites.set(key, sp); }
      ctx.drawImage(sp.canvas, Math.round(sx - sp.ax * z), Math.round(sy - sp.ay * z), Math.round(sp.canvas.width * z), Math.round(sp.canvas.height * z));
    }
    ctx.restore();
  }

  // ------------------------------------------------------------ inclines (drawn live, cars run)
  /** Timber trestle on a straight grade from foot to head, with two counterbalanced cars. */
  /** the player's rail siding: ballast, ties and rails from the works to the main line */
  /** memorials where strikers were killed: a small stone obelisk with a wreath */
  drawMemorials(ctx: CanvasRenderingContext2D, cam: Camera, g: GameState) {
    const ms = g.memorials;
    if (!ms?.length) return;
    const m = this.map, z = cam.zoom;
    ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0);
    for (const mm of ms) {
      const x = Math.max(0, Math.min(m.width - 1, mm.x)), y = Math.max(0, Math.min(m.height - 1, mm.y));
      const [wx, wy] = project(x + 0.5, y + 0.5, m.elevation[y * m.width + x]);
      const sx = Math.round((wx - cam.x) * z), sy = Math.round((wy - cam.y) * z), k = Math.max(1, z * 2);
      ctx.fillStyle = "rgba(0,0,0,0.3)"; ctx.fillRect(sx - 4 * k, sy - 1 * k, 8 * k, 2 * k);
      ctx.fillStyle = "#8a8a84"; ctx.fillRect(sx - 3 * k, sy - 2 * k, 6 * k, 2 * k);
      ctx.fillStyle = "#c8c4b8"; ctx.beginPath(); ctx.moveTo(sx - 1.5 * k, sy - 2 * k); ctx.lineTo(sx + 1.5 * k, sy - 2 * k); ctx.lineTo(sx + 0.8 * k, sy - 11 * k); ctx.lineTo(sx, sy - 13 * k); ctx.lineTo(sx - 0.8 * k, sy - 11 * k); ctx.closePath(); ctx.fill();
      ctx.fillStyle = "#9a9890"; ctx.fillRect(sx, sy - 11 * k, 0.8 * k, 9 * k);
      ctx.fillStyle = "#3a6a34"; ctx.beginPath(); ctx.arc(sx, sy - 5 * k, 1.4 * k, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#b03028"; ctx.fillRect(sx - 0.4 * k, sy - 4 * k, 0.8 * k, 1.5 * k);
    }
    ctx.restore();
  }

  drawSpur(ctx: CanvasRenderingContext2D, cam: Camera, g: GameState) {
    const c = g.company;
    if (!c?.spur) return;
    const m = this.map, z = cam.zoom;
    const S = (x: number, y: number): [number, number] => { const xi = Math.max(0, Math.min(m.width - 1, Math.floor(x))), yi = Math.max(0, Math.min(m.height - 1, Math.floor(y))); const [wx, wy] = project(x, y, m.elevation[yi * m.width + xi] + 0.4); return [(wx - cam.x) * z, (wy - cam.y) * z]; };
    const [tx, ty] = c.spur;
    const ex = Math.max(c.x, Math.min(c.x + c.footprint, tx + 0.5)), ey = Math.max(c.y, Math.min(c.y + c.footprint, ty + 0.5));
    const len = Math.hypot(tx + 0.5 - ex, ty + 0.5 - ey);
    const n = Math.max(2, Math.ceil(len * 4));
    const ux = (tx + 0.5 - ex) / (len || 1), uy = (ty + 0.5 - ey) / (len || 1), vx = -uy * 0.09, vy = ux * 0.09;
    ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.lineCap = "round";
    const line = (off: number, col: string, wpx: number) => {
      ctx.strokeStyle = col; ctx.lineWidth = Math.max(1, wpx * z); ctx.beginPath();
      for (let k = 0; k <= n; k++) { const f = k / n; const [sx, sy] = S(ex + (tx + 0.5 - ex) * f + vx * off, ey + (ty + 0.5 - ey) * f + vy * off); if (k) ctx.lineTo(sx, sy); else ctx.moveTo(sx, sy); }
      ctx.stroke();
    };
    line(0, "#5c544a", 9);
    ctx.strokeStyle = "#4a3626"; ctx.lineWidth = Math.max(1, 1.5 * z);
    for (let k = 0; k <= n * 2; k++) { const f = k / (n * 2); const px = ex + (tx + 0.5 - ex) * f, py = ey + (ty + 0.5 - ey) * f; const a = S(px + vx * 1.6, py + vy * 1.6), b = S(px - vx * 1.6, py - vy * 1.6); ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke(); }
    line(1, "#a8a8b0", 1.2); line(-1, "#a8a8b0", 1.2);
    ctx.restore();
  }

  /** v0.32: the straight line (foot to head, tile coords) of an incline passing this tile or the next one */
  private inclineIdx: { n: number; idx: Map<number, [number, number, number, number]> } | null = null;
  private inclineLineNear(w: GameState["world"], x: number, y: number): [number, number, number, number] | null {
    const W = this.map.width;
    const sig = w.inclines.reduce((a, inc) => a + inc.id * 97 + inc.path.length, w.inclines.length);
    if (!this.inclineIdx || this.inclineIdx.n !== sig) {
      const idx = new Map<number, [number, number, number, number]>();
      for (const inc of w.inclines) {
        if (inc.path.length < 2) continue;
        const [x0, y0] = inc.path[0], [x1, y1] = inc.path[inc.path.length - 1];
        const L: [number, number, number, number] = [x0 + 0.5, y0 + 0.5, x1 + 0.5, y1 + 0.5];
        for (const [px, py] of inc.path) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) idx.set((py + dy) * W + px + dx, L);
      }
      this.inclineIdx = { n: sig, idx };
    }
    return this.inclineIdx.idx.get(y * W + x) ?? null;
  }

  drawInclines(ctx: CanvasRenderingContext2D, cam: Camera, g: GameState, t: number) {
    const m = this.map, z = cam.zoom;
    const S = (x: number, y: number, h: number): [number, number] => { const [wx, wy] = project(x, y, h); return [(wx - cam.x) * z, (wy - cam.y) * z]; };
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    for (const inc of g.world.inclines) {
      const path = inc.path;
      if (path.length < 2) continue;
      const [x0, y0] = path[0], [x1, y1] = path[path.length - 1];
      const N = Math.max(4, Math.round(Math.hypot(x1 - x0, y1 - y0) * 4));
      // v0.32: one smooth profile over the whole run, not a step per tile. The ground under the line (bilinear, so it
      // doesn't step at tile edges), eased over about a tile and a half; the deck is that or the straight grade from
      // station to station, whichever is higher (on trestles over a dip, never buried in the hill), eased again so the
      // grade bends gently, and made to climb all the way (an incline never dips)
      const gx = (f: number) => x0 + 0.5 + (x1 - x0) * f, gy = (f: number) => y0 + 0.5 + (y1 - y0) * f;
      const ground: number[] = [];
      for (let k = 0; k <= N; k++) ground.push(heightAt(m, gx(k / N), gy(k / N)));
      const ease = (a: number[], r: number) => a.map((_, k) => { let s2 = 0, n2 = 0; for (let q = Math.max(0, k - r); q <= Math.min(a.length - 1, k + r); q++) { s2 += a[q]; n2++; } return s2 / n2; });
      const h0 = ground[0] + 1.5, h1 = ground[N] + 1.5;
      let prof = ease(ground, 3).map((gh, k) => Math.max(gh + 1, h0 + (h1 - h0) * (k / N)));
      prof[0] = h0; prof[N] = h1;
      prof = ease(prof, 2); prof[0] = h0; prof[N] = h1;
      const up = h1 >= h0;
      for (let k = 1; k <= N; k++) prof[k] = up ? Math.max(prof[k], prof[k - 1]) : Math.min(prof[k], prof[k - 1]);
      const A = S(gx(0), gy(0), h0), B = S(gx(1), gy(1), h1);
      if (Math.max(A[0], B[0]) < -50 || Math.min(A[0], B[0]) > ctx.canvas.width + 50 || Math.max(A[1], B[1]) < -50 || Math.min(A[1], B[1]) > ctx.canvas.height + 50) continue;
      const deck = (k: number): [number, number, number, number, number] => [gx(k / N), gy(k / N), prof[k], ground[k], k / N];
      // trestle bents
      ctx.strokeStyle = "#3e2e1e";
      ctx.lineWidth = Math.max(1, 1.2 * z);
      for (let k = 1; k < N; k += 2) {
        const [fx, fy, h, ground] = deck(k);
        if (h - ground < 1.5) continue;
        const a = S(fx, fy, h), b = S(fx, fy, ground);
        ctx.beginPath(); ctx.moveTo(a[0] - 3 * z, a[1]); ctx.lineTo(b[0] - 5 * z, b[1]); ctx.moveTo(a[0] + 3 * z, a[1]); ctx.lineTo(b[0] + 5 * z, b[1]);
        ctx.moveTo(a[0] - 3 * z, (a[1] + b[1]) / 2); ctx.lineTo(a[0] + 3 * z, (a[1] + b[1]) / 2); ctx.stroke();
      }
      // deck and rails
      const pts: [number, number][] = [];
      for (let k = 0; k <= N; k++) { const [fx, fy, h] = deck(k); pts.push(S(fx, fy, h)); }
      const stroke = (col: string, w: number, dy = 0) => { ctx.strokeStyle = col; ctx.lineWidth = w; ctx.beginPath(); pts.forEach(([px, py], k) => (k ? ctx.lineTo(px, py + dy) : ctx.moveTo(px, py + dy))); ctx.stroke(); };
      stroke("#3a2a1c", Math.max(3, 11 * z));
      stroke("#6e5638", Math.max(2, 8 * z), -1 * z);
      stroke("#8a7050", Math.max(1, 2 * z), -3 * z);
      stroke("#b8b8c0", Math.max(1, 0.8 * z), -2 * z);
      // two cars, counterbalanced
      const ph = (Math.sin(t * 0.25 + inc.id) + 1) / 2;
      for (const f of [ph, 1 - ph]) {
        const k = f * N, k0 = Math.floor(k), k1 = Math.min(N, k0 + 1), r = k - k0;
        const p0 = pts[k0], p1 = pts[k1];
        const cx = p0[0] + (p1[0] - p0[0]) * r, cy = p0[1] + (p1[1] - p0[1]) * r;
        const w = 9 * z, hh = 9 * z;
        ctx.fillStyle = "#a8302a"; ctx.fillRect(cx - w / 2, cy - hh - 2 * z, w, hh);
        ctx.fillStyle = "#6a1e1a"; ctx.fillRect(cx - w / 2, cy - hh - 3 * z, w, 1.5 * z);
        ctx.fillStyle = "#f0e0b0"; ctx.fillRect(cx - w / 2 + 1.5 * z, cy - hh + 0.5 * z, w - 3 * z, 2.5 * z);
      }
    }
    ctx.restore();
  }

  // ------------------------------------------------------------ animation layer
  /**
   * Smoke, steam, furnace glow and flame from running works; night falls with lit windows and lamps.
   * Drawn on top of the cached chunks every frame. `t` in seconds, `night` 0..1.
   */
  drawAnimated(ctx: CanvasRenderingContext2D, cam: Camera, g: GameState, t: number, night: number) {
    const cw = ctx.canvas.width, ch = ctx.canvas.height, z = cam.zoom;
    const toS = (wx: number, wy: number): [number, number] => [(wx - cam.x) * z, (wy - cam.y) * z];
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    // night sky over the land
    if (night > 0.02) {
      // moonlight: dark enough for the windows and lamps to read, light enough to see the town and the rivers
      ctx.fillStyle = `rgba(22,30,66,${(night * 0.5).toFixed(3)})`;
      ctx.fillRect(0, 0, cw, ch);
      if (z >= 0.375) this.drawLights(ctx, cam, g, night);
    }
    this.updateLooks(g);
    const wind = windFor(g);
    ctx.imageSmoothingEnabled = true;
    // smoke and steam first, then the fires on top (additive), so a furnace lights its own smoke
    for (const e of this.emitters) {
      if (!e.running || (e.kind !== "smoke" && e.kind !== "steam")) continue;
      const [sx, sy] = toS(e.wx, e.wy);
      if (sx < -260 * z || sx > cw + 360 * z || sy < -40 || sy > ch + 260 * z) continue;
      drawPlume(ctx, sx, sy, e.size * z, e.kind === "steam", e.seed, this.looks[e.group], wind, t, night);
    }
    ctx.globalCompositeOperation = "lighter";
    for (const e of this.emitters) {
      if (!e.running || (e.kind !== "glow" && e.kind !== "flame")) continue;
      const [sx, sy] = toS(e.wx, e.wy);
      if (sx < -80 || sx > cw + 80 || sy < -80 || sy > ch + 80) continue;
      drawFire(ctx, sx, sy, e.size * z, e.kind === "flame", e.size >= 1.2, e.seed, this.looks[e.group].heat, wind, t, night);
    }
    // v0.31: the furnaces light the sky and the smoke over them, the Bessemers flare, the rivers carry it all
    this.drawPours(ctx, cam, g, t, night);
    if (DETAIL > 0 && t > 0 && z >= 0.5 && g.turn % 4 >= 2) this.drawChimneys(ctx, cam, g, t, night);
    if (night > 0.02 && DETAIL > 0) this.drawNightGlow(ctx, cam, g, t, night);
    ctx.globalCompositeOperation = "source-over";
    ctx.restore();
  }

  /**
   * Coal fires in the houses in the autumn and winter seasons: a thin wisp of smoke from the chimneys, leaning
   * downwind (one house in four or so at any moment, so the street doesn't look on fire).
   */
  private drawChimneys(ctx: CanvasRenderingContext2D, cam: Camera, g: GameState, t: number, night: number) {
    const m = this.map, w = g.world, z = cam.zoom, cw = ctx.canvas.width, ch = ctx.canvas.height;
    const corners = [[0, 0], [cw, 0], [cw, ch], [0, ch]].map(([px, py]) => {
      const wx = cam.x + px / z, wy = cam.y + py / z + (260 - BASE_M) * ZPX;
      const a = wx / HW, b = wy / HH;
      return [(a + b) / 2, (b - a) / 2];
    });
    const x0 = Math.max(0, Math.floor(Math.min(...corners.map((c) => c[0]))) - 2), x1 = Math.min(m.width - 1, Math.ceil(Math.max(...corners.map((c) => c[0]))) + 4);
    const y0 = Math.max(0, Math.floor(Math.min(...corners.map((c) => c[1]))) - 2), y1 = Math.min(m.height - 1, Math.ceil(Math.max(...corners.map((c) => c[1]))) + 4);
    const wind = windFor(g);
    const winter = g.turn % 4 === 3;
    const shade = Math.round(150 - night * 70);
    let drawn = 0;
    for (let y = y0; y <= y1 && drawn < 700; y++) for (let x = x0; x <= x1 && drawn < 700; x++) {
      const i = y * m.width + x, u = w.use[i];
      if (!(u === Use.Cottage || u === Use.Houses || u === Use.Rowhouses) || !w.pop[i]) continue;
      if (hash(x, y, 990) > (winter ? 0.35 : 0.18)) continue;
      const [wx, wy] = project(x + 0.5, y + 0.5, m.elevation[i]);
      const sx = (wx - cam.x) * z + (hash(x, y, 991) - 0.5) * 30 * z, sy = (wy - cam.y) * z - (u === Use.Rowhouses ? 34 : 24) * z;
      if (sx < -30 || sx > cw + 30 || sy < -60 || sy > ch + 10) continue;
      drawn++;
      for (let k = 0; k < 4; k++) {
        const ph = ((t * 0.35 + hash(x, y, 992) + k / 4) % 1);
        const rise = ph * 22 * z, lean = ph * ph * 14 * z * wind.s;
        const px = sx + wind.x * lean + Math.sin(t * 1.3 + k + x) * 1.2 * z, py = sy - rise + wind.y * lean * 0.3;
        ctx.globalAlpha = (1 - ph) * 0.32;
        ctx.fillStyle = `rgb(${shade},${shade},${shade + 6})`;
        const r = Math.max(1, (1.2 + ph * 3.5) * z);
        ctx.fillRect(Math.round(px - r / 2), Math.round(py - r / 2), Math.round(r), Math.round(r));
      }
    }
    ctx.globalAlpha = 1;
  }

  /** is this screen point over the river? (inverse projection at the river's level) */
  private waterAt(cam: Camera, sx: number, sy: number): boolean {
    const m = this.map, z = cam.zoom;
    const wx = cam.x + sx / z, wy = cam.y + sy / z + (RIVER_M - BASE_M) * ZPX;
    const a = wx / HW, b = wy / HH;
    const x = Math.floor((a + b) / 2), y = Math.floor((b - a) / 2);
    if (x < 0 || y < 0 || x >= m.width || y >= m.height) return false;
    return m.terrain[y * m.width + x] === Terrain.Water;
  }

  /**
   * "Hell with the lid off": each furnace's glow lights the sky and the underside of its smoke, a Bessemer blow
   * flares every twenty seconds or so and throws the whole works into light, and every bright light near the
   * water lays a broken, shimmering streak across the river.
   */
  private drawNightGlow(ctx: CanvasRenderingContext2D, cam: Camera, _g: GameState, t: number, night: number) {
    const z = cam.zoom, cw = ctx.canvas.width, ch = ctx.canvas.height;
    ctx.globalCompositeOperation = "lighter";
    const sky = skyGlow();
    // one broad glow per works (its furnaces together), not a pile of overlapping ones that blow out to white
    const groups = new Map<number, { x: number; y: number; n: number; size: number }>();
    for (const e of this.emitters) {
      if (!e.running || (e.kind !== "glow" && e.kind !== "flame")) continue;
      const gr = groups.get(e.group) ?? { x: 0, y: 0, n: 0, size: 0 };
      gr.x += e.wx; gr.y += e.wy; gr.n++; gr.size += e.size;
      groups.set(e.group, gr);
    }
    const lights: { sx: number; sy: number; R: number; a: number; seed: number }[] = [];
    for (const [grp, gr] of groups) {
      const sx = (gr.x / gr.n - cam.x) * z, sy = (gr.y / gr.n - cam.y) * z;
      const heat = this.looks[grp]?.heat ?? 0.6;
      const R = (170 + 50 * Math.sqrt(gr.size)) * z;
      if (sx < -R || sx > cw + R || sy < -R || sy > ch + R * 1.5) continue;
      lights.push({ sx, sy: sy - 30 * z, R, a: night * (0.24 + heat * 0.3), seed: grp });
    }
    // a Bessemer blow: a few seconds of white-orange light every ~20 s, each converter on its own beat
    for (const e of this.emitters) {
      if (!e.running || e.kind !== "flame" || e.size < 1.2) continue;
      const ph = ((t + e.seed * 13.7) % 21) / 21;
      const blow = ph < 0.16 ? Math.sin((ph / 0.16) * Math.PI) : 0;
      if (blow <= 0) continue;
      const sx = (e.wx - cam.x) * z, sy = (e.wy - cam.y) * z;
      lights.push({ sx, sy, R: (110 + 160 * blow) * z, a: night * 0.4 * blow, seed: e.seed });
    }
    for (const L of lights) {
      if (L.a < 0.01) continue;
      ctx.globalAlpha = Math.min(1, L.a);
      ctx.drawImage(sky, L.sx - L.R, L.sy - L.R * 0.75, L.R * 2, L.R * 1.5);
      // the reflection: down from the light to the river, a column of broken orange dashes
      if (z < 0.25) continue;
      let first = -1;
      for (let k = 4; k < 200; k += 4) if (this.waterAt(cam, L.sx, L.sy + k * z)) { first = k; break; }
      if (first < 0) continue;
      for (let k = 0; k < 28; k++) {
        const yy = L.sy + (first + k * 3.2) * z;
        if (!this.waterAt(cam, L.sx, yy)) break;
        const flick = hash(k, Math.floor(t * 6 + L.seed), 980);
        const wv = (8 + 14 * (1 - k / 28)) * z * (0.6 + flick * 0.8) * Math.min(1.6, L.R / (150 * z));
        ctx.globalAlpha = Math.min(1, L.a * 2.2) * (1 - k / 28) * (0.5 + flick * 0.5);
        ctx.fillStyle = k < 4 ? "#ffd890" : "#ff9a40";
        ctx.fillRect(Math.round(L.sx - wv / 2 + (flick - 0.5) * 4 * z), Math.round(yy), Math.max(1, Math.round(wv)), Math.max(1, Math.round(1.2 * z)));
      }
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
  }

  /** the slag dumps' edges where the ladles are tipping now (worked out once a turn) */
  private pourTiles: { x: number; y: number; h: number }[] = [];
  private pourKey = "";
  /** molten slag poured down a dump's face: a glowing run that cools over a few seconds; brightest at night */
  private drawPours(ctx: CanvasRenderingContext2D, cam: Camera, g: GameState, t: number, night: number) {
    const w = g.world, m = this.map, W = m.width;
    if (!w.slag || DETAIL === 0) return;
    const key = `${g.turn}|${w.slagN}|${g.seed}`;
    if (key !== this.pourKey) {
      this.pourKey = key;
      this.pourTiles = [];
      const hot: [number, number][] = g.plants.filter((p) => p.output > 0 && this.isSteel(g, p.owner)).map((p) => [p.x + p.fp / 2, p.y + p.fp / 2]);
      for (let i = 0; i < w.slag.length; i++) {
        if (!w.slag[i] || w.use[i] !== Use.Rock) continue;
        const x = i % W, y = (i / W) | 0;
        if (!hot.some(([hx, hy]) => Math.hypot(hx - x, hy - y) < 26)) continue;
        let edge = false;
        for (const [dx, dy] of [[1, 0], [0, 1], [1, 1]]) { const nx = x + dx, ny = y + dy; if (nx < W && ny < m.height && !w.slag[ny * W + nx]) edge = true; }
        if (edge) this.pourTiles.push({ x, y, h: m.elevation[i] });
      }
    }
    if (!this.pourTiles.length) return;
    const z = cam.zoom, cw = ctx.canvas.width, ch = ctx.canvas.height;
    ctx.globalCompositeOperation = "lighter";
    for (const p of this.pourTiles) {
      const ph = ((t + hash(p.x, p.y, 981) * 40) % 40) / 40;
      if (ph > 0.12) continue;
      const k = ph / 0.12; // 0 → 1: pour, then cool
      const [wx, wy] = project(p.x + 0.6, p.y + 0.6, p.h);
      const sx = (wx - cam.x) * z, sy = (wy - cam.y) * z;
      if (sx < -50 || sx > cw + 50 || sy < -50 || sy > ch + 80) continue;
      const len = Math.min(1, k * 3) * 22 * z, cool = k < 0.35 ? 1 : 1 - (k - 0.35) / 0.65;
      const a = cool * (0.35 + night * 0.65);
      ctx.globalAlpha = a;
      ctx.fillStyle = "#ffb040";
      ctx.fillRect(Math.round(sx), Math.round(sy), Math.max(1, Math.round(2 * z)), Math.round(len));
      ctx.fillStyle = "#ff6020";
      ctx.fillRect(Math.round(sx - z), Math.round(sy + len * 0.5), Math.max(1, Math.round(4 * z)), Math.round(len * 0.5));
      if (night > 0.05) { ctx.globalAlpha = a * 0.5; const R = 40 * z; ctx.drawImage(skyGlow(), sx - R, sy - R * 0.5, R * 2, R * 1.4); }
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
  }
  private isSteel(g: GameState, owner: string): boolean {
    if (owner.startsWith("p")) return (g.company && [g.company, ...g.company.others].find((x) => x.id === owner)?.industry) === "steel";
    return RIVALS.find((d) => d.id === owner)?.industry === "steel";
  }

  /** Lit windows and street lamps after dark (visible tiles only). */
  private drawLights(ctx: CanvasRenderingContext2D, cam: Camera, g: GameState, night: number) {
    const m = this.map, w = g.world, z = cam.zoom;
    const cw = ctx.canvas.width, ch = ctx.canvas.height;
    const corners = [[0, 0], [cw, 0], [cw, ch], [0, ch]].map(([px, py]) => {
      const wx = cam.x + px / z, wy = cam.y + py / z + (260 - BASE_M) * ZPX;
      const a = wx / HW, b = wy / HH;
      return [(a + b) / 2, (b - a) / 2];
    });
    const x0 = Math.max(0, Math.floor(Math.min(...corners.map((c) => c[0]))) - 4), x1 = Math.min(m.width - 1, Math.ceil(Math.max(...corners.map((c) => c[0]))) + 8);
    const y0 = Math.max(0, Math.floor(Math.min(...corners.map((c) => c[1]))) - 4), y1 = Math.min(m.height - 1, Math.ceil(Math.max(...corners.map((c) => c[1]))) + 8);
    ctx.globalCompositeOperation = "lighter";
    const a = Math.min(1, night * 1.3);
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const i = y * m.width + x;
      const u = w.use[i];
      const lampTile = w.street[i] && w.street[i] !== Street.Bridge && (x * 3 + y) % 4 === 0 && this.denseStreet(g, x, y);
      if (!(u >= Use.Cottage && u <= Use.Civic || u === Use.Commerce) && !lampTile) continue;
      const [wx, wy] = project(x + 0.5, y + 0.5, m.elevation[i]);
      const sx = (wx - cam.x) * z, sy = (wy - cam.y) * z;
      if (sx < -20 || sy < -40 || sx > cw + 20 || sy > ch + 20) continue;
      if (lampTile) {
        // a soft pool of lamplight (a cached radial sprite), not a flat disc
        const r = 9 * z;
        ctx.globalAlpha = 0.55 * a;
        ctx.drawImage(lampGlow(), sx - 24 * z - r, sy - 12 * z - r, r * 2, r * 2);
        ctx.globalAlpha = 1;
        if (!(u >= Use.Cottage)) continue;
      }
      if (w.pop[i] === 0 && u !== Use.Commerce && u !== Use.Civic) continue;
      const lit = u === Use.Rowhouses ? 5 : u === Use.Commerce ? 4 : u === Use.Houses ? 3 : 1;
      for (let k = 0; k < lit; k++) {
        if (hash(x * 7 + k, y, 77 + Math.floor(Date.now() / 20000)) > 0.65) continue;
        const ox = (hash(x, y * 3 + k, 78) - 0.5) * 44 * z, oy = -(4 + hash(x + k, y, 79) * 22) * z;
        ctx.fillStyle = `rgba(255,210,120,${(0.85 * a).toFixed(3)})`;
        ctx.fillRect(Math.round(sx + ox), Math.round(sy + oy), Math.max(1, Math.round(2 * z)), Math.max(1, Math.round(2 * z)));
      }
    }
    ctx.globalCompositeOperation = "source-over";
  }

  // ------------------------------------------------------------ overlays drawn live
  private drawMarks(ctx: CanvasRenderingContext2D, cam: Camera, mk: Marks) {
    const m = this.map;
    const toScreen = ([x, y]: [number, number]): [number, number] => [(x - cam.x) * cam.zoom, (y - cam.y) * cam.zoom];
    const outline = (x: number, y: number, stroke: string, fill?: string) => {
      const pts = tileCorners(m, x, y).map(toScreen);
      ctx.beginPath();
      pts.forEach((p, k) => (k ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])));
      ctx.closePath();
      if (fill) { ctx.fillStyle = fill; ctx.fill(); }
      ctx.strokeStyle = stroke;
      ctx.lineWidth = 1.5;
      ctx.stroke();
    };
    if (mk.footprint) {
      const f = mk.footprint;
      const corners: [number, number][] = [[f.x, f.y], [f.x + f.size, f.y], [f.x + f.size, f.y + f.size], [f.x, f.y + f.size]];
      const pts = corners.map(([x, y]) => {
        const cx = Math.min(m.width, Math.max(0, x)), cy = Math.min(m.height, Math.max(0, y));
        return toScreen(project(x, y, m.vert[cy * (m.width + 1) + cx]));
      });
      ctx.beginPath();
      pts.forEach((p, k) => (k ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])));
      ctx.closePath();
      ctx.fillStyle = f.ok ? "rgba(90,220,120,0.30)" : "rgba(230,70,60,0.30)";
      ctx.fill();
      ctx.strokeStyle = f.ok ? "#7ef0a0" : "#ff7a6a";
      ctx.lineWidth = 2;
      ctx.stroke();
    }
    if (mk.hover) outline(mk.hover.x, mk.hover.y, "rgba(255,255,255,0.9)");
    if (mk.selected) outline(mk.selected.x, mk.selected.y, "#ffd65a", "rgba(255,214,90,0.15)");
  }

  /** Place names. `reserved`: canvas-pixel rects (minimap, zoom buttons) to keep labels off. */
  drawLabels(ctx: CanvasRenderingContext2D, cam: Camera, g: GameState, reserved: { x: number; y: number; w: number; h: number }[] = [], plats = false) {
    const m = this.map;
    ctx.textAlign = "center";
    const items: { name: string; x: number; y: number; col: string; min: number }[] = [];
    for (const lm of m.landmarks) {
      const col = lm.kind === "historic_site" ? "#ffcf6e" : lm.kind === "hill" ? "#cfe3a0" : lm.kind.startsWith("structure") ? "#c8d8ff" : "#ffffff";
      const min = lm.kind === "town" ? 0 : lm.kind === "hill" ? 0.1875 : 0.5;
      if (lm.kind === "historic_site" && g.world.year < 1870) continue;
      items.push({ name: lm.name, x: lm.x + 0.5, y: lm.y + 0.5, col, min });
    }
    for (const a of ANCHORS) {
      if (m.landmarks.some((l) => l.name.startsWith(a.name))) continue;
      const [ax, ay] = latLonToTile(m, a.lat, a.lon);
      items.push({ name: a.name, x: ax + 0.5, y: ay + 0.5, col: "#b8d8ff", min: 0.375 });
    }
    for (const inc of g.world.inclines) {
      const mid = inc.path[Math.floor(inc.path.length / 2)];
      items.push({ name: inc.name, x: mid[0] + 1.5, y: mid[1] + 0.5, col: "#ffb0a0", min: 0.5 });
    }
    // v0.26: plat names and founding years: on the Plats & wards layer from half size; on the map, named plats close up
    for (const b of g.sleuth?.blocks ?? []) {
      if (!b.land || (!plats && (b.type === "patch" || b.type === "company" || m.landmarks.some((l) => l.name.startsWith(b.name))))) continue;
      items.unshift({ name: `${b.name} ${b.opened}`, x: b.x + 0.5, y: b.y + 0.5, col: plats ? "#ffe6a8" : "#e8d8b8", min: plats ? 0.375 : 1.5 });
    }
    const seen = new Set<string>();
    for (const sp of [...m.spans, ...(g.spans ?? [])]) {
      if (sp.kind !== "road" || seen.has(sp.name) || !stageOf(sp, g.world.year)) continue;
      seen.add(sp.name);
      items.push({ name: sp.name, x: (sp.a[0] + sp.b[0]) / 2, y: (sp.a[1] + sp.b[1]) / 2, col: "#d8c8a8", min: 0.75 });
    }
    // Keep every label wholly inside the canvas: labels whose anchor is on screen are slid in from the
    // edge; ones whose anchor is off screen are dropped. Towns go first, and a label that would sit on
    // top of one already drawn (or on reserved UI such as the minimap) is skipped.
    // drawn under the app's dpr scale: the canvas in this context's own (CSS) pixels
    const sc = ctx.getTransform().a || 1;
    const W = ctx.canvas.width / sc, H = ctx.canvas.height / sc, MG = 4;
    const placed = reserved.map((r) => ({ ...r }));
    const order = items.filter((it) => cam.zoom >= it.min).sort((a, b) => a.min - b.min);
    ctx.textBaseline = "alphabetic";
    for (const it of order) {
      const tx = Math.floor(it.x), ty = Math.floor(it.y);
      const [wx, wy] = project(it.x, it.y, m.elevation[ty * m.width + tx] ?? BASE_M);
      const px = Math.round((wx - cam.x) * cam.zoom), py = Math.round((wy - cam.y) * cam.zoom) - 14;
      if (px < 0 || py < 0 || px > W || py > H) continue;
      const big = it.min === 0;
      ctx.font = big ? "bold 13px ui-monospace, monospace" : "bold 11px ui-monospace, monospace";
      const tw = Math.ceil(ctx.measureText(it.name).width) + 4, asc = big ? 11 : 9, desc = 3;
      if (tw > W - 2 * MG) continue;
      const cx = Math.max(MG + tw / 2, Math.min(W - MG - tw / 2, px));
      const by = Math.max(MG + asc, Math.min(H - MG - desc, py));
      const box = { x: cx - tw / 2, y: by - asc, w: tw, h: asc + desc };
      if (placed.some((p) => box.x < p.x + p.w && box.x + box.w > p.x && box.y < p.y + p.h && box.y + box.h > p.y)) continue;
      placed.push(box);
      placeLabelRects.push(box);
      ctx.textAlign = "center";
      ctx.lineWidth = 3;
      ctx.strokeStyle = "rgba(0,0,0,0.85)";
      ctx.strokeText(it.name, cx, by);
      ctx.fillStyle = it.col;
      ctx.fillText(it.name, cx, by);
    }
    ctx.textAlign = "start"; // later layers draw from the left
  }
}

/** the sprite of a business you own on this tile, if any */
function holdingKey(g: GameState, i: number): string | null {
  const biz = g.company?.holdings?.biz;
  if (!biz?.length) return null;
  const W = g.map.width;
  if (g.world.owner[i]) return null; // never over a works
  for (const b of biz) if (b.y * W + b.x === i) return `hold:${b.id}`;
  return null;
}

function riverAxis(m: GameMap, x: number, y: number): "a" | "b" {
  let ax = 0, ay = 0;
  for (let k = -4; k <= 4; k++) {
    if (x + k >= 0 && x + k < m.width && m.terrain[y * m.width + x + k] === Terrain.Water) ax++;
    if (y + k >= 0 && y + k < m.height && m.terrain[(y + k) * m.width + x] === Terrain.Water) ay++;
  }
  return ax >= ay ? "a" : "b";
}

export function stageOf(sp: { stages: { year: number; type: import("../core/map").BridgeType }[] }, year: number) {
  let st: { year: number; type: import("../core/map").BridgeType } | null = null;
  for (const s of sp.stages) if (s.year <= year) st = s;
  return st;
}

function shade6(col: string, k: number): string {
  const n = parseInt(col.slice(1), 16);
  const c = (v: number) => Math.min(255, Math.round(v * k));
  return `rgb(${c((n >> 16) & 255)},${c((n >> 8) & 255)},${c(n & 255)})`;
}

/** the soft glow of a street lamp, drawn once and scaled */
let lampGlowCanvas: HTMLCanvasElement | null = null;
/**
 * v0.31: the current — faint streaks drawn out along the river's run on open water (not the banks), so the river
 * reads as moving water rather than a flat blue field
 */
function withCurrent(inner: (u: number, v: number, h: number, gx: number, gy: number) => number, ax: "a" | "b") {
  return (u: number, v: number, h: number, gx: number, gy: number) => {
    const c = inner(u, v, h, gx, gy);
    const r = (c >> 16) & 255, b = c & 255;
    if (b < r + 25) return c;
    const line = ax === "a" ? gy * 2 - gx : gy * 2 + gx, along = ax === "a" ? gx : -gx;
    const ln = Math.floor(line / 5), seg = Math.floor((along + hash(ln, 0, 983) * 40) / 26);
    if (((line % 5) + 5) % 5 === 0 && hash(ln, seg, 984) < 0.22 && ((along % 26) + 26) % 26 < 14) return (c & UNLIT) | rgb(Math.min(255, r + 14), Math.min(255, ((c >> 8) & 255) + 16), Math.min(255, b + 18));
    return c;
  };
}
/** the river's pool level (m): the Monongahela and Allegheny pools at the Point are about 710 ft */
const RIVER_M = 219;
let skyGlowCanvas: HTMLCanvasElement | null = null;
/** a broad, soft orange glow (the sky over a furnace) */
function skyGlow(): HTMLCanvasElement {
  if (skyGlowCanvas) return skyGlowCanvas;
  const c = document.createElement("canvas"); c.width = c.height = 64;
  const x = c.getContext("2d")!, gr = x.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, "rgba(255,170,90,0.75)"); gr.addColorStop(0.3, "rgba(240,120,50,0.42)");
  gr.addColorStop(0.65, "rgba(190,70,30,0.14)"); gr.addColorStop(1, "rgba(150,45,20,0)");
  x.fillStyle = gr; x.fillRect(0, 0, 64, 64);
  return (skyGlowCanvas = c);
}
function lampGlow(): HTMLCanvasElement {
  if (lampGlowCanvas) return lampGlowCanvas;
  const c = document.createElement("canvas"); c.width = c.height = 32;
  const x = c.getContext("2d")!, gr = x.createRadialGradient(16, 16, 0, 16, 16, 16);
  gr.addColorStop(0, "rgba(255,236,180,1)"); gr.addColorStop(0.18, "rgba(255,214,140,0.75)");
  gr.addColorStop(0.5, "rgba(255,190,110,0.22)"); gr.addColorStop(1, "rgba(255,170,90,0)");
  x.fillStyle = gr; x.fillRect(0, 0, 32, 32);
  return (lampGlowCanvas = c);
}
