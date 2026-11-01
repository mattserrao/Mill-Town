// Labour as a player: the union at your works, by industry and era — the Sons of Vulcan and the Amalgamated,
// SWOC and the Steelworkers; the window-glass men and the Flints; the IBEW, the UE and the IUE.
//
// Each union has members (the share of your men), militancy (how ready they are to walk out), a strike fund
// (how long they can stay out), a leader, and a memory: the ledger's grievances and trust. Each season it
// organises, and when it's strong and angry enough it brings you demands with a deadline. Refuse, and the men
// walk out. A strike is a siege on four fronts — money (their fund against your losses), men (strikebreakers
// against the picket line), force (guards and troops, if the politics allow it), opinion (the papers and the
// pulpit) — until one side breaks or you settle. A broken union comes back angrier a generation later.

import { bump, type Decision, type DecisionOption, newestGroup, type Policy, pushHeadline } from "./business";
import { allWorks, cal, type GameState, log, mod, totalEmployees, type Works } from "./game";
import { INDUSTRIES, type IndustryId } from "./industries";
import { hasMark, mark, standing } from "./ledger";
import { hasTrait } from "./family";
import { governorWillSendTroops, lawPassed } from "./politics";
import { recordMove } from "./owners";
import { priceLevel } from "./time";
import type { Rng } from "./rng";

export type DemandKind = "wages" | "hours" | "recognition" | "safety" | "store";

export interface Siege {
  /** the works out */
  works: string[];
  start: number;
  seasons: number;
  demand: DemandKind;
  /** 0..1 of the jobs filled by strikebreakers */
  men: number;
  /** guards, police, troops on your side (0..2) */
  force: number;
  /** the public: −1 with you … +1 with the strikers */
  opinion: number;
  /** killed on the picket lines */
  dead: number;
}

export interface Union {
  industry: IndustryId;
  /** share of your men in the union (0..1) */
  membership: number;
  /** readiness to strike (0..100) */
  militancy: number;
  /** seasons of strike pay in the treasury */
  fund: number;
  recognised: boolean;
  /** the contract runs to this turn */
  contractUntil: number;
  demand?: { kind: DemandKind; due: number; since: number };
  lastDemand: number;
  siege?: Siege;
  /** the year it was last broken (it comes back angrier) */
  broken?: number;
  /** the works belongs to the men */
  coop?: boolean;
  /** strikes won and lost, for the Struggle view */
  won: number; lost: number;
}

/** the union's name and its leader, by industry and year */
export function unionName(ind: IndustryId, y: number): string | null {
  if (ind === "steel" || ind === "metalworks") {
    if (ind === "metalworks" && y >= 1889 && y < 1936) return "International Association of Machinists";
    return y < 1858 ? null : y < 1876 ? "Sons of Vulcan" : y < 1936 ? "Amalgamated Association" : y < 1942 ? "Steel Workers Organizing Committee" : "United Steelworkers";
  }
  if (ind === "aluminium") return y < 1937 ? null : "Aluminum Workers of America";
  if (ind === "chemicals") return y < 1936 ? null : "District 50, United Mine Workers";
  if (ind === "research" || ind === "medicine") return y < 1965 ? null : ind === "medicine" ? "Hospital workers (SEIU)" : null;
  if (ind === "nuclear") return y < 1950 ? null : "International Union of Electrical Workers (IUE)";
  if (ind === "glass") return y < 1865 ? null : y < 1880 ? "Window Glass Workers" : y < 1909 ? "Local Assembly 300, Knights of Labor" : y < 1934 ? "American Flint Glass Workers" : "Federation of Glass, Ceramic and Silica Sand Workers";
  return y < 1891 ? null : y < 1936 ? "Brotherhood of Electrical Workers" : y < 1950 ? "United Electrical Workers (UE)" : "International Union of Electrical Workers (IUE)";
}
const LEADERS: Record<"steel" | "glass" | "power", [number, string][]> = {
  steel: [[1858, "Miles Humphreys"], [1876, "Joseph Bishop"], [1880, "John Jarrett"], [1884, "William Weihe"], [1892, "Mahlon Garland"], [1898, "Theodore Shaffer"], [1905, "P. J. McArdle"], [1911, "John Williams"], [1918, "Mike Tighe"], [1936, "Philip Murray"], [1953, "David McDonald"], [1965, "I. W. Abel"], [1977, "Lloyd McBride"], [1983, "Lynn Williams"]],
  glass: [[1865, "the window-glass committee"], [1880, "Simon Burns"], [1909, "the Flints' officers"], [1934, "Glen McCabe"]],
  power: [[1891, "Henry Miller"], [1936, "James Carey"], [1941, "Albert Fitzgerald"], [1950, "James Carey"], [1965, "Paul Jennings"]],
};
export function leaderOf(ind: IndustryId, y: number): string {
  const list = LEADERS[ind === "metalworks" ? "steel" : ind === "glass" || ind === "power" || ind === "steel" ? ind : "power"];
  let n = list[0][1];
  for (const [yy, name] of list) if (y >= yy) n = name;
  return n;
}

