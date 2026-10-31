// The "?" query tool: click a tile to see the building on it, everything drawn on it, the land under it,
// and the neighbourhood around it (who lives there, when each community arrived, how it grew).

import { feet } from "../core/units";
import { commuteWeight, type GameState, walkMinutes } from "../core/game";
import { GROUPS } from "../core/ancestry";
import { tileLatLon, type GameMap } from "../core/map";
import { areaAt, areaReport, civicLabel, type AreaReport } from "../core/neighbourhood";
import { RIVALS } from "../core/rivals";
import { Terrain, TERRAIN_NAMES } from "../core/terrain";
import { STRUCTURES, SUB_NAMES, Use, USE_NAMES } from "../core/town";
import { parseHouseKey } from "../render/houses";
import type { Renderer } from "../render/renderer";
import { stageOf } from "../render/renderer";
import { blockGrid, blockOf } from "../core/blocks";
import { RIVER_REF, SOOT_SCALE } from "../core/environment";

const fmt = (n: number) => Math.round(n).toLocaleString("en-US");
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const STYLE_NAMES = ["Federal", "Italianate", "Queen Anne", "Interwar", "Postwar"];
const SOOT = ["clean", "lightly sooted", "sooty", "black with soot"];
const STREET_NAMES = ["", "Lane", "Pike / main road", "Bridge approach", "Public steps"];

const PART_NAMES: Record<string, string> = {
  furnace_iron: "iron blast furnace", furnace_stone: "stone furnace", stoves: "hot-blast stoves", casthouse: "cast house",
  cokeovens: "beehive coke ovens", cokebattery: "by-product coke battery", oreyard: "ore yard", oreyard_bridge: "ore bridge",
  coalyard: "coal yard", coalyard_bridge: "coal unloader", stack: "smokestack", rolling: "rolling mill", puddle: "puddling furnaces",
  bessemer: "Bessemer converters", openhearth: "open-hearth shop", bof: "basic oxygen furnace", strip_mill: "strip mill",
  ingotcar: "ingot cars", hotmetalcar: "hot-metal cars", boilerhouse: "boiler house", enginehouse: "engine house",
  powerhouse: "powerhouse", turbinehall: "turbine hall", switchyard: "switchyard", pylon: "transmission pylon",
  gasholder: "gasholder", purifier: "gas purifier", retort: "gas retorts", containment: "reactor containment",
  glassshed: "glasshouse", cone: "glass cone", tankfurnace: "tank furnace", lehr: "annealing lehr", batchhouse: "batch house",
  sandyard: "sand yard", bottleplant: "bottle plant", floatline: "float-glass line", platestack: "plate-glass stacks",
  slip_wood: "boat slip (wood)", slip_iron: "shipway (iron hulls)", slip_steel: "shipway (steel)", gantrycrane: "gantry crane",
  plateshop: "plate shop", machineshop: "machine shop", heavyshop: "heavy machine shop", foundry: "foundry", sawmill: "sawmill",
  lumber: "lumber stacks", warehouse: "warehouse", office: "company office", gate: "works gate", dock: "dock",
  bollards: "mooring bollards", spur: "rail spur", stockyard: "stockyard", derrick: "derrick",
};

export interface QueryCtx { game: GameState; map: GameMap; renderer: Renderer }

