// v0.31: the small things that make a street read as a street, and the industrial landforms round the works.
// Static sprites, registered with the others (renderer constructor).

import { tileNoise } from "../core/rng";
import { blob, box, Painter, shade, type Sprite } from "./sprites";

// ---------------------------------------------------------------- street clutter

/**
 * Wires along a straight street, drawn tile by tile so a run of tiles joins into one line of wires. `pole`: a pole on
 * this tile; `kind`: "tel" one wire (telegraph, from the 1850s on the pikes and railroads), "elec" a crossarm with
 * three wires (electric, 1890s+), "trolley" poles on both sides with a span wire and the trolley wire over the middle.
 * Axis "a" runs along u (east–west on the map), "b" along v.
 */
function wires(o: "a" | "b", kind: "tel" | "elec" | "trolley", pole: boolean): Sprite {
  const p = new Painter(1, 90);
  const P = (along: number, across: number, z: number) => (o === "a" ? p.P(along, across, z) : p.P(across, along, z));
  const POLE = kind === "trolley" ? "#3a3a40" : "#5a4632", WIRE = "#2a2a2e";
  const side = 0.79, H = kind === "tel" ? 20 : 24;
  if (pole) {
    const [x, y] = P(0.5, side, 0);
    p.px(x, y - H, POLE, 1, H);
    if (kind === "elec") { const a = P(0.5, side - 0.07, H - 1), b = P(0.5, side + 0.07, H - 1); p.line(a, b, POLE); }
    if (kind === "tel") p.px(x - 1, y - H + 1, POLE, 3, 1);
    if (kind === "trolley") {
      const [x2, y2] = P(0.5, 1 - side, 0);
      p.px(x2, y2 - H, POLE, 1, H);
      p.line(P(0.5, side, H - 2), P(0.5, 1 - side, H - 2), WIRE); // span wire
    }
  }
  if (kind === "tel") p.line(P(0, side, H - 1), P(1, side, H - 1), WIRE);
  if (kind === "elec") for (const d of [-0.05, 0.05]) p.line(P(0, side + d, H - 2), P(1, side + d, H - 2), "#3e3e44");
  if (kind === "trolley") p.line(P(0, 0.5, H - 3), P(1, 0.5, H - 3), WIRE);
  return p.sprite();
}

/** a billboard on two legs, its face toward the road (axis of the road: a/b), from about 1905 */
function billboard(o: "a" | "b", v: number): Sprite {
  const p = new Painter(1, 90);
  const P = (along: number, across: number, z: number) => (o === "a" ? p.P(along, across, z) : p.P(across, along, z));
  const posters: [string, string, string][] = [["#e8d8a8", "#a8302a", "#2a2a5a"], ["#f0e8d0", "#2e5aa8", "#c8302a"], ["#d8c070", "#3a2a1a", "#b03a2a"], ["#c8d8c8", "#3a6a3a", "#e8e0c8"]];
  const [bg, ink, ink2] = posters[v % posters.length];
  const a0 = 0.18, a1 = 0.82, d = 0.3;
  for (const t of [0.26, 0.74]) { const [x, y] = P(t, d, 0); p.px(x, y - 9, "#4a3a2a", 1, 9); }
  p.poly([P(a0, d, 9), P(a1, d, 9), P(a1, d, 21), P(a0, d, 21)], "#3a3028");
  p.poly([P(a0 + 0.02, d, 10), P(a1 - 0.02, d, 10), P(a1 - 0.02, d, 20), P(a0 + 0.02, d, 20)], bg);
  // lettering: a big word and a line under it
  for (let k = 0; k < 6; k++) { const q = P(a0 + 0.08 + k * 0.08, d, 16); p.px(q[0], q[1], ink, 2, 3); }
  p.line(P(a0 + 0.08, d, 12), P(a1 - 0.12, d, 12), ink2);
  return p.sprite();
}

// ---------------------------------------------------------------- industrial landforms

const SLAG = ["#7a7468", "#8a8274", "#6a645a", "#9a9080", "#5e5a52"];