export const unionsOf = (g: GameState) => (g.unions ??= {});
export const unionFor = (g: GameState, ind: IndustryId) => unionsOf(g)[ind];
const year = (g: GameState) => cal(g).year;
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** the union at the works of an industry: forms when the era has one and you employ enough men */
function ensure(g: GameState, ind: IndustryId): Union | undefined {
  const U = unionsOf(g);
  if (U[ind]) return U[ind];
  if (!unionName(ind, year(g))) return undefined;
  const men = allWorks(g.company!).filter((w) => w.industry === ind).reduce((s, w) => s + w.employees, 0);
  if (men < 80) return undefined;
  U[ind] = { industry: ind, membership: 0.05, militancy: 25, fund: 1, recognised: false, contractUntil: 0, lastDemand: g.turn, won: 0, lost: 0 };
  log(g, `The ${unionName(ind, year(g))} has a lodge among your ${INDUSTRIES[ind].name.toLowerCase()} men.`);
  return U[ind];
}

/** the organising drives of the era: the 1919 campaign, Section 7(a), the CIO */
function drive(y: number): number {
  return y >= 1933 && y < 1942 ? 0.07 : y >= 1916 && y < 1920 ? 0.035 : y >= 1880 && y < 1893 ? 0.025 : y >= 1942 ? 0.03 : 0.012;
}

/** what the men think: the policies, the ledger, the district, the leader's trait */
export function militancyTarget(g: GameState, u: Union): number {
  const c = g.company!, p = c.biz.policy, y = year(g);
  const ws = allWorks(c).filter((w) => w.industry === u.industry);
  const unrest = ws.length ? ws.reduce((s, w) => s + w.unrest, 0) / ws.length : 0;
  return clamp(30
    - standing(g, "labour") * 0.35
    + unrest * 40
    + (p.wages === "low" ? 15 : p.wages === "high" ? -10 : 0)
    + (p.hours === "twelve" && y >= 1890 ? 12 : p.hours === "eight" ? -6 : 0)
    + (p.safety === "none" && y >= 1900 ? 6 : 0) + (p.companyStore ? 6 : 0)
    + (u.recognised ? -15 : 0)
    + (u.broken && y - u.broken > 15 ? 15 : 0) // the sons remember
    + (hasTrait(g, "works") ? -10 : 0) + (hasTrait(g, "iron") ? 6 : 0)
    + (g.morale - 50) * -0.2, 0, 100);
}

