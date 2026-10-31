// The "Cities & neighbourhoods" overlay: city and borough limits (gold, thick) and neighbourhood boundaries
// (light, thin) drawn over the live map, with their names; the selected neighbourhood is outlined.

import { cityKey, cityName, districts, zoneName } from "../core/districts";
import type { GameState } from "../core/game";
import { GROUPS } from "../core/ancestry";
import { type GameMap, vh } from "../core/map";
import { zoneCensus } from "../core/town";
import { type Camera, project } from "./iso";

let pathCache: { m: GameMap; key: string; city: Path2D; nb: Path2D } | null = null;
let selCache: { m: GameMap; zone: number; path: Path2D } | null = null;
let censusCache: { version: number; dom: { group: number; pop: number }[] } | null = null;

function edgePath(m: GameMap, edges: [number, number, number, number][]): Path2D {
  const p = new Path2D();
  for (const [x0, y0, x1, y1] of edges) {
    const [ax, ay] = project(x0, y0, vh(m, x0, y0) + 1), [bx, by] = project(x1, y1, vh(m, x1, y1) + 1);
    p.moveTo(ax, ay); p.lineTo(bx, by);
  }
  return p;
}

function paths(m: GameMap, year: number) {
  const d = districts(m);
  // the city map only changes at incorporations and annexations
  const key = d.munis.map((_, k) => cityKey(d, k, year)).join(",") + "|" + d.munis.map((mu) => (year < mu.incorporated ? 0 : 1)).join("");
  if (pathCache && pathCache.m === m && pathCache.key === key) return pathCache;
  const W = m.width, H = m.height, city: [number, number, number, number][] = [], nb: [number, number, number, number][] = [];
  const ck = (i: number) => cityKey(d, d.muni[i], year);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x;
    if (d.zone[i] < 0) continue;
    for (const [dx, dy] of [[1, 0], [0, 1]]) {
      const xx = x + dx, yy = y + dy;
      if (xx >= W || yy >= H) continue;
      const j = yy * W + xx;
      if (d.zone[j] < 0) continue;
      const seg: [number, number, number, number] = dx ? [x + 1, y, x + 1, y + 1] : [x, y + 1, x + 1, y + 1];
      if (ck(i) !== ck(j)) city.push(seg);
      else if (d.nb[i] !== d.nb[j] && (d.nb[i] >= 0 || d.nb[j] >= 0)) nb.push(seg);
    }
  }
  pathCache = { m, key, city: edgePath(m, city), nb: edgePath(m, nb) };
  return pathCache;
}

function selectedPath(m: GameMap, zone: number): Path2D {
  if (selCache && selCache.m === m && selCache.zone === zone) return selCache.path;
  const d = districts(m), W = m.width, H = m.height, e: [number, number, number, number][] = [];
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
  if (censusCache && censusCache.version === g.world.version) return censusCache.dom;
  const d = districts(g.map), cen = zoneCensus(g.map, g.world);
  const dom = d.nbs.map((_, z) => {
    const c = cen[z];
    if (!c) return { group: 0, pop: 0 };
    let best = 0;
    for (let k = 1; k < GROUPS.length; k++) if (c.pop[k] > c.pop[best]) best = k;
    return { group: c.tot && c.pop[best] / c.tot > 0.3 ? best : 0, pop: c.tot };
  });
  censusCache = { version: g.world.version, dom };
  return dom;
}

export function drawDistricts(ctx: CanvasRenderingContext2D, cam: Camera, g: GameState, selectedZone: number) {
  const m = g.map, d = districts(m), year = g.world.year;
  const p = paths(m, year);
  const z = cam.zoom;
  ctx.save();
  ctx.setTransform(z, 0, 0, z, -cam.x * z, -cam.y * z);
  ctx.lineCap = "round";
  ctx.strokeStyle = "rgba(20,20,24,0.55)"; ctx.lineWidth = 3.5 / z; ctx.stroke(p.nb);
  ctx.strokeStyle = "rgba(240,240,240,0.85)"; ctx.lineWidth = 1.4 / z; ctx.setLineDash([5 / z, 4 / z]); ctx.stroke(p.nb);
  ctx.setLineDash([]);
  ctx.strokeStyle = "rgba(20,16,8,0.7)"; ctx.lineWidth = 6 / z; ctx.stroke(p.city);
  ctx.strokeStyle = "#ffd65a"; ctx.lineWidth = 3 / z; ctx.stroke(p.city);
  if (selectedZone >= 0) { ctx.strokeStyle = "#7ef0a0"; ctx.lineWidth = 3.5 / z; ctx.stroke(selectedPath(m, selectedZone)); }
  ctx.restore();
  // names
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  const S = (x: number, y: number): [number, number] => { const [wx, wy] = project(x + 0.5, y + 0.5, vh(m, Math.max(0, Math.min(m.width, x)), Math.max(0, Math.min(m.height, y))) + 8); return [(wx - cam.x) * z, (wy - cam.y) * z]; };
  const W = ctx.canvas.width, Hh = ctx.canvas.height;
  const label = (text: string, sub: string, x: number, y: number, big: boolean, dot?: string) => {
    const [sx, sy] = S(x, y);
    if (sx < -100 || sy < -40 || sx > W + 100 || sy > Hh + 40) return;
    ctx.font = big ? "bold 15px Georgia, serif" : "italic 12px Georgia, serif";
    const w = ctx.measureText(text).width;
    ctx.fillStyle = "rgba(15,15,18,0.72)"; ctx.fillRect(sx - w / 2 - 6, sy - (big ? 11 : 9), w + 12 + (dot ? 10 : 0), big ? 22 : (sub ? 30 : 18));
    ctx.fillStyle = big ? "#ffd65a" : "#f0f0f0"; ctx.fillText(text, sx + (dot ? 5 : 0), sy);
    if (dot) { ctx.fillStyle = dot; ctx.beginPath(); ctx.arc(sx - w / 2 + 1, sy, 4, 0, 7); ctx.fill(); }
    if (sub && !big) { ctx.font = "10px monospace"; ctx.fillStyle = "#b8bcc4"; ctx.fillText(sub, sx + (dot ? 5 : 0), sy + 13); }
  };
  if (z >= 0.1875) {
    const dom = dominant(g);
    d.nbs.forEach((n, k) => {
      const zn = zoneName(d, k, year);
      const dm = dom[k];
      label(zn.name, dm && dm.pop > 50 ? `${Math.round(dm.pop).toLocaleString()}${dm.group ? ` · ${GROUPS[dm.group].name.split(" ")[0]}` : ""}` : "", n.x, n.y, false, dm?.group ? `rgb(${GROUPS[dm.group].colour.join(",")})` : undefined);
    });
  }
  d.munis.forEach((mu, k) => {
    if (cityKey(d, k, year) !== k) return; // annexed: its land is labelled by the city that took it
    label(cityName(d, k, year).toUpperCase(), "", mu.x, mu.y - 6, true);
  });
  ctx.restore();
}