/**
 * A slag dump's tile: the tipped slag lies in a heap with a flat top where the ladle cars run out and dump, and a
 * steep, ribbed face. `face` 0 = interior (flat top with the dump track), 1 = edge (the tipped face spilling down).
 */
function slagTile(v: number, face: number): Sprite {
  const p = new Painter(1, 80);
  const rnd = (k: number) => tileNoise(5150 + v, k, face, 3);
  if (face === 1) {
    // runs of fresh slag down the face: pale streaks with dark crust
    for (let k = 0; k < 9; k++) {
      const u = 0.1 + rnd(k) * 0.8, vv = 0.1 + rnd(k + 20) * 0.8;
      const [x, y] = p.P(u, vv, 0);
      const len = 3 + Math.floor(rnd(k + 40) * 5);
      for (let j = 0; j < len; j++) p.px(x + (j >> 1), y - j * 0.5 + j, j % 3 ? SLAG[(k + j) % SLAG.length] : "#4a463e", 2, 1);
    }
  } else {
    // a flat top: cinders, the dump track on its trestle-less embankment, a ladle car or two left standing
    for (let k = 0; k < 14; k++) { const [x, y] = p.P(rnd(k), rnd(k + 30), 0); p.px(x, y, SLAG[k % SLAG.length], 2, 1); }
    if (v % 2 === 0) {
      const a = p.P(0, 0.5, 0), b = p.P(1, 0.5, 0);
      p.line([a[0], a[1] - 1], [b[0], b[1] - 1], "#4a3626");
      p.line(a, b, "#a8a8b0");
      if (v % 4 === 0) {
        // a ladle car: a thimble-shaped pot on a low car
        const [x, y] = p.P(0.45, 0.5, 0);
        p.px(x - 4, y - 3, "#2a2a2e", 9, 2);
        p.px(x - 3, y - 9, "#4a4440", 7, 6);
        p.px(x - 2, y - 10, "#5e5650", 5, 1);
      }
    }
  }
  return p.sprite();
}

/**
 * Beehive coke ovens: a long bank of brick domes with arched mouths, a charging track along the top and the larry
 * car that fed them. `lit`: smoking (the glow at night is live, from the emitters).
 */
function cokeOvens(o: "a" | "b", v: number): Sprite {
  const p = new Painter(1, 100);
  const P = (along: number, across: number, z: number) => (o === "a" ? p.P(along, across, z) : p.P(across, along, z));
  const BR = "#8a4a36", top = "#6a5a4a";
  // the bank: a long low wall of brick with the domes in it
  const [u0, v0, u1, v1] = o === "a" ? [0.02, 0.3, 0.98, 0.7] : [0.3, 0.02, 0.7, 0.98];
  const b = box(p, u0, v0, u1, v1, 7, { wall: BR, top });
  void b;
  for (let k = 0; k < 6; k++) {
    const t = 0.1 + k * 0.16;
    const [x, y] = P(t, 0.7, 4);
    p.px(x - 1, y - 2, "#1a1210", 3, 3); // oven mouth
    p.px(x - 2, y - 3, "#a8604a", 5, 1); // arch
    const [hx, hy] = P(t, 0.5, 8);
    blob(p, hx, hy, 3, 2, ["#6a3a2a", "#7a4632", "#8a5a42"], (q) => tileNoise(611 + v, q, k, 3)); // dome
  }
  // the charging track and larry car
  p.line(P(0, 0.5, 11), P(1, 0.5, 11), "#3a3a3e");
  const [cx, cy] = P(0.3 + (v % 3) * 0.2, 0.5, 11);
  p.px(cx - 3, cy - 5, "#3a3430", 7, 4);
  // quenched coke piled in front
  for (let k = 0; k < 5; k++) { const [x, y] = P(0.15 + k * 0.18, 0.86, 0); p.px(x - 2, y - 2, k % 2 ? "#5a5a5e" : "#7a7a80", 4, 2); }
  return p.sprite();
}

/**
 * A coal tipple at a drift mouth: the timber headhouse up on its legs over a siding, the chute, a loaded hopper
 * underneath, and the gob (slate and bad coal picked out) heaped beside it.
 */
