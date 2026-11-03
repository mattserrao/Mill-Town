// Where newcomers settle. The census curve decides how many people the valley gains each season (like
// Micropolis' demand valves); every lot's desirability decides where they go (like each zone's own score):
//
//   jobs within reach (travel time to the works, downtown, town centres — by foot, streetcar or car)
//   + an existing home to share, a main road, a hillside neighbourhood that has opened on its date
//   − steepness
//   + their own people nearby (chain migration), their church nearby, the historic pull of a neighbourhood
//   ± land value and smoke: the newest arrivals take the cheap, smoky lots by the mills; established
//     communities pay for clean air and move uphill and upwind.
//
// Arrivals are split into newcomers (by the immigration waves of the year) and locals moving house (by today's
// make-up), and each community picks its own best lots.
//
// Only the simulated band along the rivers (band.ts) takes newcomers; lots thin out over its last few tiles.

import { ANCHORS, anchorIndex, GROUPS, immigrationPressure } from "./ancestry";
import { simBand } from "./band";
import { blockGrid, sampleBlock } from "./blocks";
import { HILLSIDES, latLonToTile } from "./features";
import { type GameMap, inBounds } from "./map";
import { CELL, NG } from "./neighbourhood";
import { Rng, tileNoise, valueNoise } from "./rng";
import { habitable, Terrain } from "./terrain";
import { CivicSub, densityCap, HouseSub, POP_CAP, Street, terrainCap, Use, useForPop, type World } from "./town";
import { stepDist, HEX6 } from "./hex";

/** uses a house never goes on, by use id */
const NO_HOUSE = new Uint8Array(64);
for (const u of [Use.Civic, Use.Landmark, Use.Wharf, Use.Commerce, Use.Mine, Use.Incline, Use.Industry, Use.Rival, Use.Park, Use.Cemetery]) NO_HOUSE[u] = 1;

const CHURCH_SUBS = new Set<number>([CivicSub.Church, CivicSub.OnionChurch, CivicSub.TwinChurch, CivicSub.Synagogue, CivicSub.BlackChurch]);

export interface GrowthReport { placed: number; byGroup: number[] }

