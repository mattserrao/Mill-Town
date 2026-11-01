// The world market (v0.18): demand, imports, trade policy, minimills and costs from 1946. The squeeze that closed
// the valley's mills came mostly from volume, not price: U.S. shipments fell from 111M tons (1973) to 62M (1982),
// the mills ran at 48% of capacity against a break-even near 70%, and imports took a quarter of the market by 1984
// while the list price kept rising to 1981. Here each industry has a utilisation the market allows by year (what
// the U.S. mills as a whole ran at), moved by trade policy and the dollar, and each works gets more or less of it
// by how its costs compare with the world's (oxygen furnaces, continuous casting, automation). Unsold capacity
// idles and its upkeep still runs. Research: docs/V018-RESEARCH.md §5.

import { allWorks, cal, type GameState, log, type Works } from "./game";
import { boardRules } from "./ownership";
import { bump, type Decision } from "./business";
import { mark } from "./ledger";
import type { IndustryId } from "./industries";

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const lerpTable = (t: Record<number, number>, y: number, before: number, after?: number): number => {
  const ys = Object.keys(t).map(Number).sort((a, b) => a - b);
  if (y <= ys[0]) return y < ys[0] ? before : t[ys[0]];
  if (y >= ys[ys.length - 1]) return after ?? t[ys[ys.length - 1]];
  for (let k = 1; k < ys.length; k++) if (y < ys[k]) { const f = (y - ys[k - 1]) / (ys[k] - ys[k - 1]); return t[ys[k - 1]] + (t[ys[k]] - t[ys[k - 1]]) * f; }
  return t[ys[ys.length - 1]];
};

/** U.S. steel: utilisation of capacity by year (it already carries imports, minimills and the cycle) */
const STEEL_UTIL: Record<number, number> = {
  1946: 0.72, 1947: 0.93, 1948: 0.94, 1949: 0.82, 1950: 0.97, 1951: 1.0, 1952: 0.85, 1953: 0.95, 1954: 0.71, 1955: 0.93,
  1956: 0.9, 1957: 0.85, 1958: 0.61, 1959: 0.64, 1960: 0.67, 1961: 0.66, 1962: 0.66, 1963: 0.72, 1964: 0.83, 1965: 0.86,
  1966: 0.88, 1967: 0.82, 1968: 0.83, 1969: 0.9, 1970: 0.83, 1971: 0.77, 1972: 0.88, 1973: 0.95, 1974: 0.92, 1975: 0.76,
  1976: 0.8, 1977: 0.78, 1978: 0.86, 1979: 0.86, 1980: 0.72, 1981: 0.78, 1982: 0.48, 1983: 0.56, 1984: 0.62, 1985: 0.65,
};
/** U.S. steel demand (apparent consumption), 1973 = 100 */
const STEEL_DEMAND: Record<number, number> = {
  1946: 55, 1950: 66, 1953: 74, 1955: 78, 1958: 58, 1960: 68, 1965: 87, 1969: 93, 1970: 86, 1971: 84, 1972: 93, 1973: 100,
  1974: 100, 1975: 80, 1976: 85, 1977: 85, 1978: 95, 1979: 95, 1980: 80, 1981: 82, 1982: 58, 1983: 64, 1984: 72, 1985: 72,
};
/** imports' share of U.S. steel consumption */
const STEEL_IMPORTS: Record<number, number> = {
  1950: 0.02, 1958: 0.03, 1959: 0.06, 1962: 0.05, 1965: 0.1, 1968: 0.165, 1970: 0.138, 1971: 0.179, 1972: 0.166, 1973: 0.124,
  1974: 0.134, 1975: 0.135, 1976: 0.141, 1977: 0.178, 1978: 0.181, 1979: 0.152, 1980: 0.163, 1981: 0.189, 1982: 0.218,
  1983: 0.205, 1984: 0.264, 1985: 0.252,
};
/** scrap-fed electric minimills' share of the U.S. market */
const MINIMILLS: Record<number, number> = { 1965: 0, 1970: 0.03, 1975: 0.07, 1980: 0.12, 1983: 0.15, 1985: 0.16 };
/** the trade-weighted dollar, 1980 = 100 (it rose 77% to February 1985) */
const DOLLAR: Record<number, number> = { 1970: 120, 1973: 100, 1975: 98, 1978: 92, 1980: 100, 1981: 115, 1982: 130, 1983: 140, 1984: 160, 1985: 177 };

/** trade policy in force in a year (what history did; the player can add a tariff by lobbying) */
export function tradePolicy(year: number): string | null {
  if (year >= 1969 && year <= 1974) return "Voluntary restraint agreements (Japan and Europe)";
  if (year >= 1978 && year <= 1981) return "Trigger price mechanism";
  if (year === 1982 || year === 1983) return "U.S.–European steel arrangement";
  if (year >= 1984) return "Steel import restraints (18.5%)";
  return null;
}