/** Once a season: the unions organise, harden or soften, fill their funds; demands come; strikes run their course. */
export function labourSeason(g: GameState, rng: Rng) {
  const c = g.company;
  if (!c) return;
  const y = year(g);
  const inds = [...new Set(allWorks(c).map((w) => w.industry))];
  for (const ind of inds) {
    const u = ensure(g, ind);
    if (!u) continue;
    if (u.coop) { u.membership = 1; u.militancy = 0; u.demand = undefined; continue; }
    const p = c.biz.policy;
    // organising: harder under blacklists and a fighting owner, easy once recognised
    let d = drive(y) * (c.biz.blacklistUntil > g.turn ? 0.3 : 1) * (p.union === "fight" ? 0.5 : 1) * (mod(g, "strike", { industry: ind }) > 1.2 ? 1.5 : 1);
    if (u.recognised) d = 0.08;
    u.membership = clamp(u.membership + d * (1 - u.membership) * (1 + Math.max(0, -standing(g, "labour")) / 80) - 0.004, 0, 1);
    u.militancy = clamp(u.militancy + (militancyTarget(g, u) - u.militancy) * 0.15, 0, 100);
    if (!u.siege) u.fund = Math.min(6, u.fund + u.membership * 0.25);
    // a demand comes due: refused by default
    if (u.demand && g.turn >= u.demand.due && !g.moreDecisions.some((x) => x.source === `demand:${ind}`) && g.pendingDecision?.source !== `demand:${ind}`) {
      // the card was answered or dropped: the demand lapses into a strike if they're angry
      u.demand = undefined;
    }
    if (!u.demand && !u.siege && u.membership > 0.3 && u.fund >= 1.5 && u.militancy > 45 && g.turn - u.lastDemand >= 12 && totalEmployees(c) >= 100 && rng.chance(0.18 + (u.militancy - 45) / 200)) {
      const kind = pickDemand(g, u, p);
      if (kind) {
        u.demand = { kind, due: g.turn + 1, since: g.turn };
        u.lastDemand = g.turn;
        const dec = demandDecision(g, ind);
        if (dec) { if (!g.pendingDecision) g.pendingDecision = dec; else g.moreDecisions.push(dec); }
      }
    }
    // a wildcat: the angriest men walk out without waiting
    if (!u.siege && !u.demand && u.militancy > 65 && u.membership > 0.35 && u.fund >= 2 && g.turn - u.lastDemand >= 8 && rng.chance((u.militancy - 65) / 600 * u.membership * mod(g, "strike", { industry: ind }))) startSiege(g, u, "wages", "a wildcat walkout");
    if (u.siege) siegeSeason(g, u, rng);
  }
}

function pickDemand(g: GameState, u: Union, p: Policy): DemandKind | null {
  const y = year(g), opts: [DemandKind, number][] = [];
  if (p.wages !== "high") opts.push(["wages", p.wages === "low" ? 4 : 2]);
  if (p.hours !== "eight" && y >= 1880) opts.push(["hours", p.hours === "twelve" ? 3 : 1.5]);
  if (!u.recognised && u.membership > 0.45) opts.push(["recognition", 2.5 + (y >= 1933 ? 2 : 0)]);
  if (p.safety === "none" && y >= 1900) opts.push(["safety", 1.5]);
  if (p.companyStore) opts.push(["store", 1.5]);
  if (!opts.length) return null;
  opts.sort((a, b) => b[1] - a[1]);
  return opts[0][0];
}

const DEMAND_TEXT: Record<DemandKind, { ask: string; concede: string; half: string }> = {
  wages: { ask: "a raise: the next step up the wage scale", concede: "Wages up a step.", half: "A one-time bonus of a month's pay." },
  hours: { ask: "a shorter day", concede: "Hours down a step.", half: "The Saturday half-holiday." },
  recognition: { ask: "recognition: a signed contract with the union", concede: "The union is recognised.", half: "A grievance committee, but no contract." },
  safety: { ask: "safety men and guards on the machines", concede: "A safety department.", half: "Guards on the worst machines." },
  store: { ask: "an end to the company store and its scrip", concede: "The company store closes.", half: "Store prices capped at the town's." },
};

function concede(g: GameState, u: Union, kind: DemandKind) {
  const p = g.company!.biz.policy;
  if (kind === "wages") p.wages = p.wages === "low" ? "market" : "high";
  if (kind === "hours") p.hours = p.hours === "twelve" ? "ten" : "eight";
  if (kind === "recognition") { p.union = "recognise"; u.recognised = true; u.contractUntil = g.turn + 12; }
  if (kind === "safety") p.safety = p.safety === "none" ? "basic" : "programme";
  if (kind === "store") p.companyStore = false;
}

