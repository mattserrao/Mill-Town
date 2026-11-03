// Tunnel portals, drawn as pixel-art sprites cut into the hillside (one tile each).
//
// A portal is a cutting and a headwall: the floor of the cut is levelled at the low edge of the tile, stone or
// concrete retaining walls hold back the hill on either side (their tops follow the slope down), and the headwall
// stands across the back of the cut with the bores in it. Everything is squared to the tile grid. A portal facing
// away from the camera (the city side of Mount Washington looks north) shows only its cutting and the top of its
// headwall, as it would from up the hill behind it.
//
// Key: T|look|bores|face|kind|g(T,R,B,L)|state|H — state 0 open, 1 open & lit, 2 boarded up; H headwall height (px).

import { type Pt, Painter, shade, lerp, type Sprite } from "./sprites";
import type { Face, Tunnel } from "../core/tunnels";

export interface PortalSpec {
  look: Tunnel["look"];
  bores: 1 | 2;
  face: Face;
  kind: Tunnel["kind"];
  g: [number, number, number, number];
  state: 0 | 1 | 2;
  H: number;
}

export const portalKey = (s: PortalSpec) => `T|${s.look}|${s.bores}|${s.face}|${s.kind}|${s.g.join(",")}|${s.state}|${s.H}`;

function parse(k: string): PortalSpec {
  const [, look, bores, face, kind, g, state, H] = k.split("|");
  return { look: look as PortalSpec["look"], bores: +bores as 1 | 2, face: face as Face, kind: kind as PortalSpec["kind"], g: g.split(",").map(Number) as PortalSpec["g"], state: +state as 0 | 1 | 2, H: +H };
}

const STONE = { face: "#b4a88e", dark: "#8a7e68", trim: "#cfc4a8", course: "#9a8e76" };
const BRICK = { face: "#94503a", dark: "#6e3a2a", trim: "#c8bca0", course: "#7a402e" };
const CONCRETE = { face: "#c6c2b6", dark: "#9a968c", trim: "#dedad0", course: "#b4b0a4" };
const MOUTH = "#0e0e12", LINING = "#2a2a30";
const WALL_B = 0.26; // the headwall stands this far into the tile from the hill side

