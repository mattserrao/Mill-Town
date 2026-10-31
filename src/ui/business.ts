// The "Running the business" panel: standings, actions left, standing policies, actions; and the decision card
// for historical moments that reach your works.

import { ACTIONS, ACTIONS_PER_SEASON, actionBlocked, actionCost, type Meters, newestGroup, type Policy, resolveDecision, setPolicy, takeAction } from "../core/business";
import { GROUPS } from "../core/ancestry";
import { cal, type GameState } from "../core/game";
import { Rng } from "../core/rng";
import { RIVALS } from "../core/rivals";
import { rivalName, targets } from "../core/rivalai";
import { allWorks } from "../core/game";

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const money = (n: number) => "$" + Math.round(n).toLocaleString("en-US");

const WORDS: Record<keyof Meters, (v: number) => string> = {
  reputation: (v) => (v < -50 ? "Reviled" : v < -20 ? "Distrusted" : v < 15 ? "Unremarkable" : v < 45 ? "Respected" : "Admired"),
  labour: (v) => (v < -50 ? "Hostile" : v < -20 ? "Bitter" : v < 15 ? "Uneasy" : v < 45 ? "Steady" : "Loyal"),
  influence: (v) => (v < 10 ? "None to speak of" : v < 30 ? "A friend at City Hall" : v < 60 ? "Heard in Harrisburg" : "Heard in Washington"),
};

function meterRow(label: string, key: keyof Meters, v: number) {
  const signed = key !== "influence";
  const pct = signed ? (v + 100) / 2 : v;
  const col = key === "influence" ? "#c8a040" : v >= 0 ? "#5aa860" : "#c8503a";
  const left = signed ? Math.min(50, pct) : 0, width = signed ? Math.abs(pct - 50) : pct;
  return `<div class="bz-meter"><div class="bz-k">${label}</div><div class="bz-bar">${signed ? '<i class="bz-mid"></i>' : ""}<b style="left:${left}%;width:${width}%;background:${col}"></b></div><div class="bz-v">${Math.round(v)} · ${WORDS[key](v)}</div></div>`;
}

const POLICY_UI: { key: keyof Policy; label: string; options: [string, string][]; rule?: string }[] = [
  { key: "wages", label: "Wages", options: [["low", "Below the market"], ["market", "Market rate"], ["high", "Above the market"], ["scale", "Sliding scale (follows prices)"]] },
  { key: "hours", label: "Shifts", options: [["twelve", "Twelve hours, seven days"], ["ten", "Ten hours"], ["eight", "Eight hours"]] },
  { key: "union", label: "The union", options: [["fight", "Fight it"], ["tolerate", "Tolerate it"], ["recognise", "Recognise it"]], rule: "union" },
  { key: "police", label: "Company police", options: [["false", "None"], ["true", "Coal & Iron Police"]], rule: "police" },
  { key: "halfHoliday", label: "Saturdays", options: [["false", "A full day's work"], ["true", "Half-holiday"]], rule: "halfHoliday" },
  { key: "safety", label: "Safety", options: [["none", "None"], ["basic", "Basic guards and rules"], ["programme", "Safety programme"]] },
  { key: "childLabour", label: "Boys under 14", options: [["true", "Hire them"], ["false", "Don't"]] },
  { key: "companyStore", label: "Company store", options: [["true", "Run one (paid in scrip)"], ["false", "No"]] },
  { key: "waste", label: "Slag and waste", options: [["dump", "Dump in the river"], ["standard", "Usual practice"], ["abate", "Treat and abate"]] },
];

