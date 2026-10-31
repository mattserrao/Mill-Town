// Getting to work. Travel times are computed on the block grid (4×4 tiles, 120 m) by the mode of the era:
// walking (always), horsecars on the main roads (1859–90), electric streetcars (1890–1955), and the car, which
// takes over from the 1920s. Rivers can only be crossed where a bridge stands; inclines lift you up the hill.
//
// From every job centre (the works, downtown, the town centres) a travel-time field is computed once a year.
// The fields give each block a "jobs within reach" value (what the growth model uses to place newcomers), and
// each season a sample of households makes the trip to work along them — Micropolis' trip test, but on
// shortest paths. Those trips are the traffic: it decides how many people and vehicles you see on each street.

import { B, blockGrid, blockOf, percentile } from "./blocks";
import { INDUSTRIES } from "./industries";
import { MinHeap, modeCost, Street, Use, type World } from "./town";
import type { GameMap } from "./map";
import type { Rng } from "./rng";
import { Terrain } from "./terrain";

export interface Center { x: number; y: number; jobs: number; name: string }

export interface Commute {
  year: number;
  /** minutes to cross each block */
  cost: Float32Array;
  centers: Center[];
  /** minutes from each centre to every block */
  fields: Float32Array[];
  /** jobs within reach per block, 0..1 */
  access: Float32Array;
}

const TAU = 20;          // minutes: how fast willingness to commute falls off
const MAX_MIN = 100;


export function blockCosts(m: GameMap, w: World): Float32Array {
  const g = blockGrid(m);
  const streets = new Uint8Array(g.n), pikes = new Uint8Array(g.n), bridge = new Uint8Array(g.n), incline = new Uint8Array(g.n);
  const water = new Uint8Array(g.n), slope = new Float32Array(g.n), cnt = new Uint8Array(g.n);
  for (let y = 0; y < m.height; y++) for (let x = 0; x < m.width; x++) {
    const i = y * m.width + x, b = blockOf(g, x, y);
    cnt[b]++;
    if (m.terrain[i] === Terrain.Water) water[b]++;
    slope[b] += m.slope[i];
    const s = w.street[i];
    if (s) streets[b]++;
    if (s === Street.Pike) pikes[b] = 1;
    if (s === Street.Bridge) bridge[b] = 1;
    if (w.use[i] === Use.Incline) incline[b] = 1;
  }
  const cost = new Float32Array(g.n);
  for (let b = 0; b < g.n; b++) {
    if (water[b] > cnt[b] * 0.5 && !bridge[b]) { cost[b] = Infinity; continue; }
    if (incline[b]) { cost[b] = 0.4; continue; }
    cost[b] = modeCost(w.year, streets[b] >= 2, pikes[b] === 1) + (slope[b] / cnt[b]) * 0.06;
  }
  return cost;
}

export function travelField(m: GameMap, cost: Float32Array, cx: number, cy: number): Float32Array {
  const g = blockGrid(m), { bw, bh } = g;
  // search in doubles (comparing doubles against float32-rounded values re-pushes nodes endlessly)
  const dist = new Float64Array(g.n).fill(Infinity);
  const s = blockOf(g, cx, cy);
  const heap = new MinHeap();
  dist[s] = 0; heap.push(s, 0);
  while (heap.size) {
    const b = heap.popMin(), d = heap.topKey;
    if (d > dist[b] || d > MAX_MIN) continue;
    const x = b % bw, y = (b / bw) | 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= bw || ny >= bh) continue;
      const nb = ny * bw + nx;
      const c = cost[nb];
      if (!isFinite(c)) continue;
      const nd = d + ((cost[b] + c) / 2) * (dx && dy ? 1.414 : 1);
      if (nd < dist[nb]) { dist[nb] = nd; heap.push(nb, nd); }
    }
  }
  return Float32Array.from(dist);
}

export interface WorksSite { x: number; y: number; fp: number; jobs: number; name: string }

