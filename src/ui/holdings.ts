// The Money tab (v0.19; was Holdings): net worth, then what the family owns (works, businesses, stakes, shares),
// finance (the bank, the company's shareholders), and a Buy list in three tabs — works and stakes, businesses,
// shares. Selling or listing the company opens its own dialog. One row each; the longer description is in the tooltip.

import { allWorks, cal, type GameState } from "../core/game";
import { INDUSTRIES } from "../core/industries";
import {
  bizBlocked, bizDef, bizIncome, bizPrice, BUSINESSES, buyBiz, buyShares, buyStake, companyWorth, holdingsOf, holdingsValue, LISTED, listedOpen, LOT, marginOpen, maxLots,
  rivalProfit, sellBiz, sellShares, sellStake, sellValue, sharePrice, stakeBlocked, stakeName, stakePrice, takeover, takeoverPrice, upgradeBiz, upgradeBlocked,
} from "../core/holdings";
import { buyBack, buybackPrice, companyBids, dividendDue, goPublicBlocked, investorsOnly, scrapWorks, sellCompany, sellTenth, tenthPrice } from "../core/ownership";
import { scrapValue, worksValue, yearlyProfit } from "../core/value";
import { esc, fmt } from "../core/text";
import { actRow, chip, costButton, head, money } from "./fx";
import { buyIntoRows } from "./works";
import { actionRows, SELL_ACTS, wireActions } from "./actions";
import { takeAction } from "../core/business";
import { Rng } from "../core/rng";

let status = "";
let onMargin = false;
let buyTab: "works" | "biz" | "shares" = "works";
let buyCount = 0;
let buyInd: string | null = null;

const FX_WORD: Record<string, string> = { coal: "Coal", ore: "Ore", sand: "Sand", limestone: "Limestone" };
function bizFx(id: string): string {
  const d = bizDef(id), out: string[] = [];
  for (const [k, v] of Object.entries(d.input ?? {})) out.push(chip(`${FX_WORD[k] ?? k} −${Math.round((1 - v!) * 100)}%`, "good"));
  if (d.freight?.river && d.freight.river < 1) out.push(chip(`River freight −${Math.round((1 - d.freight.river) * 100)}%`, "good"));
  if (d.freight?.rail && d.freight.rail < 1) out.push(chip(`Rail freight −${Math.round((1 - d.freight.rail) * 100)}%`, "good"));
  if (d.upkeep) out.push(chip(`Upkeep −${Math.round((1 - d.upkeep) * 100)}%`, "good"));
  return out.join("");
}

