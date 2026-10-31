// Vector overlays drawn over the live map: the works' supply chain (goods in, utilities, goods out)
// and the competitors around it.

import { nameNow } from "../core/rivals";
import { distance } from "../core/units";
import { type Competitor, type Flow, flowPath, type Relation, type WorksRef } from "../core/economy";
import type { GameState } from "../core/game";
import { Terrain } from "../core/terrain";
import { type Camera, heightAt, placeLabelRects, project } from "./iso";
import { fmt } from "../core/text";

export const FLOW_COLOUR = (f: Flow): string => {
  if (f.kind === "input") return "#f0a030";
  if (f.kind === "output") return "#ff50aa";
  if (/gas/i.test(f.good)) return "#b8e04a";
  if (/water/i.test(f.good)) return "#5ad0f0";
  return "#ffe14a";
};
export const RELATION_COLOUR: Record<Relation, string> = { competitor: "#ff5046", supplier: "#f0a030", customer: "#ff50aa", lender: "#60c890", other: "#98a0b4" };

type Pt = [number, number];

function screen(g: GameState, cam: Camera, x: number, y: number, lift = 3): Pt {
  const m = g.map;
  const tx = Math.max(0, Math.min(m.width - 1, Math.floor(x))), ty = Math.max(0, Math.min(m.height - 1, Math.floor(y)));
  const i = ty * m.width + tx;
  const h = m.terrain[i] === Terrain.Water ? m.waterLevel[i] : heightAt(m, x, y);
  const [wx, wy] = project(x, y, h + lift);
  return [(wx - cam.x) * cam.zoom, (wy - cam.y) * cam.zoom];
}

function tracePath(ctx: CanvasRenderingContext2D, pts: Pt[]) {
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  if (pts.length === 2) { ctx.lineTo(pts[1][0], pts[1][1]); return; }
  for (let k = 1; k < pts.length - 1; k++) {
    const mx = (pts[k][0] + pts[k + 1][0]) / 2, my = (pts[k][1] + pts[k + 1][1]) / 2;
    ctx.quadraticCurveTo(pts[k][0], pts[k][1], mx, my);
  }
  ctx.lineTo(pts[pts.length - 1][0], pts[pts.length - 1][1]);
}

/** Straight links (wires, pipes) drawn as a gentle arc so parallel ones separate. */
function arc(a: Pt, b: Pt, bend: number): Pt[] {
  const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const L = Math.hypot(dx, dy) || 1;
  const c: Pt = [mx - (dy / L) * L * bend, my + (dx / L) * L * bend];
  const out: Pt[] = [];
  for (let k = 0; k <= 16; k++) {
    const t = k / 16;
    out.push([(1 - t) * (1 - t) * a[0] + 2 * (1 - t) * t * c[0] + t * t * b[0], (1 - t) * (1 - t) * a[1] + 2 * (1 - t) * t * c[1] + t * t * b[1]]);
  }
  return out;
}

interface Label { x: number; y: number; lines: string[]; col: string; w?: number; h?: number }
export interface Rect { x: number; y: number; w: number; h: number }

/** Where to label the far end of a line: the end itself if it's on screen, otherwise the point
 *  where the line leaves the screen (so off-map partners are labelled at the edge they lie towards). */
function anchor(pts: Pt[], W: number, H: number, mg = 36): Pt {
  const inside = (p: Pt) => p[0] >= mg && p[1] >= mg && p[0] <= W - mg && p[1] <= H - mg;
  const far = pts[pts.length - 1];
  if (inside(far)) return far;
  let k = 0;
  while (k < pts.length - 1 && inside(pts[k + 1])) k++;
  const a = inside(pts[k]) ? pts[k] : [W / 2, H / 2] as Pt, b = pts[Math.min(pts.length - 1, k + 1)];
  // clip segment a→b to the inner rectangle
  let t = 1;
  const dx = b[0] - a[0], dy = b[1] - a[1];
  if (dx > 0) t = Math.min(t, (W - mg - a[0]) / dx); else if (dx < 0) t = Math.min(t, (mg - a[0]) / dx);
  if (dy > 0) t = Math.min(t, (H - mg - a[1]) / dy); else if (dy < 0) t = Math.min(t, (mg - a[1]) / dy);
  return [a[0] + dx * Math.max(0, t), a[1] + dy * Math.max(0, t)];
}

const FONT_B = "bold 11px ui-monospace, monospace", FONT = "10px ui-monospace, monospace";
const MARGIN = 6;