export function queryCard(q: QueryCtx, x: number, y: number): string {
  const { game: g, map: m } = q;
  const w = g.world, i = y * m.width + x;
  const ll = tileLatLon(m, x, y);
  const objs = q.renderer.tileObjects(g, x, y);
  const area = areaAt(m, x, y);
  const rep = areaReport(m, w, g.history, area);

  // ---- the building
  const use = w.use[i], sub = w.sub[i];
  const house = objs.keys.find((k) => k.startsWith("H|"));
  const spec = house ? parseHouseKey(house) : null;
  let title = SUB_NAMES[use]?.[sub] ?? USE_NAMES[use];
  const bRows: [string, string][] = [];
  if (use >= Use.Cottage && use <= Use.Rowhouses) {
    const kind = use === Use.Rowhouses ? "brick rowhouse" : use === Use.Houses ? "frame house" : "cottage";
    title = spec ? `${STYLE_NAMES[spec.style]} ${sub === 2 ? "company double house" : sub === 3 ? "shanty" : sub === 1 ? (use === Use.Houses ? "mansion" : "estate") : sub === 4 ? "boarding house" : kind}` : title;
    if (w.built[i]) bRows.push(["Built", String(w.built[i])]);
    bRows.push(["Households", w.pop[i] ? `${fmt(w.pop[i])} people` : "Empty"]);
    if (w.eth[i] && w.pop[i]) bRows.push(["Family background", GROUPS[w.eth[i]].name]);
    if (spec) bRows.push(["Condition", `${spec.boarded ? "boarded up, " : ""}${SOOT[spec.soot]}${spec.corner ? " · corner lot" : ""}`]);
  } else if (use === Use.Civic) {
    const was = w.was[i], now = w.eth[i];
    title = civicLabel(sub, now || was);
    if (was && !now) title = `${title} (closed)`;
    if (w.built[i]) bRows.push(["Built", `${w.built[i]}${was ? ` by the ${GROUPS[was].name} community` : ""}`]);
    if (now && (sub <= 1 || sub >= 5)) bRows.push(["Congregation", now !== was && was ? `${GROUPS[now].name} (once ${GROUPS[was].name})` : GROUPS[now].name]);
    if (was && !now) bRows.push(["Now", "Closed — its people have moved away"]);
  } else if (use === Use.Commerce) {
    if (sub >= 9 && w.eth[i]) title = `${short(w.eth[i])} ${title.toLowerCase()}`;
    if (w.built[i]) bRows.push(["Opened", String(w.built[i])]);
  } else if (use === Use.Landmark) {
    const st = w.structure[i];
    if (st > 0 && st < 255) title = cap(STRUCTURES[st]);
  } else if (use === Use.Industry || use === Use.Rival) {
    const owner = objs.plant?.owner === "p" ? g.company?.name ?? "Your works" : RIVALS.find((r) => r.id === objs.plant?.owner)?.company ?? "Rival works";
    title = objs.plant?.part ? cap(PART_NAMES[objs.plant.part] ?? objs.plant.part.replace(/_/g, " ")) : USE_NAMES[use];
    bRows.push(["Works", owner]);
    if (use === Use.Industry && g.company) bRows.push(["Status", cap(g.company.status)]);
  }

  // ---- what's on the tile
  const things = new Map<string, number>();
  const add = (s: string) => things.set(s, (things.get(s) ?? 0) + 1);
  for (const k of objs.keys) {
    if (k.startsWith("H|") || k.startsWith("P|")) continue;
    const [a, b = ""] = k.split(":");
    if (a === "tree") add(b.startsWith("bush") ? "shrubs" : b.replace(/\d+$/, "") + " tree");
    else if (a === "lamp") add(b === "elec" ? "electric street lamp" : "gas street lamp");
    else if (a === "struct") add(cap(b));
    else if (a === "farm") add("farmhouse and barn");
    else if (a === "mine") add("drift mine mouth and tipple");
    else if (a === "wharf") add("cargo on the landing");
    else if (a === "boat") add(b === "barge" ? "moored barge" : "moored steamboat");
    else if (a === "incline") add("incline station");
    else if (a === "park") add("bandstand");
  }
  if (w.street[i]) add(STREET_NAMES[w.street[i]]);
  const rail = m.rail[i] ? m.railLines[String(m.rail[i])] : null;
  if (rail) add(`${rail.name} track${rail.year > w.year ? ` (opens ${rail.year})` : ""}`);
  const creek = m.creek[i] ? m.creekNames[String(m.creek[i])] : "";
  if (creek) add(creek);
  for (const sp of m.spans) {
    const st = stageOf(sp, w.year);
    if (!st) continue;
    const dx = sp.b[0] - sp.a[0], dy = sp.b[1] - sp.a[1], L2 = dx * dx + dy * dy;
    const t = Math.max(0, Math.min(1, ((x + 0.5 - sp.a[0]) * dx + (y + 0.5 - sp.a[1]) * dy) / L2));
    if (Math.hypot(x + 0.5 - sp.a[0] - dx * t, y + 0.5 - sp.a[1] - dy * t) < 0.8) add(`${sp.name} overhead (${st.type}, ${st.year})`);
  }
  const thingList = [...things].map(([s, n]) => (n > 1 ? `${n} × ${s}` : s));

  // ---- the land
  const water = m.water[i] ? m.waterNames[String(m.water[i])] : "";
  const lRows: [string, string][] = [
    ["Terrain", water ? `${TERRAIN_NAMES[m.terrain[i]]} — ${water}` : TERRAIN_NAMES[m.terrain[i]]],
    ["Elevation", `${feet(m.elevation[i])}, slope ${m.slope[i]}°`],
    ["Coal", ["None", "Pittsburgh seam underground", "Pittsburgh seam outcrop"][m.coal[i]]],
    ["Land value", `$${fmt(w.landValue[i])}`],
    ["Soot (years of smoke)", smokeWord(w.pollution[i])],
    ["Smoke this season", smokeWord(g.env.air[blockOf(blockGrid(m), x, y)] * SOOT_SCALE)],
    ["Owner", w.owner[i] === 0 ? "Private / town" : w.owner[i] === 1 ? g.company?.name ?? "You" : RIVALS.find((r) => g.rivals.find((rs) => rs.ownerId === w.owner[i])?.id === r.id)?.company ?? "Rival"],
  ];
  if (g.company && g.access) {
    const mins = walkMinutes(g, i);
    lRows.push(["Walk to your works", isFinite(mins) ? `${mins.toFixed(0)} min (${Math.round(commuteWeight(mins) * 100)}% would take the job)` : "over an hour"]);
  }
  const b = blockOf(blockGrid(m), x, y);
  if (m.terrain[i] === Terrain.Water) lRows.push(["River water", riverWord(g.env.river[i])]);
  if (w.pop[i]) {
    lRows.push(["Health", `${Math.round(g.env.health[b] * 100)}%${g.env.health[b] < 0.6 ? " — sickly" : ""}`]);
    lRows.push(["Unrest", unrestWord(g.env.unrest[b])]);
  }
  if (w.street[i]) lRows.push(["Commuter traffic", trafficWord(g.env.traffic[b] / (g.env.trafficNorm || 1))]);
  lRows.push(["Position", `tile ${x}, ${y} · ${ll.lat.toFixed(4)}, ${ll.lon.toFixed(4)}`]);

  return `
    <div class="q-head"><div><div class="q-title">${esc(title)}</div><div class="q-sub">${esc(rep.area.name)}${rep.area.named ? "" : ""}</div></div><button class="q-close" title="Close (Esc)">×</button></div>
    ${bRows.length ? `<h4>Building</h4>${kv(bRows)}` : ""}
    <h4>On this tile</h4><p class="q-list">${thingList.length ? thingList.map(esc).join(" · ") : "Nothing else"}</p>
    <h4>Land</h4>${kv(lRows)}
    ${neighbourhoodHtml(rep, w.year)}`;
}

