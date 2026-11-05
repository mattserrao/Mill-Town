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
  /** the tiles of Brown's Dump (Nine Mile Run, 1922–72) */
  nmr?: number[];
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
  // an open-ground tile (woods, field, waste) beside the heap may take a talus of spilled slag: a corner it shares
  // with the dump comes up part way (by how many of the four tiles there are slag), so the heap's foot is a slope,
  // not a saw-tooth of single-tile faces. Houses, streets, rails and water are never tipped up.
  const talus = (xx: number, yy: number) => {
    if (xx < 0 || yy < 0 || xx >= W || yy >= m.height) return false;
    const j = yy * W + xx;
    return j === i || !!w.slag![j] || (dumpable(g, j) && !w.pop[j]);
  };
  for (const [cx, cy] of [[x, y], [x + 1, y], [x, y + 1], [x + 1, y + 1]]) {
    const four = [[cx - 1, cy - 1], [cx, cy - 1], [cx - 1, cy], [cx, cy]];
    if (!four.every(([a, b]) => open(a, b))) {
      if (!four.every(([a, b]) => talus(a, b))) continue;
      const nS = four.filter(([a, b]) => open(a, b)).length;
      if (nS < 2) continue;
      const j = cy * V + cx;
      m.vert[j] = Math.max(m.vert[j], Math.min(top + w.slag![i] * SLAG_STEP_M - SLAG_STEP_M, m.vert0[j] + SLAG_FACE_M) * (nS / 4) + m.vert0[j] * (1 - nS / 4));
      continue;
    }
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
    // (1922–72: a third of the city mills' slag goes out to Brown's Dump instead)
    const yr = 1850 + Math.floor(g.turn / 4), mouth = yr >= 1922 && yr < 1972 ? nineMileMouth(g) : null;
    const share = mouth && Math.hypot(p.x - mouth[0], p.y - mouth[1]) < NMR_REACH ? 0.65 : 1;
    const acc = (g.slag.acc[p.owner] ?? 0) + (p.output * share) / OUTPUT_PER_STEP;
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
  changed += brownsDump(g);
  if (changed) { w.version++; w.slagN = (w.slagN ?? 0) + changed; }
}

/** the creek id of Nine Mile Run in the map's creek layer */
const NINE_MILE_RUN = "Ninemile Run";
/** how far (tiles) the slag trains came to Brown's Dump: the city mills, J&L's two works and the upper Mon mills (~7 km) */
const NMR_REACH = 230;
let nmrCache: { map: unknown; mouth: [number, number] | null } | null = null;

/** where Nine Mile Run meets the Monongahela (the lowest tile of its course next to the river) */
function nineMileMouth(g: GameState): [number, number] | null {
  const m = g.map;
  if (nmrCache && nmrCache.map === m) return nmrCache.mouth;
  const id = Number(Object.entries(m.creekNames).find(([, v]) => v === NINE_MILE_RUN)?.[0] ?? -1);
  let best: [number, number] | null = null, bh = Infinity;
  if (id >= 0) for (let i = 0; i < m.creek.length; i++) if (m.creek[i] === id && m.elevation[i] < bh) { bh = m.elevation[i]; best = [i % m.width, (i / m.width) | 0]; }
  nmrCache = { map: m, mouth: best };
  return best;
}

/** the box round Nine Mile Run's course (its tiles, and three either side) */
let nmrBox: { map: unknown; box: [number, number, number, number]; near: Uint8Array } | null = null;
function nineMileBox(g: GameState): [number, number, number, number] {
  const m = g.map, W = m.width;
  if (nmrBox && nmrBox.map === m) return nmrBox.box;
  const id = Number(Object.entries(m.creekNames).find(([, v]) => v === NINE_MILE_RUN)?.[0] ?? -1);
  let x0 = W, y0 = m.height, x1 = 0, y1 = 0;
  const near = new Uint8Array(W * m.height);
  for (let i = 0; i < m.creek.length; i++) if (m.creek[i] === id) {
    const x = i % W, y = (i / W) | 0;
    x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
    for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) { const xx = x + dx, yy = y + dy; if (xx >= 0 && yy >= 0 && xx < W && yy < m.height) near[yy * W + xx] = 1; }
  }
  const box: [number, number, number, number] = [Math.max(0, x0 - 4), Math.max(0, y0 - 4), Math.min(W - 1, x1 + 4), Math.min(m.height - 1, y1 + 4)];
  nmrBox = { map: m, box, near };
  return box;
}
/** a slag tile that's part of Brown's Dump (within the run's valley) */
const nmrSlag = (g: GameState, i: number) => { nineMileBox(g); return !!nmrBox!.near[i]; };