/** Cut a line down (with an ellipsis) to fit `max` px. */
function fit(ctx: CanvasRenderingContext2D, text: string, max: number): string {
  if (ctx.measureText(text).width <= max) return text;
  let lo = 0, hi = text.length;
  while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (ctx.measureText(text.slice(0, mid) + "…").width <= max) lo = mid; else hi = mid - 1; }
  return text.slice(0, lo) + "…";
}

/**
 * Place a label greedily: above its anchor, else nudged up/down (then sideways) to the nearest free
 * spot, always clamped inside the canvas (and off `placed`, which starts with the reserved UI rects).
 * If the full label can't fit, a one-line version is tried; if that can't either it is skipped,
 * unless `must` (the works' own label), which then takes the least-bad spot.
 */
function pill(ctx: CanvasRenderingContext2D, placed: Rect[], lb: Label, must = false): { leader: () => void; box: () => void } | null {
  const W = ctx.canvas.width, H = ctx.canvas.height;
  const maxW = Math.min(320, W - 2 * MARGIN) - 12;
  const measure = (lines: string[]) => {
    const fitted = lines.map((l, k) => { ctx.font = k ? FONT : FONT_B; return fit(ctx, l, maxW); });
    const w = Math.ceil(Math.max(...fitted.map((l, k) => { ctx.font = k ? FONT : FONT_B; return ctx.measureText(l).width; }))) + 12;
    return { lines: fitted, w, h: 6 + fitted.length * 13 };
  };
  let soft = true; // first try to keep clear of the map's place names too, then only of other pills
  const overlap = (x: number, y: number, w: number, h: number) => {
    let a = 0;
    for (const p of soft ? placed.concat(placeLabelRects) : placed) {
      const ox = Math.min(x + w + 3, p.x + p.w) - Math.max(x - 3, p.x), oy = Math.min(y + h + 3, p.y + p.h) - Math.max(y - 3, p.y);
      if (ox > 0 && oy > 0) a += ox * oy;
    }
    return a;
  };
  const place = (w: number, h: number, any: boolean) => {
    if (w > W - 2 * MARGIN || h > H - 2 * MARGIN) return null;
    const clampX = (v: number) => Math.round(Math.max(MARGIN, Math.min(W - w - MARGIN, v)));
    const clampY = (v: number) => Math.round(Math.max(MARGIN, Math.min(H - h - MARGIN, v)));
    const x0 = lb.x - w / 2, y0 = lb.y - h - 8;
    let best: { x: number; y: number; a: number; d: number } | null = null;
    const tryAt = (x: number, y: number) => {
      const cx = clampX(x), cy = clampY(y);
      const a = overlap(cx, cy, w, h), d = Math.hypot(cx - x0, cy - y0);
      if (!best || a < best.a || (a === best.a && d < best.d)) best = { x: cx, y: cy, a, d };
      return a === 0;
    };
    // vertical nudges first (the label stays over its line), then sideways steps with nudges
    const step = h + 4;
    const dys = [0, -1, 1, -2, 2, -3, 3, -4, 4].map((k) => k * step * 0.5);
    for (const dx of [0, -0.6, 0.6, -1.2, 1.2]) for (const dy of dys) if (tryAt(x0 + dx * w, y0 + dy)) return best;
    return any ? best : null;
  };
  let m = measure(lb.lines);
  let at = place(m.w, m.h, false);
  if (!at) { soft = false; at = place(m.w, m.h, false); }
  if (!at && lb.lines.length > 1) { m = measure(lb.lines.slice(0, 1)); at = place(m.w, m.h, false); }
  if (!at && must) { m = measure(lb.lines); at = place(m.w, m.h, true) ?? place((m = measure(lb.lines.slice(0, 1))).w, m.h, true); }
  if (!at) return null;
  const { x, y } = at as { x: number; y: number };
  const { w, h, lines } = m;
  placed.push({ x, y, w, h });
  return {
    // a thin leader back to the anchor when the label had to move away from it
    leader: () => {
      const nx = Math.max(x, Math.min(x + w, lb.x)), ny = Math.max(y, Math.min(y + h, lb.y));
      if (Math.hypot(nx - lb.x, ny - lb.y) <= 14) return;
      ctx.beginPath(); ctx.moveTo(lb.x, lb.y); ctx.lineTo(nx, ny);
      ctx.strokeStyle = "rgba(0,0,0,0.7)"; ctx.lineWidth = 3; ctx.stroke();
      ctx.strokeStyle = lb.col; ctx.lineWidth = 1; ctx.stroke();
    },
    box: () => {
      ctx.fillStyle = "rgba(14,16,22,0.88)";
      ctx.strokeStyle = lb.col;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.roundRect(x + 0.5, y + 0.5, w, h, 4);
      ctx.fill(); ctx.stroke();
      ctx.textAlign = "left";
      ctx.textBaseline = "alphabetic";
      lines.forEach((l, k) => {
        ctx.font = k ? FONT : FONT_B;
        ctx.fillStyle = k ? "#c8ccd4" : lb.col;
        ctx.fillText(l, x + 6, y + 14 + k * 13);
      });
    },
  };
}

