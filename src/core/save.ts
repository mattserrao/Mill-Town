// Saving and loading games in the browser (IndexedDB, so a save can be tens of megabytes).
//
// A save is one gzip-compressed blob: a JSON header (the game state with every typed array replaced by a
// reference) followed by the arrays' bytes. Left out and rebuilt on load: the map (loaded from disk; only the
// ground you graded flat is saved) and the site fields. A decision waiting for your answer
// is saved by the event that raised it and asked again on load.
//
// Slots: "autosave" (written every new year, when you leave the page and when you go to the main menu) and up to
// MAX_SAVES named saves.

import { envDecision } from "./enviro";
import { closureDecision } from "./world";
import { allDecisions } from "./eventdata";
import { complyDecision, lawById } from "./politics";
import { demandDecision } from "./labour";
import { takeoverDecision } from "./owners";
import { FOUNDER_NAMES, startFamily, SURNAMES } from "./family";
import type { IndustryId } from "./industries";
import { buildCommuteNow, cal, fieldsFor, type GameState } from "./game";
import { type GameMap, recomputeElevation } from "./map";
import { recomputeLandValue } from "./town";
import { updateRivers } from "./environment";

/**
 * 1: v0.1–v0.15 · 2: the family (v0.16) · 3: derived fields left out of the save and the graded ground stored
 * as a difference from the map (v0.20). Bump it whenever the shape of the state changes, and teach `migrate`
 * what an older save lacks.
 */
export const SAVE_FORMAT = 3;
export const MAX_SAVES = 12;
export const AUTOSAVE = "autosave";

export interface SaveMeta {
  id: string;
  name: string;
  savedAt: number;
  version: string;
  format: number;
  seed: number;
  year: number;
  season: string;
  company?: string;
  cash?: number;
  bytes: number;
}
interface SaveRecord extends SaveMeta { data: Blob }

// ---------------------------------------------------------------- encoding

const TA = { Uint8Array, Uint16Array, Int16Array, Uint32Array, Int32Array, Float32Array, Float64Array } as const;
type TAName = keyof typeof TA;
/**
 * Keys of the game state that are rebuilt on load, not saved: the map and site fields (from disk), the freight
 * picture (a one-season memory that refills, read only by the renderer) and every travel-time field (`access`,
 * recomputed when missing). The commute, land value and the rivers' load are kept, though they could be
 * recomputed, because they are recomputed on their own schedule: a loaded game must play on exactly as the
 * saved one would have.
 */
const SKIP = new Set(["map", "fields"]);
const SKIP_IN: Record<string, Set<string>> = { env: new Set(["freight"]) };
/**
 * Float fields stored as 16-bit integers at this scale (65535 stands for Infinity), by the path of the object
 * that holds them: long-term soot is 0–3 and full of noise that gzip can't fold (1.8 MB as floats, 60 kB
 * quantized); land value is already whole dollars (so exact); the commute is minutes. The live field is rounded to the same grid
 * when saving, so the saved game and the one on screen agree exactly.
 */
const QUANT: Record<string, Record<string, number>> = {
  world: { pollution: 1024, landValue: 1 },
  commute: { cost: 128, access: 4096, "fields[]": 128 },
};

function encode(g: GameState): { header: string; bufs: ArrayBufferView[] } {
  const bufs: ArrayBufferView[] = [];
  const quantize = (x: Float32Array, scale: number) => {
    const q = new Uint16Array(x.length);
    for (let i = 0; i < x.length; i++) {
      const v = x[i];
      if (!(v < Infinity)) { q[i] = 65535; x[i] = Infinity; continue; }
      q[i] = Math.max(0, Math.min(65534, Math.round(v * scale))); x[i] = q[i] / scale;
    }
    bufs.push(q);
    return { $ta: bufs.length - 1, t: "Uint16Array", q: scale };
  };
  const conv = (v: unknown, top: boolean, parent?: string): unknown => {
    if (v === null || typeof v !== "object") return typeof v === "function" ? undefined : v;
    if (ArrayBuffer.isView(v)) { bufs.push(v); return { $ta: bufs.length - 1, t: v.constructor.name }; }
    if (Array.isArray(v)) return v.map((x) => conv(x, false));
    const o: Record<string, unknown> = {};
    const skipIn = top ? undefined : parent ? SKIP_IN[parent] : undefined;
    const quant = top ? undefined : parent ? QUANT[parent] : undefined;
    for (const [k, x] of Object.entries(v)) {
      if (top && SKIP.has(k)) continue;
      if (skipIn?.has(k)) continue;
      if (k === "access" && ArrayBuffer.isView(x) && parent !== "commute") continue; // the works' travel fields; the commute keeps its own
      if (quant?.[k] && x instanceof Float32Array) { o[k] = quantize(x, quant[k]); continue; }
      if (quant?.[`${k}[]`] && Array.isArray(x) && x.every((e) => e instanceof Float32Array)) { o[k] = (x as Float32Array[]).map((e) => quantize(e, quant[`${k}[]`])); continue; }
      // decisions hold functions: keep the event that raised them
      if (top && k === "pendingDecision") { o[k] = x ? { $dec: (x as { source?: string }).source ?? null } : x; continue; }
      if (top && k === "moreDecisions") { o[k] = (x as { source?: string }[]).map((d) => ({ $dec: d.source ?? null })); continue; }
      o[k] = conv(x, false, top ? k : undefined);
    }
    return o;
  };
  const state = conv(g, true) as Record<string, unknown>;
  // the ground as graded: only the corners that differ from the map
  const m = g.map, idx: number[] = [], val: number[] = [];
  for (let i = 0; i < m.vert.length; i++) if (m.vert[i] !== m.vert0[i]) { idx.push(i); val.push(m.vert[i]); }
  state.$graded = { n: m.vert.length, idx: conv(Int32Array.from(idx), false), val: conv(Float32Array.from(val), false) };
  return { header: JSON.stringify({ format: SAVE_FORMAT, state }), bufs };
}

