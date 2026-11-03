// Map data (format milltown-map/2): public/maps/<id>.json + <id>.bin (gzip'd typed arrays).
// Built by tools/mapgen/build_map.py from USGS elevation, hydrography and transportation data.
//
// v0.29 (hex test branch): the files are still the 720 x 720 square-tile map. parseMap resamples it onto the hex
// lattice of hex.ts (cells have the area of a 30 m tile), so rivers, rails, bridges and landmarks keep their real
// places; everything after parseMap sees hexagonal cells in axial coordinates.
import { CW, HEX6, HEX_S, HEX_STEP, HEX_STEP_M, cellAt } from "./hex";

export interface Landmark {
  name: string;
  x: number;
  y: number;
  kind: string; // "town" | "hill" | "historic_site" | "structure:<type>"
  lat: number;
  lon: number;
}

interface LayerMeta { type: "int16" | "uint8"; unit: string | null; offset: number; length: number; shape: [number, number] }

export interface MapMeta {
  format: string;
  id: string;
  name: string;
  width: number;
  height: number;
  metersPerTile: number;
  bounds: { north: number; west: number; south: number; east: number };
  binary: string;
  layers: Record<string, LayerMeta>;
  waterNames: Record<string, string>;
  creekNames: Record<string, string>;
  railLines: Record<string, { name: string; year: number }>;
  bridges: Record<string, { id: number; street: string; name: string; year: number }>;
  spans?: Span[];
  /** vector creeks and rail lines in tile coordinates, for smooth drawing */
  lines?: { creek: number[][]; rail: { line: number; pts: number[] }[] };
  landmarks: Landmark[];
  wharves: string[];
  sources: string[];
}

export type BridgeType = "covered" | "suspension" | "lenticular" | "truss" | "arch";
/** A whole bridge as one straight span between abutments (tile coordinates), with its rebuilds over time. */
export interface Span { id: number; kind: "road" | "rail"; name: string; stages: { year: number; type: BridgeType }[]; a: [number, number]; b: [number, number] }

export interface GameMap {
  id: string;
  name: string;
  /** storage size of the hex lattice (axial q = x, r = y); cells outside the mapped area have valid = 0 */
  width: number;
  height: number;
  /** metres between neighbouring cell centres */
  metersPerTile: number;
  bounds: MapMeta["bounds"];
  /** the square source map's size in tiles */
  srcW: number;
  srcH: number;
  /** axial offset of the lattice origin (cell x = q + q0, y = r + r0) */
  q0: number;
  r0: number;
  /** 1 for cells inside the mapped area; the rest of the lattice is off-map "void" (terrain Water, never drawn) */
  valid: Uint8Array;
  /** ground height in metres at each cell centre, width x height. Mutable (grading). Corners are derived (cornerH). */
  vert: Float32Array;
  /** original heights, for resetting a new game */
  vert0: Float32Array;
  /** cell elevation (m), recomputed from vert */
  elevation: Float32Array;
  waterLevel: Float32Array;
  terrain: Uint8Array;
  slope: Uint8Array;
  water: Uint8Array;
  creek: Uint8Array;
  coal: Uint8Array;
  /** today's road network: 0 none, 1 local street, 2 arterial — where streets can appear */
  road: Uint8Array;
  bridge: Uint8Array;
  rail: Uint8Array;
  special: Uint8Array; // 1 = wharf
  waterNames: Record<string, string>;
  creekNames: Record<string, string>;
  railLines: MapMeta["railLines"];
  bridges: MapMeta["bridges"];
  spans: Span[];
  lines: { creek: number[][]; rail: { line: number; pts: number[] }[] };
  landmarks: Landmark[];
  sources: string[];
  minHeight: number;
  maxHeight: number;
}

export const enum Special { None = 0, Wharf = 1 }

/** ground plane (px) of a continuous position in the square source map: the old 2:1 isometric, before the squash */
const SRC_PX = 32;

/** The lattice for a source map of n x n tiles: size and origin. */
function latticeFor(n: number) {
  const q0 = Math.ceil((n * SRC_PX) / CW) + 1;
  return { q0, r0: 0, width: 2 * q0 + 1, height: Math.ceil((n * 2 * SRC_PX) / HEX_STEP) + 2 };
}

