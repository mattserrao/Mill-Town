// The Works tab: each works you own (capacity, men, processes) with the next upgrades to commission, anything the
// law or the market asks of it, and what to build on the map (placed, then confirmed). Roads and gifts to the town
// are on the Town tab; buying into other works is on the Money tab. One row per thing: name, button, effect chips.

import { allWorks, buildSpur, cal, type GameState, spurQuote, type Works, worksCapacity } from "../core/game";
import { INDUSTRIES, industriesIn, type IndustryId } from "../core/industries";
import { commission, techBlocked, techCost, techStanding } from "../core/market";
import { PROJECTS, type ProjectKind, projectBlocked } from "../core/projects";
import { distance } from "../core/units";
import { esc, fmt } from "../core/text";
import { actRow, chip, costButton, head, meterChip, money, more } from "./fx";
import { actionRows, wireActions } from "./actions";
export { actRow } from "./fx";
import { complianceOf } from "../core/enviro";
import { nameNow, RIVALS } from "../core/rivals";
import { acquisitionQuote } from "../core/rivalai";
import { rivalProfit, rivalValue, stakeBlocked, stakePrice } from "../core/holdings";

let open = new Set<string>(["p"]);
let status = "";
let newIndustry: IndustryId | null = null;

/** every rival works you could buy (or take a stake in) in one industry, with its price; a picker for the industry */
export function buyIntoRows(g: GameState, pick: string): string {
  const c = g.company!, y = cal(g).year;
  const open = g.rivals.filter((r) => r.active && !r.closed && !r.owned);
  const inds = industriesIn(y).filter((ind) => open.some((r) => RIVALS.find((d) => d.id === r.id)?.industry === ind));
  if (!inds.length) return `<p class="hint">No works open to buy.</p>`;
  const ind = inds.includes(pick as IndustryId) ? (pick as IndustryId) : inds[0];
  const list = open.filter((r) => RIVALS.find((d) => d.id === r.id)?.industry === ind);
  return `<label class="bz-target">Industry <select data-buyind>${inds.map((i) => `<option value="${i}"${i === ind ? " selected" : ""}>${INDUSTRIES[i].name} (${open.filter((r) => RIVALS.find((d) => d.id === r.id)?.industry === i).length})</option>`).join("")}</select></label>` + list.map((r) => {
    const d = RIVALS.find((x) => x.id === r.id)!, q = acquisitionQuote(g, r), sw = stakeBlocked(g, r.id);
    const why = "refused" in q ? q.refused : c.biz.actionsLeft <= 0 ? "No actions left this season" : c.cash < q.price ? `Needs ${money(q.price)}` : null;
    return actRow(esc(nameNow(d, y, r.name, r.nameYear)), `${"price" in q ? costButton(`data-buyw="${r.id}"`, q.price, why) : ""}${costButton(`data-stakew="${r.id}"`, 0, sw, `10% ${money(stakePrice(g, r.id))}`)}`,
      `${chip(`worth ${money(rivalValue(g, r.id))}`)}${chip(`${money(rivalProfit(g, r.id) * 4)}/yr`, rivalProfit(g, r.id) < 0 ? "bad" : "good")}${r.offmap ? chip(`off the map: ${d.offmap ?? ""}`) : ""}${"refused" in q ? chip(q.refused, "bad") : ""}`,
      `${d.note} Buy the works (its value + 10%) and run it as yours, or take a 10% stake for a share of its profit.`);
  }).join("");
}

const STATUS: Record<string, string> = { running: "Running", idle: "Idle", strike: "On strike", flooded: "Flooded", lockout: "Locked out" };
const PROJECT_FX: Record<ProjectKind, string> = {
  expand: `<span class="fx fx-good">Capacity +30%</span>`,
  housing: `${meterChip("labour", 4)}<span class="fx fx-good">fewer strikes</span>`,
  dock: `<span class="fx fx-good">no wagon haul</span><span class="fx fx-good">first call on barges</span>`,
  found: `<span class="fx">any industry</span>`,
};
const TECH_WORD: Record<string, string> = { capacity: "Capacity", efficiency: "Fuel & ore", workersPerUnit: "Men/unit", pollution: "Smoke" };

