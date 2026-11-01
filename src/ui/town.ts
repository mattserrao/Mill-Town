// The Town tab: the valley in numbers, your neighbourhood and what you can do for it, roads and bridges, gifts to
// the town, and the great works — the next ones you could found ahead of history, then (folded) the ones standing,
// the ones still to come and the teams. Click a name to go there on the map.

import { allWorks, buildIncline, buildSteps, cal, fundLibrary, type GameState, INCLINE_COST, LIBRARY_COST, STEPS_COST, totalPopulation } from "../core/game";
import { lobbyInfluence, lobbySeasons, type RoadPlan, roadPlans } from "../core/roads";
import { distance, feet } from "../core/units";
import { actionBlocked, actionCost, takeAction } from "../core/business";
import { HOOD_ACTIONS, hoodReport, INVESTS } from "../core/hood";
import { Rng } from "../core/rng";
import { teamGround, teamName } from "../core/sports";
import { fund, fundBlocked, giveText, greatWorks, WINDOW } from "../core/patronage";
import { esc, fmt } from "../core/text";
import { actRow, chip, costButton, head, meterChip, money, more } from "./fx";

let status = "";
const opened = new Set<string>();
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
    const fx = [inv.health || inv.water ? "Health +" : "", inv.housing ? "Housing +" : "", inv.amenity ? "Amenity +" : "", inv.cohesion ? "Cohesion +" : "", inv.unrest ? "Unrest −" : ""].filter(Boolean).map((t) => chip(t, "good")).join("");
    rows.push(actRow(esc(inv.name), costButton(`data-hood="${a.id}"`, cost, why), fx, `${inv.blurb}${why ? ` — ${why}` : ""}`));
  }
  const doneList = INVESTS.filter((v) => w.hood?.[v.id]).map((v) => `<span class="wk-tech on" title="${esc(v.blurb)}">${esc(v.name)} · ${w.hood![v.id]}</span>`).join("");
  return `${head("Your neighbourhood", `${r.people.toLocaleString("en-US")} within ⅓ mile`)}
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
    ${hoodMore ? later.join("") : ""}${later.length ? `<button class="link more" data-hoodmore="1">${hoodMore ? "Show fewer" : `Show later (${later.length})`}</button>` : ""}`;
}

/** the roads worth building, with what each would do; and roads the city is building for you */
function roadRows(g: GameState): string {
  const plans = roadPlans(g).slice(0, 4);
  const pending = (g.publicWorks.roads ?? []).map((r) => `<div class="act"><span class="act-n">Road to ${esc(r.plan.to)}</span><span class="muted">the city builds it · ${Math.max(0, r.due - g.turn)} seasons</span></div>`).join("");
  const rows = plans.map((p, k) => actRow(`${p.bridge ? "Bridge to" : "Road to"} ${esc(p.to)}`, costButton(`data-road="${k}"`, 0, g.company!.biz.actionsLeft <= 0 ? "No actions left this season" : null, "Show route"),
    `${chip(`+${fmt(p.gain)} in reach`, "good")}${chip(`${Math.round(p.before)} → ${Math.round(p.after)} min`)}${p.bridgeTiles ? chip(`bridge ${feet(p.bridgeTiles * g.map.metersPerTile)}`) : ""}${chip(`${money(p.cost)} or Influence ${lobbyInfluence(p)}`)}`,
    `A main road from the works to ${p.to}${p.bridgeTiles ? `, with a new bridge (${feet(p.bridgeTiles * g.map.metersPerTile)})` : ""}: ${distance(p.path.length * g.map.metersPerTile)}. Horsecars (from 1859) and streetcars (1890–1955) run on it, so the trip drops from ${Math.round(p.before)} to ${Math.round(p.after)} minutes and about ${fmt(p.gain)} more people would take a job at the works; houses settle along it. Pay for it now, or lobby the city to build it (${lobbySeasons(p)} seasons).`)).join("");
  return pending + (rows || `<p class="hint">No road would bring many more men within reach now.</p>`);
}

