// Running the business: three standings beside cash, standing policies, a few actions each season, and the
// big labour moments as decisions when they reach your works.
//
//   Reputation         what the public, the press and the pulpit think of you (−100..100)
//   Labour relations   what your men think of you (−100..100): strikes, who'll take a job, how hard they work
//   Influence          what City Hall, Harrisburg and Washington will do for you (0..100)
//
// Everything a 19th- and 20th-century mill owner did is on the table — the twelve-hour day, child labour,
// Pinkertons, blacklists, dumping slag in the river, buying newspapers and officials — and everything has a price.

import { GROUPS } from "./ancestry";
import { allWorks, cal, type GameState, log, totalEmployees } from "./game";
import type { GatewayId } from "./freight";
import type { Rng } from "./rng";

// ---------------------------------------------------------------- state

export interface Meters { reputation: number; labour: number; influence: number }

export type WageLevel = "low" | "market" | "high";
export type Hours = "twelve" | "ten" | "eight";
export type UnionStance = "fight" | "tolerate" | "recognise";
export type Safety = "none" | "basic" | "programme";
export type Waste = "dump" | "standard" | "abate";

export interface Policy {
  wages: WageLevel;
  hours: Hours;
  union: UnionStance;
  safety: Safety;
  childLabour: boolean;
  companyStore: boolean;
  waste: Waste;
}

export interface Business {
  meters: Meters;
  policy: Policy;
  /** actions left this season */
  actionsLeft: number;
  /** turn until which timed effects last */
  blacklistUntil: number;
  pressUntil: number;
  tariffUntil: number;
  /** seasons the works stays locked out */
  lockout: number;
  /** newcomers recruited by agents, still to arrive: [group, people] */
  recruits: [number, number][];
  /** the decisions you have taken (for the record and the final summary) */
  record: string[];
}

export const ACTIONS_PER_SEASON = 3;

export function newBusiness(year: number): Business {
  return {
    meters: { reputation: 0, labour: 10, influence: 5 },
    policy: { wages: "market", hours: year < 1923 ? "twelve" : year < 1937 ? "ten" : "eight", union: "tolerate", safety: "none", childLabour: year < 1905, companyStore: false, waste: "standard" },
    actionsLeft: ACTIONS_PER_SEASON,
    blacklistUntil: 0, pressUntil: 0, tariffUntil: 0, lockout: 0, recruits: [], record: [],
  };
}

/** river capacity bonuses won by lobbying (locks and dams), shared by every shipper */
export interface PublicWorks { locks: Partial<Record<GatewayId, number>> }

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const era = (year: number) => 1 + (year - 1850) * 0.012; // wage and price level

/** Move a meter, softening bad news while the press is friendly. */
export function bump(g: GameState, m: keyof Meters, d: number) {
  const b = g.company?.biz;
  if (!b) return;
  if (m === "reputation" && d < 0 && b.pressUntil > g.turn) d *= 0.5;
  b.meters[m] = clamp(b.meters[m] + d, m === "influence" ? 0 : -100, 100);
}

// ---------------------------------------------------------------- policies → the season's numbers

export interface PolicyEffects {
  wageMult: number;
  /** workers needed per unit of output (long shifts get more out of each man) */
  wpuMult: number;
  /** share of the labour pool willing to work for you */
  participationMult: number;
  strikeMult: number;
  /** $ per worker per season for safety, store income as a share of wages, etc. */
  extraCostPerWorker: number;
  storeIncomeShare: number;
  pollutionMult: number;
  outfallMult: number;
  inputCostMult: number;
  priceMult: number;
}

export const WAGE_MULT: Record<WageLevel, number> = { low: 0.85, market: 1, high: 1.15 };
const HOURS_WPU: Record<Hours, number> = { twelve: 0.87, ten: 1, eight: 1.14 };

