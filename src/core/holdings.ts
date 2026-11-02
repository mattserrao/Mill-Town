// The company's holdings beyond its works: small businesses bought outright (raw materials, transport, utilities,
// services), stakes in the rival and supplier works, and shares in the region's big companies.
//
//   Businesses   cost cash and an action; pay an income each season and help your works (cheaper coal, ore, sand
//                or limestone; cheaper freight by river or rail; lower upkeep). Up to three levels; sell for 70%.
//   Stakes       10% at a time in any open rival, supplier or customer works: a share of its profit each season;
//                at 20% its owners stop moving against you; at 50% you can buy the rest and run it as a works.
//                A works that closes takes your stake with it.
//   Investments  shares in Heinz, Westinghouse, Alcoa, PPG, Gulf, U.S. Steel and the Mellon bank, whose prices
//                follow the valley's history (the panics, the Crash, the war, the collapse); dividends each season.
//                Buying and selling shares costs no action.

import { recordMove } from "./owners";
import { bump } from "./business";
import { relationOf } from "./economy";
import { allWorks, cal, type GameState, log } from "./game";
import { netWorth, rivalProfit, rivalValue } from "./value";
import { rivalNominal } from "./supply";
import { INDUSTRIES as INDUSTRY_DEFS } from "./industries";
import { PRICE_TREND } from "./game";
import { Rng } from "./rng";
import { type Good, type IndustryId } from "./industries";
import { inBounds } from "./map";
import { RIVALS } from "./rivals";
import { acquire, acquisitionQuote } from "./rivalai";
import { nameNow } from "./rivals";
import { Terrain } from "./terrain";
import { priceLevel } from "./time";
import { Street } from "./town";

export type BizGroup = "Raw materials" | "Transport" | "Utilities" | "Services";
export interface BizDef {
  id: string; group: BizGroup; name: string; blurb: string;
  from: number; until?: number;
  /** 1850 dollars */
  cost: number; income: number;
  /** cheaper inputs for your works (multiplier on the good's price) */
  input?: Partial<Record<Good, number>>;
  /** only for works of these industries */
  forInd?: IndustryId[];
  /** cheaper freight by mode */
  freight?: { river?: number; rail?: number };
  /** cheaper upkeep for every works */
  upkeep?: number;
  /** income falls off (or grows) by year: [year, multiplier] */
  curve?: [number, number][];
  /** where it stands on the map */
  site: "coal" | "river" | "rail" | "town";
}

export const BUSINESSES: BizDef[] = [
  { id: "coal_mine", group: "Raw materials", name: "Coal mine", blurb: "A drift mine in the Pittsburgh seam: your coal 15% cheaper, and the rest sold.", from: 1850, cost: 25000, income: 1500, input: { coal: 0.85 }, curve: [[1920, 1], [1950, 0.7], [1975, 0.4]], site: "coal" },
  { id: "coke_ovens", group: "Raw materials", name: "Beehive coke ovens", blurb: "A bank of ovens in the Connellsville field: coal and coke for your furnaces 10% cheaper.", from: 1860, cost: 45000, income: 2500, input: { coal: 0.9 }, forInd: ["steel", "power"], curve: [[1916, 1], [1930, 0.5], [1950, 0.2]], site: "coal" },
  { id: "ore_dock", group: "Raw materials", name: "Ore boats & dock", blurb: "A share of a Great Lakes ore fleet and a dock at the Ohio: iron ore 15% cheaper.", from: 1880, cost: 80000, income: 3000, input: { ore: 0.85 }, forInd: ["steel"], curve: [[1960, 1], [1980, 0.5]], site: "river" },
  { id: "quarry", group: "Raw materials", name: "Limestone quarry", blurb: "A quarry up the Allegheny: limestone 20% cheaper, and stone for the builders.", from: 1850, cost: 15000, income: 900, input: { limestone: 0.8 }, site: "river" },
  { id: "sand_pit", group: "Raw materials", name: "Glass-sand pit", blurb: "A pit of clean silica sand: sand 20% cheaper.", from: 1850, cost: 15000, income: 900, input: { sand: 0.8 }, site: "river" },
  { id: "barge_line", group: "Transport", name: "Towboat & barge line", blurb: "Your own boats on the rivers: river freight 15% cheaper, and you carry for others.", from: 1850, cost: 35000, income: 2200, freight: { river: 0.85 }, curve: [[1940, 1.2], [1980, 1]], site: "river" },
  { id: "short_line", group: "Transport", name: "Short-line railroad", blurb: "A few miles of track and engines to the main lines: rail freight 15% cheaper.", from: 1870, cost: 90000, income: 4000, freight: { rail: 0.85 }, curve: [[1920, 1], [1960, 0.6]], site: "rail" },
  { id: "trucking", group: "Transport", name: "Trucking company", blurb: "Motor trucks for the short hauls: all freight 5% cheaper, and a growing trade.", from: 1920, cost: 40000, income: 2500, freight: { river: 0.95, rail: 0.95 }, curve: [[1920, 0.6], [1950, 1.3], [1980, 1.5]], site: "town" },
  { id: "gas_co", group: "Utilities", name: "Gas light company", blurb: "Coal gas for the streets and houses of a borough: steady income until electricity and natural gas take over.", from: 1850, cost: 30000, income: 2000, curve: [[1884, 1], [1900, 0.7], [1950, 0.3]], site: "town" },
  { id: "water_co", group: "Utilities", name: "Water company", blurb: "Pumps and mains for a borough: steady income, and the town thinks well of you.", from: 1860, cost: 40000, income: 2200, site: "river" },
  { id: "electric_co", group: "Utilities", name: "Electric light company", blurb: "Dynamos and wires for a borough. In 1903 Duquesne Light buys out the small companies, at a premium.", from: 1882, until: 1903, cost: 60000, income: 3500, site: "town" },
  { id: "store_chain", group: "Services", name: "Company stores", blurb: "A chain of stores in the mill towns: good money, though the men resent the prices.", from: 1850, cost: 20000, income: 1600, curve: [[1930, 1], [1950, 0.5]], site: "town" },
  { id: "machine_shop", group: "Services", name: "Machine & repair shop", blurb: "Your own millwrights and machinists: upkeep 10% lower at every works.", from: 1855, cost: 30000, income: 600, upkeep: 0.9, site: "town" },
  { id: "brickworks", group: "Services", name: "Brickworks", blurb: "Firebrick for furnaces and brick for the row houses going up: steady income.", from: 1850, cost: 20000, income: 1400, curve: [[1930, 1], [1960, 0.6]], site: "town" },
];