export function growByDesire(m: GameMap, w: World, access: Float32Array, plants: [number, number][], room: number, season: number): GrowthReport {
  const byGroup = new Array(NG).fill(0);
  if (room <= 0) return { placed: 0, byGroup };
  const W = m.width, H = m.height, year = w.year;
  const bg = blockGrid(m);
  const rng = new Rng(`${w.seed}:grow:${year}:${season}`);

  // ---- community make-up per 8×8 cell, and which cells have each community's church
  const cw = Math.ceil(W / CELL), ch = Math.ceil(H / CELL);
  const cs = cellScratch(cw * ch), cellPop = cs.cellPop, cellTot = cs.cellTot, church = cs.church;
  const groupTot = new Float64Array(NG);
  let total = 0;
  const band = simBand(m), sp = band.spans, bw8 = band.weight;
  for (let s = 0; s < sp.length; s += 3) {
    const y = sp[s], crow = ((y / CELL) | 0) * cw, row = y * W;
    for (let x = sp[s + 1], xe = sp[s + 2]; x < xe; x++) {
      const i = row + x, p = w.pop[i];
      if (p) { const c = crow + ((x / CELL) | 0), e = w.eth[i]; cellPop[c * NG + e] += p; cellTot[c] += p; groupTot[e] += p; total += p; }
      else if (w.use[i] === Use.Civic && w.eth[i] && CHURCH_SUBS.has(w.sub[i])) {
        // a church serves its own cell and the cells around it (~700 m)
        const cx = (x / CELL) | 0, cy = (y / CELL) | 0;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          const xx = cx + dx, yy = cy + dy;
          if (xx >= 0 && yy >= 0 && xx < cw && yy < ch) church[(yy * cw + xx) * NG + w.eth[i]] = 1;
        }
      }
    }
  }
  // share of each community in a cell and its neighbours (smoothed), for chain migration — as a pull already raised to 0.8
  const pull = cs.pull;
  const a = new Float32Array(NG);
  for (let cy = 0; cy < ch; cy++) for (let cx = 0; cx < cw; cx++) {
    let t = 0;
    a.fill(0);
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const xx = cx + dx, yy = cy + dy;
      if (xx < 0 || yy < 0 || xx >= cw || yy >= ch) continue;
      const k = yy * cw + xx;
      if (!cellTot[k]) continue;
      const wt = dx || dy ? 0.5 : 1;
      t += cellTot[k] * wt;
      for (let gI = 1; gI < NG; gI++) a[gI] += cellPop[k * NG + gI] * wt;
    }
    if (t > 0) for (let gI = 1; gI < NG; gI++) if (a[gI]) pull[(cy * cw + cx) * NG + gI] = Math.pow(a[gI] / t, 0.8);
  }

  // ---- which lots could take a house (kept between seasons; only lots near a change are re-examined)
  const hillB = hillBonus(m, year);
  const anchorIdx = anchorIndex(m);
  const st = lotState(m, w, plants, hillB);

  // ---- candidate lots and the part of their score that doesn't depend on who's coming
  const cand: number[] = [], base: number[] = [], lv: number[] = [], pol: number[] = [], cell: number[] = [];
  const anch: number[] = [];
  const pop = w.pop, terrain = m.terrain, landValue = w.landValue, pollution = w.pollution, elig = st.elig;
  const noiseSeed = w.seed + year * 4 + season;
  for (let s = 0; s < sp.length; s += 3) {
    const y = sp[s], row = y * W, crow = ((y / CELL) | 0) * cw;
    for (let x = sp[s + 1], xe = sp[s + 2]; x < xe; x++) {
      const i = row + x, e = elig[i];
      if (!e) continue;
      const t = terrain[i], hill = hillB[i], p = pop[i], pike = e === 2;
      const steep = t === Terrain.Steep ? 0.45 : t === Terrain.Slope ? 0.15 : 0;
      const s = 1.6 * sampleBlock(bg, access, x, y) + (p ? 0.35 : 0) + (pike ? 0.1 : 0) + 0.45 * hill - steep * (1 - hill * 0.7)
        + 0.3 * tileNoise(noiseSeed, x, y, 611) - 1.5 * (1 - bw8[i]); // the band's edge: lots thin out
      cand.push(i); base.push(s);
      lv.push(Math.min(1, landValue[i] / 250)); pol.push(Math.min(1.5, pollution[i]));
      cell.push(crow + ((x / CELL) | 0));
      anch.push(anchorIdx[i]);
    }
  }
  if (!cand.length) return { placed: 0, byGroup };

  // ---- who is coming: newcomers by this year's waves, locals by today's make-up
  const waves = GROUPS.map((gr) => (gr.id ? gr.wave(year) + 0.01 : 0));
  const waveSum = waves.reduce((a, b) => a + b, 0) || 1;
  const newFrac = Math.min(0.8, 0.3 + immigrationPressure(year) * 0.15);
  const people = GROUPS.map((gr) => (gr.id ? room * (newFrac * waves[gr.id] / waveSum + (1 - newFrac) * (total ? groupTot[gr.id] / total : 0)) : 0));
  // how new a community is: a big wave relative to the people already here
  const newness = GROUPS.map((gr) => (gr.id ? Math.min(1, (waves[gr.id] / waveSum) / ((total ? groupTot[gr.id] / total : 0) + 0.03) / 3) : 0));

  const taken = new Uint8Array(cand.length);
  const order = GROUPS.map((gr) => gr.id).filter((gI) => gI && people[gI] >= 15).sort((a, b) => people[b] - people[a]);
  const score = new Float32Array(cand.length);
  let placed = 0;
  for (const gI of order) {
    const nw = newness[gI];
    // the historic pull of named neighbourhoods on this community this year
    const anchorPull = ANCHORS.map((a) => { let v = 0; for (const [gid, f, from, to] of a.prefs) if (gid === gI && year >= (from ?? 0) && year <= (to ?? 9999)) v += 0.35 * Math.log(f); return v; });
    const lvK = 0.45 - 1.0 * nw, polK = -(1.0 - 1.25 * nw); // newcomers take the smoky lots by the mills; the settled move away from the smoke
    for (let k = 0; k < cand.length; k++) {
      if (taken[k]) { score[k] = -1e9; continue; }
      const i = cand[k];
      if (w.pop[i] && w.eth[i] !== gI) { score[k] = -1e9; continue; } // share a home with your own
      const ci = cell[k] * NG + gI;
      score[k] = base[k] + 1.8 * pull[ci] + (church[ci] ? 0.3 : 0) + lvK * lv[k] + polK * pol[k] + (anch[k] >= 0 ? anchorPull[anch[k]] : 0);
    }
    // the best lots for this community: estimate the cut-off from a sample, then sort what's above it
    const lots = Math.ceil(people[gI] / 11) * 2 + 4;
    const sample = new Float64Array(3000);
    for (let k = 0; k < 3000; k++) sample[k] = score[rng.int(0, cand.length - 1)];
    sample.sort(); // ascending (native numeric sort); read from the top
    const cut = sample[sample.length - 1 - Math.min(sample.length - 1, Math.floor((lots / cand.length) * sample.length * 1.5))] ?? -1e9;
    const best: number[] = [];
    for (let k = 0; k < cand.length; k++) if (score[k] >= cut && score[k] > -1e8) best.push(k);
    best.sort((a, b) => score[b] - score[a]);
    let left = Math.round(people[gI]);
    for (const k of best) {
      if (left <= 0) break;
      const i = cand[k], x = i % W, y = (i / W) | 0;
      const cap = Math.min(POP_CAP.rowhouses, terrainCap(m.terrain[i]), densityCap(m, w, i));
      const fresh = w.pop[i] === 0;
      const add = Math.min(cap - w.pop[i], left, fresh ? 18 : 10);
      if (add <= 0) continue;
      if (fresh) {
        w.eth[i] = gI;
        w.built[i] = year;
        const byWorks = plants.some(([px, py]) => stepDist(px - x, py - y) < 12);
        w.sub[i] = byWorks && nw > 0.4 ? HouseSub.Shanty : HouseSub.Normal;
        taken[k] = 1;
      }
      w.pop[i] += add;
      w.use[i] = useForPop(w.pop[i]);
      left -= add; placed += add; byGroup[gI] += add;
    }
  }
  if (placed) w.version++;
  return { placed, byGroup };
}