export function policyEffects(g: GameState): PolicyEffects {
  const b = g.company!.biz, p = b.policy, year = cal(g).year;
  const labour = b.meters.labour;
  let wageMult = WAGE_MULT[p.wages];
  if (p.union === "recognise") wageMult *= 1.08; // the union scale
  if (p.childLabour) wageMult *= 0.94;          // boys at half pay on the light jobs
  let strikeMult = clamp(1 - labour / 120, 0.2, 2);
  if (p.union === "recognise") strikeMult *= 0.5;
  if (p.union === "fight") strikeMult *= 1.3;
  if (b.blacklistUntil > g.turn) strikeMult *= 0.6;
  strikeMult *= 0.9 ** g.company!.annexes.filter((a) => a.kind === "housing").length; // a striker can be evicted
  return {
    wageMult,
    wpuMult: HOURS_WPU[p.hours],
    participationMult: clamp(1 + labour / 400 + (p.wages === "high" ? 0.08 : p.wages === "low" ? -0.1 : 0), 0.7, 1.3),
    strikeMult,
    extraCostPerWorker: (p.safety === "programme" ? 6 : p.safety === "basic" ? 2 : 0) * era(year),
    storeIncomeShare: p.companyStore ? 0.05 : 0,
    pollutionMult: p.waste === "abate" ? 0.7 : 1,
    outfallMult: p.waste === "dump" ? 3 : p.waste === "abate" ? 0.4 : 1,
    inputCostMult: p.waste === "dump" ? 0.97 : p.waste === "abate" ? 1.04 : 1,
    priceMult: b.tariffUntil > g.turn ? 1.06 : 1,
  };
}

/** Where each meter drifts to under the current policies (labour also feels the district's unrest). */
function targets(g: GameState): Meters {
  const c = g.company!, p = c.biz.policy, year = cal(g).year;
  const labour = 10
    + (p.wages === "low" ? -25 : p.wages === "high" ? 20 : 0)
    + (p.hours === "twelve" ? (year < 1880 ? -5 : -15) : p.hours === "eight" ? 15 : 0)
    + (p.union === "fight" ? -15 : p.union === "recognise" ? 20 : 0)
    + (p.safety === "none" ? (year < 1880 ? 0 : -10) : p.safety === "programme" ? 10 : 0)
    + (p.companyStore ? -10 : 0) + (p.childLabour ? -5 : 0)
    + 4 * c.annexes.filter((a) => a.kind === "housing").length
    - c.unrest * 30;
  // what decent opinion expects keeps rising: child labour and dumping look worse every decade
  const reputation =
    (p.childLabour ? (year < 1880 ? -3 : year < 1908 ? -12 : -30) : 0)
    + (p.waste === "dump" ? (year < 1946 ? -6 : -25) : p.waste === "abate" ? 6 : 0)
    + (p.safety === "programme" ? 8 : p.safety === "none" && year >= 1908 ? -6 : 0)
    + (p.wages === "high" ? 5 : 0) + (p.union === "recognise" && year >= 1937 ? 5 : 0)
    + (p.hours === "twelve" && year >= 1908 ? -8 : 0)
    + (c.library ? 10 : 0);
  return { labour, reputation, influence: 0 };
}

export interface SeasonReport { notes: string[]; extraCost: number; fines: number; deaths: number }

/**
 * Once a season: meters drift toward what the policies earn, influence fades, accidents happen, inspectors
 * call, recruits arrive. Returns notes, extra costs and fines for the season's accounts.
 */