function tipple(v: number): Sprite {
  const p = new Painter(1, 120);
  const W = "#6a5040";
  // legs
  for (const [u, vv] of [[0.35, 0.35], [0.65, 0.35], [0.35, 0.6], [0.65, 0.6]] as [number, number][]) { const [x, y] = p.P(u, vv, 0); p.px(x, y - 22, "#4a3628", 1, 22); }
  // the house
  const b = box(p, 0.32, 0.32, 0.68, 0.62, 12, { wall: W, z0: 20, top: "#4a4440" });
  void b;
  p.poly([p.P(0.32, 0.32, 32), p.P(0.68, 0.32, 32), p.P(0.5, 0.32, 38)], "#4a4440");
  // chute and loaded hopper car on the siding below
  p.line(p.P(0.5, 0.62, 20), p.P(0.5, 0.82, 6), "#2a2a2e");
  const a = p.P(0, 0.85, 0), c = p.P(1, 0.85, 0);
  p.line(a, c, "#a8a8b0");
  const [hx, hy] = p.P(0.55, 0.85, 0);
  p.px(hx - 5, hy - 6, "#3a2a24", 10, 5);
  p.px(hx - 4, hy - 7, "#1e1e22", 8, 1);
  // gob pile
  blob(p, ...p.P(0.15, 0.25, 4), 7, 4, ["#3a3634", "#4a4642", "#2e2c2a", "#5a5650"], (q) => tileNoise(733 + v, q, 1, 3));
  return p.sprite();
}

/** a gob pile on its own: slate and bad coal heaped up off a mine, some of them smouldering (the glow is live) */
function gobPile(v: number): Sprite {
  const p = new Painter(1, 80);
  const [x, y] = p.P(0.5, 0.5, 6);
  blob(p, x, y, 18, 9, ["#2e2c2a", "#3a3634", "#4a4642", "#5a5650"], (q) => tileNoise(744 + v, q, 2, 3));
  if (v % 2) for (let k = 0; k < 4; k++) p.px(x - 8 + k * 5, y - 2 + (k % 2) * 3, "#8a4a2a", 2, 1); // burnt red shale
  return p.sprite();
}

/** a strip-mine scar: the bench cut into the hilltop, a high wall of raw rock and the spoil bank below */
function stripCut(v: number): Sprite {
  const p = new Painter(1, 70);
  const rnd = (k: number) => tileNoise(755 + v, k, 3, 3);
  // the high wall
  p.poly([p.P(0.05, 0.3, 0), p.P(0.95, 0.3, 0), p.P(0.95, 0.3, 7), p.P(0.05, 0.3, 7)], "#8a7a62");
  for (let k = 0; k < 6; k++) { const [x, y] = p.P(0.1 + rnd(k) * 0.8, 0.3, 2 + rnd(k + 9) * 4); p.px(x, y, "#5a4e3e", 2, 1); }
  // the bench floor and the coal seam's black line
  p.line(p.P(0.05, 0.31, 1), p.P(0.95, 0.31, 1), "#1e1c1c");
  // spoil heaped in ridges
  for (let k = 0; k < 4; k++) {
    const [x, y] = p.P(0.2 + k * 0.2, 0.7, 2);
    blob(p, x, y, 6, 3, ["#6a5a44", "#7a6a50", "#8a7a5e"], (q) => rnd(q + k * 17));
  }
  return p.sprite();
}

/** a raft of coal barges tied up at a landing, waiting for a towboat: three abreast, two long */
function bargeFleet(o: "a" | "b", v: number): Sprite {
  const p = new Painter(1, 60);
  const P = (along: number, across: number, z: number) => (o === "a" ? p.P(along, across, z) : p.P(across, along, z));
  for (let r = 0; r < 3; r++) for (let c = 0; c < 2; c++) {
    const a0 = 0.04 + c * 0.48, a1 = a0 + 0.44, d0 = 0.12 + r * 0.26, d1 = d0 + 0.22;
    const corners = [P(a0, d0, 2), P(a1, d0, 2), P(a1, d1, 2), P(a0, d1, 2)];
    p.poly([P(a0, d1, 0), P(a1, d1, 0), P(a1, d1, 3), P(a0, d1, 3)], "#3a2e26");
    p.poly(corners, "#4a3c30");
    const empty = (v + r + c) % 5 === 0;
    if (!empty) p.poly([P(a0 + 0.03, d0 + 0.03, 4), P(a1 - 0.03, d0 + 0.03, 4), P(a1 - 0.03, d1 - 0.03, 4), P(a0 + 0.03, d1 - 0.03, 4)], (r + c) % 2 ? "#1e1e22" : "#2a2a2e");
  }
  return p.sprite();
}

