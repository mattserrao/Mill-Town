// Life on the map: people, wagons, streetcars, cars and trucks on the streets and bridges; trains on
// the open rail lines; steamboats and towboats on the rivers; plus smoke haze, river spills and slag
// pours from the works. A pool of agents lives around the camera; nothing is simulated off screen.

import { snapToRail } from "../core/lines";
import { blockGrid, blockOf } from "../core/blocks";
import type { GameState } from "../core/game";
import type { GameMap, Span } from "../core/map";
import { Rng } from "../core/rng";
import { Terrain } from "../core/terrain";
import { Street } from "../core/town";
import { type Camera, BASE_M, HH, HW, project, ZPX } from "./iso";
import { stageOf } from "./renderer";

type Kind = "walker" | "wagon" | "carriage" | "streetcar" | "auto" | "truck" | "train" | "steamboat" | "tow";

interface Agent {
  kind: Kind;
  x: number; y: number;        // current tile
  px: number; py: number;      // previous tile
  nx: number; ny: number;      // next tile
  t: number;                   // progress px→... (0..1 from current to next)
  speed: number;               // tiles per second
  col: string;
  trail?: [number, number, number][]; // positions for train cars / barges
  len?: number;
  hx?: number; hy?: number;    // heading for boats
}

const DIR4 = [[1, 0], [-1, 0], [0, 1], [0, -1]] as const;
const DIR8 = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]] as const;

export class Traffic {
  private agents: Agent[] = [];
  private shore: Uint8Array;           // water tiles: distance to land (capped)
  private down: Float32Array;          // water tiles: distance along the rivers from the Point
  private deck = new Map<number, number>(); // bridge tiles → deck height (m)
  private deckYear = -1;
  private rng = new Rng("traffic");
  private last = 0;

