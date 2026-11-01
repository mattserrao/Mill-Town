// Little moving figures, drawn once into small canvases and cached: people (by era, sex and dress, facing
// toward or away from the viewer, two walking frames), and street vehicles (horse wagons, carriages,
// horsecars, streetcars, autos and trucks by era) in the four street directions with two animation frames
// (legs, wheels). Sprites are drawn at zoom-1 pixels; the traffic layer scales them to the camera.
//
// Also the oriented-box helper that trains and boats use (they turn through any angle, so they're drawn
// live as a few projected polygons).

import { shade } from "./sprites";

/** a sprite in the atlas: source rect (sx, sy, w, h) and the anchor within it */
export interface Fig { c: HTMLCanvasElement; sx: number; sy: number; w: number; h: number; ax: number; ay: number }

// All figures live in a few atlas canvases that are only ever drawn into (never read back), so the
// browser keeps them on the GPU and blitting hundreds a frame stays cheap.
const ATLAS = 256; // small sheets: adding a sprite to a sheet already in use copies only this much
let atlas: HTMLCanvasElement | null = null, ax0 = 0, ay0 = 0, rowH = 0;
function toAtlas(src: HTMLCanvasElement, ox: number, oy: number): Fig {
  const w = src.width, h = src.height;
  if (!atlas || ax0 + w + 1 > ATLAS) { ax0 = 0; ay0 += rowH + 1; rowH = 0; }
  if (!atlas || ay0 + h + 1 > ATLAS) { atlas = document.createElement("canvas"); atlas.width = atlas.height = ATLAS; ax0 = 0; ay0 = 0; rowH = 0; }
  atlas.getContext("2d")!.drawImage(src, ax0, ay0);
  const f = { c: atlas, sx: ax0, sy: ay0, w, h, ax: ox, ay: oy };
  ax0 += w + 1; rowH = Math.max(rowH, h);
  return f;
}

const cache = new Map<string, Fig>();
function cached(key: string, make: () => Fig): Fig {
  let f = cache.get(key);
  if (!f) { f = make(); cache.set(key, f); }
  return f;
}

const shadeMemo = new Map<string, string>();
/** memoised shade() (the live box drawing asks for the same few colours every frame) */
export function sh(col: string, k: number): string {
  const key = col + k.toFixed(2);
  let s = shadeMemo.get(key);
  if (!s) { s = shade(col, k); shadeMemo.set(key, s); }
  return s;
}

type Pt = [number, number];

/** a tiny canvas with an isometric ground point at (ox, oy) */
class Iso {
  readonly c: HTMLCanvasElement;
  readonly x: CanvasRenderingContext2D;
  constructor(w: number, h: number, readonly ox: number, readonly oy: number) {
    this.c = document.createElement("canvas");
    this.c.width = w; this.c.height = h;
    this.x = this.c.getContext("2d")!;
  }
  P(u: number, v: number, z: number): Pt { return [this.ox + (u - v) * 32, this.oy + (u + v) * 16 - z]; }
  poly(pts: Pt[], col: string) {
    const x = this.x;
    x.fillStyle = col; x.beginPath();
    x.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) x.lineTo(pts[i][0], pts[i][1]);
    x.closePath(); x.fill();
  }
  px(x: number, y: number, col: string, w = 1, h = 1) { this.x.fillStyle = col; this.x.fillRect(Math.round(x), Math.round(y), w, h); }
  line(a: Pt, b: Pt, col: string) {
    const n = Math.max(Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1]), 1);
    for (let i = 0; i <= n; i++) this.px(a[0] + ((b[0] - a[0]) * i) / n, a[1] + ((b[1] - a[1]) * i) / n, col);
  }
  done(): Fig {
    // hard alpha edges, as the rest of the pixel art
    const d = this.x.getImageData(0, 0, this.c.width, this.c.height);
    for (let i = 3; i < d.data.length; i += 4) d.data[i] = d.data[i] >= 110 ? 255 : 0;
    this.x.putImageData(d, 0, 0);
    return toAtlas(this.c, this.ox, this.oy);
  }
}

// ---------------------------------------------------------------- people

export interface Look {
  key: string;
  female: boolean;
  hat: string | null;     // hat colour (null: bareheaded)
  hair: string;
  skin: string;
  top: string;            // coat / blouse / shirt
  low: string;            // trousers / skirt
  long: boolean;          // floor-length skirt
  cap?: boolean;          // a workman's flat cap rather than a brimmed hat
}

