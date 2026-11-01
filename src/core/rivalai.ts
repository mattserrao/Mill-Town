// The rivals make moves each season, by personality, from the same book of actions you have:
//
//   Carnegie (aggressive)   cuts prices to take your customers, hires away your best men, builds and builds
//   Frick (integrator)      corners the Connellsville coke, breaks strikes with Pinkertons
//   Mellon (financier)      lends to whoever is short (you, if you are), finances the others' expansions
//   Westinghouse (innovator) adopts every new process first, sues over patents
//   J&L, PPG, Dravo (steady) expand when times are good
//
// And your moves against them: undercut, poach, rumours, espionage, sabotage — and buying their works outright.

import { type ActionDef, bump, pushHeadline } from "./business";
import { allWorks, cal, PRICE_TREND, type Company, type GameState, log, nextWorksId, type RivalState, techsForYear, updateWorksAccess, type Works } from "./game";
import { INDUSTRIES, type IndustryId } from "./industries";
import { rivalMult, rivalTechs } from "./market";
import { nameNow, RIVALS, type RivalDef } from "./rivals";
import type { Rng } from "./rng";
import { priceLevel } from "./time";

const era = priceLevel;
const defOf = (r: RivalState) => RIVALS.find((d) => d.id === r.id)!;
export const rivalName = (d: RivalDef, year?: number) => (year ? nameNow(d, year) : d.company).replace(/ \(.*\)$/, "");
const year = (g: GameState) => cal(g).year;
const myIndustries = (c?: Company): IndustryId[] => (c ? [...new Set(allWorks(c).map((w) => w.industry))] : []);

function damage(g: GameState, r: RivalState, mult: number, seasons: number, why: string) {
  r.damage.push({ mult, until: g.turn + seasons, why });
}

/** Each rival's move this season (most seasons most of them just work). */
export function rivalSeason(g: GameState, rng: Rng) {
  const c = g.company, y = year(g);
  for (const r of g.rivals) {
    r.damage = r.damage.filter((d) => d.until > g.turn);
    if (!r.active || r.owned || r.closed) continue;
    const def = defOf(r), name = rivalName(def, y);
    const rivalOfYours = !!c && myIndustries(c).includes(def.industry);
    // a grudge is paid back first: arson for arson
    if (c && r.grudge >= 2 && rng.chance(0.25)) {
      r.grudge--;
      g.mods.push({ kind: "output", mult: 0.6, until: g.turn + 1, source: `Fire set at your works (${name})`, industry: [def.industry] });
      bump(g, "labour", -3);
      pushHeadline(g, `Fire at ${c.name}`, `A fire breaks out in the stockhouse at ${c.name}. The company blames "outside agitators"; the men whisper the name ${def.figures[0]}.`);
      r.lastMove = `${y}: paid you back with a fire at your works`;
      continue;
    }
    if (!rng.chance(0.07 + (r.grudge > 0 ? 0.1 : 0))) continue;
    let move = "";
    // you hold a fifth or more of it: its owners grow their works and leave yours alone
    if ((c?.holdings?.stakes[r.id] ?? 0) >= 20) { r.lastMove = `${y}: ${expand(r, 0.1)}`; continue; }
    switch (r.style ?? def.style) {
      case "aggressive":
        if (rivalOfYours && rng.chance(0.5)) {
          g.mods.push({ kind: "price", mult: 0.92, until: g.turn + 4, source: `${name} price war`, industry: [def.industry] });
          pushHeadline(g, `${def.figures[0].split(" ").pop()} Cuts Prices`, `${name} undersells every mill in the valley to fill its order books. Rivals must follow or lose their customers.`);
          move = "cut prices to take your customers (−8% for a year)";
        } else if (c && totalMen(c) > 300 && rng.chance(0.5)) {
          bump(g, "labour", -4);
          move = "hired away some of your best men";
        } else move = expand(r, 0.15);
        break;
      case "integrator":
        if (c && (myIndustries(c).includes("steel") || myIndustries(c).includes("power")) && y >= 1881 && rng.chance(0.6)) {
          g.mods.push({ kind: "input", mult: 1.15, until: g.turn + 6, source: `${name} corners the coke` });
          pushHeadline(g, "Coke Prices Soar", `${def.figures[0]} has bought up the Connellsville ovens. Every furnace in the valley pays his price.`);
          move = "cornered the coke: your input costs +15% for six seasons";
        } else if (c && y >= 1877 && rng.chance(0.4)) {
          bump(g, "labour", -3);
          move = "broke a strike with Pinkertons; your men are angrier for it";
        } else move = expand(r, 0.1);
        break;
      case "financier":
        if (c && c.cash < 0 && c.debt === 0) {
          const loan = Math.round(100000 * era(y));
          c.cash += loan; c.debt += Math.round(loan * 1.25);
          pushHeadline(g, "Mellon Bank Extends Credit", `With ${c.name} short of cash, T. Mellon & Sons advances $${loan.toLocaleString()} — on terms.`);
          move = `lent you $${loan.toLocaleString()}`;
        } else {
          const others = g.rivals.filter((o) => o !== r && o.active && !o.owned && !o.closed);
          const t = others.length ? others[rng.int(0, others.length - 1)] : null;
          move = t ? `financed ${rivalName(defOf(t), year(g))}: ${expand(t, 0.2)}` : expand(r, 0.1);
        }
        break;
      case "innovator":
        if (c && myIndustries(c).includes("power") && rng.chance(0.35)) {
          const fine = Math.round(15000 * era(y));
          c.cash -= fine;
          move = `sued you over his patents ($${fine.toLocaleString()})`;
        } else move = expand(r, 0.15);
        break;
      default:
        move = expand(r, 0.1);
    }
    r.lastMove = `${y}: ${move}`;
    if (rivalOfYours || move.includes("you")) log(g, `${name} ${move}.`);
  }
}

