// The Town tab: morale, the jobless and the teams; then the great works — the ones you can found now (ahead of
// history), the ones standing, and the ones still to come. Click a name to go there on the map.

import { cal, type GameState } from "../core/game";
import { teamGround, teamName } from "../core/sports";
import { fund, fundBlocked, giveText, greatWorks, WINDOW } from "../core/patronage";
import { esc, fmt } from "../core/text";
import { money } from "./fx";
import { actRow } from "./works";

let status = "";
let showAllBuilt = false;

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
  el.querySelector<HTMLButtonElement>("button[data-more]")?.addEventListener("click", () => { showAllBuilt = !showAllBuilt; townPanel(g, el, changed, go); });
}

export function resetTownUi() { status = ""; }
