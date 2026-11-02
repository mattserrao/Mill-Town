// One way to show an action anywhere (v0.19): the Policy tab, the Struggle, a rival's "⋯" menu, the Money tab and
// the sell dialog all build their rows here and wire their buttons here. Each row: name, any picker (which
// community, which river, which works, which law), its cost or "Free", and its effects as chips.

import { actionBlocked, actionCost, allActions, type ActionDef, newestGroup, takeAction } from "../core/business";
import { GROUPS } from "../core/ancestry";
import { allWorks, cal, type GameState } from "../core/game";
import { LAWS, lawsOf, lawYear, LEVEL_NAME, LEVELS } from "../core/politics";
import { Rng } from "../core/rng";
import { esc } from "../core/text";
import { actRow, chips, costButton, money } from "./fx";

const STRIKE_ACTS = ["negotiate", "pinkertons", "strikebreakers"];

/** the bills still to come within 25 years */
const pendingLaws = (g: GameState) => { const y = cal(g).year; return LAWS.filter((l) => lawsOf(g)[l.id].passed === undefined && l.range[1] >= y && lawYear(g, l) <= y + 25); };
const LAW_ACTS = new Set(["push_law", "block_law", "pass_bill", "kill_bill"]);

/** a picker for the actions that need one */
function picker(g: GameState, a: ActionDef): string {
  const c = g.company!, y = cal(g).year;
  if (a.id === "recruit") return `<select data-arg="recruit">${GROUPS.filter((gr) => gr.id >= 2 && gr.wave(y) > 0.05).map((gr) => `<option value="${gr.id}"${gr.id === newestGroup(y) ? " selected" : ""}>${gr.name}</option>`).join("")}</select>`;
  if ((a.id === "sell" || a.id === "sell_workers" || a.id === "sell_authority") && c.others.length) return `<select data-arg="${a.id}">${c.others.map((w) => `<option value="${w.id}">${esc(w.name)}</option>`).join("")}</select>`;
  if (a.id === "locks") return `<select data-arg="locks"><option value="upper_mon">Mon</option><option value="allegheny">Allegheny</option><option value="ohio">Ohio</option></select>`;
  if (a.id === "fund_business" || a.id === "fund_reform") return `<select data-arg="${a.id}">${LEVELS.map((lv) => `<option value="${lv}">${LEVEL_NAME[lv]}</option>`).join("")}</select>`;
  const pl = pendingLaws(g);
  if (LAW_ACTS.has(a.id) && pl.length) return `<select data-arg="${a.id}">${pl.map((l) => `<option value="${l.id}">${esc(l.name)} (${lawYear(g, l)})</option>`).join("")}</select>`;
  return "";
}

/** The rows for a set of actions: those you can take (or could, with cash or an action to spare) and those
 *  unavailable for a reason of their own (the law, the era, no strike), which a panel can fold away. */
export function actionRows(g: GameState, which: (a: ActionDef) => boolean, target?: string): { rows: string[]; off: string[] } {
  const c = g.company, rows: string[] = [], off: string[] = [];
  if (!c) return { rows, off };
  const strike = allWorks(c).some((w) => w.status === "strike" || w.strikeTurns > 0);
  for (const a of allActions().filter(which)) {
    if (g.rules[a.id]?.blocked) continue; // not yet invented or no longer legal
    const arg = a.target ? target : LAW_ACTS.has(a.id) ? pendingLaws(g)[0]?.id : undefined;
    if (a.target && !arg) continue;
    const blocked = actionBlocked(g, a, arg);
    if (blocked === "Only during a strike") continue;
    const cost = actionCost(g, a, arg);
    const why = blocked ?? (c.biz.actionsLeft <= 0 ? "No actions left this season" : c.cash < cost ? `Needs ${money(cost)}` : null);
    const hot = strike && STRIKE_ACTS.includes(a.id);
    let row = actRow(esc(a.name), costButton(`data-act="${a.id}"${a.target && arg ? ` data-target="${esc(arg)}"` : ""}`, cost, why), chips(a.blurb), `${a.blurb}${why ? ` — ${why}` : ""}`, picker(g, a));
    if (hot) row = row.replace('class="act"', 'class="act hot"');
    (blocked && !hot ? off : rows).push(row);
  }
  return { rows, off };
}

/** Wire every action button under el: the picker beside it (or its rival) is the argument. */
export function wireActions(el: HTMLElement, g: GameState, done: (text: string) => void) {
  el.querySelectorAll<HTMLButtonElement>("button[data-act]").forEach((btn) => btn.addEventListener("click", (e) => {
    e.stopPropagation();
    const id = btn.dataset.act!;
    const arg = btn.dataset.target ?? btn.closest(".act")?.querySelector<HTMLSelectElement>(`select[data-arg="${id}"]`)?.value;
    // seeded from the game's own state (not a counter that resets on reload), so saving before a bribe and
    // loading until it comes off doesn't work
    const r = takeAction(g, id, new Rng(`${g.seed}:act:${g.turn}:${id}:${g.company?.biz.actionsLeft ?? 0}:${g.log.length}`), arg);
    done(r.text);
  }));
}

/** the action groups and which home each has in the interface */
export const POLICY_GROUPS = new Set(["Labour", "Public"]);
export const STRUGGLE_GROUPS = new Set(["Politics", "Office"]);
/** actions shown as their own buttons elsewhere in the Struggle */
export const STRUGGLE_BUTTONS = new Set(["fund_business", "fund_reform", "push_law", "block_law", "pass_bill", "kill_bill", "run", "police_out", "police_in", "mediate", "city_contract", "tariff_vote"]);
export const SELL_ACTS = new Set(["sell", "sell_workers", "sell_authority"]);