function expand(r: RivalState, by: number): string {
  if (r.expand >= 1) return "kept the works running full";
  r.expand = Math.min(1, r.expand + by);
  return `built more furnaces and mills (+${Math.round(by * 100)}%)`;
}

const totalMen = (c: Company) => allWorks(c).reduce((s, w) => s + w.employees, 0);

// ---------------------------------------------------------------- your moves against them

/** the rival works you could act against now */
export function targets(g: GameState): RivalState[] {
  return g.rivals.filter((r) => r.active && !r.owned && !r.closed);
}

const target = (g: GameState, arg?: string) => g.rivals.find((r) => r.id === arg && r.active && !r.owned && !r.closed);
const sameIndustry = (g: GameState, r: RivalState) => myIndustries(g.company).includes(defOf(r).industry);
const needTarget = (g: GameState, arg?: string) => (target(g, arg) ? null : "Choose a rival works");

/** caught: the papers, the courts and the rival all know */
function caught(g: GameState, r: RivalState, what: string, rep: number, infl: number, fine: number, grudge: number) {
  const c = g.company!, def = defOf(r);
  bump(g, "reputation", rep); bump(g, "influence", infl);
  c.cash -= fine;
  r.grudge += grudge;
  pushHeadline(g, `${what} Traced to ${c.name}`, `Detectives hired by ${rivalName(def, year(g))} have followed the money to ${c.name}.${fine ? ` A court orders $${fine.toLocaleString()} in damages.` : ""}`);
}

/** what a rival's owners would take for their works, or why they won't sell */
export function acquisitionQuote(g: GameState, r: RivalState): { price: number } | { refused: string } {
  const def = defOf(r), y = year(g);
  if (def.id === "carnegie") return { refused: "Carnegie sells to no one but J. P. Morgan" };
  if (def.id === "frick") return { refused: "Frick will not sell his coke works" };
  if (r.offmap) return { refused: `Its works are off the map (${def.offmap}): buy a stake instead` };
  if (def.industry === "medicine" || def.id === "mellon_inst") return { refused: "A hospital or an institute isn't for sale" };
  const same = sameIndustry(g, r);
  if (y < (same ? 1880 : 1890)) return { refused: same ? "Buying rival works begins in the 1880s" : "Buying into another industry opens in 1890" };
  const ind = INDUSTRIES[def.industry];
  let cap = 1;
  for (const id of rivalTechs(def.industry, def.id, y, r.style)) cap += ind.tech.find((t) => t.id === id)?.effects.capacity ?? 0;
  const out = ind.baseCapacity * cap * (1 + r.expand);
  let price = out * ind.basePrice * (1 + (y - 1850) * PRICE_TREND) * 8;
  if ((r.style ?? def.style) === "financier") price *= 1.5;
  if (rivalMult(g, r) < 1 + r.expand - 0.01) price *= 0.75; // in trouble: they'll take less
  if (y >= 1975) price *= 0.4;
  price *= g.rules.buy?.cost ?? 1; // antitrust scrutiny raises the price
  return { price: Math.round(price / 1000) * 1000 };
}