export interface OwnedBiz { id: string; level: number; since: number; spent: number; x: number; y: number }
export interface Holdings {
  biz: OwnedBiz[];
  /** percent held in each rival works */
  stakes: Record<string, number>;
  /** what you paid for the stakes (for the "gain" figure) */
  stakeCost: Record<string, number>;
  /** shares held in each company */
  shares: Record<string, number>;
  shareCost: Record<string, number>;
  /** the year you last bought into each rival (one purchase a year) */
  stakeYear?: Record<string, number>;
  /** the year you last bought each company's shares */
  shareYear?: Record<string, number>;
  /** lots bought in each company this decade ("1920:mellon" → lots): the brokers find only so many sellers */
  shareDecade?: Record<string, number>;
  /** the broker's loan against each holding bought on margin (1920–34) */
  margin?: Record<string, number>;
  /** last season's income by source */
  last?: { biz: number; stakes: number; dividends: number };
}

export const holdingsOf = (g: GameState): Holdings => (g.company!.holdings ??= { biz: [], stakes: {}, stakeCost: {}, shares: {}, shareCost: {} });
const year = (g: GameState) => cal(g).year;
const lerpCurve = (curve: [number, number][] | undefined, y: number) => {
  if (!curve?.length) return 1;
  if (y <= curve[0][0]) return curve[0][1];
  for (let k = 1; k < curve.length; k++) if (y <= curve[k][0]) { const [y0, a] = curve[k - 1], [y1, b] = curve[k]; return a + ((b - a) * (y - y0)) / (y1 - y0); }
  return curve[curve.length - 1][1];
};

// ---------------------------------------------------------------- businesses
export const bizDef = (id: string) => BUSINESSES.find((b) => b.id === id)!;
export const bizPrice = (g: GameState, d: BizDef, level = 1) => Math.round((d.cost * priceLevel(year(g)) * (level === 1 ? 1 : 0.6 * level)) / 1000) * 1000;
/** a season's income: about 10% a year on the price (v0.18.2: was 24%, which made every business a sure thing) */
export const bizIncome = (g: GameState, d: BizDef, level: number) => Math.round(d.income * 0.45 * priceLevel(year(g)) * lerpCurve(d.curve, year(g)) * (1 + 0.7 * (level - 1)));

export function bizBlocked(g: GameState, d: BizDef): string | null {
  const c = g.company, y = year(g);
  if (!c) return "Found your company first";
  if (y < d.from) return `From ${d.from}`;
  if (d.until && y >= d.until) return `Gone by ${d.until}`;
  if (holdingsOf(g).biz.some((b) => b.id === d.id)) return "You own one";
  if (c.biz.actionsLeft <= 0) return "No actions left this season";
  if (c.cash < bizPrice(g, d)) return `Needs $${bizPrice(g, d).toLocaleString("en-US")}`;
  return null;
}

