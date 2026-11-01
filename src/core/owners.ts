// The other owners fight back. Each rival owner keeps a stance toward your family (ally … hostile) and watches
// what you do. When you move — cut prices, poach men, buy into them, build, recognise or crush the union, fund
// the reformers, bribe — they answer by personality, often telegraphing it a season ahead so you can pre-empt.
// The owners' association shares strikebreakers and blacklists; break ranks and they throw you out. Morgan's
// 1901 trust can swallow a weak steel company, and later a hostile owner can bid for yours.

import { worksValue } from "./value";
import { type ActionDef, bump, type Decision, type DecisionOption, pushHeadline } from "./business";
import { allWorks, cal, type GameState, log, type RivalState } from "./game";
import { type IndustryId } from "./industries";
import { mark } from "./ledger";
import { RIVALS, type RivalDef } from "./rivals";
import { rivalName } from "./rivalai";
import type { Rng } from "./rng";
import { priceLevel } from "./time";
import { polOf } from "./politics";
import { beginSuccession } from "./family";
import { holdingsOf, sharePrice, rivalValue } from "./holdings";
import { sieges } from "./labour";

export type MoveKind = "undercut" | "poach" | "stake" | "expand" | "tech" | "recognise" | "crush" | "fund_reform" | "fund_business" | "bribe" | "sabotage" | "buy" | "rumour" | "espionage";
export interface Move { kind: MoveKind; turn: number; target?: string; industry?: IndustryId }
export interface Intent { kind: string; at: number; text: string; target?: string }
export interface OwnersState { member: boolean; expelled?: number; dues?: number }

const defOf = (r: RivalState) => RIVALS.find((d) => d.id === r.id)!;
const year = (g: GameState) => cal(g).year;
const open = (g: GameState) => g.rivals.filter((r) => r.active && !r.owned && !r.closed);
const styleOf = (r: RivalState): RivalDef["style"] => r.style ?? defOf(r).style;
const nm = (g: GameState, r: RivalState) => rivalName(defOf(r), year(g));
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
export const ownersOf = (g: GameState): OwnersState => (g.owners ??= { member: true });

export function stanceWord(s = 0): string { return s <= -50 ? "hostile" : s <= -15 ? "wary" : s < 25 ? "neutral" : "ally"; }

/** You did something the other owners will notice. */
export function recordMove(g: GameState, kind: MoveKind, target?: string, industry?: IndustryId) {
  const M = (g.moves ??= []);
  M.push({ kind, turn: g.turn, target, industry: industry ?? g.company?.industry });
  while (M.length > 30) M.shift();
  const r = target ? g.rivals.find((x) => x.id === target) : undefined;
  const hit: Partial<Record<MoveKind, number>> = { undercut: -10, poach: -8, stake: -6, sabotage: -25, rumour: -12, espionage: -12, buy: -4 };
  if (r && hit[kind]) r.stance = clamp((r.stance ?? 0) + hit[kind]!, -100, 100);
  if (kind === "recognise" && ownersOf(g).member && year(g) < 1937) expel(g, "recognised the union");
  if (kind === "crush") for (const x of open(g)) x.stance = clamp((x.stance ?? 0) + 4, -100, 100);
}

function expel(g: GameState, why: string) {
  const o = ownersOf(g);
  if (!o.member) return;
  o.member = false; o.expelled = year(g);
  for (const r of open(g)) r.stance = clamp((r.stance ?? 0) - 15, -100, 100);
  mark(g, { id: "expelled", side: "owners", kind: "grudge", weight: 20, text: `was thrown out of the owners' association for having ${why}` });
  pushHeadline(g, "Owners Expel " + g.company!.name, `The iron and steel manufacturers' association expels ${g.company!.name}: it ${why}. No more shared strikebreakers, no more blacklists.`, "Industry");
}

/** who answers a move, and how likely */
function answerers(g: GameState, m: Move): RivalState[] {
  const rs = open(g).filter((r) => (r.stance ?? 0) < 40 && (g.company?.holdings?.stakes[r.id] ?? 0) < 20);
  if (m.target) return rs.filter((r) => r.id === m.target);
  return rs.filter((r) => defOf(r).industry === m.industry || ["recognise", "crush", "fund_reform", "bribe"].includes(m.kind));
}
const eager = (r: RivalState) => ({ aggressive: 0.85, integrator: 0.7, financier: 0.6, innovator: 0.6, steady: 0.45 }[styleOf(r)] + (r.stance ?? 0) / -250);