/** the share of the U.S. steel market imports take */
export const steelImports = (year: number) => lerpTable(STEEL_IMPORTS, year, 0.02);
export const minimillShare = (year: number) => lerpTable(MINIMILLS, year, 0);
export const steelDemand = (year: number) => lerpTable(STEEL_DEMAND, year, 50);
export const dollarIndex = (year: number) => lerpTable(DOLLAR, year, 120);

/** what the market lets an industry run at, before your costs: the U.S. industry's own utilisation */
export function marketUtil(ind: IndustryId, year: number): number {
  if (year < 1946) return 1;
  const steel = lerpTable(STEEL_UTIL, year, 0.9);
  switch (ind) {
    case "steel": return steel;
    // machinery, barges and bridges follow the mills' capital spending a few years late
    case "metalworks": return clamp(lerpTable(STEEL_UTIL, year - 3, 0.9) * (year >= 1982 ? 0.75 : 1), 0.3, 1);
    // glass follows the car makers (float glass from 1963 retires the plate lines)
    case "glass": return year < 1974 ? 0.9 : year < 1980 ? 0.82 : year < 1983 ? 0.7 : 0.78;
    // the utilities lose their industrial load when the mills go
    case "power": return year < 1980 ? 1 : 0.88;
    // aluminium: energy shocks (1973, 1979), then the 1982 recession; ten U.S. smelters close in the 1980s
    case "aluminium": return year < 1974 ? 0.92 : year < 1980 ? 0.82 : year < 1982 ? 0.75 : year < 1984 ? 0.6 : 0.68;
    // coal chemicals: half follows the blast furnaces, half the chemical markets
    case "chemicals": return 0.5 * steel + 0.45;
    // nuclear: the Navy keeps the labs busy; the utilities stop ordering after Three Mile Island (1979)
    case "nuclear": return year < 1979 ? 0.95 : 0.65;
    default: return 1;
  }
}

/** the world price an industry gets, relative to the trend (aluminium on the London Metal Exchange from 1978) */
export function worldPrice(ind: IndustryId, year: number): number {
  switch (ind) {
    // the administered list price kept rising to 1981, then fell about 12%
    case "steel": return year <= 1981 ? 1 : year === 1982 ? 0.93 : year === 1983 ? 0.88 : year === 1984 ? 0.86 : 0.85;
    case "metalworks": return year < 1975 ? 1 : year < 1982 ? 0.95 : 0.88;
    case "glass": return year < 1975 ? 1 : 0.95;
    case "aluminium": return year < 1978 ? 1 : ({ 1978: 1.05, 1979: 1.15, 1980: 1.2, 1981: 0.95, 1982: 0.62, 1983: 0.95, 1984: 0.8 } as Record<number, number>)[year] ?? 0.7;
    default: return 1;
  }
}

/**
 * How a works' costs compare with the world's, as a multiplier on the orders it gets (1 = the average U.S. works).
 * From 1960 Japanese and European mills with oxygen furnaces and continuous casters made steel for a quarter less;
 * U.S. labour cost per ton ran nearly twice Japan's by 1982. Modern processes and lower wages win orders back.
 */
export function competitiveness(g: GameState, w: Works): number {
  const y = cal(g).year;
  if (y < 1958) return 1;
  const has = (t: string) => w.techs.includes(t);
  const p = g.company?.biz.policy;
  let f = 1;
  // even the best U.S. works stayed dearer than the Japanese (labour cost per ton nearly twice theirs in 1982)
  if (w.industry === "steel") f = 0.76 + (has("bof") ? 0.08 : 0) + (has("continuous_cast") ? 0.08 : 0) + (has("automation") ? 0.04 : 0) - (has("open_hearth") && !has("bof") && y >= 1970 ? 0.08 : 0);
  else if (w.industry === "glass") f = 0.9 + (has("float_glass") ? 0.12 : 0) + (has("automation") ? 0.05 : 0);
  else if (w.industry === "metalworks") f = 0.9 + (has("towboats") ? 0.06 : 0) + (has("automation") ? 0.06 : 0);
  else if (w.industry === "aluminium") f = 0.92 + (has("cans") ? 0.08 : 0) + (has("automation") ? 0.05 : 0);
  if (p && y >= 1965) f += p.wages === "low" ? 0.04 : p.wages === "high" ? -0.04 : 0;
  // a works that let its labour cost run (the steel wage premium reached 64% over manufacturing by 1981)
  if (w.industry === "steel" && y >= 1975) f -= 0.06 * Math.min(1, (y - 1975) / 6);
  return clamp(f, 0.6, 1.2);
}

