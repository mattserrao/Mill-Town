// The "Cities & neighbourhoods" overlay: city and borough limits (gold, thick) and neighbourhood boundaries
// (light, thin) drawn over the live map, with their names; the selected neighbourhood is outlined.

import { cityKey, cityName, districts, zoneName } from "../core/districts";
import type { GameState } from "../core/game";
import { GROUPS } from "../core/ancestry";
import { type GameMap, vh } from "../core/map";
import { zoneCensus } from "../core/town";
import { type Camera, heightAt, placeLabelRects, project } from "./iso";

let pathCache: { m: GameMap; key: string; city: Path2D; nb: Path2D } | null = null;
let selCache: { m: GameMap; zone: number; path: Path2D } | null = null;
let censusCache: { g: GameState; version: number; dom: { group: number; pop: number }[] } | null = null;

type Seg = [number, number, number, number];

/**
 * Join unit tile-edge segments into polylines (walking vertex to vertex; chains break at junctions),
 * so the staircase can be smoothed instead of drawn edge by edge.
 */
function chains(edges: Seg[]): { pts: [number, number][]; closed: boolean }[] {
  const K = (x: number, y: number) => x * 65536 + y;
  const adj = new Map<number, number[]>();
  edges.forEach(([x0, y0, x1, y1], e) => {
    for (const k of [K(x0, y0), K(x1, y1)]) { const a = adj.get(k); if (a) a.push(e); else adj.set(k, [e]); }
  });
  const used = new Uint8Array(edges.length);
  const out: { pts: [number, number][]; closed: boolean }[] = [];
  const walk = (e0: number, fromX: number, fromY: number) => {
    const pts: [number, number][] = [[fromX, fromY]];
    let e = e0, x = fromX, y = fromY;
    for (;;) {
      used[e] = 1;
      const [x0, y0, x1, y1] = edges[e];
      [x, y] = x0 === x && y0 === y ? [x1, y1] : [x0, y0];
      pts.push([x, y]);
      const nb = adj.get(K(x, y))!;
      if (nb.length !== 2) break; // end or junction
      const nx = nb[0] === e ? nb[1] : nb[0];
      if (used[nx]) break;
      e = nx;
    }
    const closed = pts.length > 3 && pts[0][0] === x && pts[0][1] === y;
    out.push({ pts, closed });
  };
  // open chains first (start at ends and junctions), then the remaining loops
  for (const [k, list] of adj) if (list.length !== 2) for (const e of list) if (!used[e]) walk(e, Math.floor(k / 65536), k % 65536);
  edges.forEach((sg, e) => { if (!used[e]) walk(e, sg[0], sg[1]); });
  return out;
}

/**
 * Smooth a tile-edge staircase: take segment midpoints (which turn 1-tile stairs into straight
 * diagonals), then Chaikin corner-cutting. Open chains keep their end points so lines still meet.
 */
function smooth(pts: [number, number][], closed: boolean): [number, number][] {
  if (pts.length < 3) return pts;
  const ring = closed ? pts.slice(0, -1) : pts;
  const n = ring.length;
  let p: [number, number][] = [];
  if (!closed) p.push(ring[0]);
  for (let k = 0; k < (closed ? n : n - 1); k++) {
    const a = ring[k], b = ring[(k + 1) % n];
    p.push([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]);
  }
  if (!closed) p.push(ring[n - 1]);
  // a light 3-tap relax evens out longer wobbles (e.g. 2-1-2-1 stairs) before rounding the corners
  for (let it = 0; it < 2; it++) {
    const q = p.map((c, k): [number, number] => {
      if (!closed && (k === 0 || k === p.length - 1)) return c;
      const a = p[(k - 1 + p.length) % p.length], b = p[(k + 1) % p.length];
      return [(a[0] + 2 * c[0] + b[0]) / 4, (a[1] + 2 * c[1] + b[1]) / 4];
    });
    p = q;
  }
  for (let it = 0; it < 2; it++) {
    const q: [number, number][] = [];
    const m = p.length;
    if (!closed) q.push(p[0]);
    for (let k = 0; k < (closed ? m : m - 1); k++) {
      const a = p[k], b = p[(k + 1) % m];
      q.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25], [a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75]);
    }
    if (!closed) q.push(p[m - 1]);
    p = q;
  }
  if (closed) p.push(p[0]);
  return p;
}

function edgePath(m: GameMap, edges: Seg[]): Path2D {
  const p = new Path2D();
  for (const ch of chains(edges)) {
    const pts = smooth(ch.pts, ch.closed);
    pts.forEach(([x, y], k) => {
      const [sx, sy] = project(x, y, heightAt(m, x, y) + 1);
      if (k) p.lineTo(sx, sy); else p.moveTo(sx, sy);
    });
  }
  return p;
}

