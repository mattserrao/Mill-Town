// Procedurally drawn pixel-art sprites (64 px tiles). Drawn once at startup into canvases;
// the renderer blits them into terrain chunks at each zoom level.
//
// Sprite coordinates: (u, v) is position on the tile (0..1, u = east, v = south), z is height in px.
// Orientation "a" = long axis along u (screen down-right), "b" = along v (screen down-left).
// Light comes from screen-left: faces toward +v (left faces) are lit, faces toward +u are darker.

import { tileNoise } from "../core/rng";

export interface Sprite {
  canvas: HTMLCanvasElement;
  ax: number; // anchor: tile-centre ground point within the canvas
  ay: number;
  soft?: boolean; // keep partial alpha (smoke)
}

export type Pt = [number, number];

export class Painter {
  readonly canvas: HTMLCanvasElement;
  readonly ctx: CanvasRenderingContext2D;
  readonly cx: number;
  readonly gy: number;
  constructor(readonly tiles = 1, height = 160) {
    this.canvas = document.createElement("canvas");
    this.canvas.width = 64 * tiles + 16;
    this.canvas.height = height;
    this.ctx = this.canvas.getContext("2d")!;
    this.cx = 32 * tiles + 8;
    this.gy = height - 40; // y of tile (u=0,v=0) corner relative to anchor tile
  }
  /** ground point; for multi-tile sprites u, v run from -(tiles-1) to 1 */
  P(u: number, v: number, z = 0): Pt {
    return [this.cx + (u - v) * 32, this.gy + (u + v) * 16 - z];
  }
  poly(pts: Pt[], fill: string) {
    const c = this.ctx;
    c.fillStyle = fill;
    c.beginPath();
    c.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) c.lineTo(pts[i][0], pts[i][1]);
    c.closePath();
    c.fill();
  }
  px(x: number, y: number, col: string, w = 1, h = 1) {
    this.ctx.fillStyle = col;
    this.ctx.fillRect(Math.round(x), Math.round(y), w, h);
  }
  line(a: Pt, b: Pt, col: string) {
    const n = Math.max(Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1]), 1);
    for (let i = 0; i <= n; i++) this.px(a[0] + ((b[0] - a[0]) * i) / n, a[1] + ((b[1] - a[1]) * i) / n, col);
  }
  sprite(soft = false): Sprite {
    if (!soft) crisp(this.canvas);
    const [ax, ay] = this.P(0.5, 0.5);
    return { canvas: this.canvas, ax: Math.round(ax), ay: Math.round(ay), soft };
  }
}

export function crisp(c: HTMLCanvasElement) {
  const ctx = c.getContext("2d")!;
  const d = ctx.getImageData(0, 0, c.width, c.height);
  for (let i = 3; i < d.data.length; i += 4) d.data[i] = d.data[i] >= 120 ? 255 : 0;
  ctx.putImageData(d, 0, 0);
}

export function shade(col: string, k: number): string {
  let r0: number, g0: number, b0: number;
  if (col.startsWith("rgb")) [r0, g0, b0] = col.slice(col.indexOf("(") + 1, -1).split(",").map(Number);
  else { const n = parseInt(col.slice(1), 16); r0 = (n >> 16) & 255; g0 = (n >> 8) & 255; b0 = n & 255; }
  const r = Math.min(255, Math.round(r0 * k)), g = Math.min(255, Math.round(g0 * k)), b = Math.min(255, Math.round(b0 * k));
  return `rgb(${r},${g},${b})`;
}

// ---------------------------------------------------------------- building blocks

export interface BoxOpts {
  wall: string;           // lit (left/+v) face colour
  wallR?: string;         // right face
  top?: string;           // flat roof colour
  z0?: number;            // base height
  foundation?: number;    // px of stone foundation below z0 (for slopes)
  left?: boolean;         // draw the +v face (default true)
  right?: boolean;        // draw the +u face (default true)
  fnd?: string;           // foundation colour
}

/** Axis-aligned box from (u0,v0) to (u1,v1), h px tall. Returns its corner points. */
export function box(p: Painter, u0: number, v0: number, u1: number, v1: number, h: number, o: BoxOpts) {
  const z0 = o.z0 ?? 0;
  const A = (z: number) => p.P(u0, v0, z), B = (z: number) => p.P(u1, v0, z);
  const C = (z: number) => p.P(u1, v1, z), D = (z: number) => p.P(u0, v1, z);
  const fz = z0 - (o.foundation ?? 0);
  const L = o.left !== false, R = o.right !== false;
  if (o.foundation) {
    const f = o.fnd ?? "#7d7468";
    if (L) p.poly([D(fz), C(fz), C(z0), D(z0)], f);
    if (R) p.poly([C(fz), B(fz), B(z0), C(z0)], shade(f, 0.76));
    // stone coursing on tall foundations
    for (let z = fz + 3; z < z0 - 1 && (o.foundation ?? 0) > 5; z += 3) {
      if (L) p.line(D(z), C(z), shade(f, 0.82));
      if (R) p.line(C(z), B(z), shade(f, 0.62));
    }
  }
  if (L) p.poly([D(z0), C(z0), C(z0 + h), D(z0 + h)], o.wall);
  if (R) p.poly([C(z0), B(z0), B(z0 + h), C(z0 + h)], o.wallR ?? shade(o.wall, 0.74));
  if (o.top) p.poly([A(z0 + h), B(z0 + h), C(z0 + h), D(z0 + h)], o.top);
  return { A, B, C, D, z0, h, u0, v0, u1, v1 };
}
export type Box = ReturnType<typeof box>;

/** Gable roof over a box; ridge runs along `axis`. */
export function gable(p: Painter, b: Box, axis: "u" | "v", rise: number, roof: string, gableCol?: string, ends = true) {
  const top = b.z0 + b.h;
  const roofR = shade(roof, 0.72);
  if (axis === "u") {
    const vm = (b.v0 + b.v1) / 2;
    const R0 = p.P(b.u0, vm, top + rise), R1 = p.P(b.u1, vm, top + rise);
    p.poly([b.A(top), b.B(top), R1, R0], roofR);
    p.poly([b.D(top), b.C(top), R1, R0], roof);
    if (ends) p.poly([b.C(top), b.B(top), R1], gableCol ?? shade(roof, 0.9));
    // shingle courses
    for (let k = 1; k < 4; k++) {
      const f = k / 4;
      p.line(lerp(b.D(top), R0, f), lerp(b.C(top), R1, f), shade(roof, 0.85));
    }
  } else {
    const um = (b.u0 + b.u1) / 2;
    const R0 = p.P(um, b.v0, top + rise), R1 = p.P(um, b.v1, top + rise);
    p.poly([b.A(top), b.D(top), R1, R0], roof);
    p.poly([b.B(top), b.C(top), R1, R0], roofR);
    if (ends) p.poly([b.D(top), b.C(top), R1], gableCol ?? shade(roof, 1.05));
    for (let k = 1; k < 4; k++) {
      const f = k / 4;
      p.line(lerp(b.B(top), R0, f), lerp(b.C(top), R1, f), shade(roof, 0.62));
    }
  }
}