/** Each season, before the rivals' own moves: telegraphed intents come due, and the latest moves get answers. */
export function ownersSeason(g: GameState, rng: Rng) {
  const c = g.company;
  if (!c) return;
  const y = year(g), o = ownersOf(g);
  // dues; the association's strength
  if (o.member && y >= 1876) c.cash -= Math.round(400 * priceLevel(y));
  for (const r of open(g)) {
    r.stance = clamp((r.stance ?? 0) * 0.995, -100, 100);
    if (r.intent && r.intent.at <= g.turn) { const it = r.intent; r.intent = undefined; act(g, r, it, rng); }
  }
  // answer the moves of the last two seasons (each once)
  const fresh = (g.moves ?? []).filter((m) => m.turn >= g.turn - 1 && !(m as Move & { answered?: boolean }).answered);
  for (const m of fresh) {
    (m as Move & { answered?: boolean }).answered = true;
    const cands = answerers(g, m).sort((a, b) => eager(b) - eager(a));
    let answered = 0;
    for (const r of cands) {
      if (r.intent || answered >= 2) continue;
      if (!rng.chance(answered ? eager(r) * 0.5 : Math.max(0.6, eager(r)))) continue;
      const it = counter(g, r, m);
      if (!it) continue;
      answered++;
      // half the answers are telegraphed a season ahead; the rest come at once
      if (rng.chance(0.5)) { r.intent = { ...it, at: g.turn + 1 }; log(g, `${nm(g, r)}: ${it.text} (next season).`); }
      else act(g, r, it, rng);
    }
  }
  // a weak company invites a bid (from 1905)
  if (y >= 1905 && !g.pendingDecision && (c.redSeasons ?? 0) >= 2 && !c.biz.flags.bidTurn) {
    const bidder = open(g).filter((r) => ["aggressive", "financier"].includes(styleOf(r)) && (r.stance ?? 0) <= 0)[0];
    if (bidder) { c.biz.flags.bidTurn = g.turn; c.biz.flags.bidder = bidder.id; const d = takeoverDecision(g); if (d) g.pendingDecision = d; }
  }
  if (c.biz.flags.bidTurn && g.turn - Number(c.biz.flags.bidTurn) > 20) delete c.biz.flags.bidTurn;
}

/** the counter table: what an owner answers to your move, by personality */
function counter(g: GameState, r: RivalState, m: Move): Intent | null {
  const s = styleOf(r), y = year(g), name = nm(g, r);
  const at = g.turn;
  switch (m.kind) {
    case "undercut": return { kind: "pricewar", at, text: `${name} is cutting prices to answer yours` };
    case "poach": return s === "steady" ? { kind: "complain", at, text: `${name} complains to the association about your poaching` } : { kind: "poachback", at, text: `${name} is hiring away your best men in return` };
    case "stake": return s === "financier" || r.id === "mellon" ? { kind: "whiteknight", at, text: `${name} goes to the Mellon bank for a white knight` } : rngLike(g, r) ? { kind: "poisonpill", at, text: `${name} is issuing new shares to dilute your stake` } : { kind: "counterbuy", at, text: `${name}'s owners are buying back their own shares` };
    case "expand": case "tech":
      return s === "integrator" && y >= 1881 ? { kind: "corner", at, text: `${name} is buying up the coke ovens you need` } : { kind: "race", at, text: `${name} is racing you: more furnaces, more mills` };
    case "recognise": return y >= 1937 ? { kind: "pattern", at, text: `${name} watches the union win at your works` } : { kind: "customers", at, text: `${name} is warning your customers off a union shop` };
    case "crush": return s === "aggressive" ? { kind: "poachback", at, text: `${name} is hiring your best men while your works is in turmoil` } : { kind: "cheer", at, text: `${name} offers strikebreakers and congratulations` };
    case "fund_reform": return { kind: "fundback", at, text: `${name} is pouring money into the business ticket against your reformers` };
    case "bribe": return (r.stance ?? 0) < -10 ? { kind: "expose", at, text: `${name}'s detectives are digging into your dealings at City Hall` } : null;
    case "sabotage": case "rumour": case "espionage": return (r.stance ?? 0) < -20 ? { kind: "sue", at, text: `${name}'s lawyers are preparing a suit` } : null;
    case "buy": return s === "aggressive" ? { kind: "race", at, text: `${name} expands to stay ahead of your new works` } : null;
    default: return null;
  }
}
const rngLike = (g: GameState, r: RivalState) => (g.turn + r.ownerId) % 2 === 0;