function paths(m: GameMap, year: number) {
  const d = districts(m);
  // the city map only changes at incorporations and annexations
  const key = d.munis.map((_, k) => cityKey(d, k, year)).join(",") + "|" + d.munis.map((mu) => (year < mu.incorporated ? 0 : 1)).join("");
  if (pathCache && pathCache.m === m && pathCache.key === key) return pathCache;
  const W = m.width, H = m.height, city: Seg[] = [], nb: Seg[] = [];
  const ck = (i: number) => cityKey(d, d.muni[i], year);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x;
    if (d.zone[i] < 0) continue;
    for (const [dx, dy] of [[1, 0], [0, 1]]) {
      const xx = x + dx, yy = y + dy;
      if (xx >= W || yy >= H) continue;
      const j = yy * W + xx;
      if (d.zone[j] < 0) continue;
      const seg: Seg = dx ? [x + 1, y, x + 1, y + 1] : [x, y + 1, x + 1, y + 1];
      if (ck(i) !== ck(j)) city.push(seg);
      else if (d.nb[i] !== d.nb[j] && (d.nb[i] >= 0 || d.nb[j] >= 0)) nb.push(seg);
    }
  }
  pathCache = { m, key, city: edgePath(m, city), nb: edgePath(m, nb) };
  return pathCache;
}

function selectedPath(m: GameMap, zone: number): Path2D {
  if (selCache && selCache.m === m && selCache.zone === zone) return selCache.path;
  const d = districts(m), W = m.width, H = m.height, e: Seg[] = [];
  for (let k = d.zoneStart[zone]; k < d.zoneStart[zone + 1]; k++) {
    const i = d.zoneTiles[k], x = i % W, y = (i / W) | 0;
    const other = (xx: number, yy: number) => xx < 0 || yy < 0 || xx >= W || yy >= H || d.zone[yy * W + xx] !== zone;
    if (other(x + 1, y)) e.push([x + 1, y, x + 1, y + 1]);
    if (other(x - 1, y)) e.push([x, y, x, y + 1]);
    if (other(x, y + 1)) e.push([x, y + 1, x + 1, y + 1]);
    if (other(x, y - 1)) e.push([x, y, x + 1, y]);
  }
  selCache = { m, zone, path: edgePath(m, e) };
  return selCache.path;
}

/** the biggest community in each named neighbourhood (refreshed when the town changes) */
function dominant(g: GameState) {
  if (censusCache && censusCache.g === g && censusCache.version === g.world.version) return censusCache.dom;
  const d = districts(g.map), cen = zoneCensus(g.map, g.world);
  const dom = d.nbs.map((_, z) => {
    const c = cen[z];
    if (!c) return { group: 0, pop: 0 };
    let best = 0;
    for (let k = 1; k < GROUPS.length; k++) if (c.pop[k] > c.pop[best]) best = k;
    return { group: c.tot && c.pop[best] / c.tot > 0.3 ? best : 0, pop: c.tot };
  });
  censusCache = { g, version: g.world.version, dom };
  return dom;
}

export interface Rect { x: number; y: number; w: number; h: number }

