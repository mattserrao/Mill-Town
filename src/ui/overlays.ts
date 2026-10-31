// Data overlays for examining the map.
// Each overlay has its own palette (no two share a colour ramp), values are shown in steps so they can
// be read off the legend, and the ground underneath is washed out so the colours stand apart.
// "supply" and "rivals" are drawn as vector layers on top of the normal map (see render/flows.ts).

import { type GameState, walkMinutes } from "../core/game";
import { INDUSTRIES, type IndustryId } from "../core/industries";
import { evaluateSite, popSAT } from "../core/site";
import { Terrain } from "../core/terrain";
import { GROUPS } from "../core/ancestry";
import type { OverlayFn } from "../render/renderer";

export type OverlayId = "none" | "elevation" | "terrain" | "coal" | "transport" | "commute" | "ancestry" | "population" | "landValue" | "pollution" | "supply" | "rivals" | `site:${IndustryId}`;

type RGB = [number, number, number];
type RGBA = [number, number, number, number];

/** Palettes: one per overlay, chosen to be told apart at a glance. */
const P = {
  elevation: [[46, 110, 78], [120, 170, 90], [226, 210, 130], [178, 110, 60], [250, 246, 238]] as RGB[],   // hypsometric
  population: [[68, 1, 84], [59, 82, 139], [33, 145, 140], [94, 201, 98], [253, 231, 37]] as RGB[],        // viridis
  landValue: [[28, 36, 92], [70, 96, 170], [150, 150, 170], [230, 190, 80], [255, 222, 0]] as RGB[],       // navy → gold
  pollution: [[255, 244, 190], [236, 176, 80], [176, 96, 40], [80, 48, 32], [14, 12, 12]] as RGB[],        // soot
  site: [[200, 40, 40], [240, 130, 50], [245, 220, 80], [140, 210, 80], [30, 150, 70]] as RGB[],           // bad → good
};
const COMMUTE: { max: number; c: RGB; label: string }[] = [
  { max: 10, c: [20, 140, 60], label: "&lt;10" }, { max: 20, c: [110, 200, 80], label: "10–20" }, { max: 30, c: [240, 220, 60], label: "20–30" },
  { max: 45, c: [245, 140, 40], label: "30–45" }, { max: 60, c: [215, 50, 40], label: "45–60" },
];
const TERRAIN: Record<number, [RGB, string]> = {
  1: [[80, 170, 255], "floodplain"], 2: [[120, 220, 90], "flat"], 3: [[250, 210, 70], "hillside"],
  4: [[240, 120, 40], "steep"], 5: [[180, 120, 255], "upland"], 6: [[220, 30, 60], "bluff"],
};
const BANDS = 6;

function ramp(stops: RGB[], t: number, a = 0.75, bands = BANDS): RGBA {
  t = Math.max(0, Math.min(0.9999, t));
  if (bands) t = (Math.floor(t * bands) + 0.5) / bands;
  t *= stops.length - 1;
  const k = Math.floor(t), f = t - k;
  const c0 = stops[k], c1 = stops[Math.min(stops.length - 1, k + 1)];
  return [Math.round(c0[0] + (c1[0] - c0[0]) * f), Math.round(c0[1] + (c1[1] - c0[1]) * f), Math.round(c0[2] + (c1[2] - c0[2]) * f), a];
}
const css = (c: RGB | RGBA) => `rgb(${c[0]},${c[1]},${c[2]})`;

export interface OverlayDef { id: OverlayId; label: string; group: "Land" | "Town" | "Business"; swatch: string }

const grad = (stops: RGB[]) => `linear-gradient(90deg, ${stops.map((s, k) => `${css(s)} ${(k / (stops.length - 1)) * 100}%`).join(", ")})`;
const steps = (cols: RGB[]) => `linear-gradient(90deg, ${cols.map((c, k) => `${css(c)} ${(k / cols.length) * 100}% ${((k + 1) / cols.length) * 100}%`).join(", ")})`;

