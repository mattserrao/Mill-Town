// Who owns the company (v0.18.2): selling the whole concern and living as investors, scrapping or redeveloping a
// closed works, and taking the company public — outside shareholders who want dividends, a share price that sets
// the takeover risk, and a board that runs things once the family holds less than half.

import { bump, pushHeadline } from "./business";
import { takeoverDecision } from "./owners";
import { allWorks, cal, type Company, type GameState, log, type Works } from "./game";
import { capitalGainsRate, companyWorth } from "./holdings";
import { INDUSTRIES } from "./industries";
import { mark } from "./ledger";
import { RIVALS, nameNow } from "./rivals";
import { Use } from "./town";
import { scrapValue, worksValue } from "./value";

const year = (g: GameState) => cal(g).year;

// ---------------------------------------------------------------- selling the company

export interface Bid { id: string; who: string; price: number; note: string }

/** what the works are worth together (the price a buyer starts from) */
export const worksWorth = (g: GameState) => allWorks(g.company!).reduce((s, w) => s + worksValue(g, w), 0);

/** who would buy the company now, and at what price */
export function companyBids(g: GameState): Bid[] {
  const c = g.company;
  if (!c || !allWorks(c).length) return [];
  const y = year(g), v = worksWorth(g), bids: Bid[] = [];
  // the biggest open rival in the industry
  const same = g.rivals.filter((r) => { const d = RIVALS.find((x) => x.id === r.id); return d && d.industry === c.industry && r.active && !r.closed && !r.owned && !r.offmap && d.id !== "frick"; });
  const top = same.sort((a, b) => (b.expand ?? 0) - (a.expand ?? 0))[0];
  if (top) { const d = RIVALS.find((x) => x.id === top.id)!; bids.push({ id: `rival:${top.id}`, who: nameNow(d, y, top.name, top.nameYear), price: v * 1.0, note: "A rival in the industry folds your works into its own." }); }
  if (y >= 1901 && (c.industry === "steel" || c.industry === "metalworks")) bids.push({ id: "trust", who: "U.S. Steel", price: v * 1.05, note: "Morgan's trust pays a little over the odds to keep the industry in line." });
  if (y >= 1869) bids.push({ id: "mellon", who: "The Mellon interests", price: v * 0.95, note: "The bankers buy, and will run it for what it earns." });
  if (y >= 1983) bids.push({ id: "workers", who: "The men (an employee buy-out)", price: v * 0.5, note: "Half the value, and the valley's gratitude." });
  if (y >= 1985) bids.push({ id: "authority", who: "The Steel Valley Authority", price: v * 0.7, note: "The mill towns' authority keeps it running." });
  return bids.map((b) => ({ ...b, price: Math.round(b.price / 1000) * 1000 }));
}

/** sell every works: the family keeps its cash and holdings and plays on as investors */
export function sellCompany(g: GameState, bidId: string): { ok: boolean; text: string } {
  const c = g.company;
  if (!c) return { ok: false, text: "No company" };
  if (year(g) < 1880) return { ok: false, text: "From 1880" };
  if (c.biz.actionsLeft <= 0) return { ok: false, text: "No actions left this season" };
  const bid = companyBids(g).find((b) => b.id === bidId);
  if (!bid) return { ok: false, text: "No such buyer" };
  const y = year(g), works = allWorks(c);
  // the tax on the gain over what the plant cost (its scrap value is a fair stand-in for the book value)
  const book = works.reduce((s, w) => s + scrapValue(g, w) / 0.35, 0);
  const tax = Math.round(Math.max(0, bid.price - book) * capitalGainsRate(y));
  c.cash += bid.price - tax;
  c.biz.actionsLeft--;
  const rid = bidId.startsWith("rival:") ? bidId.slice(6) : bidId === "trust" ? "carnegie" : undefined;
  const buyer = rid ? g.rivals.find((r) => r.id === rid) : undefined;
  for (const w of works) {
    if (buyer) buyer.expand = Math.min(2, buyer.expand + (w.employees ? 0.25 : 0.1));
    w.sold = { to: bid.who, year: y };
    w.employees = 0; w.status = "idle"; w.research = undefined;
  }
  // the buyers take on the pensions
  c.retirees = 0;
  bump(g, "influence", 5);
  mark(g, { id: `soldCompany${y}`, side: "labour", kind: bidId === "workers" ? "trust" : "grievance", weight: bidId === "workers" ? 12 : 6, text: `sold the works to ${bid.who}` });
  pushHeadline(g, `${c.name} Sold to ${bid.who}`, `The family sells its works for $${bid.price.toLocaleString("en-US")}${tax ? ` ($${tax.toLocaleString("en-US")} to the tax on the gain)` : ""}. It keeps its money and its holdings; the men wait to hear the new owners' terms.`, "Industry");
  c.biz.record.push(`${cal(g).season} ${y}: sold the company to ${bid.who}`);
  return { ok: true, text: `Sold to ${bid.who} for $${bid.price.toLocaleString("en-US")}. The family lives on its holdings now: found or buy a works whenever you like.` };
}