export function businessSeason(g: GameState, rng: Rng, employees: number): SeasonReport {
  const c = g.company!, b = c.biz, p = b.policy, year = cal(g).year;
  const out: SeasonReport = { notes: [], extraCost: 0, fines: 0, deaths: 0 };
  b.actionsLeft = ACTIONS_PER_SEASON;
  const t = targets(g);
  b.meters.labour += (t.labour - b.meters.labour) * 0.15;
  b.meters.reputation += (t.reputation - b.meters.reputation) * 0.06;
  b.meters.influence *= 0.97;

  // accidents: the twelve-hour day and no safety men kill workers (the Pittsburgh Survey counted 195 in a year)
  const rate = (p.hours === "twelve" ? 1.6 : p.hours === "ten" ? 1 : 0.7) * (p.safety === "none" ? 1.4 : p.safety === "basic" ? 1 : 0.5) * (year < 1910 ? 1.5 : year < 1950 ? 1 : 0.4) * (p.childLabour ? 1.2 : 1);
  const expected = (employees / 1000) * rate * 0.6;
  let deaths = 0;
  for (let k = 0; k < 6; k++) if (rng.chance(expected / 6)) deaths += 1 + (rng.chance(0.15) ? rng.int(1, 6) : 0);
  if (deaths) {
    out.deaths = deaths;
    bump(g, "labour", -2 * deaths);
    bump(g, "reputation", -(deaths >= 3 ? 2 * deaths : deaths * 0.5));
    out.notes.push(deaths === 1 ? "A man was killed at the works." : `${deaths} men were killed at the works.`);
    if (deaths >= 3) { log(g, `Disaster at ${c.name}: ${deaths} dead.`); pushHeadline(g, `${deaths} Killed at ${c.name}`, `An accident at the works kills ${deaths} men. The coroner's jury finds no one at fault; the men's lodges bury them.`); }
  }
  // the law catches up: child labour (Pennsylvania 1905/1915), river dumping (1965 / Clean Water Act 1972)
  if (p.childLabour && year >= 1915 && rng.chance(0.25)) {
    out.fines += Math.round(5000 * era(year)); bump(g, "reputation", -10);
    out.notes.push("Factory inspectors found boys on the night shift: fined.");
  }
  if (p.waste === "dump" && year >= 1965 && rng.chance(year >= 1972 ? 0.35 : 0.15)) {
    out.fines += Math.round(15000 * era(year)); bump(g, "reputation", -8);
    out.notes.push("Fined for dumping slag and acid into the river.");
  }
  // agents' recruits arrive (settled by the game)
  out.extraCost = employees * policyEffects(g).extraCostPerWorker;
  return out;
}

// ---------------------------------------------------------------- actions

export interface ActionDef {
  id: string;
  group: "Labour" | "Public" | "Politics" | "Rivals";
  name: string;
  /** one line on what it does and what it costs you */
  blurb: string;
  cost: (g: GameState, arg?: string) => number;
  /** null if it can be taken now, otherwise why not */
  blocked: (g: GameState, arg?: string) => string | null;
  /** acts on a rival works chosen in the panel */
  target?: boolean;
  run: (g: GameState, rng: Rng, arg?: string) => string;
}

const onStrike = (g: GameState) => allWorks(g.company!).some((w) => w.strikeTurns > 0 || w.status === "strike");
/** end (or shorten) the strike at every works */
const endStrikes = (g: GameState, left = 0) => { for (const w of allWorks(g.company!)) w.strikeTurns = Math.min(w.strikeTurns, left); };
const needStrike = (g: GameState) => (onStrike(g) ? null : "Only during a strike");
const year = (g: GameState) => cal(g).year;

export function pushHeadline(g: GameState, name: string, description: string) {
  const c = cal(g);
  g.headlines.push({ year: c.year, season: c.season, name, description, category: "Labor" });
}