/** `reserved`: canvas-pixel rectangles to keep labels off (minimap, zoom buttons), as passed to drawSupply. */
export function drawDistricts(ctx: CanvasRenderingContext2D, cam: Camera, g: GameState, selectedZone: number, reserved: Rect[] = []) {
  const m = g.map, d = districts(m), year = g.world.year;
  const p = paths(m, year);
  const z = cam.zoom;
  ctx.save();
  ctx.setTransform(z, 0, 0, z, -cam.x * z, -cam.y * z);
  ctx.lineCap = "round"; ctx.lineJoin = "round";
  // neighbourhoods: thin, dashed and translucent so they sit back; city limits: solid gold, calmer than before
  ctx.strokeStyle = "rgba(12,12,16,0.4)"; ctx.lineWidth = 3 / z; ctx.stroke(p.nb);
  ctx.strokeStyle = "rgba(240,240,234,0.78)"; ctx.lineWidth = 1.3 / z; ctx.setLineDash([6 / z, 5 / z]); ctx.stroke(p.nb);
  ctx.setLineDash([]);
  ctx.strokeStyle = "rgba(20,16,8,0.45)"; ctx.lineWidth = 4.5 / z; ctx.stroke(p.city);
  ctx.strokeStyle = "rgba(255,214,90,0.85)"; ctx.lineWidth = 2 / z; ctx.stroke(p.city);
  if (selectedZone >= 0) {
    ctx.strokeStyle = "rgba(10,30,16,0.5)"; ctx.lineWidth = 4.5 / z; ctx.stroke(selectedPath(m, selectedZone));
    ctx.strokeStyle = "#7ef0a0"; ctx.lineWidth = 2.5 / z; ctx.stroke(selectedPath(m, selectedZone));
  }
  ctx.restore();
  // names
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  const S = (x: number, y: number): [number, number] => { const [wx, wy] = project(x + 0.5, y + 0.5, vh(m, Math.max(0, Math.min(m.width, x)), Math.max(0, Math.min(m.height, y))) + 8); return [(wx - cam.x) * z, (wy - cam.y) * z]; };
  const W = ctx.canvas.width, Hh = ctx.canvas.height, MG = 6;
  // labels are placed greedily (cities first, then neighbourhoods), kept inside the canvas, and
  // skipped when they would collide with one already placed or with reserved UI (minimap etc.)
  const placed: { x: number; y: number; w: number; h: number }[] = reserved.map((r) => ({ ...r }));
  const hitsIn = (list: Rect[], x: number, y: number, w: number, h: number) => list.some((p) => x < p.x + p.w + 2 && x + w + 2 > p.x && y < p.y + p.h + 2 && y + h + 2 > p.y);
  // hard: other overlay labels and reserved UI; soft: the map's place names underneath (avoided if possible)
  const hits = (x: number, y: number, w: number, h: number, soft: boolean) => hitsIn(placed, x, y, w, h) || (soft && hitsIn(placeLabelRects, x, y, w, h));
  const draws: (() => void)[] = [];
  const label = (text: string, sub: string, x: number, y: number, big: boolean, dot?: string) => {
    const [ax, ay] = S(x, y);
    if (ax < -60 || ay < -30 || ax > W + 60 || ay > Hh + 30) return;
    ctx.font = big ? "bold 15px Georgia, serif" : "italic 12px Georgia, serif";
    const tw = ctx.measureText(text).width;
    ctx.font = "10px monospace";
    const sw = sub && !big ? ctx.measureText(sub).width : 0;
    const bw = Math.ceil(Math.max(tw + (dot ? 10 : 0), sw) + 12), bh = big ? 22 : sub ? 30 : 18;
    if (bw > W - 2 * MG) return;
    // box centred on the anchor (text row), then clamped inside the canvas
    const bx = Math.round(Math.max(MG, Math.min(W - MG - bw, ax - bw / 2)));
    const by0 = Math.round(Math.max(MG, Math.min(Hh - MG - bh, ay - (big ? 11 : 9))));
    // try the spot itself, then small nudges up and down
    let by = -1;
    for (const soft of [true, false]) for (const dy of [0, -(bh + 3), bh + 3]) {
      const yy = by0 + dy;
      if (by >= 0 || yy < MG || yy + bh > Hh - MG) continue;
      if (!hits(bx, yy, bw, bh, soft)) by = yy;
    }
    if (by < 0) return;
    placed.push({ x: bx, y: by, w: bw, h: bh });
    draws.push(() => {
      const cx = bx + bw / 2, ty = by + (big ? 11 : 9);
      ctx.fillStyle = "rgba(15,15,18,0.72)"; ctx.fillRect(bx, by, bw, bh);
      ctx.font = big ? "bold 15px Georgia, serif" : "italic 12px Georgia, serif";
      ctx.fillStyle = big ? "#ffd65a" : "#f0f0f0"; ctx.fillText(text, cx + (dot ? 5 : 0), ty);
      if (dot) { ctx.fillStyle = dot; ctx.beginPath(); ctx.arc(cx - tw / 2 - 1, ty, 4, 0, 7); ctx.fill(); }
      if (sub && !big) { ctx.font = "10px monospace"; ctx.fillStyle = "#b8bcc4"; ctx.fillText(sub, cx, ty + 13); }
    });
  };
  d.munis.forEach((mu, k) => {
    if (cityKey(d, k, year) !== k) return; // annexed: its land is labelled by the city that took it
    label(cityName(d, k, year).toUpperCase(), "", mu.x, mu.y - 6, true);
  });
  if (z >= 0.1875) {
    const dom = dominant(g);
    d.nbs.forEach((n, k) => {
      const zn = zoneName(d, k, year);
      const dm = dom[k];
      label(zn.name, dm && dm.pop > 50 ? `${Math.round(dm.pop).toLocaleString()}${dm.group ? ` · ${GROUPS[dm.group].name.split(" ")[0]}` : ""}` : "", n.x, n.y, false, dm?.group ? `rgb(${GROUPS[dm.group].colour.join(",")})` : undefined);
    });
  }
  // neighbourhoods underneath, city names on top
  for (let k = draws.length - 1; k >= 0; k--) draws[k]();
  ctx.restore();
}