/** a spot on the map for the business: a coal outcrop, the riverbank, a railroad or a town street near the works */
function siteFor(g: GameState, d: BizDef): [number, number] {
  const m = g.map, w = g.world, c = g.company!;
  const cx = c.x + (c.footprint >> 1), cy = c.y + (c.footprint >> 1);
  const taken = new Set(holdingsOf(g).biz.map((b) => b.y * m.width + b.x));
  let best: [number, number] = [cx, cy], bd = Infinity;
  for (let r = 4; r < 120 && bd === Infinity; r += 4) for (let y = cy - r; y <= cy + r; y += 2) for (let x = cx - r; x <= cx + r; x += 2) {
    if (!inBounds(m, x, y)) continue;
    const i = y * m.width + x;
    if (taken.has(i) || m.terrain[i] === Terrain.Water || w.owner[i]) continue;
    let ok = false;
    if (d.site === "coal") ok = m.coal[i] === 2;
    else if (d.site === "river") ok = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => inBounds(m, x + dx, y + dy) && m.terrain[(y + dy) * m.width + x + dx] === Terrain.Water);
    else if (d.site === "rail") ok = m.rail[i] > 0 && (m.railLines[String(m.rail[i])]?.year ?? 9999) <= w.year;
    else ok = w.street[i] === Street.Pike;
    if (!ok) continue;
    const dd = Math.hypot(x - cx, y - cy) + ((x * 7 + y * 3) % 5);
    if (dd < bd) { bd = dd; best = [x, y]; }
  }
  return best;
}

export function buyBiz(g: GameState, id: string): { ok: boolean; text: string } {
  const d = bizDef(id), why = bizBlocked(g, d);
  if (why) return { ok: false, text: why };
  const c = g.company!, h = holdingsOf(g), price = bizPrice(g, d);
  c.cash -= price; c.biz.actionsLeft--;
  const [x, y] = siteFor(g, d);
  h.biz.push({ id, level: 1, since: year(g), spent: price, x, y });
  if (id === "store_chain") bump(g, "labour", -2);
  if (id === "water_co") bump(g, "reputation", 2);
  log(g, `${c.name} buys a ${d.name.toLowerCase()}.`);
  c.biz.record.push(`${cal(g).season} ${year(g)}: bought a ${d.name.toLowerCase()}`);
  return { ok: true, text: `You own a ${d.name.toLowerCase()}.` };
}

export function upgradeBlocked(g: GameState, b: OwnedBiz): string | null {
  const c = g.company!;
  if (b.level >= 3) return "As big as it gets";
  if (c.biz.actionsLeft <= 0) return "No actions left this season";
  const p = bizPrice(g, bizDef(b.id), b.level + 1);
  return c.cash < p ? `Needs $${p.toLocaleString("en-US")}` : null;
}
export function upgradeBiz(g: GameState, id: string): { ok: boolean; text: string } {
  const h = holdingsOf(g), b = h.biz.find((x) => x.id === id);
  if (!b) return { ok: false, text: "You don't own it" };
  const why = upgradeBlocked(g, b);
  if (why) return { ok: false, text: why };
  const p = bizPrice(g, bizDef(id), b.level + 1);
  g.company!.cash -= p; g.company!.biz.actionsLeft--; b.level++; b.spent += p;
  return { ok: true, text: `${bizDef(id).name} enlarged (level ${b.level}).` };
}
/** what a business fetches: six years of its income, and at least a third of what it cost */
export const sellValue = (g: GameState, b: OwnedBiz) => Math.round(Math.max(b.spent * 0.33, bizIncome(g, bizDef(b.id), b.level) * 24) / 1000) * 1000;
export function sellBiz(g: GameState, id: string): { ok: boolean; text: string } {
  const h = holdingsOf(g), k = h.biz.findIndex((x) => x.id === id);
  if (k < 0) return { ok: false, text: "You don't own it" };
  const b = h.biz[k];
  const got = sellValue(g, b);
  g.company!.cash += got;
  h.biz.splice(k, 1);
  log(g, `${g.company!.name} sells its ${bizDef(id).name.toLowerCase()}.`);
  return { ok: true, text: `Sold for $${got.toLocaleString("en-US")}.` };
}

/** what the businesses you own do for your works */
export function inputMult(g: GameState, good: Good, ind: IndustryId): number {
  const h = g.company?.holdings;
  if (!h) return 1;
  let m = 1;
  for (const b of h.biz) { const d = bizDef(b.id); const v = d.input?.[good]; if (v && (!d.forInd || d.forInd.includes(ind))) m *= v; }
  return m;
}
export function freightMult(g: GameState, mode: "river" | "rail"): number {
  const h = g.company?.holdings;
  if (!h) return 1;
  let m = 1;
  for (const b of h.biz) m *= bizDef(b.id).freight?.[mode] ?? 1;
  return m;
}
export function upkeepMult(g: GameState): number {
  const h = g.company?.holdings;
  if (!h) return 1;
  let m = 1;
  for (const b of h.biz) m *= bizDef(b.id).upkeep ?? 1;
  return m;
}

