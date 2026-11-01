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

import { ANCHORS, anchorIndex, GROUPS, immigrationPressure } from "./ancestry";
import { blockGrid, sampleBlock } from "./blocks";
import { HILLSIDES, latLonToTile } from "./features";
import { type GameMap, inBounds } from "./map";
import { CELL, NG } from "./neighbourhood";
import { Rng, tileNoise, valueNoise } from "./rng";
import { habitable, Terrain } from "./terrain";
import { CivicSub, densityCap, HouseSub, POP_CAP, Street, terrainCap, Use, useForPop, type World } from "./town";

const CHURCH_SUBS = new Set<number>([CivicSub.Church, CivicSub.OnionChurch, CivicSub.TwinChurch, CivicSub.Synagogue, CivicSub.BlackChurch]);

export interface GrowthReport { placed: number; byGroup: number[] }

export function growByDesire(m: GameMap, w: World, access: Float32Array, plants: [number, number][], room: number, season: number): GrowthReport {
  const byGroup = new Array(NG).fill(0);
  if (room <= 0) return { placed: 0, byGroup };
  const W = m.width, H = m.height, n = W * H, year = w.year;
  const bg = blockGrid(m);
  const rng = new Rng(`${w.seed}:grow:${year}:${season}`);

  // ---- community make-up per 8×8 cell, and which cells have each community's church
  const cw = Math.ceil(W / CELL), ch = Math.ceil(H / CELL);
  const cellPop = new Float32Array(cw * ch * NG), cellTot = new Float32Array(cw * ch);
  const church = new Uint8Array(cw * ch * NG);
  const groupTot = new Float64Array(NG);
  let total = 0;
  for (let y = 0; y < H; y++) {
    const crow = ((y / CELL) | 0) * cw, row = y * W;
    for (let x = 0; x < W; x++) {
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
  const pull = new Float32Array(cw * ch * NG);
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

  // ---- land near existing development (towns grow outward, not as scattered lots)
  // developed tiles grown by 2 in each direction (a 5×5 box), as two running-window passes
  const dev = new Uint8Array(n), horiz = new Uint8Array(n), near = new Uint8Array(n);
  for (let i = 0; i < n; i++) if (w.pop[i] || w.use[i] === Use.Commerce || w.use[i] === Use.Civic) dev[i] = 1;
  for (let y = 0; y < H; y++) {
    const row = y * W;
    let run = 0;
    for (let x = 0; x < W + 2; x++) {
      if (x < W) run += dev[row + x];
      if (x - 5 >= 0) run -= dev[row + x - 5];
      const cx = x - 2;
      if (cx >= 0 && cx < W && run > 0) horiz[row + cx] = 1;
    }
  }
  // vertical pass row by row (cache-friendly): a running column sum over a 5-row window
  const col = new Int32Array(W);
  for (let y = 0; y < H + 2; y++) {
    if (y < H) { const r = y * W; for (let x = 0; x < W; x++) col[x] += horiz[r + x]; }
    if (y - 5 >= 0) { const r = (y - 5) * W; for (let x = 0; x < W; x++) col[x] -= horiz[r + x]; }
    const cy = y - 2;
    if (cy >= 0 && cy < H) { const r = cy * W; for (let x = 0; x < W; x++) if (col[x] > 0) near[r + x] = 1; }
  }
  for (const [px, py] of plants) for (let y = py - 14; y <= py + 14; y++) for (let x = px - 14; x <= px + 14; x++) if (inBounds(m, x, y)) near[y * W + x] = 1;

  const hillB = hillBonus(m, year);
  const anchorIdx = anchorIndex(m);

  // ---- candidate lots and the part of their score that doesn't depend on who's coming
  const cand: number[] = [], base: number[] = [], lv: number[] = [], pol: number[] = [], cell: number[] = [];
  const anch: number[] = [];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x;
    if (!near[i] || w.owner[i] || w.street[i] || m.road[i]) continue;
    const u = w.use[i], t = m.terrain[i];
    if (u === Use.Civic || u === Use.Landmark || u === Use.Wharf || u === Use.Commerce || u === Use.Mine || u === Use.Incline || u === Use.Industry || u === Use.Rival || u === Use.Park) continue;
    const hill = hillB[i];
    if (!habitable(t) && !(t === Terrain.Steep && (hill > 0 || year >= 1900))) continue;
    const cap = Math.min(POP_CAP.rowhouses, terrainCap(t), densityCap(m, w, i));
    if (w.pop[i] >= cap) continue;
    let onStreet = false, pike = false;
    for (let dy = -1; dy <= 1 && !onStreet; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (!inBounds(m, x + dx, y + dy)) continue;
      const j = (y + dy) * W + x + dx;
      if (m.road[j] || w.street[j]) { onStreet = true; pike = w.street[j] === Street.Pike; break; }
    }
    if (!onStreet && !w.pop[i]) continue; // houses front onto streets
    if (!w.pop[i] && besideWorks(m, w, x, y)) continue; // a works keeps a yard and a fence between it and the houses
    if (!w.pop[i] && (t === Terrain.Steep || t === Terrain.Slope) && valueNoise(w.seed & 0xffff, x, y, 5, 612) > (t === Terrain.Steep ? 0.55 : 0.68)) continue; // wooded ravines between terraces
    if (!w.pop[i] && tileNoise(w.seed, x, y, 613) < 0.1) continue; // gardens, vacant lots, alleys
    const steep = t === Terrain.Steep ? 0.45 : t === Terrain.Slope ? 0.15 : 0;
    const s = 1.6 * sampleBlock(bg, access, x, y) + (w.pop[i] ? 0.35 : 0) + (pike ? 0.1 : 0) + 0.45 * hill - steep * (1 - hill * 0.7)
      + 0.3 * tileNoise(w.seed + year * 4 + season, x, y, 611);
    cand.push(i); base.push(s);
    lv.push(Math.min(1, w.landValue[i] / 250)); pol.push(Math.min(1.5, w.pollution[i]));
    cell.push(((y / CELL) | 0) * cw + ((x / CELL) | 0));
    anch.push(anchorIdx[i]);
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
    const sample: number[] = [];
    for (let k = 0; k < 3000; k++) sample.push(score[rng.int(0, cand.length - 1)]);
    sample.sort((a, b) => b - a);
    const cut = sample[Math.min(sample.length - 1, Math.floor((lots / cand.length) * sample.length * 1.5))] ?? -1e9;
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
        const byWorks = plants.some(([px, py]) => Math.hypot(px - x, py - y) < 12);
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

let hillCache: { m: GameMap; year: number; f: Float32Array } | null = null;
/** 0..1 per tile: inside a hillside neighbourhood that has opened (strongest near its centre and before its peak) */
function hillBonus(m: GameMap, year: number): Float32Array {
  if (hillCache && hillCache.m === m && hillCache.year === year) return hillCache.f;
  const f = new Float32Array(m.width * m.height);
  for (const h of HILLSIDES) {
    if (year < h.year) continue;
    const [hx, hy] = latLonToTile(m, h.lat, h.lon);
    const r = (h.radiusM / m.metersPerTile) * 1.4, ramp = year <= h.peak ? 1 : Math.max(0.2, 1 - (year - h.peak) / 30);
    for (let y = Math.max(0, Math.floor(hy - r)); y <= Math.min(m.height - 1, Math.ceil(hy + r)); y++)
      for (let x = Math.max(0, Math.floor(hx - r)); x <= Math.min(m.width - 1, Math.ceil(hx + r)); x++) {
        const d = Math.hypot(hx - x, hy - y);
        if (d < r) { const i = y * m.width + x; f[i] = Math.max(f[i], ramp * (1 - (d / r) * 0.5)); }
      }
  }
  hillCache = { m, year, f };
  return f;
}

/** is a tile next to a works (yours or a rival's)? Houses aren't built against the mill walls. */
export function besideWorks(m: GameMap, w: World, x: number, y: number): boolean {
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    if ((!dx && !dy) || !inBounds(m, x + dx, y + dy)) continue;
    const u = w.use[(y + dy) * m.width + x + dx];
    if (u === Use.Industry || u === Use.Rival) return true;
  }
  return false;
}