/** Job centres: every works, downtown, and the busiest town centres. */
export function jobCenters(m: GameMap, w: World, works: WorksSite[], totalPop: number): Center[] {
  const out: Center[] = works.filter((s) => s.jobs > 0).map((s) => ({ x: s.x + (s.fp >> 1), y: s.y + (s.fp >> 1), jobs: s.jobs, name: s.name }));
  const point = m.landmarks.find((l) => l.name.startsWith("The Point"));
  if (point) out.push({ x: point.x + 10, y: point.y + 4, jobs: totalPop * 0.12, name: "Downtown" });
  const towns = m.landmarks.filter((l) => l.kind === "town" && !l.name.startsWith("The Point")).map((l) => {
    let pop = 0;
    for (let y = l.y - 20; y <= l.y + 20; y += 2) for (let x = l.x - 20; x <= l.x + 20; x += 2) if (x >= 0 && y >= 0 && x < m.width && y < m.height) pop += w.pop[y * m.width + x] * 4;
    return { x: l.x, y: l.y, jobs: pop * 0.08, name: l.name };
  }).filter((t) => t.jobs > 150).sort((a, b) => b.jobs - a.jobs).slice(0, 6);
  return out.concat(towns);
}

/** Yearly: block travel costs, a travel-time field from every job centre, and jobs within reach per block. */
export function buildCommute(m: GameMap, w: World, centers: Center[]): Commute {
  const g = blockGrid(m);
  const cost = blockCosts(m, w);
  const fields = centers.map((c) => travelField(m, cost, c.x, c.y));
  const access = new Float32Array(g.n);
  centers.forEach((c, k) => { const f = fields[k]; for (let b = 0; b < g.n; b++) if (f[b] < MAX_MIN) access[b] += c.jobs * Math.exp(-f[b] / TAU); });
  const norm = percentile(access, 0.97);
  for (let b = 0; b < g.n; b++) access[b] = Math.min(1, access[b] / norm);
  return { year: w.year, cost, centers, fields, access };
}

/**
 * Each season a sample of households goes to work: each picks a job centre by jobs and travel time and
 * walks (or rides) the fastest path; every block they pass gets traffic. Traffic fades by half each season.
 */
export function runTrips(m: GameMap, w: World, cm: Commute, traffic: Float32Array, rng: Rng, samples = 600): number {
  const g = blockGrid(m), { bw } = g;
  for (let b = 0; b < g.n; b++) traffic[b] *= 0.5;
  if (!cm.centers.length) return 1;
  // populated tiles, for sampling homes in proportion to people
  const tiles: number[] = [], cum: number[] = [];
  let total = 0;
  for (let i = 0; i < w.pop.length; i += 1) if (w.pop[i]) { total += w.pop[i]; tiles.push(i); cum.push(total); }
  if (!total) return 1;
  const weight = total / samples / 5; // households per trip
  for (let k = 0; k < samples; k++) {
    const r = rng.next() * total;
    let lo = 0, hi = cum.length - 1;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (cum[mid] < r) lo = mid + 1; else hi = mid; }
    const i = tiles[lo], x = i % m.width, y = (i / m.width) | 0;
    let b = blockOf(g, x, y);
    // choose where to work
    let sum = 0;
    const p = cm.centers.map((c, j) => { const t = cm.fields[j][b]; const v = t < MAX_MIN ? c.jobs * Math.exp(-t / TAU) : 0; sum += v; return v; });
    if (!sum) continue;
    let pick = rng.next() * sum, j = 0;
    while (j < p.length - 1 && (pick -= p[j]) > 0) j++;
    const f = cm.fields[j];
    // follow the travel-time field downhill to the centre
    for (let step = 0; step < 300 && f[b] > 0; step++) {
      traffic[b] += weight;
      const bx = b % bw, by = (b / bw) | 0;
      let nb = b, nv = f[b];
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const xx = bx + dx, yy = by + dy;
        if (xx < 0 || yy < 0 || xx >= bw || yy >= g.bh) continue;
        const c = yy * bw + xx;
        if (f[c] < nv) { nv = f[c]; nb = c; }
      }
      if (nb === b) break;
      b = nb;
    }
  }
  return percentile(traffic, 0.95);
}

/** jobs a works offers, for the job-centre list */
export function worksJobs(industry: keyof typeof INDUSTRIES, output: number): number {
  return output * INDUSTRIES[industry].workersPerUnit;
}

export { B };