// ---------------------------------------------------------------- stakes in the rival works
const rivalName = (g: GameState, id: string) => { const d = RIVALS.find((r) => r.id === id)!; const st = g.rivals.find((r) => r.id === id); return nameNow(d, year(g), st?.name, st?.nameYear).replace(/ \((.*)\)$/, " — $1"); };
/** what the whole works is worth on the market (about two years' sales) */
// rivals' value and profit live in value.ts (earnings-based, from the simulated market)
export { rivalProfit, rivalValue } from "./value";
export const stakePrice = (g: GameState, id: string) => Math.round((rivalValue(g, id) * 0.1 * (g.rivals.find((r) => r.id === id)?.defence ?? 1)) / 1000) * 1000;
export function stakeBlocked(g: GameState, id: string): string | null {
  const c = g.company;
  if (!c) return "Found your company first";
  if (year(g) < 1865) return "From 1865 (the joint-stock companies)";
  if ((holdingsOf(g).stakes[id] ?? 0) >= 50) return "You hold half: buy the rest or stop here";
  // the Clayton Act (1914): no buying up a competitor's stock — unless Washington looks the other way
  if (clayton(g, id) && (holdingsOf(g).stakes[id] ?? 0) >= 10) return "The Clayton Act forbids buying more of a competitor (from 1914)";
  if (!rivalValue(g, id)) return "Not open";
  if (c.biz.actionsLeft <= 0) return "No actions left this season";
  if (holdingsOf(g).stakeYear?.[id] === year(g)) return "One purchase a year: their owners are watching";
  if (c.cash < stakePrice(g, id)) return `Needs $${stakePrice(g, id).toLocaleString("en-US")}`;
  return null;
}
export function buyStake(g: GameState, id: string): { ok: boolean; text: string } {
  const why = stakeBlocked(g, id);
  if (why) return { ok: false, text: why };
  const c = g.company!, h = holdingsOf(g), p = stakePrice(g, id);
  c.cash -= p; c.biz.actionsLeft--;
  h.stakes[id] = (h.stakes[id] ?? 0) + 10;
  h.stakeCost[id] = (h.stakeCost[id] ?? 0) + p;
  (h.stakeYear ??= {})[id] = year(g);
  recordMove(g, "stake", id);
  const pct = h.stakes[id];
  log(g, `${c.name} now holds ${pct}% of ${rivalName(g, id)}.`);
  return { ok: true, text: `${pct}% of ${rivalName(g, id)}${pct === 20 ? ": its owners won't move against you now" : pct === 50 ? ": a controlling stake" : ""}.` };
}
export function sellStake(g: GameState, id: string): { ok: boolean; text: string } {
  const h = holdingsOf(g), pct = h.stakes[id] ?? 0;
  if (!pct) return { ok: false, text: "You hold none" };
  const p = Math.round((stakePrice(g, id) * 0.95) / 1000) * 1000;
  g.company!.cash += p;
  h.stakeCost[id] = Math.round((h.stakeCost[id] ?? 0) * ((pct - 10) / pct));
  h.stakes[id] = pct - 10;
  if (!h.stakes[id]) { delete h.stakes[id]; delete h.stakeCost[id]; }
  return { ok: true, text: `Sold 10% for $${p.toLocaleString("en-US")}.` };
}
/** with a controlling stake: buy the rest and run it as one of your works */
export function takeoverPrice(g: GameState, id: string): { price: number } | { refused: string } {
  const r = g.rivals.find((x) => x.id === id);
  if (!r) return { refused: "Not open" };
  const pct = holdingsOf(g).stakes[id] ?? 0;
  if (pct < 50) return { refused: "Needs a 50% stake" };
  const q = acquisitionQuote(g, r);
  if ("refused" in q) return q;
  return { price: Math.round((q.price * (1 - pct / 100)) / 1000) * 1000 };
}
export function takeover(g: GameState, id: string): { ok: boolean; text: string } {
  const q = takeoverPrice(g, id), c = g.company!;
  if ("refused" in q) return { ok: false, text: q.refused };
  if (c.cash < q.price) return { ok: false, text: `Needs $${q.price.toLocaleString("en-US")}` };
  if (c.biz.actionsLeft <= 0) return { ok: false, text: "No actions left this season" };
  const r = g.rivals.find((x) => x.id === id)!;
  c.cash -= q.price; c.biz.actionsLeft--;
  const name = rivalName(g, id);
  const w = acquire(g, r);
  const h = holdingsOf(g);
  w.paid = q.price + (h.stakeCost[id] ?? 0);
  delete h.stakes[id]; delete h.stakeCost[id];
  log(g, `${c.name} buys out the other owners of ${name}.`);
  return { ok: true, text: `${w.name} is one of your works now.` };
}
/** the Clayton Act applies: a competitor's stock, from 1914, unless a business-minded Washington won't enforce it */
export function clayton(g: GameState, id: string): boolean {
  if (year(g) < 1914 || !g.company) return false;
  if ((g.pol?.balance.federal ?? 0) < -30) return false;
  return relationTo(g, id) === "competitor";
}
/** at 20% or more a rival's owners won't move against you */
export const friendly = (g: GameState, id: string) => (g.company?.holdings?.stakes[id] ?? 0) >= 20;
export const relationTo = (g: GameState, id: string) => { const d = RIVALS.find((r) => r.id === id)!; return g.company ? relationOf(g.company.industry, d.industry, id) : "other"; };

