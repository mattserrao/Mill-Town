// "Your works": every works you own with its accounts, its processes against the industry's, the process
// being built, what you could commission next, and the building projects (placed on the map, then confirmed).

import { allWorks, cal, type GameState, type Works } from "../core/game";
import { INDUSTRIES, INDUSTRY_IDS, type IndustryId } from "../core/industries";
import { commission, marketFactor, techBlocked, techCost, techStanding } from "../core/market";
import { PROJECTS, type ProjectKind, projectBlocked } from "../core/projects";
import { esc, fmt } from "../core/text";

const money = (n: number) => (n < 0 ? "-$" : "$") + Math.abs(Math.round(n)).toLocaleString("en-US");

let open = new Set<string>(["p"]);
let status = "";
let newIndustry: IndustryId | null = null;

const STATUS: Record<string, string> = { running: "Running", idle: "Idle", strike: "On strike", flooded: "Flooded", lockout: "Locked out" };

function worksCard(g: GameState, w: Works): string {
  const c = g.company!, ind = INDUSTRIES[w.industry], s = w.lastSeason, y = cal(g).year;
  const st = techStanding(g, w);
  const mk = marketFactor(g, w.industry);
  const isOpen = open.has(w.id);
  const res = w.research ? ind.tech.find((t) => t.id === w.research!.id) : null;
  const next = ind.tech.filter((t) => !w.techs.includes(t.id) && t.year <= y + 10);
  const head = `<div class="wk-head" data-toggle="${w.id}"><b>${esc(w.name)}</b><span class="${w.status === "running" ? "up" : "down"}">${STATUS[w.status] ?? w.status}</span><span>${s ? money(s.profit) : ""}</span><i>${isOpen ? "▾" : "▸"}</i></div>`;
  if (!isOpen) return `<div class="wk">${head}</div>`;
  return `<div class="wk">${head}
    <div class="grid2">
      <div class="k">Industry</div><div class="v">${ind.name}${w.fromRival ? " (bought)" : ""}</div>
      ${s ? `<div class="k">Made</div><div class="v">${fmt(s.produced)} · ${fmt(s.workersHired)} men</div>
      <div class="k">Revenue</div><div class="v">${money(s.revenue)}</div>
      <div class="k">Inputs · wages</div><div class="v">${money(-s.inputCost)} · ${money(-s.wages)}</div>
      <div class="k">Upkeep</div><div class="v">${money(-s.upkeep)}</div>
      ${w === c && s.other ? `<div class="k">Company costs</div><div class="v">${money(-s.other)}</div>` : ""}` : ""}
      <div class="k">Prices vs rivals</div><div class="v ${st.factor < 1 ? "bad" : st.factor > 1 ? "good" : ""}">${st.factor === 1 ? "Level" : `${st.factor > 1 ? "+" : ""}${Math.round((st.factor - 1) * 100)}%`}${mk !== 1 ? ` · market ${mk > 1 ? "+" : ""}${Math.round((mk - 1) * 100)}%` : ""}</div>
    </div>
    ${st.behind.length ? `<div class="wk-warn">Behind the industry: ${st.behind.map((t) => esc(t.name)).join(", ")}. Every process the rivals have and you lack costs 10% on price.</div>` : ""}
    <div class="wk-sub">Processes</div>
    <div class="wk-techs">${ind.tech.filter((t) => w.techs.includes(t.id)).map((t) => `<span class="wk-tech on">${esc(t.name)}</span>`).join("")}${res ? `<span class="wk-tech busy">${esc(res.name)} · ${w.research!.left} season${w.research!.left > 1 ? "s" : ""} left</span>` : ""}</div>
    ${next.length ? `<div class="wk-sub">Commission</div>${next.map((t) => {
      const why = techBlocked(g, w, t) ?? (c.biz.actionsLeft <= 0 ? "No actions left this season" : c.cash < techCost(t, y) ? `Needs ${money(techCost(t, y))}` : null);
      const eff = Object.entries(t.effects).map(([k, v]) => `${k === "capacity" ? "capacity" : k === "efficiency" ? "fuel & ore" : k === "workersPerUnit" ? "men per ton" : k === "pollution" ? "smoke" : "quality"} ${v! > 0 ? "+" : ""}${Math.round(v! * 100)}%`).filter((x) => !x.startsWith("quality")).join(", ");
      return `<div class="bz-act"><button data-tech="${t.id}" data-works="${w.id}" ${why ? `disabled title="${esc(why)}"` : ""}>${esc(t.name)} — ${money(techCost(t, y))}</button>
        <div class="hint">${t.year > y ? `Invented ${t.year}. ` : ""}${t.seasons} seasons${eff ? ` · ${eff}` : ""}${t.note ? ` · ${esc(t.note)}` : ""}${why && why !== "No actions left this season" ? ` <i>(${esc(why)})</i>` : ""}</div></div>`;
    }).join("")}` : ""}
  </div>`;
}

export function worksPanel(g: GameState, el: HTMLElement, changed: () => void, place: (kind: ProjectKind, industry?: IndustryId) => void) {
  const c = g.company;
  if (!c) { el.innerHTML = ""; return; }
  const y = cal(g).year;
  const t = c.totals;
  el.innerHTML = `
    ${t ? `<div class="grid2"><div class="k">All works, last season</div><div class="v ${t.profit < 0 ? "bad" : "good"}">${money(t.profit)}</div>
      <div class="k">Men employed</div><div class="v">${fmt(t.workersHired)}</div>${c.debt ? `<div class="k">Owed to the bank</div><div class="v bad">${money(c.debt)}</div>` : ""}</div>` : ""}
    ${status ? `<div class="bz-status">${esc(status)}</div>` : ""}
    ${allWorks(c).map((w) => worksCard(g, w)).join("")}
    <h4>Build</h4>
    ${(Object.keys(PROJECTS) as ProjectKind[]).map((k) => {
      const why = projectBlocked(g, k);
      if (k === "found" && y < 1890) return "";
      return `<div class="bz-act"><button data-place="${k}" ${why ? `disabled title="${esc(why)}"` : ""}>${PROJECTS[k].name}…</button>
        ${k === "found" ? `<select data-ind>${INDUSTRY_IDS.map((id) => `<option value="${id}"${id === (newIndustry ?? c.industry) ? " selected" : ""}>${INDUSTRIES[id].name}</option>`).join("")}</select>` : ""}
        <div class="hint">${PROJECTS[k].blurb}${why && why !== "No actions left this season" ? ` <i>(${esc(why)})</i>` : ""}</div></div>`;
    }).join("")}
    <p class="hint">The game suggests a spot: click the map to move it, then confirm.</p>`;

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
}

export function worksStatus(text: string) { status = text; }
export function resetWorksUi() { status = ""; open = new Set(["p", ...[...open].filter((k) => k !== "p")]); }
