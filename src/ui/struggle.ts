// The Struggle (S): labour, politics and the other owners side by side — the union at your works and any strike
// on its four fronts; who holds office, the balance behind them, the next elections and the laws in play; each
// rival's stance, what it's preparing and how it last answered you. Below, the family ledger and the family.
// Also the succession card and the top-bar family chip.

import { actionBlocked, actionCost, allActions, takeAction } from "../core/business";
import { cal, type GameState } from "../core/game";
import { INDUSTRIES, type IndustryId } from "../core/industries";
import { age, estateRate, estateTax, foundationGift, fullName, head, managed, PATH_SHORT, PATHS, type Path, resolveSuccession, TRAITS } from "../core/family";
import { leaderOf, sieges, type Union, unionName } from "../core/labour";
import { generation, standing, topMarks, whoDid } from "../core/ledger";
import { BODY, favoursAt, holderNow, LAWS, lawsOf, lawYear, LEVEL_NAME, LEVELS, nextElection, polOf, reformOdds } from "../core/politics";
import { ownersOf, stanceWord } from "../core/owners";
import { nextOffice, OFFICES, raceOdds } from "../core/career";
import { RIVALS } from "../core/rivals";
import { rivalName } from "../core/rivalai";
import { Rng } from "../core/rng";
import { esc } from "../core/text";
import { money } from "./fx";

let status = "";
let seq = 0;

const bar = (v: number, max: number, col: string, title = "") => `<span class="st-bar" title="${esc(title)}"><b style="width:${Math.max(2, Math.min(100, (v / max) * 100))}%;background:${col}"></b></span>`;
/** −100 … +100 centred bar: business (left, amber) … reform (right, green) */
const lean = (v: number, title: string) => `<span class="st-lean" title="${esc(title)}"><i></i><b style="left:${v < 0 ? 50 + v / 2 : 50}%;width:${Math.abs(v) / 2}%;background:${v < 0 ? "#e0a243" : "#7fc77a"}"></b></span>`;

function actBtn(g: GameState, id: string, label: string, arg?: string): string {
  const a = allActions().find((x) => x.id === id);
  if (!a || !g.company) return "";
  const why = actionBlocked(g, a, arg) ?? (g.company.biz.actionsLeft <= 0 ? "No actions left this season" : null);
  const cost = actionCost(g, a, arg);
  const short = why ?? (g.company.cash < cost ? `Needs ${money(cost)}` : null);
  return `<button data-sact="${id}" ${arg ? `data-arg="${esc(arg)}"` : ""} ${short ? "disabled" : ""} title="${esc(a.blurb + (short ? ` — ${short}` : ""))}">${esc(label)}${cost ? ` · ${money(cost)}` : ""}</button>`;
}

function unionBlock(g: GameState, u: Union): string {
  const y = cal(g).year, s = u.siege;
  const name = unionName(u.industry, y) ?? "The men";
  const fronts = s ? `
    <div class="st-siege">
      <div class="st-h">On strike · season ${s.seasons} · for ${s.demand}</div>
      <div class="st-kv"><span>Money</span>${bar(u.fund, 6, "#7fc77a", "Their strike fund, in seasons")}<em>${u.fund.toFixed(1)} seasons left in their fund</em></div>
      <div class="st-kv"><span>Men</span>${bar(s.men, 1, "#e0a243", "Jobs filled by strikebreakers")}<em>${Math.round(s.men * 100)}% of the jobs filled</em></div>
      <div class="st-kv"><span>Force</span>${bar(s.force, 1.5, "#e06a5a", "Guards, police and troops")}<em>${s.force < 0.2 ? "none" : s.force < 0.8 ? "guards at the gates" : "troops in the streets"}</em></div>
      <div class="st-kv"><span>Opinion</span>${lean(s.opinion * -100, "Public opinion")}<em>${s.opinion > 0.25 ? "with the strikers" : s.opinion < -0.25 ? "with you" : "divided"}</em></div>
      ${s.dead ? `<p class="bad">${s.dead} killed on the picket lines.</p>` : ""}
      <div class="st-acts">${actBtn(g, "negotiate", "Settle")}${actBtn(g, "strikebreakers", "Strikebreakers")}${actBtn(g, "pinkertons", "Guards")}${actBtn(g, "favour_troops", "Troops")}${actBtn(g, "press", "Papers")}</div>
    </div>` : "";
  return `<div class="st-card">
    <div class="st-title"><b>${esc(name)}</b><span>${esc(INDUSTRIES[u.industry].name)} · ${esc(leaderOf(u.industry, y))}</span></div>
    <div class="st-kv"><span>Members</span>${bar(u.membership, 1, "#7ac8e0")}<em>${Math.round(u.membership * 100)}% of your men</em></div>
    <div class="st-kv"><span>Militancy</span>${bar(u.militancy, 100, u.militancy > 60 ? "#e06a5a" : "#e0a243")}<em>${u.militancy < 30 ? "calm" : u.militancy < 50 ? "restless" : u.militancy < 70 ? "angry" : "ready to walk out"}</em></div>
    <div class="st-kv"><span>Fund</span>${bar(u.fund, 6, "#7fc77a")}<em>${u.fund.toFixed(1)} seasons of strike pay</em></div>
    <p class="st-note">${u.coop ? "The men own the works." : u.recognised ? "Recognised: a signed contract." : "Not recognised."} Strikes won ${u.won}, lost ${u.lost}.${u.broken ? ` Broken in ${u.broken}.` : ""}${u.demand ? ` <b>Demands on the table.</b>` : ""}</p>
    ${fronts}
  </div>`;
}