const SKIN = ["#e8c0a0", "#e0b090", "#d8a882", "#c08a64", "#8a5a3a", "#6a4430"];
const HAIR = ["#2a2420", "#3a2a1e", "#5a3a22", "#8a6a3a", "#1a1a1a", "#7a7a76"];

/** what a person on the street wears in a given year; workers going to the works are in work clothes */
export function pickLook(year: number, r: () => number, worker = false): Look {
  const pick = <T,>(a: readonly T[]) => a[Math.floor(r() * a.length)];
  const skin = year < 1900 ? (r() < 0.93 ? pick(SKIN.slice(0, 4)) : pick(SKIN.slice(4))) : year < 1940 ? (r() < 0.85 ? pick(SKIN.slice(0, 4)) : pick(SKIN.slice(4))) : (r() < 0.72 ? pick(SKIN.slice(0, 4)) : pick(SKIN.slice(4)));
  const hair = pick(HAIR);
  const female = !worker && r() < (year < 1900 ? 0.4 : 0.48);
  let l: Omit<Look, "key">;
  if (worker) {
    const denim = year >= 1900 && r() < 0.6;
    l = { female: false, hat: pick(["#2a2a2e", "#3a3530", "#4a4038"]), cap: year < 1960 || r() < 0.5, hair, skin,
      top: denim ? pick(["#3a4a62", "#46566e"]) : pick(["#3a3328", "#4a4238", "#2e2e30", "#5a4a38"]),
      low: denim ? pick(["#2e3a50", "#36445a"]) : pick(["#2a2620", "#3a3228", "#2e2e32"]), long: false };
    if (year >= 1940 && r() < 0.5) l.hat = pick(["#c8c8c0", "#d8b040", "#c84030"]); // hard hats
  } else if (!female) {
    const hat = year < 1960 ? (r() < 0.9 ? pick(["#1e1e22", "#2e2a26", "#4a3e32", "#5a5048"]) : null) : (r() < 0.25 ? pick(["#3a3a40", "#5a5048"]) : null);
    const tops = year < 1900 ? ["#24242a", "#2e2e3a", "#3a3026", "#4a3e30", "#3a3a32", "#2a3040"]
      : year < 1950 ? ["#2e2e36", "#3e3a34", "#4a4438", "#2e3a4e", "#5a5048", "#6a6458"]
      : ["#e8e4dc", "#8aa8c8", "#c8b890", "#4a5a7a", "#7a4a3a", "#5a6a4a", "#2e2e36"];
    const lows = year < 1950 ? ["#22222a", "#2e2a26", "#3a3a3a", "#3a3428"] : ["#2e3448", "#3a4a6a", "#4a4a4a", "#6a5a48"];
    l = { female: false, hat, cap: hat !== null && r() < (year < 1920 ? 0.45 : 0.25), hair, skin, top: pick(tops), low: pick(lows), long: false };
  } else {
    const long = year < 1918;
    const skirts = year < 1900 ? ["#2a2a3a", "#4a2a2a", "#3a3a2a", "#5a4a3a", "#2e3a5a", "#5a2e3e", "#3a3a3e"]
      : year < 1950 ? ["#3a3a4a", "#5a3a3a", "#3a5a8a", "#6a7a4a", "#8a3a3a", "#5a4a3a", "#7a6a5a"]
      : ["#c84a4a", "#e8c040", "#4a8ac8", "#5a9a6a", "#d88a9a", "#3a4a6a", "#e8e4dc"];
    const tops = year < 1950 ? ["#e8e4dc", "#d8c8a8", "#c8a8a8", "#a8b0c0", "#2a2a3a"] : ["#e8e4dc", "#f0d8c8", "#a8c8e0", "#e8c8a0"];
    const sameDress = year >= 1918 && r() < 0.5;
    const low = pick(skirts);
    l = { female: true, hat: year < 1950 && r() < 0.6 ? pick(["#2a2a2e", "#5a3a3a", "#d8c8a8", "#3a3a5a"]) : null, hair, skin, top: sameDress ? low : pick(tops), low, long };
  }
  return { ...l, key: `${l.female ? "f" : "m"}${l.hat ?? "-"}${l.cap ? "c" : ""}${l.hair}${l.skin}${l.top}${l.low}${l.long ? "L" : ""}` };
}

const pools = new Map<string, Look[]>();
/**
 * A person from a small fixed wardrobe for the decade (so the sprite cache fills once and stays put):
 * 40 townsfolk looks and 16 workmen's looks per decade.
 */