export function lerp(a: Pt, b: Pt, t: number): Pt {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

/** Windows along the left (+v) face or right (+u) face of a box. */
export function windows(p: Painter, b: Box, face: "left" | "right", count: number, rows: number[], col = "#2b2a2e", lit = "#e7d9a8", door = false) {
  const a = face === "left" ? b.D(b.z0) : b.C(b.z0);
  const c = face === "left" ? b.C(b.z0) : b.B(b.z0);
  for (let k = 0; k < count; k++) {
    const t = (k + 0.5) / count;
    const [x, y] = lerp(a, c, t);
    for (const z of rows) {
      p.px(x, y - z - 3, col, 1, 3);
      p.px(x + 1, y - z - 3 + (face === "left" ? 0.5 : -0.5), shade(col === "#2b2a2e" ? "#3c3a40" : col, 1), 1, 3);
      p.px(x, y - z, lit, 2, 1); // sill
    }
    if (door && k === Math.floor(count / 2)) p.px(x, y - 5, "#4a3020", 2, 5);
  }
}

export function chimney(p: Painter, u: number, v: number, zBase: number, h: number, col = "#8a4a36") {
  box(p, u - 0.04, v - 0.04, u + 0.04, v + 0.04, h, { wall: col, z0: zBase, top: "#2a2420" });
}

export function cylinder(p: Painter, u: number, v: number, r: number, z0: number, h: number, col: string, topCol: string) {
  const [cx, cy] = p.P(u, v, z0);
  const rx = r * 45, ry = rx / 2;
  const c = p.ctx;
  // side as vertical bands, lit left
  for (let dx = -rx; dx <= rx; dx++) {
    const t = (dx + rx) / (2 * rx);
    const k = 1.1 - t * 0.45;
    const yy = ry * Math.sqrt(Math.max(0, 1 - (dx / rx) ** 2));
    c.fillStyle = shade(col, k);
    c.fillRect(Math.round(cx + dx), Math.round(cy - h - yy), 1, Math.round(h + 2 * yy));
  }
  c.fillStyle = topCol;
  c.beginPath();
  c.ellipse(cx, cy - h, rx, ry, 0, 0, Math.PI * 2);
  c.fill();
}

// ---------------------------------------------------------------- trees

export function tree(kind: "oak" | "maple" | "pine" | "bush" | "dead", v: number): Sprite {
  const p = new Painter(1, 96);
  const [x, y] = p.P(0.5, 0.5);
  const s = 0.8 + (v % 3) * 0.2;
  const rnd = (k: number) => tileNoise(4242 + v, k, 1, 3);
  if (kind === "pine") {
    const h = Math.round(26 * s), w = Math.round(11 * s);
    p.px(x, y - 4, "#4b3523", 2, 4);
    for (let k = 0; k < h; k++) {
      const layer = k % 6;
      const ww = Math.max(1, Math.round((k / h) * w * (0.7 + layer * 0.06)));
      const yy = y - 3 - h + k;
      p.px(x - ww / 2 + 1, yy, k % 6 < 2 ? "#2c5130" : "#24442a", ww, 1);
      p.px(x - ww / 2 + 1, yy, "#3f6e3c", Math.max(1, Math.round(ww / 3)), 1);
    }
  } else if (kind === "bush") {
    const r = 4 * s;
    blob(p, x, y - r, r + 1, r, ["#2f5527", "#3f6b31", "#567f3a"], rnd);
  } else if (kind === "dead") {
    p.px(x, y - 16, "#5a4632", 1, 16);
    p.px(x - 3, y - 13, "#5a4632", 3, 1);
    p.px(x + 1, y - 10, "#5a4632", 3, 1);
  } else {
    const h = Math.round((kind === "oak" ? 10 : 12) * s);
    const r = (kind === "oak" ? 9 : 7.5) * s;
    p.px(x, y - h, "#4b3523", 2, h);
    p.px(x - 1, y - 2, "#3c2a1c", 4, 2);
    const pal = kind === "oak" ? ["#2b4d24", "#3b6a2c", "#558536", "#71a043"] : ["#33552a", "#4a7a30", "#6a9a3a", "#8ab24a"];
    blob(p, x + 1, y - h - r * 0.7, r, r * 0.85, pal, rnd);
  }
  return p.sprite();
}

/** Lumpy foliage blob lit from the upper-left. */
export function blob(p: Painter, cx: number, cy: number, rx: number, ry: number, pal: string[], rnd: (k: number) => number) {
  const lumps: [number, number, number][] = [];
  for (let k = 0; k < 6; k++) lumps.push([cx + (rnd(k) - 0.5) * rx * 1.1, cy + (rnd(k + 9) - 0.5) * ry * 0.9, rx * (0.5 + rnd(k + 20) * 0.3)]);
  lumps.push([cx, cy, rx * 0.75]);
  for (let y = Math.floor(cy - ry - 3); y <= cy + ry + 3; y++) for (let x = Math.floor(cx - rx - 3); x <= cx + rx + 3; x++) {
    let inside = false, light = 0;
    for (const [lx, ly, lr] of lumps) {
      const d = Math.hypot(x - lx, (y - ly) * 1.15);
      if (d <= lr) { inside = true; light = Math.max(light, (lx - x + ly - y) / lr * 0.5 + 0.5 - d / lr * 0.25); }
    }
    if (!inside) continue;
    const n = tileNoise(77, x, y, 1) * 0.35;
    const t = Math.max(0, Math.min(0.999, light * 0.8 + n));
    p.px(x, y, pal[Math.floor(t * pal.length)]);
  }
}

// ---------------------------------------------------------------- houses

export function offset(p: Painter, s: Sprite, u: number, v: number): [number, number] {
  const [x, y] = p.P(u, v);
  return [Math.round(x - s.ax), Math.round(y - s.ay)];
}

function cabin(v: number): Sprite {
  const p = new Painter(1, 100);
  const u = 0.3 + (v % 2) * 0.1, vv = 0.3;
  const log = ["#7a5a3c", "#8a6a48", "#6e5236"][v % 3];
  const b = box(p, u, vv, u + 0.32, vv + 0.26, 10, { wall: log, foundation: 3 });
  // log courses
  for (let z = 2; z < 10; z += 2) p.line(b.D(z), b.C(z), shade(log, 0.8));
  gable(p, b, "u", 6, "#5a4a3a");
  windows(p, b, "left", 1, [3], "#2b2a2e", "#9c8a66", true);
  chimney(p, b.u1 - 0.03, (b.v0 + b.v1) / 2, 6, 12, "#8d867a");
  // garden fence + shed
  for (let t = 0; t <= 1; t += 0.12) p.px(...p.P(0.12 + t * 0.7, 0.85, 3), "#8a7656", 1, 3);
  box(p, 0.7, 0.2, 0.84, 0.32, 6, { wall: "#7d6448", top: "#4f4438" });
  return p.sprite();
}

function farmstead(v: number): Sprite {
  const p = new Painter(1, 110);
  // red bank barn + white farmhouse
  const barn = box(p, 0.08, 0.12, 0.5, 0.5, 15, { wall: "#9a3c2c", foundation: 5 });
  gable(p, barn, "u", 9, "#5c5752");
  p.px(...p.P(0.29, 0.5, 2), "#3a2a20", 3, 7);
  const h = box(p, 0.58, 0.5, 0.86, 0.82, 12, { wall: v % 2 ? "#ddd5c2" : "#d2c19a", foundation: 4 });
  gable(p, h, "v", 6, "#4e4a48");
  windows(p, h, "left", 2, [3, 8], "#2b2a2e", "#efe6c8", true);
  windows(p, h, "right", 2, [3, 8]);
  chimney(p, 0.72, 0.66, 12, 8);
  // haystack
  const [x, y] = p.P(0.75, 0.22);
  blob(p, x, y - 4, 5, 4, ["#a88c46", "#c4a95a", "#dcc277"], (k) => tileNoise(3, k, v, 1));
  return p.sprite();
}

// ---------------------------------------------------------------- 1850 landmarks

function blockhouse(): Sprite {
  const p = new Painter(1, 100);
  const b = box(p, 0.25, 0.25, 0.75, 0.75, 10, { wall: "#9a4f3a", foundation: 4 });
  const up = box(p, 0.22, 0.22, 0.78, 0.78, 7, { wall: "#6e5a44", z0: 10 });
  void up;
  const apex = p.P(0.5, 0.5, 26);
  p.poly([p.P(0.22, 0.78, 17), p.P(0.78, 0.78, 17), apex], "#5a5048");
  p.poly([p.P(0.78, 0.78, 17), p.P(0.78, 0.22, 17), apex], "#463e38");
  for (let k = 0; k < 3; k++) p.px(...lerp(b.D(5), b.C(5), 0.2 + k * 0.3), "#1e1c1c", 2, 1);
  return p.sprite();
}

function courthouse(): Sprite {
  const p = new Painter(2, 190);
  const st = "#c9c0a8";
  const b = box(p, -0.8, -0.7, 0.9, 0.85, 24, { wall: st, foundation: 6 });
  gable(p, b, "u", 8, "#5c6066");
  windows(p, b, "left", 7, [4, 14], "#2c2c34", "#e8e0c8");
  windows(p, b, "right", 6, [4, 14], "#2c2c34", "#e8e0c8");
  // portico columns
  const [x0, y0] = lerp(b.D(0), b.C(0), 0.35);
  for (let k = 0; k < 6; k++) p.px(x0 + k * 4, y0 - 20 + k * 2, "#ece6d4", 2, 20);
  p.poly([[x0 - 2, y0 - 21], [x0 + 24, y0 - 8], [x0 + 12, y0 - 32]], "#d8d0bc");
  // drum and dome
  cylinder(p, 0.05, 0.08, 0.28, 32, 14, "#d0c8b0", "#a8a090");
  for (let k = 0; k < 8; k++) {
    const r = 0.28 * Math.cos((k / 8) * Math.PI / 2);
    cylinder(p, 0.05, 0.08, r, 46 + k * 2.2, 2.2, "#7c8a8a", "#8e9c9a");
  }
  p.px(...p.P(0.05, 0.08, 66), "#c9b26a", 1, 6);
  return p.sprite();
}

function arsenal(): Sprite {
  const p = new Painter(3, 160);
  // walled yard with long stone storehouses
  const wall = "#a49a86";
  for (const [a, b2, c, d] of [[-1.9, -1.9, 0.95, -1.8], [-1.9, 0.85, 0.95, 0.95], [-1.9, -1.9, -1.8, 0.95], [0.85, -1.9, 0.95, 0.95]] as const)
    box(p, a, b2, c, d, 5, { wall, top: "#857c6a" });
  for (const vv of [-1.4, -0.3]) {
    const b = box(p, -1.5, vv, 0.5, vv + 0.5, 16, { wall: "#b7ad97", foundation: 3 });
    gable(p, b, "u", 7, "#55595e");
    windows(p, b, "left", 8, [4, 10], "#2c2c34", "#e2dac6");
  }
  const hq = box(p, 0.0, 0.25, 0.6, 0.75, 20, { wall: "#c0b59e" });
  gable(p, hq, "v", 8, "#4c5056");
  windows(p, hq, "left", 3, [4, 12], "#2c2c34", "#e2dac6", true);
  windows(p, hq, "right", 2, [4, 12]);
  p.px(...p.P(0.3, 0.5, 40), "#5a4a3a", 1, 14);
  p.px(...p.P(0.3, 0.5, 52), "#b03a2e", 5, 3);
  p.px(...p.P(0.3, 0.5, 49), "#2e3e8a", 5, 3);
  return p.sprite();
}

function penitentiary(): Sprite {
  const p = new Painter(3, 170);
  const st = "#8f8a7c";
  for (const [a, b2, c, d] of [[-1.9, -1.9, 0.95, -1.75], [-1.9, 0.8, 0.95, 0.95], [-1.9, -1.9, -1.75, 0.95], [0.8, -1.9, 0.95, 0.95]] as const)
    box(p, a, b2, c, d, 12, { wall: st, top: "#77736a" });
  cylinder(p, -0.5, -0.5, 0.7, 0, 30, "#9c9686", "#5d5a55");
  for (let k = 0; k < 16; k++) {
    const a = (k / 16) * Math.PI * 2;
    const [x, y] = p.P(-0.5 + Math.cos(a) * 0.62, -0.5 + Math.sin(a) * 0.62, 10);
    if (Math.sin(a) + Math.cos(a) > -0.3) p.px(x, y - 6, "#2a2a2e", 1, 3), p.px(x, y - 16, "#2a2a2e", 1, 3);
  }
  for (const [u, v] of [[-1.85, -1.85], [0.85, -1.85], [-1.85, 0.85], [0.85, 0.85]] as const) {
    const t = box(p, u - 0.08, v - 0.08, u + 0.12, v + 0.12, 22, { wall: "#9a9484" });
    p.poly([t.A(22), t.B(22), t.C(22), t.D(22)], "#6a665e");
  }
  return p.sprite();
}

// ---------------------------------------------------------------- river craft, bridges, wharf goods

function steamboat(o: "a" | "b", v: number): Sprite {
  const p = new Painter(2, 130);
  const L = 1.3, W = 0.34;
  const hb = (u0: number, v0: number, u1: number, v1: number, h: number, o2: BoxOpts) =>
    o === "a" ? box(p, u0 - 0.6, v0, u1 - 0.6, v1, h, o2) : box(p, v0, u0 - 0.6, v1, u1 - 0.6, h, o2);
  hb(0, 0.33, L, 0.33 + W, 4, { wall: "#2c2a28", top: "#8a7a62" });       // hull
  hb(0.1, 0.36, L - 0.15, 0.33 + W - 0.03, 7, { wall: "#ece7da", top: "#d6d0c2", z0: 4 }); // main deck
  hb(0.25, 0.39, L - 0.35, 0.33 + W - 0.06, 6, { wall: "#f4f0e6", top: "#c9c2b0", z0: 11 }); // texas
  hb(0.85, 0.44, 1.0, 0.56, 5, { wall: "#f4f0e6", top: "#a8a090", z0: 17 }); // pilot house
  // twin stacks
  for (const s of [0.42, 0.58]) {
    const [x, y] = o === "a" ? p.P(0.2, s, 17) : p.P(s, 0.2, 17);
    p.px(x, y - 22, "#1c1a1a", 2, 22);
    p.px(x - 1, y - 23, "#b8902e", 4, 1);
  }
  // stern wheel
  const [wx, wy] = o === "a" ? p.P(-0.62, 0.5, 2) : p.P(0.5, -0.62, 2);
  p.px(wx - 3, wy - 10, "#8a2e24", 6, 10);
  for (let k = 0; k < 4; k++) p.px(wx - 3, wy - 9 + k * 2.5, "#5a1e18", 6, 1);
  void v;
  return p.sprite();
}

/** Cargo carried by moored barges: coal, iron ore, or limestone/sand (generic). Index = sprite variant. */
export const BARGE_CARGO = ["coal", "ore", "stone"] as const;
const CARGO_PAL: Record<(typeof BARGE_CARGO)[number], string[]> = {
  // dark → light; the last entry is the glint on lit lumps
  coal: ["#121216", "#1e1f24", "#2c2e35", "#40434c", "#7c8494"],
  ore: ["#3e1c12", "#5a2a18", "#7a3a20", "#9a4e2a", "#c47444"],
  stone: ["#6a6458", "#847c6c", "#9e9480", "#b8ad96", "#dcd2bc"],
};

/**
 * A moored open-hopper barge: timber hull with a pale gunwale rim around a deck, the hold heaped with
 * cargo (a ridge along the barge, lit on its +v / screen-left flank, with glints on the lit lumps).
 */
function barge(o: "a" | "b", v: number): Sprite {
  const p = new Painter(1, 80);
  const cargo = BARGE_CARGO[v % BARGE_CARGO.length];
  const pal = CARGO_PAL[cargo];
  // work in (s along the barge, t across it); map to (u, v) by orientation
  const UV = (s: number, t: number, z = 0) => (o === "a" ? p.P(s, t, z) : p.P(t, s, z));
  const S0 = 0.02, S1 = 0.98, T0 = 0.31, T1 = 0.69, HULL = 4;
  if (o === "a") box(p, S0, T0, S1, T1, HULL, { wall: "#5c4630", wallR: "#3e2f22", top: "#6e5a42" });
  else box(p, T0, S0, T1, S1, HULL, { wall: "#5c4630", wallR: "#3e2f22", top: "#6e5a42" });
  const poly = (pts: [number, number][], z: number, col: string) => p.poly(pts.map(([s, t]) => UV(s, t, z)), col);
  // hold (recessed), inset from the gunwale
  const h0 = 0.09, h1 = 0.91, w0 = T0 + 0.055, w1 = T1 - 0.055;
  poly([[h0, w0], [h1, w0], [h1, w1], [h0, w1]], HULL, "#2e251c");
  // gunwale rim: a light timber line around the deck edge, brightest on the lit (+v) side
  const rim = (a: [number, number], b: [number, number], col: string) => p.line(UV(a[0], a[1], HULL), UV(b[0], b[1], HULL), col);
  const LIT = "#c8ad80", BACK = "#a48a64", DARK = "#8c7556";
  rim([S0, T0], [S1, T0], BACK);
  rim([S0, T0], [S0, T1], BACK);
  rim([S0, T1], [S1, T1], o === "a" ? LIT : DARK);
  rim([S1, T0], [S1, T1], o === "a" ? DARK : LIT);
  // rub-rail along the lit hull face
  if (o === "a") p.line(UV(S0, T1, 2), UV(S1, T1, 2), "#7a6046");
  else p.line(UV(S1, T0, 2), UV(S1, T1, 2), "#7a6046");
  // cargo heap: a ridge along s, sampled back-to-front, filled down to the hold floor
  const r = (k: number) => tileNoise(v, k, 5, 5);
  const N = 72, M = 18, peak = 6 + r(1) * 2;
  const tm = (w0 + w1) / 2, th = (w1 - w0) / 2 - 0.01;
  const cells: { s: number; t: number; z: number; lit: number; litSide: boolean }[] = [];
  for (let i = 0; i <= N; i++) for (let j = 0; j <= M; j++) {
    const s = h0 + 0.02 + ((h1 - h0 - 0.04) * i) / N, t = tm - th + (2 * th * j) / M;
    const across = Math.abs(t - tm) / th; // 0 on the ridge, 1 at the coaming
    const end = Math.min(1, Math.min(s - h0, h1 - s) / 0.14);
    const lump = Math.sin(s * 37 + r(2) * 6) * 0.6 + Math.sin(s * 71 + r(3) * 6) * 0.4;
    const z = HULL + Math.max(0, (1 - across * across) * end) * (peak + lump);
    // slope toward +t (and toward -s ends) faces the light
    const litSide = o === "a" ? t > tm : t < tm; // +v faces the light (t is v for "a", u for "b")
    const lit = (litSide ? 0.62 : 0.28) + (s < 0.5 ? 0.06 : -0.06) * (1 - end) + (1 - across) * 0.12;
    cells.push({ s, t, z, lit, litSide });
  }
  cells.sort((a, b) => a.s + a.t - (b.s + b.t)); // u + v: back to front
  for (const c of cells) {
    if (c.z <= HULL + 0.4) continue;
    const [x, y] = UV(c.s, c.t, c.z), [, y0] = UV(c.s, c.t, HULL);
    const n = tileNoise(91 + v, Math.round(x), Math.round(y), 1);
    const k = Math.max(0, Math.min(pal.length - 2, Math.floor((c.lit + (n - 0.5) * 0.35) * (pal.length - 1))));
    p.px(x, y, pal[k], 1, Math.max(1, Math.round(y0 - y)));
    // glints: occasional bright pixels on the lit flank
    if (c.litSide && n > 0.93) p.px(x, y, pal[pal.length - 1]);
  }
  return p.sprite();
}

function bridgeDeck(kind: "road" | "rail", o: "a" | "b", deck: number): Sprite {
  const p = new Painter(1, 140);
  const z = deck;
  const along = (t: number, side: number, zz: number) => (o === "a" ? p.P(t, side, zz) : p.P(side, t, zz));
  // pier in the middle of the tile
  const pier = o === "a" ? box(p, 0.42, 0.3, 0.58, 0.7, z - 2, { wall: "#8a8272" }) : box(p, 0.3, 0.42, 0.7, 0.58, z - 2, { wall: "#8a8272" });
  void pier;
  // deck slab
  const d = o === "a" ? box(p, -0.02, 0.33, 1.02, 0.67, 3, { wall: "#5a4c3c", top: kind === "road" ? "#8a7a62" : "#4a4440", z0: z }) : box(p, 0.33, -0.02, 0.67, 1.02, 3, { wall: "#5a4c3c", top: kind === "road" ? "#8a7a62" : "#4a4440", z0: z });
  void d;
  if (kind === "road") {
    // suspension cables / timber railing
    for (const side of [0.33, 0.67]) {
      p.line(along(0, side, z + 14), along(0.5, side, z + 6), "#2a2a2e");
      p.line(along(0.5, side, z + 6), along(1, side, z + 14), "#2a2a2e");
      for (let t = 0; t <= 1; t += 0.125) p.line(along(t, side, z + 3), along(t, side, z + 4 + Math.abs(t - 0.5) * 16), "#4a4a50");
    }
  } else {
    // through truss
    for (const side of [0.34, 0.66]) {
      p.line(along(0, side, z + 16), along(1, side, z + 16), "#3a3c44");
      for (let t = 0; t <= 1; t += 0.25) {
        p.line(along(t, side, z + 3), along(t, side, z + 16), "#3a3c44");
        p.line(along(t, side, z + 3), along(Math.min(1, t + 0.25), side, z + 16), "#50525a");
      }
    }
  }
  return p.sprite();
}

function wharfGoods(v: number): Sprite {
  const p = new Painter(1, 80);
  const r = (k: number) => tileNoise(v, k, 31, 1);
  for (let k = 0; k < 4; k++) {
    const u = 0.15 + r(k) * 0.6, vv = 0.15 + r(k + 5) * 0.6;
    if (r(k + 10) < 0.5) box(p, u, vv, u + 0.1, vv + 0.1, 5, { wall: "#9a7a4a", top: "#b8965e" });
    else cylinder(p, u, vv, 0.05, 0, 6, "#7a5a3a", "#5a4028");
  }
  return p.sprite();
}

function smoke(v: number): Sprite {
  const p = new Painter(2, 140);
  const c = p.ctx;
  for (let k = 0; k < 9; k++) {
    const t = k / 8;
    const [x, y] = p.P(0.5, 0.5, 96 + t * 30);
    const r = 4 + t * 10;
    c.fillStyle = `rgba(${70 + t * 60},${68 + t * 60},${66 + t * 60},${0.75 - t * 0.55})`;
    c.beginPath();
    c.ellipse(x + t * 34 + tileNoise(v, k, 1, 1) * 4, y + t * 10, r * 1.3, r, 0, 0, Math.PI * 2);
    c.fill();
  }
  return p.sprite(true);
}

// ---------------------------------------------------------------- mines, inclines, street furniture

function mine(v: number): Sprite {
  const p = new Painter(1, 120);
  // drift portal in the hillside
  const [x, y] = p.P(0.3, 0.3, 2);
  p.px(x - 4, y - 7, "#5a4028", 9, 8); p.px(x - 3, y - 6, "#0e0c0c", 7, 6);
  // wooden tipple with a chute over a coal pile and a track out of the portal
  const legs: [number, number][] = [[0.5, 0.45], [0.8, 0.45], [0.5, 0.75], [0.8, 0.75]];
  for (const [u, vv] of legs) p.line(p.P(u, vv), p.P(u, vv, 26), "#6a4a2a");
  const t = box(p, 0.46, 0.42, 0.84, 0.78, 10, { wall: "#7a5a36", z0: 24 });
  gable(p, t, "u", 5, "#4a3a2a");
  p.line(p.P(0.84, 0.6, 22), p.P(1.0, 0.85, 4), "#3a2a1a");
  const [cx, cy] = p.P(0.9, 0.85);
  blob(p, cx, cy - 3, 8, 4, ["#141416", "#232327", "#36363c"], (k) => tileNoise(v, k, 4, 4));
  p.line(p.P(0.3, 0.3, 1), p.P(0.6, 0.6, 1), "#4a3626");
  p.px(...p.P(0.42, 0.42, 3), "#2a2a2e", 3, 2); // mine car
  return p.sprite();
}

function inclineStation(): Sprite {
  const p = new Painter(1, 110);
  const b = box(p, 0.15, 0.15, 0.85, 0.85, 16, { wall: "#8a6a4a", foundation: 4 });
  gable(p, b, "u", 7, "#4a3a32");
  windows(p, b, "left", 3, [4], "#2b2a2e", "#e7d9a8", true);
  windows(p, b, "right", 2, [4]);
  return p.sprite();
}

function inclineCar(): Sprite {
  const p = new Painter(1, 80);
  // stepped car body on the slope
  const b = box(p, 0.3, 0.3, 0.7, 0.7, 10, { wall: "#b03a2e", top: "#6a2a24", z0: 2 });
  windows(p, b, "left", 3, [3], "#e8e0c0", "#3a2a24");
  windows(p, b, "right", 2, [3], "#e8e0c0", "#3a2a24");
  return p.sprite();
}

function bandstand(): Sprite {
  const p = new Painter(1, 90);
  cylinder(p, 0.5, 0.5, 0.3, 0, 3, "#d8d0bc", "#c8c0a8");
  for (let k = 0; k < 8; k++) { const a = (k / 8) * Math.PI * 2; if (Math.sin(a) + Math.cos(a) > -0.6) { const [x, y] = p.P(0.5 + Math.cos(a) * 0.26, 0.5 + Math.sin(a) * 0.26, 3); p.px(x, y - 12, "#efe9da", 1, 12); } }
  const top = p.P(0.5, 0.5, 26);
  for (let k = 0; k < 12; k++) { const r = 0.32 * (1 - k / 12); cylinder(p, 0.5, 0.5, r, 15 + k, 1, k % 2 ? "#3e6a4a" : "#4e7a5a", "#5a8a6a"); }
  p.px(top[0], top[1] - 3, "#c9b26a", 1, 3);
  return p.sprite();
}

function lamp(kind: "gas" | "elec"): Sprite {
  const p = new Painter(1, 70);
  const [x, y] = p.P(0.12, 0.12);
  if (kind === "gas") { p.px(x, y - 12, "#1e1e22", 1, 12); p.px(x - 1, y - 15, "#e8d080", 3, 3); p.px(x - 1, y - 16, "#1e1e22", 3, 1); }
  else { p.px(x, y - 18, "#3a3a3e", 1, 18); p.px(x, y - 18, "#3a3a3e", 4, 1); p.px(x + 3, y - 17, "#f0f0d0", 2, 1); }
  return p.sprite();
}

// ---------------------------------------------------------------- dated landmarks (src/core/landmarks.ts)
// Each is drawn at the footprint's bottom tile: for an n-tile kind, u and v run from -(n-1) to 1.

const STONE = "#d2c6a6", BRICK2 = "#8a4636", COPPER = "#6f9a88";
const WIN = "#2c2c34", SILL = "#e8e0c8", GRASS = ["#5e8a36", "#6f9a3e", "#7aa646", "#86b04e"];

/** a door (or any upright rect) standing on ground point g */
function door(p: Painter, g: Pt, col: string, w: number, h: number) { p.px(g[0] - w / 2 + 0.5, g[1] - h, col, w, h); }
function rows(z0: number, step: number, n: number): number[] { return Array.from({ length: n }, (_, k) => z0 + k * step); }
function flatQuad(p: Painter, u0: number, v0: number, u1: number, v1: number, z: number, col: string) {
  p.poly([p.P(u0, v0, z), p.P(u1, v0, z), p.P(u1, v1, z), p.P(u0, v1, z)], col);
}
function lawn(p: Painter, u0: number, v0: number, u1: number, v1: number, seed = 1) {
  flatQuad(p, u0, v0, u1, v1, 0, GRASS[1]);
  const [x0, y0] = p.P(u0, v0), [x1, y1] = p.P(u1, v1), [x2] = p.P(u1, v0), [x3] = p.P(u0, v1);
  void x0; void x1;
  for (let y = Math.floor(y0); y < y1; y++) for (let x = Math.floor(x3); x < x2; x++) {
    const n = tileNoise(seed, x, y, 2);
    if (n < 0.12 || n > 0.88) {
      // only inside the quad: invert the projection
      const a = (x - p.cx) / 32, b = (y - p.gy) / 16;
      const u = (a + b) / 2, v = (b - a) / 2;
      if (u > u0 && u < u1 && v > v0 && v < v1) p.px(x, y, n < 0.12 ? GRASS[0] : GRASS[3]);
    }
  }
}
/** filled iso ellipse (circle of radius r in tile units) at height z */
function ell(p: Painter, u: number, v: number, r: number, z: number, col: string, rv = r) {
  const pts: Pt[] = [];
  for (let k = 0; k < 32; k++) { const a = (k / 32) * Math.PI * 2; pts.push(p.P(u + Math.cos(a) * r, v + Math.sin(a) * rv, z)); }
  p.poly(pts, col);
}
function dome(p: Painter, u: number, v: number, r: number, z: number, col: string, steps = 9, hk = 0.8) {
  const R = r * 45 * hk;
  for (let k = 0; k < steps; k++) {
    const a0 = (k / steps) * Math.PI / 2, a1 = ((k + 1) / steps) * Math.PI / 2;
    const z0 = z + R * Math.sin(a0), z1 = z + R * Math.sin(a1);
    const c = shade(col, 0.9 + k * 0.03);
    cylinder(p, u, v, r * Math.cos(a0), z0, Math.max(1, z1 - z0 + 0.5), c, shade(c, 1.1));
  }
  return z + R;
}
/** meridian seams over a dome of radius r whose base is at z and height hh */
function seams(p: Painter, u: number, v: number, r: number, z: number, hh: number, n: number, col: string) {
  const [cx, cy] = p.P(u, v, z), rx = r * 45, ry = rx / 2;
  for (let k = 0; k < n; k++) {
    const a = (k / n) * Math.PI * 2;
    if (Math.sin(a) < -0.15) continue;
    let prev: Pt | null = null;
    for (let s = 0; s <= 10; s++) {
      const ph = (s / 10) * Math.PI / 2, rr = Math.cos(ph);
      const pt: Pt = [cx + Math.cos(a) * rx * rr, cy + Math.sin(a) * ry * rr - hh * Math.sin(ph)];
      if (prev) p.line(prev, pt, col);
      prev = pt;
    }
  }
}
function treeAt(p: Painter, u: number, v: number, s = 1, seed = 0, pine = false) {
  const [x, y] = p.P(u, v);
  if (pine) {
    const h = Math.round(16 * s);
    for (let k = 0; k < h; k++) { const ww = Math.max(1, Math.round((k / h) * 7 * s)); p.px(x - ww / 2 + 1, y - 2 - h + k, k % 4 < 2 ? "#2c5130" : "#24442a", ww, 1); }
    return;
  }
  const h = Math.round(6 * s), r = 5 * s;
  p.px(x, y - h, "#4b3523", 1, h);
  blob(p, x + 0.5, y - h - r * 0.6, r, r * 0.85, ["#2b4d24", "#3b6a2c", "#558536", "#71a043"], (k) => tileNoise(900 + seed, k, 3, 1));
}
/** vertical columns standing in front of a box face */
function columns(p: Painter, b: Box, face: "left" | "right", t0: number, t1: number, n: number, h: number, col = "#ece6d4", z0 = b.z0) {
  const a = face === "left" ? b.D(z0) : b.C(z0), c = face === "left" ? b.C(z0) : b.B(z0);
  const out: Pt[] = [];
  for (let k = 0; k < n; k++) {
    const [x, y] = lerp(a, c, t0 + ((t1 - t0) * k) / Math.max(1, n - 1));
    p.px(x + (face === "left" ? -1 : 1), y - h + 1, shade(col, 0.6), 2, h);
    p.px(x, y - h, col, 1, h);
    out.push([x, y]);
  }
  return out;
}
/** pediment (triangle) over a stretch of the left or right face */
function pediment(p: Painter, b: Box, face: "left" | "right", t0: number, t1: number, z: number, rise: number, col: string) {
  const a = face === "left" ? b.D(z) : b.C(z), c = face === "left" ? b.C(z) : b.B(z);
  const L = lerp(a, c, t0), R = lerp(a, c, t1), M = lerp(L, R, 0.5);
  p.poly([[L[0] - 1, L[1] + 1], [R[0] + 1, R[1] + 1], [M[0], M[1] - rise]], col);
  p.line([L[0] - 1, L[1] + 1], [R[0] + 1, R[1] + 1], shade(col, 0.7));
}
/** low hip roof */
function hip(p: Painter, b: Box, rise: number, roof: string) {
  const top = b.z0 + b.h, du = (b.u1 - b.u0), dv = (b.v1 - b.v0), inset = Math.min(du, dv) / 2;
  const um0 = b.u0 + inset, um1 = b.u1 - inset, vm0 = b.v0 + inset, vm1 = b.v1 - inset;
  const r = (u: number, v: number) => p.P(u, v, top + rise);
  const R0 = du >= dv ? r(um0, (b.v0 + b.v1) / 2) : r((b.u0 + b.u1) / 2, vm0);
  const R1 = du >= dv ? r(um1, (b.v0 + b.v1) / 2) : r((b.u0 + b.u1) / 2, vm1);
  p.poly([b.A(top), b.B(top), R1, R0], shade(roof, 0.85));
  p.poly([b.A(top), b.D(top), du >= dv ? R0 : R1, R0], shade(roof, 0.95));
  p.poly([b.D(top), b.C(top), R1, R0], roof);
  p.poly([b.C(top), b.B(top), R1], shade(roof, 0.72));
}
/** a cornice line around the visible top edge */
function cornice(p: Painter, b: Box, col: string) {
  const t = b.z0 + b.h;
  p.line(b.D(t), b.C(t), col); p.line(b.C(t), b.B(t), shade(col, 0.8));
  p.line(b.D(t - 1), b.C(t - 1), shade(col, 0.85)); p.line(b.C(t - 1), b.B(t - 1), shade(col, 0.68));
}
/** vertical ribs on a face (piers, Gothic mullions, glass mullions) */
function ribs(p: Painter, b: Box, face: "left" | "right", n: number, col: string, z0 = b.z0, z1 = b.z0 + b.h) {
  const a = face === "left" ? b.D(0) : b.C(0), c = face === "left" ? b.C(0) : b.B(0);
  for (let k = 1; k < n; k++) { const [x, y] = lerp(a, c, k / n); p.px(x, y - z1, col, 1, z1 - z0); }
}
function hlines(p: Painter, b: Box, step: number, col: string, colR = col) {
  for (let z = b.z0 + step; z < b.z0 + b.h; z += step) { p.line(b.D(z), b.C(z), col); p.line(b.C(z), b.B(z), colR); }
}
function flag(p: Painter, u: number, v: number, z: number, col = "#b03a2e") {
  const [x, y] = p.P(u, v, z);
  p.px(x, y - 12, "#3a3a3e", 1, 12); p.px(x + 1, y - 12, col, 5, 3);
}
function stack(p: Painter, u: number, v: number, z0: number, h: number, col = BRICK2, r = 0.06) {
  cylinder(p, u, v, r, z0, h, col, "#1a1818");
  const [x, y] = p.P(u, v, z0 + h);
  p.px(x - r * 45, y - 1, shade(col, 0.6), r * 90 + 1, 2);
}
function lancets(p: Painter, b: Box, face: "left" | "right", n: number, z: number, h: number, col = "#3a3448") {
  const a = face === "left" ? b.D(b.z0) : b.C(b.z0), c = face === "left" ? b.C(b.z0) : b.B(b.z0);
  for (let k = 0; k < n; k++) { const [x, y] = lerp(a, c, (k + 0.5) / n); p.px(x, y - z - h, col, 2, h); p.px(x, y - z - h - 1, shade(col, 1.4), 1, 1); }
}
function crenels(p: Painter, b: Box, col: string) {
  const t = b.z0 + b.h;
  for (let k = 0; k <= 6; k++) {
    if (k % 2) continue;
    const L = lerp(b.D(t), b.C(t), k / 6), R = lerp(b.C(t), b.B(t), k / 6);
    p.px(L[0], L[1] - 2, col, 2, 2); p.px(R[0], R[1] - 2, shade(col, 0.75), 2, 2);
  }
}
function cars(p: Painter, u0: number, v0: number, u1: number, v1: number, seed: number, n = 8) {
  const C = ["#7a2a24", "#2a3a5a", "#d8d4c8", "#3a3a3e", "#6a6a2a", "#3a5a4a"];
  for (let k = 0; k < n; k++) {
    const u = u0 + tileNoise(seed, k, 1, 1) * (u1 - u0), v = v0 + tileNoise(seed, k, 2, 1) * (v1 - v0);
    const [x, y] = p.P(u, v);
    p.px(x, y - 2, C[k % C.length], 3, 2); p.px(x + 1, y - 3, shade(C[k % C.length], 1.3), 1, 1);
  }
}

function hospital(): Sprite {
  const p = new Painter(2, 200);
  lawn(p, -1, 0.55, 1, 1, 3);
  const main = box(p, -0.85, -0.6, 0.25, 0.3, 40, { wall: "#b06a50", foundation: 4, top: "#6a5e54" });
  windows(p, main, "left", 6, rows(4, 7, 5), WIN, SILL);
  hlines(p, main, 40, "#d8cbb0");
  cornice(p, main, "#d8cbb0");
  const wing = box(p, 0.25, -0.85, 0.9, 0.5, 34, { wall: "#b06a50", foundation: 4, top: "#6a5e54" });
  windows(p, wing, "left", 4, rows(4, 7, 4), WIN, SILL);
  windows(p, wing, "right", 7, rows(4, 7, 4), WIN, SILL);
  cornice(p, wing, "#d8cbb0");
  // stone entrance pavilion with pediment
  const ent = box(p, -0.45, 0.3, -0.05, 0.42, 16, { wall: "#d8cbb0" });
  pediment(p, ent, "left", 0, 1, 16, 5, "#e8e0cc");
  door(p, p.P(-0.25, 0.42, 0), "#4a3020", 3, 6);
  // roof penthouse, water tank and red-cross flag
  box(p, -0.5, -0.4, -0.2, -0.1, 6, { wall: "#9a5a44", z0: 40, top: "#5a5048" });
  cylinder(p, 0.55, -0.4, 0.08, 34, 7, "#6a5040", "#4a3a30");
  const [fx, fy] = p.P(0.05, 0, 40);
  p.px(fx, fy - 14, "#3a3a3e", 1, 14); p.px(fx + 1, fy - 14, "#f4f0e6", 7, 5);
  p.px(fx + 4, fy - 14, "#c0302a", 1, 5); p.px(fx + 2, fy - 12, "#c0302a", 5, 1);
  for (const [u, v] of [[-0.85, 0.75], [0.6, 0.8]] as const) treeAt(p, u, v, 1, u * 9);
  return p.sprite();
}

function library(): Sprite {
  const p = new Painter(2, 160);
  lawn(p, -1, 0.5, 1, 1, 5);
  const b = box(p, -0.75, -0.55, 0.8, 0.4, 22, { wall: STONE, foundation: 5, fnd: "#a89c84" });
  // arched windows
  for (const face of ["left", "right"] as const) {
    const a = face === "left" ? b.D(0) : b.C(0), c = face === "left" ? b.C(0) : b.B(0), n = face === "left" ? 6 : 4;
    for (let k = 0; k < n; k++) {
      const t = (k + 0.5) / n;
      if (face === "left" && t > 0.35 && t < 0.65) continue;
      const [x, y] = lerp(a, c, t);
      p.px(x, y - 15, WIN, 2, 10); p.px(x, y - 16, "#4a4a54", 2, 1); p.px(x - 1, y - 17, shade(STONE, 0.8), 4, 1);
    }
  }
  cornice(p, b, "#efe6cc");
  // balustrade + low red tile hip roof
  hip(p, b, 9, "#a04a34");
  // central portico: 4 columns + pediment, steps
  const pc = box(p, -0.25, 0.4, 0.3, 0.55, 22, { wall: shade(STONE, 0.9), left: false });
  columns(p, pc, "left", 0.05, 0.95, 4, 18, "#f2ecd8");
  box(p, -0.25, 0.4, 0.3, 0.55, 4, { wall: "#e2d8bc", z0: 18, top: "#d8ceb2" });
  pediment(p, pc, "left", -0.02, 1.02, 22, 7, "#e6dcc0");
  box(p, -0.3, 0.55, 0.35, 0.7, 2, { wall: "#c8bea6", top: "#ddd4bc" });
  door(p, p.P(0.02, 0.4, 0), "#3a2a20", 3, 9);
  // copper lantern
  cylinder(p, 0.02, -0.08, 0.1, 31, 4, COPPER, shade(COPPER, 1.2));
  for (const [u, v] of [[-0.85, 0.8], [0.75, 0.85]] as const) treeAt(p, u, v, 1.1, u * 7);
  return p.sprite();
}

function college(): Sprite {
  const p = new Painter(2, 180);
  const st = "#b0a690", roof = "#4c5058";
  lawn(p, -1, -1, 1, 1, 7);
  // collegiate Gothic quad: back range, side range, and a gate tower
  const back = box(p, -0.9, -0.9, 0.9, -0.45, 20, { wall: st, foundation: 2 });
  gable(p, back, "u", 10, roof);
  lancets(p, back, "left", 9, 4, 8);
  const side = box(p, -0.9, -0.45, -0.45, 0.9, 20, { wall: st, foundation: 2 });
  gable(p, side, "v", 10, roof);
  lancets(p, side, "right", 7, 4, 8);
  lancets(p, side, "left", 2, 4, 8);
  // quad paths and a tree
  p.line(p.P(-0.45, 0.25), p.P(0.95, 0.25), "#c8bca0");
  p.line(p.P(0.25, -0.45), p.P(0.25, 0.95), "#c8bca0");
  const right = box(p, 0.5, -0.45, 0.9, 0.5, 18, { wall: st, foundation: 2 });
  gable(p, right, "v", 9, roof);
  lancets(p, right, "left", 2, 4, 7);
  lancets(p, right, "right", 4, 4, 7);
  // tower at the corner of the back range
  const tw = box(p, 0.12, -0.75, 0.42, -0.45, 46, { wall: shade(st, 1.05) });
  lancets(p, tw, "left", 2, 26, 12); lancets(p, tw, "right", 2, 26, 12);
  ribs(p, tw, "left", 2, shade(st, 0.8), 0, 46);
  crenels(p, tw, shade(st, 1.08));
  for (const [u, v] of [[0.75, -0.25], [0.6, 0.6]] as const) { const [x, y] = p.P(u, v, 46); p.px(x, y - 4, shade(st, 1.08), 2, 4); }
  treeAt(p, -0.1, 0.5, 1.1, 2); treeAt(p, 0.25, 0.85, 0.9, 4);
  return p.sprite();
}

function tower(): Sprite {
  // Cathedral of Learning: tall setback Gothic tower of grey-buff limestone
  const p = new Painter(2, 300);
  lawn(p, -1, -1, 1, 1, 9);
  const st = "#c8bea6";
  const base = box(p, -0.75, -0.75, 0.75, 0.75, 22, { wall: st, top: "#9a9282" });
  lancets(p, base, "left", 6, 4, 12); lancets(p, base, "right", 6, 4, 12);
  const tiers: [number, number][] = [[0.5, 150], [0.42, 22], [0.33, 14], [0.24, 10]];
  let z = 22;
  for (const [r, h] of tiers) {
    const b = box(p, -r, -r, r, r, h, { wall: st, z0: z, top: shade(st, 0.85) });
    // vertical piers: alternate light and shadow lines (the strong vertical shafts)
    const n = Math.round(r * 18);
    ribs(p, b, "left", n, shade(st, 0.78), z, z + h);
    ribs(p, b, "right", n, shade(st, 0.56), z, z + h);
    for (let k = 1; k < n; k++) {
      const [x, y] = lerp(b.D(0), b.C(0), (k - 0.5) / n); p.px(x, y - z - h, shade(st, 1.1), 1, h);
    }
    // window slits near tops of shafts
    for (let zz = z + 10; zz < z + h - 4; zz += 9) {
      for (let k = 0; k < n; k++) { const [x, y] = lerp(b.D(0), b.C(0), (k + 0.5) / n); if (k % 2 === 0) p.px(x, y - zz - 3, "#5a5658", 1, 3); }
      for (let k = 0; k < n; k++) { const [x, y] = lerp(b.C(0), b.B(0), (k + 0.5) / n); if (k % 2 === 0) p.px(x, y - zz - 3, "#3e3a3c", 1, 3); }
    }
    // pinnacles at the corners of each setback
    for (const [cu, cv] of [[-r, r], [r, r], [r, -r]] as const) { const [x, y] = p.P(cu, cv, z + h); p.px(x, y - 4, shade(st, 1.05), 1, 4); }
    z += h;
  }
  const [x, y] = p.P(0, 0, z);
  p.poly([[x - 7, y + 1], [x + 7, y + 1], [x, y - 10]], shade(st, 0.9));
  p.poly([[x, y + 4], [x + 7, y + 1], [x, y - 10]], shade(st, 0.68));
  for (const [u, v] of [[-0.9, 0.85], [0.85, -0.9], [0.85, 0.85]] as const) treeAt(p, u, v, 1, u * 5 + v);
  return p.sprite();
}

function museum(): Sprite {
  // Carnegie Institute: long buff-sandstone classical range with copper roofs
  const p = new Painter(3, 190);
  lawn(p, -2, 0.4, 1, 1, 11);
  const back = box(p, -1.9, -1.9, -0.9, -0.55, 26, { wall: STONE, foundation: 3 });
  hip(p, back, 8, COPPER);
  windows(p, back, "right", 5, [6, 16], WIN, SILL);
  const b = box(p, -1.95, -0.55, 0.95, 0.35, 28, { wall: STONE, foundation: 5, fnd: "#a89c84" });
  hip(p, b, 9, COPPER);
  windows(p, b, "left", 18, [6, 17], WIN, "#efe6cc");
  windows(p, b, "right", 5, [6, 17], WIN, "#efe6cc");
  cornice(p, b, "#efe6cc");
  // projecting pavilions with columns and pediments
  for (const [u0, u1] of [[-1.85, -1.45], [-0.75, -0.2], [0.5, 0.9]] as const) {
    const pv = box(p, u0, 0.35, u1, 0.48, 32, { wall: shade(STONE, 1.05), top: "#e8dec4" });
    columns(p, pv, "left", 0.12, 0.88, u1 - u0 > 0.45 ? 6 : 3, 24, "#f2ecd8", 2);
    pediment(p, pv, "left", -0.02, 1.02, 32, 6, "#e6dcc0");
    hip(p, pv, 4, COPPER);
  }
  // music hall dome at the far end
  dome(p, -1.4, -1.25, 0.25, 34, "#7aa08e", 7);
  // steps and statues on the lawn
  box(p, -0.8, 0.48, -0.15, 0.62, 2, { wall: "#c8bea6", top: "#ddd4bc" });
  for (const u of [-1.0, 0.1]) { const [x, y] = p.P(u, 0.75); p.px(x, y - 5, "#9aa29a", 2, 3); p.px(x, y - 2, "#c8c0a8", 3, 2); }
  for (const u of [-1.7, -1.4, 0.4, 0.75]) treeAt(p, u, 0.82, 1, u * 13);
  return p.sprite();
}

function conservatory(): Sprite {
  // Phipps: white-framed Victorian glasshouse, central dome and glazed wings
  const p = new Painter(2, 170);
  lawn(p, -1, -1, 1, 1, 13);
  const glass = "#a9cfcf", frame = "#f4f2ea";
  const glassBox = (u0: number, v0: number, u1: number, v1: number, h: number, axis: "u" | "v") => {
    const b = box(p, u0, v0, u1, v1, h, { wall: glass, wallR: shade(glass, 0.8), foundation: 2, fnd: "#c8c0a8" });
    ribs(p, b, "left", Math.round(((axis === "u" ? u1 - u0 : v1 - v0)) * 14), frame);
    ribs(p, b, "right", Math.round(((axis === "u" ? v1 - v0 : u1 - u0)) * 14), shade(frame, 0.85));
    gable(p, b, axis, 9, "#bfe0de", shade(glass, 0.95));
    cornice(p, b, frame);
    const top = b.z0 + b.h;
    if (axis === "u") { const vm = (v0 + v1) / 2; p.line(p.P(u0, vm, top + 9), p.P(u1, vm, top + 9), frame); }
    else { const um = (u0 + u1) / 2; p.line(p.P(um, v0, top + 9), p.P(um, v1, top + 9), frame); }
    return b;
  };
  glassBox(-0.9, -0.45, -0.25, 0.1, 12, "u");
  glassBox(-0.45, -0.9, 0.1, -0.25, 12, "v");
  glassBox(0.1, -0.35, 0.85, 0.15, 12, "u");
  glassBox(-0.35, 0.1, 0.15, 0.85, 12, "v");
  // central palm house: glazed drum + ribbed glass dome
  const zc = 9;
  cylinder(p, -0.1, -0.1, 0.38, 0, zc, glass, "#c6e4e2");
  { const [x0, y0] = p.P(-0.1, -0.1, 0); const rx = 0.38 * 45; for (let k = -5; k <= 5; k++) { const dx = (k / 5.5) * rx, yy = rx / 2 * Math.sqrt(1 - (dx / rx) ** 2); p.px(x0 + dx, y0 - zc + yy, frame, 1, zc); } }
  const ztop = dome(p, -0.1, -0.1, 0.38, zc, "#b8dcda", 9, 0.75);
  seams(p, -0.1, -0.1, 0.38, zc, ztop - zc, 12, frame);
  const [tx, ty] = p.P(-0.1, -0.1, ztop);
  p.px(tx, ty - 5, frame, 1, 5);
  // flower beds
  for (const [u, v, c] of [[0.6, 0.6, "#c04a5a"], [0.75, 0.4, "#e0c050"], [0.4, 0.75, "#d07a3a"]] as const) ell(p, u, v, 0.09, 0, c);
  treeAt(p, 0.85, 0.85, 0.9, 6);
  return p.sprite();
}

function ballpark(): Sprite {
  // Forbes Field: steel-and-concrete grandstand wrapped round home plate, grass outfield
  const p = new Painter(3, 170);
  flatQuad(p, -2, -2, 1, 1, 0, "#5e9a3a");
  for (let k = 0; k < 6; k++) flatQuad(p, -2 + k * 0.5, -2, -1.75 + k * 0.5, 1, 0, "#68a442");
  // infield dirt diamond near the back corner (home plate at -1.4,-1.4)
  const H = -1.35, D = 0.85;
  p.poly([p.P(H, H), p.P(H + D, H), p.P(H + D, H + D), p.P(H, H + D)].map(([x, y]) => [x, y] as Pt), "#b88a5a");
  p.poly([p.P(H + 0.12, H + 0.12), p.P(H + D - 0.12, H + 0.12), p.P(H + D - 0.12, H + D - 0.12), p.P(H + 0.12, H + D - 0.12)], "#5e9a3a");
  ell(p, H + 0.43, H + 0.43, 0.07, 0, "#c49a66");
  for (const [u, v] of [[H + D, H], [H + D, H + D], [H, H + D]] as const) p.px(...p.P(u, v), "#ffffff", 2, 1);
  p.px(...p.P(H, H), "#ffffff", 2, 1);
  // foul lines
  p.line(p.P(H, H), p.P(0.95, H), "#f0f0e8"); p.line(p.P(H, H), p.P(H, 0.95), "#f0f0e8");
  // outfield wall
  box(p, 0.85, -1.95, 0.95, 0.95, 5, { wall: "#3c6a3a", top: "#2c4a2a", left: false });
  box(p, -1.95, 0.85, 0.95, 0.95, 5, { wall: "#3c6a3a", top: "#2c4a2a", right: false });
  // grandstand: two tiers along the back edges, seats raked toward the field
  const stand = (u0: number, v0: number, u1: number, v1: number, axis: "u" | "v") => {
    const b = box(p, u0, v0, u1, v1, 26, { wall: "#8a8478", top: "#6a6a64" });
    const top = 26;
    if (axis === "u") {
      p.poly([p.P(u0, v0, top), p.P(u1, v0, top), p.P(u1, v1 + 0.3, 6), p.P(u0, v1 + 0.3, 6)], "#3a4a6a");
      for (let k = 1; k < 7; k++) { const t = k / 7; p.line(p.P(u0, v0 + t * (v1 + 0.3 - v0), top - t * 20), p.P(u1, v0 + t * (v1 + 0.3 - v0), top - t * 20), "#52627e"); }
      box(p, u0, v1 + 0.3, u1, v1 + 0.34, 6, { wall: "#c8c0b0", right: false });
    } else {
      p.poly([p.P(u0, v0, top), p.P(u0, v1, top), p.P(u1 + 0.3, v1, 6), p.P(u1 + 0.3, v0, 6)], "#33425e");
      for (let k = 1; k < 7; k++) { const t = k / 7; p.line(p.P(u0 + t * (u1 + 0.3 - u0), v0, top - t * 20), p.P(u0 + t * (u1 + 0.3 - u0), v1, top - t * 20), "#4a5a76"); }
      box(p, u1 + 0.3, v0, u1 + 0.34, v1, 6, { wall: "#b0a898", left: false });
    }
    // roof over upper deck on posts
    return b;
  };
  stand(-1.95, -1.95, 0.2, -1.8, "u");
  stand(-1.95, -1.8, -1.8, 0.2, "v");
  // roof canopy
  p.poly([p.P(-1.95, -1.95, 34), p.P(0.2, -1.95, 34), p.P(0.2, -1.6, 32), p.P(-1.6, -1.6, 32), p.P(-1.6, 0.2, 32), p.P(-1.95, 0.2, 34)], "#5a5a58");
  for (const t of [0, 0.33, 0.66, 1]) { const [x, y] = p.P(-1.6 + t * 1.8, -1.6, 32); p.px(x, y, "#3a3a3a", 1, 10); const [x2, y2] = p.P(-1.6, -1.6 + t * 1.8, 32); p.px(x2, y2, "#3a3a3a", 1, 10); }
  // light towers
  for (const [u, v] of [[0.2, -1.9], [-1.9, 0.2]] as const) { const [x, y] = p.P(u, v, 34); p.px(x, y - 20, "#3a3a3e", 1, 20); p.px(x - 3, y - 24, "#e8e8d0", 7, 4); }
  // scoreboard in left field
  box(p, 0.5, -1.0, 0.6, -0.5, 14, { wall: "#2c4a2a", z0: 0, top: "#1e2e1e" });
  return p.sprite();
}

function stadium(): Sprite {
  // Three Rivers-style concrete bowl
  const p = new Painter(4, 220);
  const cu = -1, cv = -1, R = 1.95, H = 30;
  cylinder(p, cu, cv, R, 0, H, "#b8b2a6", "#c8c2b6");
  // vertical ramps/piers around the drum
  const [cx, cy] = p.P(cu, cv, 0);
  const rx = R * 45, ry = rx / 2;
  for (let k = -10; k <= 10; k++) {
    const dx = (k / 10.5) * rx, yy = ry * Math.sqrt(1 - (dx / rx) ** 2);
    p.px(cx + dx, cy - H + yy, "#8a857a", 1, H);
  }
  for (const z of [10, 20]) for (let dx = -rx; dx <= rx; dx++) { const yy = ry * Math.sqrt(Math.max(0, 1 - (dx / rx) ** 2)); p.px(cx + dx, cy - z + yy, "#9c968a"); }
  // bowl interior, clipped to the rim
  const c = p.ctx;
  c.save();
  c.beginPath(); c.ellipse(cx, cy - H, rx - 1, ry - 1, 0, 0, Math.PI * 2); c.clip();
  const seat = ["#c8b048", "#a04838", "#4a6a9a", "#3a5a8a"];
  for (let k = 0; k < 14; k++) {
    const r = R - 0.08 - k * 0.075, z = H - k * 1.9;
    const [ex, ey] = p.P(cu, cv, z);
    c.fillStyle = k % 2 ? shade(seat[Math.min(3, Math.floor(k / 3))], 0.8) : seat[Math.min(3, Math.floor(k / 3))];
    c.beginPath(); c.ellipse(ex, ey, r * 45, r * 22.5, 0, 0, Math.PI * 2); c.fill();
  }
  // field: artificial turf rectangle with yard lines
  const z = H - 27;
  flatQuad(p, cu - 0.55, cv - 0.9, cu + 0.55, cv + 0.9, z, "#4a8a3a");
  for (let k = 0; k <= 10; k++) p.line(p.P(cu - 0.5, cv - 0.8 + k * 0.16, z), p.P(cu + 0.5, cv - 0.8 + k * 0.16, z), "#e8f0e0");
  c.restore();
  // rim
  for (let dx = -rx; dx <= rx; dx++) { const yy = ry * Math.sqrt(Math.max(0, 1 - (dx / rx) ** 2)); p.px(cx + dx, cy - H + yy - 1, "#e0dace", 1, 2); }
  // light standards on the rim
  for (const a of [0.3, 1.25, 2.2, 3.4, 4.6, 5.6]) {
    const [x, y] = p.P(cu + Math.cos(a) * R, cv + Math.sin(a) * R, H);
    p.px(x, y - 16, "#4a4a4e", 1, 16); p.px(x - 3, y - 19, "#ececd8", 7, 3);
  }
  return p.sprite();
}

function arena(): Sprite {
  // Civic Arena: round stainless-steel dome on a low ring
  const p = new Painter(3, 180);
  cars(p, -1.9, 0.3, 0.9, 0.95, 21, 14);
  cars(p, 0.3, -1.9, 0.95, 0.3, 22, 10);
  const cu = -0.5, cv = -0.5, R = 1.25;
  cylinder(p, cu, cv, R + 0.1, 0, 9, "#a8a49a", "#8a867c");
  for (let k = 0; k < 24; k++) { const a = (k / 24) * Math.PI * 2; if (Math.sin(a) + Math.cos(a) > -0.2) { const [x, y] = p.P(cu + Math.cos(a) * (R + 0.1), cv + Math.sin(a) * (R + 0.1), 0); p.px(x, y - 8, "#4a4a52", 2, 5); } }
  const zt = dome(p, cu, cv, R, 9, "#c4c8cc", 12, 0.55);
  seams(p, cu, cv, R, 9, zt - 9, 16, "#8e9298");
  const [cx, cy] = p.P(cu, cv, 9), hh = zt - 9;
  // highlight
  const [hx, hy] = p.P(cu - 0.4, cv + 0.1, 9);
  p.px(hx, hy - hh * 0.55, "#eef0f2", 6, 2); p.px(hx + 2, hy - hh * 0.55 - 2, "#eef0f2", 4, 1);
  p.px(cx - 1, cy - hh - 2, "#9a9ea4", 3, 3);
  return p.sprite();
}

function terminal(): Sprite {
  // railroad station: brick-and-terracotta headhouse, clock tower, train shed with tracks
  const p = new Painter(2, 200);
  // tracks fanning out of the shed
  for (let k = 0; k < 4; k++) p.line(p.P(-1, -0.9 + k * 0.17), p.P(1, -0.9 + k * 0.17), "#3a3430");
  const shed = box(p, -0.95, -0.95, 0.95, -0.25, 12, { wall: "#4a4a4c", left: false });
  // barrel roof
  for (let k = 0; k < 8; k++) {
    const t0 = k / 8, t1 = (k + 1) / 8, v0 = -0.95 + t0 * 0.7, v1 = -0.95 + t1 * 0.7;
    const z0 = 12 + Math.sin(t0 * Math.PI) * 9, z1 = 12 + Math.sin(t1 * Math.PI) * 9;
    p.poly([p.P(-0.95, v0, z0), p.P(0.95, v0, z0), p.P(0.95, v1, z1), p.P(-0.95, v1, z1)], k === 3 || k === 4 ? "#8aa0a8" : k < 4 ? "#5a5c60" : "#6a6c70");
    p.line(p.P(-0.95, v1, z1), p.P(0.95, v1, z1), "#3a3a3c");
  }
  for (let k = 0; k <= 8; k++) { const t = k / 8; p.px(...p.P(0.95, -0.95 + t * 0.7, 12 + Math.sin(t * Math.PI) * 9), "#3a3a3c", 1, 2); }
  void shed;
  const hh = box(p, -0.85, -0.25, 0.85, 0.55, 30, { wall: "#a65a40", foundation: 4, fnd: "#c8bea6" });
  windows(p, hh, "left", 8, [5, 13, 21], WIN, "#e0c8a0");
  windows(p, hh, "right", 4, [5, 13, 21], WIN, "#e0c8a0");
  hlines(p, hh, 10, "#d8b890", "#b89870");
  hip(p, hh, 10, "#6a4a3a");
  // rotunda / carriage porch
  const rot = box(p, -0.2, 0.55, 0.4, 0.8, 14, { wall: "#d8c0a0", top: "#c8b090" });
  for (let k = 0; k < 3; k++) { const [x, y] = lerp(rot.D(0), rot.C(0), (k + 0.5) / 3); p.px(x - 2, y - 10, "#3a2e2a", 4, 10); p.px(x - 1, y - 11, "#3a2e2a", 2, 1); }
  dome(p, 0.1, 0.65, 0.18, 14, "#7a8a80", 5);
  // clock tower
  const ct = box(p, 0.45, -0.15, 0.7, 0.1, 58, { wall: "#a65a40" });
  const [kx, ky] = lerp(ct.D(48), ct.C(48), 0.5);
  p.px(kx - 2, ky - 4, "#f0e8d0", 4, 4); p.px(kx, ky - 3, "#2a2a2e", 1, 2);
  const tz = 58, ap = p.P(0.575, -0.025, tz + 14);
  p.poly([ct.D(tz), ct.C(tz), ap], "#5a4a3e"); p.poly([ct.C(tz), ct.B(tz), ap], "#463a32");
  return p.sprite();
}

function chapel(): Sprite {
  const p = new Painter(1, 130);
  lawn(p, 0, 0, 1, 1, 15);
  const st = "#a8a090";
  const b = box(p, 0.25, 0.15, 0.72, 0.62, 14, { wall: st, foundation: 2 });
  gable(p, b, "u", 12, "#4a4c54");
  lancets(p, b, "left", 3, 3, 7, "#4a3a5a");
  // front tower and spire on the right (+u) end
  const t = box(p, 0.72, 0.28, 0.86, 0.48, 22, { wall: shade(st, 1.05) });
  lancets(p, t, "right", 1, 12, 6);
  door(p, p.P(0.86, 0.38, 0), "#4a3020", 2, 6);
  const ap = p.P(0.79, 0.38, 46);
  p.poly([t.D(22), t.C(22), ap], "#5a5c62"); p.poly([t.C(22), t.B(22), ap], "#44464c");
  p.px(ap[0], ap[1] - 3, "#c9b26a", 1, 3);
  treeAt(p, 0.15, 0.85, 0.8, 3); treeAt(p, 0.85, 0.85, 0.7, 5, true);
  return p.sprite();
}

function school(): Sprite {
  const p = new Painter(2, 170);
  // dirt schoolyard in front
  flatQuad(p, -1, 0.45, 1, 1, 0, "#a08a66");
  const b = box(p, -0.85, -0.7, 0.85, 0.35, 32, { wall: "#a8563e", foundation: 4, fnd: "#b8ae96", top: "#6a5e54" });
  windows(p, b, "left", 10, [5, 14, 23], WIN, SILL);
  windows(p, b, "right", 6, [5, 14, 23], WIN, SILL);
  hlines(p, b, 32, "#d8cbb0");
  cornice(p, b, "#d8cbb0");
  // entrance bay with stone surround
  const e = box(p, -0.15, 0.35, 0.25, 0.45, 36, { wall: "#b06048", top: "#6a5e54" });
  door(p, p.P(0.05, 0.45, 0), "#e0d4b8", 5, 10);
  door(p, p.P(0.05, 0.45, 0), "#4a3020", 3, 7);
  cornice(p, e, "#d8cbb0");
  // bell cupola + flagpole
  box(p, -0.1, -0.25, 0.1, -0.05, 7, { wall: "#ece6d8", z0: 32 });
  const ap = p.P(0, -0.15, 46);
  p.poly([p.P(-0.12, -0.03, 39), p.P(0.12, -0.03, 39), ap], "#5a5048"); p.poly([p.P(0.12, -0.03, 39), p.P(0.12, -0.27, 39), ap], "#463e38");
  flag(p, 0.75, 0.75, 0, "#b03a2e");
  const [fx, fy] = p.P(0.75, 0.75, 0); p.px(fx + 1, fy - 12, "#2e3e8a", 2, 2); p.px(fx, fy - 12, "#3a3a3e", 1, 12);
  // swings
  const [sx, sy] = p.P(-0.6, 0.75);
  p.line([sx, sy], [sx + 4, sy - 9], "#4a4a4e"); p.line([sx + 14, sy + 0], [sx + 10, sy - 9], "#4a4a4e"); p.line([sx + 4, sy - 9], [sx + 10, sy - 9], "#4a4a4e");
  return p.sprite();
}

function theatre(): Sprite {
  // movie palace: cream terra-cotta front, vertical blade sign, lit marquee
  const p = new Painter(1, 150);
  const b = box(p, 0.08, 0.1, 0.92, 0.9, 30, { wall: "#e0d0a8", wallR: "#a89070", foundation: 2, top: "#6a5e54" });
  // fly tower at the back
  box(p, 0.08, 0.1, 0.9, 0.45, 12, { wall: "#9a6a50", z0: 30, top: "#5a4e44" });
  // ornate front (left face): arched window and pilasters
  ribs(p, b, "left", 4, "#c8b488", 10, 30);
  const [ax, ay] = lerp(b.D(0), b.C(0), 0.5);
  p.px(ax - 3, ay - 25, "#3a3448", 6, 9); p.px(ax - 2, ay - 26, "#3a3448", 4, 1);
  cornice(p, b, "#f4ead0");
  // marquee
  const m0 = lerp(b.D(9), b.C(9), 0.08), m1 = lerp(b.D(9), b.C(9), 0.92);
  p.poly([[m0[0] - 2, m0[1] + 2], [m1[0] + 2, m1[1] + 2], [m1[0] + 2, m1[1] - 3], [m0[0] - 2, m0[1] - 3]], "#c03a2e");
  for (let k = 0; k <= 10; k++) { const [x, y] = lerp(m0, m1, k / 10); p.px(x, y - 3, k % 2 ? "#fff0a0" : "#f8d050"); p.px(x, y + 2, "#fff0a0"); }
  // blade sign standing proud of the corner
  const [bx, by] = lerp(b.D(10), b.C(10), 0.55);
  p.px(bx - 1, by - 34, "#b02a24", 4, 34);
  for (let z = 2; z < 32; z += 4) p.px(bx, by - 33 + z, "#fff0a0", 2, 2);
  p.px(bx - 1, by - 36, "#f8d050", 4, 2);
  door(p, lerp(b.D(0), b.C(0), 0.5), "#4a3020", 4, 6);
  return p.sprite();
}

function observatory(): Sprite {
  // Allegheny Observatory: classical building, big dome with an open slit
  const p = new Painter(1, 130);
  lawn(p, 0, 0, 1, 1, 17);
  const b = box(p, 0.1, 0.25, 0.9, 0.75, 14, { wall: "#d8d0bc", foundation: 3 });
  hip(p, b, 4, "#8a8478");
  windows(p, b, "left", 5, [4], WIN, SILL);
  columns(p, b, "left", 0.35, 0.65, 3, 12, "#f2ecd8");
  pediment(p, b, "left", 0.3, 0.7, 14, 4, "#ece4d0");
  cylinder(p, 0.5, 0.45, 0.25, 14, 6, "#d8d0bc", "#c8c0a8");
  const zt = dome(p, 0.5, 0.45, 0.25, 20, "#e8eae6", 7, 0.85);
  const [x, y] = p.P(0.5, 0.45, 20);
  p.px(x - 1, y - (zt - 20) - 1, "#2a2a32", 3, (zt - 20) + 1);
  // small side domes
  return p.sprite();
}

function zoo(): Sprite {
  const p = new Painter(2, 150);
  lawn(p, -1, -1, 1, 1, 19);
  // pond with ducks
  ell(p, -0.45, -0.4, 0.32, 0, "#4a7aa0", 0.25);
  ell(p, -0.45, -0.4, 0.26, 0, "#5a8ab0", 0.19);
  p.px(...p.P(-0.5, -0.4), "#f4f0e0", 2, 1);
  // paths
  p.line(p.P(-1, 0.55), p.P(1, 0.55), "#c8b890"); p.line(p.P(0.2, -1), p.P(0.2, 1), "#c8b890");
  // pens with fences and animals
  const pen = (u0: number, v0: number, u1: number, v1: number, ground: string) => {
    flatQuad(p, u0, v0, u1, v1, 0, ground);
    for (const [a, b] of [[[u0, v0], [u1, v0]], [[u1, v0], [u1, v1]], [[u0, v1], [u1, v1]], [[u0, v0], [u0, v1]]] as [number, number][][]) {
      p.line(p.P(a[0], a[1], 3), p.P(b[0], b[1], 3), "#6a5a44");
      for (let t = 0; t <= 1; t += 0.2) p.px(...p.P(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, 3), "#5a4a38", 1, 3);
    }
  };
  pen(0.3, -0.9, 0.9, -0.2, "#b8a070");
  pen(-0.9, 0.0, -0.15, 0.45, "#8aa050");
  // elephant
  const [ex, ey] = p.P(0.6, -0.55);
  p.px(ex - 3, ey - 6, "#8a8a8e", 7, 4); p.px(ex - 3, ey - 2, "#7a7a7e", 1, 2); p.px(ex + 2, ey - 2, "#7a7a7e", 1, 2); p.px(ex + 4, ey - 6, "#8a8a8e", 2, 3); p.px(ex + 5, ey - 3, "#7a7a7e", 1, 2);
  // giraffe
  const [gx, gy] = p.P(0.45, -0.3);
  p.px(gx, gy - 5, "#d4a040", 4, 3); p.px(gx + 3, gy - 11, "#d4a040", 1, 7); p.px(gx + 3, gy - 12, "#a07020", 2, 1); p.px(gx, gy - 2, "#a07020", 1, 2); p.px(gx + 3, gy - 2, "#a07020", 1, 2);
  // deer
  for (const [u, v] of [[-0.6, 0.2], [-0.35, 0.3]] as const) { const [x, y] = p.P(u, v); p.px(x, y - 4, "#8a5a34", 3, 2); p.px(x + 2, y - 6, "#8a5a34", 1, 2); p.px(x, y - 2, "#6a4428", 1, 2); p.px(x + 2, y - 2, "#6a4428", 1, 2); }
  // animal house
  const h = box(p, -0.95, -0.95, -0.55, -0.7, 10, { wall: "#c8b898" });
  gable(p, h, "u", 5, "#7a4a34");
  // entrance gate arch at the front
  const [ga, gb] = [p.P(0.05, 0.95), p.P(0.4, 0.95)];
  p.px(ga[0], ga[1] - 14, "#b8ae96", 3, 14); p.px(gb[0], gb[1] - 14, "#b8ae96", 3, 14);
  p.line([ga[0], ga[1] - 15], [gb[0] + 2, gb[1] - 15], "#8a4a34"); p.line([ga[0], ga[1] - 16], [gb[0] + 2, gb[1] - 16], "#8a4a34");
  p.line([ga[0] + 2, ga[1] - 17], [gb[0], gb[1] - 17], "#e0c050");
  for (const [u, v, s] of [[0.8, 0.2, 1.1], [-0.9, 0.8, 1], [0.7, 0.85, 1], [-0.1, -0.85, 0.9], [0.95, -0.95, 1]] as const) treeAt(p, u, v, s, u * 11 + v);
  return p.sprite();
}

function amusement(): Sprite {
  // Kennywood: wooden coaster, carousel, Ferris wheel, pavilions under trees
  const p = new Painter(3, 190);
  lawn(p, -2, -2, 1, 1, 23);
  for (const [u, v] of [[-1.9, 0.6], [0.7, -1.9], [0.8, 0.7], [-0.2, 0.85], [-1.0, 0.8]] as const) treeAt(p, u, v, 1.1, u * 3 + v);
  // coaster: lattice of white supports under a looping out-and-back track
  const path: [number, number, number][] = [];
  for (let k = 0; k <= 64; k++) {
    const t = (k / 64) * Math.PI * 2;
    const u = -1.15 + Math.cos(t) * 0.8, v = -1.3 + Math.sin(t) * 0.55;
    const z = 6 + 26 * Math.abs(Math.sin(t * 1.5)) * (k < 20 ? 1.2 : 0.9);
    path.push([u, v, z]);
  }
  for (let k = 0; k < path.length; k += 2) {
    const [u, v, z] = path[k];
    const g = p.P(u, v), tp = p.P(u, v, z);
    p.line(g, tp, "#e6e0d0");
    if (k % 4 === 0 && k + 4 < path.length) p.line(p.P(u, v, z * 0.5), p.P(path[k + 4][0], path[k + 4][1], path[k + 4][2] * 0.5), "#cfc8b6");
  }
  for (let k = 0; k + 1 < path.length; k++) {
    const a = p.P(...path[k]), b = p.P(...path[k + 1]);
    p.line(a, b, "#7a3a2a"); p.line([a[0], a[1] - 1], [b[0], b[1] - 1], "#f4f0e6");
  }
  // train of cars on the lift hill
  for (let k = 8; k < 11; k++) { const [x, y] = p.P(...path[k]); p.px(x, y - 3, "#c03a2e", 2, 2); }
  // carousel
  const cu = 0.2, cv = 0.0;
  cylinder(p, cu, cv, 0.42, 0, 3, "#d8d0bc", "#c8b890");
  for (let k = 0; k < 12; k++) { const a = (k / 12) * Math.PI * 2; if (Math.sin(a) + Math.cos(a) > -0.5) { const [x, y] = p.P(cu + Math.cos(a) * 0.36, cv + Math.sin(a) * 0.36, 3); p.px(x, y - 9, "#c9b26a", 1, 9); p.px(x - 1, y - 5, k % 3 ? "#f4f0e6" : "#7a4a2a", 3, 2); } }
  for (let k = 0; k < 8; k++) { const r = 0.46 * (1 - k / 9); cylinder(p, cu, cv, r, 12 + k * 1.6, 1.6, k % 2 ? "#c03a2e" : "#f4f0e6", k % 2 ? "#d04a3e" : "#ffffff"); }
  const [tx, ty] = p.P(cu, cv, 25); p.px(tx, ty - 4, "#c9b26a", 1, 4); p.px(tx + 1, ty - 4, "#2e6e3a", 3, 2);
  // Ferris wheel
  const [wx, wy] = p.P(-1.6, 0.0, 30);
  const R = 22;
  p.line([wx - 8, wy + 32], [wx, wy], "#5a5a62"); p.line([wx + 8, wy + 32], [wx, wy], "#5a5a62");
  for (let k = 0; k < 64; k++) { const a = (k / 64) * Math.PI * 2; p.px(wx + Math.cos(a) * R * 0.8, wy + Math.sin(a) * R, "#e8e4dc"); }
  for (let k = 0; k < 10; k++) {
    const a = (k / 10) * Math.PI * 2, ex = wx + Math.cos(a) * R * 0.8, ey = wy + Math.sin(a) * R;
    p.line([wx, wy], [ex, ey], "#b8b4ac");
    p.px(ex - 1, ey, ["#c03a2e", "#e0c050", "#3a6a9a"][k % 3], 3, 3);
  }
  // pavilion
  const pv = box(p, -0.6, 0.35, 0.0, 0.7, 8, { wall: "#f0e8d4" });
  gable(p, pv, "u", 5, "#2e6e3a");
  return p.sprite();
}

function airport(): Sprite {
  const p = new Painter(4, 180);
  flatQuad(p, -3, -3, 1, 1, 0, "#7aa046");
  for (let k = 0; k < 8; k++) flatQuad(p, -3 + k * 0.5, -3, -2.75 + k * 0.5, 1, 0, "#82a84c");
  // runways: crossing strips with dashed centrelines
  flatQuad(p, -3, -1.75, 1, -1.35, 0, "#4a4a4c");
  flatQuad(p, -1.75, -3, -1.35, 1, 0, "#505052");
  for (let t = -2.9; t < 0.9; t += 0.25) {
    p.line(p.P(t, -1.55), p.P(t + 0.12, -1.55), "#f0f0e8");
    p.line(p.P(-1.55, t), p.P(-1.55, t + 0.12), "#f0f0e8");
  }
  for (const u of [-2.95, 0.85]) for (let k = 0; k < 4; k++) p.line(p.P(u, -1.72 + k * 0.1), p.P(u + 0.08, -1.72 + k * 0.1), "#f0f0e8");
  // apron and taxiway
  flatQuad(p, -1.0, -0.6, 0.95, 0.15, 0, "#8a8a86");
  flatQuad(p, -1.35, -0.45, -1.0, -0.25, 0, "#5a5a5c");
  // terminal: Art Deco, stepped centre with control tower
  const t = box(p, -0.9, 0.2, 0.9, 0.7, 12, { wall: "#e4dcc6", top: "#bdb4a0", foundation: 1 });
  windows(p, t, "left", 12, [4], "#3a4a5a", "#f4ecd8");
  windows(p, t, "right", 3, [4], "#3a4a5a", "#f4ecd8");
  for (let k = 0; k <= 12; k++) { const [x, y] = lerp(t.D(0), t.C(0), k / 12); p.px(x, y - 12, "#c8bea6", 1, 12); }
  const c = box(p, -0.2, 0.3, 0.2, 0.6, 22, { wall: "#ece4ce", top: "#bdb4a0" });
  ribs(p, c, "left", 4, "#c8bea6");
  const g = box(p, -0.12, 0.38, 0.12, 0.52, 6, { wall: "#4a6a7a", wallR: "#3a5a6a", top: "#d8d0bc", z0: 22 });
  void g;
  p.px(...p.P(0, 0.45, 28), "#3a3a3e", 1, 6);
  // hangar with barrel roof
  const hg = box(p, -2.7, -0.6, -2.0, 0.4, 12, { wall: "#9a9488", foundation: 0 });
  for (let k = 0; k <= 8; k++) { const tt = k / 8; p.line(p.P(-2.7 + tt * 0.7, -0.6, 12 + Math.sin(tt * Math.PI) * 8), p.P(-2.7 + tt * 0.7, 0.4, 12 + Math.sin(tt * Math.PI) * 8), k % 2 ? "#7a7a7e" : "#8a8a8e"); }
  p.poly([hg.D(0), hg.C(0), hg.C(10), hg.D(10)], "#5a5a5e");
  void hg;
  // parked airliner (DC-3) on the apron
  const plane = (u: number, v: number) => {
    const [x, y] = p.P(u, v, 3);
    p.line([x - 9, y - 4], [x + 9, y + 4], "#d8dce0"); p.line([x - 9, y - 3], [x + 9, y + 5], "#b8bcc0");
    p.line([x - 8, y + 5], [x + 7, y - 3], "#c8ccd0"); p.line([x - 8, y + 6], [x + 7, y - 2], "#a8acb0");
    p.line([x - 9, y - 4], [x - 9, y - 9], "#c03a2e");
  };
  plane(-0.3, -0.25); plane(0.5, -0.35);
  // windsock + beacon
  const [bx, by] = p.P(-2.6, 0.8);
  p.px(bx, by - 10, "#3a3a3e", 1, 10); p.px(bx + 1, by - 10, "#e07030", 4, 2);
  return p.sprite();
}

function plant(): Sprite {
  // generic heavy industry: tank farm, stacks, sheds and pipework
  const p = new Painter(3, 210);
  flatQuad(p, -2, -2, 1, 1, 0, "#4a4440");
  for (const [u, v, r, h] of [[-1.55, -1.55, 0.3, 16], [-0.85, -1.6, 0.3, 16], [-1.6, -0.85, 0.28, 14]] as const) {
    cylinder(p, u, v, r, 0, h, "#c8c4b8", "#a8a498");
    p.px(...p.P(u, v + r, h * 0.5), "#8a3a2a", 4, 1);
  }
  // retort / cracking towers
  for (const [u, v, h] of [[-0.3, -1.3, 44], [-0.05, -1.45, 36]] as const) {
    cylinder(p, u, v, 0.08, 0, h, "#8a8a86", "#5a5a58");
    for (let z = 6; z < h; z += 8) { const [x, y] = p.P(u, v, z); p.px(x - 5, y, "#5a5a58", 10, 1); }
  }
  // long shed with monitor roof
  const s = box(p, -1.9, -0.4, 0.2, 0.3, 16, { wall: "#7a6a5a", foundation: 1 });
  gable(p, s, "u", 6, "#4a4a4c");
  box(p, -1.7, -0.12, 0.0, 0.02, 3, { wall: "#c8c4a0", z0: 22, top: "#4a4a4c" });
  windows(p, s, "left", 10, [5], "#2a2420", "#d8a060");
  // potline / furnace hall at front
  const f = box(p, -0.5, 0.45, 0.9, 0.9, 20, { wall: "#8a7a6a", foundation: 1 });
  gable(p, f, "u", 7, "#3e3e40");
  windows(p, f, "left", 6, [6], "#2a2420", "#e0a050");
  p.px(...lerp(f.D(0), f.C(0), 0.8), "#e0602a", 3, 6);
  // stacks
  for (const [u, v, h] of [[0.5, -0.9, 70], [0.75, -0.6, 62], [0.6, 0.1, 52]] as const) stack(p, u, v, 0, h, "#7a4a3a", 0.07);
  // pipe racks
  p.line(p.P(-0.9, -1.0, 8), p.P(0.4, -0.95, 8), "#9a9488"); p.line(p.P(-0.9, -0.95, 10), p.P(0.4, -0.9, 10), "#7a7468");
  for (let t = 0; t <= 1; t += 0.25) p.line(p.P(-0.9 + t * 1.3, -0.97, 0), p.P(-0.9 + t * 1.3, -0.97, 10), "#5a5650");
  return p.sprite();
}


// ---------------------------------------------------------------- v0.18 landmarks: the downtown towers and the labs

/** a window grid on a tall face: dark panes in rows (lit-window colour handled by the night pass) */
function grid(p: Painter, b: Box, face: "left" | "right", cols: number, z0: number, z1: number, step: number, col: string) {
  const a = face === "left" ? b.D(0) : b.C(0), c = face === "left" ? b.C(0) : b.B(0);
  for (let z = z0; z < z1; z += step) for (let k = 0; k < cols; k++) { const [x, y] = lerp(a, c, (k + 0.5) / cols); p.px(x, y - z - 2, col, 1, 2); }
}

function skyscraper(): Sprite {
  // a 1900s–1930s office tower: stone base, brick or limestone shaft, a crown (the Frick, Koppers, Gulf, Grant)
  const p = new Painter(1, 320);
  const st = "#c4b496";
  const base = box(p, 0.08, 0.08, 0.92, 0.92, 18, { wall: shade(st, 0.9), top: "#6a6258" });
  grid(p, base, "left", 5, 4, 16, 6, WIN); grid(p, base, "right", 5, 4, 16, 6, "#26262c");
  const shaft = box(p, 0.14, 0.14, 0.86, 0.86, 170, { wall: st, z0: 18, top: "#5a544c" });
  ribs(p, shaft, "left", 6, shade(st, 0.82), 18, 188); ribs(p, shaft, "right", 6, shade(st, 0.6), 18, 188);
  grid(p, shaft, "left", 6, 22, 186, 5, WIN); grid(p, shaft, "right", 6, 22, 186, 5, "#24242a");
  cornice(p, shaft, "#e2d6ba");
  // setback crown: a copper-roofed pyramid (Koppers) / stepped top with a beacon (Gulf)
  const c1 = box(p, 0.28, 0.28, 0.72, 0.72, 18, { wall: shade(st, 1.04), z0: 188, top: "#5a544c" });
  grid(p, c1, "left", 3, 192, 204, 5, WIN);
  const top = 206, [ax, ay] = p.P(0.5, 0.5, top + 26);
  p.poly([c1.D(top), c1.C(top), [ax, ay]], COPPER); p.poly([c1.C(top), c1.B(top), [ax, ay]], shade(COPPER, 0.7));
  p.px(ax, ay - 6, "#3a3a3e", 1, 6); p.px(ax - 1, ay - 8, "#e05a3a", 3, 2);
  return p.sprite();
}

function skytower(): Sprite {
  // the U.S. Steel Building (1970): 64 floors of rust-brown Cor-Ten, columns standing outside the walls
  const p = new Painter(2, 460);
  lawn(p, -1, -1, 1, 1, 31);
  const cor = "#6a4232";
  const b = box(p, -0.7, -0.7, 0.7, 0.7, 330, { wall: cor, top: "#3a2a24" });
  for (let k = 1; k < 9; k++) { const [x, y] = lerp(b.D(0), b.C(0), k / 9); p.px(x - 1, y - 330, shade(cor, 0.72), 2, 330); }
  for (let k = 1; k < 9; k++) { const [x, y] = lerp(b.C(0), b.B(0), k / 9); p.px(x - 1, y - 330, shade(cor, 0.5), 2, 330); }
  for (let z = 8; z < 328; z += 6) { p.line(b.D(z), b.C(z), "#2a2024"); p.line(b.C(z), b.B(z), "#20181a"); }
  cornice(p, b, shade(cor, 1.2));
  // the plaza and its fountain
  ell(p, 0.6, 0.85, 0.12, 0, "#b8b2a6"); ell(p, 0.6, 0.85, 0.08, 0.5, "#6a9ac0");
  return p.sprite();
}

function glasstower(): Sprite {
  // Renaissance II glass: a Gothic cluster of reflective glass (PPG Place) beside a tall dark-glass shaft
  const p = new Painter(2, 400);
  lawn(p, -1, 0.5, 1, 1, 33);
  const g1 = "#4e6a86", g2 = "#7a94ae";
  const main = box(p, -0.85, -0.85, 0.15, 0.15, 290, { wall: g1, top: "#2a3644" });
  ribs(p, main, "left", 10, shade(g1, 1.4)); ribs(p, main, "right", 10, shade(g1, 0.75));
  for (let z = 6; z < 288; z += 7) { p.line(main.D(z), main.C(z), shade(g1, 0.85)); p.line(main.C(z), main.B(z), shade(g1, 0.6)); }
  // the Gothic glass castle in front: towers with pinnacles
  for (const [u0, v0, h] of [[0.25, -0.85, 150], [0.25, -0.2, 110], [-0.85, 0.3, 120], [0.3, 0.35, 70]] as const) {
    const t = box(p, u0, v0, u0 + 0.5, v0 + 0.45, h, { wall: g2, top: "#3a4a5a" });
    ribs(p, t, "left", 6, "#c8d8e8"); ribs(p, t, "right", 5, shade(g2, 0.7));
    for (const [cu, cv] of [[u0, v0 + 0.45], [u0 + 0.5, v0 + 0.45], [u0 + 0.5, v0]] as const) { const [x, y] = p.P(cu, cv, h); p.poly([[x - 2, y], [x + 2, y], [x, y - 12]], "#9ab0c8"); }
  }
  return p.sprite();
}

function lab(): Sprite {
  // a research campus: low modern blocks of brick and glass on a lawn, a car park, a water tower
  const p = new Painter(3, 160);
  lawn(p, -2, -2, 1, 1, 35);
  const blk = (u0: number, v0: number, u1: number, v1: number, h: number, col: string) => {
    const b = box(p, u0, v0, u1, v1, h, { wall: col, top: "#5a5e64", foundation: 2 });
    for (let z = 4; z < h - 2; z += 6) { winRow2(p, b, "left", z); winRow2(p, b, "right", z); }
    cornice(p, b, "#d8d8d0");
    return b;
  };
  blk(-1.8, -1.8, 0.6, -1.2, 22, "#a8664c");
  blk(-1.8, -0.9, -1.2, 0.6, 18, "#8e98a2");
  blk(-0.8, -0.8, 0.6, -0.2, 26, "#b8bcc0");
  // car park
  p.poly([p.P(-0.8, 0.1), p.P(0.8, 0.1), p.P(0.8, 0.85), p.P(-0.8, 0.85)], "#6a6a6e");
  for (let k = 0; k < 7; k++) { const [x, y] = p.P(-0.65 + k * 0.22, 0.4); p.px(x, y - 3, ["#a83a2a", "#3a5a8a", "#d8d0b8", "#2a2a2e"][k % 4], 5, 3); }
  cylinder(p, 0.75, -1.6, 0.12, 30, 12, "#a8b0b8", "#8890a0");
  for (const [u, v] of [[-1.9, 0.8], [0.85, 0.85], [-1.0, 0.85], [0.9, -0.9]] as const) treeAt(p, u, v, 1, u * 3 + v);
  return p.sprite();
}
function winRow2(p: Painter, b: Box, face: "left" | "right", z: number) {
  const a = face === "left" ? b.D(0) : b.C(0), c = face === "left" ? b.C(0) : b.B(0);
  p.line([a[0], a[1] - z], [c[0], c[1] - z], face === "left" ? "#9ab8cc" : "#7a94a8");
  p.line([a[0], a[1] - z - 1], [c[0], c[1] - z - 1], face === "left" ? "#b8d0e0" : "#8aa4b8");
}

function reactor(): Sprite {
  // an atomic laboratory: a containment sphere beside the prototype hall, offices, a security fence
  const p = new Painter(3, 200);
  lawn(p, -2, -2, 1, 1, 37);
  cylinder(p, -1.1, -1.1, 0.55, 0, 26, "#d0d0cc", "#c4c4c0");
  for (let k = 0; k < 10; k++) cylinder(p, -1.1, -1.1, 0.55 * Math.cos((k / 10) * Math.PI / 2), 26 + k * 4, 4, "#dcdcd8", "#cacac6");
  const hall = box(p, -0.3, -1.8, 0.8, -0.6, 36, { wall: "#a4a8ac", top: "#6a6e74" });
  ribs(p, hall, "left", 8, "#8a8e94"); ribs(p, hall, "right", 8, "#7a7e84");
  const off = box(p, -1.8, -0.2, 0.6, 0.4, 16, { wall: "#b06a50", top: "#5a5e64", foundation: 2 });
  winRow2(p, off, "left", 5); winRow2(p, off, "left", 11);
  stack(p, 0.6, -0.3, 0, 60, "#a8a8a8", 0.05);
  // the fence
  for (let t = -1.95; t <= 0.95; t += 0.12) { const [x, y] = p.P(t, 0.95); p.px(x, y - 5, "#6a6a6e", 1, 5); }
  p.line(p.P(-1.95, 0.95, 5), p.P(0.95, 0.95, 5), "#8a8a8e");
  return p.sprite();
}

function office(): Sprite {
  // Gateway Center: stainless-and-glass towers on a plaza
  const p = new Painter(2, 260);
  lawn(p, -1, 0.3, 1, 1, 25);
  const glassTower = (u0: number, v0: number, u1: number, v1: number, h: number, col: string) => {
    const b = box(p, u0, v0, u1, v1, h, { wall: col, wallR: shade(col, 0.72), top: "#8a9098" });
    for (let z = 4; z < h; z += 4) { p.line(b.D(z), b.C(z), shade(col, 0.82)); p.line(b.C(z), b.B(z), shade(col, 0.6)); }
    ribs(p, b, "left", Math.round((u1 - u0) * 12), "#e4e8ec");
    ribs(p, b, "right", Math.round((v1 - v0) * 12), "#a8b0b8");
    p.line(b.D(h), b.C(h), "#f0f4f6"); p.line(b.C(h), b.B(h), "#c0c8d0");
    return b;
  };
  glassTower(-0.85, -0.85, -0.25, -0.35, 120, "#7a96aa");
  glassTower(0.1, -0.9, 0.7, -0.4, 96, "#88a2b4");
  glassTower(-0.85, -0.2, -0.35, 0.3, 80, "#7090a6");
  glassTower(0.05, -0.2, 0.65, 0.2, 140, "#6e8ca2");
  // fountain on the plaza
  ell(p, 0.5, 0.65, 0.14, 0, "#b8b2a6"); ell(p, 0.5, 0.65, 0.1, 0.5, "#6a9ac0");
  treeAt(p, -0.6, 0.75, 0.9, 1); treeAt(p, -0.2, 0.9, 0.9, 2); treeAt(p, 0.85, 0.4, 0.9, 3);
  return p.sprite();
}

function housing(): Sprite {
  // public housing: rows of flat-roofed three-storey brick blocks on lawns
  const p = new Painter(3, 160);
  lawn(p, -2, -2, 1, 1, 27);
  const blk = (u0: number, v0: number, u1: number, v1: number, h: number) => {
    const b = box(p, u0, v0, u1, v1, h, { wall: "#b06e52", foundation: 2, top: "#7a6e64" });
    const L = Math.round(Math.max(u1 - u0, v1 - v0) * 8), S = Math.round(Math.min(u1 - u0, v1 - v0) * 8) + 1;
    const lu = u1 - u0 >= v1 - v0;
    windows(p, b, "left", lu ? L : S, rows(3, 6, Math.floor(h / 6)), WIN, "#e8e0c8");
    windows(p, b, "right", lu ? S : L, rows(3, 6, Math.floor(h / 6)), WIN, "#e8e0c8");
    // stair towers
    for (const t of [0.25, 0.75]) { const [x, y] = lerp(lu ? b.D(0) : b.C(0), lu ? b.C(0) : b.B(0), t); p.px(x - 1, y - h, "#c8bca8", 3, h); p.px(x, y - 4, "#3a2a20", 1, 4); }
    cornice(p, b, "#c8bca8");
    return b;
  };
  blk(-1.85, -1.85, 0.8, -1.45, 18);
  blk(-1.85, -1.05, -1.45, 0.8, 18);
  blk(-1.0, -0.95, 0.8, -0.55, 18);
  blk(-1.0, -0.05, 0.8, 0.35, 18);
  // walks + clothes lines
  p.line(p.P(-1.3, 0.6), p.P(0.95, 0.6), "#c8c0a8");
  for (const [u, v] of [[-0.6, 0.75], [0.3, 0.8], [0.8, -0.25], [-1.25, -0.3]] as const) treeAt(p, u, v, 0.9, u * 5 + v);
  return p.sprite();
}

function fountain(): Sprite {
  // the Point fountain: wide round basin and a tall plume
  const p = new Painter(1, 130);
  ell(p, 0.5, 0.5, 0.48, 0, "#c8c0ac");
  cylinder(p, 0.5, 0.5, 0.44, 0, 3, "#b8b09c", "#4a7aa8");
  ell(p, 0.5, 0.5, 0.38, 3, "#5a8ab8");
  ell(p, 0.5, 0.5, 0.2, 3, "#7aa8d0");
  const [x, y] = p.P(0.5, 0.5, 3);
  // plume
  for (let z = 0; z < 46; z++) { const w = 1 + Math.round(z / 16); p.px(x - w / 2, y - z, z % 3 ? "#dcecf8" : "#ffffff", w + 1, 1); }
  for (let k = 0; k < 40; k++) {
    const a = tileNoise(41, k, 1, 1) * Math.PI, r = tileNoise(41, k, 2, 1);
    const sx = x + Math.cos(a) * 14 * r * (tileNoise(41, k, 3, 1) < 0.5 ? -1 : 1), sy = y - 46 + 50 * r * r;
    p.px(sx, sy, k % 2 ? "#ffffff" : "#c8e0f0");
  }
  p.px(x - 3, y - 48, "#ffffff", 7, 2);
  return p.sprite();
}

function factory(): Sprite {
  // brick works with a north-light sawtooth roof and a stack
  const p = new Painter(2, 190);
  flatQuad(p, -1, -1, 1, 1, 0, "#5a4e44");
  const b = box(p, -0.9, -0.85, 0.85, 0.75, 14, { wall: "#9a4a36", foundation: 2 });
  windows(p, b, "left", 9, [5], "#2a2a30", "#c8b898");
  windows(p, b, "right", 8, [5], "#2a2a30", "#c8b898");
  door(p, lerp(b.D(0), b.C(0), 0.3), "#3a2a20", 4, 8);
  // sawtooth: teeth run along v, stepping along u
  const n = 6, du = (0.85 + 0.9) / n;
  for (let k = 0; k < n; k++) {
    const u0 = -0.9 + k * du, u1 = u0 + du;
    // glazed vertical face (toward -u, hidden) and sloped roof face toward +u
    p.poly([p.P(u0, -0.85, 14), p.P(u0, 0.75, 14), p.P(u0, 0.75, 22), p.P(u0, -0.85, 22)], "#6a8a9a");
    p.poly([p.P(u0, -0.85, 22), p.P(u0, 0.75, 22), p.P(u1, 0.75, 14), p.P(u1, -0.85, 14)], "#5a5654");
    p.poly([p.P(u0, 0.75, 14), p.P(u1, 0.75, 14), p.P(u0, 0.75, 22)], "#8a4232");
    p.line(p.P(u0, -0.85, 22), p.P(u0, 0.75, 22), "#9ab8c4");
  }
  stack(p, 0.6, -0.65, 0, 64, BRICK2, 0.07);
  const [x, y] = p.P(0.6, -0.65, 54); p.px(x - 3, y, "#e8dcc0", 7, 1);
  // water tower
  for (const [du2, dv2] of [[-0.06, -0.06], [0.06, 0.06], [0.06, -0.06], [-0.06, 0.06]]) p.line(p.P(-0.6 + du2, -0.6 + dv2, 14), p.P(-0.6 + du2, -0.6 + dv2, 30), "#3a3a3a");
  cylinder(p, -0.6, -0.6, 0.11, 30, 8, "#6a5040", "#4a3a30");
  return p.sprite();
}

function shipyard(): Sprite {
  // slipways with a hull on the ways, gantry cranes, plate shop
  const p = new Painter(3, 210);
  flatQuad(p, -2, -2, 1, 1, 0, "#5a5450");
  // slipways run along u down to the river side (+u)
  for (const v of [-1.5, -0.6]) {
    p.poly([p.P(-1.8, v - 0.3, 4), p.P(0.95, v - 0.3, 0), p.P(0.95, v + 0.3, 0), p.P(-1.8, v + 0.3, 4)], "#6a5a48");
    for (let t = 0; t <= 1; t += 0.08) p.line(p.P(-1.8 + t * 2.75, v - 0.3, 4 - t * 4), p.P(-1.8 + t * 2.75, v + 0.3, 4 - t * 4), "#4a3e32");
  }
  // hull on the far way
  const hull = (v: number, col: string) => {
    const b = box(p, -1.5, v - 0.2, 0.55, v + 0.2, 16, { wall: "#2a2a2c", wallR: "#222224", z0: 4, top: "#7a6a5a" });
    p.poly([b.D(4), b.C(4), b.C(10), b.D(10)], col);
    p.poly([b.C(4), b.B(4), b.B(10), b.C(10)], shade(col, 0.7));
    // bow
    p.poly([b.C(4), b.B(4), p.P(0.85, v, 20), b.C(20)], "#2a2a2c");
    p.poly([b.B(4), p.P(0.85, v, 20), b.B(20)], "#1e1e20");
    // staging scaffold
    for (let t = 0.1; t < 1; t += 0.15) { const [x, y] = lerp(b.D(4), b.C(4), t); p.px(x, y - 18, "#8a7a5a", 1, 20); }
    return b;
  };
  hull(-1.5, "#8a2a24");
  const h2 = box(p, -1.2, -0.75, 0.0, -0.45, 8, { wall: "#4a4a4c", z0: 4, top: "#6a6a6a" });
  p.poly([h2.D(4), h2.C(4), h2.C(7), h2.D(7)], "#9a3a2a");
  // gantry cranes
  for (const [u, v] of [[-0.9, -1.0], [0.3, -1.05], [-0.4, -0.05]] as const) {
    const base = p.P(u, v), top = p.P(u, v, 54);
    p.px(base[0] - 1, top[1], "#c89a2a", 3, base[1] - top[1]);
    for (let z = 4; z < 54; z += 6) p.line(p.P(u, v, z), p.P(u, v, z + 6), "#7a5a1a");
    const jA = p.P(u - 0.3, v + 0.3, 54), jB = p.P(u + 0.75, v - 0.75, 54);
    p.line(jA, jB, "#c89a2a"); p.line([jA[0], jA[1] - 1], [jB[0], jB[1] - 1], "#e0b440"); p.line([jA[0], jA[1] + 1], [jB[0], jB[1] + 1], "#8a6a1a");
    p.line([top[0], top[1] - 8], jA, "#5a4a2a"); p.line([top[0], top[1] - 8], jB, "#5a4a2a");
    p.px(top[0] - 1, top[1] - 9, "#c89a2a", 3, 9);
    p.px(jA[0] - 3, jA[1] - 1, "#4a4a4c", 5, 4);
    const hk = lerp(top, jB, 0.7); p.px(hk[0], hk[1], "#2a2a2a", 1, 18);
  }
  // plate shop
  const s = box(p, -1.9, 0.3, 0.6, 0.9, 20, { wall: "#8a5a44", foundation: 1 });
  gable(p, s, "u", 8, "#4a4a4c");
  windows(p, s, "left", 10, [6, 13], "#2a2a30", "#c8b898");
  p.poly([lerp(s.C(0), s.B(0), 0.25), lerp(s.C(0), s.B(0), 0.75), lerp(s.C(16), s.B(16), 0.75), lerp(s.C(16), s.B(16), 0.25)], "#2a2420");
  return p.sprite();
}

function planetarium(): Sprite {
  // Buhl Planetarium: Art Deco limestone block crowned by a dome
  const p = new Painter(1, 120);
  lawn(p, 0, 0, 1, 1, 29);
  const b = box(p, 0.12, 0.12, 0.88, 0.88, 16, { wall: "#ddd4bc", foundation: 2 });
  ribs(p, b, "left", 6, "#c4b89c", 2, 16); ribs(p, b, "right", 6, "#a8a088", 2, 16);
  cornice(p, b, "#efe8d4");
  p.poly([b.A(16), b.B(16), b.C(16), b.D(16)], "#c8c0a8");
  // entrance with two pylons
  const [ex, ey] = lerp(b.D(0), b.C(0), 0.5);
  p.px(ex - 3, ey - 10, "#3a3448", 6, 10); p.px(ex - 5, ey - 14, "#efe8d4", 2, 14); p.px(ex + 3, ey - 14, "#efe8d4", 2, 14);
  cylinder(p, 0.5, 0.5, 0.3, 16, 4, "#ddd4bc", "#c8c0a8");
  dome(p, 0.5, 0.5, 0.3, 20, "#7aa08e", 8, 0.8);
  return p.sprite();
}

function church(): Sprite {
  // stone church with a tall front steeple
  const p = new Painter(1, 150);
  const st = "#9c9484";
  const b = box(p, 0.15, 0.2, 0.7, 0.8, 18, { wall: st, foundation: 2 });
  gable(p, b, "u", 13, "#4a4c54");
  lancets(p, b, "left", 3, 4, 9, "#5a3a6a");
  const t = box(p, 0.7, 0.32, 0.9, 0.62, 34, { wall: shade(st, 1.05) });
  lancets(p, t, "right", 1, 22, 7); lancets(p, t, "left", 1, 22, 7);
  // rose window and door on the front (+u) face
  const [rx, ry] = p.P(0.9, 0.47, 14);
  p.px(rx - 2, ry - 3, "#7a3a5a", 4, 4); p.px(rx - 1, ry - 4, "#c08aa0", 2, 1);
  door(p, p.P(0.9, 0.47, 0), "#4a3020", 3, 7);
  crenels(p, t, shade(st, 1.08));
  const ap = p.P(0.8, 0.47, 66);
  p.poly([t.D(34), t.C(34), ap], "#5a5c62"); p.poly([t.C(34), t.B(34), ap], "#44464c");
  p.px(ap[0], ap[1] - 4, "#c9b26a", 1, 4); p.px(ap[0] - 1, ap[1] - 3, "#c9b26a", 3, 1);
  return p.sprite();
}

function hall(): Sprite {
  // social hall (lodge, Sokol, union hall): two storeys, front gable, name band and flag
  const p = new Painter(1, 120);
  const b = box(p, 0.15, 0.15, 0.85, 0.85, 22, { wall: "#b8744e", foundation: 3 });
  gable(p, b, "u", 9, "#4e4a48");
  windows(p, b, "left", 4, [4, 13], WIN, SILL);
  windows(p, b, "right", 3, [13], WIN, SILL);
  // name band across the front gable end
  p.line(b.C(19), b.B(19), "#e8dcc0"); p.line(b.C(18), b.B(18), "#e8dcc0");
  const [dx, dy] = lerp(b.C(0), b.B(0), 0.5);
  p.px(dx - 1, dy - 8, "#4a3020", 3, 8); p.px(dx - 2, dy - 9, "#e8dcc0", 5, 1);
  flag(p, 0.85, 0.5, 31, "#b03a2e");
  return p.sprite();
}

/** rubble and the burned-out shell of whatever stood here */
function ruin(n: number): Sprite {
  const p = new Painter(n, 100 + n * 36);
  const lo = -(n - 1) + 0.1, hi = 0.9;
  flatQuad(p, lo - 0.05, lo - 0.05, hi + 0.05, hi + 0.05, 0, "#6a625a");
  const r = (k: number) => tileNoise(600 + n, k, 7, 1);
  // jagged wall fragments along the back edges and one front edge
  const wall = (ua: number, va: number, ub: number, vb: number, hmax: number, col: string, seed: number) => {
    const A = p.P(ua, va), B = p.P(ub, vb), steps = Math.max(1, Math.round(Math.abs(B[0] - A[0])));
    for (let s = 0; s <= steps; s++) {
      const t = s / steps, x = A[0] + (B[0] - A[0]) * t, y = A[1] + (B[1] - A[1]) * t;
      const blk = Math.floor(s / 3);
      const h = Math.round(hmax * (0.25 + 0.75 * tileNoise(seed, blk, 1, 1)) * (0.6 + 0.4 * Math.sin(t * Math.PI)));
      p.px(x, y - h, col, 1, h);
      p.px(x, y - h, "#2a2422", 1, 1);
      // window holes and soot
      for (let z = 5; z < h - 2; z += 8) if (s % 8 >= 3 && s % 8 <= 4) p.px(x, y - z - 3, "#1a1616", 1, 3);
      if (tileNoise(seed, s, 3, 1) < 0.3) p.px(x, y - h + 1, "#3a302a", 1, 2);
    }
  };
  const H = 8 + n * 7;
  wall(lo, lo, hi, lo, H, "#8a5a46", 11 + n);
  wall(lo, lo, lo, hi, H * 0.8, "#a46a52", 13 + n);
  // charred beams
  for (let k = 0; k < n * 2; k++) {
    const u = lo + r(k) * (hi - lo), v = lo + r(k + 20) * (hi - lo);
    p.line(p.P(u, v, 0), p.P(u + 0.3 * (r(k + 40) - 0.5), v + 0.25, 6 + r(k + 60) * 8), "#2a2220");
  }
  // rubble heaps
  for (let k = 0; k < n * 3 + 1; k++) {
    const u = lo + 0.15 + r(k + 80) * (hi - lo - 0.3), v = lo + 0.15 + r(k + 100) * (hi - lo - 0.3);
    const [x, y] = p.P(u, v);
    const s = 3 + r(k + 120) * (3 + n);
    blob(p, x, y - s * 0.4, s * 1.4, s * 0.7, ["#2e2826", "#4a3c36", "#6a4a3c", "#8a5a46", "#7a7268"], (q) => tileNoise(700 + n, k, q, 1));
  }
  // front fragment
  if (n >= 2) wall(hi, lo + 0.3, hi, hi, H * 0.6, "#7a4e3c", 17 + n);
  // scattered bricks and stone
  for (let k = 0; k < n * 25; k++) { const [x, y] = p.P(lo + r(k + 300) * (hi - lo), lo + r(k + 400) * (hi - lo)); p.px(x, y, k % 3 ? "#8a4e3a" : "#9a948a", 2, 1); }
  // a lone chimney still standing
  stack(p, lo + 0.3, lo + 0.3, 0, H + 8, "#7a4a3a", 0.05);
  for (let k = 0; k < n + 2; k++) { const [x, y] = p.P(lo + r(k + 140) * (hi - lo), hi - 0.05); p.px(x, y - 3, "#4a4a2a", 2, 3); }
  return p.sprite();
}

// ---------------------------------------------------------------- catalog

export type SpriteKey = string;

/** Static sprites (nature, craft, bridges, 1850 landmarks). Houses and plants are generated on demand by key. */
export function buildSprites(): Map<SpriteKey, Sprite> {
  const s = new Map<SpriteKey, Sprite>();
  for (let v = 0; v < 3; v++) { s.set(`tree:oak${v}`, tree("oak", v)); s.set(`tree:maple${v}`, tree("maple", v)); s.set(`tree:pine${v}`, tree("pine", v)); }
  for (let v = 0; v < 2; v++) { s.set(`tree:bush${v}`, tree("bush", v)); }
  s.set("tree:dead0", tree("dead", 0));
  for (let v = 0; v < 3; v++) s.set(`cabin:${v}`, cabin(v));
  for (let v = 0; v < 2; v++) s.set(`farm:${v}`, farmstead(v));
  s.set("struct:blockhouse", blockhouse());
  s.set("struct:courthouse", courthouse());
  s.set("struct:arsenal", arsenal());
  s.set("struct:penitentiary", penitentiary());
  const LANDMARKS: [string, () => Sprite][] = [
    ["hospital", hospital], ["library", library], ["college", college], ["tower", tower], ["museum", museum],
    ["conservatory", conservatory], ["ballpark", ballpark], ["stadium", stadium], ["arena", arena], ["terminal", terminal],
    ["chapel", chapel], ["school", school], ["theatre", theatre], ["observatory", observatory], ["zoo", zoo],
    ["amusement", amusement], ["airport", airport], ["plant", plant], ["office", office], ["housing", housing],
    ["fountain", fountain], ["factory", factory], ["shipyard", shipyard], ["planetarium", planetarium], ["church", church], ["hall", hall],
    ["skyscraper", skyscraper], ["skytower", skytower], ["glasstower", glasstower], ["lab", lab], ["reactor", reactor],
  ];
  for (const [k, f] of LANDMARKS) s.set(`struct:${k}`, f());
  for (let n = 1; n <= 4; n++) s.set(`struct:ruin${n}`, ruin(n));
  for (const o of ["a", "b"] as const) {
    s.set(`boat:steam:${o}`, steamboat(o, 0));
    for (let v = 0; v < BARGE_CARGO.length; v++) s.set(`boat:barge:${o}:${v}`, barge(o, v));
    s.set(`bridge:road:${o}`, bridgeDeck("road", o, 16));
    s.set(`bridge:rail:${o}`, bridgeDeck("rail", o, 18));
  }
  for (let v = 0; v < 3; v++) s.set(`wharf:${v}`, wharfGoods(v));
  for (let v = 0; v < 2; v++) s.set(`smoke:${v}`, smoke(v));
  for (let v = 0; v < 2; v++) s.set(`mine:${v}`, mine(v));
  s.set("incline:station", inclineStation());
  s.set("incline:car", inclineCar());
  s.set("park:bandstand", bandstand());
  s.set("lamp:gas", lamp("gas"));
  s.set("lamp:elec", lamp("elec"));
  return s;
}

// ---------------------------------------------------------------- scaled pixel buffers for the rasterizer

export interface SpriteBuf { w: number; h: number; ax: number; ay: number; px: Uint32Array; soft: boolean }

/**
 * Trim a sprite's canvas to what's drawn on it (houses are drawn on a tall canvas with room for hillside
 * foundations, and most are on flat ground): the anchor moves with the crop, so it draws in the same place.
 */
export function cropSprite(s: Sprite): Sprite {
  const { width: W, height: H } = s.canvas;
  const d = s.canvas.getContext("2d", { willReadFrequently: true })!.getImageData(0, 0, W, H).data;
  let x0 = W, y0 = H, x1 = -1, y1 = -1;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (d[(y * W + x) * 4 + 3]) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  if (x1 < 0) { x0 = y0 = 0; x1 = y1 = 0; }
  // keep the crop on an 8-pixel grid so scaled copies land on the same pixels as before
  x0 &= ~7; y0 &= ~7;
  const w = x1 - x0 + 1, h = y1 - y0 + 1;
  if (w * h > W * H * 0.85) return s; // not worth it
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  c.getContext("2d")!.drawImage(s.canvas, x0, y0, w, h, 0, 0, w, h);
  return { ...s, canvas: c, ax: s.ax - x0, ay: s.ay - y0 };
}

/** one scratch canvas for every rescale (a new canvas each time left thousands of detached elements to collect) */
let scratch: { c: HTMLCanvasElement; ctx: CanvasRenderingContext2D } | null = null;

export function scaleSprite(s: Sprite, scale: number): SpriteBuf {
  const w = Math.max(1, Math.round(s.canvas.width * scale));
  const h = Math.max(1, Math.round(s.canvas.height * scale));
  if (!scratch) { const c = document.createElement("canvas"); scratch = { c, ctx: c.getContext("2d", { willReadFrequently: true })! }; }
  const c = scratch.c, ctx = scratch.ctx;
  if (c.width < w || c.height < h) { c.width = Math.max(c.width, w); c.height = Math.max(c.height, h); }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, w, h);
  ctx.imageSmoothingEnabled = scale < 1;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(s.canvas, 0, 0, w, h);
  const d = ctx.getImageData(0, 0, w, h);
  if (!s.soft) for (let i = 3; i < d.data.length; i += 4) d.data[i] = d.data[i] >= 100 ? 255 : 0;
  return { w, h, ax: Math.round(s.ax * scale), ay: Math.round(s.ay * scale), px: new Uint32Array(d.data.buffer), soft: !!s.soft };
}