/** continuous square-map position (tx, ty) → continuous hex position (fx, fy) (cell centre = index + 0.5) */
export function srcToHex(m: Pick<GameMap, "q0" | "r0">, tx: number, ty: number): [number, number] {
  const X = (tx - ty) * SRC_PX, Y = (tx + ty) * SRC_PX;
  const a = X / CW, b = Y / HEX_STEP - a / 2;
  return [a + m.q0 + 0.5, b + m.r0 + 0.5];
}
/** continuous hex position → continuous square-map position */
export function hexToSrc(m: Pick<GameMap, "q0" | "r0">, fx: number, fy: number): [number, number] {
  const a = fx - 0.5 - m.q0, b = fy - 0.5 - m.r0;
  const X = a * CW, Y = (b + a / 2) * HEX_STEP;
  return [(X + Y) / (2 * SRC_PX), (Y - X) / (2 * SRC_PX)];
}

export function parseMap(meta: MapMeta, bin: Uint8Array): GameMap {
  if (meta.format !== "milltown-map/2") throw new Error(`unknown map format ${meta.format}`);
  const buf = bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength);
  const u8 = (k: string) => { const l = meta.layers[k]; return new Uint8Array(buf, l.offset, l.length); };
  const i16 = (k: string) => {
    const l = meta.layers[k];
    const dv = new DataView(buf, l.offset, l.length);
    const out = new Float32Array(l.length / 2);
    for (let i = 0; i < out.length; i++) out[i] = dv.getInt16(i * 2, true) / 10;
    return out;
  };
  const N = meta.width, NH = meta.height;
  const sVert = i16("vert"), sWater = i16("waterLevel");
  const sTerrain = u8("terrain"), sSlope = u8("slope"), sWaterId = u8("water"), sCreek = u8("creek"), sCoal = u8("coal");
  const sRoad = u8("road"), sBridge = u8("bridge"), sRail = u8("rail"), sSpecial = u8("special");

  const L = latticeFor(N);
  const W = L.width, H = L.height, n = W * H;
  const m: GameMap = {
    id: meta.id,
    name: meta.name,
    width: W,
    height: H,
    metersPerTile: HEX_STEP_M,
    bounds: meta.bounds,
    srcW: N,
    srcH: NH,
    q0: L.q0,
    r0: L.r0,
    valid: new Uint8Array(n),
    vert: new Float32Array(n),
    vert0: new Float32Array(n),
    elevation: new Float32Array(n),
    waterLevel: new Float32Array(n),
    terrain: new Uint8Array(n),
    slope: new Uint8Array(n),
    water: new Uint8Array(n),
    creek: new Uint8Array(n),
    coal: new Uint8Array(n),
    road: new Uint8Array(n),
    bridge: new Uint8Array(n),
    rail: new Uint8Array(n),
    special: new Uint8Array(n),
    waterNames: meta.waterNames,
    creekNames: meta.creekNames,
    railLines: meta.railLines,
    bridges: meta.bridges,
    spans: [],
    lines: { creek: [], rail: [] },
    landmarks: [],
    sources: meta.sources,
    minHeight: 0,
    maxHeight: 0,
  };

  // --- resample every layer onto the hex cells
  const V = N + 1;
  const bil = (tx: number, ty: number) => {
    const fx = Math.max(0, Math.min(N, tx)), fy = Math.max(0, Math.min(NH, ty));
    const x = Math.min(N - 1, Math.floor(fx)), y = Math.min(NH - 1, Math.floor(fy));
    const u = fx - x, v = fy - y;
    return (sVert[y * V + x] * (1 - u) + sVert[y * V + x + 1] * u) * (1 - v) + (sVert[(y + 1) * V + x] * (1 - u) + sVert[(y + 1) * V + x + 1] * u) * v;
  };
  const TS3 = Math.sqrt(3);
  let lo = Infinity;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const a = x - m.q0, b = y - m.r0;
    const X = a * CW, Y = (b + a / 2) * HEX_STEP;
    const tx = (X + Y) / (2 * SRC_PX), ty = (Y - X) / (2 * SRC_PX);
    if (tx < 0 || ty < 0 || tx >= N || ty >= NH) continue;
    const i = y * W + x;
    m.valid[i] = 1;
    const h = bil(tx, ty);
    m.vert[i] = h;
    if (h < lo) lo = h;
    // the source tiles whose centres fall inside this hexagon (always the one holding the centre)
    const cx0 = Math.floor(tx), cy0 = Math.floor(ty);
    const set: number[] = [cy0 * N + cx0];
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      const sx = cx0 + dx, sy = cy0 + dy;
      if (sx < 0 || sy < 0 || sx >= N || sy >= NH) continue;
      const gx = ((sx + 0.5) - (sy + 0.5)) * SRC_PX - X, gy = ((sx + 0.5) + (sy + 0.5)) * SRC_PX - Y;
      if (Math.abs(gy) <= (TS3 / 2) * HEX_S && TS3 * Math.abs(gx) + Math.abs(gy) <= TS3 * HEX_S) set.push(sy * N + sx);
    }
    let wet = 0, wi = -1, land = -1;
    for (const j of set) { if (sTerrain[j] === 0) { wet++; if (wi < 0) wi = j; } else if (land < 0) land = j; }
    const water = wet * 2 >= set.length;
    const pick = water ? wi : land >= 0 ? land : set[0];
    m.terrain[i] = sTerrain[pick];
    m.water[i] = sWaterId[pick];
    let wl = -1e9, sl = 0, cr = 0, co = 0, ro = 0, br = 0, ra = 0, sp = 0;
    for (const j of set) {
      if (sWater[j] > wl) wl = sWater[j];
      if (sSlope[j] > sl) sl = sSlope[j];
      if (sCreek[j] > cr) cr = sCreek[j];
      if (sCoal[j] > co) co = sCoal[j];
      if (sRoad[j] > ro) ro = sRoad[j];
      if (sBridge[j] && !br) br = sBridge[j];
      if (sRail[j] && !ra) ra = sRail[j];
      if (sSpecial[j] > sp) sp = sSpecial[j];
    }
    m.waterLevel[i] = wl;
    m.slope[i] = water ? sSlope[pick] : sl;
    m.creek[i] = cr; m.coal[i] = co; m.road[i] = ro; m.bridge[i] = br; m.rail[i] = ra; m.special[i] = sp;
  }
  // off-map cells: water, at the lowest ground (never drawn or built on)
  for (let i = 0; i < n; i++) if (!m.valid[i]) { m.vert[i] = lo; m.waterLevel[i] = lo; }
  m.vert0.set(m.vert);

  // --- vector data into hex coordinates
  const cv = (pts: number[]) => { const out = new Array<number>(pts.length); for (let k = 0; k + 1 < pts.length; k += 2) { const [fx, fy] = srcToHex(m, pts[k], pts[k + 1]); out[k] = fx; out[k + 1] = fy; } return out; };
  if (meta.lines) m.lines = { creek: meta.lines.creek.map(cv), rail: meta.lines.rail.map((r) => ({ line: r.line, pts: cv(r.pts) })) };
  m.spans = (meta.spans ?? []).map((sp) => ({ ...sp, stages: sp.stages.map((s) => ({ ...s })), a: srcToHex(m, sp.a[0], sp.a[1]), b: srcToHex(m, sp.b[0], sp.b[1]) }));
  m.landmarks = meta.landmarks.map((l) => {
    const [fx, fy] = srcToHex(m, l.x + 0.5, l.y + 0.5);
    const [cx, cy] = cellAt(fx, fy);
    return { ...l, x: cx, y: cy };
  });
  recomputeElevation(m);
  return m;
}

