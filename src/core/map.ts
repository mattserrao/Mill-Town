// Map data: loaded from public/maps/*.json (built by tools/mapgen/build_map.py)

export interface Landmark {
  name: string;
  x: number;
  y: number;
  kind: "town" | "hill" | "historic_site" | string;
  lat: number;
  lon: number;
}

export interface RawMap {
  format: string;
  id: string;
  name: string;
  width: number;
  height: number;
  metersPerTile: number;
  levelMeters: number;
  baseElevation: number;
  projection: string;
  orientation: string;
  bounds: { north: number; west: number; south: number; east: number };
  layers: Record<string, { type: "int16" | "uint8"; unit?: string; data: string }>;
  waterNames: Record<string, string>;
  creekNames: Record<string, string>;
  landmarks: Landmark[];
  sources: string[];
}

export interface GameMap {
  id: string;
  name: string;
  width: number;
  height: number;
  metersPerTile: number;
  levelMeters: number;
  bounds: RawMap["bounds"];
  elevation: Int16Array;
  level: Uint8Array;
  terrain: Uint8Array;
  slope: Uint8Array;
  water: Uint8Array;
  waterFraction: Uint8Array;
  creek: Uint8Array;
  coal: Uint8Array;
  waterNames: Record<string, string>;
  creekNames: Record<string, string>;
  landmarks: Landmark[];
  sources: string[];
  maxLevel: number;
}

function decodeBase64(b64: string): Uint8Array {
  if (typeof atob === "function") {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  // Node (tests)
  return new Uint8Array(Buffer.from(b64, "base64"));
}

function layer(raw: RawMap, name: string): Uint8Array | Int16Array {
  const l = raw.layers[name];
  if (!l) throw new Error(`map ${raw.id}: missing layer ${name}`);
  const bytes = decodeBase64(l.data);
  const n = raw.width * raw.height;
  if (l.type === "int16") {
    const out = new Int16Array(n);
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    for (let i = 0; i < n; i++) out[i] = dv.getInt16(i * 2, true);
    return out;
  }
  if (bytes.length !== n) throw new Error(`map ${raw.id}: layer ${name} has ${bytes.length} bytes, want ${n}`);
  return bytes;
}

export function parseMap(raw: RawMap): GameMap {
  if (raw.format !== "milltown-map/1") throw new Error(`unknown map format ${raw.format}`);
  const level = layer(raw, "level") as Uint8Array;
  let maxLevel = 0;
  for (let i = 0; i < level.length; i++) if (level[i] > maxLevel) maxLevel = level[i];
  return {
    id: raw.id,
    name: raw.name,
    width: raw.width,
    height: raw.height,
    metersPerTile: raw.metersPerTile,
    levelMeters: raw.levelMeters,
    bounds: raw.bounds,
    elevation: layer(raw, "elevation") as Int16Array,
    level,
    terrain: layer(raw, "terrain") as Uint8Array,
    slope: layer(raw, "slope") as Uint8Array,
    water: layer(raw, "water") as Uint8Array,
    waterFraction: layer(raw, "waterFraction") as Uint8Array,
    creek: layer(raw, "creek") as Uint8Array,
    coal: layer(raw, "coal") as Uint8Array,
    waterNames: raw.waterNames,
    creekNames: raw.creekNames,
    landmarks: raw.landmarks,
    sources: raw.sources,
    maxLevel,
  };
}

export async function loadMap(url: string): Promise<GameMap> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`failed to load map ${url}: ${res.status}`);
  return parseMap((await res.json()) as RawMap);
}

export const idx = (m: GameMap, x: number, y: number) => y * m.width + x;
export const inBounds = (m: GameMap, x: number, y: number) =>
  x >= 0 && y >= 0 && x < m.width && y < m.height;

/** Approximate lat/lon of a tile centre (linear across the small map extent). */
export function tileLatLon(m: GameMap, x: number, y: number): { lat: number; lon: number } {
  const b = m.bounds;
  return {
    lat: b.north + ((y + 0.5) / m.height) * (b.south - b.north),
    lon: b.west + ((x + 0.5) / m.width) * (b.east - b.west),
  };
}

/** Chebyshev distance from each tile to the nearest tile matching `pred` (BFS, 8-neighbour). */
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