// ---------------------------------------------------------------- lots that could take a house (v0.24)
//
// A lot is a candidate when it lies within 2 tiles of development in the band (or near a works), isn't owned,
// a street, a road or a building that never takes a house, is habitable (or a hillside lot once its
// neighbourhood opens, any steep lot from 1900), has room under its cap, fronts a street (or already has
// people), and — if empty — isn't a ravine, a garden or against a works' fence. All of that depends on the
// tile and its neighbours within 2. So instead of re-examining every band tile each season, the state is kept
// and only lots within 2 of a tile whose people, use, street or owner changed since the last season are
// re-examined. A new year (hillsides open, the 1900 steep rule), a works moving, or a new world rebuilds it all.

interface LotState {
  m: GameMap; w: World; year: number; plantsKey: string; settlements: number;
  /** 0 not a candidate, 1 candidate, 2 candidate fronting a pike */
  elig: Uint8Array;
  /** 1 within 2 tiles of development in the band, or of a works */
  near: Uint8Array;
  prevPop: Uint16Array; prevUse: Uint8Array; prevStreet: Uint8Array; prevOwner: Uint8Array;
  mark: Uint8Array;
}
let lots: LotState | null = null;

function lotState(m: GameMap, w: World, plants: [number, number][], hillB: Float32Array): LotState {
  const plantsKey = plants.map(([x, y]) => `${x},${y}`).join(";");
  const W = m.width, n = W * m.height, band = simBand(m), mask = band.mask;
  const st = lots;
  if (!st || st.m !== m || st.w !== w || st.year !== w.year || st.plantsKey !== plantsKey || st.settlements !== w.settlements.length) {
    const s: LotState = lots && lots.elig.length === n ? lots : {
      m, w, year: 0, plantsKey: "", settlements: 0, elig: new Uint8Array(n), near: new Uint8Array(n),
      prevPop: new Uint16Array(n), prevUse: new Uint8Array(n), prevStreet: new Uint8Array(n), prevOwner: new Uint8Array(n), mark: new Uint8Array(n),
    };
    Object.assign(s, { m, w, year: w.year, plantsKey, settlements: w.settlements.length });
    nearAll(m, w, plants, s.near);
    s.elig.fill(0);
    const sp = band.spans, blocked = lotBlocked(m, w.seed);
    for (let k = 0; k < sp.length; k += 3) for (let y = sp[k], x = sp[k + 1], xe = sp[k + 2]; x < xe; x++) s.elig[y * W + x] = lotEligible(m, w, s.near, blocked, hillB, x, y);
    s.prevPop.set(w.pop); s.prevUse.set(w.use); s.prevStreet.set(w.street); s.prevOwner.set(w.owner);
    lots = s;
    return s;
  }
  // what changed since last season (within each band row's extent, which takes in every tile within 2 of the band)
  const { prevPop, prevUse, prevStreet, prevOwner, mark, near, elig } = st, pop = w.pop, use = w.use, street = w.street, owner = w.owner;
  const { lo, hi } = diffRows(m), H = m.height, redo: number[] = [];
  for (let y = 0; y < H; y++) for (let i = y * W + lo[y], ie = y * W + hi[y]; i < ie; i++) {
    if (pop[i] === prevPop[i] && use[i] === prevUse[i] && street[i] === prevStreet[i] && owner[i] === prevOwner[i]) continue;
    prevPop[i] = pop[i]; prevUse[i] = use[i]; prevStreet[i] = street[i]; prevOwner[i] = owner[i];
    const x = i % W;
    for (let yy = Math.max(0, y - 2); yy <= Math.min(H - 1, y + 2); yy++) for (let xx = Math.max(0, x - 2); xx <= Math.min(W - 1, x + 2); xx++) {
      const j = yy * W + xx;
      if (!mark[j] && mask[j]) { mark[j] = 1; redo.push(j); }
    }
  }
  if (!redo.length) return st;
  const blocked = lotBlocked(m, w.seed);
  // near development first (eligibility reads it), then eligibility
  for (const j of redo) near[j] = nearAt(m, w, plants, mask, j % W, (j / W) | 0);
  for (const j of redo) { mark[j] = 0; elig[j] = lotEligible(m, w, near, blocked, hillB, j % W, (j / W) | 0); }
  return st;
}