/**
 * Brown's Dump. From 1922 the Duquesne Slag Products Company took the city mills' slag (Jones & Laughlin's above
 * all) out to the Nine Mile Run valley and tipped it down the valley sides, building banks a hundred feet high on
 * both sides of the run until 1972. Here: from 1922 to 1972 a share of the slag of every steel works within reach of
 * the city goes to a dump that starts at the run's lower valley (back from the river, clear of the creek bed) and
 * spreads up it.
 */
function brownsDump(g: GameState): number {
  const yr = 1850 + Math.floor(g.turn / 4);
  if (yr < 1922 || yr >= 1972) return 0;
  const mouth = nineMileMouth(g);
  if (!mouth) return 0;
  const m = g.map, w = g.world, W = m.width;
  const s = g.slag!;
  if (!s.acc.nmr && yr === 1922 && g.turn % 4 === 0) {
    g.headlines.push({ year: 1922, season: "Spring", name: "Slag to Nine Mile Run", description: "The Duquesne Slag Products Company has leased the Nine Mile Run valley and begun tipping the city mills' slag down its sides. Residents of Squirrel Hill complain of the dust.", category: "Industry" });
  }
  let out = 0;
  for (const p of g.plants) {
    if (!(p.output > 0) || !steelOwner(g, p.owner)) continue;
    if (Math.hypot(p.x - mouth[0], p.y - mouth[1]) < NMR_REACH) out += p.output * 0.35;
  }
  const acc = (s.acc.nmr ?? 0) + out / OUTPUT_PER_STEP;
  let n = Math.floor(acc);
  s.acc.nmr = acc - n + 1e-9; // (non-zero once begun, so the 1922 headline isn't repeated)
  let changed = 0;
  // the valley, not the creek bed: anywhere along the run's lower course (Frick Park, Swisshelm, down to the river)
  const [cx, cy] = mouth;
  const [bx0, by0, bx1, by1] = nineMileBox(g);
  const mine = new Set(s.nmr ?? []);
  while (n-- > 0) {
    let best = -1, bs = -Infinity, bestNew = -1, bn = -Infinity;
    for (let y = by0; y <= by1; y++) for (let x = bx0; x <= bx1; x++) {
      const i = y * W + x;
      if (m.creek[i] || !nmrSlag(g, i) || !dumpable(g, i)) continue;
      const own = mine.has(i) ? w.slag![i] : 0;
      if (!own && w.slag![i]) continue; // a works' own dump
      if (!own && !clearOfTown(g, i)) continue;
      let nearSlag = 0, nearCreek = 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [2, 0], [-2, 0], [0, 2], [0, -2]]) {
        const xx = x + dx, yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= W || yy >= m.height) continue;
        const j = yy * W + xx;
        if (mine.has(j) && Math.abs(dx) + Math.abs(dy) === 1) nearSlag++;
        if (m.creek[j]) nearCreek++;
      }
      const d = Math.hypot(x - cx, y - cy);
      if (own || nearSlag) {
        const score = -d * 0.12 + nearCreek * 1.5 + nearSlag * 1.2 + (own ? 4 - own * 0.45 : 0) - m.elevation[i] * 0.05;
        if (score > bs) { bs = score; best = i; }
      } else if (d >= 3 && nearCreek) {
        // a new bank of the dump: where the valley side is open (room to grow), low down
        let room = 0;
        for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) { const j = (y + dy) * W + x + dx; if (j >= 0 && j < w.use.length && !w.pop[j] && !w.street[j] && (w.use[j] === Use.Forest || w.use[j] === Use.Empty || w.use[j] === Use.Farm)) room++; }
        const score = room * 0.5 - d * 0.12 + nearCreek - m.elevation[i] * 0.05;
        if (score > bn) { bn = score; bestNew = i; }
      }
    }
    if (best < 0) best = bestNew;
    if (best < 0) break;
    raise(g, best);
    if (!mine.has(best)) { mine.add(best); (s.nmr ??= []).push(best); }
    changed++;
  }
  return changed;
}