export function poolLook(year: number, r: () => number, worker = false): Look {
  const dec = Math.floor(year / 10) * 10, key = `${dec}${worker ? "w" : ""}`;
  let pool = pools.get(key);
  if (!pool) {
    let seed = dec * 7 + (worker ? 3 : 0);
    const rr = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    pool = Array.from({ length: worker ? 16 : 40 }, () => pickLook(dec + 5, rr, worker));
    pools.set(key, pool);
    // draw the whole wardrobe at once, so the sheets fill before they're drawn from
    for (const l of pool) for (const front of [true, false]) for (const fr of [0, 1, 2]) walkerFig(l, front, fr);
  }
  return pool[Math.floor(r() * pool.length)];
}

/**
 * A person, 7×11 px at zoom 1, feet at the anchor. front: facing the viewer (walking down the screen).
 * frame 0/1: stride / feet together; frame 2: standing still.
 */
export function walkerFig(l: Look, front: boolean, frame: number): Fig {
  return cached(`w${l.key}${front ? 1 : 0}${frame}`, () => {
    const p = new Iso(7, 12, 3, 11);
    const P = (x: number, y: number, col: string, w = 1, h = 1) => p.px(x, y, col, w, h);
    const dark = sh(l.top, 0.7);
    // head (rows 1-3) and hat or hair
    if (l.hat && l.cap) { P(2, 1, l.hat, 3, 1); P(front ? 2 : 1, 1, l.hat, 4, 1); }
    else if (l.hat && !l.female) { P(2, 0, l.hat, 3, 1); P(1, 1, l.hat, 5, 1); }
    else if (l.hat && l.female) { P(2, 0, l.hat, 3, 1); P(1, 1, l.hat, 5, 1); }
    else P(2, 1, l.hair, 3, 1);
    P(2, 2, front ? l.skin : l.hair, 3, 2);
    if (front) { P(2, 2, l.hat || l.female ? l.skin : l.hair, 3, 1); }
    if (l.female && !l.hat) { P(1, 2, l.hair, 1, 2); P(5, 2, l.hair, 1, 1); } // hair up / down the sides
    if (!front) P(2, 3, l.hair, 3, 1);
    // body
    const legs = frame === 0;
    if (l.female) {
      P(2, 4, l.top, 3, 2);
      // arms
      P(1, 4, sh(l.top, 0.82), 1, legs ? 2 : 3); P(5, 4, sh(l.top, 0.82), 1, legs ? 3 : 2);
      if (l.long) {
        P(2, 6, l.low, 3, 2); P(1, 8, l.low, 5, 2);
        P(legs ? 1 : 5, 9, sh(l.low, 0.7), 1, 1); // the hem swings
        P(2, 10, "#1e1a18", 1, 1); if (legs) P(4, 10, "#1e1a18", 1, 1);
      } else {
        P(2, 6, l.low, 3, 2); P(1, 7, l.low, 5, 1);
        if (legs) { P(2, 8, l.skin, 1, 2); P(4, 8, l.skin, 1, 2); P(2, 10, "#1e1a18"); P(4, 10, "#1e1a18"); }
        else { P(3, 8, l.skin, 1, 2); P(3, 10, "#1e1a18"); }
      }
    } else {
      P(2, 4, l.top, 3, 4);
      P(2, 4, front ? sh(l.top, 1.12) : l.top, 1, 3);
      // arms swing with the stride
      if (frame === 2) { P(1, 4, dark, 1, 3); P(5, 4, dark, 1, 3); }
      else { P(1, legs ? 4 : 5, dark, 1, 3); P(5, legs ? 5 : 4, dark, 1, 3); }
      if (legs) { P(2, 8, l.low, 1, 2); P(4, 8, l.low, 1, 2); P(1, 10, "#1a1614", 2, 1); P(4, 10, "#1a1614", 2, 1); }
      else { P(2, 8, l.low, 3, 2); P(2, 10, "#1a1614", 3, 1); }
    }
    return p.done();
  });
}

/** a striker's placard on a stick */
export function placardFig(variant: number): Fig {
  return cached(`placard${variant}`, () => {
    const p = new Iso(9, 18, 4, 17);
    p.px(4, 4, "#5a4430", 1, 9);
    p.px(0, 0, "#f0ece0", 9, 5);
    const ink = variant % 2 ? "#a82820" : "#1e1e22";
    p.px(1, 1, ink, 3, 1); p.px(5, 1, ink, 3, 1); p.px(1, 3, ink, 2, 1); p.px(4, 3, ink, 4, 1);
    return p.done();
  });
}

/** an oil-drum fire at a picket line (the flame is drawn live) */
export function barrelFig(): Fig {
  return cached("barrel", () => {
    const p = new Iso(7, 9, 3, 8);
    p.px(1, 2, "#3a3632", 5, 6); p.px(1, 2, "#4e4842", 2, 6); p.px(1, 4, "#2a2622", 5, 1);
    p.px(1, 1, "#1a1816", 5, 1);
    return p.done();
  });
}