function worksCard(g: GameState, w: Works, many: boolean): string {
  const c = g.company!, ind = INDUSTRIES[w.industry], s = w.lastSeason, y = cal(g).year;
  const st = techStanding(g, w);
  const isOpen = !many || open.has(w.id);
  const res = w.research ? ind.tech.find((t) => t.id === w.research!.id) : null;
  // what can be built now, plus the next invention coming
  const avail = ind.tech.filter((t) => !w.techs.includes(t.id) && t.year <= y && t.id !== w.research?.id);
  const soon = ind.tech.filter((t) => !w.techs.includes(t.id) && t.year > y && t.year <= y + 10).slice(0, 1);
  const allOpen = open.has(`all:${w.id}`);
  const next = allOpen ? [...avail, ...soon] : avail.slice(0, 3);
  const hidden = avail.length + soon.length - next.length;
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
      return actRow(`${esc(t.name)}${t.year > y ? ` <span class="muted">${t.year}</span>` : ""}`, costButton(`data-tech="${t.id}" data-works="${w.id}"`, techCost(t, y), why), fx, `${t.note ?? t.name}${why ? ` — ${why}` : ""}`);
    }).join("")}
    ${hidden > 0 || allOpen ? `<div class="wk-more">${more(`all:${w.id}`, allOpen, hidden, "all processes")}</div>` : ""}
  </div>`;
}

export function worksPanel(g: GameState, el: HTMLElement, changed: () => void, place: (kind: ProjectKind, industry?: IndustryId) => void) {
  const c = g.company;
  if (!c) { el.innerHTML = ""; return; }
  const y = cal(g).year;
  const works = allWorks(c);
  const q = spurQuote(g);
  const env = actionRows(g, (a) => a.group === "Environment");
  const stock = works.reduce((t, w) => t + (w.stock ?? 0), 0);
  const yards = stock ? actionRows(g, (a) => a.id === "dump") : { rows: [], off: [] };
  el.innerHTML = `
    ${status ? `<div class="bz-status">${esc(status)}</div>` : ""}
    ${works.map((w) => worksCard(g, w, works.length > 1)).join("")}
    ${yards.rows.length ? head("In the yards", `${fmt(stock)} unsold`) + yards.rows.join("") : ""}
    ${env.rows.length ? head("Environment") + env.rows.join("") : ""}
    ${head("Build")}
    ${(Object.keys(PROJECTS) as ProjectKind[]).map((k) => {
      if (k === "found" && y < 1890) return "";
      const why = projectBlocked(g, k);
      const extra = k === "found" ? `<select data-ind>${industriesIn(y).map((id) => `<option value="${id}"${id === (newIndustry ?? c.industry) ? " selected" : ""}>${INDUSTRIES[id].name}</option>`).join("")}</select>` : "";
      return actRow(PROJECTS[k].name.replace(/^Build (an? )?/, "").replace(/^./, (m) => m.toUpperCase()), costButton(`data-place="${k}"`, 0, why, "Place on map"), PROJECT_FX[k], `${PROJECTS[k].blurb} The game suggests a spot: click the map to move it, then confirm.${why ? ` — ${why}` : ""}`, extra);
    }).join("")}
    ${q || c.spur ? actRow("Rail siding", costButton(`data-town="spur"`, q?.cost ?? 0, c.spur ? "Built" : !q ? "No line in reach" : c.cash < q.cost ? `Needs ${money(q.cost)}` : null, c.spur ? "Built" : undefined), q ? `${chip(distance(q.len * g.map.metersPerTile))}${chip("ore & coal by rail", "good")}` : "", "A siding to the nearest open railroad, so ore and coal can come by rail when the rivers are low, iced or full") : ""}
    <p class="hint">Roads and gifts to the town are on the Town tab; buying other works on the Money tab.</p>`;

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
  el.querySelectorAll<HTMLButtonElement>("button[data-more]").forEach((b) => b.addEventListener("click", () => {
    const k = b.dataset.more!;
    if (open.has(k)) open.delete(k); else open.add(k);
    worksPanel(g, el, changed, place);
  }));
  wireActions(el, g, (t) => { status = t; changed(); });
  const TOWN = { spur: buildSpur };
  el.querySelectorAll<HTMLButtonElement>("button[data-town]").forEach((b) => b.addEventListener("click", () => {
    const r = TOWN[b.dataset.town as keyof typeof TOWN](g);
    status = r.ok ? "Done." : r.reason ?? "Can't do that.";
    if (!r.ok) g.log.push({ turn: g.turn, text: r.reason! });
    changed();
  }));
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