const diffCache = new WeakMap<GameMap, { lo: Int32Array; hi: Int32Array }>();
/** per row, the columns where a change can reach a band lot: each band row's extent, spread 2 rows up and down */
function diffRows(m: GameMap) {
  let d = diffCache.get(m);
  if (d) return d;
  const H = m.height, b = simBand(m), lo = new Int32Array(H), hi = new Int32Array(H);
  for (let y = 0; y < H; y++) {
    let a = m.width, z = 0;
    for (let yy = Math.max(0, y - 2); yy <= Math.min(H - 1, y + 2); yy++) if (b.rowHi[yy] > b.rowLo[yy]) { a = Math.min(a, b.rowLo[yy]); z = Math.max(z, b.rowHi[yy]); }
    if (z > a) { lo[y] = a; hi[y] = z; }
  }
  d = { lo, hi };
  diffCache.set(m, d);
  return d;
}

/** developed: people, a shop or a civic building, in the band */
const devAt = (w: World, mask: Uint8Array, i: number) => mask[i] === 1 && (w.pop[i] > 0 || w.use[i] === Use.Commerce || w.use[i] === Use.Civic);

/** is (x, y) within 2 tiles of development in the band, or within 14 of a works? */
function nearAt(m: GameMap, w: World, plants: [number, number][], mask: Uint8Array, x: number, y: number): number {
  const W = m.width;
  for (let yy = Math.max(0, y - 2), ye = Math.min(m.height - 1, y + 2); yy <= ye; yy++)
    for (let xx = Math.max(0, x - 2), xe = Math.min(W - 1, x + 2); xx <= xe; xx++) if (devAt(w, mask, yy * W + xx)) return 1;
  for (const [px, py] of plants) if (Math.abs(px - x) <= 14 && Math.abs(py - y) <= 14) return 1;
  return 0;
}

