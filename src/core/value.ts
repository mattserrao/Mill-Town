// What things are worth (v0.18.2): one valuation for works, rivals and the whole concern. A works is worth eight
// years of its recent profit, or its scrap value if that's more (a losing mill is worth its land and iron); a rival
// works the same, from its simulated profit; you buy at value +10% and sell at value −10%. Net worth — works,
// holdings and cash, less debts — is shown on the Overview and counts in the family's Fortune and its estate tax.

import { allWorks, cal, type GameState, PRICE_TREND, rivalOutput, type Works } from "./game";
import { INDUSTRIES } from "./industries";
import { techCost } from "./market";
import { RIVALS } from "./rivals";
import { marketPrice, rivalNominal } from "./supply";
import { priceLevel } from "./time";
import { marketUtil } from "./world";

/** years of profit a works is worth */
export const EARNINGS_YEARS = 8;
/** what scrap and land fetch of what the plant cost */
export const SCRAP = 0.35;

const unitPrice = (g: GameState, ind: Works["industry"]) => INDUSTRIES[ind].basePrice * (1 + (cal(g).year - 1850) * PRICE_TREND) * marketPrice(g, ind);

/** what the plant's land, buildings and processes would fetch broken up, plus what's in its yards */
export function scrapValue(g: GameState, w: Works): number {
  const ind = INDUSTRIES[w.industry], y = cal(g).year;
  let cost = ind.startCost * priceLevel(y);
  for (const t of ind.tech) if (w.techs.includes(t.id) && t.cost > 0) cost += techCost(t, t.year);
  cost += (w.annexes ?? []).filter((a) => a.kind === "expand").length * ind.startCost * 0.6 * priceLevel(y);
  return Math.round(cost * SCRAP + (w.stock ?? 0) * unitPrice(g, w.industry) * 0.8);
}

/** average yearly profit over the last two years (what the buyers look at) */
export function yearlyProfit(w: Works): number {
  const ps = w.profits ?? [];
  return ps.length ? (ps.reduce((s, v) => s + v, 0) / ps.length) * 4 : 0;
}

/** what a works is worth: eight years of profit, or its scrap if more */
export function worksValue(g: GameState, w: Works): number {
  if (w.sold) return 0;
  if (w.closed) return scrapValue(g, w);
  return Math.round(Math.max(yearlyProfit(w) * EARNINGS_YEARS, scrapValue(g, w)));
}

/** what a buyer pays for one of your works (value −10%; the workers and the Authority pay less) */
export const sellPrice = (g: GameState, w: Works) => Math.round((worksValue(g, w) * 0.9) / 1000) * 1000;

// ---------------------------------------------------------------- the rivals

/**
 * A rival's profit per season: its sales at the market price, at a margin that widens when the market is tight
 * and narrows (or turns to losses) in a glut, and from 1946 with the world market's squeeze.
 */
export function rivalProfit(g: GameState, id: string): number {
  const r = g.rivals.find((x) => x.id === id), d = RIVALS.find((x) => x.id === id);
  if (!r || !d || !r.active || r.closed || r.owned) return 0;
  const y = cal(g).year, p = marketPrice(g, d.industry);
  let margin = 0.12 + (p - 1) * 0.8;
  if (y >= 1946) margin -= Math.max(0, 1 - marketUtil(d.industry, y) / 0.88) * 0.5;
  return rivalOutput(g, r) * unitPrice(g, d.industry) * Math.max(-0.15, Math.min(0.3, margin));
}

/** a rival works' value: eight years of its profit, or its scrap */
export function rivalValue(g: GameState, id: string): number {
  const r = g.rivals.find((x) => x.id === id), d = RIVALS.find((x) => x.id === id);
  if (!r || !d || !r.active || r.closed || r.owned) return 0;
  const scrap = Math.max(rivalNominal(g, r), INDUSTRIES[d.industry].baseCapacity * 0.3) * unitPrice(g, d.industry) * 1.5;
  return Math.round(Math.max(rivalProfit(g, id) * 4 * EARNINGS_YEARS, scrap));
}

// ---------------------------------------------------------------- the whole concern

export interface NetWorth { cash: number; works: number; holdings: number; debt: number; total: number }

/** everything the family's company is worth: works, holdings and cash, less what it owes */
export function netWorth(g: GameState, holdings: number, margin = 0): NetWorth {
  const c = g.company;
  if (!c) return { cash: 0, works: 0, holdings: 0, debt: 0, total: 0 };
  const works = allWorks(c).reduce((s, w) => s + worksValue(g, w), 0);
  const debt = c.debt + margin;
  return { cash: Math.round(c.cash), works, holdings: Math.round(holdings), debt: Math.round(debt), total: Math.round(c.cash + works + holdings - debt) };
}

/** record the season's profit on each works (for its value) */
export function recordProfits(c: { others: Works[] } & Works) {
  for (const w of [c, ...c.others]) if (w.lastSeason && !w.sold) w.profits = [...(w.profits ?? []), w.lastSeason.profit].slice(-8);
}