function kv(rows: [string, string][]) {
  return `<div class="q-kv">${rows.map(([k, v]) => `<div class="k">${esc(k)}</div><div class="v">${esc(v)}</div>`).join("")}</div>`;
}

const smokeWord = (v: number) => (v < 0.05 ? "Clean" : v < 0.15 ? "Hazy" : v < 0.35 ? "Smoky" : v < 0.8 ? "Heavy smoke" : "Choking");
const riverWord = (v: number) => { const r = v / RIVER_REF; return r < 0.1 ? "Clean" : r < 0.35 ? "Muddy" : r < 0.7 ? "Foul" : "Poisoned"; };
const unrestWord = (u: number) => (u < 0.2 ? "Quiet" : u < 0.35 ? "Grumbling" : u < 0.5 ? "Restless" : "Angry");
const trafficWord = (t: number) => (t < 0.05 ? "Quiet" : t < 0.3 ? "Light" : t < 0.7 ? "Busy" : "Packed");
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const rgb = (gI: number) => `rgb(${GROUPS[gI].colour.join(",")})`;
const short = (gI: number) => (gI === 1 ? "Old stock" : GROUPS[gI].name.split(" (")[0]);

export function neighbourhoodHtml(rep: AreaReport, year: number): string {
  const total = rep.groups.reduce((a, b) => a + b, 0) - rep.groups[0];
  const order = rep.groups.map((n, gI) => ({ gI, n })).filter((o) => o.gI > 0 && o.n > 0).sort((a, b) => b.n - a.n);
  const bar = total
    ? `<div class="q-bar">${order.map((o) => `<span style="width:${(100 * o.n) / total}%;background:${rgb(o.gI)}" title="${esc(short(o.gI))} ${Math.round((100 * o.n) / total)}%"></span>`).join("")}</div>
       <div class="q-legend">${order.slice(0, 6).map((o) => `<span><i style="background:${rgb(o.gI)}"></i>${esc(short(o.gI))} ${Math.round((100 * o.n) / total)}%</span>`).join("")}</div>`
    : `<p class="q-list">Nobody lives here yet.</p>`;
  const arrivals = rep.arrivals.length
    ? `<p class="q-list"><b>Seeded by</b> ${rep.arrivals.map((a) => `<span class="q-chip" style="border-color:${rgb(a.group)}">${esc(short(a.group))} ${a.year}</span>`).join(" ")}</p>`
    : "";
  const one = (l: string) => (l.endsWith("houses") ? l.slice(0, -1) : l.endsWith("ies") ? l.slice(0, -3) + "y" : l.endsWith("up") ? l : l.replace(/s$/, ""));
  const homes = rep.homes.slice(0, 4).map((h) => `${h.n} ${(h.n === 1 ? one(h.label) : h.label).toLowerCase()}`).join(" · ");
  const places = [...new Set(rep.places.map((p) => p.label))].slice(0, 6).join(" · ");
  const character = characterOf(rep, year);
  return `
    <h4>Neighbourhood — ${esc(rep.area.named ? rep.area.name : "this area")}, ${year}</h4>
    ${character ? `<p class="q-list q-character">${esc(character)}</p>` : ""}
    <div class="q-kv"><div class="k">People</div><div class="v">${fmt(rep.pop)}</div>
      ${homes ? `<div class="k">Homes (lots)</div><div class="v">${esc(homes)}</div>` : ""}
      ${rep.avgBuilt ? `<div class="k">Typical house built</div><div class="v">${rep.avgBuilt}</div>` : ""}
      ${places ? `<div class="k">Churches &amp; halls</div><div class="v">${esc(places)}</div>` : ""}
      ${rep.shops ? `<div class="k">Shops &amp; businesses</div><div class="v">${rep.shops}</div>` : ""}
      <div class="k">Air · land value</div><div class="v">${rep.pollution < 0.05 ? "clean" : rep.pollution < 0.3 ? "smoky" : "heavy smoke"} · $${fmt(rep.landValue)} avg</div>
    </div>
    ${bar}
    ${arrivals}
    ${growthChart(rep)}`;
}

