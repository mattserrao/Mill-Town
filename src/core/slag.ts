// v0.31: slag dumps. Every blast furnace makes slag — about a third of a ton for every ton of iron — and the valley's
// steel works tipped theirs over the nearest bank: the river's edge at Homestead, Duquesne and Braddock, the ravines
// behind the mills, and from 1922 the Nine Mile Run valley (Brown's Dump, the Duquesne Slag Company), where it rose
// a hundred feet and more before the city bought it back. Here each steel works carries its slag out to a dump that
// starts on the lowest open ground near it (a riverbank or a hollow) and grows outward; each tile of it rises in
// steps until it's full. Slag land is bare and can't be built on (it's drawn as slag over Use.Rock).

import { allWorks, type GameState } from "./game";
import { RIVALS } from "./rivals";
import { Terrain } from "./terrain";
import { Use } from "./town";

/** metres a tile rises for one step of slag */
export const SLAG_STEP_M = 1.5;
/** steps a tile takes before it's full (about 24 m, 80 feet) */
export const SLAG_MAX = 16;
/** how much higher a dump stands for each tile in from its edge (m) */
const SLAG_FACE_M = 7;
/** output (units a season) that makes one step of slag */
const OUTPUT_PER_STEP = 550;
/** how far from the works' middle a dump may run (tiles) */
const REACH = 24;

export interface SlagState {
  /** steps of slag owed to the dumps, by works id (carried over between seasons) */
  acc: Record<string, number>;
}

const steelOwner = (g: GameState, owner: string): { x: number; y: number; fp: number } | null => {
  if (owner.startsWith("p")) {
    const w = g.company ? allWorks(g.company).find((x) => x.id === owner) : undefined;
    return w && w.industry === "steel" ? { x: w.x, y: w.y, fp: w.footprint } : null;
  }
  const def = RIVALS.find((d) => d.id === owner);
  const r = g.rivals.find((x) => x.id === owner);
  return def && r && def.industry === "steel" ? { x: r.x, y: r.y, fp: r.footprint } : null;
};

/** can slag go here? open, unowned, unbuilt land: no streets, rails, roads or water */
function dumpable(g: GameState, i: number): boolean {
  const m = g.map, w = g.world;
  if (m.terrain[i] === Terrain.Water) return false;
  if (w.street[i] || w.owner[i] || w.structure[i] || w.pop[i] || m.rail[i] || m.road[i]) return false;
  const u = w.use[i];
  if (u === Use.Rock) return !!w.slag?.[i] && w.slag[i] < SLAG_MAX;
  return u === Use.Empty || u === Use.Forest || u === Use.Farm;
}

/** a new dump tile keeps a tile's distance from houses, streets and public buildings (the heap doesn't swallow a street) */
function clearOfTown(g: GameState, i: number): boolean {
  const m = g.map, w = g.world, W = m.width, x = i % W, y = (i / W) | 0;
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    const xx = x + dx, yy = y + dy;
    if (xx < 0 || yy < 0 || xx >= W || yy >= m.height) continue;
    const j = yy * W + xx, u = w.use[j];
    if (w.pop[j] || w.street[j] || u === Use.Civic || u === Use.Commerce || u === Use.Landmark || u === Use.Cemetery || u === Use.Park || u === Use.Wharf) return false;
  }
  return true;
}

/** raise a tile by a step: its four corners (so its neighbours' near edges slope up to it, the tipped face) */
function raise(g: GameState, i: number) {
  const m = g.map, W = m.width, V = W + 1, x = i % W, y = (i / W) | 0;
  const w = g.world;
  w.slag![i]++;
  const top = Math.max(m.vert0[y * V + x], m.vert0[y * V + x + 1], m.vert0[(y + 1) * V + x], m.vert0[(y + 1) * V + x + 1]);
  // a corner rises only where every tile that meets there is slag: the heap's edge tiles are its tipped face, sloping
  // down to the ground beside it, and nothing next to the dump is tipped up with it
  const open = (xx: number, yy: number) => {
    if (xx < 0 || yy < 0 || xx >= W || yy >= m.height) return false;
    const j = yy * W + xx;
    return j === i || !!w.slag![j];
  };
  for (const [cx, cy] of [[x, y], [x + 1, y], [x, y + 1], [x + 1, y + 1]]) {
    if (!(open(cx - 1, cy - 1) && open(cx, cy - 1) && open(cx - 1, cy) && open(cx, cy))) continue;
    // a flat top: every corner comes up to the same level (the highest of the tile's original corners plus the
    // slag), but no steeper from the dump's edge than tipped slag stands (about 7 m a tile), so a small dump is a
    // low mound and only a big one stands tall
    let k = 1;
    while (k < 4) {
      let all = true;
      for (let yy = cy - k - 1; yy <= cy + k && all; yy++) for (let xx = cx - k - 1; xx <= cx + k && all; xx++) if (!open(xx, yy)) all = false;
      if (!all) break;
      k++;
    }
    const j = cy * V + cx;
    m.vert[j] = Math.max(m.vert[j], Math.min(top + w.slag![i] * SLAG_STEP_M - SLAG_STEP_M, m.vert0[j] + k * SLAG_FACE_M));
  }
  for (const [dx, dy] of [[0, 0], [-1, 0], [0, -1], [-1, -1], [1, 0], [0, 1], [1, 1], [1, -1], [-1, 1]]) {
    const xx = x + dx, yy = y + dy;
    if (xx < 0 || yy < 0 || xx >= W || yy >= m.height) continue;
    const a = yy * V + xx;
    m.elevation[yy * W + xx] = (m.vert[a] + m.vert[a + 1] + m.vert[a + V] + m.vert[a + V + 1]) / 4;
  }
  if (w.use[i] !== Use.Rock) { w.use[i] = Use.Rock; w.sub[i] = 0; }
}

