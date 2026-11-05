// v0.31: light and shade baked into the terrain chunks — the Detail setting, the hills' cast shadows
// (a low afternoon sun from the south-west, screen-left), ambient occlusion in hollows, and the shadows
// buildings and trees throw on the ground beside them.

import type { GameMap } from "../core/map";
import { RELIEF } from "./iso";
import type { SpriteBuf } from "./sprites";

/** 0 Low, 1 Med, 2 High. Low: no cast shadows, one building per lot, no clutter; Med: hill shadows and
 * ambient occlusion, partial clutter; High: everything, object shadows and daytime reflections. */
export let DETAIL = 2;
export const DETAILS = [0, 1, 2];
export const DETAIL_NAMES = ["Low", "Med", "High"];
export function setDetail(d: number) { DETAIL = Math.max(0, Math.min(2, Math.round(d))); }

/**
 * The sun's direction for shadows. Its azimuth matches the terrain shading (light from screen-left: from -x, +y,
 * i.e. the south-west), so shadows fall toward screen-right; it's lower than the shading's sun (about 30°) so the
 * hills throw long afternoon shadows over the valley floor.
 */
export const SUN_TAN = 0.58;
/** screen px a shadow runs right for every px of height in a sprite */
export const SHADOW_K = 1.05;

export interface TerrainLight {
  /** per vertex 0..1: in a hill's shadow */
  shadow: Float32Array;
  /** per vertex 0..1: ambient occlusion (hollows, the foot of steep slopes) */
  ao: Float32Array;
  key: string;
}

let cache: TerrainLight | null = null;

/** Hill shadows and occlusion per terrain vertex, at the current hill relief. Cheap (two O(n) sweeps). */
export function terrainLight(m: GameMap, version = 0): TerrainLight {
  const key = `${m.width}|${RELIEF}|${version}`;
  if (cache && cache.key === key) return cache;
  const V = m.width + 1, VH = m.height + 1, h = m.vert;
  const shadow = new Float32Array(V * VH), ao = new Float32Array(V * VH);
  // shadows: sweep each diagonal running from the sun (from -x,+y toward +x,-y), keeping the highest horizon
  // (a vertex is shaded when the terrain behind it toward the sun rises above the sun line)
  const step = Math.SQRT2 * m.metersPerTile * SUN_TAN; // the sun line drops this much (true metres) per vertex
  const soft = 6; // metres of drawn height over which a shadow edge fades in
  for (let s = 0; s < V + VH - 1; s++) {
    // vertices with x - y = const run along the diagonal; start from the sun's side (small x, large y)
    const d = s - (VH - 1); // x - y
    let x = Math.max(0, d + VH - 1), y = x - d;
    let horizon = -1e9;
    while (x < V && y >= 0) {
      {
        const j = y * V + x, hh = h[j] * RELIEF;
        const over = horizon - hh;
        shadow[j] = over <= 0 ? 0 : Math.min(1, over / soft);
        horizon = Math.max(horizon, hh) - step;
      }
      x++; y--;
    }
  }
  // ambient occlusion: how far a vertex sits below the mean of a ring of vertices around it (hollows, ravines,
  // the foot of a bluff), at drawn relief
  const R = 3;
  for (let y = 0; y < VH; y++) for (let x = 0; x < V; x++) {
    let sum = 0, n = 0;
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2, xx = Math.round(x + Math.cos(a) * R), yy = Math.round(y + Math.sin(a) * R);
      if (xx < 0 || yy < 0 || xx >= V || yy >= VH) continue;
      sum += h[yy * V + xx]; n++;
    }
    if (!n) continue;
    const below = (sum / n - h[y * V + x]) * RELIEF;
    ao[y * V + x] = below <= 2 ? 0 : Math.min(1, (below - 2) / 40);
  }
  cache = { shadow, ao, key };
  return cache;
}

/** One sprite's shadow on the ground, as horizontal runs relative to its anchor: [dy, x0, x1] triples. */
export interface ShadowShape { runs: Int16Array; contact: Int16Array }

const shapes = new WeakMap<SpriteBuf, ShadowShape | null>();

/**
 * The ground shadow of a sprite: every column of it is a post standing on the column's lowest drawn pixel,
 * thrown to the right by its height (the sun is due screen-left). Trees cast a soft round shadow from the crown.
 * `contact` holds the pixels just under each column's foot, for a dark contact line (occlusion at the base).
 */
export function shadowShape(sb: SpriteBuf, kind: "tree" | "solid" | "low"): ShadowShape | null {
  const hit = shapes.get(sb);
  if (hit !== undefined) return hit;
  const { w, h, px, ax, ay } = sb;
  const runs: number[] = [], contact: number[] = [];
  if (kind === "tree") {
    // the crown's shadow: an ellipse lying on the ground, offset to the right by the trunk height
    let top = h, bot = -1, x0 = w, x1 = -1;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (px[y * w + x] >>> 24) { if (y < top) top = y; if (y > bot) bot = y; if (x < x0) x0 = x; if (x > x1) x1 = x; }
    if (bot < 0) { shapes.set(sb, null); return null; }
    const tall = bot - top, rx = Math.max(1, (x1 - x0 + 1) * 0.5), ry = Math.max(1, rx * 0.45);
    const cx = (x0 + x1) / 2 - ax + tall * SHADOW_K * 0.55, cy = bot - ay - ry * 0.4;
    for (let yy = Math.floor(-ry); yy <= Math.ceil(ry); yy++) {
      const ww = rx * Math.sqrt(Math.max(0, 1 - (yy / ry) ** 2));
      if (ww < 0.5) continue;
      runs.push(Math.round(cy + yy), Math.round(cx - ww), Math.round(cx + ww));
    }
  } else {
    for (let x = 0; x < w; x++) {
      let top = -1, bot = -1;
      for (let y = 0; y < h; y++) if (px[y * w + x] >>> 24) { if (top < 0) top = y; bot = y; }
      if (bot < 0) continue;
      const tall = kind === "low" ? Math.min(4, bot - top) : bot - top;
      const len = Math.round(tall * SHADOW_K);
      if (len > 0) runs.push(bot - ay, x - ax + 1, x - ax + len);
      contact.push(bot - ay + 1, x - ax);
    }
  }
  const out = runs.length ? { runs: Int16Array.from(runs), contact: Int16Array.from(contact) } : null;
  shapes.set(sb, out);
  return out;
}

/** which sprites throw a shadow, and how */
export function shadowKind(key: string): "tree" | "solid" | "low" | null {
  if (key.startsWith("tree:")) return key.startsWith("tree:bush") ? null : "tree";
  if (key.startsWith("bridge:") || key.startsWith("boat:") || key.startsWith("lamp:") || key.startsWith("smoke:")) return null;
  if (key.startsWith("slag:") || key.startsWith("fleet:") || key.startsWith("strip:") || key.startsWith("wire:")) return null;
  if (key.startsWith("cem:") || key.startsWith("lot:") || key.startsWith("gob:")) return "low";
  return "solid";
}