  constructor(private m: GameMap) {
    const n = m.width * m.height;
    this.shore = new Uint8Array(n);
    // distance from shore for water tiles (BFS from land)
    const q = new Int32Array(n); let h = 0, t = 0;
    const d = new Int16Array(n).fill(-1);
    for (let i = 0; i < n; i++) if (m.terrain[i] !== Terrain.Water) { d[i] = 0; q[t++] = i; }
    while (h < t) {
      const i = q[h++], x = i % m.width, y = (i / m.width) | 0;
      for (const [dx, dy] of DIR4) { const nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= m.width || ny >= m.height) continue; const j = ny * m.width + nx; if (d[j] < 0) { d[j] = d[i] + 1; q[t++] = j; } }
    }
    for (let i = 0; i < n; i++) this.shore[i] = Math.min(255, Math.max(0, d[i]));
    // distance along the water from the Point (for downstream direction)
    this.down = new Float32Array(n).fill(-1);
    const p = m.landmarks.find((l) => l.name.startsWith("The Point"));
    if (p) {
      let s = -1, bd = Infinity;
      for (let dy = -12; dy <= 12; dy++) for (let dx = -12; dx <= 12; dx++) { const j = (p.y + dy) * m.width + p.x + dx; if (m.terrain[j] === Terrain.Water && Math.hypot(dx, dy) < bd) { bd = Math.hypot(dx, dy); s = j; } }
      h = 0; t = 0;
      if (s >= 0) { this.down[s] = 0; q[t++] = s; }
      while (h < t) {
        const i = q[h++], x = i % m.width, y = (i / m.width) | 0;
        for (const [dx, dy] of DIR4) { const nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= m.width || ny >= m.height) continue; const j = ny * m.width + nx; if (this.down[j] < 0 && m.terrain[j] === Terrain.Water) { this.down[j] = this.down[i] + 1; q[t++] = j; } }
      }
    }
  }

  /** deck heights over water for the bridges standing this year */
  private updateDecks(year: number) {
    if (year === this.deckYear) return;
    this.deckYear = year;
    this.deck.clear();
    for (const sp of this.m.spans) {
      const st = stageOf(sp, year);
      if (!st) continue;
      const prof = spanProfile(this.m, sp, st.type, st.year);
      const len = Math.hypot(sp.b[0] - sp.a[0], sp.b[1] - sp.a[1]);
      for (let k = 0; k <= len * 4; k++) {
        const f = k / (len * 4);
        const x = Math.floor(sp.a[0] + (sp.b[0] - sp.a[0]) * f), y = Math.floor(sp.a[1] + (sp.b[1] - sp.a[1]) * f);
        const i = y * this.m.width + x;
        this.deck.set(i, Math.max(this.deck.get(i) ?? -Infinity, prof(f)));
      }
    }
    // diagonal spans rasterize as staircases: give neighbouring water tiles the deck height too,
    // so street agents on TIGER ramp tiles ride the deck rather than the river
    const extra: [number, number][] = [];
    for (const [i, h] of this.deck) {
      const x = i % this.m.width, y = (i / this.m.width) | 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const j = (y + dy) * this.m.width + x + dx;
        if (!this.deck.has(j) && this.m.terrain[j] === Terrain.Water) extra.push([j, h]);
      }
    }
    for (const [j, h] of extra) this.deck.set(j, Math.max(this.deck.get(j) ?? -Infinity, h));
  }

  /** a street tile an agent may use: never open water unless a standing deck covers it */
  private streetOk(w: GameState["world"], j: number): number {
    const s = w.street[j];
    if (!s) return 0;
    if (this.m.terrain[j] === Terrain.Water && !this.deck.has(j)) return 0;
    return s;
  }

  private height(i: number): number {
    const d = this.deck.get(i);
    if (d !== undefined) return d + 0.6;
    return this.m.terrain[i] === Terrain.Water ? this.m.waterLevel[i] : this.m.elevation[i];
  }

  /** visible tile range (approx.) */
  private view(cam: Camera, cw: number, ch: number) {
    const corners = [[0, 0], [cw, 0], [cw, ch], [0, ch]].map(([px, py]) => {
      const wx = cam.x + px / cam.zoom, wy = cam.y + py / cam.zoom + (260 - BASE_M) * ZPX;
      const a = wx / HW, b = wy / HH;
      return [(a + b) / 2, (b - a) / 2];
    });
    const m = this.m;
    return {
      x0: Math.max(0, Math.floor(Math.min(...corners.map((c) => c[0]))) - 6), x1: Math.min(m.width - 1, Math.ceil(Math.max(...corners.map((c) => c[0]))) + 12),
      y0: Math.max(0, Math.floor(Math.min(...corners.map((c) => c[1]))) - 6), y1: Math.min(m.height - 1, Math.ceil(Math.max(...corners.map((c) => c[1]))) + 12),
    };
  }

  private cam: Camera = { x: 0, y: 0, zoom: 1 };
  private cw = 1;
  private ch = 1;
  /** on screen (with a margin) */
  private inView(a: Agent, _v?: unknown) {
    const i = a.y * this.m.width + a.x;
    const [wx, wy] = project(a.x + 0.5, a.y + 0.5, this.m.elevation[i]);
    const sx = (wx - this.cam.x) * this.cam.zoom, sy = (wy - this.cam.y) * this.cam.zoom;
    return sx > -80 && sy > -80 && sx < this.cw + 80 && sy < this.ch + 80;
  }

  counts() {
    let trains = 0, boats = 0, traffic = 0;
    for (const a of this.agents) { if (a.kind === "train") trains++; else if (a.kind === "steamboat" || a.kind === "tow") boats++; else if (a.kind !== "walker") traffic++; }
    return { trains, boats, traffic };
  }

  // ------------------------------------------------------------ simulation
  update(g: GameState, cam: Camera, cw: number, ch: number, now: number) {
    const dt = Math.min(0.1, this.last ? (now - this.last) / 1000 : 0);
    this.last = now;
    const year = g.world.year;
    this.updateDecks(year);
    this.cam = cam; this.cw = cw; this.ch = ch;
    const v = this.view(cam, cw, ch);
    const z = cam.zoom;
    // zoomed out, only the big movers stay: trains and river craft (and the smoke, drawn elsewhere);
    // people, horses, wagons, streetcars and cars appear from 0.375× in, where they're legible
    const small = z >= SMALL_AGENT_ZOOM;
    this.agents = this.agents.filter((a) => this.inView(a, v) && (small || BIG.has(a.kind)));
    const tiles = (cw * ch) / (2048 * z * z); // tiles on screen
    const want = {
      street: small ? Math.min(420, tiles * 0.9) : 0,
      train: Math.min(z >= 0.25 ? 6 : 10, tiles / 1500 + 1),
      boat: Math.min(z >= 0.25 ? 14 : 22, tiles / 900 + 2),
    };
    let streetN = 0, trainN = 0, boatN = 0;
    for (const a of this.agents) { if (a.kind === "train") trainN++; else if (a.kind === "steamboat" || a.kind === "tow") boatN++; else streetN++; }
    for (let tries = 0; tries < 150 && streetN < want.street; tries++) if (this.spawnStreet(g, v)) streetN++;
    for (let tries = 0; tries < 40 && trainN < want.train; tries++) if (this.spawnTrain(g, v)) trainN++;
    for (let tries = 0; tries < 40 && boatN < want.boat; tries++) if (this.spawnBoat(g, v)) boatN++;
    for (const a of this.agents) this.step(g, a, dt);
    void year;
  }

  // ------------------------------------------------------------ what the simulation says is moving
  private freightBlock?: Float32Array;
  private freightTurn = -1;
  /** commuter traffic at a tile, 0..~1.5 (1 = the busiest 5% of the valley) */
  private busy(g: GameState, x: number, y: number): number {
    const bg = blockGrid(this.m);
    return Math.min(1.5, g.env.traffic[blockOf(bg, x, y)] / (g.env.trafficNorm || 1));
  }
  /** freight moving through a tile's block, 0..~1.5 (block max, so a route a tile wide still counts) */
  private cargo(g: GameState, x: number, y: number): number {
    const bg = blockGrid(this.m);
    if (this.freightTurn !== g.turn || !this.freightBlock) {
      const f = new Float32Array(bg.n), m = this.m;
      for (let i = 0; i < g.env.freight.length; i++) { const v = g.env.freight[i]; if (v > 0) { const b = blockOf(bg, i % m.width, (i / m.width) | 0); if (v > f[b]) f[b] = v; } }
      // spread a block either side so boats on the far side of a wide river still see the traffic
      const out = new Float32Array(bg.n);
      for (let by = 0; by < bg.bh; by++) for (let bx = 0; bx < bg.bw; bx++) {
        let mx = 0;
        for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) { const xx = bx + dx, yy = by + dy; if (xx >= 0 && yy >= 0 && xx < bg.bw && yy < bg.bh) mx = Math.max(mx, f[yy * bg.bw + xx]); }
        out[by * bg.bw + bx] = mx;
      }
      this.freightBlock = out; this.freightTurn = g.turn;
    }
    return Math.min(1.5, this.freightBlock[blockOf(bg, x, y)] / (g.env.freightNorm || 1));
  }

  /** a random tile under a random point of the screen */
  private randomTile(_v?: unknown): [number, number] {
    const m = this.m, c = this.cam;
    const wx = c.x + (this.rng.next() * this.cw) / c.zoom, wy = c.y + (this.rng.next() * this.ch) / c.zoom;
    let h = 260, x = 0, y = 0;
    for (let k = 0; k < 3; k++) {
      const a = wx / HW, b = (wy + (h - BASE_M) * ZPX) / HH;
      x = Math.floor((a + b) / 2); y = Math.floor((b - a) / 2);
      if (x < 0 || y < 0 || x >= m.width || y >= m.height) return [0, 0];
      h = m.elevation[y * m.width + x];
    }
    return [x, y];
  }

  private spawnStreet(g: GameState, v: ReturnType<Traffic["view"]>): boolean {
    const m = this.m, w = g.world, y = w.year;
    const [x, yy] = this.randomTile(v);
    const i = yy * m.width + x;
    if (!this.streetOk(w, i)) return false;
    // people and vehicles appear where the commute model sends them (a little everywhere, a lot on the busy routes)
    if (this.rng.next() > 0.12 + 0.88 * Math.min(1, this.busy(g, x, yy))) return false;
    const r = this.rng.next();
    const busy = w.street[i] === Street.Pike;
    let kind: Kind;
    if (w.street[i] === Street.Steps) kind = "walker";
    else if (busy && y >= 1890 && y < 1955 && r < 0.12) kind = "streetcar";
    else if (r < (y < 1915 ? 0.6 : y < 1940 ? 0.45 : 0.3)) kind = "walker";
    else if (y < 1910) kind = this.rng.chance(0.75) ? "wagon" : "carriage";
    else if (y < 1925) kind = this.rng.chance(0.5) ? "auto" : this.rng.chance(0.5) ? "wagon" : "truck";
    else kind = this.rng.chance(0.75) ? "auto" : "truck";
    const cols: Record<string, string[]> = {
      walker: ["#2a2a2e", "#3a3a4a", "#5a3a2a", "#e8e4dc", "#6a2a2a", "#2e3a5a", "#4a4a3a"],
      wagon: ["#e8e0c8", "#8a6a48"], carriage: ["#1e1e22", "#3a2a2a"],
      streetcar: [y < 1920 ? "#c8a040" : "#c8582a", "#2e5a3a"], auto: y < 1940 ? ["#1e1e22", "#2a2a30", "#3a2a2a"] : ["#c84a3a", "#3a6aa8", "#e8e0c8", "#4a8a5a", "#e8c040"],
      truck: ["#4a5a3a", "#5a4a3a", "#3a3a40"],
    };
    const speed = { walker: 0.45, wagon: 0.8, carriage: 1.1, streetcar: 1.4, auto: 2.4, truck: 1.8 }[kind as "walker"];
    const a: Agent = { kind, x, y: yy, px: x, py: yy, nx: x, ny: yy, t: 1, speed: speed * (0.8 + this.rng.next() * 0.4), col: this.rng.pick(cols[kind]) };
    this.agents.push(a);
    return true;
  }

  private spawnTrain(g: GameState, v: ReturnType<Traffic["view"]>): boolean {
    const m = this.m;
    const [x, y] = this.randomTile(v);
    const i = y * m.width + x;
    if (!this.railOpen(g, i)) return false;
    if (this.rng.next() > 0.25 + 0.75 * Math.min(1, this.cargo(g, x, y))) return false; // trains run where the freight goes
    const freight = this.rng.chance(0.7);
    this.agents.push({ kind: "train", x, y, px: x, py: y, nx: x, ny: y, t: 1, speed: freight ? 1.6 : 2.6, col: freight ? "#5a3a2a" : "#2e4a3a", trail: [], len: freight ? 10 + this.rng.int(0, 10) : 5 });
    return true;
  }

  private spawnBoat(g: GameState, v: ReturnType<Traffic["view"]>): boolean {
    const m = this.m;
    const [x, y] = this.randomTile(v);
    const i = y * m.width + x;
    if (m.terrain[i] !== Terrain.Water || this.shore[i] < 3 || this.down[i] < 0) return false;
    const year = g.world.year;
    const cargo = this.cargo(g, x, y);
    if (this.rng.next() > 0.2 + 0.8 * Math.min(1, cargo)) return false; // tows work the freight lanes
    const kind: Kind = year < 1870 || (year < 1930 && this.rng.chance(cargo > 0.3 ? 0.2 : 0.5)) ? "steamboat" : "tow";
    const ang = this.rng.next() * Math.PI * 2;
    this.agents.push({ kind, x, y, px: x, py: y, nx: x, ny: y, t: 1, speed: kind === "tow" ? 0.35 : 0.6, col: kind === "steamboat" ? "#ece7da" : year < 1940 ? "#3a3a3e" : "#c8402a", hx: Math.cos(ang), hy: Math.sin(ang), trail: [], len: kind === "tow" ? 3 + this.rng.int(0, 6) : 0 });
    return true;
  }

  private railOpen(g: GameState, i: number) {
    const m = this.m, r = m.rail[i];
    return r > 0 && (m.railLines[String(r)]?.year ?? 9999) <= g.world.year;
  }

  private step(g: GameState, a: Agent, dt: number) {
    a.t += a.speed * dt;
    while (a.t >= 1) {
      a.t -= 1;
      a.px = a.x; a.py = a.y; a.x = a.nx; a.y = a.ny;
      if (a.trail) { a.trail.unshift([a.x, a.y, 0]); if (a.trail.length > (a.len ?? 0) * 2 + 2) a.trail.pop(); }
      const nxt = this.choose(g, a);
      a.nx = nxt[0]; a.ny = nxt[1];
    }
  }

  private choose(g: GameState, a: Agent): [number, number] {
    const m = this.m, w = g.world;
    const opts: [number, number, number][] = [];
    const back = (x: number, y: number) => x === a.px && y === a.py;
    if (a.kind === "train") {
      for (const [dx, dy] of DIR8) {
        const x = a.x + dx, y = a.y + dy;
        if (x < 0 || y < 0 || x >= m.width || y >= m.height || back(x, y)) continue;
        if (!this.railOpen(g, y * m.width + x)) continue;
        const straight = (x - a.x) * (a.x - a.px) + (y - a.y) * (a.y - a.py);
        opts.push([x, y, 1 + straight * 2]);
      }
    } else if (a.kind === "steamboat" || a.kind === "tow") {
      for (const [dx, dy] of DIR8) {
        const x = a.x + dx, y = a.y + dy;
        if (x < 0 || y < 0 || x >= m.width || y >= m.height || back(x, y)) continue;
        const j = y * m.width + x;
        if (m.terrain[j] !== Terrain.Water || this.shore[j] < 2) continue;
        const l = Math.hypot(dx, dy);
        const dot = (dx / l) * (a.hx ?? 0) + (dy / l) * (a.hy ?? 0);
        opts.push([x, y, Math.max(0.01, 1 + dot * 3 + Math.min(4, this.shore[j]) * 0.4)]);
      }
      if (!opts.length) { a.hx = -(a.hx ?? 0); a.hy = -(a.hy ?? 0); return [a.px, a.py]; }
    } else {
      for (const [dx, dy] of DIR4) {
        const x = a.x + dx, y = a.y + dy;
        if (x < 0 || y < 0 || x >= m.width || y >= m.height) continue;
        const s = this.streetOk(w, y * m.width + x);
        if (!s || (s === Street.Steps && a.kind !== "walker")) continue;
        const busy = 0.35 + this.busy(g, x, y); // follow the commuters' routes
        opts.push([x, y, (back(x, y) ? 0.05 : (x - a.x === a.x - a.px && y - a.y === a.y - a.py ? 3 : 1)) * busy]);
      }
    }
    if (!opts.length) return [a.x, a.y];
    let sum = 0; for (const o of opts) sum += o[2];
    let r = this.rng.next() * sum;
    for (const o of opts) { r -= o[2]; if (r <= 0) {
      if (a.hx !== undefined) { const dx = o[0] - a.x, dy = o[1] - a.y, l = Math.hypot(dx, dy); a.hx = a.hx * 0.7 + (dx / l) * 0.3; a.hy = a.hy! * 0.7 + (dy / l) * 0.3; }
      return [o[0], o[1]];
    } }
    return [opts[0][0], opts[0][1]];
  }

  // ------------------------------------------------------------ drawing
  /** river craft: drawn under the bridges so decks pass over them */
  drawBoats(ctx: CanvasRenderingContext2D, cam: Camera, time: number) {
    const z = cam.zoom;
    const S = (fx: number, fy: number, h: number): [number, number] => { const [wx, wy] = project(fx, fy, h); return [(wx - cam.x) * z, (wy - cam.y) * z]; };
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    for (const a of this.agents) if (a.kind === "steamboat" || a.kind === "tow") this.drawBoat(ctx, a, S, z, time);
    ctx.restore();
  }

  draw(ctx: CanvasRenderingContext2D, cam: Camera, _g: GameState, time: number) {
    const z = cam.zoom;
    const S = (fx: number, fy: number, h: number): [number, number] => { const [wx, wy] = project(fx, fy, h); return [(wx - cam.x) * z, (wy - cam.y) * z]; };
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const pos = (a: Agent, back = 0): [number, number, number, number] => {
      // position along current → next segment, offset to the right-hand side of the street
      const fx = a.x + (a.nx - a.x) * a.t + 0.5, fy = a.y + (a.ny - a.y) * a.t + 0.5;
      const dx = a.nx - a.x, dy = a.ny - a.y;
      const side = a.kind === "walker" ? 0.32 : a.kind === "streetcar" ? 0 : 0.12;
      const l = Math.hypot(dx, dy) || 1;
      const ox = (-dy / l) * side, oy = (dx / l) * side;
      const i0 = a.y * this.m.width + a.x, i1 = a.ny * this.m.width + a.nx;
      const h = this.height(i0) * (1 - a.t) + this.height(i1) * a.t;
      void back;
      return [fx + ox, fy + oy, h, Math.atan2(...((): [number, number] => { const p0 = S(a.x, a.y, 0), p1 = S(a.nx, a.ny, 0); return [p1[1] - p0[1], p1[0] - p0[0]]; })())];
    };
    // trains first (they're longer, under the street traffic); boats are drawn before the bridges (drawBoats)
    for (const a of this.agents) if (a.kind === "train") this.drawTrain(ctx, a, S, z);
    for (const a of this.agents) {
      if (a.kind === "train" || a.kind === "steamboat" || a.kind === "tow") continue;
      const [fx, fy, h, ang] = pos(a);
      const [sx, sy] = S(fx, fy, h);
      if (a.kind === "walker") {
        const bob = Math.sin(time * 9 + a.x * 3) > 0 ? 1 : 0;
        const pw = Math.max(2, Math.round(2.5 * z)), ph = Math.max(3, Math.round(6 * z));
        ctx.fillStyle = "rgba(0,0,0,0.25)"; ctx.fillRect(Math.round(sx), Math.round(sy), pw + 1, Math.max(1, Math.round(z)));
        ctx.fillStyle = a.col; ctx.fillRect(Math.round(sx), Math.round(sy - ph - bob), pw, ph);
        ctx.fillStyle = "#e0b898"; ctx.fillRect(Math.round(sx), Math.round(sy - ph - pw - bob), pw, pw);
        ctx.fillStyle = "#2a2420"; ctx.fillRect(Math.round(sx), Math.round(sy - ph - pw - bob), pw, Math.max(1, Math.round(z)));
        continue;
      }
      ctx.save();
      ctx.translate(sx, sy);
      ctx.rotate(ang);
      const L = { wagon: 15, carriage: 12, streetcar: 24, auto: 12, truck: 16 }[a.kind as "wagon"] * z, W = (a.kind === "streetcar" ? 8 : 6.5) * z;
      if (a.kind === "wagon" || a.kind === "carriage") {
        ctx.fillStyle = "#5a3a22"; ctx.fillRect(L * 0.15, -W * 0.3, L * 0.45, W * 0.6); // horse
        ctx.fillStyle = a.col; ctx.fillRect(-L * 0.55, -W / 2, L * 0.65, W);
        if (a.kind === "wagon") { ctx.fillStyle = "#f0e8d0"; ctx.fillRect(-L * 0.5, -W / 2 - 2 * z, L * 0.55, 2 * z); }
      } else {
        ctx.fillStyle = "rgba(0,0,0,0.25)"; ctx.fillRect(-L / 2 + z, -W / 2 + z, L, W);
        ctx.fillStyle = a.col; ctx.fillRect(-L / 2, -W / 2 - 2 * z, L, W);
        ctx.fillStyle = "#cfe0e8"; ctx.fillRect(a.kind === "truck" ? L * 0.15 : -L * 0.15, -W / 2 - 2 * z, L * 0.25, W * 0.45);
        if (a.kind === "streetcar") { ctx.strokeStyle = "#2a2a2a"; ctx.lineWidth = Math.max(1, z * 0.6); ctx.beginPath(); ctx.moveTo(0, -W / 2 - 2 * z); ctx.lineTo(-L * 0.3, -W / 2 - 12 * z); ctx.stroke(); }
      }
      ctx.restore();
    }
    ctx.restore();
  }

  private drawTrain(ctx: CanvasRenderingContext2D, a: Agent, S: (x: number, y: number, h: number) => [number, number], z: number) {
    const pts: [number, number][] = [];
    const head: [number, number] = [a.x + (a.nx - a.x) * a.t, a.y + (a.ny - a.y) * a.t];
    pts.push(head);
    for (const [x, y] of a.trail ?? []) pts.push([x, y]);
    const cars = Math.min((a.len ?? 6), pts.length - 1);
    for (let k = cars; k >= 0; k--) {
      const [fx, fy] = pts[k];
      const i = Math.round(fy) * this.m.width + Math.round(fx);
      // ride the drawn (vector) track rather than the tile centres
      const [px, py] = (this.m.terrain[i] !== Terrain.Water && snapToRail(this.m, fx + 0.5, fy + 0.5, this.deckYear)) || [fx + 0.5, fy + 0.5];
      const [sx, sy] = S(px, py, this.height(i));
      const loco = k === 0;
      const col = loco ? "#1e1e22" : a.col;
      const w = Math.max(3, 9 * z), h = Math.max(2, 6 * z); // stays visible zoomed right out
      ctx.fillStyle = "rgba(0,0,0,0.3)"; ctx.fillRect(sx - w / 2 + z, sy - h + z, w, h);
      ctx.fillStyle = col; ctx.fillRect(sx - w / 2, sy - h - 2 * z, w, h);
      if (loco) { ctx.fillStyle = "#3a3a40"; ctx.fillRect(sx - 1.5 * z, sy - h - 6 * z, 3 * z, 4 * z); ctx.fillStyle = "rgba(200,200,200,0.5)"; ctx.beginPath(); ctx.arc(sx - 4 * z, sy - h - 9 * z, 4 * z, 0, Math.PI * 2); ctx.fill(); }
      else if (a.col === "#5a3a2a" && k % 3 === 0) { ctx.fillStyle = "#1a1a1c"; ctx.fillRect(sx - w / 2 + z, sy - h - 3 * z, w - 2 * z, 2 * z); } // coal hoppers
    }
  }

  private drawBoat(ctx: CanvasRenderingContext2D, a: Agent, S: (x: number, y: number, h: number) => [number, number], z: number, time: number) {
    const fx = a.x + (a.nx - a.x) * a.t + 0.5, fy = a.y + (a.ny - a.y) * a.t + 0.5;
    const i = a.y * this.m.width + a.x;
    const wl = this.m.waterLevel[i];
    const hx = a.hx ?? 1, hy = a.hy ?? 0, l = Math.hypot(hx, hy) || 1;
    const ux = hx / l, uy = hy / l, vx = -uy, vy = ux;
    const quad = (c0: number, c1: number, w: number, col: string, hgt = 0) => {
      const p = [S(fx + ux * c0 + vx * w, fy + uy * c0 + vy * w, wl + hgt), S(fx + ux * c1 + vx * w, fy + uy * c1 + vy * w, wl + hgt), S(fx + ux * c1 - vx * w, fy + uy * c1 - vy * w, wl + hgt), S(fx + ux * c0 - vx * w, fy + uy * c0 - vy * w, wl + hgt)];
      ctx.fillStyle = col; ctx.beginPath(); p.forEach(([x, y], k) => (k ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.closePath(); ctx.fill();
    };
    // wake
    const [wx, wy] = S(fx - ux * 1.2, fy - uy * 1.2, wl);
    ctx.fillStyle = "rgba(220,235,245,0.35)"; ctx.beginPath(); ctx.ellipse(wx, wy, 9 * z, 3 * z, 0, 0, Math.PI * 2); ctx.fill();
    if (a.kind === "tow") {
      // barges pushed ahead of the towboat
      const n = a.len ?? 3;
      for (let k = 0; k < n; k++) {
        const c0 = 0.35 + (k >> 1) * 0.95, side = k % 2 ? 0.2 : -0.2;
        const p0 = fx + vx * side, p1 = fy + vy * side;
        const quadB = (col: string, hgt: number, inset = 0) => {
          const p = [S(p0 + ux * (c0 + inset), p1 + uy * (c0 + inset), wl + hgt), S(p0 + ux * (c0 + 0.9 - inset), p1 + uy * (c0 + 0.9 - inset), wl + hgt)];
          const q = [S(p0 + ux * (c0 + 0.9 - inset) + vx * (0.19 - inset), p1 + uy * (c0 + 0.9 - inset) + vy * (0.19 - inset), wl + hgt), S(p0 + ux * (c0 + inset) + vx * (0.19 - inset), p1 + uy * (c0 + inset) + vy * (0.19 - inset), wl + hgt)];
          const r = [S(p0 + ux * (c0 + inset) - vx * (0.19 - inset), p1 + uy * (c0 + inset) - vy * (0.19 - inset), wl + hgt), S(p0 + ux * (c0 + 0.9 - inset) - vx * (0.19 - inset), p1 + uy * (c0 + 0.9 - inset) - vy * (0.19 - inset), wl + hgt)];
          ctx.fillStyle = col; ctx.beginPath(); ctx.moveTo(...r[0]); ctx.lineTo(...r[1]); ctx.lineTo(...q[0]); ctx.lineTo(...q[1]); ctx.closePath(); ctx.fill();
          void p;
        };
        quadB("#4a3a2a", 0.6); quadB("#1a1a1c", 1.4, 0.08);
      }
      quad(-0.45, 0.3, 0.17, a.col, 0.8);
      quad(-0.35, 0.05, 0.1, "#efe9da", 2.6);
      const [sx, sy] = S(fx - ux * 0.15, fy - uy * 0.15, wl + 4.5);
      ctx.fillStyle = "#1e1e22"; ctx.fillRect(sx - z, sy - 5 * z, 2 * z, 5 * z);
    } else {
      quad(-0.6, 0.6, 0.2, "#2c2a28", 0.6);
      quad(-0.5, 0.5, 0.17, a.col, 2.2);
      quad(-0.4, 0.3, 0.13, "#f4f0e6", 3.6);
      for (const c of [0.2, 0.32]) { const [sx, sy] = S(fx + ux * c, fy + uy * c, wl + 3.6); ctx.fillStyle = "#1c1a1a"; ctx.fillRect(sx - z, sy - 9 * z, 2 * z, 9 * z); ctx.fillStyle = `rgba(120,115,110,${0.4 + 0.2 * Math.sin(time * 3)})`; ctx.beginPath(); ctx.arc(sx + 4 * z, sy - 13 * z, 3.5 * z, 0, Math.PI * 2); ctx.fill(); }
      const [px, py] = S(fx - ux * 0.62, fy - uy * 0.62, wl + 1.2);
      ctx.fillStyle = (Math.floor(time * 6) & 1) ? "#8a2e24" : "#6a1e18"; ctx.fillRect(px - 3 * z, py - 4 * z, 6 * z, 5 * z); // turning paddlewheel
    }
  }

  // ------------------------------------------------------------ haze, spills, slag
  /** Smoky air: heavy in the coal era, thinner in the gas boom, clearing after smoke control. */
  drawHaze(ctx: CanvasRenderingContext2D, g: GameState, cam: Camera, cw: number, ch: number) {
    const y = g.world.year;
    let era = y < 1884 ? 0.16 : y < 1891 ? 0.07 : y < 1947 ? 0.2 : Math.max(0.02, 0.2 - (y - 1947) * 0.03);
    const v = this.view(cam, cw, ch);
    let s = 0, n = 0;
    for (let yy = v.y0; yy <= v.y1; yy += 6) for (let xx = v.x0; xx <= v.x1; xx += 6) { s += g.world.pollution[yy * this.m.width + xx]; n++; }
    era += Math.min(0.25, (s / Math.max(1, n)) * 0.15);
    if (era < 0.02) return;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const gr = ctx.createLinearGradient(0, 0, 0, ch);
    gr.addColorStop(0, `rgba(96,84,66,${(era * 1.2).toFixed(3)})`);
    gr.addColorStop(1, `rgba(80,70,58,${(era * 0.55).toFixed(3)})`);
    ctx.fillStyle = gr;
    ctx.fillRect(0, 0, cw, ch);
    ctx.restore();
  }

  /** Waste washing out of the works into the river, drifting downstream; slag poured over the bank. */
  drawSpills(ctx: CanvasRenderingContext2D, g: GameState, cam: Camera, time: number, night: number) {
    const m = this.m, z = cam.zoom;
    const S = (fx: number, fy: number, h: number): [number, number] => { const [wx, wy] = project(fx, fy, h); return [(wx - cam.x) * z, (wy - cam.y) * z]; };
    const plants: { x: number; y: number; fp: number; ind: string; running: boolean }[] = [];
    if (g.company) for (const w of [g.company, ...g.company.others]) plants.push({ x: w.x, y: w.y, fp: w.footprint, ind: w.industry, running: w.status === "running" });
    for (const r of g.rivals) if (!r.owned) plants.push({ x: r.x, y: r.y, fp: r.footprint, ind: r.id === "westinghouse" ? "power" : r.id === "ppg" ? "glass" : r.id === "dravo" || r.id === "mellon" ? "metalworks" : "steel", running: true });
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    for (const p of plants) {
      if (!p.running) continue;
      // outfall: nearest water tile to the plant centre
      const cx = p.x + p.fp / 2, cy = p.y + p.fp / 2;
      let out = -1, bd = Infinity;
      for (let dy = -p.fp; dy <= p.fp; dy++) for (let dx = -p.fp; dx <= p.fp; dx++) {
        const x = Math.round(cx + dx), y = Math.round(cy + dy);
        if (x < 0 || y < 0 || x >= m.width || y >= m.height) continue;
        const j = y * m.width + x;
        if (m.terrain[j] === Terrain.Water && this.down[j] >= 0 && Math.hypot(dx, dy) < bd) { bd = Math.hypot(dx, dy); out = j; }
      }
      if (out < 0) continue;
      const ohio = /Ohio/.test(m.waterNames[String(m.water[out])] ?? "");
      // follow downstream for ~25 tiles
      const path: number[] = [out];
      let cur = out;
      for (let k = 0; k < 28; k++) {
        const x = cur % m.width, y = (cur / m.width) | 0;
        let nb = -1, bv = ohio ? -Infinity : Infinity;
        for (const [dx, dy] of DIR8) {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= m.width || ny >= m.height) continue;
          const j = ny * m.width + nx;
          if (this.down[j] < 0) continue;
          const val = this.down[j] - this.shore[j] * 0.15 * (ohio ? -1 : 1);
          if (ohio ? val > bv : val < bv) { bv = val; nb = j; }
        }
        if (nb < 0) break;
        cur = nb; path.push(cur);
      }
      const col = p.ind === "steel" ? [176, 96, 40] : p.ind === "glass" ? [200, 205, 200] : p.ind === "power" ? [30, 30, 32] : [120, 90, 140];
      for (let k = 0; k < path.length; k++) {
        const ph = ((time * 0.6 + k * 0.37) % 1);
        const j = path[k], x = j % m.width, y = (j / m.width) | 0;
        const [sx, sy] = S(x + 0.5 + Math.sin(k + time) * 0.2, y + 0.5, m.waterLevel[j]);
        const a = (1 - k / path.length) * 0.35 * (0.7 + 0.3 * ph);
        ctx.fillStyle = `rgba(${col[0]},${col[1]},${col[2]},${a.toFixed(3)})`;
        ctx.beginPath(); ctx.ellipse(sx, sy, (10 + k * 1.2) * z, (4 + k * 0.5) * z, 0, 0, Math.PI * 2); ctx.fill();
        if (p.ind === "metalworks" && k % 3 === 0) { ctx.strokeStyle = `rgba(120,200,220,${(a * 0.8).toFixed(3)})`; ctx.lineWidth = Math.max(1, z); ctx.beginPath(); ctx.ellipse(sx, sy, 6 * z, 2 * z, 0, 0, Math.PI); ctx.stroke(); }
      }
      // slag: molten slag poured down the bank from a ladle car — glows, brightest at night
      if (p.ind === "steel") {
        const sj = path[0], sx0 = sj % m.width, sy0 = (sj / m.width) | 0;
        const [bx, by] = S(sx0 + 0.5, sy0 + 0.5, m.waterLevel[sj] + 1);
        const [tx, ty] = S(Math.round(cx) + 0.5, Math.round(cy) + 0.5, m.elevation[Math.round(cy) * m.width + Math.round(cx)] + 2);
        const pour = (Math.sin(time * 0.5 + p.x) + 1) / 2;
        if (pour > 0.35) {
          ctx.globalCompositeOperation = "lighter";
          const gr = ctx.createLinearGradient(tx, ty, bx, by);
          gr.addColorStop(0, `rgba(255,200,80,${(0.6 + night * 0.4).toFixed(2)})`);
          gr.addColorStop(1, `rgba(220,80,20,${(0.25 + night * 0.4).toFixed(2)})`);
          ctx.strokeStyle = gr; ctx.lineWidth = Math.max(2, 3 * z);
          ctx.beginPath(); ctx.moveTo(tx + (bx - tx) * 0.55, ty + (by - ty) * 0.55); ctx.lineTo(bx, by); ctx.stroke();
          const r = (18 + night * 30) * z;
          const glow = ctx.createRadialGradient(bx, by, 0, bx, by, r);
          glow.addColorStop(0, `rgba(255,140,40,${(0.25 + night * 0.45).toFixed(2)})`); glow.addColorStop(1, "rgba(255,80,20,0)");
          ctx.fillStyle = glow; ctx.fillRect(bx - r, by - r, r * 2, r * 2);
          ctx.globalCompositeOperation = "source-over";
        }
      }
    }
    ctx.restore();
  }
}

/** Deck height profile (m) along a span, f = 0..1 — shared with the bridge renderer. */
/** below this zoom, small street agents (people, horses, cars) are not shown */
export const SMALL_AGENT_ZOOM = 0.375;
const BIG = new Set<string>(["train", "steamboat", "tow"]);

export function spanProfile(m: GameMap, sp: Span, type: string, built: number) {
  const elevAt = (x: number, y: number) => m.elevation[Math.max(0, Math.min(m.height - 1, Math.floor(y))) * m.width + Math.max(0, Math.min(m.width - 1, Math.floor(x)))];
  const [ax, ay] = sp.a, [bx, by] = sp.b;
  const gA = elevAt(ax, ay), gB = elevAt(bx, by);
  const wl = m.waterLevel[Math.floor((ay + by) / 2) * m.width + Math.floor((ax + bx) / 2)] || Math.min(gA, gB) - 8;
  const clear = sp.kind === "rail" ? 17 : type === "covered" ? 9 : built >= 1920 ? 22 : 14;
  const lift = Math.max(0, wl + clear - Math.min(gA, gB));
  return (t: number) => gA + (gB - gA) * t + lift * Math.pow(Math.sin(Math.PI * t), 0.45);
}