export const OVERLAYS: OverlayDef[] = [
  { id: "none", label: "None (the town)", group: "Land", swatch: "" },
  { id: "elevation", label: "Elevation", group: "Land", swatch: grad(P.elevation) },
  { id: "terrain", label: "Terrain class", group: "Land", swatch: steps(Object.values(TERRAIN).map((t) => t[0])) },
  { id: "coal", label: "Coal seam", group: "Land", swatch: steps([[60, 48, 36], [12, 10, 10]]) },
  { id: "population", label: "Population", group: "Town", swatch: grad(P.population) },
  { id: "ancestry", label: "Ancestry", group: "Town", swatch: steps(GROUPS.slice(1, 7).map((g) => g.colour as RGB)) },
  { id: "landValue", label: "Land value", group: "Town", swatch: grad(P.landValue) },
  { id: "pollution", label: "Pollution", group: "Town", swatch: grad(P.pollution) },
  { id: "transport", label: "Rail & roads (by year)", group: "Town", swatch: steps([[200, 30, 40], [190, 110, 230], [250, 205, 60]]) },
  { id: "commute", label: "Walk to the works", group: "Town", swatch: steps(COMMUTE.map((b) => b.c)) },
  { id: "supply", label: "Supply chain", group: "Business", swatch: steps([[240, 150, 40], [80, 200, 240], [255, 80, 170]]) },
  { id: "rivals", label: "Competitors", group: "Business", swatch: steps([[255, 80, 70], [240, 150, 40], [255, 80, 170], [150, 160, 180]]) },
  ...(Object.keys(INDUSTRIES) as IndustryId[]).map((k) => ({ id: `site:${k}` as OverlayId, label: `Site: ${INDUSTRIES[k].name}`, group: "Business" as const, swatch: steps(P.site) })),
];

/** Vector overlays keep the town visible and draw on top of it. */
export const isVectorOverlay = (id: OverlayId) => id === "supply" || id === "rivals";

export interface OverlayCache { site?: { key: string; scores: Uint8Array } }

/** Returns the per-tile colour function plus a key that changes whenever its output would. */
export function makeOverlay(id: OverlayId, g: GameState, cache: OverlayCache): { fn: OverlayFn; key: string } {
  const m = g.map, w = g.world;
  switch (id) {
    case "none": case "supply": case "rivals": return { fn: null, key: "none" };
    case "elevation": {
      const lo = m.minHeight, hi = m.maxHeight;
      return { key: id, fn: (i) => m.terrain[i] === Terrain.Water ? null : ramp(P.elevation, (m.elevation[i] - lo) / (hi - lo), 0.8, 10) };
    }
    case "terrain":
      return { key: id, fn: (i) => { const t = TERRAIN[m.terrain[i]]; return t ? [...t[0], 0.75] : null; } };
    case "coal":
      return { key: id, fn: (i) => m.coal[i] === 2 ? [12, 10, 10, 0.9] : m.coal[i] === 1 ? [60, 48, 36, 0.55] : null };
    case "transport":
      return {
        key: `${id}|${w.year}`,
        fn: (i) => {
          const r = m.rail[i];
          if (r) { const yr = m.railLines[String(r)]?.year ?? 9999; return yr <= w.year ? [200, 30, 40, 0.95] : [190, 110, 230, 0.7]; }
          if (w.street[i]) return [250, 205, 60, 0.85];
          if (m.road[i]) return [255, 255, 255, 0.3];
          return null;
        },
      };
    case "commute": {
      if (!g.access) return { key: "commute|none", fn: null };
      return {
        key: `commute|${w.version}|${g.company?.x}`,
        fn: (i) => {
          if (m.terrain[i] === Terrain.Water) return null;
          const mins = walkMinutes(g, i);
          const b = COMMUTE.find((k) => mins < k.max);
          return b ? [...b.c, 0.7] : [70, 70, 80, 0.55];
        },
      };
    }
    case "ancestry":
      return { key: `${id}|${w.version}`, fn: (i) => (w.eth[i] && (w.pop[i] || w.use[i] === 6) ? [...GROUPS[w.eth[i]].colour, 0.85] as RGBA : null) };
    case "population":
      return { key: `${id}|${w.version}`, fn: (i) => w.pop[i] > 0 ? ramp(P.population, Math.sqrt(w.pop[i] / 70), 0.85) : null };
    case "landValue":
      return { key: `${id}|${w.version}`, fn: (i) => m.terrain[i] === Terrain.Water ? null : ramp(P.landValue, w.landValue[i] / 400, 0.75) };
    case "pollution":
      return { key: `${id}|${w.version}`, fn: (i) => w.pollution[i] > 0.02 ? ramp(P.pollution, Math.min(1, w.pollution[i] / 3), 0.8) : null };
    default: {
      const ind = id.slice(5) as IndustryId;
      const key = `${ind}|${w.version}`;
      if (!cache.site || cache.site.key !== key) {
        const sat = popSAT(m, w);
        const scores = new Uint8Array(m.width * m.height);
        // every other tile (sites are many tiles wide), filled 2x2
        for (let y = 0; y < m.height; y += 2) for (let x = 0; x < m.width; x += 2) {
          const i = y * m.width + x;
          const t = m.terrain[i];
          if (t === Terrain.Water || t === Terrain.Steep || t === Terrain.Cliff) continue;
          const sc = evaluateSite(m, w, g.fields, ind, x, y, sat).score;
          scores[i] = sc;
          if (x + 1 < m.width) scores[i + 1] = sc;
          if (y + 1 < m.height) { scores[i + m.width] = sc; if (x + 1 < m.width) scores[i + m.width + 1] = sc; }
        }
        cache.site = { key, scores };
      }
      const s = cache.site.scores;
      return { key: `site|${key}`, fn: (i) => s[i] > 0 && m.terrain[i] !== Terrain.Water ? ramp(P.site, s[i] / 100, 0.75, 5) : null };
    }
  }
}

