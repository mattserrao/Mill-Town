// v0.27 The town turns out: funerals, parades and feast days, engine runs to a fire, election crowds, and the daily
// crowds at the churches, schools and markets. The happenings come from the simulation (core/civiclife.ts
// `civ.happen`, `civ.burning`); here each becomes a procession along the streets or a crowd standing about, drawn
// with the street figures by traffic.ts. Nothing is simulated off screen.

import type { GameState } from "../core/game";
import type { Happening } from "../core/civiclife";
import type { GameMap } from "../core/map";
import { Rng, tileNoise } from "../core/rng";
import { CivicSub, ShopSub, Street, Use } from "../core/town";
import { type Look, motorEra, poolLook, type VehicleSpec } from "./figures";

export interface GFig {
  fx: number; fy: number;
  /** heading (for facing) */
  tx: number; ty: number;
  look?: Look; spec?: VehicleSpec;
  moving: boolean;
  placard?: number;
  flame?: boolean;
  seed: number;
}

interface Member { look?: Look; spec?: VehicleSpec; back: number; side: number; placard?: number }
interface Procession { key: string; path: [number, number][]; len: number; speed: number; members: Member[]; stay: boolean; t0: number; lag: number; crowd: { look: Look; fx: number; fy: number }[] }
interface Crowd { key: string; figs: { look: Look; fx: number; fy: number }[]; phase: number; on: number }

const MOURN: Look[] = [
  { key: "mourn1", female: false, hat: "#141418", hair: "#2a2420", skin: "#d8a882", top: "#1a1a1e", low: "#16161a", long: false },
  { key: "mourn2", female: true, hat: "#141418", hair: "#2a2420", skin: "#e0b090", top: "#1c1a1e", low: "#141216", long: true },
  { key: "mourn3", female: false, hat: "#1e1e22", hair: "#3a2a1e", skin: "#c08a64", top: "#22222a", low: "#1a1a1e", long: false },
];
const BAND: Look = { key: "band", female: false, hat: "#1e2a4a", hair: "#2a2420", skin: "#d8a882", top: "#2a3a6a", low: "#1e2a4a", long: false, cap: true };
const VETS: Look = { key: "vets", female: false, hat: "#2a3446", hair: "#7a7a76", skin: "#d8a882", top: "#2c3a56", low: "#2a3446", long: false, cap: true };
const FIREMEN: Look = { key: "firemen", female: false, hat: "#1a1a1e", hair: "#2a2420", skin: "#d8a882", top: "#1e2a4a", low: "#1a1a22", long: false };

export class Gatherings {
  private procs: Procession[] = [];
  private crowds: Crowd[] = [];
  private crowdKey = "";
  private flames: [number, number][] = [];
  constructor(private m: GameMap) {}

  reset() { this.procs = []; this.crowds = []; this.crowdKey = ""; this.flames = []; }

  /** what's happening in view this season (call each frame; cheap unless the season or the view changed) */
  update(g: GameState, inView: (x: number, y: number) => boolean, viewKey: string, rect: { x0: number; y0: number; x1: number; y1: number }) {
    const civ = g.civ, W = this.m.width, year = g.world.year;
    const happen = civ?.happen ?? [];
    const keep = new Map(this.procs.map((p) => [p.key, p]));
    this.procs = [];
    for (const h of happen) {
      if (h.kind === "election") continue;
      const key = `${h.kind}:${h.a}:${h.b ?? -1}:${h.until}`;
      const ax = h.a % W, ay = (h.a / W) | 0;
      const bx = h.b !== undefined ? h.b % W : ax, by = h.b !== undefined ? (h.b / W) | 0 : ay;
      if (!inView(ax, ay) && !inView(bx, by) && !inView((ax + bx) >> 1, (ay + by) >> 1)) continue;
      const p = keep.get(key) ?? this.make(g, h, key, year);
      if (p) this.procs.push(p);
    }
    // crowds: election day at the borough buildings; Sunday at the churches, school mornings, market days
    if (viewKey !== this.crowdKey) {
      this.crowdKey = viewKey;
      this.crowds = [];
      for (const h of happen) if (h.kind === "election" && inView(h.a % W, (h.a / W) | 0)) this.crowds.push(this.crowdAt(g, h.a, h.n ?? 12, `el${h.a}`, 0, 1, year));
      this.dailyCrowds(g, inView, year, rect);
    }
    this.flames = [];
    for (const [i] of civ?.burning ?? []) { if (this.flames.length >= 80) break; const x = i % W, y = (i / W) | 0; if (inView(x, y)) this.flames.push([x, y]); }
  }