export function recomputeElevation(m: GameMap) {
  let lo = Infinity, hi = -Infinity;
  const n = m.vert.length;
  for (let i = 0; i < n; i++) {
    const h = m.vert[i];
    m.elevation[i] = h;
    if (m.valid[i]) { if (h < lo) lo = h; if (h > hi) hi = h; }
  }
  m.minHeight = lo;
  m.maxHeight = hi;
}

export function resetMap(m: GameMap) {
  m.vert.set(m.vert0);
  recomputeElevation(m);
}

async function gunzip(bytes: Uint8Array): Promise<Uint8Array> {
  if (bytes[0] !== 0x1f || bytes[1] !== 0x8b) return bytes; // already decoded by the server
  const ds = new DecompressionStream("gzip");
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(ds);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export async function loadMap(jsonUrl: string): Promise<GameMap> {
  const res = await fetch(jsonUrl);
  if (!res.ok) throw new Error(`failed to load map ${jsonUrl}: ${res.status}`);
  const meta = (await res.json()) as MapMeta;
  const binUrl = new URL(meta.binary, new URL(jsonUrl, location.href)).href;
  const b = await fetch(binUrl);
  if (!b.ok) throw new Error(`failed to load map data ${binUrl}: ${b.status}`);
  return parseMap(meta, await gunzip(new Uint8Array(await b.arrayBuffer())));
}

export const idx = (m: GameMap, x: number, y: number) => y * m.width + x;
/** is (x, y) a cell of the mapped area? */
export const inBounds = (m: GameMap, x: number, y: number) =>
  x >= 0 && y >= 0 && x < m.width && y < m.height && m.valid[y * m.width + x] === 1;
/** cells for a distance in metres (one cell = one neighbour step) */
export const tilesFor = (m: GameMap, metres: number) => Math.max(1, Math.round(metres / m.metersPerTile));

/** height at a cell's corner k (0 east … 5 south-east; see hex.ts): the mean of the three cells that meet there */
export function cornerH(m: GameMap, x: number, y: number, k: number): number {
  const W = m.width;
  let s = m.vert[y * W + x], c = 1;
  for (const d of [k, (k + 1) % 6]) {
    const nx = x + HEX6[d][0], ny = y + HEX6[d][1];
    if (nx >= 0 && ny >= 0 && nx < W && ny < m.height && m.valid[ny * W + nx]) { s += m.vert[ny * W + nx]; c++; }
  }
  return s / c;
}

/** the neighbours of cell i inside the mapped area, as indices (reuse `out` to avoid allocating) */
export function neighbours(m: GameMap, i: number, out: number[] = []): number[] {
  out.length = 0;
  const W = m.width, x = i % W, y = (i / W) | 0;
  for (let k = 0; k < 6; k++) {
    const nx = x + HEX6[k][0], ny = y + HEX6[k][1];
    if (nx >= 0 && ny >= 0 && nx < W && ny < m.height) { const j = ny * W + nx; if (m.valid[j]) out.push(j); }
  }
  return out;
}

/** does cell i touch the edge of the mapped area (a neighbour is off the map)? */
export function onEdge(m: GameMap, i: number): boolean {
  if (!m.valid[i]) return false;
  const W = m.width, x = i % W, y = (i / W) | 0;
  for (let k = 0; k < 6; k++) {
    const nx = x + HEX6[k][0], ny = y + HEX6[k][1];
    if (nx < 0 || ny < 0 || nx >= W || ny >= m.height || !m.valid[ny * W + nx]) return true;
  }
  return false;
}

export function tileLatLon(m: GameMap, x: number, y: number): { lat: number; lon: number } {
  const b = m.bounds;
  const [tx, ty] = hexToSrc(m, x + 0.5, y + 0.5);
  return {
    lat: b.north + (ty / m.srcH) * (b.south - b.north),
    lon: b.west + (tx / m.srcW) * (b.east - b.west),
  };
}

/** the cell holding a latitude / longitude */
export function geoToCell(m: GameMap, lat: number, lon: number): [number, number] {
  const b = m.bounds;
  const tx = ((lon - b.west) / (b.east - b.west)) * m.srcW, ty = ((b.north - lat) / (b.north - b.south)) * m.srcH;
  const [fx, fy] = srcToHex(m, tx, ty);
  return cellAt(fx, fy);
}

/** Hex distance (steps) from each cell to the nearest cell matching `pred` (BFS over the six neighbours, mapped cells only). */
export function distanceField(m: GameMap, pred: (i: number) => boolean): Uint16Array {
  const n = m.width * m.height;
  const d = new Uint16Array(n).fill(0xffff);
  const q = new Int32Array(n);
  let head = 0, tail = 0;
  for (let i = 0; i < n; i++) if (m.valid[i] && pred(i)) { d[i] = 0; q[tail++] = i; }
  const nb: number[] = [];
  while (head < tail) {
    const i = q[head++];
    for (const j of neighbours(m, i, nb)) if (d[j] === 0xffff) { d[j] = d[i] + 1; q[tail++] = j; }
  }
  return d;
}

/** Summed-area table for fast box sums over a per-tile array. */
export function sat(m: GameMap, arr: ArrayLike<number>): Float64Array {
  const W = m.width + 1;
  const s = new Float64Array(W * (m.height + 1));
  for (let y = 0; y < m.height; y++) {
    let row = 0;
    for (let x = 0; x < m.width; x++) {
      row += arr[y * m.width + x];
      s[(y + 1) * W + x + 1] = s[y * W + x + 1] + row;
    }
  }
  return s;
}

export function satSum(m: GameMap, s: Float64Array, x0: number, y0: number, x1: number, y1: number): number {
  const W = m.width + 1;
  x0 = Math.max(0, x0); y0 = Math.max(0, y0);
  x1 = Math.min(m.width - 1, x1); y1 = Math.min(m.height - 1, y1);
  if (x1 < x0 || y1 < y0) return 0;
  return s[(y1 + 1) * W + x1 + 1] - s[y0 * W + x1 + 1] - s[(y1 + 1) * W + x0] + s[y0 * W + x0];
}