// ---------------------------------------------------------------- legends

const bar = (bg: string, lo: string, hi: string, mid = "") =>
  `<div class="lg-bar" style="background:${bg}"></div><div class="lg-ends"><span>${lo}</span>${mid ? `<span>${mid}</span>` : ""}<span>${hi}</span></div>`;
const keys = (items: [string, string, string?][]) =>
  `<div class="lg-keys">${items.map(([c, t, style]) => `<span><i style="background:${c};${style ?? ""}"></i>${t}</span>`).join("")}</div>`;
const stepsOf = (stops: RGB[], n: number) => Array.from({ length: n }, (_, k) => ramp(stops, (k + 0.5) / n, 1, n) as unknown as RGB);

export function overlayLegend(id: OverlayId, g?: GameState): string {
  switch (id) {
    case "none": return "";
    case "elevation": return bar(steps(stepsOf(P.elevation, 10)), `${Math.round(g?.map.minHeight ?? 216)} m river`, `${Math.round(g?.map.maxHeight ?? 390)} m hilltops`);
    case "terrain": return keys(Object.values(TERRAIN).map(([c, n]) => [css(c), n]));
    case "coal": return keys([["rgb(12,10,10)", "seam outcrop (drift mines)"], ["rgb(60,48,36)", "seam underground"]]);
    case "transport": return keys([["rgb(200,30,40)", "rail open this year"], ["rgb(190,110,230)", "rail still to come"], ["rgb(250,205,60)", "streets & pikes"], ["rgba(255,255,255,0.5)", "where streets will come"]]);
    case "commute": return `<div class="lg-title">Walking minutes to your works</div>` + keys([...COMMUTE.map((b) => [css(b.c), b.label] as [string, string]), ["rgb(70,70,80)", "over an hour"]]) + `<p class="hint">Steps and inclines shorten the climb.</p>`;
    case "ancestry": return keys(GROUPS.slice(1).map((gr) => [css(gr.colour as RGB), gr.name]));
    case "population": return bar(steps(stepsOf(P.population, BANDS)), "few", "~70 per tile");
    case "landValue": return bar(steps(stepsOf(P.landValue, BANDS)), "$0", "$400+");
    case "pollution": return bar(steps(stepsOf(P.pollution, BANDS)), "light haze", "black soot");
    case "supply":
      return `<div class="lg-title">Lines run from source to destination; dots move with the goods</div>` +
        keys([["#f0a030", "raw materials in"], ["#5ad0f0", "water"], ["#b8e04a", "gas"], ["#ffe14a", "electricity"], ["#ff50aa", "finished goods out"]]) +
        keys([["#ccc", "river barge", "height:4px"], ["repeating-linear-gradient(90deg,#ccc 0 6px,transparent 6px 9px)", "rail", "height:4px"], ["repeating-linear-gradient(90deg,#ccc 0 2px,transparent 2px 5px)", "wagon / pipe / wire", "height:3px"]]) +
        (g?.company ? "" : `<p class="hint">Before founding: click a site to preview its supply chain.</p>`);
    case "rivals":
      return keys([["#ffd34a", "your works"], ["#ff5046", "competitor"], ["#f0a030", "supplier to you"], ["#ff50aa", "customer"], ["#98a0b4", "other industry"]]) +
        `<p class="hint">Dashed rings: rivals still to come, with the year they open.</p>`;
    default: return bar(steps(P.site), "poor site", "excellent") + `<p class="hint">Score for the footprint's north-west corner. Click a tile to see why.</p>`;
  }
}
