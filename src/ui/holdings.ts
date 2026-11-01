// The Holdings tab: the whole concern in one place. Every works (profit, go to), the businesses you own (income,
// what they do for the works, enlarge or sell), what's for sale, your stakes in the rival works, and shares in the
// region's companies. One row each; the longer description is in the tooltip.

import { allWorks, cal, type GameState } from "../core/game";
import { relationOf } from "../core/economy";
import { INDUSTRIES } from "../core/industries";
import {
  bizBlocked, bizDef, bizIncome, bizPrice, BUSINESSES, buyBiz, buyShares, buyStake, holdingsOf, holdingsValue, LISTED, listedOpen, LOT, MAX_LOTS,
  rivalProfit, sellBiz, sellShares, sellStake, sellValue, sharePrice, stakeBlocked, stakeName, stakePrice, takeover, takeoverPrice, upgradeBiz, upgradeBlocked,
} from "../core/holdings";
import { RIVALS } from "../core/rivals";
import { esc, fmt } from "../core/text";
import { money } from "./fx";
import { actRow } from "./works";

let status = "";
const open = new Set<string>(["works", "biz"]);

const FX_WORD: Record<string, string> = { coal: "Coal", ore: "Ore", sand: "Sand", limestone: "Limestone" };
function bizFx(id: string): string {
  const d = bizDef(id), out: string[] = [];
  for (const [k, v] of Object.entries(d.input ?? {})) out.push(`<span class="fx fx-good">${FX_WORD[k] ?? k} −${Math.round((1 - v!) * 100)}%</span>`);
  if (d.freight?.river && d.freight.river < 1) out.push(`<span class="fx fx-good">River freight −${Math.round((1 - d.freight.river) * 100)}%</span>`);
  if (d.freight?.rail && d.freight.rail < 1) out.push(`<span class="fx fx-good">Rail freight −${Math.round((1 - d.freight.rail) * 100)}%</span>`);
  if (d.upkeep) out.push(`<span class="fx fx-good">Upkeep −${Math.round((1 - d.upkeep) * 100)}%</span>`);
  return out.join("");
}

