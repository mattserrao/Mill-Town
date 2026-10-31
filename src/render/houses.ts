// Houses, terraces, shops and civic buildings, assembled from parts.
//
// A building is described by a spec (encoded as a string key so the sprite can be cached):
//   kind, sub-type, architectural style (from the year it was built), frontage axis and street side,
//   corner, variant, hillside lift/foundation, soot level, boarded-up.
// Terraces fill their tile edge to edge along the street so neighbouring tiles read as one row.

import { tileNoise } from "../core/rng";
import { box, type Box, chimney, cylinder, gable, lerp, Painter, type Pt, shade, type Sprite, tree, offset, blob } from "./sprites";

export type HouseKind = "cottage" | "house" | "mansion" | "company" | "shanty" | "row" | "boarding" | "shop" | "civic";

export interface HouseSpec {
  kind: HouseKind;
  sub: number;
  style: number;     // 0 Federal (<=1860) 1 Italianate/Second Empire 2 Queen Anne/foursquare 3 interwar 4 postwar
  o: "a" | "b";      // frontage runs along u (a) or v (b)
  front: "+" | "-";  // street on the + or - side across the frontage
  corner: number;    // 1 = this tile is a street corner (corner shop / end unit)
  v: number;         // variant 0..7
  g: [number, number, number, number]; // ground height (px) at corners T(0,0) R(1,0) B(1,1) L(0,1), relative to tile centre
  lift: number;      // derived: floor above tile-centre ground
  fnd: number;       // derived: foundation below the floor
  soot: number;      // 0..3
  boarded: number;   // 1 = abandoned
}

export function styleForYear(y: number): number {
  return y <= 1860 ? 0 : y <= 1890 ? 1 : y <= 1920 ? 2 : y <= 1945 ? 3 : 4;
}

export function houseKey(s: HouseSpec): string {
  return `H|${s.kind}|${s.sub}|${s.style}|${s.o}|${s.front}|${s.corner}|${s.v}|${s.g.join(",")}|${s.soot}|${s.boarded}`;
}

export function parseHouseKey(k: string): HouseSpec {
  const [, kind, sub, style, o, front, corner, v, g, soot, boarded] = k.split("|");
  const gg = g.split(",").map(Number) as [number, number, number, number];
  return { kind: kind as HouseKind, sub: +sub, style: +style, o: o as "a" | "b", front: front as "+" | "-", corner: +corner, v: +v, g: gg, lift: 0, fnd: 0, soot: +soot, boarded: +boarded };
}

// ---------------------------------------------------------------- palettes
const BRICK = ["#9a4a34", "#a65a3e", "#8c4433", "#b0674a", "#7e3e2e", "#a8604a"];
const CLAP_BY_STYLE = [
  ["#d8d2bf", "#cdb586", "#e0dccc", "#b98a6c"],          // federal: whitewash, ochre, oxblood
  ["#c9b48c", "#a9aaa2", "#d6c7a0", "#9fb0a8", "#b8a07a"], // italianate: stone tones
  ["#8a9a6a", "#b46a4a", "#d2b45a", "#6a8aa0", "#9a6a8a", "#c8c0a8"], // queen anne: painted ladies
  ["#c0a888", "#a89a80", "#d0c8b0", "#8a7a64"],          // interwar
  ["#bcd0d8", "#e0d8b8", "#c8d8b8", "#e8c8b0", "#d8d8d8"], // postwar pastels
];
const ROOF = ["#5b4636", "#4b4a4f", "#6a3d30", "#57524a", "#3e4248"];
const AWNING: [string, string][] = [["#b03a2e", "#e8e0d0"], ["#2e5a3a", "#e8e0d0"], ["#2e3e6a", "#e8d8a0"], ["#8a5a1a", "#f0e0b0"]];

type Rect = [number, number, number, number]; // u0 v0 u1 v1

/** Frontage geometry helper: along = position along the street, dist = distance back from the street. */
function frame(s: HouseSpec) {
  const rect = (a0: number, a1: number, d0: number, d1: number): Rect => {
    const c0 = s.front === "+" ? 1 - d1 : d0, c1 = s.front === "+" ? 1 - d0 : d1;
    return s.o === "a" ? [a0, c0, a1, c1] : [c0, a0, c1, a1];
  };
  // which visible face (left = +v, right = +u) faces the street, and which is the side wall
  const streetFace: "left" | "right" | null = s.front === "+" ? (s.o === "a" ? "left" : "right") : null;
  const backFace: "left" | "right" | null = s.front === "-" ? (s.o === "a" ? "left" : "right") : null;
  const sideFace: "left" | "right" = s.o === "a" ? "right" : "left";
  const ridge: "u" | "v" = s.o === "a" ? "u" : "v";   // side-gable: ridge parallel to the street
  const across: "u" | "v" = s.o === "a" ? "v" : "u";  // front-gable
  const pt = (p: Painter, along: number, dist: number, z: number): Pt => {
    const r = rect(along, along, dist, dist);
    return p.P(r[0], r[1], z);
  };
  return { rect, streetFace, backFace, sideFace, ridge, across, pt };
}

function rnd(s: HouseSpec, k: number) {
  return tileNoise(911 + s.v * 13 + s.style * 7, k, s.sub, 3);
}

/** Windows along a face of a box with style-specific trim. */
function facade(p: Painter, b: Box, face: "left" | "right", o: {
  n: number; stories: number; storyH: number; style: number; door?: number; boarded?: number;
  shutters?: string; tall?: boolean; shop?: [string, string] | null; lit?: boolean; dark?: string;
}) {
  const a = face === "left" ? b.D(b.z0) : b.C(b.z0);
  const c = face === "left" ? b.C(b.z0) : b.B(b.z0);
  const slope = face === "left" ? 0.5 : -0.5;
  const glass = o.boarded ? "#6a4a2a" : o.dark ?? (o.style >= 4 ? "#4a6a7a" : "#2b2a2e");
  const sill = o.boarded ? "#4a3220" : o.style === 2 ? "#efe6c8" : "#d8cfb4";
  for (let k = 0; k < o.n; k++) {
    const t = (k + 0.5) / o.n;
    const [x, y] = lerp(a, c, t);
    for (let st = 0; st < o.stories; st++) {
      const z = 3 + st * o.storyH;
      if (st === 0 && o.shop) continue;
      const wh = o.tall ? 4 : 3;
      p.px(x, y - z - wh, glass, 1, wh);
      p.px(x + 1, y - z - wh + slope, glass, 1, wh);
      if (o.boarded) p.px(x, y - z - wh + 1, "#8a6a40", 2, 1);
      p.px(x, y - z, sill, 2, 1);
      if (o.style === 1) p.px(x, y - z - wh - 1, shade(sill, 0.8), 2, 1); // hood mould
      if (o.shutters) p.px(x - 1, y - z - wh + 0.5, o.shutters, 1, wh);
    }
    if (o.door === k) {
      p.px(x, y - 6, o.boarded ? "#5a3a20" : "#4a3020", 2, 6);
      if (o.style === 0) p.px(x - 1, y - 8, "#e8e0c0", 4, 1); // fanlight
    }
  }
  if (o.shop) {
    const [x, y] = lerp(a, c, 0.5);
    const w = Math.max(5, Math.abs(c[0] - a[0]) - 4);
    p.px(x - w / 2, y - 7, o.boarded ? "#5a4028" : "#3d5a6a", w, 5);
    for (let k = 0; k < w; k += 2) p.px(x - w / 2 + k, y - 10 + (k * slope) / 2, k % 4 ? o.shop[1] : o.shop[0], 2, 3); // awning stripes
    p.px(x - w / 2, y - 13, "#c9a24a", w, 2); // sign board
  }
}

/** Bracketed cornice band along the top of a face (Italianate). */
function cornice(p: Painter, b: Box, face: "left" | "right", col: string) {
  const top = b.z0 + b.h;
  const a = face === "left" ? b.D(top) : b.C(top);
  const c = face === "left" ? b.C(top) : b.B(top);
  p.line([a[0], a[1] - 1], [c[0], c[1] - 1], col);
  p.line(a, c, shade(col, 0.7));
  const n = Math.max(2, Math.round(Math.abs(c[0] - a[0]) / 3));
  for (let k = 0; k <= n; k++) { const [x, y] = lerp(a, c, k / n); p.px(x, y + 1, shade(col, 0.6), 1, 1); }
}

