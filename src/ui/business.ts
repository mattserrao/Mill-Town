// The Policy tab: actions left, standing policies as switches, then the actions in four groups, one row each
// (name, cost, effect chips; the full description in the tooltip). And the decision card for historical moments.

import { ACTIONS_PER_SEASON, allActions, actionBlocked, actionCost, newestGroup, type Policy, resolveDecision, setPolicy, takeAction } from "../core/business";
import { GROUPS } from "../core/ancestry";
import { cal, type GameState } from "../core/game";
import { Rng } from "../core/rng";
import { RIVALS } from "../core/rivals";
import { rivalName, targets } from "../core/rivalai";
import { allWorks } from "../core/game";
import { esc } from "../core/text";
import { chips, money } from "./fx";
import { actRow } from "./works";
import { managed } from "../core/family";
import { illegal, LAWS, lawsOf, lawYear, LEVEL_NAME, LEVELS } from "../core/politics";
import { inPolitics } from "../core/career";

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
let actionCount = 0;
let rivalTarget = "";
const opened = new Set<string>();

export function businessPanel(g: GameState, el: HTMLElement, changed: () => void) {
  const c = g.company;
  if (!c) { el.innerHTML = ""; return; }
  const b = c.biz, y = cal(g).year;
  const strike = allWorks(c).some((w) => w.status === "strike" || w.strikeTurns > 0);
  const tl = targets(g);
  if (!tl.some((r) => r.id === rivalTarget)) {
    const mine = new Set(allWorks(c).map((w) => w.industry));
    rivalTarget = (tl.find((r) => mine.has(RIVALS.find((d) => d.id === r.id)!.industry)) ?? tl[0])?.id ?? "";
  }
  const pips = Array.from({ length: ACTIONS_PER_SEASON }, (_, k) => (k < b.actionsLeft ? "●" : "○")).join("");
  const val = (k: keyof Policy) => String(staged[k] ?? b.policy[k] ?? (k === "run" ? "market" : ""));
  const dirty = Object.keys(staged).some((k) => String(staged[k as keyof Policy]) !== String(b.policy[k as keyof Policy]));
  const groups = inPolitics(g) ? (["Office", "Politics", "Public", "Labour", "Environment", "Rivals"] as const) : (["Labour", "Public", "Politics", "Environment", "Rivals"] as const);
  const pendingLaws = LAWS.filter((l) => lawsOf(g)[l.id].passed === undefined && l.range[1] >= y && lawYear(g, l) <= y + 25);
  const recruitable = GROUPS.filter((gr) => gr.id >= 2 && gr.wave(y) > 0.05);
  // a policy is shown unless the law has taken it away (and you're not already using it)
  const shown = POLICY_UI.filter((p) => (p.key !== "run" || y >= 1893) && (!p.rule || !g.rules[p.rule]?.blocked || String(b.policy[p.key]) !== String(p.options[p.options.length - 1][0]) && p.key !== "union"));
  el.innerHTML = `
    <div class="bz-acts"><span>Actions left this season</span><span class="bz-pips" title="${b.actionsLeft} of ${ACTIONS_PER_SEASON}">${pips}</span></div>
    ${strike ? `<div class="bz-strike">Your men are on strike: negotiate, send in the Pinkertons, bring in strikebreakers — or wait.</div>` : ""}
    ${b.lockout > 0 ? `<div class="bz-strike">Locked out: ${b.lockout} more season${b.lockout > 1 ? "s" : ""}.</div>` : ""}
    ${status ? `<div class="bz-status">${esc(status)}</div>` : ""}
    ${managed(g) ? `<div class="bz-managed">A hired manager runs the works: policies and the labour and rival actions are his. The family acts through politics, the public and its holdings.</div>` : ""}
    <h4 class="mh">Standing policies<span>a change costs 1 action</span></h4>
    <div class="bz-pol">${shown.map((p) => {
      const opts = p.options.filter(([v]) => p.key !== "wages" || v !== "scale" || !g.rules.scale?.blocked || b.policy.wages === "scale");
      return `<div class="pol-row"><span>${p.label}</span><div class="seg">${opts.map(([v, short, long]) => {
        const nv = p.key === "childLabour" || p.key === "companyStore" || p.key === "police" || p.key === "halfHoliday" ? v === "true" : v;
        const law = String(b.policy[p.key]) === v ? null : illegal(g, { [p.key]: nv } as Partial<Policy>);
        return `<button data-pol="${p.key}" data-v="${v}" class="${val(p.key) === v ? "on" : ""}${String(b.policy[p.key]) === v ? " cur" : ""}${law ? " illegal" : ""}" title="${esc(law ?? long)}" ${law || managed(g) ? "disabled" : ""}>${short}</button>`;
      }).join("")}</div></div>`;
    }).join("")}</div>
    ${dirty ? `<div class="pol-apply"><button class="primary" data-apply="1" ${b.actionsLeft ? "" : "disabled"}>Apply changes (1 action)</button><button data-reset="1">Undo</button></div>` : ""}
    ${groups.map((grp) => {
      const rows: string[] = [], off: string[] = [];
      for (const a of allActions().filter((x) => x.group === grp)) {
        if (g.rules[a.id]?.blocked) continue; // not yet invented or no longer legal
        if (a.target && !tl.length) continue;
        const arg = a.target ? rivalTarget : a.id === "push_law" || a.id === "block_law" || a.id === "pass_bill" || a.id === "kill_bill" ? pendingLaws[0]?.id : undefined;
        const blocked = actionBlocked(g, a, arg);
        if (blocked === "Only during a strike") continue;
        const cost = actionCost(g, a, arg);
        const why = blocked ?? (b.actionsLeft <= 0 ? "No actions left this season" : c.cash < cost ? `Needs ${money(cost)}` : null);
        const extra = a.id === "recruit"
          ? `<select data-arg="recruit">${recruitable.map((gr) => `<option value="${gr.id}"${gr.id === newestGroup(y) ? " selected" : ""}>${gr.name}</option>`).join("")}</select>`
          : (a.id === "sell" || a.id === "sell_workers" || a.id === "sell_authority") && c.others.length ? `<select data-arg="${a.id}">${c.others.map((w) => `<option value="${w.id}">${esc(w.name)}</option>`).join("")}</select>`
          : a.id === "locks" ? `<select data-arg="locks"><option value="upper_mon">Mon</option><option value="allegheny">Allegheny</option><option value="ohio">Ohio</option></select>`
          : a.id === "fund_business" || a.id === "fund_reform" ? `<select data-arg="${a.id}">${LEVELS.map((lv) => `<option value="${lv}">${LEVEL_NAME[lv]}</option>`).join("")}</select>`
          : (a.id === "push_law" || a.id === "block_law" || a.id === "pass_bill" || a.id === "kill_bill") && pendingLaws.length ? `<select data-arg="${a.id}">${pendingLaws.map((l) => `<option value="${l.id}">${esc(l.name)} (${lawYear(g, l)})</option>`).join("")}</select>` : "";
        const row = actRow(esc(a.name), `<button data-act="${a.id}" ${why ? "disabled" : ""}>${cost ? money(cost) : "Do"}</button>`, chips(a.blurb), `${a.blurb}${why ? ` — ${why}` : ""}`, extra);
        // unavailable for a reason other than this season's limits: folded away
        (blocked && !(strike && ["negotiate", "pinkertons", "strikebreakers"].includes(a.id)) ? off : rows).push(strike && ["negotiate", "pinkertons", "strikebreakers"].includes(a.id) ? row.replace('class="act"', 'class="act hot"') : row);
      }
      if (!rows.length && !off.length) return "";
      const isOpen = opened.has(grp);
      return `<h4 class="mh">${grp === "Rivals" ? "Rivals & money" : grp === "Office" ? "In office" : grp}${off.length ? `<button class="link" data-more="${grp}">${isOpen ? "hide" : `${off.length} unavailable`}</button>` : ""}</h4>`
        + (grp === "Rivals" && tl.length ? `<label class="bz-target">Against <select data-target>${tl.map((r) => { const d = RIVALS.find((x) => x.id === r.id)!; return `<option value="${r.id}"${r.id === rivalTarget ? " selected" : ""}>${esc(rivalName(d, y))}</option>`; }).join("")}</select></label>` : "")
        + rows.join("") + (isOpen ? `<div class="off">${off.join("")}</div>` : "");
    }).join("")}
    ${b.record.length ? `<h4 class="mh">Your record</h4><ol class="bz-rec">${b.record.slice(-4).reverse().map((r) => `<li>${esc(r)}</li>`).join("")}</ol>` : ""}`;

  el.querySelectorAll<HTMLButtonElement>("button[data-pol]").forEach((btn) => btn.addEventListener("click", () => {
    const k = btn.dataset.pol as keyof Policy, v = btn.dataset.v!;
    (staged as Record<string, unknown>)[k] = k === "childLabour" || k === "companyStore" || k === "police" || k === "halfHoliday" ? v === "true" : v;
    businessPanel(g, el, changed);
  }));
  el.querySelector<HTMLSelectElement>("select[data-target]")?.addEventListener("change", (e) => { rivalTarget = (e.target as HTMLSelectElement).value; businessPanel(g, el, changed); });
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
  el.querySelectorAll<HTMLButtonElement>("button[data-act]").forEach((btn) => btn.addEventListener("click", () => {
    const id = btn.dataset.act!;
    const a = allActions().find((x) => x.id === id);
    const arg = a?.target ? rivalTarget : el.querySelector<HTMLSelectElement>(`select[data-arg="${id}"]`)?.value;
    const r = takeAction(g, id, new Rng(`${g.seed}:act:${g.turn}:${actionCount++}`), arg);
    status = r.text;
    changed();
  }));
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