/** take over a rival works: it becomes one of yours, with its own panel */
export function acquire(g: GameState, r: RivalState): Works {
  const c = g.company!, def = defOf(r), y = year(g);
  r.owned = true; r.active = false;
  const m = g.map;
  for (let dy = 0; dy < r.footprint; dy++) for (let dx = 0; dx < r.footprint; dx++) g.world.owner[(r.y + dy) * m.width + r.x + dx] = 1;
  const w: Works = {
    id: nextWorksId(c), name: rivalName(def, year(g)), industry: def.industry, x: r.x, y: r.y, footprint: r.footprint,
    techs: techsForYear(def.industry, y), employees: 0, produced: 0, seasonsOperating: 0, riverSide: r.riverSide, status: "running",
    strikeTurns: 0, health: 1, unrest: 0, annexes: [], fromRival: def.id, founded: y,
  };
  if (!w.techs.includes(INDUSTRIES[def.industry].tech[0].id)) w.techs.unshift(INDUSTRIES[def.industry].tech[0].id);
  c.others.push(w);
  updateWorksAccess(g, w);
  g.world.version++;
  return w;
}

export const RIVAL_ACTIONS: ActionDef[] = [
  {
    id: "undercut", group: "Rivals", name: "Undercut their prices",
    blurb: "Sell below them for a year: your price −6%, their output −20%. Aggressive owners answer in kind.",
    cost: () => 0, blocked: () => null,
    target: true,
    run: (g, _rng, arg) => {
      const r = target(g, arg)!;
      if (!sameIndustry(g, r)) return "They don't sell what you sell; there is nothing to undercut.";
      g.mods.push({ kind: "price", mult: 0.94, until: g.turn + 4, source: "Your price cut", industry: [defOf(r).industry] });
      damage(g, r, 0.8, 4, "your price cut");
      if ((r.style ?? defOf(r).style) === "aggressive") r.grudge++;
      return `You undersell ${rivalName(defOf(r), year(g))}; their order books thin.`;
    },
  },
  {
    id: "poach", group: "Rivals", name: "Hire away their best men",
    blurb: "Better pay for their rollers and gaffers: their output −15% for a year; labour +2.",
    cost: (g) => Math.round(3000 * era(year(g))), blocked: () => null, target: true,
    run: (g, _rng, arg) => {
      const r = target(g, arg)!;
      damage(g, r, 0.85, 4, "men hired away");
      bump(g, "labour", 2);
      return `Their best men come over to you.`;
    },
  },
  {
    id: "rumour", group: "Rivals", name: "Whisper to their bankers",
    blurb: "Rumours of bad debts: their credit dries up, output −15% for 18 months. 15% chance it's traced to you.",
    cost: (g) => Math.round(4000 * era(year(g))), blocked: () => null, target: true,
    run: (g, rng, arg) => {
      const r = target(g, arg)!;
      damage(g, r, 0.85, 6, "credit withdrawn");
      if (rng.chance(0.15)) { caught(g, r, "Slander", -10, -5, 0, 1); return "The rumours worked — and were traced back to you."; }
      return "Their bankers call in the notes.";
    },
  },
  {
    id: "espionage", group: "Rivals", name: "Buy their drawings",
    blurb: "Bribe their superintendent for the plans of a process they have and you don't. 25% chance of a lawsuit.",
    cost: (g) => Math.round(6000 * era(year(g))), target: true,
    blocked: () => null,
    run: (g, rng, arg) => {
      const r = target(g, arg)!, c = g.company!, def = defOf(r);
      const w = allWorks(c).find((x) => x.industry === def.industry);
      if (!w) return "Their processes are no use to your works.";
      const theirs = rivalTechs(def.industry, def.id, year(g), r.style);
      const ind = INDUSTRIES[def.industry];
      const t = ind.tech.find((x) => theirs.includes(x.id) && !w.techs.includes(x.id) && x.requires.every((q) => w.techs.includes(q)));
      if (!t) return "They have nothing you could use yet.";
      w.techs.push(t.id);
      g.world.version++;
      if (rng.chance(0.25)) { caught(g, r, "Stolen Plans", -15, -10, Math.round(20000 * era(year(g))), 2); return `You have the ${t.name} — and a lawsuit.`; }
      return `${t.name} goes into service at ${w.name}, built from their drawings.`;
    },
  },
  {
    id: "sabotage", group: "Rivals", name: "Sabotage their works",
    blurb: "A fire in the stockhouse, a derailed ore train: their output −65% for two seasons. Often traced: ruinous if it is.",
    cost: (g) => Math.round(5000 * era(year(g))), blocked: () => null, target: true,
    run: (g, rng, arg) => {
      const r = target(g, arg)!, def = defOf(r), y = year(g);
      damage(g, r, 0.35, 2, "fire");
      const dead = rng.chance(0.3) ? rng.int(1, 5) : 0;
      pushHeadline(g, `Fire Guts ${rivalName(def, year(g))} Works`, `Fire swept the ${rivalName(def, year(g))} works overnight${dead ? `, killing ${dead}` : ""}. The cause is not known.`);
      const p = 0.3 + (y >= 1910 ? 0.2 : 0) + (y >= 1950 ? 0.2 : 0);
      if (rng.chance(p)) { caught(g, r, "Arson", -40, -30, Math.round(50000 * era(y)), 3); return "The fire did its work. Then the detectives did theirs."; }
      r.grudge++;
      return "Their works burned. No one can prove a thing.";
    },
  },
  {
    id: "buy", group: "Rivals", name: "Buy their works",
    blurb: "Make the owners an offer. The works becomes yours, with its own panel; fewer rivals means better prices.",
    cost: () => 0, target: true,
    blocked: () => null,
    run: () => "",
  },
  {
    id: "loan", group: "Rivals", name: "Borrow from the Mellon bank",
    blurb: "Credit for expansion: cash now, repaid with 25% interest out of profits (less once Gulf Oil fills the Mellon vaults, and for Symphony patrons).",
    cost: () => 0,
    blocked: (g) => (!g.rivals.some((r) => r.id === "mellon" && r.active) ? "The Mellons aren't in business yet (1869)" : g.company!.debt > 0 ? "Repay the last loan first" : g.company!.biz.meters.reputation < -40 ? "No bank will lend to you" : null),
    run: (g) => {
      const c = g.company!, loan = Math.round(150000 * era(year(g)));
      // Gulf Oil money makes the Mellons cheaper lenders; a seat on the Symphony board helps too
      const rate = 0.25 * (g.flags.gulf ? 0.8 : 1) * (g.flags.symphony ? 0.85 : 1);
      c.cash += loan; c.debt += Math.round(loan * (1 + rate));
      return `T. Mellon & Sons advances $${loan.toLocaleString()}.`;
    },
  },
];