/** Mansard roof: steep lower slope with dormers, flat top. */
function mansard(p: Painter, b: Box, rise: number, roof: string, inset = 0.08) {
  const top = b.z0 + b.h;
  const i = inset;
  const A = p.P(b.u0 + i, b.v0 + i, top + rise), B = p.P(b.u1 - i, b.v0 + i, top + rise);
  const C = p.P(b.u1 - i, b.v1 - i, top + rise), D = p.P(b.u0 + i, b.v1 - i, top + rise);
  p.poly([b.D(top), b.C(top), C, D], roof);
  p.poly([b.C(top), b.B(top), B, C], shade(roof, 0.75));
  p.poly([A, B, C, D], shade(roof, 0.9));
  // dormers on the lit slope
  const n = Math.max(1, Math.round((b.u1 - b.u0 + b.v1 - b.v0) * 3));
  for (let k = 0; k < n; k++) {
    const [x, y] = lerp(b.D(top + rise * 0.4), b.C(top + rise * 0.4), (k + 0.5) / n);
    p.px(x, y - 3, "#ece4cc", 2, 4);
    p.px(x, y - 2, "#2b2a2e", 2, 2);
  }
}

/** Hip roof (ridge along the longer side). */
function hip(p: Painter, b: Box, rise: number, roof: string) {
  const top = b.z0 + b.h;
  const um = (b.u0 + b.u1) / 2, vm = (b.v0 + b.v1) / 2;
  const du = (b.u1 - b.u0) / 2, dv = (b.v1 - b.v0) / 2;
  const A = b.A(top), B = b.B(top), C = b.C(top), D = b.D(top);
  if (du >= dv) {
    const r0 = p.P(b.u0 + dv, vm, top + rise), r1 = p.P(b.u1 - dv, vm, top + rise);
    p.poly([A, B, r1, r0], shade(roof, 0.8));
    p.poly([A, D, r0], shade(roof, 0.9));
    p.poly([D, C, r1, r0], roof);
    p.poly([B, C, r1], shade(roof, 0.72));
  } else {
    const r0 = p.P(um, b.v0 + du, top + rise), r1 = p.P(um, b.v1 - du, top + rise);
    p.poly([A, D, r1, r0], shade(roof, 0.9));
    p.poly([A, B, r0], shade(roof, 0.8));
    p.poly([B, C, r1, r0], shade(roof, 0.72));
    p.poly([D, C, r1], roof);
  }
}

/** Mono-pitch (shed) roof, high at the back. */
function shedRoof(p: Painter, b: Box, rise: number, roof: string) {
  const top = b.z0 + b.h;
  p.poly([b.D(top), b.C(top), b.B(top + rise), b.A(top + rise)], roof);
}

function stoop(p: Painter, at: Pt, h: number, col = "#9a9282") {
  for (let k = 0; k < Math.min(4, Math.ceil(h / 2) + 1); k++) p.px(at[0] - 1, at[1] - k * 2 + k, col, 3, 1);
}

// ---------------------------------------------------------------- hillside lots

/** Ground height (px) at a point of the tile, bilinear over the corner heights. */
export function gz(s: HouseSpec, u: number, v: number): number {
  const [t, r, b, l] = s.g;
  return (t * (1 - u) + r * u) * (1 - v) + (l * (1 - u) + b * u) * v;
}

export const TERRACE_PX = 9; // relief across a lot above which it's cut into a level terrace

const STONE = "#8e8474";

/**
 * Cut-and-fill terrace: a level platform at height F over the rect, with stone retaining walls where
 * the hill was cut away behind it and where fill was built up in front of it.
 */
export function terrace(p: Painter, s: HouseSpec, r: Rect, F: number, top: string) {
  const [u0, v0, u1, v1] = r;
  const gA = gz(s, u0, v0), gB = gz(s, u1, v0), gC = gz(s, u1, v1), gD = gz(s, u0, v1);
  const wall = (a: [number, number, number], b: [number, number, number], col: string) => {
    // a/b = [u, v, ground]; draw between ground and F on the side where they differ
    const za = a[2], zb = b[2];
    if (Math.abs(za - F) < 1 && Math.abs(zb - F) < 1) return;
    p.poly([p.P(a[0], a[1], F), p.P(b[0], b[1], F), p.P(b[0], b[1], zb), p.P(a[0], a[1], za)], col);
    const lo = Math.min(za, zb, F), hi = Math.max(za, zb, F);
    for (let z = Math.ceil(lo / 3) * 3; z < hi; z += 3) {
      const ta = (z - za) / (F - za || 1e-6), tb = (z - zb) / (F - zb || 1e-6);
      if (ta >= 0 && ta <= 1 && tb >= 0 && tb <= 1) p.line(p.P(a[0], a[1], z), p.P(b[0], b[1], z), shade(col, 0.85));
    }
  };
  // cut walls at the back (only where the hill rises above the platform)
  if (gA > F || gB > F) wall([u0, v0, Math.max(gA, F)], [u1, v0, Math.max(gB, F)], STONE);
  if (gA > F || gD > F) wall([u0, v0, Math.max(gA, F)], [u0, v1, Math.max(gD, F)], shade(STONE, 0.78));
  // platform
  p.poly([p.P(u0, v0, F), p.P(u1, v0, F), p.P(u1, v1, F), p.P(u0, v1, F)], top);
  // fill walls at the front (where the ground falls away below the platform)
  if (gD < F || gC < F) wall([u0, v1, Math.min(gD, F)], [u1, v1, Math.min(gC, F)], STONE);
  if (gC < F || gB < F) wall([u1, v1, Math.min(gC, F)], [u1, v0, Math.min(gB, F)], shade(STONE, 0.74));
  // coping stones along the front edges
  p.line(p.P(u0, v1, F), p.P(u1, v1, F), "#b8b0a0");
  p.line(p.P(u1, v1, F), p.P(u1, v0, F), "#9a9282");
}

const YARD_TOP = ["#6e8e40", "#7a8a52", "#6a7a48"];

/** Decide floor and foundation for a whole lot; cut a terrace when the lot is steep. */
function prepareLot(p: Painter, s: HouseSpec): HouseSpec {
  const relief = Math.max(...s.g) - Math.min(...s.g);
  if (relief >= TERRACE_PX && s.kind !== "row" && s.kind !== "civic") {
    const F = Math.round(gz(s, 0.5, 0.5) / 3) * 3;
    terrace(p, s, [0.02, 0.02, 0.98, 0.98], F, YARD_TOP[s.v % 3]);
    return { ...s, lift: F, fnd: 2 };
  }
  const hi = Math.max(...s.g), lo = Math.min(...s.g);
  const lift = Math.round(hi / 3) * 3;
  return { ...s, lift, fnd: lift - lo + 2 };
}

// ---------------------------------------------------------------- yard life
function yard(p0: Painter, s: HouseSpec, f: ReturnType<typeof frame>, a0: number, a1: number, d0: number, d1: number) {
  const r = (k: number) => rnd(s, 100 + k);
  const p = lifted(p0, s.lift > 0 && Math.max(...s.g) - Math.min(...s.g) >= TERRACE_PX ? s.lift : 0);
  // fence along the yard's back/side
  if (s.style <= 3 && r(1) < 0.75) {
    const col = s.kind === "mansion" ? "#2a2a2e" : s.style === 2 && r(2) < 0.5 ? "#efe9da" : "#8a7656";
    for (let t = a0; t <= a1; t += 0.06) { const q = f.pt(p, t, d1, 0); p.px(q[0], q[1] - 3, col, 1, 3); }
    const q0 = f.pt(p, a0, d1, 2), q1 = f.pt(p, a1, d1, 2);
    p.line(q0, q1, col);
  }
  // outhouse (before indoor plumbing)
  if (s.style <= 2 && r(3) < 0.7) {
    const [u0, v0, u1, v1] = f.rect(a1 - 0.12, a1 - 0.04, d1 - 0.1, d1 - 0.02);
    const b = box(p, u0, v0, u1, v1, 7, { wall: "#8a6e4e" });
    shedRoof(p, b, 2, "#5a4a3a");
  }
  // laundry line with washing
  if (r(4) < 0.6) {
    const q0 = f.pt(p, a0 + 0.08, (d0 + d1) / 2, 7), q1 = f.pt(p, a0 + 0.45, (d0 + d1) / 2, 7);
    p.px(q0[0], q0[1], "#6a5a4a", 1, 7); p.px(q1[0], q1[1], "#6a5a4a", 1, 7);
    p.line(q0, q1, "#cfc8b8");
    const cols = ["#e8e4dc", "#c84a3a", "#4a6aa0", "#e8d070", "#f0f0f0"];
    for (let k = 1; k < 5; k++) { const [x, y] = lerp(q0, q1, k / 5); p.px(x, y + 1, cols[(k + s.v) % cols.length], 2, 3); }
  }
  // vegetable garden
  if (r(5) < 0.5) {
    for (let k = 0; k < 4; k++) {
      const q0 = f.pt(p, a0 + 0.5 + k * 0.06, d0 + 0.05, 0), q1 = f.pt(p, a0 + 0.5 + k * 0.06, d1 - 0.08, 0);
      p.line(q0, q1, k % 2 ? "#4e7a2e" : "#6a4a30");
    }
  }
  // coal shed / ash pile
  if (r(6) < 0.35) {
    const [u0, v0, u1, v1] = f.rect(a0 + 0.02, a0 + 0.12, d1 - 0.12, d1 - 0.03);
    shedRoof(p, box(p, u0, v0, u1, v1, 5, { wall: "#5a4a3c" }), 2, "#3a3430");
  }
  if (r(7) < 0.3) { const t = tree(r(8) < 0.5 ? "maple" : "oak", s.v); p.ctx.drawImage(t.canvas, ...offsetAt(p, t, f.rect(a0 + 0.25, a0 + 0.25, d1 - 0.15, d1 - 0.15))); }
}

