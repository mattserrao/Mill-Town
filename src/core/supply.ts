// Supply and demand (v0.18.2, from 1893). Each industry has a demand for the valley's products each season — the
// rivals' normal output plus room for about one works of the day, moved by the business cycle and the wars (the
// panics and the Depression come through their events), and from 1946 by the world market (src/core/world.ts).
// Supply is your output plus every rival's. The price drifts toward demand over supply; when there's too much, part
// of it goes unsold (your stock piles up at the works and costs money to carry); when there's too little, everyone
// still running gets more. The rivals react each spring: they expand when prices are high and bank furnaces when
// they're low. Knock-ons: busy mills make coal and coke dear; the utilities' sales follow the mills.

import type { ActionDef } from "./business";
import { allWorks, cal, type GameState, PRICE_TREND, rivalRunning, type RivalState, techsForYear } from "./game";
import { recordMove } from "./owners";
import { INDUSTRIES, INDUSTRY_IDS, type IndustryId } from "./industries";
import { RIVALS } from "./rivals";
import { rivalTechs } from "./market";
import { marketUtil } from "./world";

export const MARKET_FROM = 1893;
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export interface MarketState {
  /** price relative to the trend (1 = normal) */
  price: number;
  demand: number; supply: number;
  /** the share of what's offered that sells this season */
  sold: number;
  /** the business cycle this season */
  cycle: number;
}

/** the business cycle for the heavy industries, 1893–1945 (the panics and the Depression are their own events) */
const CYCLE: Record<number, number> = {
  1893: 1, 1897: 0.95, 1898: 1.08, 1899: 1.1, 1900: 1.02, 1903: 1.05, 1904: 0.92, 1905: 1.05, 1907: 1, 1910: 1.02,
  1911: 0.92, 1912: 1.02, 1914: 0.82, 1915: 1.02, 1916: 1.18, 1917: 1.22, 1918: 1.2, 1919: 0.9, 1920: 1.02, 1921: 0.62,
  1922: 0.88, 1923: 1.05, 1924: 0.92, 1925: 1, 1929: 1.04, 1930: 1, 1937: 1, 1938: 0.7, 1939: 0.88, 1940: 1,
  1941: 1.18, 1942: 1.25, 1943: 1.25, 1944: 1.22, 1945: 1.05,
};
/** how strongly each industry swings with the cycle */
const SWING: Partial<Record<IndustryId, number>> = { steel: 1.2, metalworks: 1.1, aluminium: 1.2, chemicals: 1, glass: 0.8, power: 0.4, research: 0.5, nuclear: 0.6, medicine: 0 };

function cycleOf(ind: IndustryId, year: number): number {
  if (year >= 1946) {
    // the world market: the U.S. industry's own use of its plant (1 = a normal year, ~88%)
    const u = marketUtil(ind, year);
    if (ind === "power") return 0.75 + 0.25 * marketUtil("steel", year) / 0.88; // the utilities lose the mills' load
    return u / 0.88;
  }
  let c = 1;
  for (const [y, v] of Object.entries(CYCLE)) if (year >= Number(y)) c = v;
  return 1 + (c - 1) * (SWING[ind] ?? 1);
}

/** what a rival works would make in a normal season (no strikes, damage or banked furnaces) */
export function rivalNominal(g: GameState, r: RivalState, year = cal(g).year): number {
  const def = RIVALS.find((d) => d.id === r.id);
  if (!def || !r.active || r.closed || r.owned) return 0;
  if (def.opens !== undefined && year < def.opens) return 0;
  const ind = INDUSTRIES[def.industry];
  let cap = 1;
  for (const id of rivalTechs(def.industry, def.id, year, r.style)) cap += ind.tech.find((x) => x.id === id)?.effects.capacity ?? 0;
  return ind.baseCapacity * cap * rivalRunning(def, year) * (1 + r.expand) * (r.partial ?? 1);
}

/** a typical works of the day in an industry: the room the market leaves for you */
function roomFor(ind: IndustryId, year: number): number {
  const I = INDUSTRIES[ind];
  let cap = 1;
  for (const id of techsForYear(ind, year)) cap += I.tech.find((t) => t.id === id)?.effects.capacity ?? 0;
  return I.baseCapacity * cap * 0.85;
}