export function holdingsPanel(g: GameState, el: HTMLElement, changed: () => void, go: (x: number, y: number) => void) {
  const c = g.company;
  if (!c) { el.innerHTML = `<p class="hint tab-empty">Found a company first.</p>`; return; }
  const h = holdingsOf(g), y = cal(g).year, v = holdingsValue(g), last = h.last;
  const sec = (id: string, title: string, right: string, body: string) => `<h4 class="mh hd-sec" data-sec="${id}">${open.has(id) ? "▾" : "▸"} ${title}<span>${right}</span></h4>${open.has(id) ? body : ""}`;
  const goBtn = (x: number, y2: number) => `<button class="link go" data-x="${x}" data-y="${y2}" title="Show on the map">↗</button>`;

  // ---- works
  const works = allWorks(c).map((w) => `<div class="hd-row"><span>${esc(w.name)} <span class="muted">${INDUSTRIES[w.industry].name}</span></span><span class="${(w.lastSeason?.profit ?? 0) < 0 ? "down" : ""}">${money(w.lastSeason?.profit ?? 0)}</span>${goBtn(w.x + (w.footprint >> 1), w.y + (w.footprint >> 1))}</div>`).join("");

  // ---- businesses you own, and for sale
  const owned = h.biz.map((b) => {
    const d = bizDef(b.id), up = upgradeBlocked(g, b);
    return actRow(`${esc(d.name)}${b.level > 1 ? ` <span class="muted">×${b.level}</span>` : ""} ${goBtn(b.x, b.y)}`,
      `<button data-up="${b.id}" ${up ? `disabled title="${esc(up)}"` : ""}>${b.level >= 3 ? "Max" : `+ ${money(bizPrice(g, d, b.level + 1))}`}</button><button data-sell="${b.id}" title="Sell for ${money(sellValue(b))}">Sell</button>`,
      `<span class="fx fx-good">+${money(bizIncome(g, d, b.level))}/season</span>${bizFx(b.id)}`, `${d.blurb} Owned since ${b.since}.`);
  }).join("");
  const groups = ["Raw materials", "Transport", "Utilities", "Services"] as const;
  const forSale = groups.map((grp) => {
    const rows = BUSINESSES.filter((d) => d.group === grp && !h.biz.some((b) => b.id === d.id) && y >= d.from - 5 && !(d.until && y >= d.until)).map((d) => {
      const why = bizBlocked(g, d);
      return actRow(esc(d.name), `<button data-buy="${d.id}" ${why ? `disabled title="${esc(why)}"` : ""}>${money(bizPrice(g, d))}</button>`,
        `<span class="fx">+${money(bizIncome(g, d, 1))}/season</span>${bizFx(d.id)}${y < d.from ? `<span class="fx">from ${d.from}</span>` : ""}`, d.blurb);
    }).join("");
    return rows ? `<div class="hd-grp">${grp}</div>${rows}` : "";
  }).join("");

  // ---- stakes
  const open_ = g.rivals.filter((r) => r.active && !r.closed && !r.owned);
  const stakeRows = open_.map((r) => {
    const d = RIVALS.find((x) => x.id === r.id)!, pct = h.stakes[r.id] ?? 0;
    const rel = relationOf(c.industry, d.industry, r.id);
    const why = stakeBlocked(g, r.id), tq = takeoverPrice(g, r.id);
    const div = rivalProfit(g, r.id) * (pct / 100);
    return actRow(`${esc(stakeName(g, r.id))}${pct ? ` <b class="up">${pct}%</b>` : ""} ${goBtn(r.x + (r.footprint >> 1), r.y + (r.footprint >> 1))}`,
      `<button data-stake="${r.id}" ${why ? `disabled title="${esc(why)}"` : ""}>+10% ${money(stakePrice(g, r.id))}</button>${pct ? `<button data-unstake="${r.id}" title="Sell 10%">−10%</button>` : ""}${pct >= 50 && "price" in tq ? `<button data-take="${r.id}" title="Buy the rest and run it as your works">Take over ${money(tq.price)}</button>` : ""}`,
      `<span class="fx">${rel === "competitor" ? "Competitor" : rel === "supplier" ? "Supplier" : rel === "customer" ? "Customer" : rel === "lender" ? "Bank" : INDUSTRIES[d.industry].name}</span>${pct ? `<span class="fx fx-good">+${money(div)}/season</span>` : ""}${pct >= 20 ? `<span class="fx fx-good">won't move against you</span>` : ""}`,
      `${d.figures.join(" & ")} — ${d.note}. 10% buys a share of its profit; at 20% its owners leave you alone; at 50% you can buy the rest.`);
  }).join("");

  // ---- shares
  const shareRows = LISTED.filter((L) => listedOpen(g, L) || h.shares[L.id]).map((L) => {
    const n = h.shares[L.id] ?? 0, p = sharePrice(g, L.id);
    const yr = g.prices.find((pp) => cal({ ...g, turn: pp.turn }).year === y - 1);
    const p0 = yr ? sharePriceAt(g, L.id, yr.turn) : p;
    const ch = p0 ? (p / p0 - 1) * 100 : 0;
    const gain = n ? n * p - (h.shareCost[L.id] ?? 0) : 0;
    return actRow(`${esc(L.name)} <span class="muted">$${p.toFixed(2)}</span> <span class="${ch >= 0 ? "up" : "down"}">${ch >= 0 ? "▲" : "▼"}${Math.abs(ch).toFixed(0)}%</span>`,
      (() => { const lots = Math.max(1, Math.min(MAX_LOTS, Math.floor(c.cash / (p * LOT)))); const done = h.shareYear?.[L.id] === y; return `<button data-shares="${L.id}" data-lots="${lots}" ${c.cash < p * LOT || done || c.biz.actionsLeft <= 0 ? "disabled" : ""} title="${done ? "Bought this year already: the brokers can only find so many sellers" : `Buy ${fmt(lots * LOT)} shares (1 action; once a year)`}">+${fmt(lots * LOT)}</button>`; })() + (n ? `<button data-unshares="${L.id}" title="Sell all ${fmt(n)}">Sell</button>` : ""),
      n ? `<span class="fx">${fmt(n)} shares · ${money(n * p)}</span><span class="fx ${gain >= 0 ? "fx-good" : "fx-bad"}">${gain >= 0 ? "+" : "−"}${money(Math.abs(gain))}</span><span class="fx fx-good">+${money(n * p * 0.0075)}/season</span>` : `<span class="fx">yields ~3% a year</span>`,
      L.note);
  }).join("");

  const income = last ? last.biz + last.stakes + last.dividends : 0;
  el.innerHTML = `
    ${status ? `<div class="bz-status">${esc(status)}</div>` : ""}
    <div class="cards">
      <div class="card"><small>Holdings income</small><b class="up">${money(income)}</b><em>last season${last ? ` · biz ${money(last.biz)} · stakes ${money(last.stakes)} · div. ${money(last.dividends)}` : ""}</em></div>
      <div class="card"><small>Worth</small><b>${money(v.biz + v.stakes + v.shares)}</b><em>biz ${money(v.biz)} · stakes ${money(v.stakes)} · shares ${money(v.shares)}</em></div>
    </div>
    ${sec("works", "Works", `${allWorks(c).length}`, works)}
    ${sec("biz", "Businesses", `${h.biz.length} owned`, (owned || `<p class="hint">None yet: buy one below.</p>`) + `<div class="hd-sub">For sale</div>${forSale}`)}
    ${sec("stakes", "Stakes in the works", `${Object.keys(h.stakes).length} held`, stakeRows || `<p class="hint">No works open yet.</p>`)}
    ${sec("shares", "Shares", `${Object.keys(h.shares).length} held`, shareRows || `<p class="hint">No companies listed yet.</p>`)}
    <p class="hint">Buying a business, a stake or a takeover takes an action; shares don't.</p>`;

  const act = (fn: () => { ok: boolean; text: string }) => { status = fn().text; changed(); };
  el.querySelectorAll<HTMLElement>("[data-sec]").forEach((x) => x.addEventListener("click", (e) => {
    if ((e.target as HTMLElement).closest("button")) return;
    const k = x.dataset.sec!; if (open.has(k)) open.delete(k); else open.add(k);
    holdingsPanel(g, el, changed, go);
  }));
  el.querySelectorAll<HTMLButtonElement>("button.go").forEach((b) => b.addEventListener("click", (e) => { e.stopPropagation(); go(Number(b.dataset.x), Number(b.dataset.y)); }));
  const on = (attr: string, fn: (id: string) => { ok: boolean; text: string }) => el.querySelectorAll<HTMLButtonElement>(`button[data-${attr}]`).forEach((b) => b.addEventListener("click", () => act(() => fn(b.dataset[attr]!))));
  on("buy", (id) => buyBiz(g, id));
  on("up", (id) => upgradeBiz(g, id));
  on("sell", (id) => sellBiz(g, id));
  on("stake", (id) => buyStake(g, id));
  on("unstake", (id) => sellStake(g, id));
  on("take", (id) => takeover(g, id));
  on("shares", (id) => buyShares(g, id, Number(el.querySelector<HTMLButtonElement>(`button[data-shares="${id}"]`)?.dataset.lots ?? 1)));
  on("unshares", (id) => sellShares(g, id));
}

/** a share's price at an earlier turn */
function sharePriceAt(g: GameState, id: string, turn: number) { return sharePrice({ ...g, turn } as GameState, id); }

export function resetHoldingsUi() { status = ""; }