export function holdingsPanel(g: GameState, el: HTMLElement, changed: () => void, go: (x: number, y: number) => void, openSell?: () => void) {
  const c = g.company;
  if (!c) { el.innerHTML = `<p class="hint tab-empty">Found a company first.</p>`; return; }
  const h = holdingsOf(g), y = cal(g).year, v = holdingsValue(g), last = h.last;
  const goBtn = (x: number, y2: number) => `<button class="link go" data-x="${x}" data-y="${y2}" title="Show on the map">↗</button>`;
  const nw = companyWorth(g);

  // ---- what the family owns
  const works = allWorks(c).map((w) => {
    const val = worksValue(g, w), yp = yearlyProfit(w);
    const btns = w.closed ? `<button data-scrap="${w.id}" title="Sell the plant for scrap and the land">Scrap ${money(scrapValue(g, w))}</button>${y >= 1960 ? `<button data-redev="${w.id}" title="The redevelopment authority buys the land for an office park and shopping centre">Redevelop</button>` : ""}` : goBtn(w.x + (w.footprint >> 1), w.y + (w.footprint >> 1));
    return actRow(`${esc(w.name)}`, btns,
      `${chip(INDUSTRIES[w.industry].name)}${chip(`worth ${money(val)}`)}${chip(`${money(yp)}/yr`, yp < 0 ? "bad" : "good")}${w.closed ? chip("closed", "bad") : ""}${w.stock ? chip(`${fmt(w.stock)} in the yards`) : ""}`,
      `Worth eight years of its profit (${money(yp)} a year over the last two), or its scrap value (${money(scrapValue(g, w))}) if that's more.`);
  }).join("") || `<p class="hint">The family has no works of its own: it lives on its holdings. Buy one below, or found one from the Works tab.</p>`;
  const owned = h.biz.map((b) => {
    const d = bizDef(b.id), up = upgradeBlocked(g, b);
    return actRow(`${esc(d.name)}${b.level > 1 ? ` <span class="muted">×${b.level}</span>` : ""} ${goBtn(b.x, b.y)}`,
      `${costButton(`data-up="${b.id}"`, bizPrice(g, d, b.level + 1), b.level >= 3 ? "At its largest" : up, b.level >= 3 ? "Max" : `+ ${money(bizPrice(g, d, b.level + 1))}`)}<button data-sell="${b.id}" title="Sell for ${money(sellValue(g, b))}">Sell</button>`,
      `${chip(`+${money(bizIncome(g, d, b.level))}/season`, "good")}${bizFx(b.id)}`, `${d.blurb} Owned since ${b.since}.`);
  }).join("");
  const stakesHeld = Object.entries(h.stakes).filter(([, pct]) => pct > 0).map(([id, pct]) => {
    const r = g.rivals.find((x) => x.id === id);
    const tq = takeoverPrice(g, id), why = stakeBlocked(g, id);
    const div = Math.max(0, rivalProfit(g, id)) * 0.5 * (pct / 100);
    return actRow(`${esc(stakeName(g, id))} <b class="up">${pct}%</b>${r ? ` ${goBtn(r.x + (r.footprint >> 1), r.y + (r.footprint >> 1))}` : ""}`,
      `${costButton(`data-stake="${id}"`, stakePrice(g, id), why, `+10%`)}<button data-unstake="${id}" title="Sell 10%">−10%</button>${pct >= 50 && "price" in tq ? `<button data-take="${id}" title="Buy the rest and run it as your works">Take over ${money(tq.price)}</button>` : ""}`,
      `${chip(`+${money(div)}/season`, "good")}${pct >= 20 ? chip("won't move against you", "good") : ""}`,
      "10% buys a share of its profit; at 20% its owners leave you alone; at 50% you can buy the rest.");
  }).join("");
  const sharesHeld = LISTED.filter((L) => h.shares[L.id]).map((L) => {
    const n = h.shares[L.id], p = sharePrice(g, L.id), gain = n * p - (h.shareCost[L.id] ?? 0);
    return actRow(`${esc(L.name)} <span class="muted">${fmt(n)}</span>`, `<button data-unshares="${L.id}" title="Sell all ${fmt(n)}">Sell ${money(n * p)}</button>`,
      `${chip(`${gain >= 0 ? "+" : "−"}${money(Math.abs(gain))}`, gain >= 0 ? "good" : "bad")}${chip(`+${money(n * p * 0.009)}/season`, "good")}${h.margin?.[L.id] ? chip(`broker's loan ${money(h.margin[L.id])}`, "bad") : ""}`, L.note);
  }).join("");

  // ---- finance
  const loan = actionRows(g, (a) => a.id === "loan");
  const P = c.public;
  const canSell = y >= 1880 && !investorsOnly(g);

  // ---- buy
  const groups = ["Raw materials", "Transport", "Utilities", "Services"] as const;
  const forSale = groups.map((grp) => {
    const rows = BUSINESSES.filter((d) => d.group === grp && !h.biz.some((b) => b.id === d.id) && y >= d.from - 5 && !(d.until && y >= d.until)).map((d) => {
      const why = bizBlocked(g, d);
      return actRow(esc(d.name), costButton(`data-buy="${d.id}"`, bizPrice(g, d), why),
        `${chip(`+${money(bizIncome(g, d, 1))}/season`)}${bizFx(d.id)}${y < d.from ? chip(`from ${d.from}`) : ""}`, d.blurb);
    }).join("");
    return rows ? `<div class="hd-grp">${grp}</div>${rows}` : "";
  }).join("") || `<p class="hint">Nothing for sale.</p>`;
  const shareRows = LISTED.filter((L) => listedOpen(g, L)).map((L) => {
    const p = sharePrice(g, L.id);
    const yr = g.prices.find((pp) => cal({ ...g, turn: pp.turn }).year === y - 1);
    const p0 = yr ? sharePriceAt(g, L.id, yr.turn) : p;
    const ch = p0 ? (p / p0 - 1) * 100 : 0;
    const down = onMargin && marginOpen(y) ? 0.1 : 1;
    const big = Math.max(1, Math.min(maxLots(y), Math.floor(c.cash / (p * LOT * down))));
    const done = h.shareYear?.[L.id] === y;
    const why = done ? "One order a year in each company" : c.cash < p * LOT * down ? `Needs ${money(p * LOT * down)}` : null;
    return actRow(`${esc(L.name)} <span class="muted">$${p.toFixed(2)}</span> <span class="${ch >= 0 ? "up" : "down"}">${ch >= 0 ? "▲" : "▼"}${Math.abs(ch).toFixed(0)}%</span>`,
      costButton(`data-shares="${L.id}" data-lots="1"`, 0, why, `+${LOT}`) + (big > 1 ? costButton(`data-shares="${L.id}" data-lots="${big}"`, 0, why, `+${fmt(big * LOT)}`) : ""),
      chip("yields ~3.6% a year"),
      `${L.note}${L.rivals ? " Its price follows how its works are doing in the valley, as well as the market." : ""} A big order pushes the price up; one order a year in each company.`);
  }).join("") || `<p class="hint">No companies listed yet.</p>`;
  const buyBody = buyTab === "works" ? buyIntoRows(g, buyInd ?? c.industry) : buyTab === "biz" ? forSale
    : (marginOpen(y) ? `<label class="bz-target check"><input type="checkbox" data-margin ${onMargin ? "checked" : ""}/> Buy on margin (10% down; the broker calls the loan if the shares fall)</label>` : "") + shareRows;

  const income = last ? last.biz + last.stakes + last.dividends : 0;
  const holdingsAny = owned || stakesHeld || sharesHeld;
  el.innerHTML = `
    ${status ? `<div class="bz-status">${esc(status)}</div>` : ""}
    <div class="cards">
      <div class="card"><small>Net worth</small><b class="${nw.total < 0 ? "down" : ""}">${money(nw.total)}</b><em>works ${money(nw.works)} · holdings ${money(nw.holdings)}<br>cash ${money(nw.cash)}${nw.debt ? ` · owed ${money(nw.debt)}` : ""}</em></div>
      <div class="card"><small>Holdings income</small><b class="${income > 0 ? "up" : ""}">${money(income)}</b><em>last season · worth ${money(v.biz + v.stakes + v.shares)}</em></div>
    </div>
    ${head("Your works", `${allWorks(c).length}`)}${works}
    ${holdingsAny ? head("Your holdings") + owned + stakesHeld + sharesHeld : ""}
    ${head("Finance")}
    ${P ? `<div class="hd-row"><span>Outside shareholders</span><span>${P.outside}% · dividend ${money(dividendDue(g))}/season${P.missed ? ` · <b class="down">${P.missed} missed</b>` : ""}</span></div>` : ""}
    ${loan.rows.join("")}${c.debt ? `<div class="hd-row"><span>Owed to the bank</span><b class="down">${money(c.debt)}</b></div>` : ""}
    ${canSell ? `<button class="wide" data-sellco-open="1">Sell or list the company…</button>` : ""}
    ${head("Buy")}
    <div class="seg tabs3">${([["works", "Works"], ["biz", "Businesses"], ["shares", "Shares"]] as const).map(([k, n]) => `<button data-buytab="${k}" class="${buyTab === k ? "on" : ""}">${n}</button>`).join("")}</div>
    ${buyBody}
    <p class="hint">Buying a works, a business or a stake takes an action; shares don't.</p>`;

  const act = (fn: () => { ok: boolean; text: string }) => { status = fn().text; changed(); };
  el.querySelectorAll<HTMLButtonElement>("button.go").forEach((b) => b.addEventListener("click", (e) => { e.stopPropagation(); go(Number(b.dataset.x), Number(b.dataset.y)); }));
  const on = (attr: string, fn: (id: string) => { ok: boolean; text: string }) => el.querySelectorAll<HTMLButtonElement>(`button[data-${attr}]`).forEach((b) => b.addEventListener("click", () => act(() => fn(b.dataset[attr]!))));
  on("buy", (id) => buyBiz(g, id));
  on("up", (id) => upgradeBiz(g, id));
  on("sell", (id) => sellBiz(g, id));
  on("stake", (id) => buyStake(g, id));
  on("stakew", (id) => buyStake(g, id));
  on("buyw", (id) => takeAction(g, "buy", new Rng(`${g.seed}:buyw:${g.turn}:${buyCount++}`), id));
  on("unstake", (id) => sellStake(g, id));
  on("take", (id) => takeover(g, id));
  el.querySelectorAll<HTMLButtonElement>("button[data-shares]").forEach((b) => b.addEventListener("click", () => act(() => buyShares(g, b.dataset.shares!, Number(b.dataset.lots ?? 1), onMargin))));
  on("unshares", (id) => sellShares(g, id));
  on("scrap", (id) => scrapWorks(g, id, false));
  on("redev", (id) => scrapWorks(g, id, true));
  el.querySelectorAll<HTMLButtonElement>("button[data-buytab]").forEach((b) => b.addEventListener("click", () => { buyTab = b.dataset.buytab as typeof buyTab; holdingsPanel(g, el, changed, go, openSell); }));
  el.querySelector<HTMLButtonElement>("button[data-sellco-open]")?.addEventListener("click", () => openSell?.());
  el.querySelector<HTMLSelectElement>("select[data-buyind]")?.addEventListener("change", (e) => { buyInd = (e.target as HTMLSelectElement).value; holdingsPanel(g, el, changed, go, openSell); });
  el.querySelector<HTMLInputElement>("input[data-margin]")?.addEventListener("change", (e) => { onMargin = (e.target as HTMLInputElement).checked; holdingsPanel(g, el, changed, go, openSell); });
  wireActions(el, g, (t) => { status = t; changed(); });
}

let sellStatus = "";
/** The dialog for selling or listing the company: the bids for the whole concern, selling one works, the exchange. */
export function sellDialog(g: GameState, el: HTMLElement, changed: () => void, close: () => void) {
  const c = g.company;
  if (!c) { close(); return; }
  const y = cal(g).year, nw = companyWorth(g);
  const bids = y >= 1880 && !investorsOnly(g) ? companyBids(g).map((b) => actRow(`Sell to ${esc(b.who)}`, costButton(`data-sellco="${b.id}"`, b.price, c.biz.actionsLeft <= 0 ? "No actions left this season" : null), chip(b.note),
    `Sell every works for ${money(b.price)} (less the tax on the gain). The family keeps its cash and holdings and plays on as investors; the town and the union will remember who you sold to.`)).join("") : "";
  const one = actionRows(g, (a) => SELL_ACTS.has(a.id));
  const P = c.public, pubWhy = goPublicBlocked(g);
  const pub = y >= 1890 && !investorsOnly(g) ? actRow(P ? "Sell another 10%" : "List the company: sell 10%", costButton(`data-pub="1"`, 0, pubWhy, `+${money(tenthPrice(g))}`) + (P ? `<button data-buyback="1" title="Buy 10% back">Buy back ${money(buybackPrice(g))}</button>` : ""),
    `${chip("shareholders want ~5% a year")}${(P?.outside ?? 0) >= 40 ? chip("over 50%: the board decides", "bad") : ""}`,
    "Raise cash by selling shares in the company. The outside shareholders expect a dividend every season; miss them and the shares slide and raiders come. Once outsiders hold more than half, the board — not the family — decides closures and can sell the company.") : "";
  el.innerHTML = `<div class="dlg">
    <div class="ovl-head"><h3>Sell or list the company</h3><span class="spacer"></span><button class="x" data-close title="Close (Esc)">✕</button></div>
    <div class="dlg-body">
      ${sellStatus ? `<div class="bz-status">${esc(sellStatus)}</div>` : ""}
      <p class="hint">${esc(c.name)} is worth ${money(nw.works)} (eight years of profit, or scrap). Every sale takes an action and pays tax on the gain.</p>
      ${bids ? head("Sell the whole company") + bids : ""}
      ${c.others.length && one.rows.length + one.off.length ? head("Sell one works") + one.rows.join("") + one.off.join("") : ""}
      ${pub ? head("On the exchange", P ? `outsiders hold ${P.outside}%` : "") + pub : ""}
    </div></div>`;
  el.hidden = false;
  el.querySelector("[data-close]")!.addEventListener("click", close);
  const act = (fn: () => { ok: boolean; text: string }) => { sellStatus = fn().text; changed(); };
  el.querySelectorAll<HTMLButtonElement>("button[data-sellco]").forEach((b) => b.addEventListener("click", () => { act(() => sellCompany(g, b.dataset.sellco!)); if (investorsOnly(g)) close(); }));
  el.querySelector<HTMLButtonElement>("button[data-pub]")?.addEventListener("click", () => act(() => sellTenth(g)));
  el.querySelector<HTMLButtonElement>("button[data-buyback]")?.addEventListener("click", () => act(() => buyBack(g)));
  wireActions(el, g, (t) => { sellStatus = t; changed(); });
}

/** a share's price at an earlier turn */
function sharePriceAt(g: GameState, id: string, turn: number) { return sharePrice({ ...g, turn } as GameState, id); }

export function resetHoldingsUi() { status = ""; sellStatus = ""; }