// ---------------------------------------------------------------- shares in the region's companies
export interface Listed {
  id: string; name: string; from: number; until?: number;
  /** price per share by year, before the market's moods and the company's own fortunes */
  path: [number, number][]; note: string; payout?: number;
  /** the rival works whose simulated profit moves the price (v0.18.2) */
  rivals?: string[];
}
export const LISTED: Listed[] = [
  { id: "heinz", name: "H. J. Heinz Co.", from: 1888, path: [[1888, 20], [1929, 90], [1950, 140], [1985, 320]], note: "Pickles and ketchup: steady through every panic." },
  { id: "wab", name: "Westinghouse Air Brake", from: 1869, path: [[1869, 20], [1900, 70], [1930, 110], [1968, 160]], until: 1968, payout: 1.2, note: "Air brakes on every train. Bought by American Standard in 1968, at a premium." },
  { id: "wec", name: "Westinghouse Electric", from: 1886, rivals: ["westinghouse", "wresearch", "bettis", "astro"], path: [[1886, 30], [1906, 110], [1908, 40], [1929, 190], [1964, 260], [1975, 120], [1985, 210]], note: "Alternating current, radio, turbines, reactors: big swings." },
  { id: "ppg", name: "Pittsburgh Plate Glass", from: 1883, rivals: ["ppg"], path: [[1883, 25], [1900, 90], [1929, 150], [1968, 260], [1985, 330]], note: "Plate glass and paint." },
  { id: "alcoa", name: "Aluminum Co. of America", from: 1888, rivals: ["alcoa"], path: [[1888, 10], [1907, 60], [1929, 260], [1945, 300], [1985, 520]], note: "From $5 a pound to pots and pans and airplanes: the great grower." },
  { id: "gulf", name: "Gulf Oil", from: 1901, until: 1984, payout: 1.6, path: [[1901, 20], [1929, 160], [1960, 380], [1975, 300], [1984, 420]], note: "The Mellons' oil company. Bought by Chevron in 1984 at a big premium." },
  { id: "uss", name: "U.S. Steel", from: 1901, rivals: ["carnegie", "ussduq", "clairton", "ntube", "carrie"], path: [[1901, 50], [1916, 120], [1929, 250], [1950, 200], [1960, 180], [1985, 60]], note: "The first billion-dollar company, and the long decline." },
  { id: "mellon", name: "Mellon National Bank", from: 1869, path: [[1869, 20], [1902, 120], [1929, 300], [1950, 320], [1985, 420]], note: "The bank behind half the valley." },
  { id: "jl", name: "Jones & Laughlin Steel", from: 1902, until: 1968, payout: 1.3, rivals: ["jl"], path: [[1902, 40], [1916, 90], [1929, 120], [1932, 15], [1950, 60], [1968, 70]], note: "The independent steelmaker on both banks; bought by LTV in 1968, at a premium." },
  { id: "mesta", name: "Mesta Machine", from: 1920, until: 1983, payout: 0.02, rivals: ["mesta"], path: [[1920, 30], [1929, 70], [1950, 60], [1970, 40], [1980, 12], [1983, 1]], note: "Rolling mills and presses for the steel industry: as good as the mills' orders. Bankrupt in 1983." },
  { id: "koppers", name: "Koppers Company", from: 1929, rivals: ["koppers"], path: [[1929, 40], [1932, 10], [1950, 50], [1970, 70], [1985, 90]], note: "Coke ovens, tar, chemicals and wood treating." },
  { id: "dravo", name: "Dravo Corporation", from: 1930, rivals: ["dravo"], path: [[1930, 15], [1945, 40], [1960, 35], [1980, 40], [1985, 18]], note: "Barges, towboats, river contracting; the LST yard in the war." },
];
/** the market's mood: panics, booms, the Crash and the long climb back */
const MARKET: [number, number][] = [[1850, 1], [1857, 1], [1858, 0.75], [1861, 1], [1866, 1.15], [1873, 1.1], [1874, 0.75], [1879, 1], [1893, 1.05], [1894, 0.75], [1899, 1.1], [1906, 1.15], [1907, 0.8], [1912, 1], [1920, 1], [1921, 0.8], [1929, 1.6], [1932, 0.35], [1937, 0.7], [1942, 0.5], [1950, 0.8], [1966, 1.1], [1973, 1], [1974, 0.65], [1982, 0.7], [1985, 1]];

/** the market's own state (v0.18.2): each company's fortunes and noise, and this game's depth of the crashes */
export interface StockState {
  perf: Record<string, number>; noise: Record<string, number>; impact: Record<string, number>; crash: number; price: Record<string, number>; turn: number;
  /** a company's own trouble — a scandal, a strike, an antitrust suit, a bad bet — as a price multiplier that heals over the years (v0.21) */
  shock?: Record<string, number>;
  /** the headline of the trouble, for the log */
  shockNote?: Record<string, string>;
}