/** fill in what a save from an older format lacks, so the rest of the game needn't ask */
function migrate(g: GameState, format: number) {
  const s = g as unknown as Record<string, unknown>;
  const need = (k: string, v: unknown) => { if (s[k] === undefined) s[k] = v; };
  // added between v0.16 and v0.19 without a format bump
  need("landmarks", []); need("teams", []); need("strikeAt", []); need("lastStrikes", []); need("pendingRivalFx", []);
  need("placeFx", []); need("pressures", []); need("dryShops", []); need("ruins", []); need("burnt", []); need("headlines", []);
  need("mods", []); need("moreDecisions", []); need("news", []); need("prices", []); need("jobless", 0);
  need("publicWorks", { locks: {} }); need("flags", {});
  if (!(g.publicWorks as { locks?: unknown }).locks) g.publicWorks.locks = {};
  if (g.company) { const c = g.company as unknown as Record<string, unknown>; if (c.others === undefined) c.others = []; }
  // a v1 save: the founder gets a name, and the laws their calendar
  if (format < 2 && g.company && !g.family) startFamily(g, FOUNDER_NAMES[g.seed % FOUNDER_NAMES.length], SURNAMES[(g.seed * 7) % SURNAMES.length]);
}

async function gzip(parts: BlobPart[]): Promise<Blob> {
  const stream = new Blob(parts).stream().pipeThrough(new CompressionStream("gzip"));
  return new Response(stream).blob();
}
async function gunzip(b: Blob): Promise<ArrayBuffer> {
  return new Response(b.stream().pipeThrough(new DecompressionStream("gzip"))).arrayBuffer();
}

/** Pack a game into a compressed blob. */
export async function packGame(g: GameState): Promise<Blob> {
  const { header, bufs } = encode(g);
  const head = new TextEncoder().encode(header);
  const len = new Uint32Array([head.length, bufs.length]);
  // each buffer: its byte length, then the bytes, padded to 8 so every array starts aligned
  const parts: BlobPart[] = [len, head as BlobPart, new Uint8Array((8 - ((8 + head.length) % 8)) % 8)];
  for (const b of bufs) {
    const bytes = new Uint8Array(b.buffer, b.byteOffset, b.byteLength).slice();
    parts.push(new Float64Array([bytes.length]), bytes, new Uint8Array((8 - (bytes.length % 8)) % 8));
  }
  return gzip(parts);
}