/** the union's demand, as a card (rebuilt from the union's state on load) */
export function demandDecision(g: GameState, ind: IndustryId): Decision | null {
  const u = unionFor(g, ind), c = g.company;
  if (!u?.demand || !c) return null;
  const y = year(g), kind = u.demand.kind, T = DEMAND_TEXT[kind], name = unionName(ind, y)!, leader = leaderOf(ind, y);
  const why = standing(g, "labour") < -20 ? " The men have long memories." : "";
  const past = hasMark(g, "homestead_pinkertons") ?? hasMark(g, "crushed");
  const opts: DecisionOption[] = [
    { label: "Concede", detail: `${T.concede} Militancy falls; the men trust you more. The other owners grumble.`,
      apply: (g) => { concede(g, u, kind); if (kind === "recognition") recordMove(g, "recognise"); u.militancy -= 25; u.demand = undefined; bump(g, "labour", 10); bump(g, "influence", -3);
        mark(g, { id: `conceded_${kind}`, side: "labour", kind: "trust", weight: 10, text: `gave the men ${T.ask.split(":")[0]}` });
        for (const r of g.rivals) r.stance = Math.max(-100, (r.stance ?? 0) - 3);
        return `You concede: ${T.concede.toLowerCase()}`; } },
    { label: "Negotiate", detail: `Offer half: ${T.half.toLowerCase()} They may take it — or walk out.`,
      apply: (g, rng) => {
        u.demand = undefined;
        const chance = 0.55 + standing(g, "labour") / 200 - (u.militancy - 50) / 150 + (hasTrait(g, "works") ? 0.15 : 0);
        if (rng.chance(clamp(chance, 0.1, 0.9))) {
          if (kind === "wages") g.company!.cash -= Math.round(totalEmployees(g.company!) * 60 * priceLevel(y) / 3);
          if (kind === "hours") g.company!.biz.policy.halfHoliday = true;
          if (kind === "safety" && g.company!.biz.policy.safety === "none") g.company!.biz.policy.safety = "basic";
          if (kind === "store") g.company!.biz.flags.storeCapped = true;
          u.militancy -= 12;
          mark(g, { id: `bargained_${kind}`, side: "labour", kind: "trust", weight: 4, text: "bargained in good faith" });
          return `${leader} takes the offer to the lodges; they accept.`;
        }
        startSiege(g, u, kind, "the men voted the offer down");
        return "The lodges vote the offer down and walk out.";
      } },
    { label: "Refuse", detail: `No. ${u.militancy > 55 ? "They will almost certainly strike." : "They may strike."} The other owners approve.`,
      apply: (g, rng) => {
        u.demand = undefined; u.militancy += 12;
        mark(g, { id: `refused_${kind}`, side: "labour", kind: "grievance", weight: 6, text: `refused the men ${T.ask.split(":")[0]}` });
        for (const r of g.rivals) r.stance = Math.min(100, (r.stance ?? 0) + 2);
        if (u.fund >= 1 && rng.chance(clamp((u.militancy / 100) * (0.2 + u.membership), 0.1, 0.9))) { startSiege(g, u, kind, "the demand was refused"); return "The men walk out."; }
        return "The men grumble and stay at work — for now.";
      } },
  ];
  if (!g.rules.lockout?.blocked && !u.recognised) opts.push({ label: "Lock them out", detail: "Close the gates a season and reopen without the union men. Membership broken; a deep grievance.",
    apply: (g) => {
      u.demand = undefined; g.company!.biz.lockout = 1; u.membership *= 0.4; u.militancy += 10; g.company!.biz.policy.union = "fight";
      mark(g, { id: "lockout", side: "labour", kind: "grievance", weight: 15, text: "locked the union men out" });
      return "The gates are chained.";
    } });
  return {
    id: `demand_${ind}_${u.demand.since}`, source: `demand:${ind}`, historical: 2,
    title: `The ${name} presents its demands`,
    text: `${leader} and a committee of your ${INDUSTRIES[ind].name.toLowerCase()} men ask for ${T.ask}. ${Math.round(u.membership * 100)}% of the men are in the union; their fund would carry a strike ${Math.round(u.fund)} seasons.${why}${past ? " They have not forgotten what was done before." : ""}`,
    options: opts,
  };
}

/** the strike begins */
export function startSiege(g: GameState, u: Union, demand: DemandKind, why: string) {
  const c = g.company!;
  const works = allWorks(c).filter((w) => w.industry === u.industry);
  u.siege = { works: works.map((w) => w.id), start: g.turn, seasons: 0, demand, men: 0, force: c.biz.policy.police ? 0.4 : 0, opinion: opinionNow(g), dead: 0 };
  for (const w of works) w.strikeTurns = Math.max(w.strikeTurns, 1);
  g.stats.strikes++;
  const name = unionName(u.industry, year(g));
  pushHeadline(g, `Strike at ${c.name}`, `The ${name} walks out at ${works.map((w) => w.name).join(" and ")}: ${why}. Pickets at the gates.`, "Labor");
  log(g, `Strike: the ${name} walks out (${why}).`);
}