// ---------------------------------------------------------------- street vehicles

/** facing: 0 = +x (screen down-right), 1 = +y (down-left), 2 = -x (up-left), 3 = -y (up-right) */
export type Facing = 0 | 1 | 2 | 3;
/** local (along, across) → tile (u, v) */
function tf(f: Facing, a: number, c: number): Pt {
  return f === 0 ? [a, c] : f === 1 ? [-c, a] : f === 2 ? [-a, -c] : [c, -a];
}

interface Part { a0: number; a1: number; c0: number; c1: number; z0: number; z1: number; col: string; top?: string; layer?: number }

function drawParts(p: Iso, f: Facing, parts: Part[]) {
  const boxes = parts.map((q) => {
    const [u0, v0] = tf(f, q.a0, q.c0), [u1, v1] = tf(f, q.a1, q.c1);
    return { ...q, u0: Math.min(u0, u1), u1: Math.max(u0, u1), v0: Math.min(v0, v1), v1: Math.max(v0, v1) };
  });
  boxes.sort((a, b) => (a.layer ?? 0) - (b.layer ?? 0) || (a.u1 + a.v1) - (b.u1 + b.v1));
  for (const b of boxes) {
    const A = (z: number) => p.P(b.u0, b.v0, z), B = (z: number) => p.P(b.u1, b.v0, z), C = (z: number) => p.P(b.u1, b.v1, z), D = (z: number) => p.P(b.u0, b.v1, z);
    p.poly([D(b.z0), C(b.z0), C(b.z1), D(b.z1)], b.col);
    p.poly([C(b.z0), B(b.z0), B(b.z1), C(b.z1)], sh(b.col, 0.72));
    p.poly([A(b.z1), B(b.z1), C(b.z1), D(b.z1)], b.top ?? sh(b.col, 1.18));
  }
}

/** wheels as dark discs at (along, across); the near ones are drawn after the body */
function wheels(p: Iso, f: Facing, ws: [number, number, number][], frame: number, near: boolean, spoke = "#8a8478") {
  for (const [a, c, r] of ws) {
    const [u, v] = tf(f, a, c);
    const [cu, cv] = tf(f, a, 0);
    const isNear = u + v > cu + cv + 1e-6;
    if (isNear !== near) continue;
    const [x, y] = p.P(u, v, r);
    const d = Math.max(2, Math.round(r * 2));
    p.px(x - d / 2, y - d / 2, "#1a1816", d, d);
    if (d >= 3) p.px(x - d / 2 + (frame ? d - 2 : 1), y - d / 2 + (frame ? 1 : d - 2), spoke); // flicker of a spoke or hub
  }
}

/** a horse at along a0..a0+0.2, legs moving with the frame */
function horse(p: Iso, f: Facing, a0: number, c: number, col: string, frame: number, stage: "legs-far" | "body" | "legs-near") {
  const legsAt: [number, number][] = [[a0 + 0.035, c - 0.022], [a0 + 0.035, c + 0.022], [a0 + 0.15, c - 0.022], [a0 + 0.15, c + 0.022]];
  if (stage === "body") {
    drawParts(p, f, [
      { a0: a0 + 0.02, a1: a0 + 0.17, c0: c - 0.03, c1: c + 0.03, z0: 4, z1: 7, col },
      { a0: a0 + 0.15, a1: a0 + 0.21, c0: c - 0.018, c1: c + 0.018, z0: 6, z1: 10, col: sh(col, 0.92), layer: 1 },
    ]);
    return;
  }
  const [cu, cv] = tf(f, a0 + 0.1, c);
  for (const [k, [a, cc]] of legsAt.entries()) {
    const [u, v] = tf(f, a, cc);
    const near = u + v > cu + cv;
    if ((stage === "legs-near") !== near) continue;
    // frame 1: front and back pairs swing apart
    const swing = frame ? (k < 2 ? -0.025 : 0.025) * (k % 2 ? 1 : -1) : 0;
    const [ub, vb] = tf(f, a + swing, cc);
    p.line(p.P(u, v, 4.5), p.P(ub, vb, 0.5), sh(col, 0.75));
  }
}

export interface VehicleSpec {
  kind: "wagon" | "carriage" | "horsecar" | "streetcar" | "auto" | "truck";
  era: number;    // variant by period
  col: string;
  col2: string;
  horse?: string;
  load?: number;  // wagon load variant
}