/** imports' pressure from the dollar and trade policy (the player's own tariff lobbying adds protection) */
function protection(g: GameState, ind: IndustryId, year: number): number {
  if (year < 1959 || (ind !== "steel" && ind !== "metalworks" && ind !== "glass" && ind !== "aluminium")) return 1;
  const tariff = (g.company?.biz.tariffUntil ?? 0) > g.turn ? 0.04 : 0;
  // the historical series already carries the dollar; this is the swing from what the player does
  return 1 + tariff;
}

/**
 * The closure card (1982–85): a steel works losing money a year on end with the orders gone. The owners closed
 * them (Duquesne 1984, Homestead and the South Side 1986, National Tube 1987); a family that keeps one going pays
 * for it out of everything else it owns. Rebuilt from its source on load.
 */
export function closureDecision(g: GameState, worksId: string): Decision | null {
  const c = g.company, w = c && allWorks(c).find((x) => x.id === worksId);
  if (!c || !w || w.closed) return null;
  const men = w.employees;
  return {
    id: `closure_${w.id}`, source: `closure:${w.id}`, historical: 0,
    title: `The board wants to close ${w.name}`,
    text: `Orders for ${Math.round((w.market?.util ?? 0.5) * 100)}% of the plant, a loss every season, and imports landing for less than your cost. The bankers say ${w.name} will never pay again; the union and the town say it must not go cold.`,
    options: [
      { label: "Close it", detail: `${men.toLocaleString("en-US")} men out of work; the plant stands cold (its upkeep falls to a caretaker's). Labour −20, morale −8.`, apply: (g2) => {
        w.closed = true; w.status = "idle"; g2.jobless += w.employees; w.employees = 0;
        bump(g2, "labour", -20); g2.morale = Math.max(0, g2.morale - 8);
        mark(g2, { id: `closed_${w.id}`, side: "labour", kind: "grievance", weight: 15, text: `shut ${w.name} in ${cal(g2).year}` });
        return `${w.name} goes cold.`;
      } },
      { label: "Keep it going", detail: "Run it at a loss and pay for it from the family's other businesses. Labour +10, reputation +6, morale +4.", apply: (g2) => {
        bump(g2, "labour", 10); bump(g2, "reputation", 6); g2.morale = Math.min(100, g2.morale + 4);
        g2.company!.biz.flags[`kept_${w.id}`] = cal(g2).year;
        return `${w.name} stays in blast — for now.`;
      } },
    ],
  };
}

/** each season from 1982: steel works that have lost money all year face the closure card (once a works) */
export function closureSeason(g: GameState) {
  const c = g.company, y = cal(g).year;
  if (!c || y < 1982) return;
  for (const w of allWorks(c)) {
    if (w.industry !== "steel" || w.closed || c.biz.flags[`closeAsked_${w.id}`]) continue;
    const s = w.lastSeason;
    if (!s || s.profit >= 0 || (w.market?.util ?? 1) >= 0.7) { w.lossSeasons = 0; continue; }
    w.lossSeasons = (w.lossSeasons ?? 0) + 1;
    if (w.lossSeasons < 4) continue;
    c.biz.flags[`closeAsked_${w.id}`] = y;
    const d = closureDecision(g, w.id);
    if (!d) continue;
    // a board with the majority doesn't ask the family
    if (boardRules(g)) { const t = d.options[0].apply(g, null as never); log(g, `The board closes ${w.name}. ${t}`); continue; }
    if (!g.pendingDecision) g.pendingDecision = d; else g.moreDecisions.push(d);
  }
}

/** what a unit of idle capacity costs a season, as a share of its price (heavy plant costs most to keep ready) */
export function idleCost(ind: IndustryId): number {
  return ind === "steel" ? 0.38 : ind === "aluminium" || ind === "chemicals" ? 0.25 : ind === "metalworks" || ind === "glass" ? 0.2 : 0.1;
}

export interface MarketView { util: number; demand?: number; imports?: number; minimills?: number; policy?: string | null; dollar?: number; price: number; comp: number }

/** what the market lets this works sell this season, as a share of its capacity, and why */
export function marketFor(g: GameState, w: Works): MarketView {
  const y = cal(g).year, ind = w.industry;
  const comp = competitiveness(g, w);
  const util = y < 1946 ? 1 : clamp(marketUtil(ind, y) * comp * protection(g, ind, y), 0.15, 1);
  return {
    util, comp, price: worldPrice(ind, y),
    ...(ind === "steel" && y >= 1946 ? { demand: steelDemand(y), imports: steelImports(y), minimills: minimillShare(y), policy: tradePolicy(y), dollar: dollarIndex(y) } : {}),
  };
}