export function buildPortal(key: string): Sprite {
  const s = parse(key);
  // room above for a tall headwall on a steep face, and below for a floor dug well under the tile's centre
  const p = new Painter(1, 420);
  (p as { gy: number }).gy = 250;
  const pal = s.look === "stone" ? STONE : s.look === "brick" ? BRICK : CONCRETE;
  const [gT, gR, gB, gL] = s.g;
  // ground height (px) at a tile position: bilinear over the corners
  const gz = (u: number, v: number) => (gT * (1 - u) + gR * u) * (1 - v) + (gL * (1 - u) + gB * u) * v;
  // the portal's own frame: a runs along the headwall (0..1), b from the hill side (0) to the open side (1)
  const uv = (a: number, b: number): [number, number] => {
    switch (s.face) {
      case "y+": return [a, b];
      case "x+": return [b, a];
      case "y-": return [a, 1 - b];
      case "x-": return [1 - b, a];
    }
  };
  const Q = (a: number, b: number, z: number): Pt => { const [u, v] = uv(a, b); return p.P(u, v, z); };
  const G = (a: number, b: number) => { const [u, v] = uv(a, b); return gz(u, v); };
  // which way the cut opens on screen: toward the camera (+u / +v) or away from it
  const front = s.face === "y+" || s.face === "x+";
  // light: faces toward +v are lit, toward +u darker (sprites.ts)
  const lit = (nu: number, nv: number) => (nv > 0 ? 1 : nu > 0 ? 0.76 : 0.6);
  const faceN = (() => { const [u0, v0] = uv(0, 0), [u1, v1] = uv(0, 1); return [u1 - u0, v1 - v0]; })(); // +b in u,v
  const alongN = (() => { const [u0, v0] = uv(0, 0), [u1, v1] = uv(1, 0); return [u1 - u0, v1 - v0]; })(); // +a in u,v

  // floor of the cut: the lowest corner, so the cut is dug into the hill, never built up out of it
  const bw = WALL_B;
  // the floor is level with the ground at the open end of the cut; the headwall stands at least its own height
  // and tall enough to clear the hill where it stands (up to 1.6 times its height on a steep face)
  const F = Math.round(Math.min(G(0, 1), G(1, 1)));
  const top = Math.round(F + Math.min(s.H * 1.6, Math.max(s.H, Math.max(G(0, bw), G(1, bw)) - F + 6)));

  // ---- side walls of the cut (a = 0 and a = 1), their tops following the hill down to the open end
  const side = (a: number, inward: number) => {
    // the wall's exposed face looks into the cut: +a for the a = 0 wall, -a for the a = 1 wall
    const nu = alongN[0] * inward, nv = alongN[1] * inward;
    const N = 8;
    // a wing wall: full height at the headwall, stepping down toward the open end, never above the hill it holds
    const topAt = (b: number) => Math.max(F + 3, Math.min(G(a, b) + 2, top - 2 - (top - F - 6) * Math.pow((b - bw) / (1 - bw), 0.8)));
    const pts: Pt[] = [];
    for (let k = 0; k <= N; k++) { const b = bw + ((1 - bw) * k) / N; pts.push(Q(a, b, topAt(b))); }
    for (let k = N; k >= 0; k--) { const b = bw + ((1 - bw) * k) / N; pts.push(Q(a, b, F)); }
    const visible = nu > 0 || nv > 0;
    if (visible) {
      const col = shade(pal.face, lit(nu, nv) * 0.92);
      p.poly(pts, col);
      for (let z = F + 4; z < top - 2; z += 4) {
        // coursing, only where the wall stands this high
        let a0: Pt | null = null;
        for (let k = 0; k <= N; k++) {
          const b = bw + ((1 - bw) * k) / N;
          if (topAt(b) > z + 1) { const q = Q(a, b, z); if (a0) p.line(a0, q, shade(col, 0.88)); a0 = q; } else a0 = null;
        }
      }
    }
    // coping along the top (a hidden wall's top is behind the hill beside the cut)
    if (visible) for (let k = 0; k < N; k++) {
      const b0 = bw + ((1 - bw) * k) / N, b1 = bw + ((1 - bw) * (k + 1)) / N;
      p.line(Q(a, b0, topAt(b0)), Q(a, b1, topAt(b1)), pal.trim);
    }
  };

  // ---- floor: the roadway or track bed between the walls
  const floor = () => {
    p.poly([Q(0, bw, F), Q(1, bw, F), Q(1, 1, F), Q(0, 1, F)], s.kind === "road" ? "#7a766c" : "#6a6256");
    const lanes = s.bores === 2 ? [0.27, 0.73] : [0.5];
    const lw = s.bores === 2 ? 0.17 : 0.2;
    for (const c of lanes) {
      if (s.kind === "road") {
        p.poly([Q(c - lw, bw, F), Q(c + lw, bw, F), Q(c + lw, 1, F), Q(c - lw, 1, F)], s.look === "concrete" ? "#4a4a4e" : "#8e8a80");
        // lane line
        for (let b = bw + 0.04; b < 1; b += 0.16) p.line(Q(c, b, F), Q(c, Math.min(1, b + 0.07), F), s.look === "concrete" ? "#e8e4d8" : "#6a665e");
      } else {
        if (s.state === 2) { // track lifted, cinders and weeds
          p.poly([Q(c - lw, bw, F), Q(c + lw, bw, F), Q(c + lw, 1, F), Q(c - lw, 1, F)], "#5e5a44");
          for (let b = bw; b < 1; b += 0.09) p.px(...Q(c + ((b * 7.3) % 0.2) - 0.1, b, F), "#4e6a34", 2, 1);
          continue;
        }
        p.poly([Q(c - lw, bw, F), Q(c + lw, bw, F), Q(c + lw, 1, F), Q(c - lw, 1, F)], s.kind === "trolley" ? "#8a8478" : "#5c5448");
        for (let b = bw + 0.02; b < 1; b += 0.06) p.line(Q(c - lw * 0.75, b, F), Q(c + lw * 0.75, b, F), s.kind === "trolley" ? "#7a746a" : "#4a3626");
        for (const r of [-0.06, 0.06]) p.line(Q(c + r, bw, F), Q(c + r, 1, F), "#a8a8b0");
      }
    }
    if (s.bores === 2 && s.kind === "road") p.line(Q(0.5, bw, F + 1), Q(0.5, 1, F + 1), "#b8b4a8"); // median kerb
  };

  // ---- headwall with its bores
  const headwall = () => {
    const nu = faceN[0], nv = faceN[1];
    const shadeK = lit(nu, nv);
    const col = shade(pal.face, shadeK);
    const W = (a: number, z: number) => Q(a, bw, z);
    const e = 0.03; // the wall runs a little past the cut into the side walls
    p.poly([W(-e, F), W(1 + e, F), W(1 + e, top), W(-e, top)], col);
    // coursing / brick bond / formwork lines
    const step = s.look === "brick" ? 2 : s.look === "stone" ? 4 : 6;
    for (let z = F + step; z < top; z += step) p.line(W(-e, z), W(1 + e, z), shade(col, s.look === "concrete" ? 0.95 : 0.86));
    if (s.look === "brick") for (let z = F + 1; z < top; z += 4) for (let a = 0.04 + ((z / 2) % 2) * 0.05; a < 1; a += 0.1) { const q = W(a, z); p.px(q[0], q[1], shade(col, 0.82)); }
    // pilasters at the ends (and between twin bores)
    const pil = (a: number, w: number) => p.poly([W(a - w, F), W(a + w, F), W(a + w, top), W(a - w, top)], shade(pal.trim, shadeK * 0.96));
    if (s.look !== "concrete") { pil(0.03, 0.035); pil(0.97, 0.035); if (s.bores === 2) pil(0.5, 0.04); }
    // the bores
    const centres = s.bores === 2 ? [0.27, 0.73] : [0.5];
    const aw = s.bores === 2 ? 0.17 : s.kind === "trolley" ? 0.22 : 0.26;
    const springH = s.look === "concrete" ? s.H * 0.48 : s.H * 0.38;
    const rise = s.look === "concrete" ? aw * 22 : aw * 34 * 0.9; // px: a round arch is about as tall as it is wide
    for (const c of centres) {
      const ring: Pt[] = [], inner: Pt[] = [];
      const N = 14;
      for (let k = 0; k <= N; k++) {
        const th = Math.PI * (1 - k / N);
        ring.push(W(c + Math.cos(th) * (aw + 0.045), F + springH + Math.sin(th) * (rise + 3)));
        inner.push(W(c + Math.cos(th) * aw, F + springH + Math.sin(th) * rise));
      }
      // voussoirs / trim ring
      if (s.look !== "concrete") {
        p.poly([W(c - aw - 0.045, F), ...ring, W(c + aw + 0.045, F)], shade(pal.trim, shadeK));
        for (let k = 1; k < N; k += 2) p.line(ring[k], inner[k], shade(pal.trim, shadeK * 0.8));
        // keystone
        const kq = ring[N >> 1];
        p.px(kq[0] - 2, kq[1] - 1, shade(pal.trim, shadeK * 1.06), 5, 4);
      } else {
        // a plain frame, flush, with a shadow line above the opening
        p.poly([W(c - aw - 0.03, F), ...ring, W(c + aw + 0.03, F)], shade(pal.dark, shadeK));
      }
      const mouth: Pt[] = [W(c - aw, F), ...inner, W(c + aw, F)];
      if (s.state === 2) {
        // boarded up: planks with dark gaps and a brace
        p.poly(mouth, "#5a4632");
        for (let a = c - aw + 0.04; a < c + aw; a += 0.06) p.line(W(a, F), W(a, F + springH + rise * Math.sqrt(Math.max(0, 1 - ((a - c) / aw) ** 2))), "#3a2c1e");
        p.line(W(c - aw, F + 2), W(c + aw, F + springH), "#7a6448");
        continue;
      }
      p.poly(mouth, MOUTH);
      // the lining just inside the mouth, and the bore receding into the dark
      const inset = (a: number, z: number): Pt => W(c + (a - c) * 0.7, F + (z - F) * 0.78);
      p.poly([inset(c - aw, F), ...inner.map((_q, k) => inset(c + Math.cos(Math.PI * (1 - k / N)) * aw, F + springH + Math.sin(Math.PI * (1 - k / N)) * rise)), inset(c + aw, F)], LINING);
      p.poly([inset(c - aw * 0.75, F), inset(c + aw * 0.75, F), inset(c + aw * 0.5, F + springH * 0.6), inset(c - aw * 0.5, F + springH * 0.6)], MOUTH);
      // road or rails running in
      if (s.kind === "road") p.poly([W(c - aw * 0.8, F), W(c + aw * 0.8, F), inset(c + aw * 0.3, F + 1), inset(c - aw * 0.3, F + 1)], "#3a3a3e");
      else for (const r of [-0.06, 0.06]) p.line(W(c + r, F), inset(c + r * 0.4, F + 2), "#6a6a70");
      if (s.state === 1) {
        // a row of lamps along the crown, converging into the bore
        for (let k = 0; k < 4; k++) { const f = k / 4; const q = lerp(W(c, F + springH + rise - 2), inset(c, F + springH * 0.7), f); p.px(q[0], q[1], k ? "#c8a848" : "#f0d878"); }
      }
    }
    // cornice and parapet
    p.poly([W(-e - 0.02, top), W(1 + e + 0.02, top), W(1 + e + 0.02, top + 3), W(-e - 0.02, top + 3)], shade(pal.trim, shadeK));
    p.line(W(-e - 0.02, top), W(1 + e + 0.02, top), shade(pal.dark, shadeK));
    if (s.look === "concrete") {
      // the name band: a dark panel with a few pale letters
      const zb = F + springH + rise + (top - F - springH - rise) * 0.45;
      p.poly([W(0.2, zb - 3), W(0.8, zb - 3), W(0.8, zb + 2), W(0.2, zb + 2)], "#34343a");
      for (let a = 0.24; a < 0.77; a += 0.035) { if ((a * 100) % 7 < 1.5) continue; const q = W(a, zb); p.px(q[0], q[1] - 1, "#e8e0c0", 1, 2); }
    }
  };

  // the cap of the headwall seen from behind/above: a strip of coping on the hillside
  const headTop = () => {
    const W = (a: number, z: number) => Q(a, bw, z);
    p.poly([W(-0.05, top), W(1.05, top), Q(1.05, bw + 0.06, top), Q(-0.05, bw + 0.06, top)], pal.trim);
    p.line(W(-0.05, top), W(1.05, top), shade(pal.dark, 0.9));
  };

  // back to front
  if (front) {
    // the cut's far side wall is drawn first, then the headwall, the floor, and the near side wall
    const farA = alongN[0] + alongN[1] > 0 ? 0 : 1; // the end of the headwall further from the camera
    side(farA, farA === 0 ? 1 : -1);
    headwall();
    floor();
    side(1 - farA, farA === 0 ? -1 : 1);
  } else {
    floor();
    side(0, 1);
    // the hill between the headwall and the tile edge, over the floor drawn beneath it
    const hill: Pt[] = [];
    for (let k = 0; k <= 6; k++) hill.push(Q(k / 6, bw, Math.max(top, G(k / 6, bw))));
    for (let k = 6; k >= 0; k--) hill.push(Q(k / 6, 0, G(k / 6, 0)));
    p.poly(hill, "#4e6a34");
    headTop();
  }
  return p.sprite();
}