/** A view of the painter with every point raised by z (yard items on a terrace). */
function lifted(p: Painter, z: number): Painter {
  if (!z) return p;
  const q = Object.create(p) as Painter;
  q.P = (u: number, v: number, zz = 0) => p.P(u, v, zz + z);
  return q;
}

function offsetAt(p: Painter, t: Sprite, r: Rect): [number, number] {
  return offset(p, t, r[0], r[1]);
}

// ---------------------------------------------------------------- building types

function wallFor(s: HouseSpec, k = 0): string {
  const pal = CLAP_BY_STYLE[s.style];
  return pal[(s.v + k) % pal.length];
}

function detachedHouse(p: Painter, s: HouseSpec, a0: number, a1: number, z0: number, fnd: number, k = 0) {
  const f = frame(s);
  const st = s.style;
  const brick = st === 0 && rnd(s, 10 + k) < 0.35;
  const wall = brick ? BRICK[(s.v + k) % BRICK.length] : wallFor(s, k);
  const roof = ROOF[(s.v + k) % ROOF.length];
  const depth = st === 4 ? 0.34 : 0.4;
  const d0 = 0.12;
  const stories = st === 4 ? 1 : st === 3 ? (rnd(s, 11 + k) < 0.6 ? 1 : 2) : 2;
  const h = stories * 9 + 2;
  const [u0, v0, u1, v1] = f.rect(a0, a1, d0, d0 + depth);
  const b = box(p, u0, v0, u1, v1, h, { wall, z0, foundation: fnd, fnd: "#8a8070" });
  const sf = f.streetFace;
  if (st === 0) { gable(p, b, f.ridge, 7, roof); chimney(p, u0 + 0.03, (v0 + v1) / 2, z0 + h, 9, brick ? "#7a3a2a" : "#8a4a36"); chimney(p, u1 - 0.03, (v0 + v1) / 2, z0 + h, 9); }
  else if (st === 1) { hip(p, b, 4, roof); if (sf) cornice(p, b, sf, "#5a4a3a"); }
  else if (st === 2) { hip(p, b, 9, roof); const g = box(p, ...f.rect(a0 + (a1 - a0) * 0.55, a1, d0, d0 + 0.12), 4, { wall, z0: z0 + h }); gable(p, g, f.across, 5, roof); }
  else if (st === 3) { gable(p, b, f.across, 6, roof); }
  else { hip(p, b, 3, shade(roof, 1.2)); }
  const shutters = st === 0 && !brick ? (rnd(s, 12 + k) < 0.5 ? "#3e5a3a" : "#3a4a5e") : undefined;
  const n = Math.max(2, Math.round((a1 - a0) * 7));
  if (sf) facade(p, b, sf, { n, stories, storyH: 9, style: st, door: Math.floor(n / 2), boarded: s.boarded, shutters, tall: st === 1 });
  else if (f.backFace) facade(p, b, f.backFace, { n: Math.max(1, n - 1), stories, storyH: 9, style: st, boarded: s.boarded });
  facade(p, b, f.sideFace, { n: 2, stories, storyH: 9, style: st, boarded: s.boarded, shutters });
  // porches
  if (sf && st >= 2 && !s.boarded) {
    // open porch: deck, posts, roof
    const deck = box(p, ...f.rect(a0 - 0.02, a1 + (st === 2 ? 0.02 : 0), d0 - 0.1, d0), 1, { wall: "#8a7a62", top: "#a08a6a", z0, foundation: fnd });
    for (let t = 0; t <= 1; t += 0.25) { const [x, y] = lerp(deck.D(z0), deck.C(z0), t); p.px(x, y - 8, "#efe9da", 1, 8); }
    box(p, ...f.rect(a0 - 0.03, a1 + (st === 2 ? 0.03 : 0.01), d0 - 0.11, d0), 1, { wall: shade(roof, 0.9), top: shade(roof, 1.15), z0: z0 + 8 });
  }
  if (st === 4) { // carport/driveway
    const dr = f.rect(a1 + 0.02, a1 + 0.14, 0, d0 + depth);
    p.poly([p.P(dr[0], dr[1]), p.P(dr[2], dr[1]), p.P(dr[2], dr[3]), p.P(dr[0], dr[3])], "#8a8680");
  }
  // steps up a hillside lot
  if (sf && z0 > 4) { const q = f.pt(p, (a0 + a1) / 2, d0 - 0.04, 0); stoop(p, q, z0, "#8a7656"); }
  return b;
}