/** an ore yard: red-brown hematite heaped under a travelling bridge crane */
function orePile(v: number): Sprite {
  const p = new Painter(1, 100);
  const [x, y] = p.P(0.5, 0.5, 5);
  blob(p, x, y, 20, 9, ["#6a3a2a", "#7a4632", "#8a5a42", "#5a2e22"], (q) => tileNoise(766 + v, q, 4, 3));
  // the ore bridge's leg and girder
  for (const u of [0.1, 0.9]) { const [lx, ly] = p.P(u, 0.2, 0); p.px(lx, ly - 30, "#3a3a40", 2, 30); }
  p.line(p.P(0.1, 0.2, 30), p.P(0.9, 0.2, 30), "#3a3a40");
  p.line(p.P(0.1, 0.2, 29), p.P(0.9, 0.2, 29), "#3a3a40");
  return p.sprite();
}

/** a rail yard track tile: sidings two abreast with a string of cars on them (hoppers, gondolas, boxcars) */
function yardCars(o: "a" | "b", v: number): Sprite {
  const p = new Painter(1, 60);
  const P = (along: number, across: number, z: number) => (o === "a" ? p.P(along, across, z) : p.P(across, along, z));
  const rnd = (k: number) => tileNoise(777 + v, k, 5, 3);
  const CAR = [["#3a2a24", "#2a1e1a"], ["#6a3a2a", "#4a2a20"], ["#2e2e32", "#1e1e22"], ["#7a5a3a", "#5a4028"]];
  for (const across of [0.3, 0.7]) {
    p.line(P(0, across - 0.05, 0), P(1, across - 0.05, 0), "#9a9aa2");
    p.line(P(0, across + 0.05, 0), P(1, across + 0.05, 0), "#9a9aa2");
    if (rnd(across * 10) < 0.25) continue; // an empty track
    for (let k = 0; k < 2; k++) {
      if (rnd(across * 10 + k + 3) < 0.15) continue;
      const a0 = 0.04 + k * 0.5, a1 = a0 + 0.44;
      const [c1, c2] = CAR[Math.floor(rnd(k + across * 20) * CAR.length)];
      const hh = c1 === "#7a5a3a" ? 8 : 6;
      const [u0, v0, u1, v1] = o === "a" ? [a0, across - 0.08, a1, across + 0.08] : [across - 0.08, a0, across + 0.08, a1];
      box(p, u0, v0, u1, v1, hh, { wall: c1, wallR: c2, top: hh === 6 && rnd(k + 9) < 0.7 ? "#1a1a1e" : shade(c1, 0.8), z0: 1 });
    }
  }
  return p.sprite();
}

/**
 * A roundhouse and its turntable, at the big yards: the engine house is an arc of brick stalls with a smoke jack
 * over each and a door facing in, round the turntable pit with its girder bridge; tracks fan from the pit to the
 * stalls and out to the yard.
 */