/** −1 the town is with you … +1 with the strikers */
function opinionNow(g: GameState): number {
  const rep = g.company!.biz.meters.reputation, y = year(g);
  return clamp(-rep / 120 + (y >= 1930 && y < 1950 ? 0.25 : 0) + (g.morale < 40 ? 0.1 : 0) + standing(g, "public") / -400, -1, 1);
}

/** one season of the siege: the fronts move, and maybe one side breaks */
function siegeSeason(g: GameState, u: Union, rng: Rng) {
  const s = u.siege!, c = g.company!, y = year(g);
  s.seasons++;
  s.opinion = clamp(s.opinion * 0.6 + opinionNow(g) * 0.4 + (s.dead ? 0.2 : 0), -1, 1);
  // money: the strike fund drains; sympathy and other unions top it up
  // (from 1937 the national union's strike fund carries the local)
  u.fund -= 1 - Math.max(0, s.opinion) * 0.5 - (y >= 1937 ? 0.65 : 0);
  // men: the association's strikebreakers, hungry newcomers, the jobless
  // (once the Wagner Act is law, replacing strikers is all but over)
  s.men = clamp(s.men + ((g.owners?.member ? 0.06 : 0) + Math.min(0.08, g.jobless / 40000) + (hasTrait(g, "iron") ? 0.04 : 0)) * (lawPassed(g, "wagner") ? 0.3 : 1), 0, 1.2);
  // force against the pickets: sometimes there is shooting
  if (s.force > 0.3 && rng.chance(0.15 * s.force)) {
    const dead = rng.int(1, 4);
    s.dead += dead; s.opinion = clamp(s.opinion + 0.3, -1, 1);
    killed(g, dead, "on the picket line");
  }
  // the works stays out while the siege holds
  const out = s.men < 0.75;
  for (const w of allWorks(c)) if (s.works.includes(w.id)) w.strikeTurns = out ? Math.max(1, w.strikeTurns) : 0;
  // customers drift away in a long strike
  if (s.seasons === 3) for (const ind of [u.industry]) g.mods.push({ kind: "price", mult: 0.97, until: g.turn + 6, source: "Customers lost in the strike", industry: [ind] });
  // the end
  if (u.fund <= 0 || s.men >= 1 || s.force >= 1.5) return breakUnion(g, u, u.fund <= 0 ? "Their fund ran out." : s.men >= 1 ? "Strikebreakers fill the works." : "The troops hold the gates.");
  // a long strike ends in a draw: sooner once both sides have national organisations behind them
  if (s.seasons >= (y >= 1937 ? 3 : 6)) return settle(g, u, true);
}

/** the union is broken: membership crushed, the men back on your terms, a deep grievance */
export function breakUnion(g: GameState, u: Union, why: string) {
  const s = u.siege!, y = year(g), name = unionName(u.industry, y);
  u.siege = undefined; u.membership *= 0.3; u.militancy = Math.max(10, u.militancy - 30); u.recognised = false; u.broken = y; u.lost++; u.fund = 0;
  u.lastDemand = g.turn + 8; // beaten: years before they can try again
  g.company!.biz.policy.union = "fight";
  for (const w of allWorks(g.company!)) if (s.works.includes(w.id)) w.strikeTurns = 0;
  mark(g, { id: "crushed", side: "labour", kind: "precedent", weight: 30, text: `broke the ${name} in ${y}` });
  mark(g, { id: `crushed${y}`, side: "labour", kind: "grievance", weight: 22, text: `broke the strike of ${y}` });
  recordMove(g, "crush");
  bump(g, "labour", -20);
  pushHeadline(g, `Strike Broken at ${g.company!.name}`, `${why} The ${name} men drift back on the company's terms after ${s.seasons} season${s.seasons === 1 ? "" : "s"}.`, "Labor");
}