function houseSprite(s0: HouseSpec): Sprite {
  const p = new Painter(1, s0.kind === "shop" && s0.sub === 8 ? 340 : 190);
  if (s0.kind === "row") return rowSprite(s0, p);
  const s = prepareLot(p, s0);
  const f = frame(s);
  const z0 = s.lift, fnd = s.fnd;
  switch (s.kind) {
    case "house": {
      yard(p, s, f, 0.05, 0.95, 0.6, 0.97);
      if (s.style >= 2 && rnd(s, 1) < 0.4) detachedHouse(p, s, 0.12, 0.88, z0, fnd);
      else { detachedHouse(p, s, 0.05, 0.45, z0, fnd, 0); detachedHouse(p, s, 0.55, 0.95, z0, fnd, 1); }
      break;
    }
    case "cottage": {
      yard(p, s, f, 0.1, 0.9, 0.6, 0.95);
      if (s.style === 0 && rnd(s, 2) < 0.5) logCabin(p, s, z0, fnd);
      else detachedHouse(p, { ...s, style: Math.max(s.style, 0) }, 0.25, 0.65, z0, fnd);
      break;
    }
    case "company": {
      // identical double houses, two families each, in company colours
      const wall = ["#8a8478", "#9a7a5a", "#7a5a48"][s.v % 3];
      for (const [a0, a1] of [[0.04, 0.46], [0.54, 0.96]]) {
        const [u0, v0, u1, v1] = f.rect(a0, a1, 0.14, 0.52);
        const b = box(p, u0, v0, u1, v1, 18, { wall, z0, foundation: fnd, fnd: "#6a6258" });
        gable(p, b, f.ridge, 6, "#3e3a38");
        chimney(p, (u0 + u1) / 2, (v0 + v1) / 2, z0 + 18, 7, "#6a4a3a");
        if (f.streetFace) facade(p, b, f.streetFace, { n: 4, stories: 2, storyH: 9, style: 0, door: 1, boarded: s.boarded });
        else if (f.backFace) facade(p, b, f.backFace, { n: 2, stories: 2, storyH: 9, style: 0, boarded: s.boarded });
        if (f.streetFace) { const q = f.pt(p, a0 + (a1 - a0) * 0.75, 0.12, 0); p.px(q[0], q[1] - 6, "#4a3020", 2, 6); }
        // privy behind each
        const [pu0, pv0, pu1, pv1] = f.rect(a1 - 0.08, a1 - 0.01, 0.84, 0.92);
        shedRoof(p, box(p, pu0, pv0, pu1, pv1, 6, { wall: "#7a6a54" }), 2, "#4a4038");
      }
      break;
    }
    case "shanty": {
      const cols = ["#7a7268", "#6a5e50", "#8a7a64", "#5a5650"];
      const spots: [number, number, number, number][] = [[0.06, 0.34, 0.1, 0.38], [0.42, 0.7, 0.18, 0.44], [0.72, 0.94, 0.5, 0.74], [0.12, 0.36, 0.6, 0.82]];
      spots.forEach(([a0, a1, d0, d1], k) => {
        if (k === 3 && rnd(s, 3) < 0.5) return;
        const [u0, v0, u1, v1] = f.rect(a0, a1, d0, d1);
        const b = box(p, u0, v0, u1, v1, 6 + (k % 2), { wall: cols[(s.v + k) % 4], z0: Math.round(z0 * 0.6), foundation: fnd });
        shedRoof(p, b, 2, k % 2 ? "#2e2c2a" : "#4a4440");
        const [x, y] = lerp(b.D(b.z0), b.C(b.z0), 0.4);
        p.px(x, y - 4, s.boarded ? "#5a3a20" : "#1e1c1c", 2, 4);
        for (let j = 0; j < 4; j++) p.px(...lerp(b.D(b.z0), b.C(b.z0), 0.15 + j * 0.2), shade(cols[k % 4], 0.8), 1, 6); // board seams
      });
      // junk, mud, a goat-pen fence
      for (let k = 0; k < 6; k++) { const q = f.pt(p, 0.1 + rnd(s, 20 + k) * 0.8, 0.5 + rnd(s, 30 + k) * 0.45, 0); p.px(q[0], q[1] - 1, ["#4a3a2a", "#6a6a6a", "#3a3a3a"][k % 3], 2, 1); }
      for (let t = 0.5; t <= 0.95; t += 0.07) { const q = f.pt(p, 0.6, t, 0); p.px(q[0], q[1] - 2, "#5a4a3a", 1, 2); }
      break;
    }
    case "mansion": {
      // lawn with hedges and an iron fence, carriage house behind
      for (let t = 0.04; t <= 0.96; t += 0.04) { const q = f.pt(p, t, 0.03, 0); p.px(q[0], q[1] - 3, "#2a2a2e", 1, 3); }
      const hedge = (a0: number, a1: number, d: number) => { for (let t = a0; t <= a1; t += 0.03) { const q = f.pt(p, t, d, 0); p.px(q[0] - 1, q[1] - 3, "#2e5a2a", 3, 3); } };
      hedge(0.05, 0.3, 0.12); hedge(0.7, 0.95, 0.12);
      const [cu0, cv0, cu1, cv1] = f.rect(0.7, 0.95, 0.72, 0.95);
      gable(p, box(p, cu0, cv0, cu1, cv1, 11, { wall: "#b8a888", z0, foundation: fnd }), f.ridge, 5, "#4a4a50");
      const st = s.style;
      const wall = st === 0 ? BRICK[s.v % BRICK.length] : st === 1 ? "#c8bea4" : st === 2 ? ["#8a6a5a", "#a87a5a", "#7a8a6a"][s.v % 3] : "#d0c8b4";
      const [u0, v0, u1, v1] = f.rect(0.18, 0.82, 0.24, 0.66);
      const b = box(p, u0, v0, u1, v1, 28, { wall, z0, foundation: fnd + 2, fnd: "#8a8070" });
      if (st === 0) { hip(p, b, 8, "#4a4a50"); chimney(p, u0 + 0.05, v0 + 0.05, z0 + 28, 10); chimney(p, u1 - 0.05, v1 - 0.05, z0 + 28, 10); }
      else if (st === 1) mansard(p, b, 9, "#4a5058");
      else if (st === 2) { hip(p, b, 10, "#5a3e34"); cylinder(p, (u1 + u0) / 2 + (s.o === "a" ? 0.25 : 0), (v0 + v1) / 2 + (s.o === "b" ? 0.25 : 0), 0.09, z0, 36, wall, "#4a3e34"); }
      else hip(p, b, 6, "#3e4248");
      const sf = f.streetFace ?? f.backFace!;
      facade(p, b, sf, { n: 5, stories: 3, storyH: 9, style: st, door: f.streetFace ? 2 : undefined, boarded: s.boarded, shutters: st === 0 ? "#1e2a1e" : undefined, tall: true });
      facade(p, b, f.sideFace, { n: 3, stories: 3, storyH: 9, style: st, boarded: s.boarded, tall: true });
      if (f.streetFace) {
        // portico
        const r = f.rect(0.4, 0.6, 0.12, 0.24);
        const base = box(p, ...r, 2, { wall: "#c8c0a8", top: "#d8d0bc", z0 });
        for (let t = 0; t <= 1; t += 0.33) { const [x, y] = lerp(base.D(z0), base.C(z0), t); p.px(x, y - 20, "#f4f0e6", 1, 20); }
        const roofb = box(p, ...r, 2, { wall: "#e8e2d0", z0: z0 + 20 });
        gable(p, roofb, f.across, 5, "#8a8a84", "#f0ece0");
      }
      break;
    }
    case "boarding": {
      const brick = BRICK[(s.v + 2) % BRICK.length];
      const [u0, v0, u1, v1] = f.rect(0.02, 0.98, 0.04, 0.5);
      const b = box(p, u0, v0, u1, v1, 36, { wall: brick, z0, foundation: fnd, top: "#3a3432" });
      cornice(p, b, f.sideFace, "#4a3a32");
      const face = f.streetFace ?? f.backFace!;
      facade(p, b, face, { n: 8, stories: 4, storyH: 8, style: 1, door: 3, boarded: s.boarded });
      cornice(p, b, face, "#4a3a32");
      facade(p, b, f.sideFace, { n: 3, stories: 4, storyH: 8, style: 1, boarded: s.boarded });
      for (const t of [0.2, 0.5, 0.8]) chimney(p, ...(f.rect(t, t, 0.27, 0.27).slice(0, 2) as [number, number]), z0 + 36, 6);
      yard(p, { ...s, v: s.v + 3 }, f, 0.05, 0.95, 0.56, 0.97);
      break;
    }
    case "shop": return shopSprite(s, p);
    case "civic": return civicSprite(s0);
  }
  return finish(p, s);
}

function logCabin(p: Painter, s: HouseSpec, z0: number, fnd: number) {
  const log = ["#7a5a3c", "#8a6a48", "#6e5236"][s.v % 3];
  const f = frame(s);
  const [u0, v0, u1, v1] = f.rect(0.3, 0.66, 0.2, 0.48);
  const b = box(p, u0, v0, u1, v1, 10, { wall: log, z0, foundation: fnd });
  for (let z = 2; z < 10; z += 2) p.line(b.D(z0 + z), b.C(z0 + z), shade(log, 0.8));
  gable(p, b, f.ridge, 6, "#5a4a3a");
  chimney(p, u1 - 0.02, (v0 + v1) / 2, z0 + 4, 12, "#8d867a");
  if (f.streetFace) facade(p, b, f.streetFace, { n: 2, stories: 1, storyH: 9, style: 0, door: 0, boarded: s.boarded });
}

/**
 * Rowhouse terrace: 4-5 attached units filling the tile edge to edge along the street.
 * On a hillside each unit steps down the slope on its own level, with stone foundations and
 * retaining walls between the steps; back yards are cut into level terraces behind.
 */
