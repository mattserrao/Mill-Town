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
import { allWorks, cal, type GameState, log, PRICE_TREND, rivalOutput } from "./game";
import { INDUSTRIES, type Good, type IndustryId } from "./industries";
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
export const bizIncome = (g: GameState, d: BizDef, level: number) => Math.round(d.income * priceLevel(year(g)) * lerpCurve(d.curve, year(g)) * (1 + 0.7 * (level - 1)));

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
export const sellValue = (b: OwnedBiz) => Math.round((b.spent * 0.7) / 1000) * 1000;
export function sellBiz(g: GameState, id: string): { ok: boolean; text: string } {
  const h = holdingsOf(g), k = h.biz.findIndex((x) => x.id === id);
  if (k < 0) return { ok: false, text: "You don't own it" };
  const b = h.biz[k];
  g.company!.cash += sellValue(b);
  h.biz.splice(k, 1);
  log(g, `${g.company!.name} sells its ${bizDef(id).name.toLowerCase()}.`);
  return { ok: true, text: `Sold for $${sellValue(b).toLocaleString("en-US")}.` };
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
export function rivalValue(g: GameState, id: string): number {
  const r = g.rivals.find((x) => x.id === id);
  const d = RIVALS.find((x) => x.id === id);
  if (!r || !d || !r.active || r.closed || r.owned) return 0;
  const ind = INDUSTRIES[d.industry], y = year(g);
  const out = Math.max(rivalOutput(g, r), ind.baseCapacity * 0.3);
  return out * ind.basePrice * (1 + (y - 1850) * PRICE_TREND) * 8 * (y >= 1975 ? 0.4 : 1);
}
/** their profit per season (a steady 12% of sales), of which you get your share */
export const rivalProfit = (g: GameState, id: string) => {
  const r = g.rivals.find((x) => x.id === id), d = RIVALS.find((x) => x.id === id);
  if (!r || !d || !r.active || r.closed || r.owned) return 0;
  const ind = INDUSTRIES[d.industry];
  return rivalOutput(g, r) * ind.basePrice * (1 + (year(g) - 1850) * PRICE_TREND) * 0.05;
};
export const stakePrice = (g: GameState, id: string) => Math.round((rivalValue(g, id) * 0.1 * (g.rivals.find((r) => r.id === id)?.defence ?? 1)) / 1000) * 1000;
export function stakeBlocked(g: GameState, id: string): string | null {
  const c = g.company;
  if (!c) return "Found your company first";
  if (year(g) < 1865) return "From 1865 (the joint-stock companies)";
  if ((holdingsOf(g).stakes[id] ?? 0) >= 50) return "You hold half: buy the rest or stop here";
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
  delete h.stakes[id]; delete h.stakeCost[id];
  log(g, `${c.name} buys out the other owners of ${name}.`);
  return { ok: true, text: `${w.name} is one of your works now.` };
}
/** at 20% or more a rival's owners won't move against you */
export const friendly = (g: GameState, id: string) => (g.company?.holdings?.stakes[id] ?? 0) >= 20;
export const relationTo = (g: GameState, id: string) => { const d = RIVALS.find((r) => r.id === id)!; return g.company ? relationOf(g.company.industry, d.industry, id) : "other"; };

// ---------------------------------------------------------------- shares in the region's companies
export interface Listed { id: string; name: string; from: number; until?: number; /** price per share by year, before the market's moods */ path: [number, number][]; note: string; payout?: number }
export const LISTED: Listed[] = [
  { id: "heinz", name: "H. J. Heinz Co.", from: 1888, path: [[1888, 20], [1929, 90], [1950, 140], [1985, 320]], note: "Pickles and ketchup: steady through every panic." },
  { id: "wab", name: "Westinghouse Air Brake", from: 1869, path: [[1869, 20], [1900, 70], [1930, 110], [1968, 160]], until: 1968, payout: 1.2, note: "Air brakes on every train. Bought by American Standard in 1968, at a premium." },
  { id: "wec", name: "Westinghouse Electric", from: 1886, path: [[1886, 30], [1906, 110], [1908, 40], [1929, 190], [1964, 260], [1975, 120], [1985, 210]], note: "Alternating current, radio, turbines, reactors: big swings." },
  { id: "ppg", name: "Pittsburgh Plate Glass", from: 1883, path: [[1883, 25], [1900, 90], [1929, 150], [1968, 260], [1985, 330]], note: "Plate glass and paint." },
  { id: "alcoa", name: "Aluminum Co. of America", from: 1888, path: [[1888, 10], [1907, 60], [1929, 260], [1945, 300], [1985, 520]], note: "From $5 a pound to pots and pans and airplanes: the great grower." },
  { id: "gulf", name: "Gulf Oil", from: 1901, until: 1984, payout: 1.6, path: [[1901, 20], [1929, 160], [1960, 380], [1975, 300], [1984, 420]], note: "The Mellons' oil company. Bought by Chevron in 1984 at a big premium." },
  { id: "uss", name: "U.S. Steel", from: 1901, path: [[1901, 50], [1916, 120], [1929, 250], [1950, 200], [1960, 180], [1985, 60]], note: "The first billion-dollar company, and the long decline." },
  { id: "mellon", name: "Mellon National Bank", from: 1869, path: [[1869, 20], [1902, 120], [1929, 300], [1950, 320], [1985, 420]], note: "The bank behind half the valley." },
];
/** the market's mood: panics, booms, the Crash and the long climb back */
const MARKET: [number, number][] = [[1850, 1], [1857, 1], [1858, 0.75], [1861, 1], [1866, 1.15], [1873, 1.1], [1874, 0.75], [1879, 1], [1893, 1.05], [1894, 0.75], [1899, 1.1], [1906, 1.15], [1907, 0.8], [1912, 1], [1920, 1], [1921, 0.8], [1929, 1.6], [1932, 0.35], [1937, 0.7], [1942, 0.5], [1950, 0.8], [1966, 1.1], [1973, 1], [1974, 0.65], [1982, 0.7], [1985, 1]];

export function sharePrice(g: GameState, id: string): number {
  const L = LISTED.find((l) => l.id === id)!;
  const c = cal(g), y = c.year + (["Spring", "Summer", "Autumn", "Winter"].indexOf(c.season)) / 4;
  if (y < L.from) return 0;
  const base = lerpCurve(L.path, y), mood = lerpCurve(MARKET, y);
  return Math.round(base * mood * priceLevel(1850) * 100) / 100;
}
export const listedOpen = (g: GameState, L: Listed) => year(g) >= L.from && !(L.until && year(g) >= L.until);
export const LOT = 100;
/** the most lots one purchase can find sellers for */
export const MAX_LOTS = 10;
export function buyShares(g: GameState, id: string, lots = 1): { ok: boolean; text: string } {
  const c = g.company;
  if (!c) return { ok: false, text: "Found your company first" };
  const L = LISTED.find((l) => l.id === id)!;
  if (!listedOpen(g, L)) return { ok: false, text: "Not listed" };
  lots = Math.max(1, Math.min(MAX_LOTS, lots));
  const cost = Math.round(sharePrice(g, id) * LOT * lots);
  if (c.cash < cost) return { ok: false, text: `Needs $${cost.toLocaleString("en-US")}` };
  const h = holdingsOf(g);
  if (h.shareYear?.[id] === year(g)) return { ok: false, text: "One purchase a year in each company: the brokers can only find so many sellers" };
  if (c.biz.actionsLeft <= 0) return { ok: false, text: "No actions left this season" };
  c.cash -= cost; c.biz.actionsLeft--;
  (h.shareYear ??= {})[id] = year(g);
  h.shares[id] = (h.shares[id] ?? 0) + LOT * lots;
  h.shareCost[id] = (h.shareCost[id] ?? 0) + cost;
  return { ok: true, text: `Bought ${LOT * lots} shares of ${L.name}.` };
}
export function sellShares(g: GameState, id: string): { ok: boolean; text: string } {
  const h = holdingsOf(g), n = h.shares[id] ?? 0;
  if (!n) return { ok: false, text: "You hold none" };
  const v = Math.round(n * sharePrice(g, id));
  g.company!.cash += v;
  delete h.shares[id]; delete h.shareCost[id];
  return { ok: true, text: `Sold for $${v.toLocaleString("en-US")}.` };
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
  for (const [id, pct] of Object.entries(h.stakes)) {
    const r = g.rivals.find((x) => x.id === id);
    if (!r || r.closed || !r.active) {
      log(g, `${rivalName(g, id)} has closed: your ${pct}% stake is worth nothing.`);
      delete h.stakes[id]; delete h.stakeCost[id];
      continue;
    }
    stakes += rivalProfit(g, id) * (pct / 100);
  }
  // dividends: about 5% a year of the share price; companies bought out pay out at a premium
  for (const [id, n] of Object.entries(h.shares)) {
    const L = LISTED.find((l) => l.id === id)!;
    if (L.until && y >= L.until) {
      const pay = Math.round(n * lerpCurve(L.path, L.until) * (L.payout ?? 1));
      c.cash += pay;
      delete h.shares[id]; delete h.shareCost[id];
      log(g, `${L.name} is bought out: your ${n.toLocaleString("en-US")} shares are paid $${pay.toLocaleString("en-US")}.`);
      continue;
    }
    dividends += n * sharePrice(g, id) * 0.0075;
  }
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
    biz: h.biz.reduce((s, b) => s + sellValue(b), 0),
    stakes: Object.entries(h.stakes).reduce((s, [id, pct]) => s + (rivalValue(g, id) * pct) / 100, 0),
    shares: Object.entries(h.shares).reduce((s, [id, n]) => s + n * sharePrice(g, id), 0),
  };
}

export { allWorks, rivalName as stakeName };