  /** the figures to draw now */
  figs(time: number): GFig[] {
    const out: GFig[] = [];
    for (const p of this.procs) {
      if (Number.isNaN(p.t0)) p.t0 = time - p.lag;
      const run = p.len + 6;
      const head = p.stay ? Math.min(p.len, (time - p.t0) * p.speed) : ((time - p.t0) * p.speed) % run;
      for (const [k, mb] of p.members.entries()) {
        const d = head - mb.back;
        if (d < 0 || d > p.len) continue;
        const [fx, fy, tx, ty] = this.along(p.path, d);
        const moving = !(p.stay && head >= p.len);
        out.push({ fx: fx - ty * mb.side, fy: fy + tx * mb.side, tx, ty, look: mb.look, spec: mb.spec, moving, placard: mb.placard, seed: k * 0.37 });
      }
      for (const c of p.crowd) out.push({ fx: c.fx, fy: c.fy, tx: 0, ty: 1, look: c.look, moving: false, seed: c.fx });
    }
    for (const c of this.crowds) {
      const ph = ((time / 45 + c.phase) % 1 + 1) % 1;
      if (ph > c.on) continue;
      for (const f of c.figs) out.push({ fx: f.fx, fy: f.fy, tx: 0, ty: 1, look: f.look, moving: false, seed: f.fx });
    }
    for (const [x, y] of this.flames) out.push({ fx: x + 0.5, fy: y + 0.5, tx: 0, ty: 0, moving: false, flame: true, seed: tileNoise(x, y, 3, 951) * 10 });
    return out;
  }

  // ---------------------------------------------------------------- building them

  private make(g: GameState, h: Happening, key: string, year: number): Procession | null {
    const W = this.m.width, r = new Rng(key);
    const t0 = NaN, lag = r.next() * 20;
    if (h.kind === "engine") {
      const path = this.route(g, h.a, h.b!);
      if (path.length < 2) return null;
      const motor = year >= 1915;
      const spec: VehicleSpec = motor ? { kind: "truck", era: motorEra(year), col: "#b0241c", col2: "#c9a24a" } : { kind: "wagon", era: 0, col: "#b0241c", col2: "#c9a24a", horse: "#3a2a1e", load: 0 };
      const members: Member[] = [{ spec, back: 0, side: 0 }];
      if (!motor) members.push({ spec: { kind: "wagon", era: 0, col: "#8a2018", col2: "#d8d0c0", horse: "#5a3a26", load: 0 }, back: 1.6, side: 0 });
      for (let k = 0; k < 4; k++) members.push({ look: FIREMEN, back: 3 + k * 0.4, side: (k & 1 ? 0.18 : -0.18) });
      return { key, path, len: path.length - 1, speed: motor ? 1.6 : 1.1, members, stay: true, t0, lag: 0, crowd: [] };
    }
    if (h.kind === "funeral") {
      const path = this.route(g, h.a, h.b!);
      if (path.length < 3) return null;
      const members: Member[] = [];
      const hearse: VehicleSpec = year >= 1925 ? { kind: "auto", era: motorEra(year), col: "#141418", col2: "#2a2a2e" } : { kind: "carriage", era: 0, col: "#141418", col2: "#2a2a2e", horse: "#141414" };
      members.push({ spec: hearse, back: 0, side: 0 });
      const n = Math.min(40, h.n ?? 16);
      for (let k = 0; k < n; k++) members.push({ look: MOURN[k % 3], back: 1.3 + Math.floor(k / 2) * 0.42, side: k & 1 ? 0.16 : -0.16 });
      return { key, path, len: path.length - 1, speed: 0.32, members, stay: false, t0, lag, crowd: [] };
    }
    // a parade or a feast-day procession: along the main street from the middle of town
    const path = this.walk(g, h.a, h.kind === "feast" ? 18 : 34);
    if (path.length < 6) return null;
    const members: Member[] = [];
    const n = Math.min(60, h.n ?? 30);
    let back = 0;
    if (h.kind === "parade") {
      for (let k = 0; k < 8; k++) members.push({ look: BAND, back: back + Math.floor(k / 2) * 0.4, side: k & 1 ? 0.18 : -0.18, placard: k === 0 ? 2 : undefined });
      back += 2;
      if (/Decoration|Memorial|victory|Welcome|Armistice|V-J/.test(h.name)) { for (let k = 0; k < 10; k++) members.push({ look: VETS, back: back + Math.floor(k / 2) * 0.4, side: k & 1 ? 0.18 : -0.18 }); back += 2.4; }
    }
    for (let k = 0; k < n; k++) members.push({ look: poolLook(year, () => r.next(), /Labor|workingmen/.test(h.name) || r.chance(0.3)), back: back + Math.floor(k / 3) * 0.38, side: (k % 3 - 1) * 0.2, placard: k % 7 === 3 ? k : undefined });
    // the town lines the street to watch
    const crowd: Procession["crowd"] = [];
    for (let k = 0; k < Math.min(40, path.length * 1.2); k++) {
      const [x, y] = path[Math.floor(r.next() * path.length)];
      const nb = this.beside(g, x, y);
      if (nb) crowd.push({ look: poolLook(year, () => r.next()), fx: nb[0] + 0.2 + r.next() * 0.6, fy: nb[1] + 0.2 + r.next() * 0.6 });
    }
    void W;
    return { key, path, len: path.length - 1, speed: 0.4, members, stay: false, t0, lag, crowd };
  }