function rowSprite(s: HouseSpec, p: Painter): Sprite {
  const f = frame(s);
  const st = s.style;
  // 3-5 units; some blocks end short with a side alley or garden
  const n = 3 + Math.floor(rnd(s, 1) * 3);
  const span = !s.corner && rnd(s, 2) < 0.3 ? 0.78 : 1;
  const blockBrick = BRICK[Math.floor(rnd(s, 3) * BRICK.length)];
  const depth = 0.36 + rnd(s, 4) * 0.12;
  const back = f.backFace !== null;
  const relief = Math.max(...s.g) - Math.min(...s.g);
  const steep = relief >= TERRACE_PX;
  const q3 = (z: number) => Math.round(z / 3) * 3;
  const unitFloor = (a0: number, a1: number) => {
    const r = f.rect(a0, a1, 0.02, depth);
    const cs = [gz(s, r[0], r[1]), gz(s, r[2], r[1]), gz(s, r[2], r[3]), gz(s, r[0], r[3])];
    const fl = steep ? q3(gz(s, (r[0] + r[2]) / 2, (r[1] + r[3]) / 2)) : q3(Math.max(...cs));
    return { fl, lo: Math.min(...cs), r };
  };
  const drawYard = () => {
    const yr = f.rect(0.02, 0.98, depth + 0.04, 0.98);
    let ys = s;
    if (steep) {
      const F = q3(gz(s, (yr[0] + yr[2]) / 2, (yr[1] + yr[3]) / 2));
      terrace(p, s, yr, F, YARD_TOP[s.v % 3]);
      ys = { ...s, lift: F };
    }
    yard(p, ys, f, 0.02, 0.98, depth + 0.06, 0.98);
  };
  // the yard is behind the row when the street is in front, in front of it when the street is behind
  if (!back) drawYard();
  for (let k = 0; k < n; k++) {
    const a0 = (k / n) * span, a1 = ((k + 1) / n) * span;
    const { fl, lo, r } = unitFloor(a0, a1);
    if (steep) terrace(p, s, f.rect(a0, a1, -0.01, depth + 0.03), fl, "#7a7064");
    const stories = Math.min(4, (st === 0 ? 2 : st === 1 ? 3 : st === 2 ? 3 : 2) + (rnd(s, 40 + k) < 0.2 ? 1 : 0) - (rnd(s, 50 + k) < 0.15 ? 1 : 0));
    const h = stories * 9 + 2;
    const brick = rnd(s, 60 + k) < 0.75 ? blockBrick : BRICK[Math.floor(rnd(s, 61 + k) * BRICK.length)];
    const wall = st === 2 && rnd(s, 70 + k) < 0.3 ? CLAP_BY_STYLE[2][(s.v + k) % 6] : brick;
    const b = box(p, r[0], r[1], r[2], r[3], h, { wall, z0: fl, foundation: Math.max(2, fl - lo + 2), fnd: "#8a8070" });
    const roof = ROOF[(s.v + k) % ROOF.length];
    const top = fl + h;
    if (st === 0) { gable(p, b, f.ridge, 6, roof, undefined, steep || k === n - 1); if (rnd(s, 80 + k) < 0.5) dormer(p, f, (a0 + a1) / 2, 0.15, top + 1); }
    else if (st === 1) { if (rnd(s, 81 + k) < 0.35) mansard(p, b, 6, "#4a5058", 0.04); else p.poly([b.A(top), b.B(top), b.C(top), b.D(top)], "#3a3432"); }
    else p.poly([b.A(top), b.B(top), b.C(top), b.D(top)], "#3a3432");
    if (st >= 1 && f.streetFace) cornice(p, b, f.streetFace, st === 2 ? "#e0d8c4" : "#4a3a32");
    { const m = (a0 + a1) / 2; const rr = f.rect(m, m, 0.3, 0.3); chimney(p, rr[0], rr[1], top, 5); }
    const shop = s.corner && k === n - 1 && f.streetFace ? AWNING[s.v % 4] : null;
    if (f.streetFace) {
      facade(p, b, f.streetFace, { n: 2, stories, storyH: 9, style: st, door: shop ? undefined : 0, boarded: s.boarded, shop, tall: st >= 1 });
      if (!shop) stoop(p, f.pt(p, a0 + (a1 - a0) * 0.25, 0.0, Math.min(fl, gz(s, ...(f.rect(a0, a0, 0, 0).slice(0, 2) as [number, number])))), Math.max(2, fl - lo + 2));
      if (st === 2 && rnd(s, 90 + k) < 0.7) box(p, ...f.rect(a0 + (a1 - a0) * 0.45, a0 + (a1 - a0) * 0.9, -0.05, 0.02), 16, { wall, z0: fl + 6 });
      if (st === 3) {
        const pr = box(p, ...f.rect(a0 + 0.01, a1 - 0.01, -0.08, 0.02), 8, { wall: "#c8c0b0", top: shade(roof, 1.15), z0: fl });
        for (const t of [0.1, 0.9]) { const [x, y] = lerp(pr.D(fl), pr.C(fl), t); p.px(x, y - 8, "#e8e0d0", 1, 8); }
      }
    } else if (back) {
      facade(p, b, f.backFace!, { n: 2, stories, storyH: 9, style: st, boarded: s.boarded });
      const ell = box(p, ...f.rect(a0 + 0.02, a0 + (a1 - a0) * 0.55, depth, depth + 0.12), 9, { wall: shade(brick, 0.95), z0: fl, foundation: Math.max(2, fl - lo + 2) });
      shedRoof(p, ell, 2, "#3e3a38");
    }
    if (k === n - 1 || steep || rnd(s, 95 + k) < 0.3) facade(p, b, f.sideFace, { n: 1, stories, storyH: 9, style: st, boarded: s.boarded });
    // painted advertisement on the end wall
    if (k === n - 1 && span < 1 && stories >= 3 && rnd(s, 99) < 0.5) {
      const a = f.sideFace === "left" ? b.D(fl + 14) : b.C(fl + 14), c = f.sideFace === "left" ? b.C(fl + 14) : b.B(fl + 14);
      p.poly([a, c, [c[0], c[1] - 8], [a[0], a[1] - 8]], ["#d8c890", "#c8d0d8", "#e0b8a0"][s.v % 3]);
      p.line([a[0] + 1, a[1] - 5], [c[0] - 1, c[1] - 5], "#5a2a24");
    }
  }
  if (back) drawYard();
  if (f.streetFace && st <= 2) { const q = f.pt(p, 0.02, -0.02, gz(s, 0.02, 0.98)); p.px(q[0], q[1] - 9, "#2a2a2a", 1, 9); p.px(q[0] - 1, q[1] - 11, "#e8d080", 3, 2); }
  return finish(p, s);
}

function dormer(p: Painter, f: ReturnType<typeof frame>, along: number, dist: number, z: number) {
  const q = f.pt(p, along, dist, z);
  p.px(q[0] - 1, q[1] - 4, "#e0d8c4", 3, 4);
  p.px(q[0], q[1] - 3, "#2b2a2e", 1, 2);
  p.px(q[0] - 2, q[1] - 5, "#4a4a50", 5, 1);
}

