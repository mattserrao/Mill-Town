// The Works tab: each works you own (capacity, men, processes), what to commission next, what to build on the
// map (placed, then confirmed) and what to build for the town. One row per thing: name, cost, effects; the
// longer description is in the tooltip.

import { allWorks, buildIncline, buildSpur, buildSteps, cal, fundLibrary, type GameState, INCLINE_COST, LIBRARY_COST, spurQuote, STEPS_COST, type Works, worksCapacity } from "../core/game";
import { INDUSTRIES, industriesIn, type IndustryId } from "../core/industries";
import { commission, techBlocked, techCost, techStanding } from "../core/market";
import { PROJECTS, type ProjectKind, projectBlocked } from "../core/projects";
import { distance, feet } from "../core/units";
import { lobbyInfluence, lobbySeasons, type RoadPlan, roadPlans } from "../core/roads";
import { esc, fmt } from "../core/text";
import { money } from "./fx";
import { complianceOf } from "../core/enviro";

let open = new Set<string>(["p"]);
let status = "";
let newIndustry: IndustryId | null = null;

const STATUS: Record<string, string> = { running: "Running", idle: "Idle", strike: "On strike", flooded: "Flooded", lockout: "Locked out" };
const PROJECT_FX: Record<ProjectKind, string> = {
  expand: `<span class="fx fx-good">Capacity +30%</span>`,
  housing: `<span class="fx fx-good">Lab +4</span><span class="fx fx-good">fewer strikes</span>`,
  dock: `<span class="fx fx-good">no wagon haul</span><span class="fx fx-good">first call on barges</span>`,
  found: `<span class="fx">any industry</span>`,
};
const TECH_WORD: Record<string, string> = { capacity: "Capacity", efficiency: "Fuel & ore", workersPerUnit: "Men/unit", pollution: "Smoke" };

/** a row: name (with tooltip), an action button, effect chips underneath */
export function actRow(name: string, button: string, fx: string, title: string, extra = "") {
  return `<div class="act" title="${esc(title)}"><span class="act-n">${name}</span>${extra}${button}${fx ? `<div class="act-fx">${fx}</div>` : ""}</div>`;
}

function worksCard(g: GameState, w: Works, many: boolean): string {
  const c = g.company!, ind = INDUSTRIES[w.industry], s = w.lastSeason, y = cal(g).year;
  const st = techStanding(g, w);
  const isOpen = !many || open.has(w.id);
  const res = w.research ? ind.tech.find((t) => t.id === w.research!.id) : null;
  // what can be built now, plus the next invention coming
  const avail = ind.tech.filter((t) => !w.techs.includes(t.id) && t.year <= y);
  const next = [...avail, ...ind.tech.filter((t) => !w.techs.includes(t.id) && t.year > y && t.year <= y + 10).slice(0, 1)].filter((t) => t.id !== w.research?.id);
  const head = `<div class="wk-head" ${many ? `data-toggle="${w.id}"` : ""}><b>${esc(w.name)}</b><span class="${w.status === "running" ? "up" : "down"}">${STATUS[w.status] ?? w.status}</span><span class="${s && s.profit < 0 ? "down" : ""}">${s ? money(s.profit) : ""}</span>${many ? `<i>${isOpen ? "▾" : "▸"}</i>` : ""}</div>`;
  if (!isOpen) return `<div class="wk">${head}</div>`;
  return `<div class="wk">${head}
    <div class="wk-sub">${ind.name}${w.fromRival ? " (bought)" : ""} · ${fmt(worksCapacity(w))} capacity · ${fmt(s?.workersHired ?? w.employees)} men${st.factor !== 1 ? ` · <span class="${st.factor < 1 ? "down" : "up"}">price ${st.factor > 1 ? "+" : "−"}${Math.round(Math.abs(st.factor - 1) * 100)}%</span>` : ""}</div>
    ${w.market && y >= 1946 ? `<div class="wk-sub" title="${esc(marketTitle(w))}">Orders <b class="${w.market.util < 0.7 ? "down" : w.market.util < 0.85 ? "" : "up"}">${Math.round(w.market.util * 100)}%</b> of capacity${w.market.imports !== undefined ? ` · imports ${Math.round(w.market.imports * 100)}% · minimills ${Math.round((w.market.minimills ?? 0) * 100)}%` : ""} · costs ${w.market.comp >= 1 ? `<span class="up">competitive</span>` : `<span class="down">${Math.round((1 - w.market.comp) * 100)}% over</span>`}</div>` : ""}
    ${complianceOf(g, w).map((cp) => `<div class="wk-sub"><span class="${cp.mode === "defy" ? "down" : ""}">${cp.mode === "defy" ? "Defying" : "Consent decree"}: ${esc(cp.law)}</span>${cp.mode === "decree" && cp.due !== undefined ? ` · ${Math.max(0, Math.ceil((cp.due - g.turn) / 4))} yrs left · ${cp.violations} violations` : ""}</div>`).join("")}
    <div class="wk-techs">${ind.tech.filter((t) => w.techs.includes(t.id)).map((t) => `<span class="wk-tech on" title="${esc(t.note ?? "")}">${esc(t.name)}</span>`).join("")}${res ? `<span class="wk-tech busy">${esc(res.name)} · ${w.research!.left} season${w.research!.left > 1 ? "s" : ""}</span>` : ""}${st.behind.filter((t) => t.id !== w.research?.id).map((t) => `<span class="wk-tech miss" title="Your rivals have it: −10% on your price">${esc(t.name)}</span>`).join("")}</div>
    ${next.map((t) => {
      const why = techBlocked(g, w, t) ?? (c.biz.actionsLeft <= 0 ? "No actions left this season" : c.cash < techCost(t, y) ? `Needs ${money(techCost(t, y))}` : null);
      const fx = Object.entries(t.effects).filter(([k]) => k in TECH_WORD).map(([k, v]) => {
        // efficiency is a saving on fuel and ore: shown as their cost going down
        const d = k === "efficiency" ? -v! : v!;
        const good = k === "capacity" ? d > 0 : d < 0;
        return `<span class="fx ${good ? "fx-good" : "fx-bad"}">${TECH_WORD[k]} ${d > 0 ? "+" : "−"}${Math.round(Math.abs(d) * 100)}%</span>`;
      }).join("") + `<span class="fx">${t.seasons} seasons</span>`;
      return actRow(`${esc(t.name)}${t.year > y ? ` <span class="muted">${t.year}</span>` : ""}`, `<button data-tech="${t.id}" data-works="${w.id}" ${why ? `disabled title="${esc(why)}"` : ""}>${money(techCost(t, y))}</button>`, fx, `${t.note ?? t.name}${why ? ` — ${why}` : ""}`);
    }).join("")}
  </div>`;
}