/** the family has no works of its own (sold, or all scrapped) */
export const investorsOnly = (g: GameState) => !!g.company && !allWorks(g.company).length;

// ---------------------------------------------------------------- scrapping and redeveloping a closed works

export function scrapWorks(g: GameState, id: string, redevelop: boolean): { ok: boolean; text: string } {
  const c = g.company!, w = allWorks(c).find((x) => x.id === id);
  if (!w) return { ok: false, text: "No such works" };
  if (!w.closed) return { ok: false, text: "Only a closed works" };
  const y = year(g);
  if (redevelop && y < 1960) return { ok: false, text: "Redevelopment from 1960" };
  if (c.biz.actionsLeft <= 0) return { ok: false, text: "No actions left this season" };
  const scrap = scrapValue(g, w), price = Math.round((redevelop ? scrap * 1.4 : scrap) / 1000) * 1000;
  c.cash += price; c.biz.actionsLeft--;
  w.sold = { to: redevelop ? "redevelopment" : "scrap", year: y };
  w.stock = 0;
  const m = g.map;
  for (const fp of [{ x: w.x, y: w.y, f: w.footprint }, ...(w === c ? c.annexes : w.annexes).map((a) => ({ x: a.x, y: a.y, f: a.fp }))])
    for (let dy = 0; dy < fp.f; dy++) for (let dx = 0; dx < fp.f; dx++) {
      const i = (fp.y + dy) * m.width + fp.x + dx;
      g.world.owner[i] = 0;
      if (redevelop) { g.world.use[i] = Use.Commerce; g.world.sub[i] = (dx + dy) % 3 === 0 ? 8 : 7; g.world.built[i] = y; g.world.pop[i] = 0; }
      else { g.world.use[i] = Use.Rock; g.ruins.push([i, g.turn + 24]); }
    }
  if (w !== c) c.others = c.others.filter((x) => x !== w);
  g.world.version++;
  log(g, redevelop ? `${w.name}'s land is cleared for an office park and shopping centre: $${price.toLocaleString("en-US")}.` : `${w.name} is sold for scrap: $${price.toLocaleString("en-US")}.`);
  return { ok: true, text: redevelop ? `The redevelopment authority pays $${price.toLocaleString("en-US")} for the land.` : `Scrap and land: $${price.toLocaleString("en-US")}.` };
}

// ---------------------------------------------------------------- going public

export interface PublicState { outside: number; missed: number; since: number; raided?: boolean }
export const publicOf = (c: Company) => c.public;
/** the board runs things when outsiders hold more than half */
export const boardRules = (g: GameState) => (g.company?.public?.outside ?? 0) > 50;

/** what 10% of the company sells for (the underwriters take 5%) */
export const tenthPrice = (g: GameState) => Math.max(0, Math.round((companyWorth(g).total * 0.1 * 0.95) / 1000) * 1000);
export const buybackPrice = (g: GameState) => Math.max(0, Math.round((companyWorth(g).total * 0.1 * 1.05) / 1000) * 1000);

export function goPublicBlocked(g: GameState): string | null {
  const c = g.company;
  if (!c) return "No company";
  if (year(g) < 1890) return "From 1890 (the industrials list on the exchange)";
  if (investorsOnly(g)) return "The family has no company to list";
  if ((c.public?.outside ?? 0) >= 70) return "Outsiders hold 70%: enough";
  if (c.biz.actionsLeft <= 0) return "No actions left this season";
  if (companyWorth(g).total <= 0) return "Nobody buys shares in a company worth nothing";
  return null;
}