export const ACTIONS: ActionDef[] = [
  // ---- labour
  {
    id: "negotiate", group: "Labour", name: "Negotiate a settlement",
    blurb: "End the strike: wages go up a step (or hours come down). Labour +15, reputation +5.",
    cost: () => 0, blocked: needStrike,
    run: (g) => {
      const c = g.company!, p = c.biz.policy;
      if (p.wages !== "high") p.wages = p.wages === "low" ? "market" : "high";
      else if (p.hours !== "eight") p.hours = p.hours === "twelve" ? "ten" : "eight";
      endStrikes(g); bump(g, "labour", 15); bump(g, "reputation", 5);
      return "Settled with the men. The fires are relit.";
    },
  },
  {
    id: "pinkertons", group: "Labour", name: "Send in the Pinkertons",
    blurb: "Armed guards to break the strike. Often works; sometimes there is shooting.",
    cost: (g) => Math.round(8000 * era(year(g))), blocked: (g) => needStrike(g) ?? (year(g) >= 1937 ? "After the Wagner Act and the La Follette hearings, private armies are finished" : null),
    run: (g, rng) => {
      const c = g.company!;
      const violence = rng.chance(0.4);
      if (violence) {
        const dead = rng.int(3, 10);
        bump(g, "reputation", -25); bump(g, "labour", -30); bump(g, "influence", -5);
        pushHeadline(g, `Battle at ${c.name}`, `Pinkerton guards and strikers exchange fire at the works; ${dead} are dead. The governor sends the militia.`);
        log(g, `Pinkertons and strikers fight at ${c.name}: ${dead} dead.`);
      }
      if (rng.chance(0.6)) { endStrikes(g); bump(g, "labour", -15); c.biz.policy.union = "fight"; return violence ? "The strike is broken, at a price in blood." : "The guards hold the gates; the strike collapses."; }
      return violence ? "Blood on the riverbank, and the men are still out." : "The guards hold the gates, but the men stay out.";
    },
  },
  {
    id: "strikebreakers", group: "Labour", name: "Bring in strikebreakers",
    blurb: "Recruit replacement workers (often newcomers or Black workers from the South). Strike ends next season; labour −20.",
    cost: (g) => Math.round(4000 * era(year(g))), blocked: needStrike,
    run: (g, _rng) => {
      const c = g.company!, y = year(g);
      // whom the agents bring: the newest arrivals of the day; from 1916, Black workers from the South
      const group = y >= 1916 && y < 1930 ? 4 : newestGroup(y);
      c.biz.recruits.push([group, 250]);
      endStrikes(g, 1); bump(g, "labour", -20); bump(g, "reputation", -5);
      return `Agents bring in ${GROUPS[group].name} strikebreakers under guard.`;
    },
  },
  {
    id: "lockout", group: "Labour", name: "Lock out the union",
    blurb: "Close the gates for a season and reopen non-union. Strikes rarer for years; labour −25, reputation −10.",
    cost: () => 0, blocked: (g) => (onStrike(g) ? "Not during a strike" : g.company!.biz.policy.union === "recognise" ? "You have recognised the union" : year(g) < 1876 ? "No union to lock out yet (the Amalgamated forms in 1876)" : null),
    run: (g) => {
      const b = g.company!.biz;
      b.lockout = 1; b.policy.union = "fight"; b.blacklistUntil = g.turn + 16;
      bump(g, "labour", -25); bump(g, "reputation", -10);
      return "The gates are locked. When they reopen, no union man will pass them.";
    },
  },
  {
    id: "blacklist", group: "Labour", name: "Blacklist the organisers",
    blurb: "Spies in the lodges; known union men are fired. Strike chance ×0.6 for two years; labour −10.",
    cost: (g) => Math.round(1000 * era(year(g))), blocked: (g) => (g.company!.biz.policy.union === "recognise" ? "You have recognised the union" : null),
    run: (g) => { g.company!.biz.blacklistUntil = g.turn + 8; bump(g, "labour", -10); bump(g, "reputation", -3); return "The superintendent's spies take names."; },
  },
  {
    id: "recruit", group: "Labour", name: "Send recruiting agents",
    blurb: "Agents in the old country (or the South) bring a few hundred families to your works. Pick who.",
    cost: (g) => Math.round(3000 * era(year(g))), blocked: () => null,
    run: (g, _rng, arg) => {
      const gid = Number(arg) || newestGroup(year(g));
      g.company!.biz.recruits.push([gid, 300]);
      bump(g, "labour", -3);
      return `Agents recruit ${GROUPS[gid].name} families for the works.`;
    },
  },
  {
    id: "picnic", group: "Labour", name: "Company picnic and turkeys",
    blurb: "Kennywood picnic in summer, a turkey at Christmas. Labour +8, reputation +2.",
    cost: (g) => Math.round(2000 * era(year(g))), blocked: () => null,
    run: () => "The men's families picnic at the park; the band plays.",
  },
  // ---- public
  {
    id: "donate", group: "Public", name: "Endow a hospital or church",
    blurb: "A wing for the hospital, a bell for the church. Reputation +8, labour +4.",
    cost: (g) => Math.round(5000 * era(year(g))), blocked: () => null,
    run: () => "Your name goes on a cornerstone.",
  },
  {
    id: "press", group: "Public", name: "Buy the newspapers' goodwill",
    blurb: "Advertising, dinners, a quiet word with the editors. Reputation +5; bad news hurts half as much for two years.",
    cost: (g) => Math.round(6000 * era(year(g))), blocked: () => null,
    run: (g) => { g.company!.biz.pressUntil = g.turn + 8; return "The editors find much to admire in your enterprise."; },
  },
  // ---- politics
  {
    id: "lobby", group: "Politics", name: "Lobby City Hall and Harrisburg",
    blurb: "Campaign money and dinners. Influence +12 (more if your reputation is good).",
    cost: (g) => Math.round(5000 * era(year(g))), blocked: () => null,
    run: (g) => { bump(g, "influence", 12 * (1 + g.company!.biz.meters.reputation / 200)); return "The Republican organisation counts you a friend."; },
  },
  {
    id: "bribe", group: "Politics", name: "Bribe an official",
    blurb: "Fast influence (+20) — and a one-in-five chance it ends up in the papers.",
    cost: (g) => Math.round(3000 * era(year(g))), blocked: () => null,
    run: (g, rng) => {
      bump(g, "influence", 20);
      if (rng.chance(0.2)) {
        const fine = Math.round(10000 * era(year(g)));
        g.company!.cash -= fine; bump(g, "reputation", -20); bump(g, "influence", -15);
        pushHeadline(g, "Graft Exposed", `A councilman's bank book shows payments from ${g.company!.name}. A $${fine.toLocaleString()} settlement follows.`);
        return "The payment made the papers.";
      }
      return "The councilman is grateful.";
    },
  },
  {
    id: "locks", group: "Politics", name: "Lobby for locks and dams",
    blurb: "Spend influence (25) to win federal money for a river: +35% barge capacity on it for everyone.",
    cost: (g) => Math.round(20000 * era(year(g))), blocked: (g) => (g.company!.biz.meters.influence < 25 ? "Needs 25 influence" : null),
    run: (g, _rng, arg) => {
      const gw = (arg as GatewayId) || "upper_mon";
      g.publicWorks.locks[gw] = (g.publicWorks.locks[gw] ?? 0) + 1;
      bump(g, "influence", -25);
      return `Congress funds new locks and dams on the ${gw === "upper_mon" ? "Monongahela" : gw === "allegheny" ? "Allegheny" : "Ohio"}.`;
    },
  },
  {
    id: "tariff", group: "Politics", name: "Lobby for a higher tariff",
    blurb: "Spend influence (30): import duties lift your prices 6% for five years.",
    cost: (g) => Math.round(10000 * era(year(g))), blocked: (g) => (g.company!.biz.meters.influence < 30 ? "Needs 30 influence" : null),
    run: (g) => { g.company!.biz.tariffUntil = g.turn + 20; bump(g, "influence", -30); return "The tariff bill passes; foreign iron and steel pay the duty."; },
  },
];

