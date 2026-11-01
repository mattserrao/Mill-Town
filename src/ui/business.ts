// The Policy tab: actions left, the standing policies as switches (the men; the works), then the labour and public
// actions. Politics lives in the Struggle and moves against a rival on its row in Rivals. And the decision card.

import { ACTIONS_PER_SEASON, type Policy, resolveDecision, setPolicy } from "../core/business";
import { allWorks, cal, type GameState } from "../core/game";
import { Rng } from "../core/rng";
import { esc } from "../core/text";
import { head, more } from "./fx";
import { actionRows, wireActions } from "./actions";
import { managed } from "../core/family";
import { illegal } from "../core/politics";

/** each policy: a short label per option for the switch, and the long one for its tooltip */
const POLICY_UI: { key: keyof Policy; label: string; options: [string, string, string][]; rule?: string }[] = [
  { key: "wages", label: "Wages", options: [["low", "Low", "Below the market"], ["market", "Market", "Market rate"], ["high", "High", "Above the market"], ["scale", "Scale", "Sliding scale: wages follow prices"]] },
  { key: "hours", label: "Shifts", options: [["twelve", "12 h", "Twelve hours, seven days"], ["ten", "10 h", "Ten hours"], ["eight", "8 h", "Eight hours"]] },
  { key: "union", label: "Union", options: [["fight", "Fight", "Fight it"], ["tolerate", "Tolerate", "Tolerate it"], ["recognise", "Recognise", "Recognise it"]], rule: "union" },
  { key: "safety", label: "Safety", options: [["none", "None", "None"], ["basic", "Basic", "Basic guards and rules"], ["programme", "Programme", "A safety programme"]] },
  { key: "waste", label: "Waste", options: [["dump", "Dump", "Slag and waste dumped in the river"], ["standard", "Usual", "Usual practice"], ["abate", "Abate", "Treat and abate"]] },
  { key: "childLabour", label: "Boys under 14", options: [["true", "Hire", "Hire them"], ["false", "No", "Don't"]] },
  { key: "companyStore", label: "Company store", options: [["true", "Yes", "Run one, paid in scrip"], ["false", "No", "No"]] },
  { key: "halfHoliday", label: "Half Saturdays", options: [["true", "Yes", "Saturday half-holiday"], ["false", "No", "A full day's work"]], rule: "halfHoliday" },
  { key: "police", label: "Company police", options: [["true", "Yes", "Coal & Iron Police"], ["false", "No", "None"]], rule: "police" },
  { key: "run", label: "Run", options: [["market", "To orders", "Make what the market will take (the men without work are laid off)"], ["full", "Full", "Run full and stock what doesn't sell (it costs money to carry)"], ["banked", "Banked", "Bank the furnaces: a caretaker crew, the plant kept ready"]] },
];

let staged: Partial<Policy> = {};
let status = "";
const opened = new Set<string>();

/** the switches in two groups: how the men are treated, and how the works runs */
const POLICY_GROUPS_UI: [string, (keyof Policy)[]][] = [
  ["The men", ["wages", "hours", "union", "safety", "childLabour", "companyStore", "halfHoliday", "police"]],
  ["The works", ["run", "waste"]],
];