export function sellTenth(g: GameState): { ok: boolean; text: string } {
  const why = goPublicBlocked(g);
  if (why) return { ok: false, text: why };
  const c = g.company!, p = tenthPrice(g);
  c.public ??= { outside: 0, missed: 0, since: year(g) };
  c.public.outside += 10;
  c.cash += p; c.biz.actionsLeft--;
  const first = c.public.outside === 10;
  if (first) pushHeadline(g, `${c.name} Lists Its Shares`, `The family sells a tenth of the company on the exchange for $${p.toLocaleString("en-US")}. The new shareholders will expect their dividends.`, "Industry");
  return { ok: true, text: `Sold 10% for $${p.toLocaleString("en-US")}: outsiders hold ${c.public.outside}%.${c.public.outside > 50 ? " The board, not the family, now runs the company." : ""}` };
}

export function buyBack(g: GameState): { ok: boolean; text: string } {
  const c = g.company!, P = c.public;
  if (!P?.outside) return { ok: false, text: "The family holds it all" };
  if (c.biz.actionsLeft <= 0) return { ok: false, text: "No actions left this season" };
  const p = buybackPrice(g);
  if (c.cash < p) return { ok: false, text: `Needs $${p.toLocaleString("en-US")}` };
  c.cash -= p; c.biz.actionsLeft--;
  P.outside -= 10;
  if (!P.outside) c.public = undefined;
  return { ok: true, text: `Bought back 10% for $${p.toLocaleString("en-US")}.` };
}

/** the outside shareholders' dividend a season: about 5% a year on their part of the company */
export const dividendDue = (g: GameState) => Math.max(0, Math.round(companyWorth(g).total * ((g.company?.public?.outside ?? 0) / 100) * 0.0125));

/**
 * Each season for a listed company: the dividend (missed when there isn't the cash or the profit), the share price
 * the market puts on a company that misses them, and the raiders a cheap company invites.
 */
export function publicSeason(g: GameState): string[] {
  const c = g.company, P = c?.public;
  if (!c || !P?.outside || investorsOnly(g)) return [];
  const notes: string[] = [], due = dividendDue(g), profit = c.totals?.profit ?? 0;
  if (due > 0 && c.cash > due && profit >= -due) { c.cash -= due; P.missed = 0; notes.push(`Dividend to the shareholders: $${due.toLocaleString("en-US")}.`); }
  else if (due > 0) {
    P.missed++;
    notes.push(`No dividend this season (${P.missed} missed): the shares slide.`);
    if (P.missed === 2) bump(g, "influence", -4);
  }
  // a cheap company with outside shareholders invites a raider (the bid card in owners.ts)
  if (P.missed >= 4 && !P.raided && P.outside >= 30) {
    P.raided = true;
    const bidder = g.rivals.find((r) => { const d = RIVALS.find((x) => x.id === r.id); return d && r.active && !r.closed && !r.owned && ["aggressive", "financier"].includes(r.style ?? d.style); });
    if (bidder) {
      c.biz.flags.bidder = bidder.id; c.biz.flags.bidTurn = g.turn;
      notes.push("A raider is buying your shares on the exchange.");
      const d = takeoverDecision(g);
      if (d) { if (!g.pendingDecision) g.pendingDecision = d; else g.moreDecisions.push(d); }
    }
  }
  // the board, not the family, decides when outsiders hold the majority: a company losing money a year on end is sold
  if (boardRules(g) && (c.redSeasons ?? 0) >= 4) {
    const best = companyBids(g).sort((a, b) => b.price - a.price)[0];
    if (best) { c.biz.actionsLeft = Math.max(1, c.biz.actionsLeft); const r = sellCompany(g, best.id); notes.push(`The board sells the company over the family's head. ${r.text}`); }
  }
  if (P.missed === 0) P.raided = false;
  return notes;
}

/** a share in your company: its value per 1% (for the panel) */
export const pricePerPercent = (g: GameState) => Math.round(companyWorth(g).total / 100);

/** an industry's name (for the sale panel) */
export const industryName = (c: Company) => INDUSTRIES[c.industry].name;

/** the buyers' view of a works (for the Works tab) */
export const worksSale = (g: GameState, w: Works) => ({ value: worksValue(g, w), scrap: scrapValue(g, w) });