/** era bucket for motor vehicles */
export function motorEra(year: number): number { return year < 1915 ? 0 : year < 1932 ? 1 : year < 1950 ? 2 : year < 1966 ? 3 : 4; }

/** a street vehicle sprite: facing, animation frame, lit windows */
export function vehicleFig(s: VehicleSpec, f: Facing, frame: number, lit: boolean): Fig {
  const key = `v${s.kind}${s.era}${s.col}${s.col2}${s.horse ?? ""}${s.load ?? 0}${f}${frame}${lit && (s.kind === "streetcar" || s.kind === "horsecar") ? 1 : 0}`;
  return cached(key, () => {
    const p = new Iso(64, 48, 32, 34);
    const glass = lit && (s.kind === "streetcar" || s.kind === "horsecar") ? "#ffd27a" : "#9cb0b8";
    let parts: Part[] = [], ws: [number, number, number][] = [];
    let horseAt: number | null = null;
    const W = (w: number) => [-w, w] as const;
    switch (s.kind) {
      case "wagon": {
        horseAt = 0.08;
        const [c0, c1] = W(0.065);
        parts = [{ a0: -0.2, a1: 0.07, c0, c1, z0: 3, z1: 6, col: s.col }];
        if (s.load === 0) parts.push({ a0: -0.19, a1: 0.04, c0: c0 + 0.005, c1: c1 - 0.005, z0: 6, z1: 11, col: "#e8e0c8", top: "#f4eedc", layer: 1 }); // canvas cover
        else if (s.load === 1) parts.push({ a0: -0.18, a1: 0.05, c0: c0 + 0.01, c1: c1 - 0.01, z0: 6, z1: 7.5, col: "#1e1f24", top: "#2e2f36", layer: 1 }); // coal
        else parts.push({ a0: -0.18, a1: -0.08, c0: c0 + 0.01, c1: c1 - 0.01, z0: 6, z1: 9, col: "#7a5a38", layer: 1 }, { a0: -0.06, a1: 0.04, c0: c0 + 0.01, c1: c1 - 0.01, z0: 6, z1: 9, col: "#6a4a2e", layer: 1 }); // barrels / crates
        ws = [[-0.16, -0.07, 2], [-0.16, 0.07, 2], [0.03, -0.07, 1.6], [0.03, 0.07, 1.6]];
        break;
      }
      case "carriage": {
        horseAt = 0.06;
        parts = [
          { a0: -0.15, a1: 0.0, c0: -0.06, c1: 0.06, z0: 3, z1: 9, col: s.col },
          { a0: -0.15, a1: 0.0, c0: -0.06, c1: 0.06, z0: 9, z1: 10, col: "#141414", layer: 1 },
          { a0: 0.0, a1: 0.06, c0: -0.05, c1: 0.05, z0: 3, z1: 6, col: sh(s.col, 0.8) },
          { a0: 0.01, a1: 0.04, c0: -0.02, c1: 0.02, z0: 6, z1: 9, col: "#1e1e22", layer: 1 }, // the driver
        ];
        ws = [[-0.12, -0.065, 2.2], [-0.12, 0.065, 2.2], [0.03, -0.06, 1.7], [0.03, 0.06, 1.7]];
        break;
      }
      case "horsecar": {
        horseAt = 0.14;
        parts = [
          { a0: -0.2, a1: 0.13, c0: -0.07, c1: 0.07, z0: 2, z1: 5, col: s.col },
          { a0: -0.2, a1: 0.13, c0: -0.07, c1: 0.07, z0: 5, z1: 8, col: glass, layer: 1 },
          { a0: -0.21, a1: 0.14, c0: -0.075, c1: 0.075, z0: 8, z1: 9.5, col: s.col2, layer: 2 },
        ];
        ws = [[-0.12, -0.07, 1.4], [-0.12, 0.07, 1.4], [0.06, -0.07, 1.4], [0.06, 0.07, 1.4]];
        break;
      }
      case "streetcar": {
        const L = s.era >= 1 ? 0.32 : 0.26;
        parts = [
          { a0: -L, a1: L, c0: -0.085, c1: 0.085, z0: 2, z1: 5.5, col: s.col },
          { a0: -L + 0.02, a1: L - 0.02, c0: -0.08, c1: 0.08, z0: 5.5, z1: 8.5, col: glass, layer: 1 },
          { a0: -L, a1: L, c0: -0.085, c1: 0.085, z0: 8.5, z1: 10, col: s.col, top: "#6a6a68", layer: 2 },
          { a0: -L * 0.7, a1: L * 0.7, c0: -0.035, c1: 0.035, z0: 10, z1: 11.5, col: "#4a4a4a", layer: 3 },
        ];
        // window posts
        ws = [[-L + 0.08, -0.08, 1.3], [-L + 0.08, 0.08, 1.3], [L - 0.08, -0.08, 1.3], [L - 0.08, 0.08, 1.3]];
        break;
      }
      case "auto": {
        const e = s.era;
        if (e === 0) {
          parts = [
            { a0: -0.12, a1: 0.07, c0: -0.06, c1: 0.06, z0: 3, z1: 5.5, col: s.col },
            { a0: 0.06, a1: 0.13, c0: -0.045, c1: 0.045, z0: 3, z1: 6, col: sh(s.col, 0.9) },
            { a0: -0.11, a1: -0.04, c0: -0.055, c1: 0.055, z0: 5.5, z1: 9, col: "#3a2420", layer: 1 }, // tall buttoned seat
            { a0: -0.03, a1: 0.0, c0: -0.03, c1: 0.03, z0: 5.5, z1: 9, col: "#1e1e22", layer: 1 }, // the driver
          ];
          ws = [[-0.09, -0.065, 2.4], [-0.09, 0.065, 2.4], [0.08, -0.065, 2.2], [0.08, 0.065, 2.2]];
        } else if (e === 1) {
          parts = [
            { a0: -0.15, a1: 0.15, c0: -0.065, c1: 0.065, z0: 2, z1: 5, col: s.col },
            { a0: -0.13, a1: 0.03, c0: -0.06, c1: 0.06, z0: 5, z1: 8.5, col: glass, layer: 1 },
            { a0: -0.14, a1: 0.04, c0: -0.065, c1: 0.065, z0: 8.5, z1: 9.5, col: s.col, layer: 2 },
          ];
          ws = [[-0.1, -0.068, 1.9], [-0.1, 0.068, 1.9], [0.1, -0.068, 1.9], [0.1, 0.068, 1.9]];
        } else if (e === 2) {
          parts = [
            { a0: -0.17, a1: 0.17, c0: -0.075, c1: 0.075, z0: 2, z1: 5, col: s.col },
            { a0: -0.1, a1: 0.05, c0: -0.06, c1: 0.06, z0: 5, z1: 7.5, col: glass, layer: 1 },
            { a0: -0.09, a1: 0.04, c0: -0.062, c1: 0.062, z0: 7.5, z1: 8.5, col: s.col, layer: 2 },
          ];
          ws = [[-0.11, -0.078, 1.6], [-0.11, 0.078, 1.6], [0.11, -0.078, 1.6], [0.11, 0.078, 1.6]];
        } else if (e === 4) {
          // the long, square sedans of the seventies (a vinyl roof on some)
          parts = [
            { a0: -0.21, a1: 0.21, c0: -0.08, c1: 0.08, z0: 1.8, z1: 4.4, col: s.col },
            { a0: -0.1, a1: 0.07, c0: -0.072, c1: 0.072, z0: 4.4, z1: 6.6, col: glass, layer: 1 },
            { a0: -0.09, a1: 0.05, c0: -0.072, c1: 0.072, z0: 6.6, z1: 7.4, col: s.col2, layer: 2 },
          ];
          ws = [[-0.14, -0.082, 1.4], [-0.14, 0.082, 1.4], [0.14, -0.082, 1.4], [0.14, 0.082, 1.4]];
        } else {
          parts = [
            { a0: -0.2, a1: 0.2, c0: -0.08, c1: 0.08, z0: 1.8, z1: 4.6, col: s.col },
            { a0: -0.2, a1: -0.15, c0: -0.08, c1: -0.06, z0: 4.6, z1: 5.6, col: s.col, layer: 1 }, // fins
            { a0: -0.2, a1: -0.15, c0: 0.06, c1: 0.08, z0: 4.6, z1: 5.6, col: s.col, layer: 1 },
            { a0: -0.09, a1: 0.07, c0: -0.07, c1: 0.07, z0: 4.6, z1: 6.8, col: glass, layer: 1 },
            { a0: -0.08, a1: 0.05, c0: -0.07, c1: 0.07, z0: 6.8, z1: 7.6, col: s.col2, layer: 2 },
          ];
          ws = [[-0.13, -0.082, 1.4], [-0.13, 0.082, 1.4], [0.13, -0.082, 1.4], [0.13, 0.082, 1.4]];
        }
        break;
      }
      case "truck": {
        const e = s.era;
        if (e <= 1) {
          parts = [
            { a0: 0.11, a1: 0.2, c0: -0.055, c1: 0.055, z0: 2, z1: 6, col: s.col },
            { a0: 0.02, a1: 0.11, c0: -0.07, c1: 0.07, z0: 2, z1: 7, col: s.col },
            { a0: 0.03, a1: 0.11, c0: -0.065, c1: 0.065, z0: 7, z1: 9.5, col: glass, layer: 1 },
            { a0: 0.02, a1: 0.11, c0: -0.07, c1: 0.07, z0: 9.5, z1: 10.5, col: sh(s.col, 0.8), layer: 2 },
            { a0: -0.22, a1: 0.015, c0: -0.08, c1: 0.08, z0: 3, z1: 6, col: "#8a6a48" },
            { a0: -0.2, a1: -0.02, c0: -0.06, c1: 0.06, z0: 6, z1: 8, col: s.col2, layer: 1 },
          ];
          ws = [[-0.16, -0.08, 2], [-0.16, 0.08, 2], [0.14, -0.07, 2], [0.14, 0.07, 2]];
        } else if (e === 2) {
          parts = [
            { a0: 0.14, a1: 0.25, c0: -0.06, c1: 0.06, z0: 2, z1: 6.5, col: s.col },
            { a0: 0.04, a1: 0.14, c0: -0.08, c1: 0.08, z0: 2, z1: 7, col: s.col },
            { a0: 0.05, a1: 0.14, c0: -0.075, c1: 0.075, z0: 7, z1: 9.5, col: glass, layer: 1 },
            { a0: 0.04, a1: 0.14, c0: -0.08, c1: 0.08, z0: 9.5, z1: 10.5, col: s.col, layer: 2 },
            { a0: -0.26, a1: 0.03, c0: -0.09, c1: 0.09, z0: 2.5, z1: 11.5, col: s.col2 },
          ];
          ws = [[-0.2, -0.09, 2], [-0.2, 0.09, 2], [0.17, -0.08, 2], [0.17, 0.08, 2]];
        } else {
          parts = [
            { a0: 0.22, a1: 0.36, c0: -0.08, c1: 0.08, z0: 2, z1: 8, col: s.col },
            { a0: 0.23, a1: 0.3, c0: -0.075, c1: 0.075, z0: 8, z1: 10.5, col: glass, layer: 1 },
            { a0: 0.22, a1: 0.31, c0: -0.08, c1: 0.08, z0: 10.5, z1: 12, col: s.col, layer: 2 },
            { a0: -0.4, a1: 0.2, c0: -0.09, c1: 0.09, z0: 3, z1: 13, col: s.col2, top: sh(s.col2, 1.1) },
          ];
          ws = [[-0.34, -0.09, 1.8], [-0.34, 0.09, 1.8], [-0.27, -0.09, 1.8], [-0.27, 0.09, 1.8], [0.3, -0.08, 1.8], [0.3, 0.08, 1.8], [0.25, -0.08, 1.8], [0.25, 0.08, 1.8]];
        }
        break;
      }
    }
    if (horseAt !== null) horse(p, f, horseAt, 0, s.horse ?? "#5a3a22", frame, "legs-far");
    wheels(p, f, ws, frame, false);
    // horse in front of the body or behind it, by depth
    const [hu, hv] = tf(f, (horseAt ?? 0) + 0.1, 0);
    const horseFirst = horseAt !== null && hu + hv < 0;
    if (horseAt !== null && horseFirst) { horse(p, f, horseAt, 0, s.horse ?? "#5a3a22", frame, "body"); horse(p, f, horseAt, 0, s.horse ?? "#5a3a22", frame, "legs-near"); }
    drawParts(p, f, parts);
    wheels(p, f, ws, frame, true);
    if (horseAt !== null && !horseFirst) { horse(p, f, horseAt, 0, s.horse ?? "#5a3a22", frame, "body"); horse(p, f, horseAt, 0, s.horse ?? "#5a3a22", frame, "legs-near"); }
    if (s.kind === "streetcar") {
      // the trolley pole, trailing up to the wire
      const L = s.era >= 1 ? 0.32 : 0.26;
      const [u0, v0] = tf(f, -L * 0.4, 0), [u1, v1] = tf(f, -L - 0.1, 0);
      p.line(p.P(u0, v0, 11.5), p.P(u1, v1, 22), "#2a2a2a");
    }
    if (s.kind === "auto" && s.era >= 3) {
      // chrome trim along the side
      const [u0, v0] = tf(f, -0.19, 0.081), [u1, v1] = tf(f, 0.19, 0.081);
      const [u2, v2] = tf(f, -0.19, -0.081), [u3, v3] = tf(f, 0.19, -0.081);
      const nearSide = u0 + v0 > u2 + v2 ? [[u0, v0], [u1, v1]] : [[u2, v2], [u3, v3]];
      p.line(p.P(nearSide[0][0], nearSide[0][1], 3.6), p.P(nearSide[1][0], nearSide[1][1], 3.6), "#d8d8d0");
    }
    return p.done();
  });
}