/** can the slag cars get there without crossing the river? (a straight line over land) */
function overLand(g: GameState, x0: number, y0: number, x1: number, y1: number): boolean {
  const m = g.map, n = Math.ceil(Math.hypot(x1 - x0, y1 - y0) * 2);
  for (let k = 1; k < n; k++) {
    const x = Math.round(x0 + ((x1 - x0) * k) / n), y = Math.round(y0 + ((y1 - y0) * k) / n);
    if (m.terrain[y * m.width + x] === Terrain.Water) return false;
  }
  return true;
}

/** where a works' next step of slag goes: on top of its dump if a tile there isn't full, else the best open tile next to it */
function nextTile(g: GameState, cx: number, cy: number): number {
  const m = g.map, w = g.world, W = m.width;
  let best = -1, bs = -Infinity, bestNew = -1, bn = -Infinity, haveDump = false;
  const x0 = Math.max(0, cx - REACH), x1 = Math.min(W - 1, cx + REACH), y0 = Math.max(0, cy - REACH), y1 = Math.min(m.height - 1, cy + REACH);
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (w.slag![y * W + x]) { haveDump = true; break; }
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const i = y * W + x;
    const d = Math.hypot(x - cx, y - cy);
    if (d > REACH || !dumpable(g, i)) continue;
    let nearSlag = 0, nearWater = 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const xx = x + dx, yy = y + dy;
      if (xx < 0 || yy < 0 || xx >= W || yy >= m.height) continue;
      const j = yy * W + xx;
      if (w.slag![j]) nearSlag++;
      if (m.terrain[j] === Terrain.Water) nearWater++;
    }
    const own = w.slag![i];
    if (!own && !clearOfTown(g, i)) continue;
    // fill low ground first (the bank, the hollow), keep the heap's top level, stay near the works
    let score = -m.elevation[i] * 0.25 - d * 0.6 + nearWater * 3 + nearSlag * 1.2;
    if (own) score += 4 - own * 0.45;
    if (own || nearSlag) { if (score > bs) { bs = score; best = i; } } // a dump grows from its edge
    else if (d >= 4 && score > bn && overLand(g, cx, cy, x, y)) { bn = score; bestNew = i; } // or a new one starts, clear of the works (on its own side of the river)
  }
  // a new dump only when there's none yet, or the old one is hemmed in
  return haveDump && best >= 0 ? best : best >= 0 && bs >= bn ? best : bestNew;
}

/** each season: the steel works' slag goes out to their dumps (call after the season's plants are known) */
export function slagSeason(g: GameState) {
  const w = g.world, m = g.map;
  if (!w.slag) w.slag = new Uint8Array(m.width * m.height);
  if (!g.slag) g.slag = { acc: {} };
  let changed = 0;
  for (const p of g.plants) {
    if (!(p.output > 0)) continue;
    const o = steelOwner(g, p.owner);
    if (!o) continue;
    const acc = (g.slag.acc[p.owner] ?? 0) + p.output / OUTPUT_PER_STEP;
    let n = Math.floor(acc);
    g.slag.acc[p.owner] = acc - n;
    const cx = Math.round(o.x + o.fp / 2), cy = Math.round(o.y + o.fp / 2);
    while (n-- > 0) {
      const i = nextTile(g, cx, cy);
      if (i < 0) break; // nowhere left within reach: it goes by barge down the river
      raise(g, i);
      changed++;
    }
  }
  if (changed) { w.version++; w.slagN = (w.slagN ?? 0) + changed; }
}