/** carry out an answer (pre-empted where you've taken the right precaution) */
function act(g: GameState, r: RivalState, it: Intent, _rng: Rng) {
  const c = g.company!, y = year(g), name = nm(g, r), def = defOf(r), era = priceLevel(y);
  let text = "";
  if ((c.holdings?.stakes[r.id] ?? 0) >= 20) { r.answered = `${y}: stood down (you hold a fifth of it)`; return; }
  switch (it.kind) {
    case "pricewar":
      g.mods.push({ kind: "price", mult: 0.93, until: g.turn + 4, source: `${name} answers your price cut`, industry: [def.industry] });
      text = "cut prices to answer yours (−7% for a year)"; break;
    case "poachback":
      bump(g, "labour", -4);
      for (const w of allWorks(c)) if (w.industry === def.industry) g.mods.push({ kind: "output", mult: 0.92, until: g.turn + 2, source: `${name} hired away your men`, industry: [w.industry] });
      text = "hired away your best rollers (output −8% for two seasons)"; break;
    case "complain":
      for (const x of open(g)) x.stance = clamp((x.stance ?? 0) - 4, -100, 100);
      text = "complained of you to the other owners"; break;
    case "whiteknight": r.defence = Math.max(r.defence ?? 1, 1.5); text = "found a white knight: its shares cost you half again as much"; break;
    case "counterbuy": r.defence = Math.max(r.defence ?? 1, 1.3); text = "bought back its shares: your next stake costs 30% more"; break;
    case "poisonpill": {
      const h = holdingsOf(g), pct = h.stakes[r.id] ?? 0;
      if (pct >= 10) { h.stakes[r.id] = Math.max(0, Math.floor((pct * 0.7) / 10) * 10); if (!h.stakes[r.id]) delete h.stakes[r.id]; }
      text = `issued new shares: your stake is diluted to ${h.stakes[r.id] ?? 0}%`; break;
    }
    case "corner":
      if (c.holdings?.biz.some((b) => b.id === "coke" || b.id === "coal")) { text = "tried to corner the coke, but you own your own"; break; }
      g.mods.push({ kind: "input", mult: 1.15, until: g.turn + 6, source: `${name} corners the coke` });
      text = "cornered the coke: your input costs +15% for six seasons"; break;
    case "race": r.expand = Math.min(1.2, r.expand + 0.15); text = "built more furnaces and mills to keep ahead of you"; break;
    case "customers":
      for (const w of allWorks(c)) g.mods.push({ kind: "price", mult: 0.96, until: g.turn + 4, source: `${name} warns your customers`, industry: [w.industry] });
      text = "warned your customers off a union shop (prices −4% for a year)"; break;
    case "pattern":
      r.stance = clamp((r.stance ?? 0) + 5, -100, 100);
      g.mods.push({ kind: "wage", mult: 1.02, until: g.turn + 8, source: "Pattern bargaining", industry: [def.industry] });
      text = "followed your lead and signed too (pattern bargaining)"; break;
    case "cheer":
      for (const u of sieges(g)) u.siege!.men += 0.15;
      r.stance = clamp((r.stance ?? 0) + 5, -100, 100);
      text = "sent strikebreakers to help"; break;
    case "fundback": {
      const p = polOf(g);
      for (const lv of ["city", "state"] as const) { const f = p.fund[lv]; if (f?.side === "reform") f.amount = Math.max(0, f.amount - Math.round(6000 * era)); }
      text = "poured money into the business ticket against your reformers"; break;
    }
    case "expose":
      if (c.biz.pressUntil > g.turn) { text = "dug into your dealings, but the editors wouldn't print it"; break; }
      bump(g, "reputation", -15); bump(g, "influence", -10);
      polOf(g).scandal = Math.min(30, polOf(g).scandal + 10);
      polOf(g).favours = [];
      mark(g, { id: "exposed", side: "public", kind: "grievance", weight: 15, text: "was exposed for buying officials" });
      pushHeadline(g, `${c.name}'s Payments to Officials Exposed`, `Detectives hired by ${name} hand the papers a councilman's bank book. Every favour you were owed is gone.`, "Politics");
      text = "exposed your payments to officials"; break;
    case "sue": {
      const fine = Math.round(25000 * era);
      c.cash -= fine;
      text = `took you to court ($${fine.toLocaleString("en-US")} in damages)`; break;
    }
  }
  if (!text) return;
  r.answered = `${y}: ${text}`;
  r.lastMove = r.answered;
  log(g, `${name} ${text}.`);
}

export const OWNER_ACTIONS: ActionDef[] = [
  {
    id: "rejoin", group: "Rivals", name: "Rejoin the owners' association",
    blurb: "Make peace with the other owners: their strikebreakers and blacklists again, and every rival a little friendlier. Not while you recognise the union (before 1937).",
    cost: (g) => Math.round(10000 * priceLevel(year(g))),
    blocked: (g) => (ownersOf(g).member ? "You are a member" : g.company!.biz.flags.coop ? "The owners won't have a co-operative" : year(g) < 1937 && g.company!.biz.policy.union === "recognise" ? "Not while you recognise the union" : null),
    run: (g) => { const o = ownersOf(g); o.member = true; o.expelled = undefined; for (const r of open(g)) r.stance = clamp((r.stance ?? 0) + 10, -100, 100); return "The association takes you back."; },
  },
];