/** what a buyer would pay for one of your works (none of them will take the first works: that's the company) */
export function saleQuote(g: GameState, w: Works): number {
  const ind = INDUSTRIES[w.industry], y = year(g);
  let cap = 1;
  for (const t of ind.tech) if (w.techs.includes(t.id)) cap += t.effects.capacity ?? 0;
  let price = ind.baseCapacity * cap * ind.basePrice * (1 + (y - 1850) * PRICE_TREND) * 5;
  if (y >= 1975) price *= 0.3; // who buys a mill in the collapse?
  return Math.round(price / 1000) * 1000;
}

/** sell one of your works: back to its old owners if you bought it, otherwise to whoever will run it */
export function sellWorks(g: GameState, w: Works, buyer: "market" | "workers" | "authority", mult = 1): string {
  const c = g.company!, y = year(g);
  if (w === c) return "You can't sell the company's first works.";
  const price = Math.round(saleQuote(g, w) * (buyer === "workers" ? 0.5 : buyer === "authority" ? 0.7 : 1) * mult);
  c.cash += price;
  c.others = c.others.filter((x) => x !== w);
  const m = g.map;
  const r = w.fromRival ? g.rivals.find((x) => x.id === w.fromRival) : undefined;
  if (r) { r.owned = false; r.active = true; r.closed = false; }
  for (let dy = 0; dy < w.footprint; dy++) for (let dx = 0; dx < w.footprint; dx++) g.world.owner[(w.y + dy) * m.width + w.x + dx] = r ? r.ownerId : 0;
  g.world.version++;
  if (buyer === "workers") { g.morale = Math.min(100, g.morale + 6); c.biz.meters.reputation = Math.min(100, c.biz.meters.reputation + 8); }
  if (buyer === "authority") { g.morale = Math.min(100, g.morale + 4); c.biz.meters.reputation = Math.min(100, c.biz.meters.reputation + 5); }
  const to = buyer === "workers" ? " to its workers" : buyer === "authority" ? " to the Steel Valley Authority" : "";
  c.biz.record.push(`${cal(g).season} ${y}: Sold ${w.name}${to}`);
  return `${w.name} is sold${buyer === "workers" ? " to the men who work it" : buyer === "authority" ? " to the Steel Valley Authority, which will keep it running" : ""} for $${price.toLocaleString()}.`;
}

