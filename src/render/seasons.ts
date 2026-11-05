// v0.31: the seasons on the map. The turns already run spring, summer, autumn, winter; now the map shows them —
// the woods turn (oak russet, maple red and orange, sycamore yellow-brown, sumac crimson) and drop their leaves,
// snow lies on the ground and the roofs (greyed by the soot near the works), the paving is slushy, and the river
// freezes at its edges. Spring and summer share the green look. Sprites are recoloured per look and cached; the
// ground is recoloured per pixel in the chunk raster.

import { tileNoise } from "../core/rng";
import type { SpriteBuf } from "./sprites";

/** 0 green (spring, summer), 1 autumn, 2 winter */
export type SeasonLook = 0 | 1 | 2;
export function seasonLook(turn: number): SeasonLook {
  const s = ((turn % 4) + 4) % 4;
  return s === 2 ? 1 : s === 3 ? 2 : 0;
}

const UNLIT = 0x1000000;
const hash = (x: number, y: number, k: number) => tileNoise(x, y, k, 2);
const R = (c: number) => (c >> 16) & 255, G = (c: number) => (c >> 8) & 255, B = (c: number) => c & 255;
const rgb = (r: number, g: number, b: number) => (Math.max(0, Math.min(255, Math.round(r))) << 16) | (Math.max(0, Math.min(255, Math.round(g))) << 8) | Math.max(0, Math.min(255, Math.round(b)));
const mix = (a: number, b: number, t: number) => rgb(R(a) + (R(b) - R(a)) * t, G(a) + (G(b) - G(a)) * t, B(a) + (B(b) - B(a)) * t);
const hex = (s: string) => parseInt(s.slice(1), 16);

const SNOW = 0xe4e9ee, SNOW2 = 0xd2d9e2, SOOT_SNOW = 0x9c9a96;

export interface GroundCtx {
  /** 0..1 soot on the snow (the tile's pollution) */
  soot: number;
  /** a paved or trodden street tile */
  street: boolean;
  /** a cliff face: snow only on the ledges */
  steep: boolean;
  /** a water tile with land beside it (it freezes at its edges in winter) */
  bank: boolean;
  /** on a bank tile: how far (in tiles) a point is from the land beside it */
  shoreD?: (u: number, v: number) => number;
}

/** the ground in autumn and winter */
export function seasonGround(inner: (u: number, v: number, h: number, gx: number, gy: number) => number, look: SeasonLook, cx: GroundCtx) {
  if (look === 0) return inner;
  return (u: number, v: number, h: number, gx: number, gy: number) => {
    const c0 = inner(u, v, h, gx, gy), c = c0 & 0xffffff, fl = c0 & UNLIT;
    const r = R(c), g = G(c), b = B(c);
    const water = fl !== 0 || b > r + 25;
    if (look === 1) {
      if (water) return c0;
      // autumn: the grass goes tawny, leaves lie under the trees
      if (g > r + 6 && g > b) {
        const lf = hash(gx, gy, 1201);
        if (lf < 0.05) return fl | [0xa0501e, 0xc07028, 0x8a3e1a, 0xb89038][Math.floor(hash(gx >> 1, gy, 1202) * 4)];
        return fl | rgb(r * 0.85 + g * 0.22, g * 0.86, b * 0.8);
      }
      return c0;
    }
    // winter
    if (water) {
      // ice along the banks and in the creeks: floes with darker cracks
      if (cx.bank || fl === 0 || b > r + 25) {
        const n = hash(gx >> 2, gy >> 1, 1203);
        if (fl && !cx.bank) return fl | (n < 0.7 ? 0xc8d6e0 : 0xa8bac8); // a creek
        // shore ice: big plates broken by dark cracks, only on the bank tiles
        const f = hash(gx >> 3, gy >> 2, 1209);
        if (cx.bank && cx.shoreD && cx.shoreD(u, v) < 0.18 + f * 0.3) {
          if ((gx & 15) === 0 || (gy & 7) === 0) return fl | 0x8aa0b0;
          return fl | (hash(gx >> 1, gy, 1204) < 0.12 ? 0xbccad6 : 0xd6e2ea);
        }
        void n;
      }
      return c0;
    }
    const grey = Math.abs(r - g) < 12 && Math.abs(g - b) < 14;
    if (cx.street && grey) {
      // paving: slush in the wheel ruts, a dusting at the sides
      return fl | (hash(gx, gy, 1205) < 0.35 ? mix(c, 0x6a625a, 0.4) : mix(c, SNOW, 0.35));
    }
    if (cx.steep && hash(gx >> 1, gy, 1206) < 0.45) return c0; // rock shows through on the faces
    if (grey && r < 70) return c0; // dark stone, cinders: the snow melts off
    let s = hash(gx, gy, 1207) < 0.18 ? SNOW2 : SNOW;
    if (cx.soot > 0.05) s = mix(s, SOOT_SNOW, Math.min(0.75, cx.soot * 0.8));
    // furrows and tufts still show through a little
    if (hash(gx >> 1, gy >> 1, 1208) < 0.06) s = mix(s, c, 0.5);
    return fl | s;
  };
}

// ------------------------------------------------------------------- sprites