export function worksPanel(g: GameState, el: HTMLElement, changed: () => void, place: (kind: ProjectKind, industry?: IndustryId) => void, road?: (p: RoadPlan) => void) {
  const c = g.company;
  if (!c) { el.innerHTML = ""; return; }
  const y = cal(g).year;
  const works = allWorks(c);
  const q = spurQuote(g);
  const town: [string, string, number, boolean, string, string][] = [
    ["library", c.library ? "Library funded" : "Fund a library", LIBRARY_COST, c.library || y < 1880, `<span class="fx fx-good">Rep +</span><span class="fx fx-good">Mor +</span>`, y < 1880 ? "From 1880" : "A free public library near the works"],
    ["steps", "Public steps", STEPS_COST, false, `<span class="fx fx-good">shorter walk</span>`, "A flight of public steps from hillside houses down to the street"],
    ["incline", "Incline", INCLINE_COST, y < 1870, `<span class="fx fx-good">hilltop men in reach</span>`, y < 1870 ? "Inclines arrive in 1870" : "An incline from a street near the works up to the hilltop houses"],
  ];
  el.innerHTML = `
    ${status ? `<div class="bz-status">${esc(status)}</div>` : ""}
    ${works.map((w) => worksCard(g, w, works.length > 1)).join("")}
    <h4 class="mh">Build on the map</h4>
    ${(Object.keys(PROJECTS) as ProjectKind[]).map((k) => {
      if (k === "found" && y < 1890) return "";
      const why = projectBlocked(g, k);
      const extra = k === "found" ? `<select data-ind>${industriesIn(y).map((id) => `<option value="${id}"${id === (newIndustry ?? c.industry) ? " selected" : ""}>${INDUSTRIES[id].name}</option>`).join("")}</select>` : "";
      return actRow(PROJECTS[k].name.replace(/^Build (an? )?/, "").replace(/^./, (m) => m.toUpperCase()), `<button data-place="${k}" ${why ? `disabled title="${esc(why)}"` : ""}>Place…</button>`, PROJECT_FX[k], `${PROJECTS[k].blurb} The game suggests a spot: click the map to move it, then confirm.${why ? ` — ${why}` : ""}`, extra);
    }).join("")}
    ${q || c.spur ? actRow("Rail siding", `<button data-town="spur" ${c.spur || !q || c.cash < q.cost ? "disabled" : ""}>${c.spur ? "Built" : money(q!.cost)}</button>`, q ? `<span class="fx">${distance(q.len * g.map.metersPerTile)}</span><span class="fx fx-good">ore & coal by rail</span>` : "", "A siding to the nearest open railroad, so ore and coal can come by rail when the rivers are low, iced or full") : ""}
    <h4 class="mh">Roads &amp; bridges</h4>
    ${roadRows(g)}
    <h4 class="mh">For the town</h4>
    ${town.map(([id, name, cost, off, fx, title]) => actRow(name, `<button data-town="${id}" ${off || c.cash < cost ? "disabled" : ""}>${money(cost)}</button>`, fx, title)).join("")}`;

  el.querySelectorAll<HTMLElement>("[data-toggle]").forEach((h) => h.addEventListener("click", () => {
    const id = h.dataset.toggle!;
    if (open.has(id)) open.delete(id); else open.add(id);
    worksPanel(g, el, changed, place);
  }));
  el.querySelectorAll<HTMLButtonElement>("button[data-tech]").forEach((b) => b.addEventListener("click", () => {
    const w = allWorks(c).find((x) => x.id === b.dataset.works)!;
    status = commission(g, w, b.dataset.tech!).text;
    changed();
  }));
  el.querySelector<HTMLSelectElement>("select[data-ind]")?.addEventListener("change", (e) => { newIndustry = (e.target as HTMLSelectElement).value as IndustryId; });
  el.querySelectorAll<HTMLButtonElement>("button[data-place]").forEach((b) => b.addEventListener("click", () => {
    const k = b.dataset.place as ProjectKind;
    place(k, k === "found" ? newIndustry ?? c.industry : undefined);
  }));
  const plans = roadPlans(g);
  el.querySelectorAll<HTMLButtonElement>("button[data-road]").forEach((b) => b.addEventListener("click", () => road?.(plans[Number(b.dataset.road)])));
  const TOWN = { library: fundLibrary, steps: buildSteps, incline: buildIncline, spur: buildSpur };
  el.querySelectorAll<HTMLButtonElement>("button[data-town]").forEach((b) => b.addEventListener("click", () => {
    const r = TOWN[b.dataset.town as keyof typeof TOWN](g);
    status = r.ok ? "Done." : r.reason ?? "Can't do that.";
    if (!r.ok) g.log.push({ turn: g.turn, text: r.reason! });
    changed();
  }));
}