/** where the front (head lamps) of a vehicle is, along its length (tile units) */
export function frontOf(kind: string, era: number): number {
  switch (kind) {
    case "auto": return [0.13, 0.15, 0.17, 0.2, 0.21][era];
    case "truck": return era <= 1 ? 0.2 : era === 2 ? 0.25 : 0.36;
    case "streetcar": return era >= 1 ? 0.32 : 0.26;
    case "horsecar": return 0.13;
    default: return 0.1;
  }
}

// ---------------------------------------------------------------- live oriented boxes (trains, boats)

/**
 * A box at tile position (cx, cy) on ground height `base` (screen y at that point = by), oriented along
 * (dx, dy) in tile space: length L, width W (tiles), from z0 to z1 px above the ground. sx, sy: screen
 * point of the centre on the ground; k: zoom. Draws the faces the viewer can see, then the top.
 */
export function obox(ctx: CanvasRenderingContext2D, sx: number, sy: number, k: number, dx: number, dy: number, a0: number, a1: number, c0: number, c1: number, z0: number, z1: number, col: string, top?: string) {
  const nx = -dy, ny = dx;
  // corners in tile offsets → screen offsets
  const X = (a: number, c: number) => (dx * a + nx * c - (dy * a + ny * c)) * 32 * k;
  const Y = (a: number, c: number) => (dx * a + nx * c + (dy * a + ny * c)) * 16 * k;
  const cs: [number, number][] = [[a0, c0], [a1, c0], [a1, c1], [a0, c1]];
  const px = cs.map(([a, c]) => sx + X(a, c)), py = cs.map(([a, c]) => sy + Y(a, c));
  const zb = z0 * k, zt = z1 * k;
  // outward normals of the four sides: -n (c0 side), +d (a1 end), +n (c1 side), -d (a0 end)
  const norms: [number, number][] = [[-nx, -ny], [dx, dy], [nx, ny], [-dx, -dy]];
  // edges: side k joins corner k and k+1 in this order: (a0,c0)-(a1,c0) is the c0 side, etc.
  const edgeNormal = [norms[0], norms[1], norms[2], norms[3]];
  for (let e = 0; e < 4; e++) {
    const [ex, ey] = edgeNormal[e];
    if (ex + ey <= 0.001) continue; // faces away from the viewer
    const i = e, j = (e + 1) % 4;
    const light = (ey - ex) * 0.7071; // light from screen-left
    ctx.fillStyle = sh(col, Math.max(0.55, Math.min(1.05, 0.84 + 0.18 * light)));
    ctx.beginPath();
    ctx.moveTo(px[i], py[i] - zb); ctx.lineTo(px[j], py[j] - zb); ctx.lineTo(px[j], py[j] - zt); ctx.lineTo(px[i], py[i] - zt);
    ctx.closePath(); ctx.fill();
  }
  ctx.fillStyle = top ?? sh(col, 1.18);
  ctx.beginPath();
  ctx.moveTo(px[0], py[0] - zt); ctx.lineTo(px[1], py[1] - zt); ctx.lineTo(px[2], py[2] - zt); ctx.lineTo(px[3], py[3] - zt);
  ctx.closePath(); ctx.fill();
}

/** screen offset of a point (along a, across c) of a body oriented along (dx, dy), at height z px */
export function ooff(k: number, dx: number, dy: number, a: number, c: number, z = 0): [number, number] {
  const ox = dx * a - dy * c, oy = dy * a + dx * c;
  return [(ox - oy) * 32 * k, (ox + oy) * 16 * k - z * k];
}

const glowCache = new Map<string, HTMLCanvasElement>();
/** a soft additive glow sprite (64 px), by colour "r,g,b" */
export function glowSprite(rgb: string): HTMLCanvasElement {
  let c = glowCache.get(rgb);
  if (!c) {
    c = document.createElement("canvas");
    c.width = c.height = 64;
    const x = c.getContext("2d")!;
    const g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, `rgba(${rgb},1)`); g.addColorStop(0.25, `rgba(${rgb},0.45)`); g.addColorStop(1, `rgba(${rgb},0)`);
    x.fillStyle = g; x.fillRect(0, 0, 64, 64);
    glowCache.set(rgb, c);
  }
  return c;
}