/** the whole near-development field: developed band tiles grown by 2 (a 5×5 box) as two running-window passes */
function nearAll(m: GameMap, w: World, plants: [number, number][], near: Uint8Array) {
  const W = m.width, H = m.height, n = W * H, band = simBand(m), sp = band.spans;
  const horiz = scratch(n).horiz;
  horiz.fill(0); near.fill(0);
  const pop = w.pop, use = w.use;
  // each band run marks the tiles within 2 of its developed tiles; runs in the same row OR together
  const ring = new Uint8Array(5);
  for (let s = 0; s < sp.length; s += 3) {
    const row = sp[s] * W, xs = sp[s + 1], xe = sp[s + 2];
    let run = 0;
    ring.fill(0);
    for (let x = xs; x < xe + 4; x++) {
      const k = x % 5;
      run -= ring[k];
      let d = 0;
      if (x < xe) { const i = row + x; d = (pop[i] || use[i] === Use.Commerce || use[i] === Use.Civic) ? 1 : 0; }
      ring[k] = d; run += d;
      // the window holds x-4..x: its centre x-2 is near development if any of them is developed
      const cx = x - 2;
      if (run > 0 && cx >= 0 && cx < W) horiz[row + cx] = 1;
    }
  }
  // vertical: a running column sum over a 5-row window, each row over its own band extent
  const col = new Int32Array(W), lo = band.rowLo, hi = band.rowHi;
  for (let y = 0; y < H + 2; y++) {
    if (y < H) { const r = y * W; for (let x = lo[y], xe = hi[y]; x < xe; x++) col[x] += horiz[r + x]; }
    if (y - 5 >= 0) { const r = (y - 5) * W; for (let x = lo[y - 5], xe = hi[y - 5]; x < xe; x++) col[x] -= horiz[r + x]; }
    const cy = y - 2;
    if (cy >= 0 && cy < H) { const r = cy * W; for (let x = lo[cy], xe = hi[cy]; x < xe; x++) if (col[x] > 0) near[r + x] = 1; }
  }
  for (const [px, py] of plants) for (let y = py - 14; y <= py + 14; y++) for (let x = px - 14; x <= px + 14; x++) if (inBounds(m, x, y)) near[y * W + x] = 1;
}

/** 0 not a candidate lot, 1 a candidate, 2 a candidate fronting a pike */
function lotEligible(m: GameMap, w: World, near: Uint8Array, blocked: Uint8Array, hillB: Float32Array, x: number, y: number): number {
  const W = m.width, i = y * W + x, street = w.street, road = m.road;
  if (!near[i] || w.owner[i] || street[i] || road[i]) return 0;
  const t = m.terrain[i];
  if (NO_HOUSE[w.use[i]]) return 0;
  if (!habitable(t) && !(t === Terrain.Steep && (hillB[i] > 0 || w.year >= 1900))) return 0;
  const p = w.pop[i];
  const cap = Math.min(POP_CAP.rowhouses, terrainCap(t), densityCap(m, w, i));
  if (p >= cap) return 0;
  // houses front onto streets: a street or road in the seven cells around
  let onStreet = false, pike = false;
  if (road[i] || street[i]) { onStreet = true; pike = street[i] === Street.Pike; }
  for (let k = 0; k < 6 && !onStreet; k++) {
    const nx = x + HEX6[k][0], ny = y + HEX6[k][1];
    if (nx < 0 || ny < 0 || nx >= W || ny >= m.height) continue;
    const j = ny * W + nx, sj = street[j];
    if (road[j] || sj) { onStreet = true; pike = sj === Street.Pike; }
  }
  if (!onStreet && !p) return 0;
  if (!p && (blocked[i] || besideWorks(m, w, x, y))) return 0; // ravines and gardens; a works keeps a yard and a fence between it and the houses
  return pike ? 2 : 1;
}

