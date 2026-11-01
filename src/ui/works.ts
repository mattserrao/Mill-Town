// The Works tab: each works you own (capacity, men, processes), what to commission next, what to build on the
// map (placed, then confirmed) and what to build for the town. One row per thing: name, cost, effects; the
// longer description is in the tooltip.

import { allWorks, buildIncline, buildSpur, buildSteps, cal, fundLibrary, type GameState, INCLINE_COST, LIBRARY_COST, spurQuote, STEPS_COST, type Works, worksCapacity } from "../core/game";
import { INDUSTRIES, INDUSTRY_IDS, type IndustryId } from "../core/industries";
import { commission, techBlocked, techCost, techStanding } from "../core/market";
import { PROJECTS, type ProjectKind, projectBlocked } from "../core/projects";
import { distance } from "../core/units";
import { esc, fmt } from "../core/text";
import { money } from "./fx";

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
    <div class="wk-techs">${ind.tech.filter((t) => w.techs.includes(t.id)).map((t) => `<span class="wk-tech on" title="${esc(t.note ?? "")}">${esc(t.name)}</span>`).join("")}${res ? `<span class="wk-tech busy">${esc(res.name)} · ${w.research!.left} season${w.research!.left > 1 ? "s" : ""}</span>` : ""}${st.behind.filter((t) => t.id !== w.research?.id).map((t) => `<span class="wk-tech miss" title="Your rivals have it: −10% on your price">${esc(t.name)}</span>`).join("")}</div>
    ${next.map((t) => {
      const why = techBlocked(g, w, t) ?? (c.biz.actionsLeft <= 0 ? "No actions left this season" : c.cash < techCost(t, y) ? `Needs ${money(techCost(t, y))}` : null);
      const fx = Object.entries(t.effects).filter(([k]) => k in TECH_WORD).map(([k, v]) => { const good = k === "capacity" ? v! > 0 : v! < 0; return `<span class="fx ${good ? "fx-good" : "fx-bad"}">${TECH_WORD[k]} ${v! > 0 ? "+" : "−"}${Math.round(Math.abs(v!) * 100)}%</span>`; }).join("") + `<span class="fx">${t.seasons} seasons</span>`;
      return actRow(`${esc(t.name)}${t.year > y ? ` <span class="muted">${t.year}</span>` : ""}`, `<button data-tech="${t.id}" data-works="${w.id}" ${why ? `disabled title="${esc(why)}"` : ""}>${money(techCost(t, y))}</button>`, fx, `${t.note ?? t.name}${why ? ` — ${why}` : ""}`);
    }).join("")}
  </div>`;
}

export function worksPanel(g: GameState, el: HTMLElement, changed: () => void, place: (kind: ProjectKind, industry?: IndustryId) => void) {
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
      const extra = k === "found" ? `<select data-ind>${INDUSTRY_IDS.map((id) => `<option value="${id}"${id === (newIndustry ?? c.industry) ? " selected" : ""}>${INDUSTRIES[id].name}</option>`).join("")}</select>` : "";
      return actRow(PROJECTS[k].name.replace(/^Build (an? )?/, "").replace(/^./, (m) => m.toUpperCase()), `<button data-place="${k}" ${why ? `disabled title="${esc(why)}"` : ""}>Place…</button>`, PROJECT_FX[k], `${PROJECTS[k].blurb} The game suggests a spot: click the map to move it, then confirm.${why ? ` — ${why}` : ""}`, extra);
    }).join("")}
    ${q || c.spur ? actRow("Rail siding", `<button data-town="spur" ${c.spur || !q || c.cash < q.cost ? "disabled" : ""}>${c.spur ? "Built" : money(q!.cost)}</button>`, q ? `<span class="fx">${distance(q.len * g.map.metersPerTile)}</span><span class="fx fx-good">ore & coal by rail</span>` : "", "A siding to the nearest open railroad, so ore and coal can come by rail when the rivers are low, iced or full") : ""}
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
  const TOWN = { library: fundLibrary, steps: buildSteps, incline: buildIncline, spur: buildSpur };
  el.querySelectorAll<HTMLButtonElement>("button[data-town]").forEach((b) => b.addEventListener("click", () => {
    const r = TOWN[b.dataset.town as keyof typeof TOWN](g);
    status = r.ok ? "Done." : r.reason ?? "Can't do that.";
    if (!r.ok) g.log.push({ turn: g.turn, text: r.reason! });
    changed();
  }));
}

export function worksStatus(text: string) { status = text; }
export function resetWorksUi() { status = ""; open = new Set(["p", ...[...open].filter((k) => k !== "p")]); }