let staged: Partial<Policy> = {};
let status = "";
let actionCount = 0;
let rivalTarget = "";

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
  const val = (k: keyof Policy) => String(staged[k] ?? b.policy[k]);
  const dirty = Object.keys(staged).some((k) => String(staged[k as keyof Policy]) !== String(b.policy[k as keyof Policy]));
  const groups = ["Labour", "Public", "Politics", "Rivals"] as const;
  const targetSel = tl.length ? `<label class="bz-target">Against <select data-target>${tl.map((r) => { const d = RIVALS.find((x) => x.id === r.id)!; return `<option value="${r.id}"${r.id === rivalTarget ? " selected" : ""}>${esc(rivalName(d, cal(g).year))} (${d.industry === "metalworks" ? "boats & machinery" : d.industry})</option>`; }).join("")}</select></label>` : `<p class="hint">No rival works open yet.</p>`;
  const recruitable = GROUPS.filter((gr) => gr.id >= 2 && gr.wave(y) > 0.05);
  el.innerHTML = `
    ${meterRow("Reputation", "reputation", b.meters.reputation)}
    ${meterRow("Labour relations", "labour", b.meters.labour)}
    ${meterRow("Influence", "influence", b.meters.influence)}
    <div class="bz-acts">Actions this season <span class="bz-pips">${pips}</span> <span class="hint">${b.actionsLeft} of ${ACTIONS_PER_SEASON} left</span></div>
    ${strike ? `<div class="bz-strike">Your men are out on strike. Negotiate, send in the Pinkertons, bring in strikebreakers — or wait.</div>` : ""}
    ${b.lockout > 0 ? `<div class="bz-strike">The works is locked out (${b.lockout} more season${b.lockout > 1 ? "s" : ""}).</div>` : ""}
    ${status ? `<div class="bz-status">${esc(status)}</div>` : ""}
    <h4>Standing policies</h4>
    <div class="bz-pol">
      ${POLICY_UI.filter((p) => !p.rule || !g.rules[p.rule]?.blocked || String(b.policy[p.key]) !== String(p.options[0][0]) && p.key !== "union").map((p) => `<label>${p.label}<select data-pol="${p.key}">${p.options.filter(([v]) => p.key !== "wages" || v !== "scale" || !g.rules.scale?.blocked || b.policy.wages === "scale").map(([v, t]) => `<option value="${v}"${val(p.key) === v ? " selected" : ""}>${t}</option>`).join("")}</select></label>`).join("")}
    </div>
    ${dirty ? `<button class="primary bz-apply" data-apply="1" ${b.actionsLeft ? "" : "disabled"}>Apply policy changes (1 action)</button>` : ""}
    ${groups.map((grp) => `<h4>${grp === "Rivals" ? "Rivals and money" : grp}</h4>` + (grp === "Rivals" ? targetSel : "") + ACTIONS.filter((a) => a.group === grp).map((a) => {
      // not yet invented or no longer legal: hidden (the newspaper tells you when it changes)
      if (g.rules[a.id]?.blocked) return "";
      const arg = a.target ? rivalTarget : undefined;
      if (a.target && !tl.length) return "";
      const why = actionBlocked(g, a, arg) ?? (b.actionsLeft <= 0 ? "No actions left this season" : c.cash < actionCost(g, a, arg) ? `Needs ${money(actionCost(g, a, arg))}` : null);
      if (a.id !== "negotiate" && a.id !== "pinkertons" && a.id !== "strikebreakers" && why === "Only during a strike") return "";
      if (why === "Only during a strike") return "";
      const extra = a.id === "recruit"
        ? `<select data-arg="recruit">${recruitable.map((gr) => `<option value="${gr.id}"${gr.id === newestGroup(y) ? " selected" : ""}>${gr.name}</option>`).join("")}</select>`
        : (a.id === "sell" || a.id === "sell_workers") && c.others.length ? `<select data-arg="${a.id}">${c.others.map((w) => `<option value="${w.id}">${esc(w.name)}</option>`).join("")}</select>`
        : a.id === "locks" ? `<select data-arg="locks"><option value="upper_mon">Monongahela</option><option value="allegheny">Allegheny</option><option value="ohio">Ohio</option></select>` : "";
      const cost = actionCost(g, a, arg);
      return `<div class="bz-act${strike && (a.id === "negotiate" || a.id === "pinkertons" || a.id === "strikebreakers") ? " bz-hot" : ""}">
        <button data-act="${a.id}" ${why ? `disabled title="${esc(why)}"` : ""}>${esc(a.name)}${cost ? ` — ${money(cost)}` : ""}</button>${extra}
        <div class="hint">${esc(a.blurb)}${why && why !== "No actions left this season" ? ` <i>(${esc(why)})</i>` : ""}</div></div>`;
    }).join("")).join("")}
    ${b.record.length ? `<h4>Your record</h4><ol class="bz-rec">${b.record.slice(-6).reverse().map((r) => `<li>${esc(r)}</li>`).join("")}</ol>` : ""}`;

  el.querySelectorAll<HTMLSelectElement>("select[data-pol]").forEach((s) => s.addEventListener("change", () => {
    const k = s.dataset.pol as keyof Policy;
    (staged as Record<string, unknown>)[k] = k === "childLabour" || k === "companyStore" || k === "police" || k === "halfHoliday" ? s.value === "true" : s.value;
    businessPanel(g, el, changed);
  }));
  el.querySelector<HTMLSelectElement>("select[data-target]")?.addEventListener("change", (e) => { rivalTarget = (e.target as HTMLSelectElement).value; businessPanel(g, el, changed); });
  el.querySelector<HTMLButtonElement>("[data-apply]")?.addEventListener("click", () => {
    const r = setPolicy(g, staged);
    status = r.ok ? "New policies take effect." : r.text;
    if (r.ok) staged = {};
    changed();
  });
  el.querySelectorAll<HTMLButtonElement>("button[data-act]").forEach((btn) => btn.addEventListener("click", () => {
    const id = btn.dataset.act!;
    const a = ACTIONS.find((x) => x.id === id);
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