function roundhouse(v: number): Sprite {
  const p = new Painter(1, 120);
  const cx = 0.3, cy = 0.3, R = 0.2;
  // the pit: an ellipse of dark ground, its rim of stone, and the bridge across it
  const pit: [number, number][] = [];
  for (let k = 0; k < 24; k++) { const a = (k / 24) * Math.PI * 2; pit.push(p.P(cx + Math.cos(a) * R, cy + Math.sin(a) * R, 0)); }
  p.poly(pit, "#9a9284");
  const inner: [number, number][] = [];
  for (let k = 0; k < 24; k++) { const a = (k / 24) * Math.PI * 2; inner.push(p.P(cx + Math.cos(a) * (R - 0.025), cy + Math.sin(a) * (R - 0.025), -1)); }
  p.poly(inner, "#4a443c");
  const ang = (v * 0.7) % Math.PI;
  p.line(p.P(cx - Math.cos(ang) * R, cy - Math.sin(ang) * R, 1), p.P(cx + Math.cos(ang) * R, cy + Math.sin(ang) * R, 1), "#2a2a2e");
  p.line(p.P(cx - Math.cos(ang) * R, cy - Math.sin(ang) * R, 2), p.P(cx + Math.cos(ang) * R, cy + Math.sin(ang) * R, 2), "#5a5a62");
  // stalls on an arc round the far side, built back to front so the nearer ones overlap
  const stalls: number[] = [];
  for (let k = 0; k < 7; k++) stalls.push(-0.15 + k * 0.29);
  stalls.sort((a, b) => (Math.cos(a) + Math.sin(a)) - (Math.cos(b) + Math.sin(b)));
  for (const a of stalls) {
    const r0 = R + 0.08, r1 = R + 0.5;
    // the radial track out to the stall
    p.line(p.P(cx + Math.cos(a) * R, cy + Math.sin(a) * R, 0), p.P(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0, 0), "#7a7a82");
    const ux = Math.cos(a), uy = Math.sin(a), vx = -uy, vy = ux, hw = 0.06;
    const q = (r: number, s2: number, z: number) => p.P(cx + ux * r + vx * s2, cy + uy * r + vy * s2, z);
    const H = 10;
    // walls
    p.poly([q(r0, -hw, 0), q(r1, -hw, 0), q(r1, -hw, H), q(r0, -hw, H)], "#8a4a36");
    p.poly([q(r0, hw, 0), q(r1, hw, 0), q(r1, hw, H), q(r0, hw, H)], "#7a3e2e");
    p.poly([q(r1, -hw, 0), q(r1, hw, 0), q(r1, hw, H), q(r1, -hw, H)], "#6a3628");
    p.poly([q(r0, -hw, 0), q(r0, hw, 0), q(r0, hw, H), q(r0, -hw, H)], "#9a5a42");
    p.poly([q(r0 + 0.01, -hw * 0.6, 0), q(r0 + 0.01, hw * 0.6, 0), q(r0 + 0.01, hw * 0.6, H - 3), q(r0 + 0.01, -hw * 0.6, H - 3)], "#2a2220"); // the door
    // roof and smoke jack
    p.poly([q(r0, -hw, H), q(r1, -hw, H), q(r1, hw, H), q(r0, hw, H)], "#3e3a38");
    const [jx, jy] = q((r0 + r1) / 2, 0, H);
    p.px(jx, jy - 4, "#2a2a2e", 2, 4);
  }
  return p.sprite();
}

/** the static sprites this module adds */
export function clutterSprites(): [string, Sprite][] {
  const out: [string, Sprite][] = [];
  for (const o of ["a", "b"] as const) {
    for (const k of ["tel", "elec", "trolley"] as const) { out.push([`wire:${k}:${o}:1`, wires(o, k, true)]); out.push([`wire:${k}:${o}:0`, wires(o, k, false)]); }
    for (let v = 0; v < 4; v++) out.push([`bill:${o}:${v}`, billboard(o, v)]);
    for (let v = 0; v < 3; v++) out.push([`coke:${o}:${v}`, cokeOvens(o, v)]);
    for (let v = 0; v < 3; v++) out.push([`fleet:${o}:${v}`, bargeFleet(o, v)]);
    for (let v = 0; v < 4; v++) out.push([`cars:${o}:${v}`, yardCars(o, v)]);
  }
  for (let v = 0; v < 4; v++) { out.push([`slag:0:${v}`, slagTile(v, 0)]); out.push([`slag:1:${v}`, slagTile(v, 1)]); }
  for (let v = 0; v < 3; v++) out.push([`rhouse:${v}`, roundhouse(v)]);
  for (let v = 0; v < 2; v++) { out.push([`tipple:${v}`, tipple(v)]); out.push([`gob:${v}`, gobPile(v)]); out.push([`strip:${v}`, stripCut(v)]); out.push([`ore:${v}`, orePile(v)]); }
  return out;
}