/** Unpack a blob into a game on the given map. Throws if the save can't be read. */
export async function unpackGame(blob: Blob, map: GameMap): Promise<GameState> {
  const buf = await gunzip(blob);
  const dv = new DataView(buf);
  const headLen = dv.getUint32(0, true), n = dv.getUint32(4, true);
  const header = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 8, headLen)));
  const format = Number(header.format);
  if (!(format >= 1 && format <= SAVE_FORMAT)) throw new Error(`This save is from a newer version of the game (format ${header.format}).`);
  let at = 8 + headLen; at += (8 - (at % 8)) % 8;
  const arrays: ArrayBuffer[] = [];
  for (let k = 0; k < n; k++) {
    const bytes = dv.getFloat64(at, true); at += 8;
    arrays.push(buf.slice(at, at + bytes));
    at += bytes; at += (8 - (at % 8)) % 8;
  }
  const back = (v: unknown): unknown => {
    if (v === null || typeof v !== "object") return v;
    if (Array.isArray(v)) return v.map(back);
    const o = v as Record<string, unknown>;
    if (typeof o.$ta === "number") {
      const ta = new TA[o.t as TAName](arrays[o.$ta]);
      if (typeof o.q === "number") { const f = new Float32Array(ta.length), inv = 1 / o.q; for (let i = 0; i < ta.length; i++) f[i] = ta[i] === 65535 ? Infinity : ta[i] * inv; return f; }
      return ta;
    }
    for (const k of Object.keys(o)) o[k] = back(o[k]);
    return o;
  };
  const state = back(header.state) as Record<string, unknown>;
  const g = state as unknown as GameState;
  // the map as you left it (the ground graded for your works): the whole surface in older saves, the
  // graded corners only from format 3
  if (state.$graded) {
    const gr = state.$graded as { n: number; idx: Int32Array; val: Float32Array };
    if (gr.n !== map.vert.length) throw new Error("This save was made on a different map.");
    map.vert.set(map.vert0);
    for (let k = 0; k < gr.idx.length; k++) map.vert[gr.idx[k]] = gr.val[k];
  } else {
    const vert = state.$vert as Float32Array;
    if (vert.length !== map.vert.length) throw new Error("This save was made on a different map.");
    map.vert.set(vert);
  }
  delete state.$vert; delete state.$graded;
  recomputeElevation(map);
  g.map = map;
  g.fields = fieldsFor(map);
  migrate(g, format);
  // what the save leaves out
  const nt = map.width * map.height;
  if (!g.world.landValue) { g.world.landValue = new Float32Array(nt); recomputeLandValue(map, g.world); }
  if (!g.env.river) { g.env.river = new Float32Array(nt); updateRivers(map, g.world, g.env, g.plants ?? []); }
  if (!g.env.freight) g.env.freight = new Float32Array(nt);
  if (!g.commute) buildCommuteNow(g);
  // decisions waiting: asked again from the events that raised them
  const decs = allDecisions();
  const redo = (d: unknown) => {
    const src = (d as { $dec?: string } | undefined)?.$dec;
    if (!src) return undefined;
    // the decisions v0.16 raises from the state rather than from an event
    const made = src.startsWith("closure:") ? closureDecision(g, src.slice(8)) ?? undefined
      : src.startsWith("env:") ? envDecision(g, src.split(":")[1], src.split(":").slice(2).join(":")) ?? undefined
      : src.startsWith("law:") ? (lawById(src.slice(4)) ? complyDecision(lawById(src.slice(4))!) : undefined)
      : src.startsWith("demand:") ? demandDecision(g, src.slice(7) as IndustryId) ?? undefined
        : src === "takeover" ? takeoverDecision(g) ?? undefined
          : decs[src]?.(g) ?? undefined;
    if (made) made.source = src;
    return made;
  };
  g.pendingDecision = redo(g.pendingDecision);
  g.moreDecisions = (g.moreDecisions as unknown[]).map(redo).filter((d): d is NonNullable<typeof d> => !!d);
  if (!g.pendingDecision && g.moreDecisions.length) g.pendingDecision = g.moreDecisions.shift();
  return g;
}

// ---------------------------------------------------------------- storage

const DB = "mill-town", STORE = "saves";
function db(): Promise<IDBDatabase> {
  return new Promise((ok, fail) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE, { keyPath: "id" });
    r.onsuccess = () => ok(r.result);
    r.onerror = () => fail(r.error);
  });
}
function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return db().then((d) => new Promise<T>((ok, fail) => {
    const t = d.transaction(STORE, mode), r = fn(t.objectStore(STORE));
    t.oncomplete = () => { ok(r.result); d.close(); };
    t.onerror = t.onabort = () => { fail(t.error ?? r.error); d.close(); };
  }));
}

export function metaOf(g: GameState, id: string, name: string, bytes: number): SaveMeta {
  const c = cal(g);
  return { id, name, savedAt: Date.now(), version: window.__MT_VERSION__?.version ?? "dev", format: SAVE_FORMAT, seed: g.seed, year: c.year, season: c.season, company: g.company?.name, cash: g.company ? Math.round(g.company.cash) : undefined, bytes };
}

let busy: Promise<unknown> = Promise.resolve();
/** Save a game to a slot (the autosave, or a new or existing named save). */
export function saveGame(g: GameState, id = AUTOSAVE, name?: string): Promise<SaveMeta> {
  const job = busy.then(async () => {
    const data = await packGame(g);
    const c = cal(g);
    const meta = metaOf(g, id, name ?? (id === AUTOSAVE ? "Autosave" : `${g.company?.name ?? "No company"} — ${c.season} ${c.year}`), data.size);
    await tx("readwrite", (s) => s.put({ ...meta, data } satisfies SaveRecord));
    if (id !== AUTOSAVE) await prune();
    return meta;
  });
  busy = job.catch(() => undefined);
  return job;
}

/** every save, newest first (without the data) */
export async function listSaves(): Promise<SaveMeta[]> {
  try {
    const all = await tx<SaveRecord[]>("readonly", (s) => s.getAll() as IDBRequest<SaveRecord[]>);
    return all.map(({ data: _d, ...m }) => m).sort((a, b) => b.savedAt - a.savedAt);
  } catch { return []; }
}

export async function loadGame(id: string, map: GameMap): Promise<GameState> {
  await busy;
  const rec = await tx<SaveRecord | undefined>("readonly", (s) => s.get(id) as IDBRequest<SaveRecord | undefined>);
  if (!rec) throw new Error("That save is gone.");
  return unpackGame(rec.data, map);
}

export function deleteSave(id: string): Promise<undefined> {
  return tx("readwrite", (s) => s.delete(id) as IDBRequest<undefined>);
}

/** keep the newest MAX_SAVES named saves */
async function prune() {
  const named = (await listSaves()).filter((m) => m.id !== AUTOSAVE);
  for (const m of named.slice(MAX_SAVES)) await deleteSave(m.id);
}

export const newSaveId = () => `save-${Date.now().toString(36)}`;
