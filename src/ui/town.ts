// The Town tab: morale, the jobless and the teams; then the great works — the ones you can found now (ahead of
// history), the ones standing, and the ones still to come. Click a name to go there on the map.

import { allWorks, cal, type GameState } from "../core/game";
import { actionBlocked, actionCost, takeAction } from "../core/business";
import { HOOD_ACTIONS, hoodReport, INVESTS } from "../core/hood";
import { Rng } from "../core/rng";
import { teamGround, teamName } from "../core/sports";
import { fund, fundBlocked, giveText, greatWorks, WINDOW } from "../core/patronage";
import { esc, fmt } from "../core/text";
import { money } from "./fx";
import { actRow } from "./works";

let status = "";
let showAllBuilt = false;
let hoodWorks = "p";
let hoodMore = false;
let actionCount = 0;

/** the Neighbourhood card: five measures for the streets around a works, and what the company can do for them */
function hoodSection(g: GameState): string {
  const c = g.company;
  if (!c) return "";
  const works = allWorks(c);
  const w = works.find((x) => x.id === hoodWorks) ?? c;
  const r = hoodReport(g, w), y = cal(g).year;
  const bar = (k: string, v: number, tip: string) => `<div class="hood-row" title="${esc(tip)}"><span>${k}</span><span class="hood-bar"><i style="width:${v}%;background:${v >= 60 ? "#6ab04c" : v >= 40 ? "#d8b04a" : "#d0603a"}"></i></span><b>${v}</b></div>`;
  const rows: string[] = [], later: string[] = [];
  for (const a of HOOD_ACTIONS) {
    const id = a.id.slice(5), inv = INVESTS.find((v) => v.id === id)!;
    if (w.hood?.[id]) continue;
    if (y < inv.from) { later.push(`<div class="lm-row later"><span>${esc(inv.name)}</span><span>from ${inv.from}</span></div>`); continue; }
    if (inv.until !== undefined && y > inv.until) continue;
    const blocked = actionBlocked(g, a, w.id), cost = actionCost(g, a, w.id);
    const why = blocked ?? (c.biz.actionsLeft <= 0 ? "No actions left this season" : c.cash < cost ? `Needs ${money(cost)}` : null);
    const fx = [inv.health || inv.water ? "Health +" : "", inv.housing ? "Housing +" : "", inv.amenity ? "Amenity +" : "", inv.cohesion ? "Cohesion +" : "", inv.unrest ? "Unrest −" : ""].filter(Boolean).map((t) => `<span class="fx fx-good">${t}</span>`).join("");
    rows.push(actRow(esc(inv.name), `<button data-hood="${a.id}" ${why ? `disabled title="${esc(why)}"` : ""}>${money(cost)}</button>`, fx, `${inv.blurb}${why ? ` — ${why}` : ""}`));
  }
  const doneList = INVESTS.filter((v) => w.hood?.[v.id]).map((v) => `<span class="wk-tech on" title="${esc(v.blurb)}">${esc(v.name)} · ${w.hood![v.id]}</span>`).join("");
  return `<h4 class="mh">Your neighbourhood<span>${r.people.toLocaleString("en-US")} people within a third of a mile</span></h4>
    ${works.length > 1 ? `<label class="bz-target">Around <select data-hoodw>${works.map((x) => `<option value="${x.id}"${x.id === w.id ? " selected" : ""}>${esc(x.name)}</option>`).join("")}</select></label>` : ""}
    <div class="hood">
      ${bar("Health", r.health, "Smoke, water and crowding where your men live: sick men make less, and the sick and the poor strike")}
      ${bar("Housing", r.housing, "Crowding, lodgers, shanties and boarding houses")}
      ${bar("Amenity", r.amenity, "Baths, libraries, schools, parks and paving within reach")}
      ${bar("Cohesion", r.cohesion, "Churches, halls and settlement houses; clearance tears it")}
      ${bar("Land value", r.land, "Against the valley's average (50)")}
    </div>
    ${doneList ? `<div class="wk-techs">${doneList}</div>` : ""}
    ${rows.join("") || `<p class="hint">Nothing more to do here right now.</p>`}
    ${later.length ? `<button class="link" data-hoodmore="1">${hoodMore ? "hide" : `${later.length} later`}</button>${hoodMore ? later.join("") : ""}` : ""}`;
}