let cellBufs: { cells: number; cellPop: Float32Array; cellTot: Float32Array; church: Uint8Array; pull: Float32Array } | null = null;
/** the per-cell community arrays, reused (zeroed) each season */
function cellScratch(cells: number) {
  if (!cellBufs || cellBufs.cells !== cells) cellBufs = { cells, cellPop: new Float32Array(cells * NG), cellTot: new Float32Array(cells), church: new Uint8Array(cells * NG), pull: new Float32Array(cells * NG) };
  else { cellBufs.cellPop.fill(0); cellBufs.cellTot.fill(0); cellBufs.church.fill(0); cellBufs.pull.fill(0); }
  return cellBufs;
}

let scratchBufs: { n: number; horiz: Uint8Array } | null = null;
/** a whole-map byte array reused rather than allocated each rebuild */
function scratch(n: number) {
  if (!scratchBufs || scratchBufs.n !== n) scratchBufs = { n, horiz: new Uint8Array(n) };
  return scratchBufs;
}

let blockedCache: { m: GameMap; seed: number; f: Uint8Array } | null = null;
/** lots that never take a first house: wooded ravines between the terraces, gardens, vacant lots and alleys (fixed per town) */
export function lotBlocked(m: GameMap, seed: number): Uint8Array {
  if (blockedCache && blockedCache.m === m && blockedCache.seed === seed) return blockedCache.f;
  const W = m.width, f = new Uint8Array(W * m.height);
  for (let y = 0; y < m.height; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x, t = m.terrain[i];
    if ((t === Terrain.Steep || t === Terrain.Slope) && valueNoise(seed & 0xffff, x, y, 5, 612) > (t === Terrain.Steep ? 0.55 : 0.68)) f[i] = 1;
    else if (tileNoise(seed, x, y, 613) < 0.1) f[i] = 1;
  }
  blockedCache = { m, seed, f };
  return f;
}

let hillCache: { m: GameMap; year: number; f: Float32Array } | null = null;
/** 0..1 per tile: inside a hillside neighbourhood that has opened (strongest near its centre and before its peak) */
function hillBonus(m: GameMap, year: number): Float32Array {
  if (hillCache && hillCache.m === m && hillCache.year === year) return hillCache.f;
  const f = new Float32Array(m.width * m.height);
  for (const h of HILLSIDES) {
    if (year < h.year) continue;
    const [hx, hy] = latLonToTile(m, h.lat, h.lon);
    const r = (h.radiusM / m.metersPerTile) * 1.4, ramp = year <= h.peak ? 1 : Math.max(0.2, 1 - (year - h.peak) / 30);
    const rb = r * 1.6; // a disc of r steps reaches ~1.6 r along an axial row
    for (let y = Math.max(0, Math.floor(hy - rb)); y <= Math.min(m.height - 1, Math.ceil(hy + rb)); y++)
      for (let x = Math.max(0, Math.floor(hx - rb)); x <= Math.min(m.width - 1, Math.ceil(hx + rb)); x++) {
        const d = stepDist(hx - x, hy - y);
        if (d < r) { const i = y * m.width + x; f[i] = Math.max(f[i], ramp * (1 - (d / r) * 0.5)); }
      }
  }
  hillCache = { m, year, f };
  return f;
}

/** is a tile next to a works (yours or a rival's)? Houses aren't built against the mill walls. */
export function besideWorks(m: GameMap, w: World, x: number, y: number): boolean {
  for (const [dx, dy] of HEX6) {
    if ((!dx && !dy) || !inBounds(m, x + dx, y + dy)) continue;
    const u = w.use[(y + dy) * m.width + x + dx];
    if (u === Use.Industry || u === Use.Rival) return true;
  }
  return false;
}