const LEAF_AUTUMN: Record<string, number[]> = {
  oak: ["#5e3218", "#7a4220", "#94562a", "#b0703a"].map(hex),
  maple: ["#8a2216", "#b23a1c", "#d4602a", "#e89a38"].map(hex),
  sycamore: ["#7a5a26", "#9a7a2e", "#b89a40", "#d4b85a"].map(hex),
  sumac: ["#781616", "#a02420", "#c43a2a", "#d8603a"].map(hex),
  bush: ["#6a4a22", "#8a6028", "#a87a34", "#c49a48"].map(hex),
  sick: ["#6a5a2a", "#86702e", "#a08838", "#b8a04a"].map(hex),
};
const CONIFER = /^tree:(pine|hemlock)/;
const NO_SNOW = /^(lamp:|smoke:|boat:|bridge:|wire:|glow)/;
const ROOFS = new Set(["#5b4636", "#4b4a4f", "#6a3d30", "#57524a", "#3e4248"].map(hex));

/** a sprite's look in autumn or winter (null: unchanged) */
export function seasonSprite(key: string, sb: SpriteBuf, look: SeasonLook): SpriteBuf | null {
  if (look === 0) return null;
  const isTree = key.startsWith("tree:");
  if (look === 1 && !isTree && !(key.startsWith("H|") || key.startsWith("P|"))) return null;
  if (!isTree && NO_SNOW.test(key)) return null;
  const { w, h } = sb;
  const px = new Uint32Array(sb.px);
  const kv = key.length * 7 + key.charCodeAt(key.length - 1);
  if (isTree) {
    const sp = key.slice(5).replace(/\d+$/, "");
    if (CONIFER.test(key)) {
      if (look === 1) return null;
      snowCaps(px, w, h, 0.65);
      return { ...sb, px };
    }
    const pal = LEAF_AUTUMN[sp] ?? LEAF_AUTUMN.oak;
    // each tree turns a little on its own: some still part green, some further along
    const lag = ((kv * 37) % 100) / 100;
    for (let i = 0; i < px.length; i++) {
      const p = px[i], a = p >>> 24;
      if (!a) continue;
      const r = p & 255, g = (p >> 8) & 255, b = (p >> 16) & 255;
      if (!(g > r + 6 && g > b)) continue; // bark, branches, fruit
      const L = Math.min(3, Math.floor(((r + g + b) / 3 / 150) * 4));
      if (look === 1) {
        if (lag < 0.2 && hash(i % w, (i / w) | 0, 1210 + kv) < 0.4) continue; // not turned yet
        const c = pal[L];
        px[i] = (a << 24) | (B(c) << 16) | (G(c) << 8) | R(c);
      } else {
        // bare: a thin tracery of twigs where the crown was
        const x = i % w, y = (i / w) | 0;
        if (hash(x, y, 1211 + kv) < 0.2) px[i] = (a << 24) | (0x40 << 16) | (0x4a << 8) | 0x58;
        else px[i] = 0;
      }
    }
    if (look === 2) snowCaps(px, w, h, 0.3);
    return { ...sb, px };
  }
  // the yard trees, lawns and gardens drawn into the houses and works turn and fall too
  for (let i = 0; i < px.length; i++) {
    const p = px[i], a = p >>> 24;
    if (!a) continue;
    const r = p & 255, g = (p >> 8) & 255, b = (p >> 16) & 255;
    if (!(g > r + 6 && g > b)) continue;
    const L = Math.min(3, Math.floor(((r + g + b) / 3 / 150) * 4));
    const x = i % w, y = (i / w) | 0;
    let c: number;
    if (look === 1) c = (hash(x >> 1, y >> 1, 1213 + kv) < 0.5 ? LEAF_AUTUMN.oak : LEAF_AUTUMN.maple)[L];
    else c = hash(x, y, 1214 + kv) < 0.2 ? 0x584a40 : L >= 2 ? SNOW : SNOW2;
    px[i] = (a << 24) | (B(c) << 16) | (G(c) << 8) | R(c);
  }
  if (look === 1) return { ...sb, px };
  // winter on buildings, works and the rest: snow on the roofs (their colours) and along every top edge
  for (let i = 0; i < px.length; i++) {
    const p = px[i], a = p >>> 24;
    if (a < 128) continue;
    const c = ((p & 255) << 16) | (((p >> 8) & 255) << 8) | ((p >> 16) & 255);
    if (ROOFS.has(c)) { const s = mix(c, SNOW, 0.72); px[i] = (a << 24) | (B(s) << 16) | (G(s) << 8) | R(s); }
  }
  snowCaps(px, w, h, 1);
  return { ...sb, px };
}

/** snow on whatever faces up: the first pixel or two of each run of opaque pixels down a column */
function snowCaps(px: Uint32Array, w: number, h: number, p: number) {
  for (let x = 0; x < w; x++) {
    let open = true, run = 0;
    for (let y = 0; y < h; y++) {
      const i = y * w + x, a = px[i] >>> 24;
      if (a < 128) { open = true; run = 0; continue; }
      if (open) { run = hash(x, y, 1212) < p ? 2 : 0; open = false; }
      if (run > 0) {
        const c = run === 2 ? SNOW : SNOW2;
        px[i] = (a << 24) | (B(c) << 16) | (G(c) << 8) | R(c);
        run--;
      }
    }
  }
}