/** Place every label, then draw all the leaders before any of the boxes (so no leader crosses a box). */
function drawPills(ctx: CanvasRenderingContext2D, placed: Rect[], labels: Label[], mustFirst: boolean) {
  const out = labels.map((lb, k) => pill(ctx, placed, lb, mustFirst && k === 0));
  for (const o of out) o?.leader();
  for (const o of out) o?.box();
}

function dim(ctx: CanvasRenderingContext2D) {
  ctx.fillStyle = "rgba(8,10,16,0.45)";
  ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
}

function worksOutline(ctx: CanvasRenderingContext2D, g: GameState, cam: Camera, x: number, y: number, fp: number, col: string, fill: string, dash: number[] = []) {
  const pts = ([[x, y], [x + fp, y], [x + fp, y + fp], [x, y + fp]] as Pt[]).map(([a, b]) => screen(g, cam, a, b, 6));
  ctx.beginPath();
  pts.forEach((p, k) => (k ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])));
  ctx.closePath();
  ctx.fillStyle = fill; ctx.fill();
  ctx.setLineDash(dash);
  ctx.strokeStyle = col; ctx.lineWidth = 2.5; ctx.stroke();
  ctx.setLineDash([]);
}


/** The supply chain of one works. `focus` (a flow id) is drawn on top and the others faded. */
export function drawSupply(ctx: CanvasRenderingContext2D, cam: Camera, g: GameState, works: WorksRef, flows: Flow[], t: number, focus: string | null, preview: boolean, reserved: Rect[] = []) {
  dim(ctx);
  const placed: Rect[] = [...reserved];
  const labels: Label[] = [];
  const order = [...flows].sort((a, b) => (a.id === focus ? 1 : 0) - (b.id === focus ? 1 : 0) || b.share - a.share);
  let bendSide = 1;
  for (const f of order) {
    const col = FLOW_COLOUR(f);
    const faded = focus !== null && f.id !== focus;
    const tiles = flowPath(g, f);
    let pts = tiles.map(([x, y]) => screen(g, cam, x, y, f.mode === "wire" ? 14 : 3));
    if (f.mode === "wire" || f.mode === "pipe" || f.mode === "canal") { pts = arc(pts[0], pts[pts.length - 1], 0.12 * (bendSide = -bendSide)); }
    const z = Math.max(0.6, Math.min(1.6, cam.zoom * 2));
    const width = (f.kind === "utilityIn" ? 2.2 : 2.5 + 7 * Math.sqrt(f.share)) * z;
    ctx.globalAlpha = faded ? 0.18 : 1;
    ctx.lineCap = "round"; ctx.lineJoin = "round";
    // casing
    tracePath(ctx, pts);
    ctx.strokeStyle = "rgba(0,0,0,0.75)";
    ctx.lineWidth = width + 3;
    ctx.setLineDash(f.mode === "rail" ? [10 * z, 4 * z] : f.mode === "wagon" || f.mode === "pipe" || f.mode === "wire" ? [3 * z, 4 * z] : f.mode === "canal" ? [8 * z, 6 * z] : []);
    ctx.stroke();
    ctx.strokeStyle = col;
    ctx.lineWidth = width;
    ctx.stroke();
    // moving goods
    ctx.setLineDash([2, 16 * z]);
    ctx.lineDashOffset = -t * 40 * z;
    ctx.strokeStyle = "rgba(255,255,255,0.95)";
    ctx.lineWidth = Math.max(2, width * 0.6);
    tracePath(ctx, pts);
    ctx.stroke();
    ctx.setLineDash([]); ctx.lineDashOffset = 0;
    // arrowhead at the destination
    const b = pts[pts.length - 1], a = pts[Math.max(0, pts.length - 3)];
    const ang = Math.atan2(b[1] - a[1], b[0] - a[0]), s = 7 + width;
    ctx.beginPath();
    ctx.moveTo(b[0], b[1]);
    ctx.lineTo(b[0] - s * Math.cos(ang - 0.45), b[1] - s * Math.sin(ang - 0.45));
    ctx.lineTo(b[0] - s * Math.cos(ang + 0.45), b[1] - s * Math.sin(ang + 0.45));
    ctx.closePath();
    ctx.fillStyle = col; ctx.fill();
    ctx.strokeStyle = "#000"; ctx.lineWidth = 1; ctx.stroke();
    ctx.globalAlpha = 1;
    // label the far end (the source for things coming in, the destination for things going out)
    const W = ctx.canvas.width, H = ctx.canvas.height;
    const far = anchor(f.kind === "input" || f.kind === "utilityIn" ? [...pts].reverse() : pts, W, H);
    if (!faded) {
      const qty = f.qty ? `${fmt(f.qty)}/season · ${Math.round(f.share * 100)}%` : "";
      labels.push({ x: far[0], y: far[1], col, lines: [`${f.good}${qty ? ` · ${qty}` : ""}`, f.partner, `via ${f.via}`] });
    }
  }
  // the works itself
  worksOutline(ctx, g, cam, works.x, works.y, works.fp, "#ffd34a", "rgba(255,211,74,0.22)", preview ? [6, 4] : []);
  const c = screen(g, cam, works.x + works.fp / 2, works.y + works.fp / 2, 10);
  labels.unshift({ x: c[0], y: c[1] - 10, col: "#ffd34a", lines: [preview ? `Proposed: ${works.name}` : works.name, preview ? "Supply chain if you found here" : "Your works"] });
  drawPills(ctx, placed, labels, true);
}