function shopSprite(s: HouseSpec, p: Painter): Sprite {
  const f = frame(s);
  const st = s.style;
  const z0 = s.lift;
  const face = f.streetFace ?? f.backFace!;
  switch (s.sub) {
    case 1: { // tavern
      const [u0, v0, u1, v1] = f.rect(0.08, 0.92, 0.04, 0.5);
      const b = box(p, u0, v0, u1, v1, 20, { wall: st === 0 ? "#b8a07a" : BRICK[s.v % 6], z0, foundation: s.fnd });
      gable(p, b, f.ridge, 7, ROOF[s.v % 5]);
      facade(p, b, face, { n: 4, stories: 2, storyH: 9, style: st, door: 1, boarded: s.boarded, shutters: st === 0 ? "#2e3a2e" : undefined });
      const q = f.pt(p, 0.92, -0.02, 0);
      p.px(q[0], q[1] - 16, "#3a2a1a", 1, 16); p.px(q[0] - 4, q[1] - 16, "#c9a24a", 5, 4); // hanging sign
      for (let k = 0; k < 3; k++) { const r = f.rect(0.15 + k * 0.08, 0.15 + k * 0.08, -0.04, -0.04); cylinder(p, r[0], r[1], 0.035, 0, 5, "#7a5a3a", "#5a4028"); }
      break;
    }
    case 2: { // store
      const [u0, v0, u1, v1] = f.rect(0.04, 0.96, 0.04, 0.5);
      const b = box(p, u0, v0, u1, v1, 22, { wall: st === 0 ? CLAP_BY_STYLE[0][s.v % 4] : BRICK[(s.v + 1) % 6], z0, foundation: s.fnd });
      p.poly([b.A(z0 + 22), b.B(z0 + 22), b.C(z0 + 22), b.D(z0 + 22)], "#3a3432");
      // false front parapet
      if (f.streetFace) { const pa = f.streetFace === "left" ? [b.D(z0 + 22), b.C(z0 + 22)] : [b.C(z0 + 22), b.B(z0 + 22)]; p.poly([pa[0], pa[1], [pa[1][0], pa[1][1] - 5], [pa[0][0], pa[0][1] - 5]], shade(BRICK[(s.v + 1) % 6], 1.05)); }
      facade(p, b, face, { n: 3, stories: 2, storyH: 10, style: st, boarded: s.boarded, shop: AWNING[s.v % 4] });
      for (let k = 0; k < 3; k++) box(p, ...f.rect(0.12 + k * 0.1, 0.19 + k * 0.1, -0.06, 0.0), 3, { wall: "#9a7a4a", top: "#b8965e" });
      break;
    }
    case 3: { // hotel
      const stories = st >= 1 ? 5 : 4;
      const [u0, v0, u1, v1] = f.rect(0.02, 0.98, 0.02, 0.6);
      const b = box(p, u0, v0, u1, v1, stories * 9 + 3, { wall: st >= 2 ? "#c8b898" : BRICK[(s.v + 3) % 6], z0, foundation: s.fnd, top: "#3a3432" });
      cornice(p, b, face, "#5a4a3a"); cornice(p, b, f.sideFace, "#5a4a3a");
      facade(p, b, face, { n: 7, stories, storyH: 9, style: Math.max(1, st), door: 3, boarded: s.boarded, tall: true });
      facade(p, b, f.sideFace, { n: 4, stories, storyH: 9, style: Math.max(1, st), boarded: s.boarded, tall: true });
      const [x, y] = lerp(face === "left" ? b.D(z0 + stories * 9) : b.C(z0 + stories * 9), face === "left" ? b.C(z0 + stories * 9) : b.B(z0 + stories * 9), 0.5);
      p.px(x - 6, y - 6, "#e8d8a0", 12, 3); p.px(x - 5, y - 5, "#5a2a24", 10, 1); // HOTEL sign
      break;
    }
    case 4: { // bank: classical stone with columns and pediment
      const [u0, v0, u1, v1] = f.rect(0.1, 0.9, 0.12, 0.62);
      const b = box(p, u0, v0, u1, v1, 26, { wall: "#d4ccb4", z0, foundation: s.fnd + 3, fnd: "#b8b098" });
      gable(p, b, f.across, 6, "#8a8a84", "#e8e2d0");
      if (f.streetFace) {
        const a = f.streetFace === "left" ? b.D(z0) : b.C(z0), c = f.streetFace === "left" ? b.C(z0) : b.B(z0);
        for (let k = 0; k < 6; k++) { const [x, y] = lerp(a, c, (k + 0.5) / 6); p.px(x, y - 24, "#f0ece0", 2, 24); p.px(x + 1, y - 24, "#c8c0a8", 1, 24); }
        p.line([a[0], a[1] - 26], [c[0], c[1] - 26], "#b8b098");
      }
      facade(p, b, f.sideFace, { n: 3, stories: 2, storyH: 11, style: 1, tall: true, boarded: s.boarded });
      break;
    }
    case 6: { // riverfront warehouse: tall plain brick, loading doors stacked, hoist beam, painted name
      const [u0, v0, u1, v1] = f.rect(0.02, 0.98, 0.02, 0.8);
      const stories = 4 + (s.v % 2);
      const H = stories * 9 + 2;
      const brick = BRICK[(s.v + 4) % 6];
      const b = box(p, u0, v0, u1, v1, H, { wall: brick, z0, foundation: s.fnd, fnd: "#7a7064" });
      gable(p, b, f.across, 6, "#3e3a38");
      for (const fc of [face, f.sideFace]) facade(p, b, fc, { n: 5, stories, storyH: 9, style: 0, boarded: s.boarded, dark: "#3a2a22" });
      const a = face === "left" ? b.D(z0) : b.C(z0), c = face === "left" ? b.C(z0) : b.B(z0);
      const [x, y] = lerp(a, c, 0.5);
      for (let k = 0; k < stories; k++) p.px(x - 2, y - 7 - k * 9, s.boarded ? "#5a4028" : "#5a3a24", 4, 6);
      p.px(x - 1, y - H - 3, "#3a2a1a", 2, 3); p.line([x, y - H], [x, y - H + 10], "#2a2a2a");
      const [sx, sy] = lerp(a, c, 0.25); p.px(sx - 6, sy - H + 4, "#e8e0c8", 12, 3);
      for (let k = 0; k < 3; k++) box(p, ...f.rect(0.1 + k * 0.12, 0.18 + k * 0.12, -0.08, -0.01), 4, { wall: "#9a7a4a", top: "#b8965e", z0 });
      break;
    }
    case 7: { // commercial block: cast-iron storefronts, 3-4 storeys, bracketed cornice
      const [u0, v0, u1, v1] = f.rect(0.0, 1.0, 0.02, 0.6);
      const stories = 3 + (s.v % 2) + (st >= 2 ? 1 : 0);
      const H = stories * 9 + 3;
      const wall = st >= 2 ? ["#c8b898", "#b8a888", "#d0c4a8"][s.v % 3] : BRICK[(s.v + 2) % 6];
      const b = box(p, u0, v0, u1, v1, H, { wall, z0, foundation: s.fnd, top: "#3a3432" });
      cornice(p, b, face, st >= 2 ? "#a89878" : "#4a3a32");
      cornice(p, b, f.sideFace, st >= 2 ? "#a89878" : "#4a3a32");
      facade(p, b, face, { n: 6, stories, storyH: 9, style: Math.max(1, st), boarded: s.boarded, shop: AWNING[s.v % 4], tall: true });
      facade(p, b, f.sideFace, { n: 3, stories, storyH: 9, style: Math.max(1, st), boarded: s.boarded, tall: true });
      const a = face === "left" ? b.D(z0) : b.C(z0), c = face === "left" ? b.C(z0) : b.B(z0);
      for (let k = 0; k <= 6; k++) { const [x, y] = lerp(a, c, k / 6); p.px(x, y - 9, "#2e3a3e", 1, 9); } // iron pilasters
      for (const t of [0.2, 0.75]) { const [x, y] = lerp(a, c, t); p.px(x - 3, y - 12, "#3d5a6a", 7, 5); }
      break;
    }
    case 8: { // office building: height and style by era
      const tier = st <= 1 ? 0 : st === 2 ? 1 : st === 3 ? 2 : 3;
      const stories = [8, 14, 24, 20][tier] + (s.v % 3) * [1, 2, 3, 2][tier];
      const H = stories * 8;
      const fl = s.fnd;
      if (tier === 0) { // Romanesque: rough stone base, brick shaft, hip roof with turret
        const [u0, v0, u1, v1] = f.rect(0.04, 0.96, 0.04, 0.9);
        const base = box(p, u0, v0, u1, v1, 16, { wall: "#9a7a62", z0, foundation: fl });
        void base;
        const b = box(p, u0, v0, u1, v1, H - 16, { wall: BRICK[s.v % 6], z0: z0 + 16 });
        hip(p, b, 12, "#4a4a50");
        for (const fc of [face, f.sideFace]) facade(p, { ...b, z0: z0 + 16 }, fc, { n: 6, stories: stories - 2, storyH: 8, style: 1, tall: true });
        for (const fc of [face, f.sideFace]) facade(p, { ...b, z0 }, fc, { n: 3, stories: 1, storyH: 8, style: 1, tall: true, door: 1 });
      } else if (tier === 1) { // early skyscraper: stone base, buff brick shaft, heavy cornice
        const [u0, v0, u1, v1] = f.rect(0.04, 0.96, 0.04, 0.96);
        const b = box(p, u0, v0, u1, v1, H, { wall: ["#d8c8a0", "#c8b088", "#e0d8c0"][s.v % 3], z0, foundation: fl, top: "#4a4440" });
        box(p, u0, v0, u1, v1, 18, { wall: "#b8a888", z0 });
        for (const fc of [face, f.sideFace]) facade(p, b, fc, { n: 8, stories, storyH: 8, style: 2, tall: true });
        cornice(p, b, face, "#8a7a5a"); cornice(p, b, f.sideFace, "#8a7a5a");
        const tb = box(p, u0 + 0.06, v0 + 0.06, u1 - 0.06, v1 - 0.06, 6, { wall: "#c8b898", z0: z0 + H, top: "#5a5450" });
        void tb;
      } else if (tier === 2) { // Art Deco: setbacks, vertical piers, lantern top
        let z = z0, w0 = 0.04, k = 0;
        const parts = [0.55, 0.3, 0.15];
        const col = ["#d8d0b8", "#c8c0a8", "#e0d8c8"][s.v % 3];
        for (const share of parts) {
          const h = Math.round(H * share);
          const [u0, v0, u1, v1] = f.rect(w0, 1 - w0, w0, 1 - w0);
          const b = box(p, u0, v0, u1, v1, h, { wall: col, z0: z, foundation: k === 0 ? fl : 0, top: "#9a9488" });
          const a = b.D(z), c = b.C(z), c2 = b.B(z);
          const piers = 8 - k * 2;
          for (let j = 0; j <= piers; j++) { const [x1, y1] = lerp(a, c, j / piers); p.px(x1, y1 - h, shade(col, 0.75), 1, h); const [x2, y2] = lerp(c, c2, j / piers); p.px(x2, y2 - h, shade(col, 0.6), 1, h); }
          for (const fc of ["left", "right"] as const) facade(p, b, fc, { n: piers, stories: Math.floor(h / 8), storyH: 8, style: 3, tall: true, dark: "#3a4a5a" });
          z += h; w0 += 0.12; k++;
        }
        const [tx, ty] = p.P(0.5, 0.5, z); p.px(tx - 1, ty - 14, "#c9b26a", 3, 14);
      } else { // postwar: stainless and glass slab
        const [u0, v0, u1, v1] = f.rect(0.08, 0.92, 0.2, 0.8);
        const b = box(p, u0, v0, u1, v1, H, { wall: "#7a9aaa", wallR: "#5a7a8a", z0, foundation: fl, top: "#8a9098" });
        for (const [a, c] of [[b.D(z0), b.C(z0)], [b.C(z0), b.B(z0)]] as [Pt, Pt][]) {
          for (let z = 4; z < H; z += 4) p.line([a[0], a[1] - z], [c[0], c[1] - z], "#c8d4dc");
          for (let j = 0; j <= 10; j++) { const [x, y] = lerp(a, c, j / 10); p.px(x, y - H, "#b8c0c8", 1, H); }
        }
        // plaza
        const pl = f.rect(0.0, 1.0, 0.0, 0.18);
        p.poly([p.P(pl[0], pl[1], z0), p.P(pl[2], pl[1], z0), p.P(pl[2], pl[3], z0), p.P(pl[0], pl[3], z0)], "#c8c4bc");
      }
      break;
    }
    case 5: { // market house: long open hall on columns, stalls under
      const [u0, v0, u1, v1] = f.rect(0.0, 1.0, 0.15, 0.85);
      const b = box(p, u0, v0, u1, v1, 2, { wall: "#8a7a62", z0 });
      const top = z0 + 16;
      for (let t = 0; t <= 1; t += 0.125) { const [x1, y1] = lerp(b.D(z0), b.C(z0), t), [x2, y2] = lerp(b.C(z0), b.B(z0), t); p.px(x1, y1 - 14, "#d8d0bc", 1, 14); p.px(x2, y2 - 14, "#b8b098", 1, 14); }
      const r = box(p, u0, v0, u1, v1, 3, { wall: "#c8c0a8", z0: top - 3 });
      gable(p, r, f.ridge, 8, "#5a4a3a");
      // stalls and baskets
      for (let k = 0; k < 6; k++) { const q = f.pt(p, 0.1 + k * 0.15, 0.5, 0); p.px(q[0] - 2, q[1] - 4, AWNING[k % 4][0], 4, 2); p.px(q[0] - 1, q[1] - 2, ["#c8a040", "#a83a2a", "#5a8a3a"][k % 3], 2, 2); }
      // cupola with bell
      const c = p.P((u0 + u1) / 2, (v0 + v1) / 2, top + 8);
      p.px(c[0] - 2, c[1] - 6, "#e8e2d0", 4, 6); p.px(c[0] - 3, c[1] - 8, "#4a4a50", 6, 2); p.px(c[0], c[1] - 11, "#c9b26a", 1, 3);
      break;
    }
  }
  return finish(p, s);
}