/**
 * Clear every industry's market for the season. `yours`: what your works offer, by industry (output and stock).
 * Sets g.markets and returns them. Before 1893 there's no market: everything sells at the trend price.
 */
export function clearMarkets(g: GameState, yours: Partial<Record<IndustryId, number>>, rivalsNow: (r: RivalState) => number, yourCapacity: Partial<Record<IndustryId, number>> = {}): Partial<Record<IndustryId, MarketState>> {
  const y = cal(g).year;
  const out = (g.markets ??= {});
  if (y < MARKET_FROM) return out;
  for (const ind of INDUSTRY_IDS) {
    let ref = 0, theirs = 0;
    for (const r of g.rivals) {
      const def = RIVALS.find((d) => d.id === r.id);
      if (!def || def.industry !== ind || def.id === "frick" || def.id === "mellon") continue;
      ref += rivalNominal(g, r, y);
      theirs += rivalsNow(r);
    }
    const mine = yours[ind] ?? 0;
    if (!ref && !mine) { delete out[ind]; continue; }
    const cycle = cycleOf(ind, y);
    // your customers: about one works of the day's worth; more plant than that is more than the market wants
    const room = Math.min(yourCapacity[ind] ?? 0, roomFor(ind, y));
    const demand = (ref + room) * cycle;
    const supply = Math.max(1, theirs + mine);
    const ratio = demand / supply;
    const prev = out[ind]?.price ?? 1;
    const target = clamp(Math.pow(ratio, 0.8), 0.6, 1.4);
    out[ind] = { price: prev + (target - prev) * 0.4, demand, supply, sold: clamp(ratio, 0.3, 1), cycle };
  }
  // a slump in the mills is a slump in the valley: the shops, the railroads, the mood
  const st = out.steel;
  if (st && st.price < 0.85) g.morale = Math.max(0, g.morale - 0.5);
  return out;
}

/** the market price factor for an industry this season (1 before the market opens) */
export const marketPrice = (g: GameState, ind: IndustryId) => g.markets?.[ind]?.price ?? 1;

/** each spring the rivals answer the market: expand when it pays, bank furnaces when it doesn't */
export function rivalsAnswer(g: GameState) {
  const y = cal(g).year;
  if (y < MARKET_FROM || cal(g).season !== "Spring") return;
  for (const r of g.rivals) {
    const def = RIVALS.find((d) => d.id === r.id);
    if (!def || !r.active || r.closed || r.owned) continue;
    const p = marketPrice(g, def.industry);
    if (p > 1.1 && r.expand < 1) r.expand = Math.round((r.expand + 0.05) * 100) / 100;
    if (p < 0.85) r.bank = 0.8;
    else if (p > 0.95) r.bank = 1;
  }
}

/** busy mills make coal and coke dear (Frick's lever); a glut makes them cheap */
export const fuelPriceMult = (g: GameState) => 0.85 + 0.15 * marketPrice(g, "steel");

// ---------------------------------------------------------------- dumping the stock

export const MARKET_ACTIONS: ActionDef[] = [{
  id: "dump", group: "Rivals", name: "Dump the stock",
  blurb: "Sell everything in the yards at a quarter under the market to win orders. The price falls for everyone, and the other owners will answer it.",
  cost: () => 0,
  blocked: (g) => (cal(g).year < MARKET_FROM ? "From 1893" : allWorks(g.company!).some((w) => (w.stock ?? 0) > 0) ? null : "Nothing in the yards"),
  run: (g) => {
    const c = g.company!, y = cal(g).year;
    let cash = 0, units = 0;
    for (const w of allWorks(c)) {
      const n = w.stock ?? 0;
      if (!n) continue;
      const ind = INDUSTRIES[w.industry];
      cash += n * ind.basePrice * (1 + (y - 1850) * PRICE_TREND) * marketPrice(g, w.industry) * 0.75;
      units += n; w.stock = 0;
      const m = g.markets?.[w.industry];
      if (m) m.price = Math.max(0.6, m.price - 0.04);
    }
    c.cash += Math.round(cash);
    recordMove(g, "undercut");
    return `${units.toLocaleString()} units dumped for $${Math.round(cash).toLocaleString()}: the price sags and the other owners take note.`;
  },
}];