  private crowdAt(g: GameState, at: number, n: number, key: string, phase: number, on: number, year: number): Crowd {
    const W = this.m.width, x = at % W, y = (at / W) | 0, r = new Rng(key);
    const spots: [number, number][] = [];
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) { const xx = x + dx, yy = y + dy; if (xx >= 0 && yy >= 0 && xx < W && yy < this.m.height) { const j = yy * W + xx; if (g.world.street[j] && g.world.street[j] !== Street.Steps) spots.push([xx, yy]); } }
    if (!spots.length) spots.push([x, y]);
    const figs = Array.from({ length: n }, () => { const [sx, sy] = spots[Math.floor(r.next() * spots.length)]; return { look: poolLook(year, () => r.next()), fx: sx + 0.15 + r.next() * 0.7, fy: sy + 0.15 + r.next() * 0.7 }; });
    return { key, figs, phase, on };
  }

  /** Sunday crowds at the churches, children at the schools, shoppers at the market houses: a few in view, now and then */
  private dailyCrowds(g: GameState, inView: (x: number, y: number) => boolean, year: number, rect: { x0: number; y0: number; x1: number; y1: number }) {
    const w = g.world, W = this.m.width;
    const found: [number, number][] = [];
    for (let y = rect.y0; y <= rect.y1 && found.length < 10; y += 2) for (let x = rect.x0 + (y & 2 ? 1 : 0); x <= rect.x1 && found.length < 10; x += 2) {
      const i = y * W + x, u = w.use[i];
      if (u !== Use.Civic && !(u === Use.Commerce && (w.sub[i] & 31) === ShopSub.Market)) continue;
      if (!inView(x, y)) continue;
      const s = w.sub[i];
      const kind = u === Use.Commerce ? 2 : s === CivicSub.School ? 1 : s <= 1 || (s >= 5 && s <= 7) ? 0 : -1;
      if (kind >= 0) found.push([i, kind]);
    }
    for (const [i, kind] of found) this.crowds.push(this.crowdAt(g, i, kind === 1 ? 9 : 7, `d${i}:${year}`, tileNoise(i, kind, 2, 952), kind === 0 ? 0.25 : 0.3, year));
  }

  /** streets between two lots (4-way, the steps avoided): a breadth-first search, capped */
  private route(g: GameState, a: number, b: number): [number, number][] {
    const m = this.m, w = g.world, W = m.width;
    const ok = (i: number) => w.street[i] !== 0 && w.street[i] !== Street.Steps;
    const snap = (i: number) => { const x = i % W, y = (i / W) | 0; let best = -1, bd = Infinity; for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) { const xx = x + dx, yy = y + dy; if (xx < 0 || yy < 0 || xx >= W || yy >= m.height) continue; const j = yy * W + xx; if (ok(j) && Math.abs(dx) + Math.abs(dy) < bd) { bd = Math.abs(dx) + Math.abs(dy); best = j; } } return best; };
    const s = snap(a), t = snap(b);
    if (s < 0 || t < 0) return [];
    const prev = new Map<number, number>([[s, -1]]);
    let q = [s], found = s === t;
    for (let step = 0; q.length && !found && step < 260; step++) {
      const next: number[] = [];
      for (const i of q) {
        const x = i % W, y = (i / W) | 0;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const xx = x + dx, yy = y + dy;
          if (xx < 0 || yy < 0 || xx >= W || yy >= m.height) continue;
          const j = yy * W + xx;
          if (prev.has(j) || !ok(j)) continue;
          prev.set(j, i); next.push(j);
          if (j === t) { found = true; break; }
        }
        if (found) break;
      }
      q = next;
    }
    if (!found) return [];
    const path: [number, number][] = [];
    for (let i = t; i >= 0; i = prev.get(i)!) path.push([(i % W) + 0.5, ((i / W) | 0) + 0.5]);
    return path.reverse();
  }

  /** a parade's route: straight along the street from the middle of town, turning only when it must */
  private walk(g: GameState, a: number, n: number): [number, number][] {
    const m = this.m, w = g.world, W = m.width;
    const ok = (x: number, y: number) => x >= 0 && y >= 0 && x < W && y < m.height && w.street[y * W + x] !== 0 && w.street[y * W + x] !== Street.Steps;
    let x = a % W, y = (a / W) | 0;
    // the nearest pike to the start
    let bd = Infinity, bx = -1, by = -1;
    for (let dy = -8; dy <= 8; dy++) for (let dx = -8; dx <= 8; dx++) { const xx = x + dx, yy = y + dy; if (!ok(xx, yy)) continue; const d = Math.abs(dx) + Math.abs(dy) - (w.street[yy * W + xx] === Street.Pike ? 3 : 0); if (d < bd) { bd = d; bx = xx; by = yy; } }
    if (bx < 0) return [];
    x = bx; y = by;
    const seen = new Set<number>([y * W + x]);
    const path: [number, number][] = [[x + 0.5, y + 0.5]];
    let dir = [[1, 0], [0, 1], [-1, 0], [0, -1]].find(([dx, dy]) => ok(x + dx, y + dy)) ?? [1, 0];
    for (let k = 0; k < n; k++) {
      const opts = [dir, [dir[1], -dir[0]], [-dir[1], dir[0]]].filter(([dx, dy]) => ok(x + dx, y + dy) && !seen.has((y + dy) * W + x + dx));
      if (!opts.length) break;
      dir = opts[0];
      x += dir[0]; y += dir[1]; seen.add(y * W + x); path.push([x + 0.5, y + 0.5]);
    }
    return path;
  }

  /** a lot beside a street tile for onlookers to stand on (another street tile, or open ground) */
  private beside(g: GameState, x: number, y: number): [number, number] | null {
    const w = g.world, W = this.m.width;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const xx = x + dx, yy = y + dy;
      if (xx < 0 || yy < 0 || xx >= W || yy >= this.m.height) continue;
      const u = w.use[yy * W + xx];
      if (u === Use.Empty || u === Use.Park || w.street[yy * W + xx]) return [xx, yy];
    }
    return null;
  }

  private along(path: [number, number][], d: number): [number, number, number, number] {
    const k = Math.min(path.length - 2, Math.floor(d)), t = d - k;
    const [x0, y0] = path[Math.max(0, k)], [x1, y1] = path[Math.min(path.length - 1, k + 1)];
    return [x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, x1 - x0, y1 - y0];
  }
}
