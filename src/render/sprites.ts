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

export const CLAPBOARD = ["#d8d2bf", "#cdb586", "#a9aaa2", "#b98a6c", "#d6c7a0", "#9fb0a8"];
export const ROOFS = ["#5b4636", "#4b4a4f", "#6a3d30", "#57524a"];

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

function barge(o: "a" | "b", v: number): Sprite {
  const p = new Painter(1, 80);
  const b = o === "a" ? box(p, 0.0, 0.32, 1.0, 0.68, 4, { wall: "#4a3a2a", top: "#2a2826" }) : box(p, 0.32, 0.0, 0.68, 1.0, 4, { wall: "#4a3a2a", top: "#2a2826" });
  const [x, y] = p.P(0.5, 0.5, 4);
  blob(p, x, y - 2, 16, 4, ["#141416", "#26262a", "#3a3a40"], (k) => tileNoise(v, k, 5, 5));
  void b;
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

function lamp(kind: "gas" | "elec"): Sprite {
  const p = new Painter(1, 70);
  const [x, y] = p.P(0.12, 0.12);
  if (kind === "gas") { p.px(x, y - 12, "#1e1e22", 1, 12); p.px(x - 1, y - 15, "#e8d080", 3, 3); p.px(x - 1, y - 16, "#1e1e22", 3, 1); }
  else { p.px(x, y - 18, "#3a3a3e", 1, 18); p.px(x, y - 18, "#3a3a3e", 4, 1); p.px(x + 3, y - 17, "#f0f0d0", 2, 1); }
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
  for (const o of ["a", "b"] as const) {
    s.set(`boat:steam:${o}`, steamboat(o, 0));
    s.set(`boat:barge:${o}`, barge(o, 0));
    s.set(`bridge:road:${o}`, bridgeDeck("road", o, 16));
    s.set(`bridge:rail:${o}`, bridgeDeck("rail", o, 18));
  }
  for (let v = 0; v < 3; v++) s.set(`wharf:${v}`, wharfGoods(v));
  for (let v = 0; v < 2; v++) s.set(`smoke:${v}`, smoke(v));
  for (let v = 0; v < 2; v++) s.set(`mine:${v}`, mine(v));
  s.set("incline:station", inclineStation());
  s.set("incline:car", inclineCar());
  s.set("lamp:gas", lamp("gas"));
  s.set("lamp:elec", lamp("elec"));
  return s;
}

// ---------------------------------------------------------------- scaled pixel buffers for the rasterizer

export interface SpriteBuf { w: number; h: number; ax: number; ay: number; px: Uint32Array; soft: boolean }

export function scaleSprite(s: Sprite, scale: number): SpriteBuf {
  const w = Math.max(1, Math.round(s.canvas.width * scale));
  const h = Math.max(1, Math.round(s.canvas.height * scale));
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  const ctx = c.getContext("2d", { willReadFrequently: true })!;
  ctx.imageSmoothingEnabled = scale < 1;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(s.canvas, 0, 0, w, h);
  const d = ctx.getImageData(0, 0, w, h);
  if (!s.soft) for (let i = 3; i < d.data.length; i += 4) d.data[i] = d.data[i] >= 100 ? 255 : 0;
  return { w, h, ax: Math.round(s.ax * scale), ay: Math.round(s.ay * scale), px: new Uint32Array(d.data.buffer), soft: !!s.soft };
}