export const SELL_ACTIONS: ActionDef[] = [
  {
    id: "sell", group: "Rivals", name: "Sell one of your works",
    blurb: "Raise cash: a buyer takes one of your other works (a works you bought goes back to its old owners).",
    cost: () => 0,
    blocked: (g) => (g.company!.others.length ? null : "You have only the one works"),
    run: (g, _rng, arg) => { const w = g.company!.others.find((x) => x.id === arg) ?? g.company!.others[0]; return sellWorks(g, w, "market"); },
  },
  {
    id: "sell_workers", group: "Rivals", name: "Sell a works to its workers",
    blurb: "An employee buy-out (like Weirton, 1984): half the price, but the town and the men won't forget it. Morale +6, reputation +8.",
    cost: () => 0,
    blocked: (g) => (g.company!.others.length ? null : "You have only the one works"),
    run: (g, _rng, arg) => { const w = g.company!.others.find((x) => x.id === arg) ?? g.company!.others[0]; return sellWorks(g, w, "workers"); },
  },
  {
    id: "sell_authority", group: "Rivals", name: "Sell a works to the Steel Valley Authority",
    blurb: "The mill towns' authority takes a closing works to keep it running: 70% of the price. Morale +4, reputation +5.",
    cost: () => 0,
    blocked: (g) => (g.company!.others.length ? null : "You have only the one works"),
    run: (g, _rng, arg) => { const w = g.company!.others.find((x) => x.id === arg) ?? g.company!.others[0]; return sellWorks(g, w, "authority"); },
  },
];

// buying is special: its price depends on the target
const buy = RIVAL_ACTIONS.find((a) => a.id === "buy")!;
buy.blocked = (g, arg) => {
  const r = target(g, arg);
  if (!r) return "Choose a rival works";
  const q = acquisitionQuote(g, r);
  return "refused" in q ? q.refused : null;
};
buy.cost = (g, arg) => {
  const r = target(g, arg);
  if (!r) return 0;
  const q = acquisitionQuote(g, r);
  return "price" in q ? q.price : 0;
};
buy.run = (g, _rng, arg) => {
  const r = target(g, arg)!;
  const w = acquire(g, r);
  bump(g, "labour", -3);
  pushHeadline(g, `${g.company!.name} Buys ${w.name}`, `The ${w.name} works changes hands. Its men wait to hear the new owner's terms.`);
  return `${w.name} is yours.`;
};
for (const a of RIVAL_ACTIONS) if (a.target) { const b = a.blocked; a.blocked = (g, arg) => needTarget(g, arg) ?? b(g, arg); }