/** the meter changes that are simple constants */
const SIMPLE: Record<string, Partial<Meters>> = { picnic: { labour: 8, reputation: 2 }, donate: { reputation: 8, labour: 4 }, press: { reputation: 5 } };

/** Take an action: checks the budget, cash and conditions; returns what happened (or why not). */
export function takeAction(g: GameState, id: string, rng: Rng, arg?: string): { ok: boolean; text: string } {
  const c = g.company;
  if (!c) return { ok: false, text: "No company" };
  const a = ACTIONS.find((x) => x.id === id);
  if (!a) return { ok: false, text: "Unknown action" };
  if (c.biz.actionsLeft <= 0) return { ok: false, text: "No actions left this season" };
  const why = a.blocked(g, arg);
  if (why) return { ok: false, text: why };
  const cost = a.cost(g, arg);
  if (c.cash < cost) return { ok: false, text: `Needs $${cost.toLocaleString()}` };
  c.cash -= cost;
  c.biz.actionsLeft--;
  for (const [k, v] of Object.entries(SIMPLE[id] ?? {})) bump(g, k as keyof Meters, v);
  const text = a.run(g, rng, arg);
  c.biz.record.push(`${cal(g).season} ${cal(g).year}: ${a.name}`);
  log(g, `${a.name}: ${text}`);
  return { ok: true, text };
}