export function businessPanel(g: GameState, el: HTMLElement, changed: () => void) {
  const c = g.company;
  if (!c) { el.innerHTML = ""; return; }
  const b = c.biz, y = cal(g).year;
  const strike = allWorks(c).some((w) => w.status === "strike" || w.strikeTurns > 0);
  const pips = Array.from({ length: ACTIONS_PER_SEASON }, (_, k) => (k < b.actionsLeft ? "●" : "○")).join("");
  const val = (k: keyof Policy) => String(staged[k] ?? b.policy[k] ?? (k === "run" ? "market" : ""));
  const dirty = Object.keys(staged).some((k) => String(staged[k as keyof Policy]) !== String(b.policy[k as keyof Policy]));
  // a policy is shown unless the law has taken it away (and you're not already using it)
  const shown = (p: (typeof POLICY_UI)[number]) => (p.key !== "run" || y >= 1893) && (!p.rule || !g.rules[p.rule]?.blocked || String(b.policy[p.key]) !== String(p.options[p.options.length - 1][0]) && p.key !== "union");
  const polRow = (p: (typeof POLICY_UI)[number]) => {
    const opts = p.options.filter(([v]) => p.key !== "wages" || v !== "scale" || !g.rules.scale?.blocked || b.policy.wages === "scale");
    return `<div class="pol-row"><span>${p.label}</span><div class="seg">${opts.map(([v, short, long]) => {
      const nv = p.key === "childLabour" || p.key === "companyStore" || p.key === "police" || p.key === "halfHoliday" ? v === "true" : v;
      const law = String(b.policy[p.key]) === v ? null : illegal(g, { [p.key]: nv } as Partial<Policy>);
      return `<button data-pol="${p.key}" data-v="${v}" class="${val(p.key) === v ? "on" : ""}${String(b.policy[p.key]) === v ? " cur" : ""}${law ? " illegal" : ""}" title="${esc(law ?? long)}" ${law || managed(g) ? "disabled" : ""}>${short}</button>`;
    }).join("")}</div></div>`;
  };
  const section = (grp: "Labour" | "Public", title: string) => {
    const { rows, off } = actionRows(g, (a) => a.group === grp);
    if (!rows.length && !off.length) return "";
    const isOpen = opened.has(grp);
    return head(title) + rows.join("") + (isOpen ? `<div class="off">${off.join("")}</div>` : "") + more(grp, isOpen, off.length, "unavailable");
  };
  el.innerHTML = `
    <div class="bz-acts"><span>Actions left this season</span><span class="bz-pips" title="${b.actionsLeft} of ${ACTIONS_PER_SEASON}">${pips}</span></div>
    ${strike ? `<div class="bz-strike">Your men are on strike: negotiate, send in the Pinkertons, bring in strikebreakers — or wait.</div>` : ""}
    ${b.lockout > 0 ? `<div class="bz-strike">Locked out: ${b.lockout} more season${b.lockout > 1 ? "s" : ""}.</div>` : ""}
    ${status ? `<div class="bz-status">${esc(status)}</div>` : ""}
    ${managed(g) ? `<div class="bz-managed">A hired manager runs the works: the policies and the labour actions are his. The family acts through politics (the Struggle), the public and its money.</div>` : ""}
    ${POLICY_GROUPS_UI.map(([title, keys]) => {
      const list = keys.map((k) => POLICY_UI.find((p) => p.key === k)!).filter(shown);
      return list.length ? head(title, title === "The men" ? "a change costs 1 action" : "") + `<div class="bz-pol">${list.map(polRow).join("")}</div>` : "";
    }).join("")}
    ${dirty ? `<div class="pol-apply"><button class="primary" data-apply="1" ${b.actionsLeft ? "" : "disabled"}>Apply changes (1 action)</button><button data-reset="1">Undo</button></div>` : ""}
    ${section("Labour", "Labour")}
    ${section("Public", "The public")}
    <p class="hint">Politics is in the Struggle (S); moves against a rival are on its row in Rivals.</p>`;

  el.querySelectorAll<HTMLButtonElement>("button[data-pol]").forEach((btn) => btn.addEventListener("click", () => {
    const k = btn.dataset.pol as keyof Policy, v = btn.dataset.v!;
    (staged as Record<string, unknown>)[k] = k === "childLabour" || k === "companyStore" || k === "police" || k === "halfHoliday" ? v === "true" : v;
    businessPanel(g, el, changed);
  }));
  el.querySelector<HTMLButtonElement>("[data-apply]")?.addEventListener("click", () => {
    const r = setPolicy(g, staged);
    status = r.ok ? "New policies take effect." : r.text;
    if (r.ok) staged = {};
    changed();
  });
  el.querySelector<HTMLButtonElement>("[data-reset]")?.addEventListener("click", () => { staged = {}; businessPanel(g, el, changed); });
  el.querySelectorAll<HTMLButtonElement>("button[data-more]").forEach((btn) => btn.addEventListener("click", () => {
    const k = btn.dataset.more!;
    if (opened.has(k)) opened.delete(k); else opened.add(k);
    businessPanel(g, el, changed);
  }));
  wireActions(el, g, (t) => { status = t; changed(); });
}

/** clear staged policy edits and status when a new season starts or a new game begins */
export function resetBusinessUi() { staged = {}; status = ""; }

export function decisionCard(g: GameState, el: HTMLElement, done: () => void) {
  const d = g.pendingDecision;
  if (!d) { el.hidden = true; return; }
  const c = cal(g);
  el.innerHTML = `<div class="paper">
    <div class="mast"><span>A decision for ${esc(g.company?.name ?? "you")}</span><span>${c.season} ${c.year}</span></div>
    <h3>${esc(d.title)}</h3>
    <p>${esc(d.text)}</p>
    <div class="dec-opts">${d.options.map((o, k) => `<button data-k="${k}" class="${k === d.historical ? "hist" : ""}"><b>${esc(o.label)}</b><span>${esc(o.detail)}</span>${k === d.historical ? "<em>What the owners did</em>" : ""}</button>`).join("")}</div>
  </div>`;
  el.hidden = false;
  el.querySelectorAll<HTMLButtonElement>("button[data-k]").forEach((btn) => btn.addEventListener("click", () => {
    status = resolveDecision(g, new Rng(`${g.seed}:dec:${g.turn}`), Number(btn.dataset.k));
    el.hidden = true;
    done();
  }));
}