export function struggleView(g: GameState, el: HTMLElement, changed: () => void, close: () => void) {
  const c = g.company, y = cal(g).year;
  if (!c) { el.innerHTML = `<div class="tr-head"><h3>The Struggle</h3><span class="spacer"></span><button data-close>Close ✕</button></div><p class="tr-empty hint">Found a company first.</p>`; el.querySelector("[data-close]")!.addEventListener("click", close); return; }
  const p = polOf(g), L = lawsOf(g), h = head(g);
  const unions = Object.values(g.unions ?? {}).filter((u): u is Union => !!u);
  const lab = standing(g, "labour");
  // labour column
  const labourCol = `
    <h4>Labour <span class="${lab < 0 ? "bad" : "good"}">${lab < -20 ? "they hold a grudge" : lab > 20 ? "they trust the family" : "wary"}</span></h4>
    ${unions.length ? unions.map((u) => unionBlock(g, u)).join("") : `<p class="hint">No union at your works yet${y < 1858 ? " (the Sons of Vulcan form in 1858)" : ""}.</p>`}`;
  // politics column
  const levelRows = LEVELS.map((lv) => {
    const hd = holderNow(g, lv), b = p.balance[lv], ne = nextElection(lv, y), odds = Math.round(reformOdds(g, lv) * 100), f = p.fund[lv], fav = favoursAt(g, lv);
    return `<div class="st-card">
      <div class="st-title"><b>${esc(hd.title)} ${esc(hd.name)}</b><span>${esc(hd.party)} · ${LEVEL_NAME[lv]}</span></div>
      <div class="st-kv"><span>${BODY[lv].replace("the ", "")}</span>${lean(b, "Business ← → Reform and labour")}<em>${b < -15 ? "business" : b > 15 ? "reform & labour" : "divided"}</em></div>
      <p class="st-note">Election ${ne}: reform ${odds}% · business ${100 - odds}%.${f ? ` You've pledged ${money(f.amount)} to the ${f.side} side.` : ""}${fav ? ` <b>${fav} favour${fav > 1 ? "s" : ""} owed.</b>` : ""}</p>
      <div class="st-acts">${actBtn(g, "fund_business", "Fund business", lv)}${actBtn(g, "fund_reform", "Fund reform", lv)}</div>
    </div>`;
  }).join("");
  const lawRows = LAWS.filter((l) => l.range[1] >= y - 3 || L[l.id].passed && L[l.id].passed! >= y - 10).map((l) => {
    const s = L[l.id], due = lawYear(g, l), moved = s.passed ?? due;
    const delta = moved - l.year;
    const state = s.passed !== undefined ? `law since ${s.passed}${s.defied ? " — <b class=\"bad\">you defy it</b>" : ""}` : `due ${due}`;
    return `<div class="st-law"><div><b>${esc(l.name)}</b><span>${state}${delta ? ` <em class="${(delta < 0) === (l.side === "reform") ? "good" : "bad"}">(${delta < 0 ? `${-delta} yr early` : `${delta} yr late`})</em>` : ""}</span></div>
      ${s.passed === undefined ? `<div class="st-acts">${actBtn(g, "push_law", "Back", l.id)}${actBtn(g, "block_law", "Block", l.id)}${g.career?.office ? actBtn(g, "pass_bill", "Pass", l.id) + actBtn(g, "kill_bill", "Kill", l.id) : ""}</div>` : ""}</div>`;
  }).join("");
  const car = g.career, no = nextOffice(g);
  const careerRow = h?.path === "politics" ? `<div class="st-card"><div class="st-title"><b>${esc(fullName(g, h))}</b><span>${car?.office ? esc(OFFICES[car.office].name) + (car.until ? ` to ${car.until}` : "") : "no office yet"}</span></div>
    ${car?.running ? `<p class="st-note">Running for ${OFFICES[car.running.office].name.toLowerCase()}: ${Math.round(raceOdds(g, car.running.office, car.running.spent) * 100)}% odds this autumn.</p>` : no ? `<p class="st-note">Next: ${OFFICES[no].name.toLowerCase()} (${Math.round(raceOdds(g, no) * 100)}% odds).</p>` : ""}
    <div class="st-acts">${actBtn(g, "run", "Run for office")}${actBtn(g, "police_out", "Police out")}${actBtn(g, "police_in", "Police in")}${actBtn(g, "mediate", "Mediate")}${actBtn(g, "city_contract", "Contract")}${actBtn(g, "tariff_vote", "Tariff")}</div></div>` : "";
  const politicsCol = `<h4>Politics <span>${p.scandal > 5 ? `<b class="bad">scandal</b>` : ""}</span></h4>${careerRow}${levelRows}<h5>Laws</h5>${lawRows}`;
  // owners column
  const o = ownersOf(g);
  const rivals = g.rivals.filter((r) => r.active && !r.owned && !r.closed).sort((a, b) => (a.stance ?? 0) - (b.stance ?? 0));
  const ownersCol = `<h4>Owners <span>${o.member ? "in the association" : `<b class="bad">expelled${o.expelled ? ` ${o.expelled}` : ""}</b>`}</span></h4>
    ${rivals.map((r) => {
      const d = RIVALS.find((x) => x.id === r.id)!, s = r.stance ?? 0;
      return `<div class="st-card st-riv">
        <div class="st-title"><b>${esc(rivalName(d, y))}</b><span>${esc(d.figures[0])} · ${INDUSTRIES[d.industry].name.toLowerCase()}</span></div>
        <div class="st-kv"><span>${stanceWord(s)}</span>${lean(s, "Hostile ← → Ally")}<em>${Math.round(s)}</em></div>
        ${r.intent ? `<p class="st-intent">Next season: ${esc(r.intent.text.replace(/^.*? is /, "").replace(/^.*?'s /, ""))}</p>` : ""}
        ${r.answered ? `<p class="st-note">${esc(r.answered)}</p>` : ""}
      </div>`;
    }).join("") || `<p class="hint">No rival works open.</p>`}`;
  // ledger and family
  const marks = topMarks(g, 10);
  const f = g.family;
  el.innerHTML = `
    <div class="tr-head"><h3>The Struggle</h3><span class="hint">${h ? `${esc(fullName(g, h))}, ${age(g, h)} · head of the family since ${h.from}` : ""}${managed(g) ? " · a manager runs the works" : ""}</span><span class="spacer"></span><span class="hint">${c.biz.actionsLeft} action${c.biz.actionsLeft === 1 ? "" : "s"} left</span><button data-close>Close ✕</button></div>
    ${status ? `<div class="st-status">${esc(status)}</div>` : ""}
    <div class="st-grid"><div class="st-col">${labourCol}</div><div class="st-col">${politicsCol}</div><div class="st-col">${ownersCol}</div></div>
    <div class="st-foot">
      <div class="st-ledger"><h5>What the valley remembers</h5>${marks.length ? marks.map((m) => `<span class="st-mark ${m.kind === "trust" || m.kind === "favour" ? "good" : m.kind === "precedent" ? "" : "bad"}" title="${esc(`${m.kind} · ${m.side} · weight ${Math.round(m.weight)}${m.martyrs ? ` · ${m.martyrs} killed` : ""}`)}">${m.year} · ${esc(whoDid(g, m))} ${esc(m.text)}</span>`).join("") : `<span class="hint">Nothing yet.</span>`}</div>
      <div class="st-family"><h5>The ${esc(f?.surname ?? "")} family</h5>${(f?.heads ?? []).map((x, k) => `<span class="${k === generation(g) ? "on" : ""}" title="${esc(x.verdict ?? "")}">${esc(x.first)} ${x.from}–${x.to ?? ""} <em>${esc(PATH_SHORT[x.path])}</em></span>`).join(" → ")}
        ${f?.heirs.length ? `<div class="hint">Heirs: ${f.heirs.map((p) => `${esc(p.first)} (${Math.max(0, y - p.born)}${p.traits.length ? `, ${p.traits.map((t) => TRAITS[t].name.toLowerCase()).join(", ")}` : ""})`).join(" · ")}</div>` : ""}</div>
    </div>`;
  el.querySelector("[data-close]")!.addEventListener("click", close);
  el.querySelectorAll<HTMLButtonElement>("button[data-sact]").forEach((b) => b.addEventListener("click", () => {
    const r = takeAction(g, b.dataset.sact!, new Rng(`${g.seed}:st:${g.turn}:${seq++}`), b.dataset.arg);
    status = r.text;
    changed();
  }));
}
export function resetStruggleUi() { status = ""; }

// ---------------------------------------------------------------- the succession

let pick = { heir: 0, path: "business" as Path, industry: "" as IndustryId | "", sellOld: true, foundation: false, side: "business" as "business" | "reform" };
let pickFor = -1;

export function successionCard(g: GameState, el: HTMLElement, done: () => void) {
  const f = g.family, s = f?.succession, c = g.company;
  if (!f || !s || !c) { el.hidden = true; return; }
  if (pickFor !== s.year) { pick = { heir: 0, path: s.paths.includes("business") ? "business" : s.paths[0], industry: "", sellOld: true, foundation: false, side: standing(g, "labour") > 10 ? "reform" : "business" }; pickFor = s.year; }
  const y = cal(g).year, h = head(g)!;
  const others = (Object.keys(INDUSTRIES) as IndustryId[]).filter((i) => i !== c.industry);
  if (!pick.industry || !others.includes(pick.industry as IndustryId)) pick.industry = others[0];
  const tax = estateTax(g, pick.foundation), gift = pick.foundation ? foundationGift(g) : 0;
  el.innerHTML = `<div class="paper succ">
    <div class="mast"><span>The ${esc(f.surname)} family</span><span>Spring ${y}</span></div>
    <h3>${s.reason === "era" ? "The succession" : s.reason === "merger" ? "Sold to the trust" : "The company is sold"}</h3>
    <p>${esc(s.note)} ${h.sex === "f" ? "She" : "He"} took over in ${h.from} with ${money(h.cashFrom ?? 0)} and leaves ${money(c.cash)}${s.proceeds ? `; the buyers paid ${money(s.proceeds)}` : ""}.</p>
    <h5>Who takes over</h5>
    <div class="sc-heirs">${f.heirs.map((p, k) => `<label class="${pick.heir === k ? "on" : ""}"><input type="radio" name="heir" value="${k}" ${pick.heir === k ? "checked" : ""}/><b>${esc(fullName(g, p))}</b>, ${y - p.born}<span>${p.traits.map((t) => `<i title="${esc(TRAITS[t].blurb)}">${esc(TRAITS[t].name)}</i>`).join(" ")}</span></label>`).join("")}</div>
    <h5>The family's course</h5>
    <div class="sc-paths">${(Object.keys(PATHS) as Path[]).map((pa) => `<label class="${pick.path === pa ? "on" : ""} ${s.paths.includes(pa) ? "" : "off"}"><input type="radio" name="path" value="${pa}" ${pick.path === pa ? "checked" : ""} ${s.paths.includes(pa) ? "" : "disabled"}/><b>${esc(PATHS[pa].name)}</b><span>${esc(PATHS[pa].blurb)}</span></label>`).join("")}</div>
    ${pick.path === "industry" ? `<div class="sc-opt">Industry <select data-ind>${others.map((i) => `<option value="${i}" ${pick.industry === i ? "selected" : ""}>${INDUSTRIES[i].name}</option>`).join("")}</select> <label><input type="checkbox" data-sell ${pick.sellOld ? "checked" : ""}/> sell the old works when the new one opens</label></div>` : ""}
    ${pick.path === "politics" ? `<div class="sc-opt">Run as <select data-side><option value="business" ${pick.side === "business" ? "selected" : ""}>a business man (Republican)</option><option value="reform" ${pick.side === "reform" ? "selected" : ""}>a reformer (${y >= 1932 ? "Democrat" : "Democrat / Progressive"})</option></select></div>` : ""}
    <h5>The estate</h5>
    <div class="sc-opt"><label><input type="checkbox" data-found ${pick.foundation ? "checked" : ""}/> Endow the ${esc(f.surname)} Foundation (a fifth of the fortune: ${money(foundationGift(g))})</label>
    <p>${estateRate(y) ? `Estate tax ${Math.round(estateRate(y) * 50)}% (with good lawyers) on the cash and holdings: ${money(tax)}.${gift ? " The foundation halves it." : ""}` : "No estate tax yet (the federal tax comes in 1916)."} The heir inherits the family's name — and its ledger.</p></div>
    <div class="actions"><button class="primary" data-go>Hand over to ${esc(f.heirs[pick.heir]?.first ?? "the heir")}</button></div>
  </div>`;
  el.hidden = false;
  const redo = () => successionCard(g, el, done);
  el.querySelectorAll<HTMLInputElement>("input[name=heir]").forEach((i) => i.addEventListener("change", () => { pick.heir = Number(i.value); redo(); }));
  el.querySelectorAll<HTMLInputElement>("input[name=path]").forEach((i) => i.addEventListener("change", () => { pick.path = i.value as Path; redo(); }));
  el.querySelector<HTMLSelectElement>("[data-ind]")?.addEventListener("change", (e) => { pick.industry = (e.target as HTMLSelectElement).value as IndustryId; });
  el.querySelector<HTMLSelectElement>("[data-side]")?.addEventListener("change", (e) => { pick.side = (e.target as HTMLSelectElement).value as "business" | "reform"; });
  el.querySelector<HTMLInputElement>("[data-sell]")?.addEventListener("change", (e) => { pick.sellOld = (e.target as HTMLInputElement).checked; });
  el.querySelector<HTMLInputElement>("[data-found]")?.addEventListener("change", (e) => { pick.foundation = (e.target as HTMLInputElement).checked; redo(); });
  el.querySelector("[data-go]")!.addEventListener("click", () => {
    resolveSuccession(g, { heir: pick.heir, path: pick.path, industry: pick.industry as IndustryId, sellOld: pick.sellOld, foundation: pick.foundation, side: pick.side });
    el.hidden = true;
    done();
  });
}

/** the top-bar chip: the head of the family */
export function familyChip(g: GameState): string {
  const h = head(g);
  if (!h) return "";
  return `<small>${esc(g.family!.surname)} · ${["I", "II", "III", "IV"][g.family!.heads.length - 1] ?? g.family!.heads.length}</small><b>${esc(h.first)}, ${age(g, h)}</b>`;
}

/** struggle items for the Watch list */
export function struggleRisks(g: GameState): { level: "bad" | "warn" | "good"; title: string; detail: string; go?: "struggle" }[] {
  const out: ReturnType<typeof struggleRisks> = [];
  const c = g.company;
  if (!c) return out;
  const y = cal(g).year;
  for (const u of sieges(g)) { const s = u.siege!; out.push({ level: "bad", title: `Strike: ${s.seasons} season${s.seasons === 1 ? "" : "s"}`, detail: `their fund ${u.fund.toFixed(1)} seasons · ${Math.round(s.men * 100)}% replaced`, go: "struggle" }); }
  for (const u of Object.values(g.unions ?? {})) if (u && !u.siege && !u.coop && u.militancy > 60 && u.membership > 0.3) out.push({ level: "warn", title: "The union is angry", detail: `militancy ${Math.round(u.militancy)} · ${Math.round(u.membership * 100)}% members`, go: "struggle" });
  for (const r of g.rivals) if (r.intent) { const d = RIVALS.find((x) => x.id === r.id)!; out.push({ level: "warn", title: `${rivalName(d, y)} is moving`, detail: r.intent.text.replace(/^.*? is /, "").replace(/^.*?'s /, ""), go: "struggle" }); }
  const L = lawsOf(g);
  for (const l of LAWS) if (L[l.id].passed === undefined && l.forbids?.test(c.biz.policy) && lawYear(g, l) - y <= 2 && lawYear(g, l) >= y) out.push({ level: "warn", title: `${l.name} due ${lawYear(g, l)}`, detail: `${l.forbids.what.toLowerCase()} will be illegal`, go: "struggle" });
  for (const lv of LEVELS) if (nextElection(lv, y) === y && cal(g).season !== "Winter" && lv !== "federal") out.push({ level: "warn", title: `Election this autumn: ${LEVEL_NAME[lv]}`, detail: `reform ${Math.round(reformOdds(g, lv) * 100)}%`, go: "struggle" });
  const nextEra = [1893, 1920, 1947].find((e) => e > y);
  if (nextEra && nextEra - y <= 2) out.push({ level: "warn", title: `Succession in ${nextEra}`, detail: `${head(g)?.first ?? "The head"} steps down`, go: "struggle" });
  if (g.family?.newIndustry) out.push({ level: "warn", title: `Found the ${INDUSTRIES[g.family.newIndustry.industry].name.toLowerCase()} works`, detail: "the heir's new industry: Works tab", go: undefined });
  return out;
}