/** stacked area of each community's population over the recorded years (inline SVG) */
function growthChart(rep: AreaReport): string {
  const s = rep.series;
  if (s.length < 2) return `<p class="q-hint">The growth chart fills in every five years.</p>`;
  const W = 300, H = 90, P = 2;
  const totals = s.map((p) => p.groups.reduce((a, b) => a + b, 0));
  const max = Math.max(1, ...totals);
  const x = (k: number) => P + ((W - 2 * P) * k) / (s.length - 1);
  const yv = (v: number) => H - 14 - ((H - 18) * v) / max;
  const present = GROUPS.map((_, gI) => gI).filter((gI) => gI > 0 && s.some((p) => p.groups[gI] > 0));
  const base = new Array(s.length).fill(0);
  const paths = present.map((gI) => {
    const lo = base.slice();
    s.forEach((p, k) => (base[k] += p.groups[gI]));
    const top = s.map((_, k) => `${x(k).toFixed(1)},${yv(base[k]).toFixed(1)}`);
    const bot = s.map((_, k) => `${x(k).toFixed(1)},${yv(lo[k]).toFixed(1)}`).reverse();
    return `<polygon points="${top.concat(bot).join(" ")}" fill="${rgb(gI)}"><title>${esc(short(gI))}</title></polygon>`;
  });
  const y0 = s[0].year, y1 = s[s.length - 1].year;
  return `<svg class="q-chart" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">
    ${paths.join("")}
    <line x1="${P}" y1="${H - 14}" x2="${W - P}" y2="${H - 14}" stroke="#555" stroke-width="1"/>
    <text x="${P}" y="${H - 2}" font-size="10" fill="#9aa">${y0}</text>
    <text x="${W - P}" y="${H - 2}" font-size="10" fill="#9aa" text-anchor="end">${y1}</text>
    <text x="${W - P}" y="10" font-size="10" fill="#9aa" text-anchor="end">peak ${fmt(max)}</text>
  </svg>`;
}

/** "Slovak since 1888, second generation; Italian arriving since 1912" */
function characterOf(rep: AreaReport, year: number): string {
  const s = rep.series;
  const total = rep.groups.reduce((a, b) => a + b, 0) - rep.groups[0];
  if (!total) return "";
  const dom = rep.groups.map((n, gI) => ({ gI, n })).filter((o) => o.gI).sort((a, b) => b.n - a.n)[0];
  if (!dom || dom.n / total < 0.3) return "Mixed — no community holds a third of the households.";
  // since when has it been the largest community here (the run of snapshots ending now)
  let since = year;
  for (let k = s.length - 1; k >= 0; k--) {
    const t = s[k].groups;
    if (t.indexOf(Math.max(...t.slice(1))) !== dom.gI) break;
    since = s[k].year;
  }
  const seeded = rep.arrivals.find((a) => a.group === dom.gI)?.year ?? since;
  const gen = Math.min(3, 1 + Math.floor((year - seeded) / 25));
  const genWord = ["first generation", "second generation", "third generation and more"][gen - 1];
  let out = `${short(dom.gI)} since ${since}, ${genWord}`;
  // who's rising: biggest gain in share over the last ten years
  if (s.length >= 3) {
    const a = s[s.length - 3], b = s[s.length - 1];
    const ta = a.groups.reduce((x, y) => x + y, 0) || 1, tb = b.groups.reduce((x, y) => x + y, 0) || 1;
    let best = 0, bg = 0;
    for (let gI = 1; gI < b.groups.length; gI++) {
      if (gI === dom.gI) continue;
      const d = b.groups[gI] / tb - a.groups[gI] / ta;
      if (d > best) { best = d; bg = gI; }
    }
    if (bg && best > 0.03) out += `; ${short(bg)} arriving since ${rep.arrivals.find((q) => q.group === bg)?.year ?? a.year}`;
  }
  return out + ".";
}
