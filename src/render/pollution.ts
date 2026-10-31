// Pollution you can see: the smoky haze over the valley, waste washing out of the works into the rivers and
// drifting downstream, and slag poured glowing down the bank from the steel works.

import { type GameState, rivalRunning } from "../core/game";
import { RIVALS } from "../core/rivals";
import { Terrain } from "../core/terrain";
import { type Camera, BASE_M, HH, HW, project, ZPX } from "./iso";
import { waterFields } from "./waterfields";

const DIR8 = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]] as const;

/** the tile rectangle under the screen (with a margin) */
function viewTiles(m: GameState["map"], cam: Camera, cw: number, ch: number) {
  const corners = [[0, 0], [cw, 0], [cw, ch], [0, ch]].map(([px, py]) => {
    const wx = cam.x + px / cam.zoom, wy = cam.y + py / cam.zoom + (260 - BASE_M) * ZPX;
    const a = wx / HW, b = wy / HH;
    return [(a + b) / 2, (b - a) / 2];
  });
  return {
    x0: Math.max(0, Math.floor(Math.min(...corners.map((c) => c[0]))) - 6), x1: Math.min(m.width - 1, Math.ceil(Math.max(...corners.map((c) => c[0]))) + 12),
    y0: Math.max(0, Math.floor(Math.min(...corners.map((c) => c[1]))) - 6), y1: Math.min(m.height - 1, Math.ceil(Math.max(...corners.map((c) => c[1]))) + 12),
  };
}

/** Smoky air: heavy in the coal era, thinner in the gas boom, clearing after smoke control. */
export function drawHaze(ctx: CanvasRenderingContext2D, g: GameState, cam: Camera, cw: number, ch: number, _time = 0) {
  const y = g.world.year;
  let era = y < 1884 ? 0.16 : y < 1891 ? 0.07 : y < 1947 ? 0.2 : Math.max(0.02, 0.2 - (y - 1947) * 0.03);
  const v = viewTiles(g.map, cam, cw, ch);
  let s = 0, n = 0;
  for (let yy = v.y0; yy <= v.y1; yy += 6) for (let xx = v.x0; xx <= v.x1; xx += 6) { s += g.world.pollution[yy * g.map.width + xx]; n++; }
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
export function drawSpills(ctx: CanvasRenderingContext2D, g: GameState, cam: Camera, time: number, night: number) {
  const m = g.map, z = cam.zoom, { shore, down } = waterFields(m);
  const S = (fx: number, fy: number, h: number): [number, number] => { const [wx, wy] = project(fx, fy, h); return [(wx - cam.x) * z, (wy - cam.y) * z]; };
  const plants: { x: number; y: number; fp: number; ind: string; running: boolean }[] = [];
  if (g.company) for (const w of [g.company, ...g.company.others]) plants.push({ x: w.x, y: w.y, fp: w.footprint, ind: w.industry, running: w.status === "running" });
  // rivals: their real industry, and only while they run (not before they open, on strike or after they close)
  const year = g.world.year;
  for (const r of g.rivals) {
    const def = RIVALS.find((d) => d.id === r.id);
    if (r.owned || !def || def.id === "mellon") continue; // the Mellons are a bank: no outfall
    const running = r.active && !r.closed && (r.strikeUntil ?? 0) <= g.turn && rivalRunning(def, year) > 0 && !(def.opens !== undefined && year < def.opens);
    plants.push({ x: r.x, y: r.y, fp: r.footprint, ind: def.industry, running });
  }
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
      if (m.terrain[j] === Terrain.Water && down[j] >= 0 && Math.hypot(dx, dy) < bd) { bd = Math.hypot(dx, dy); out = j; }
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
        if (down[j] < 0) continue;
        const val = down[j] - shore[j] * 0.15 * (ohio ? -1 : 1);
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