/** you settle (or the strike ends in a draw): the demand is met, or half of it */
export function settle(g: GameState, u: Union, compromise = false): string {
  const s = u.siege;
  if (!s) return "";
  const y = year(g), name = unionName(u.industry, y);
  u.siege = undefined; u.won++; u.lastDemand = g.turn;
  if (compromise) { u.militancy -= 10; if (s.demand === "wages" || s.demand === "hours") concede(g, u, s.demand); }
  else { concede(g, u, s.demand); if (!u.recognised && y >= 1880) { u.recognised = true; g.company!.biz.policy.union = "recognise"; u.contractUntil = g.turn + 12; recordMove(g, "recognise"); } u.militancy -= 25; }
  for (const w of allWorks(g.company!)) if (s.works.includes(w.id)) w.strikeTurns = 0;
  mark(g, { id: `settled${y}`, side: "labour", kind: "trust", weight: compromise ? 5 : 12, text: compromise ? `met the men halfway in ${y}` : `settled with the ${name} in ${y}` });
  for (const r of g.rivals) r.stance = Math.max(-100, (r.stance ?? 0) - (compromise ? 2 : 6));
  bump(g, "labour", compromise ? 5 : 12);
  const text = compromise ? `After ${s.seasons} seasons, a compromise: ${DEMAND_TEXT[s.demand].half.toLowerCase()}` : `You settle with the ${name}: ${DEMAND_TEXT[s.demand].concede.toLowerCase()}`;
  pushHeadline(g, compromise ? "Strike Ends in Compromise" : `${g.company!.name} Settles`, text, "Labor");
  return text;
}

/** men killed by guards or troops: martyrs the union never forgets */
export function killed(g: GameState, dead: number, where: string) {
  const c = g.company!, y = year(g);
  mark(g, { id: `martyrs${y}`, side: "labour", kind: "grievance", weight: 10 * dead, text: `had strikers shot ${where} in ${y}`, martyrs: dead });
  bump(g, "reputation", -6 * dead); g.morale = Math.max(0, g.morale - 2 * dead);
  if (g.pol) g.pol.scandal = Math.min(30, g.pol.scandal + 4 * dead);
  (g.memorials ??= []).push({ x: c.x + c.footprint + 1, y: c.y + (c.footprint >> 1), year: y, dead, text: `${dead} killed ${where}` });
  pushHeadline(g, `${dead} Strikers Killed at ${c.name}`, `Guards fire into the crowd ${where}; ${dead} ${dead === 1 ? "man is" : "men are"} killed. The union calls them martyrs.`, "Labor");
}

/** the open strikes */
export const sieges = (g: GameState) => Object.values(g.unions ?? {}).filter((u): u is Union => !!u?.siege);

// ---------------------------------------------------------------- the old actions, rewired to the siege

/** strikebreakers: the men front moves (more with the association's help) */
export function sendStrikebreakers(g: GameState): string {
  const S = sieges(g);
  if (!S.length) return "";
  for (const u of S) { u.siege!.men += 0.35 + (hasTrait(g, "iron") ? 0.1 : 0); u.siege!.opinion -= 0.05; }
  g.company!.biz.recruits.push([year(g) >= 1916 && year(g) < 1930 ? 4 : newestGroup(year(g)), 250]);
  mark(g, { id: "scabs", side: "labour", kind: "grievance", weight: 8, text: "brought in strikebreakers" });
  return "Strikebreakers arrive under guard.";
}

/** guards: the force front; sometimes shooting */
export function sendGuards(g: GameState, rng: Rng, kind: "pinkertons" | "police"): string {
  const S = sieges(g);
  for (const u of S) u.siege!.force += kind === "pinkertons" ? 0.6 : 0.3;
  mark(g, { id: kind === "pinkertons" ? "pinkertons" : "companyPolice", side: "labour", kind: "grievance", weight: 12, text: kind === "pinkertons" ? "sent the Pinkertons" : "turned the company police on the pickets" });
  if (rng.chance(0.4)) { const dead = rng.int(2, 7); for (const u of S) u.siege!.dead += dead; killed(g, dead, "at the gates"); return "There is shooting at the gates."; }
  return "The guards take the gates.";
}

export const troopsAllowed = (g: GameState) => governorWillSendTroops(g);

/** what the old random strike chance was, now only before a union exists (or where none forms) */
export function unorganisedStrikeChance(g: GameState, w: Works): number {
  const u = unionFor(g, w.industry);
  if (u) return 0;
  return year(g) >= 1877 && w.employees > 300 ? 0.4 : 0;
}