/** the roads worth building, with what each would do; and roads the city is building for you */
function roadRows(g: GameState): string {
  const plans = roadPlans(g).slice(0, 5);
  const pending = (g.publicWorks.roads ?? []).map((r) => `<div class="act"><span class="act-n">Road to ${esc(r.plan.to)}</span><span class="muted">city builds · ${Math.max(0, r.due - g.turn)} seasons</span></div>`).join("");
  const rows = plans.map((p, k) => actRow(`${p.bridge ? "Bridge to" : "Road to"} ${esc(p.to)}`, `<button data-road="${k}" ${g.company!.biz.actionsLeft <= 0 ? "disabled" : ""}>Plan…</button>`,
    `<span class="fx fx-good">+${fmt(p.gain)} in reach</span><span class="fx">${Math.round(p.before)} → ${Math.round(p.after)} min</span>${p.bridgeTiles ? `<span class="fx">bridge ${feet(p.bridgeTiles * g.map.metersPerTile)}</span>` : ""}<span class="fx">${money(p.cost)} or Inf ${lobbyInfluence(p)}</span>`,
    `A main road from the works to ${p.to}${p.bridgeTiles ? `, with a new bridge (${feet(p.bridgeTiles * g.map.metersPerTile)})` : ""}: ${distance(p.path.length * g.map.metersPerTile)}. Horsecars (from 1859) and streetcars (1890–1955) run on it, so the trip drops from ${Math.round(p.before)} to ${Math.round(p.after)} minutes and about ${fmt(p.gain)} more people would take a job at the works; houses settle along it. Pay for it now, or lobby the city to build it (${lobbySeasons(p)} seasons).`)).join("");
  return pending + (rows || `<p class="hint">No road would bring many more men within reach now.</p>`);
}

/** the market behind a works' orders (tooltip) */
function marketTitle(w: Works): string {
  const mk = w.market!;
  return [
    mk.demand !== undefined ? `U.S. steel demand ${Math.round(mk.demand)} (1973 = 100)` : "",
    mk.imports !== undefined ? `Imports take ${Math.round(mk.imports * 100)}% of the market, minimills ${Math.round((mk.minimills ?? 0) * 100)}%` : "",
    mk.dollar !== undefined ? `Dollar index ${Math.round(mk.dollar)} (1980 = 100)` : "",
    mk.policy ? `Trade policy: ${mk.policy}` : "",
    `Your costs against the world's: ${mk.comp >= 1 ? "+" : "−"}${Math.round(Math.abs(mk.comp - 1) * 100)}% on orders (oxygen furnaces, continuous casting, automation and wages count)`,
    "Unsold capacity stands idle; its upkeep still runs, and the men without work are laid off.",
  ].filter(Boolean).join("\n");
}

export function worksStatus(text: string) { status = text; }
export function resetWorksUi() { status = ""; open = new Set(["p", ...[...open].filter((k) => k !== "p")]); }