function civicSprite(s0: HouseSpec): Sprite {
  const p = new Painter(1, 210);
  const s = prepareLot(p, { ...s0, kind: "shop" });
  s.kind = "civic";
  const f = frame(s);
  const z0 = s.lift;
  const face = f.streetFace ?? f.backFace!;
  switch (s.sub) {
    case 0: { // church: stone gothic or brick with square tower and spire
      const stone = s.v % 2 ? "#b8ad98" : "#9c7a64";
      const [u0, v0, u1, v1] = f.rect(0.15, 0.85, 0.25, 0.75);
      const nave = box(p, u0, v0, u1, v1, 22, { wall: stone, z0, foundation: s.fnd + 2 });
      gable(p, nave, f.across, 12, "#4c5560");
      facade(p, nave, f.sideFace, { n: 4, stories: 1, storyH: 9, style: 0, dark: "#3a4a6a", tall: true });
      const tw = box(p, ...f.rect(0.4, 0.6, 0.12, 0.3), 46, { wall: stone, top: "#4c5560", z0 });
      facade(p, tw, face, { n: 1, stories: 1, storyH: 9, style: 0, door: 0 });
      const ap = p.P((tw.u0 + tw.u1) / 2, (tw.v0 + tw.v1) / 2, z0 + 46 + 28);
      p.poly([tw.D(z0 + 46), tw.C(z0 + 46), ap], "#56606c");
      p.poly([tw.C(z0 + 46), tw.B(z0 + 46), ap], "#3e4650");
      p.px(ap[0], ap[1] - 4, "#c9b26a", 1, 4); p.px(ap[0] - 1, ap[1] - 3, "#c9b26a", 3, 1);
      break;
    }
    case 1: { // onion-domed church (Slovak, Rusyn, Ukrainian, Russian parishes)
      const wall = ["#e8e0cc", "#c8b89a", "#d8c8a8"][s.v % 3];
      const [u0, v0, u1, v1] = f.rect(0.2, 0.8, 0.25, 0.75);
      const nave = box(p, u0, v0, u1, v1, 24, { wall, z0, foundation: s.fnd + 2 });
      gable(p, nave, f.across, 9, "#5a6a5a");
      facade(p, nave, f.sideFace, { n: 3, stories: 1, storyH: 9, style: 0, tall: true });
      const domes: [number, number, number][] = [[0.5, 0.5, 30], [0.3, 0.3, 40], [0.7, 0.3, 40]];
      for (const [a, d, hgt] of domes) {
        const [cu, cv] = f.rect(a, a, d, d);
        const t = box(p, cu - 0.07, cv - 0.07, cu + 0.07, cv + 0.07, hgt, { wall, z0 });
        void t;
        const [x, y] = p.P(cu, cv, z0 + hgt + 5);
        blob(p, x, y, 5, 5, s.v % 2 ? ["#2e5a3a", "#3e7a4a", "#6aaa6a"] : ["#8a6a1a", "#c9a23a", "#f0d070"], (k) => tileNoise(s.v, k, 3, 3));
        p.px(x, y - 10, "#c9b26a", 1, 5); p.px(x - 1, y - 9, "#c9b26a", 3, 1); p.px(x - 1, y - 7, "#c9b26a", 3, 1);
      }
      break;
    }
    case 2: { // school: brick, tall windows, bell cupola
      const [u0, v0, u1, v1] = f.rect(0.08, 0.92, 0.15, 0.7);
      const b = box(p, u0, v0, u1, v1, 22, { wall: BRICK[s.v % 6], z0, foundation: s.fnd + 2 });
      hip(p, b, 7, "#4a4a50");
      facade(p, b, face, { n: 6, stories: 2, storyH: 10, style: 1, door: 2, tall: true, boarded: s.boarded });
      facade(p, b, f.sideFace, { n: 3, stories: 2, storyH: 10, style: 1, tall: true, boarded: s.boarded });
      const c = p.P((u0 + u1) / 2, (v0 + v1) / 2, z0 + 30);
      p.px(c[0] - 2, c[1] - 6, "#e8e2d0", 4, 6); p.px(c[0] - 3, c[1] - 8, "#4a4a50", 6, 2); p.px(c[0] - 1, c[1] - 4, "#c9a24a", 2, 2);
      for (let t = 0.05; t < 0.95; t += 0.06) { const q = f.pt(p, t, 0.97, 0); p.px(q[0], q[1] - 3, "#2a2a2e", 1, 3); }
      break;
    }
    case 3: { // firehouse: brick, big arched doors, hose-drying tower
      const [u0, v0, u1, v1] = f.rect(0.15, 0.85, 0.08, 0.6);
      const b = box(p, u0, v0, u1, v1, 22, { wall: BRICK[(s.v + 2) % 6], z0, foundation: s.fnd, top: "#3a3432" });
      cornice(p, b, face, "#4a3a32");
      const a = face === "left" ? b.D(z0) : b.C(z0), c = face === "left" ? b.C(z0) : b.B(z0);
      for (const t of [0.3, 0.7]) { const [x, y] = lerp(a, c, t); p.px(x - 3, y - 10, "#7a1e18", 6, 10); p.px(x - 2, y - 11, "#7a1e18", 4, 1); }
      facade(p, b, face, { n: 3, stories: 2, storyH: 10, style: 1, shop: null });
      const tw = box(p, ...f.rect(0.7, 0.85, 0.45, 0.6), 40, { wall: BRICK[(s.v + 2) % 6], z0 });
      hip(p, tw, 6, "#3a3a40");
      break;
    }
    case 5: { // twin-tower church: Slovak, Polish, Hungarian, Italian, Lithuanian parishes — big brick, two spires
      const brick = ["#9a4a34", "#a8604a", "#b8a890"][s.v % 3];
      const [u0, v0, u1, v1] = f.rect(0.18, 0.82, 0.28, 0.9);
      const nave = box(p, u0, v0, u1, v1, 26, { wall: brick, z0, foundation: s.fnd + 3, fnd: "#8a8070" });
      gable(p, nave, f.across, 14, "#3e4a52");
      facade(p, nave, f.sideFace, { n: 4, stories: 1, storyH: 10, style: 1, dark: "#5a3a6a", tall: true });
      for (const a of [0.2, 0.68]) {
        const tw = box(p, ...f.rect(a, a + 0.14, 0.12, 0.28), 52, { wall: brick, z0 });
        facade(p, tw, face, { n: 1, stories: 2, storyH: 18, style: 1, tall: true });
        const ap = p.P((tw.u0 + tw.u1) / 2, (tw.v0 + tw.v1) / 2, z0 + 52 + 22);
        p.poly([tw.D(z0 + 52), tw.C(z0 + 52), ap], "#4a7a6a");
        p.poly([tw.C(z0 + 52), tw.B(z0 + 52), ap], "#3a6052");
        p.px(ap[0], ap[1] - 4, "#c9b26a", 1, 4); p.px(ap[0] - 1, ap[1] - 3, "#c9b26a", 3, 1);
      }
      const rose = f.pt(p, 0.5, 0.27, z0 + 30); p.px(rose[0] - 2, rose[1] - 2, "#c84a6a", 4, 4); p.px(rose[0] - 1, rose[1] - 1, "#f0d070", 2, 2);
      break;
    }
    case 6: { // synagogue: brick or stone, round-arched windows, small domes, Star of David
      const wall = ["#c8b898", "#a8604a"][s.v % 2];
      const [u0, v0, u1, v1] = f.rect(0.14, 0.86, 0.2, 0.8);
      const b = box(p, u0, v0, u1, v1, 26, { wall, z0, foundation: s.fnd + 3 });
      gable(p, b, f.across, 7, "#4a4a50");
      facade(p, b, face, { n: 3, stories: 2, storyH: 11, style: 1, door: 1, tall: true, dark: "#3a4a6a" });
      facade(p, b, f.sideFace, { n: 4, stories: 2, storyH: 11, style: 1, tall: true, dark: "#3a4a6a" });
      for (const a of [0.18, 0.82]) {
        const r = f.rect(a, a, 0.24, 0.24);
        cylinder(p, r[0], r[1], 0.07, z0 + 26, 8, wall, "#6a8a7a");
        const [x, y] = p.P(r[0], r[1], z0 + 40); p.px(x - 2, y - 2, "#6a8a7a", 4, 3);
      }
      const st = f.pt(p, 0.5, 0.2, z0 + 34);
      p.line([st[0] - 3, st[1] + 2], [st[0] + 3, st[1] + 2], "#e8d080"); p.line([st[0] - 3, st[1] + 2], [st[0], st[1] - 3], "#e8d080"); p.line([st[0] + 3, st[1] + 2], [st[0], st[1] - 3], "#e8d080");
      p.line([st[0] - 3, st[1] - 1], [st[0] + 3, st[1] - 1], "#e8d080"); p.line([st[0] - 3, st[1] - 1], [st[0], st[1] + 4], "#e8d080"); p.line([st[0] + 3, st[1] - 1], [st[0], st[1] + 4], "#e8d080");
      break;
    }
    case 7: { // AME church: plain brick, square bell tower with pyramid cap
      const brick = BRICK[(s.v + 1) % 6];
      const [u0, v0, u1, v1] = f.rect(0.2, 0.8, 0.26, 0.8);
      const nave = box(p, u0, v0, u1, v1, 20, { wall: brick, z0, foundation: s.fnd + 2 });
      gable(p, nave, f.across, 10, "#3a3a40");
      facade(p, nave, f.sideFace, { n: 3, stories: 1, storyH: 9, style: 0, tall: true, dark: "#6a3a3a" });
      const tw = box(p, ...f.rect(0.62, 0.8, 0.12, 0.3), 36, { wall: brick, z0 });
      facade(p, tw, face, { n: 1, stories: 1, storyH: 9, style: 0, door: 0 });
      const ap = p.P((tw.u0 + tw.u1) / 2, (tw.v0 + tw.v1) / 2, z0 + 46);
      p.poly([tw.D(z0 + 36), tw.C(z0 + 36), ap], "#3a3a40");
      p.poly([tw.C(z0 + 36), tw.B(z0 + 36), ap], "#2a2a30");
      p.px(ap[0], ap[1] - 4, "#efe9da", 1, 4); p.px(ap[0] - 1, ap[1] - 3, "#efe9da", 3, 1);
      break;
    }
    case 8: { // social hall: Sokol, Turnverein, Falcons, Hibernians — two-storey hall, ballroom windows, flag
      const [u0, v0, u1, v1] = f.rect(0.06, 0.94, 0.06, 0.72);
      const b = box(p, u0, v0, u1, v1, 24, { wall: BRICK[(s.v + 3) % 6], z0, foundation: s.fnd, top: "#3a3432" });
      cornice(p, b, face, "#c8b898");
      facade(p, b, face, { n: 5, stories: 2, storyH: 11, style: 1, door: 2, tall: true });
      facade(p, b, f.sideFace, { n: 3, stories: 2, storyH: 11, style: 1, tall: true });
      const a = face === "left" ? b.D(z0 + 24) : b.C(z0 + 24), c = face === "left" ? b.C(z0 + 24) : b.B(z0 + 24);
      const [x, y] = lerp(a, c, 0.5);
      p.px(x - 7, y - 3, "#e8e0c8", 14, 3); p.px(x - 6, y - 2, "#3a2a24", 12, 1); // name band
      p.px(x, y - 18, "#3a3a3a", 1, 15);
      const flags = [["#ffffff", "#2e5aa8", "#d03030"], ["#ffffff", "#d03030", "#d03030"], ["#2a2a2a", "#d03030", "#e8c040"], ["#3a8a4a", "#ffffff", "#d0402a"]][s.v % 4];
      flags.forEach((col, k) => p.px(x + 1, y - 18 + k * 2, col, 6, 2));
      break;
    }
    case 4: { // library: Beaux-Arts stone, columned entrance, dome
      const [u0, v0, u1, v1] = f.rect(0.08, 0.92, 0.18, 0.75);
      const b = box(p, u0, v0, u1, v1, 26, { wall: "#d8d0b8", z0, foundation: s.fnd + 4, fnd: "#b8b098", top: "#8a8a84" });
      cornice(p, b, face, "#b8b098");
      facade(p, b, f.sideFace, { n: 4, stories: 1, storyH: 9, style: 1, tall: true, dark: "#3a4a5a" });
      const a = face === "left" ? b.D(z0) : b.C(z0), c = face === "left" ? b.C(z0) : b.B(z0);
      for (let k = 0; k < 4; k++) { const [x, y] = lerp(a, c, 0.3 + k * 0.13); p.px(x, y - 24, "#f4f0e6", 2, 24); }
      cylinder(p, (u0 + u1) / 2, (v0 + v1) / 2, 0.16, z0 + 26, 6, "#d0c8b0", "#8a9a9a");
      for (let k = 0; k < 5; k++) cylinder(p, (u0 + u1) / 2, (v0 + v1) / 2, 0.16 * Math.cos((k / 5) * Math.PI / 2), z0 + 32 + k * 2, 2, "#7c9a96", "#8eaaa6");
      // steps
      for (let k = 0; k < 3; k++) { const q = f.pt(p, 0.5, 0.16 - k * 0.03, 0); p.px(q[0] - 6, q[1] - 2 + k, "#c8c0a8", 12, 1); }
      break;
    }
  }
  return finish(p, s);
}