const stockOf = (g: GameState): StockState => (g.stock ??= { perf: {}, noise: {}, impact: {}, crash: 0.75 + ((g.seed * 7919) % 1000) / 1000 * 0.6, price: {}, turn: -1 });

/** the troubles a listed company can fall into (one in a decade, roughly), with the price cut each brings */
const SHOCKS: [string, number][] = [["a strike at its works", 0.25], ["an antitrust suit", 0.3], ["a scandal in the boardroom", 0.3], ["a bad bet abroad", 0.35], ["a fire at its main plant", 0.2], ["a founder's death and a fight over the estate", 0.3], ["an accounting fraud", 0.45]];

/** the price a share would have from history alone (trend × the market's mood, this game's depth of the crashes) */
function basePrice(g: GameState, L: Listed, y: number): number {
  const mood = lerpCurve(MARKET, y), crash = stockOf(g).crash;
  let p = lerpCurve(L.path, y);
  // a buy-out at a premium is talked about for years before it comes: the price climbs toward the payout over
  // the last five, so the premium isn't free money for anyone who read the history (v0.21)
  if (L.until && L.payout && L.payout > 1 && y > L.until - 5) {
    const end = lerpCurve(L.path, L.until) * L.payout, f = Math.min(1, (y - (L.until - 5)) / 5);
    p = p + (end - p) * f * 0.8;
  }
  return p * (1 + (mood - 1) * (mood < 1 ? crash : 1));
}

/** how the company's works are doing against a normal year (their simulated profit), smoothed */
function fortunes(g: GameState, L: Listed): number {
  if (!L.rivals?.length) return 1;
  let now = 0, normal = 0;
  for (const id of L.rivals) {
    const r = g.rivals.find((x) => x.id === id), d = RIVALS.find((x) => x.id === id);
    if (!r || !d || !r.active || r.closed) continue;
    now += rivalProfit(g, id);
    normal += Math.max(1, rivalNominal(g, r) * INDUSTRIES_PRICE(d.industry, year(g)) * 0.12);
  }
  return normal ? Math.max(0.35, Math.min(1.8, 0.4 + 0.6 * (now / normal))) : 1;
}

/** each season: the market moves (the company's fortunes, a random walk, the buying you did) */
export function updateStocks(g: GameState) {
  const S = stockOf(g), c = cal(g), y = c.year + (["Spring", "Summer", "Autumn", "Winter"].indexOf(c.season)) / 4;
  if (S.turn === g.turn) return;
  S.turn = g.turn;
  const rng = new Rng(`${g.seed}:stocks:${g.turn}`);
  for (const L of LISTED) {
    if (y < L.from) continue;
    S.perf[L.id] = (S.perf[L.id] ?? 1) + (fortunes(g, L) - (S.perf[L.id] ?? 1)) * 0.3;
    // a random walk that drifts back to history: moderate (about ±25% at most, most of the time)
    const shock = (rng.next() + rng.next() + rng.next() - 1.5) * 0.09;
    S.noise[L.id] = (S.noise[L.id] ?? 0) * 0.9 + shock;
    S.impact[L.id] = (S.impact[L.id] ?? 0) * 0.5;
    // the company's own troubles: about one a decade, cutting the price a fifth to a half and healing over ~5 years
    S.shock ??= {}; S.shockNote ??= {};
    const sh = S.shock[L.id] ?? 1;
    S.shock[L.id] = 1 - (1 - sh) * 0.965;
    if (c.season === "Spring" && sh > 0.9 && rng.chance(0.1)) {
      const [what, cut] = SHOCKS[rng.int(0, SHOCKS.length - 1)];
      S.shock[L.id] = 1 - cut;
      S.shockNote[L.id] = what;
      if (g.company?.holdings?.shares[L.id]) log(g, `${L.name} shares fall ${Math.round(cut * 100)}% on ${what}.`);
    }
    S.price[L.id] = Math.round(basePrice(g, L, y) * S.perf[L.id] * Math.exp(S.noise[L.id]) * (1 + S.impact[L.id]) * S.shock[L.id] * 100) / 100;
  }
}

/** the market's mood this year (1 is normal; under 0.85 is a slump, when boards cut their dividends) */
export const marketMood = (y: number) => lerpCurve(MARKET, y);
/** lots of one company the brokers can still find this decade (v0.21: a family firm can't buy a bank) */
export const decadeCap = (y: number) => Math.round(6 * priceLevel(y));
export const decadeKey = (y: number, id: string) => `${Math.floor(y / 10) * 10}:${id}`;
export const lotsLeft = (g: GameState, id: string) => Math.max(0, decadeCap(year(g)) - (holdingsOf(g).shareDecade?.[decadeKey(year(g), id)] ?? 0));