/** Rival works around you, coloured by how they relate to your business. */
export function drawRivals(ctx: CanvasRenderingContext2D, cam: Camera, g: GameState, list: Competitor[], mine: WorksRef | null, focus: string | null, reserved: Rect[] = []) {
  dim(ctx);
  const placed: Rect[] = [...reserved];
  const labels: Label[] = [];
  const myC = mine ? screen(g, cam, mine.x + mine.fp / 2, mine.y + mine.fp / 2, 10) : null;
  for (const c of list) {
    const col = RELATION_COLOUR[c.relation];
    const faded = focus !== null && c.def.id !== focus;
    ctx.globalAlpha = faded ? 0.3 : 1;
    let at: Pt;
    if (c.state) {
      const st = c.state;
      worksOutline(ctx, g, cam, st.x, st.y, st.footprint, col, col + "40");
      at = screen(g, cam, st.x + st.footprint / 2, st.y + st.footprint / 2, 10);
    } else {
      const lm = g.map.landmarks.find((l) => l.name === c.def.site);
      if (!lm) continue;
      at = screen(g, cam, lm.x + 0.5, lm.y + 0.5, 10);
      const r = Math.max(10, 6 * Math.max(0.5, cam.zoom * 4));
      ctx.beginPath(); ctx.ellipse(at[0], at[1], r * 2, r, 0, 0, Math.PI * 2);
      ctx.setLineDash([5, 4]); ctx.strokeStyle = col; ctx.lineWidth = 2; ctx.stroke(); ctx.setLineDash([]);
    }
    if (myC && c.state && (c.relation !== "other")) {
      ctx.beginPath(); ctx.moveTo(myC[0], myC[1]); ctx.lineTo(at[0], at[1]);
      ctx.setLineDash([2, 5]); ctx.strokeStyle = col; ctx.lineWidth = 1.5; ctx.stroke(); ctx.setLineDash([]);
    }
    ctx.globalAlpha = 1;
    const la = anchor(myC ? [myC, at] : [at, at], ctx.canvas.width, ctx.canvas.height);
    if (!faded) labels.push({
      x: la[0], y: la[1], col,
      lines: [nameNow(c.def, g.world.year, c.state?.name, c.state?.nameYear).replace(/ \(.*\)$/, ""), c.state ? `${c.product} · ~${fmt(c.capacity)}/season` : c.def.entryYear > g.world.year ? `opens ${c.def.entryYear} near ${c.def.site}` : `never opened: no site near ${c.def.site}`, `${c.def.figures.join(" & ")}${c.km !== undefined ? ` · ${distance(c.km * 1000)}` : ""}`],
    });
  }
  if (mine) {
    worksOutline(ctx, g, cam, mine.x, mine.y, mine.fp, "#ffd34a", "rgba(255,211,74,0.25)");
    labels.unshift({ x: myC![0], y: myC![1] - 10, col: "#ffd34a", lines: [mine.name, "Your works"] });
  }
  drawPills(ctx, placed, labels, mine !== null);
}