/** Final pixel pass: crisp alpha, then soot. */
function finish(p: Painter, s: HouseSpec): Sprite {
  const sp = p.sprite();
  if (s.soot > 0 || s.boarded) weather(sp.canvas, Math.min(3, s.soot + (s.boarded ? 2 : 0)));
  if (s.boarded) decay(sp.canvas, s.v);
  return sp;
}

/** Abandoned: holes in the roof, sagging dark patches, weeds at the foot of the walls. */
function decay(c: HTMLCanvasElement, v: number) {
  const ctx = c.getContext("2d")!;
  const d = ctx.getImageData(0, 0, c.width, c.height);
  const W = c.width, H = c.height;
  let top = H;
  for (let i = 3; i < d.data.length; i += 4) if (d.data[i]) { top = Math.floor((i >> 2) / W); break; }
  for (let k = 0; k < 14; k++) {
    const x = Math.floor(tileNoise(v, k, 1, 9) * W), y = top + Math.floor(tileNoise(v, k, 2, 9) * 14);
    for (let dy = 0; dy < 3; dy++) for (let dx = 0; dx < 3; dx++) {
      const j = ((y + dy) * W + x + dx) * 4;
      if (j >= 0 && j < d.data.length && d.data[j + 3]) { d.data[j] = 24; d.data[j + 1] = 20; d.data[j + 2] = 18; }
    }
  }
  // weeds: green pixels just above the lowest opaque pixel in each column
  for (let x = 0; x < W; x += 2) {
    for (let y = H - 1; y > 0; y--) {
      const j = (y * W + x) * 4;
      if (d.data[j + 3]) { if (tileNoise(v, x, 3, 9) < 0.5) for (let k = 1; k <= 2; k++) { const jj = ((y - k) * W + x) * 4; d.data[jj] = 70; d.data[jj + 1] = 110; d.data[jj + 2] = 40; d.data[jj + 3] = 255; } break; }
    }
  }
  ctx.putImageData(d, 0, 0);
}

/** Darken and grey a sprite toward soot-black. level 0..3 */
export function weather(c: HTMLCanvasElement, level: number) {
  const ctx = c.getContext("2d")!;
  const d = ctx.getImageData(0, 0, c.width, c.height);
  const k = Math.min(0.55, level * 0.17);
  for (let i = 0; i < d.data.length; i += 4) {
    if (!d.data[i + 3]) continue;
    const g = (d.data[i] + d.data[i + 1] + d.data[i + 2]) / 3;
    d.data[i] = d.data[i] * (1 - k) + (g * 0.45 + 22) * k;
    d.data[i + 1] = d.data[i + 1] * (1 - k) + (g * 0.42 + 20) * k;
    d.data[i + 2] = d.data[i + 2] * (1 - k) + (g * 0.40 + 18) * k;
  }
  ctx.putImageData(d, 0, 0);
}

export function buildHouse(key: string): Sprite {
  const s = parseHouseKey(key);
  return houseSprite(s);
}