/** gifts to the town near the works */
function giftRows(g: GameState): string {
  const c = g.company!, y = cal(g).year;
  const gifts: [string, string, number, string | null, string, string][] = [
    ["library", c.library ? "Library" : "Fund a library", LIBRARY_COST, c.library ? "Funded" : y < 1880 ? "From 1880" : null, meterChip("reputation", "+") + meterChip("morale", "+"), "A free public library near the works"],
    ["steps", "Public steps", STEPS_COST, null, chip("shorter walk", "good"), "A flight of public steps from hillside houses down to the street"],
    ["incline", "Incline", INCLINE_COST, y < 1870 ? "Inclines arrive in 1870" : null, chip("hilltop men in reach", "good"), "An incline from a street near the works up to the hilltop houses"],
  ];
  return gifts.map(([id, name, cost, off, fx, title]) => actRow(name, costButton(`data-town="${id}"`, cost, off ?? (c.cash < cost ? `Needs ${money(cost)}` : null), off === "Funded" ? "Funded" : undefined), fx, title)).join("");
}

export function townPanel(g: GameState, el: HTMLElement, changed: () => void, go: (x: number, y: number) => void, road?: (p: RoadPlan) => void) {
  const y = cal(g).year;
  const teams = g.teams.filter((t) => t.active);
  const all = greatWorks(g);
  const canFound = g.company ? all.filter((w) => !w.built && y >= w.year - WINDOW).sort((a, b) => a.year - b.year) : [];
  const built = all.filter((w) => w.built).sort((a, b) => (b.funded ?? b.year) - (a.funded ?? a.year));
  const coming = all.filter((w) => !w.built && y < w.year - WINDOW).slice(0, 6);
  const link = (w: (typeof all)[number]) => w.x !== undefined ? `<button class="link go" data-x="${w.x}" data-y="${w.y}" title="Go there">${esc(w.name)}</button>` : esc(w.name);
  const isOpen = (k: string) => opened.has(k);
  const foundOpen = isOpen("found");
  const foundList = foundOpen ? canFound : canFound.slice(0, 5);
  el.innerHTML = `
    ${status ? `<div class="bz-status">${esc(status)}</div>` : ""}
    <div class="cards cards3">
      <div class="card"><small>Valley</small><b>${fmt(totalPopulation(g))}</b><em>people</em></div>
      <div class="card"><small>Morale</small><b class="${g.morale >= 50 ? "up" : "down"}">${Math.round(g.morale)}</b><em>of 100</em></div>
      <div class="card"><small>Out of work</small><b class="${g.jobless > 500 ? "down" : ""}">${fmt(g.jobless)}</b><em>in the valley</em></div>
    </div>
    ${hoodSection(g)}
    ${g.company ? head("Roads & bridges") + roadRows(g) + head("Gifts to the town") + giftRows(g) : ""}
    ${head("Found ahead of history", canFound.length ? `${canFound.length} open` : "")}
    ${!g.company ? `<p class="hint">Found your company first.</p>` : foundList.length ? foundList.map((w) => {
      const why = fundBlocked(g, w);
      return actRow(link(w), costButton(`data-fund="${esc(w.id)}"`, w.cost, why),
        `${chip(w.word)}${chip(`city builds ${w.year}`)}${giveText(w.give).map((t) => chip(t, "good")).join("")}`,
        `${w.name} (${w.place}). History builds it in ${w.year}; found it now and it opens this season with your name on it.${w.kind === "hospital" ? " Hospitals improve health nearby and soften epidemics." : w.kind === "park" ? " Parks raise land values around them." : ""}`);
    }).join("") : `<p class="hint">Nothing to found right now.</p>`}
    ${more("found", foundOpen, canFound.length - 5 > 0 ? canFound.length - 5 : foundOpen ? 1 : 0)}
    <h4 class="mh hd-sec" data-fold="built">${isOpen("built") ? "▾" : "▸"} Standing<span>${built.length}</span></h4>
    ${isOpen("built") ? built.map((w) => `<div class="lm-row">${link(w)}<span class="${w.state === "open" ? "" : "bad"}">${w.funded ? `<b class="up" title="You founded it">yours</b> ${w.funded}` : w.year}${w.state && w.state !== "open" ? ` · ${w.state}` : ""}</span></div>`).join("") || `<p class="hint">None yet.</p>` : ""}
    ${coming.length ? `<h4 class="mh hd-sec" data-fold="coming">${isOpen("coming") ? "▾" : "▸"} Coming<span>${coming.length}</span></h4>${isOpen("coming") ? coming.map((w) => `<div class="lm-row later"><span>${esc(w.name)}</span><span title="History builds it in ${w.year}">from ${w.year - WINDOW}</span></div>`).join("") : ""}` : ""}
    ${teams.length ? `<h4 class="mh hd-sec" data-fold="teams">${isOpen("teams") ? "▾" : "▸"} The teams<span>${teams.length}</span></h4>${isOpen("teams") ? `<div class="kv">${teams.map((t) => `<div class="k">${teamName(t.id, y)}</div><div class="v" title="${esc(teamGround(t.id, y))}${t.last ? ` · ${esc(t.last)}` : ""}">${t.titles.length ? `🏆 ${t.titles.slice(-2).join(", ")}${t.titles.length > 2 ? "…" : ""}` : t.last ?? ""}</div>`).join("")}</div>` : ""}` : ""}`;

  const redo = () => townPanel(g, el, changed, go, road);
  el.querySelectorAll<HTMLButtonElement>("button.go").forEach((b) => b.addEventListener("click", () => go(Number(b.dataset.x), Number(b.dataset.y))));
  el.querySelectorAll<HTMLButtonElement>("button[data-fund]").forEach((b) => b.addEventListener("click", () => {
    const r = fund(g, b.dataset.fund!);
    status = r.text;
    changed();
    const w = greatWorks(g).find((x) => x.id === b.dataset.fund);
    if (r.ok && w?.x !== undefined) go(w.x, w.y!);
  }));
  el.querySelector<HTMLSelectElement>("select[data-hoodw]")?.addEventListener("change", (e) => { hoodWorks = (e.target as HTMLSelectElement).value; redo(); });
  el.querySelector<HTMLButtonElement>("button[data-hoodmore]")?.addEventListener("click", () => { hoodMore = !hoodMore; redo(); });
  el.querySelectorAll<HTMLButtonElement>("button[data-hood]").forEach((b) => b.addEventListener("click", () => {
    const r = takeAction(g, b.dataset.hood!, new Rng(`${g.seed}:hood:${g.turn}:${actionCount++}`), hoodWorks);
    status = r.text;
    changed();
  }));
  const toggle = (k: string) => { if (opened.has(k)) opened.delete(k); else opened.add(k); redo(); };
  el.querySelectorAll<HTMLButtonElement>("button[data-more]").forEach((b) => b.addEventListener("click", () => toggle(b.dataset.more!)));
  el.querySelectorAll<HTMLElement>("[data-fold]").forEach((h) => h.addEventListener("click", () => toggle(h.dataset.fold!)));
  const plans = g.company ? roadPlans(g) : [];
  el.querySelectorAll<HTMLButtonElement>("button[data-road]").forEach((b) => b.addEventListener("click", () => road?.(plans[Number(b.dataset.road)])));
  const TOWN = { library: fundLibrary, steps: buildSteps, incline: buildIncline };
  el.querySelectorAll<HTMLButtonElement>("button[data-town]").forEach((b) => b.addEventListener("click", () => {
    const r = TOWN[b.dataset.town as keyof typeof TOWN](g);
    status = r.ok ? "Done." : r.reason ?? "Can't do that.";
    if (!r.ok) g.log.push({ turn: g.turn, text: r.reason! });
    changed();
  }));
}

export function resetTownUi() { status = ""; }
