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
import { blockGrid, blockOf } from "../core/blocks";
import { RIVER_REF, SOOT_SCALE } from "../core/environment";

export type OverlayId = "none" | "elevation" | "terrain" | "coal" | "transport" | "commute" | "ancestry" | "population" | "landValue" | "pollution" | "air" | "river" | "health" | "unrest" | "traffic" | "freight" | "supply" | "rivals" | "districts" | `site:${IndustryId}`;

type RGB = [number, number, number];
type RGBA = [number, number, number, number];

/** Palettes: one per overlay, chosen to be told apart at a glance. */
const P = {
  elevation: [[46, 110, 78], [120, 170, 90], [226, 210, 130], [178, 110, 60], [250, 246, 238]] as RGB[],   // hypsometric
  population: [[68, 1, 84], [59, 82, 139], [33, 145, 140], [94, 201, 98], [253, 231, 37]] as RGB[],        // viridis
  landValue: [[28, 36, 92], [70, 96, 170], [150, 150, 170], [230, 190, 80], [255, 222, 0]] as RGB[],       // navy → gold
  pollution: [[255, 244, 190], [236, 176, 80], [176, 96, 40], [80, 48, 32], [14, 12, 12]] as RGB[],        // soot
  site: [[200, 40, 40], [240, 130, 50], [245, 220, 80], [140, 210, 80], [30, 150, 70]] as RGB[],           // bad → good
  air: [[220, 220, 225], [170, 165, 160], [120, 110, 100], [70, 60, 55], [20, 18, 18]] as RGB[],            // haze → black smoke
  river: [[40, 120, 200], [90, 150, 120], [160, 150, 70], [140, 90, 40], [90, 50, 30]] as RGB[],           // clean → foul
  health: [[30, 150, 70], [140, 210, 80], [245, 220, 80], [240, 130, 50], [200, 40, 40]] as RGB[],         // healthy → sickly
  unrest: [[60, 90, 160], [120, 120, 170], [220, 160, 80], [220, 90, 50], [170, 20, 30]] as RGB[],         // quiet → angry
  traffic: [[60, 70, 120], [70, 140, 200], [250, 220, 90], [245, 140, 40], [220, 40, 40]] as RGB[],        // quiet → packed
  freight: [[250, 210, 120], [245, 160, 60], [230, 90, 40], [200, 30, 40], [140, 0, 30]] as RGB[],         // light → heavy
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

export interface OverlayDef { id: OverlayId; label: string; group: "Land" | "Town" | "Business" | "Best sites"; swatch: string; /** full name, for tooltips */ title?: string }

const grad = (stops: RGB[]) => `linear-gradient(90deg, ${stops.map((s, k) => `${css(s)} ${(k / (stops.length - 1)) * 100}%`).join(", ")})`;
const steps = (cols: RGB[]) => `linear-gradient(90deg, ${cols.map((c, k) => `${css(c)} ${(k / cols.length) * 100}% ${((k + 1) / cols.length) * 100}%`).join(", ")})`;

export const OVERLAYS: OverlayDef[] = [
  { id: "none", label: "Town", group: "Land", title: "No layer: the town as it is", swatch: "" },
  { id: "elevation", label: "Elevation", group: "Land", swatch: grad(P.elevation) },
  { id: "terrain", label: "Terrain", group: "Land", swatch: steps(Object.values(TERRAIN).map((t) => t[0])) },
  { id: "coal", label: "Coal seam", group: "Land", swatch: steps([[60, 48, 36], [12, 10, 10]]) },
  { id: "districts", label: "Districts", title: "Cities & neighbourhoods", group: "Town", swatch: steps([[255, 214, 90], [235, 235, 235], [150, 150, 160]]) },
  { id: "population", label: "Population", group: "Town", swatch: grad(P.population) },
  { id: "ancestry", label: "Ancestry", group: "Town", swatch: steps(GROUPS.slice(1, 7).map((g) => g.colour as RGB)) },
  { id: "landValue", label: "Land value", group: "Town", swatch: grad(P.landValue) },
  { id: "pollution", label: "Soot", title: "Soot: smoke over the years", group: "Town", swatch: grad(P.pollution) },
  { id: "air", label: "Smoke", title: "Smoke this season", group: "Town", swatch: grad(P.air) },
  { id: "river", label: "Water", title: "River water", group: "Town", swatch: grad(P.river) },
  { id: "health", label: "Health", group: "Town", swatch: grad(P.health) },
  { id: "unrest", label: "Unrest", group: "Town", swatch: grad(P.unrest) },
  { id: "traffic", label: "Commuters", title: "Commuter traffic", group: "Town", swatch: grad(P.traffic) },
  { id: "transport", label: "Rail & roads", title: "Rail & roads open this year", group: "Town", swatch: steps([[200, 30, 40], [190, 110, 230], [250, 205, 60]]) },
  { id: "commute", label: "Travel time", title: "Travel time to the works", group: "Town", swatch: steps(COMMUTE.map((b) => b.c)) },
  { id: "supply", label: "Supply chain", group: "Business", swatch: steps([[240, 150, 40], [80, 200, 240], [255, 80, 170]]) },
  { id: "freight", label: "Freight", title: "Freight: barges & trains", group: "Business", swatch: grad(P.freight) },
  { id: "rivals", label: "Competitors", group: "Business", swatch: steps([[255, 80, 70], [240, 150, 40], [255, 80, 170], [150, 160, 180]]) },
  ...(Object.keys(INDUSTRIES) as IndustryId[]).map((k) => ({ id: `site:${k}` as OverlayId, label: INDUSTRIES[k].name, title: `Best sites for ${INDUSTRIES[k].name}`, group: "Best sites" as const, swatch: steps(P.site) })),
];

/** Vector overlays keep the town visible and draw on top of it. */
export const isVectorOverlay = (id: OverlayId) => id === "supply" || id === "rivals" || id === "districts";

export interface OverlayCache { site?: { key: string; scores: Uint8Array } }

/** Returns the per-tile colour function plus a key that changes whenever its output would. */
export function makeOverlay(id: OverlayId, g: GameState, cache: OverlayCache): { fn: OverlayFn; key: string } {
  const m = g.map, w = g.world;
  switch (id) {
    case "none": case "supply": case "rivals": case "districts": return { fn: null, key: "none" };
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
    case "air": {
      const bg = blockGrid(m), a = g.env.air;
      return { key: `air|${g.turn}`, fn: (i) => { const v = a[blockOf(bg, i % m.width, (i / m.width) | 0)] * SOOT_SCALE; return v > 0.02 ? ramp(P.air, Math.min(1, v / 1.2), 0.7) : null; } };
    }
    case "river":
      return { key: `river|${g.turn}`, fn: (i) => (m.terrain[i] === Terrain.Water ? ramp(P.river, Math.min(1, g.env.river[i] / RIVER_REF), 0.85) : null) };
    case "health": {
      const bg = blockGrid(m), h = g.env.health;
      return { key: `health|${w.year}`, fn: (i) => (w.pop[i] ? ramp(P.health, 1 - (h[blockOf(bg, i % m.width, (i / m.width) | 0)] - 0.3) / 0.7, 0.8) : null) };
    }
    case "unrest": {
      const bg = blockGrid(m), u = g.env.unrest;
      return { key: `unrest|${w.year}`, fn: (i) => (w.pop[i] ? ramp(P.unrest, u[blockOf(bg, i % m.width, (i / m.width) | 0)] / 0.6, 0.8) : null) };
    }
    case "traffic": {
      const bg = blockGrid(m), t = g.env.traffic, n = g.env.trafficNorm || 1;
      return { key: `traffic|${g.turn}`, fn: (i) => { if (!w.street[i]) return null; const v = t[blockOf(bg, i % m.width, (i / m.width) | 0)] / n; return v > 0.03 ? ramp(P.traffic, Math.min(1, v), 0.9) : [80, 80, 90, 0.35]; } };
    }
    case "freight": {
      // routes are a tile wide: widen them to three so they read at any zoom
      const f = g.env.freight, n = g.env.freightNorm || 1, W = m.width, H = m.height;
      const d = new Float32Array(f.length);
      for (let i = 0; i < f.length; i++) {
        const v = f[i];
        if (!v) continue;
        const x = i % W, y = (i / W) | 0;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx, yy = y + dy;
          if (xx >= 0 && yy >= 0 && xx < W && yy < H && d[yy * W + xx] < v) d[yy * W + xx] = v;
        }
      }
      return { key: `freight|${g.turn}`, fn: (i) => (d[i] > n * 0.02 ? ramp(P.freight, 0.2 + 0.8 * Math.min(1, d[i] / n), 0.95) : null) };
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
    case "elevation": return bar(steps(stepsOf(P.elevation, 10)), `${Math.round((g?.map.minHeight ?? 216) * 3.281).toLocaleString()} ft river`, `${Math.round((g?.map.maxHeight ?? 390) * 3.281).toLocaleString()} ft hilltops`);
    case "districts": return keys([["#ffd65a", "city & borough limits", "height:4px"], ["rgba(235,235,235,0.8)", "neighbourhoods", "height:2px"]]) +
      `<p class="hint">Click a neighbourhood to see who lives there and what each community has built. Pittsburgh takes in Lawrenceville, East Liberty and Hazelwood (1868), Birmingham (1872) and Allegheny City (1907).</p>`;
    case "terrain": return keys(Object.values(TERRAIN).map(([c, n]) => [css(c), n]));
    case "coal": return keys([["rgb(12,10,10)", "seam outcrop (drift mines)"], ["rgb(60,48,36)", "seam underground"]]);
    case "transport": return keys([["rgb(200,30,40)", "rail open this year"], ["rgb(190,110,230)", "rail still to come"], ["rgb(250,205,60)", "streets & pikes"], ["rgba(255,255,255,0.5)", "where streets will come"]]);
    case "commute": return `<div class="lg-title">Minutes to your works (walk; streetcar 1890–1955; car from the 1920s)</div>` + keys([...COMMUTE.map((b) => [css(b.c), b.label] as [string, string]), ["rgb(70,70,80)", "over an hour"]]) + `<p class="hint">Steps and inclines shorten the climb.</p>`;
    case "ancestry": return keys(GROUPS.slice(1).map((gr) => [css(gr.colour as RGB), gr.name]));
    case "population": return bar(steps(stepsOf(P.population, BANDS)), "few", "~70 per tile");
    case "landValue": return bar(steps(stepsOf(P.landValue, BANDS)), "$0", "$400+");
    case "pollution": return bar(steps(stepsOf(P.pollution, BANDS)), "light haze", "black soot") + `<p class="hint">Long-term smoke: a running average of the air over a few years (soot on the buildings, land value).</p>`;
    case "air": return bar(steps(stepsOf(P.air, BANDS)), "hazy", "black smoke") + `<p class="hint">This season's smoke: works, home coal fires, locomotives, motor traffic. Valley floors hold it in autumn and winter; smoke control clears it after 1946.</p>`;
    case "river": return bar(steps(stepsOf(P.river, BANDS)), "clean", "foul") + `<p class="hint">Works outfalls and sewage, carried downstream. Until filtration (1908) the riverside towns drink it.</p>`;
    case "health": return bar(steps(stepsOf(P.health, BANDS)), "healthy", "sickly") + `<p class="hint">From smoke, drinking water and crowding. Poor health kills, slows families and cuts output at the works.</p>`;
    case "unrest": return bar(steps(stepsOf(P.unrest, BANDS)), "quiet", "angry") + `<p class="hint">Poor health, crowding and the era's grievances (the twelve-hour day, the Depression, the layoffs). Raises the chance of strikes.</p>`;
    case "traffic": return bar(steps(stepsOf(P.traffic, BANDS)), "quiet", "packed") + `<p class="hint">Commuters this season: sampled trips to the works, downtown and the town centres, by foot, streetcar or car.</p>`;
    case "freight": return bar(steps(stepsOf(P.freight, BANDS)), "light", "heavy") + `<p class="hint">Coal, ore, limestone and sand moving this season by barge and rail, from the edge of the valley to every works.</p>`;
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