/** Change standing policies: all changes made in one season cost a single action. */
export function setPolicy(g: GameState, next: Partial<Policy>): { ok: boolean; text: string } {
  const c = g.company;
  if (!c) return { ok: false, text: "No company" };
  const changed = (Object.keys(next) as (keyof Policy)[]).filter((k) => next[k] !== undefined && next[k] !== c.biz.policy[k]);
  if (!changed.length) return { ok: true, text: "No change" };
  if (c.biz.actionsLeft <= 0) return { ok: false, text: "No actions left this season" };
  const y = cal(g).year;
  if (next.union && next.union !== "tolerate" && y < 1876) return { ok: false, text: "There is no union yet (the Amalgamated forms in 1876)" };
  c.biz.actionsLeft--;
  Object.assign(c.biz.policy, next);
  // a change of heart is felt at once, a little
  if (next.wages) bump(g, "labour", next.wages === "high" ? 6 : next.wages === "low" ? -8 : 0);
  if (next.union === "recognise") { bump(g, "labour", 15); bump(g, "influence", -5); }
  log(g, `New policy at ${c.name}: ${changed.map((k) => `${k} → ${String(c.biz.policy[k])}`).join(", ")}.`);
  return { ok: true, text: "Policy changed" };
}

/** the newest arriving community of the year (by immigration wave) */
export function newestGroup(year: number): number {
  let best = 2, bv = -1;
  for (const gr of GROUPS) if (gr.id >= 2 && gr.id !== 4 && gr.wave(year) > bv) { bv = gr.wave(year); best = gr.id; }
  return best;
}

// ---------------------------------------------------------------- decisions at historical moments

export interface DecisionOption { label: string; detail: string; apply: (g: GameState, rng: Rng) => string }
export interface Decision { id: string; title: string; text: string; options: DecisionOption[]; /** what the real owners did (taken if the decision is left open) */ historical: number }

const labourIndustry = (g: GameState) => !!g.company && allWorks(g.company).some((w) => w.industry === "steel" || w.industry === "metalworks") && totalEmployees(g.company) >= DECISION_MEN;
/** men employed before the great labour fights reach your works */
export const DECISION_MEN = 250;

