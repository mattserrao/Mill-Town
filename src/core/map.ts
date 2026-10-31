// Map data (format milltown-map/2): public/maps/<id>.json + <id>.bin (gzip'd typed arrays).
// Built by tools/mapgen/build_map.py from USGS elevation, hydrography and transportation data.

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
  landmarks: Landmark[];
  wharves: string[];
  sources: string[];
}

export interface GameMap {
  id: string;
  name: string;
  width: number;
  height: number;
  metersPerTile: number;
  bounds: MapMeta["bounds"];
  /** vertex heights in metres, (width+1) x (height+1), row-major. Mutable (grading). */
  vert: Float32Array;
  /** original vertex heights, for resetting a new game */
  vert0: Float32Array;
  /** tile mean elevation (m), recomputed from vert */
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
  landmarks: Landmark[];
  sources: string[];
  minHeight: number;
  maxHeight: number;
}

export const enum Special { None = 0, Wharf = 1 }

export function parseMap(meta: MapMeta, bin: Uint8Array): GameMap {
  if (meta.format !== "milltown-map/2") throw new Error(`unknown map format ${meta.format}`);
  const buf = bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength);
  const u8 = (k: string) => { const l = meta.layers[k]; return new Uint8Array(buf, l.offset, l.length).slice(); };
  const i16 = (k: string) => {
    const l = meta.layers[k];
    const dv = new DataView(buf, l.offset, l.length);
    const out = new Float32Array(l.length / 2);
    for (let i = 0; i < out.length; i++) out[i] = dv.getInt16(i * 2, true) / 10;
    return out;
  };
  const vert = i16("vert");
  const m: GameMap = {
    id: meta.id,
    name: meta.name,
    width: meta.width,
    height: meta.height,
    metersPerTile: meta.metersPerTile,
    bounds: meta.bounds,
    vert,
    vert0: vert.slice(),
    elevation: new Float32Array(meta.width * meta.height),
    waterLevel: i16("waterLevel"),
    terrain: u8("terrain"),
    slope: u8("slope"),
    water: u8("water"),
    creek: u8("creek"),
    coal: u8("coal"),
    road: u8("road"),
    bridge: u8("bridge"),
    rail: u8("rail"),
    special: u8("special"),
    waterNames: meta.waterNames,
    creekNames: meta.creekNames,
    railLines: meta.railLines,
    bridges: meta.bridges,
    landmarks: meta.landmarks,
    sources: meta.sources,
    minHeight: 0,
    maxHeight: 0,
  };
  recomputeElevation(m);
  return m;
}

export function recomputeElevation(m: GameMap) {
  const W = m.width, V = W + 1;
  let lo = Infinity, hi = -Infinity;
  for (let y = 0; y < m.height; y++) for (let x = 0; x < W; x++) {
    const a = y * V + x;
    m.elevation[y * W + x] = (m.vert[a] + m.vert[a + 1] + m.vert[a + V] + m.vert[a + V + 1]) / 4;
  }
  for (const h of m.vert) { if (h < lo) lo = h; if (h > hi) hi = h; }
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
export const inBounds = (m: GameMap, x: number, y: number) =>
  x >= 0 && y >= 0 && x < m.width && y < m.height;
/** vertex height at corner (vx, vy), 0..width / 0..height */
export const vh = (m: GameMap, vx: number, vy: number) => m.vert[vy * (m.width + 1) + vx];
/** tiles for a distance in metres */
export const tilesFor = (m: GameMap, metres: number) => Math.max(1, Math.round(metres / m.metersPerTile));

export function tileLatLon(m: GameMap, x: number, y: number): { lat: number; lon: number } {
  const b = m.bounds;
  return {
    lat: b.north + ((y + 0.5) / m.height) * (b.south - b.north),
    lon: b.west + ((x + 0.5) / m.width) * (b.east - b.west),
  };
}

/** Chebyshev distance (tiles) from each tile to the nearest tile matching `pred` (BFS, 8-neighbour). */
export function distanceField(m: GameMap, pred: (i: number) => boolean): Uint16Array {
  const n = m.width * m.height;
  const d = new Uint16Array(n).fill(0xffff);
  const q = new Int32Array(n);
  let head = 0, tail = 0;
  for (let i = 0; i < n; i++) if (pred(i)) { d[i] = 0; q[tail++] = i; }
  while (head < tail) {
    const i = q[head++];
    const x = i % m.width, y = (i / m.width) | 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const nx = x + dx, ny = y + dy;
      if ((dx || dy) && inBounds(m, nx, ny)) {
        const j = ny * m.width + nx;
        if (d[j] === 0xffff) { d[j] = d[i] + 1; q[tail++] = j; }
      }
    }
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