/** rivals' heirs: at each new era their stance toward you softens by half */
export function ownersSuccession(g: GameState) {
  for (const r of g.rivals) if (r.stance) r.stance = Math.round(r.stance * 0.5);
}

/** rivals who will fund against you in elections (hostile ones) */
export const hostileOwners = (g: GameState) => open(g).filter((r) => (r.stance ?? 0) <= -50);

// ---------------------------------------------------------------- mergers and takeovers

/** Morgan's offer, when you're a steel company (weak: refusing may not save you) */
export function mergerOptions(g: GameState): DecisionOption[] {
  const c = g.company!;
  if (!allWorks(c).some((w) => w.industry === "steel")) return [];
  const val = companyValue(g);
  const weak = c.cash < 0 || (c.redSeasons ?? 0) >= 2 || c.debt > 0 && c.cash < c.debt;
  return [{
    label: "Sell out to Morgan for U.S. Steel stock",
    detail: `Morgan pays $${Math.round(val * 1.6).toLocaleString("en-US")} in U.S. Steel stock. The family retires rich: an early succession.`,
    apply: (g) => swallowed(g, Math.round(val * 1.6)),
  }, ...(weak ? [{
    label: "Refuse — even now",
    detail: "You're weak: Morgan's bankers hold your notes. Half the time they call them and take the works anyway.",
    apply: (g: GameState, rng: Rng) => {
      if (rng.chance(0.5)) return swallowed(g, Math.round(val * 0.9));
      g.mods.push({ kind: "price", mult: 0.9, until: g.turn + 8, source: "Morgan's trust squeezes you", industry: ["steel"] });
      return "You hold out. The trust squeezes your prices for two years.";
    },
  }] : [])];
}

/** what the whole company would fetch (eight seasons of sales, works by works) */
/** what the company's works are worth to a buyer (src/core/value.ts) */
export function companyValue(g: GameState): number {
  const c = g.company!;
  return Math.max(100000, allWorks(c).reduce((s, w) => s + worksValue(g, w), 0));
}

/** paid in U.S. Steel stock: the family's works become a division (or the heir builds something new) */
function swallowed(g: GameState, value: number): string {
  const c = g.company!, h = holdingsOf(g);
  const px = Math.max(1, sharePrice(g, "uss") || 50);
  h.shares.uss = (h.shares.uss ?? 0) + Math.round(value / px);
  h.shareCost.uss = (h.shareCost.uss ?? 0) + value;
  c.biz.flags.division = "uss"; c.biz.flags.toUss = true;
  mark(g, { id: "soldToMorgan", side: "owners", kind: "precedent", weight: 20, text: "sold out to Morgan's trust" });
  pushHeadline(g, `${c.name} Joins the Steel Trust`, `Morgan's men pay $${value.toLocaleString("en-US")} in U.S. Steel stock. The family's works will run as a division of the Corporation.`, "Industry");
  beginSuccession(g, "merger", value, ["business", "industry", "politics", "financier"]);
  return "The family sells to Morgan.";
}

/** a hostile owner bids for your company when you're overdrawn */
export function takeoverDecision(g: GameState): Decision | null {
  const c = g.company, id = c?.biz.flags.bidder as string | undefined;
  const r = id ? g.rivals.find((x) => x.id === id) : undefined;
  if (!c || !r) return null;
  const price = Math.round(companyValue(g) * 0.7), name = nm(g, r), y = year(g);
  return {
    id: `takeover_${g.turn}`, source: "takeover", historical: 1,
    title: `${name} bids for ${c.name}`,
    text: `With ${c.name} overdrawn, ${name}'s owners offer $${price.toLocaleString("en-US")} for the company. The papers expect you to take it.`,
    options: [
      { label: "Accept the bid", detail: "Take the money: the works goes to them when the family's next works opens. An early succession: the heir must build anew.",
        apply: (g) => { c.cash += price; c.biz.flags.toUss = true; r.expand = Math.min(1.5, r.expand + 0.3); beginSuccession(g, "takeover", price, ["industry"]); return `You accept ${name}'s bid.`; } },
      { label: "Fight it off", detail: `A poison pill and new loans: $${Math.round(40000 * priceLevel(y)).toLocaleString("en-US")} and influence −10. They'll remember.`,
        apply: (g) => { c.cash -= Math.round(40000 * priceLevel(y)); bump(g, "influence", -10); r.stance = clamp((r.stance ?? 0) - 25, -100, 100); return "The bid is beaten off — at a price."; } },
    ],
  };
}

/** the rival values with their defences, for the stake price */
export const defended = (g: GameState, id: string) => rivalValue(g, id) * (g.rivals.find((r) => r.id === id)?.defence ?? 1);