export function townPanel(g: GameState, el: HTMLElement, changed: () => void, go: (x: number, y: number) => void) {
  const y = cal(g).year;
  const teams = g.teams.filter((t) => t.active);
  const all = greatWorks(g);
  const canFound = g.company ? all.filter((w) => !w.built && y >= w.year - WINDOW) : [];
  const built = all.filter((w) => w.built).sort((a, b) => (b.funded ?? b.year) - (a.funded ?? a.year));
  const coming = all.filter((w) => !w.built && y < w.year - WINDOW).slice(0, 6);
  const link = (w: (typeof all)[number]) => w.x !== undefined ? `<button class="link go" data-x="${w.x}" data-y="${w.y}" title="Go there">${esc(w.name)}</button>` : esc(w.name);
  el.innerHTML = `
    ${status ? `<div class="bz-status">${esc(status)}</div>` : ""}
    ${hoodSection(g)}
    <div class="kv">
      <div class="k">Morale</div><div class="v ${g.morale >= 50 ? "good" : "bad"}">${Math.round(g.morale)}</div>
      <div class="k">Out of work</div><div class="v ${g.jobless > 500 ? "bad" : ""}">${fmt(g.jobless)}</div>
      ${teams.map((t) => `<div class="k">${teamName(t.id, y)}</div><div class="v" title="${esc(teamGround(t.id, y))}${t.last ? ` · ${esc(t.last)}` : ""}">${t.titles.length ? `🏆 ${t.titles.slice(-2).join(", ")}${t.titles.length > 2 ? "…" : ""}` : t.last ?? ""}</div>`).join("")}
    </div>
    <h4 class="mh">Found now<span>ahead of history</span></h4>
    ${!g.company ? `<p class="hint">Found your company first.</p>` : canFound.length ? canFound.map((w) => {
      const why = fundBlocked(g, w);
      return actRow(link(w), `<button data-fund="${esc(w.id)}" ${why ? `disabled title="${esc(why)}"` : ""}>${money(w.cost)}</button>`,
        `<span class="fx">${w.word}</span><span class="fx">city builds ${w.year}</span>${giveText(w.give).map((t) => `<span class="fx fx-good">${t}</span>`).join("")}`,
        `${w.name} (${w.place}). History builds it in ${w.year}; found it now and it opens this season with your name on it.${w.kind === "hospital" ? " Hospitals improve health nearby and soften epidemics." : w.kind === "park" ? " Parks raise land values around them." : ""}`);
    }).join("") : `<p class="hint">Nothing to found right now.</p>`}
    <h4 class="mh">Standing<span>${built.length}</span></h4>
    ${(showAllBuilt ? built : built.slice(0, 8)).map((w) => `<div class="lm-row">${link(w)}<span class="${w.state === "open" ? "" : "bad"}">${w.funded ? `<b class="up" title="You founded it">yours</b> ${w.funded}` : w.year}${w.state && w.state !== "open" ? ` · ${w.state}` : ""}</span></div>`).join("") || `<p class="hint">None yet.</p>`}
    ${built.length > 8 ? `<button class="link" data-more="1">${showAllBuilt ? "fewer" : `all ${built.length}`}</button>` : ""}
    ${coming.length ? `<h4 class="mh">Coming</h4>${coming.map((w) => `<div class="lm-row later"><span>${esc(w.name)}</span><span title="History builds it in ${w.year}">from ${w.year - WINDOW}</span></div>`).join("")}` : ""}`;

  el.querySelectorAll<HTMLButtonElement>("button.go").forEach((b) => b.addEventListener("click", () => go(Number(b.dataset.x), Number(b.dataset.y))));
  el.querySelectorAll<HTMLButtonElement>("button[data-fund]").forEach((b) => b.addEventListener("click", () => {
    const r = fund(g, b.dataset.fund!);
    status = r.text;
    changed();
    const w = greatWorks(g).find((x) => x.id === b.dataset.fund);
    if (r.ok && w?.x !== undefined) go(w.x, w.y!);
  }));
  el.querySelector<HTMLSelectElement>("select[data-hoodw]")?.addEventListener("change", (e) => { hoodWorks = (e.target as HTMLSelectElement).value; townPanel(g, el, changed, go); });
  el.querySelector<HTMLButtonElement>("button[data-hoodmore]")?.addEventListener("click", () => { hoodMore = !hoodMore; townPanel(g, el, changed, go); });
  el.querySelectorAll<HTMLButtonElement>("button[data-hood]").forEach((b) => b.addEventListener("click", () => {
    const r = takeAction(g, b.dataset.hood!, new Rng(`${g.seed}:hood:${g.turn}:${actionCount++}`), hoodWorks);
    status = r.text;
    changed();
  }));
  el.querySelector<HTMLButtonElement>("button[data-more]")?.addEventListener("click", () => { showAllBuilt = !showAllBuilt; townPanel(g, el, changed, go); });
}

export function resetTownUi() { status = ""; }