export function sharePrice(g: GameState, id: string): number {
  const L = LISTED.find((l) => l.id === id)!;
  const c = cal(g), y = c.year + (["Spring", "Summer", "Autumn", "Winter"].indexOf(c.season)) / 4;
  if (y < L.from) return 0;
  const S = stockOf(g);
  return S.price[id] ?? Math.round(basePrice(g, L, y) * 100) / 100;
}

/** the trend price of a unit of an industry's output (for the companies' normal profit) */
const INDUSTRIES_PRICE = (ind: IndustryId, y: number) => INDUSTRY_DEFS[ind].basePrice * (1 + (y - 1850) * PRICE_TREND);
export const listedOpen = (g: GameState, L: Listed) => year(g) >= L.from && !(L.until && year(g) >= L.until);
export const LOT = 100;
/** the most lots one purchase can find sellers for: more as the market grows (v0.18.2) */
export const maxLots = (y: number) => Math.round(6 * priceLevel(y));
/** buying on margin (the call-loan market, 1920 until the Securities Exchange Act of 1934): 10% down */
export const marginOpen = (y: number) => y >= 1920 && y < 1934;
export const MARGIN_RATE = 0.015; // a season (about 6% a year)
export const marginDebt = (g: GameState) => Object.values(g.company?.holdings?.margin ?? {}).reduce((s, v) => s + v, 0);
/** tax on the gain when shares are sold or bought out (from 1913) */
export const capitalGainsRate = (y: number) => (y < 1913 ? 0 : y < 1922 ? 0.1 : y < 1934 ? 0.125 : y < 1942 ? 0.3 : y < 1979 ? 0.25 : 0.28);
function gainsTax(g: GameState, id: string, value: number): number {
  const h = holdingsOf(g), gain = value - (h.shareCost[id] ?? 0);
  return gain > 0 ? Math.round(gain * capitalGainsRate(year(g))) : 0;
}
export function buyShares(g: GameState, id: string, lots = 1, onMargin = false): { ok: boolean; text: string } {
  const c = g.company;
  if (!c) return { ok: false, text: "Found your company first" };
  const L = LISTED.find((l) => l.id === id)!;
  if (!listedOpen(g, L)) return { ok: false, text: "Not listed" };
  const y = year(g);
  const left = lotsLeft(g, id);
  if (left <= 0) return { ok: false, text: `The brokers can find no more ${L.name} this decade: the family already holds what the market will sell it` };
  lots = Math.max(1, Math.min(maxLots(y), left, lots));
  // a big order pushes the price up as the brokers find sellers (about 1% a lot)
  const p = sharePrice(g, id), cost = Math.round(p * LOT * lots * (1 + 0.005 * (lots - 1)));
  const margin = onMargin && marginOpen(y);
  const down = margin ? Math.round(cost * 0.1) : cost;
  if (c.cash < down) return { ok: false, text: `Needs $${down.toLocaleString("en-US")}` };
  const h = holdingsOf(g);
  if (h.shareYear?.[id] === y) return { ok: false, text: "One order a year in each company: the brokers can only find so many sellers" };
  (h.shareYear ??= {})[id] = y;
  (h.shareDecade ??= {})[decadeKey(y, id)] = (h.shareDecade[decadeKey(y, id)] ?? 0) + lots;
  c.cash -= down;
  if (margin) (h.margin ??= {})[id] = (h.margin[id] ?? 0) + (cost - down);
  h.shares[id] = (h.shares[id] ?? 0) + LOT * lots;
  h.shareCost[id] = (h.shareCost[id] ?? 0) + cost;
  const S = stockOf(g);
  S.impact[id] = (S.impact[id] ?? 0) + 0.01 * lots;
  if (S.price[id]) S.price[id] = Math.round(S.price[id] * (1 + 0.005 * lots) * 100) / 100;
  return { ok: true, text: `Bought ${(LOT * lots).toLocaleString("en-US")} shares of ${L.name}${margin ? ` on margin ($${down.toLocaleString("en-US")} down, $${(cost - down).toLocaleString("en-US")} borrowed)` : ""}.` };
}
export function sellShares(g: GameState, id: string): { ok: boolean; text: string } {
  const h = holdingsOf(g), n = h.shares[id] ?? 0;
  if (!n) return { ok: false, text: "You hold none" };
  const v = Math.round(n * sharePrice(g, id)), tax = gainsTax(g, id, v), loan = Math.round(h.margin?.[id] ?? 0);
  g.company!.cash += v - tax - loan;
  delete h.shares[id]; delete h.shareCost[id]; if (h.margin) delete h.margin[id];
  return { ok: true, text: `Sold for $${v.toLocaleString("en-US")}${loan ? `, $${loan.toLocaleString("en-US")} of it to the broker's loan` : ""}${tax ? ` ($${tax.toLocaleString("en-US")} tax on the gain)` : ""}.` };
}

// ---------------------------------------------------------------- the season
/** Income from everything you hold, paid into the company's cash. Returns the total. */
export function holdingsSeason(g: GameState): number {
  const c = g.company;
  if (!c?.holdings) return 0;
  const h = c.holdings, y = year(g);
  let biz = 0, stakes = 0, dividends = 0;
  // businesses (the electric companies are bought out in 1903)
  for (const b of [...h.biz]) {
    const d = bizDef(b.id);
    if (d.until && y >= d.until) {
      const pay = Math.round(b.spent * 1.5);
      c.cash += pay;
      h.biz = h.biz.filter((x) => x !== b);
      log(g, `${d.name === "Electric light company" ? "Duquesne Light" : "A buyer"} buys out your ${d.name.toLowerCase()} for $${pay.toLocaleString("en-US")}.`);
      continue;
    }
    biz += bizIncome(g, d, b.level);
  }
  // stakes: a share of their profit; a closed works takes the stake with it
  // the trust-busters: under a reform Washington, stakes over 10% in a competitor are ordered sold, a tenth a year
  if (cal(g).season === "Spring") for (const [id, pct] of Object.entries(h.stakes)) if (pct > 10 && clayton(g, id) && (g.pol?.balance.federal ?? 0) > 0) {
    sellStake(g, id);
    log(g, `The Federal Trade Commission orders ${c.name} to sell part of its stake in ${rivalName(g, id)} (Clayton Act).`);
  }
  for (const [id, pct] of Object.entries(h.stakes)) {
    const r = g.rivals.find((x) => x.id === id);
    if (!r || r.closed || !r.active) {
      log(g, `${rivalName(g, id)} has closed: your ${pct}% stake is worth nothing.`);
      delete h.stakes[id]; delete h.stakeCost[id];
      continue;
    }
    // a minority holder gets the dividend: about half the earnings (the rest goes back into the works)
    stakes += Math.max(0, rivalProfit(g, id)) * 0.5 * (pct / 100);
  }
  // dividends: about 5% a year of the share price; companies bought out pay out at a premium
  for (const [id, n] of Object.entries(h.shares)) {
    const L = LISTED.find((l) => l.id === id)!;
    if (L.until && y >= L.until) {
      const pay = Math.round(n * lerpCurve(L.path, L.until) * (L.payout ?? 1));
      c.cash += pay - gainsTax(g, id, pay);
      delete h.shares[id]; delete h.shareCost[id];
      log(g, `${L.name} is bought out: your ${n.toLocaleString("en-US")} shares are paid $${pay.toLocaleString("en-US")}.`);
      continue;
    }
    // about 3.6% a year in a normal year; the board cuts it with the company's fortunes and suspends it in a slump
    // (dividends vanished in 1893, 1907 and the Depression) or while the company is in trouble
    const S = stockOf(g), perf = S.perf[id] ?? 1, mood = marketMood(y), shock = S.shock?.[id] ?? 1;
    const rate = mood < 0.85 || shock < 0.8 ? 0 : 0.009 * Math.max(0, Math.min(1.3, (perf - 0.4) / 0.6));
    dividends += n * sharePrice(g, id) * rate;
  }
  // the broker's loans: interest, and a call when the shares no longer cover them (equity under a quarter)
  let interest = 0;
  for (const [id, loan] of Object.entries(h.margin ?? {})) {
    if (!loan) continue;
    interest += loan * MARGIN_RATE;
    const value = (h.shares[id] ?? 0) * sharePrice(g, id);
    if (value < loan * 1.33) {
      const L = LISTED.find((l) => l.id === id)!;
      const r = sellShares(g, id);
      log(g, `Margin call on ${L.name}: the broker sells you out. ${r.text}`);
      if (!c.biz.flags[`marginCall${y}`]) { c.biz.flags[`marginCall${y}`] = true; g.headlines.push({ year: y, season: cal(g).season, name: `Margin Call for ${c.name}`, description: `The broker's loan on ${L.name} no longer covered: the shares are sold at the bottom, and the loan paid from the company's cash.`, category: "Industry" }); }
    }
  }
  dividends -= interest;
  h.last = { biz: Math.round(biz), stakes: Math.round(stakes), dividends: Math.round(dividends) };
  const total = Math.round(biz + stakes + dividends);
  c.cash += total;
  return total;
}

/** what all the holdings are worth now (businesses at what they'd sell for) */
export function holdingsValue(g: GameState): { biz: number; stakes: number; shares: number } {
  const h = g.company?.holdings;
  if (!h) return { biz: 0, stakes: 0, shares: 0 };
  return {
    biz: h.biz.reduce((s, b) => s + sellValue(g, b), 0),
    stakes: Object.entries(h.stakes).reduce((s, [id, pct]) => s + (rivalValue(g, id) * pct) / 100, 0),
    shares: Object.entries(h.shares).reduce((s, [id, n]) => s + n * sharePrice(g, id), 0),
  };
}

export { allWorks, rivalName as stakeName };

/** the whole concern's net worth (works, holdings, cash, less debts and margin loans) */
export function companyWorth(g: GameState) {
  const v = holdingsValue(g);
  return netWorth(g, v.biz + v.stakes + v.shares, marginDebt(g));
}