/** event name → the decision it puts to you when it reaches your works */
export const DECISIONS: Record<string, (g: GameState) => Decision | null> = {
  "Battle of Homestead": (g) => !labourIndustry(g) ? null : {
    id: "homestead1892", historical: 1, title: "Your contract with the Amalgamated expires",
    text: "At Homestead, Frick has refused to renew the union's contract and fortified the works. Your own lodge's agreement runs out this summer. The other owners are watching.",
    options: [
      { label: "Renew the contract", detail: "Labour +20, union recognised, wages up a step. Your fellow owners think you soft (influence −10).",
        apply: (g) => { const b = g.company!.biz; b.policy.union = "recognise"; if (b.policy.wages !== "high") b.policy.wages = b.policy.wages === "low" ? "market" : "high"; bump(g, "labour", 20); bump(g, "influence", -10); return "You renew with the Amalgamated."; } },
      { label: "Lock out, bring the Pinkertons", detail: "Break the union like Frick: shooting likely; union gone for a decade.",
        apply: (g, rng) => { const b = g.company!.biz; b.lockout = 1; b.policy.union = "fight"; b.blacklistUntil = g.turn + 40; const dead = rng.int(2, 9); bump(g, "labour", -35); bump(g, "reputation", -25); pushHeadline(g, `Barges Fired On at ${g.company!.name}`, `Pinkertons landing at your works are met by armed strikers; ${dead} die. The militia occupies the town.`); return `Lockout and Pinkertons: ${dead} dead; the union is broken.`; } },
      { label: "Lock out and wait them out", detail: "No guards: the works closes a season, then reopens non-union with strikebreakers. Labour −25.",
        apply: (g) => { const b = g.company!.biz; b.lockout = 2; b.policy.union = "fight"; b.blacklistUntil = g.turn + 24; b.recruits.push([newestGroup(1892), 300]); bump(g, "labour", -25); bump(g, "reputation", -10); return "The gates stay shut until the men give up."; } },
    ],
  },
  "Great Steel Strike": (g) => !labourIndustry(g) ? null : {
    id: "strike1919", historical: 1, title: "The Great Steel Strike reaches your gates",
    text: "350,000 steelworkers are out across the country for the eight-hour day and union recognition. Your men walk out with them.",
    options: [
      { label: "Recognise the union, eight-hour day", detail: "Strike ends now. Labour +30, union recognised, hours eight. The other owners are furious (influence −15).",
        apply: (g) => { const b = g.company!.biz; b.policy.union = "recognise"; b.policy.hours = "eight"; bump(g, "labour", 30); bump(g, "influence", -15); bump(g, "reputation", 8); endStrikes(g); return "You break ranks with Big Steel and sign."; } },
      { label: "Hold firm with the state police", detail: "The strike drags on two seasons and collapses. Labour −20; the union is beaten.",
        apply: (g) => { const b = g.company!.biz; b.policy.union = "fight"; b.blacklistUntil = g.turn + 20; for (const w of allWorks(g.company!)) w.strikeTurns = 2; bump(g, "labour", -20); bump(g, "reputation", -6); return "The Cossacks ride the streets; the men drift back by January."; } },
      { label: "Concede the eight-hour day only", detail: "Strike ends next season. Labour +10, hours eight, no union.",
        apply: (g) => { const b = g.company!.biz; b.policy.hours = "eight"; for (const w of allWorks(g.company!)) w.strikeTurns = 1; bump(g, "labour", 10); return "The eight-hour day, but no union."; } },
    ],
  },
  "Big Steel Signs": (g) => !labourIndustry(g) ? null : {
    id: "swoc1937", historical: 0, title: "SWOC asks you to sign",
    text: "U.S. Steel has recognised the Steel Workers Organizing Committee without a strike. Little Steel is refusing — and in Chicago, police will shoot marchers on Memorial Day.",
    options: [
      { label: "Sign with SWOC", detail: "Labour +25, union recognised, union wage scale.",
        apply: (g) => { g.company!.biz.policy.union = "recognise"; bump(g, "labour", 25); bump(g, "reputation", 6); return "You sign the SWOC contract."; } },
      { label: "Resist like Little Steel", detail: "A strike for a season or two; violence possible; the Wagner Act may force you to sign anyway.",
        apply: (g, rng) => { const b = g.company!.biz; b.policy.union = "fight"; for (const w of allWorks(g.company!)) w.strikeTurns = 2; bump(g, "labour", -20); if (rng.chance(0.35)) { bump(g, "reputation", -20); pushHeadline(g, `Police Fire on Pickets at ${g.company!.name}`, "Company police and deputies fire on a picket line; the Senate's La Follette committee will hear of it."); } return "You refuse to recognise SWOC."; } },
    ],
  },
  "116-Day Strike": (g) => !labourIndustry(g) ? null : {
    id: "strike1959", historical: 1, title: "The union walks out over work rules",
    text: "The industry wants to rewrite the work rules; the United Steelworkers walk out nationwide. Customers are already buying Japanese and European steel.",
    options: [
      { label: "Settle early", detail: "Wages up a step; no lost customers. Labour +10.",
        apply: (g) => { const b = g.company!.biz; if (b.policy.wages !== "high") b.policy.wages = b.policy.wages === "low" ? "market" : "high"; bump(g, "labour", 10); endStrikes(g); return "You settle with the Steelworkers."; } },
      { label: "Hold out with the industry", detail: "Out for two seasons; imports take a permanent bite (prices −3%). Labour −10.",
        apply: (g) => { for (const w of allWorks(g.company!)) w.strikeTurns = 2; bump(g, "labour", -10); g.priceLoss = (g.priceLoss ?? 0) + 0.03; return "You stand with the industry. The imports keep coming."; } },
    ],
  },
};

/** Take one of a decision's options (or the historical one if `k` is undefined). */
export function resolveDecision(g: GameState, rng: Rng, k?: number): string {
  const d = g.pendingDecision;
  if (!d || !g.company) return "";
  const opt = d.options[k ?? d.historical] ?? d.options[d.historical];
  const text = opt.apply(g, rng);
  g.company.biz.record.push(`${cal(g).year}: ${d.title} — ${opt.label}`);
  log(g, `${d.title}: ${opt.label}. ${text}`);
  g.pendingDecision = undefined;
  return text;
}
