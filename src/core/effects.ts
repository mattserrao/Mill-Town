// What historical events do in play. Every event in docs/EVENTS.csv can carry effects, keyed by its Event Name
// (see the tables in src/core/eventdata/). An effect is one of the typed variants below; firing an event applies
// each of its effects in turn. docs/EVENTS-PLAN.md explains the design; docs/EVENTS-ACTIONS.md lists every event.
//
//   mods       timed multipliers (price, wage, strike, output, input, migrants, pollution, labour, freight…),
//              optionally scoped to an industry, an input good or a river/rail gateway
//   meters     one-off changes to reputation, labour relations, influence (your company) or town morale
//   clear      end the timed effects an earlier event started (a war ends, a strike settles)
//   place      a timed unrest/health offset for a named place
//   flag       remember something (a company choice or a state of the world) for later effects and decisions
//   rule       change what an action costs, whether it's allowed, what it yields and how risky it is
//   politics   the political era (machine, reform, New Deal, Renaissance) that sets lobbying and bribery
//   rival      a rival works expands, is damaged, partly or wholly closes, reopens, or changes personality
//   cash       a one-off payment or fine for your company
//   flood / epidemic   existing special effects (a flood season; disease in crowded wards, near a place)
//   migrate    a community arrives at (or leaves) named places
//   landmark   a dated building appears on the map (or changes state: closed, ruin)
//   blast      an explosion clears tiles around a place
//   clearance  homes in a place are cleared and their people moved elsewhere
//   team       a sports team is founded, moves ground, wins a title (see sports.ts)
//
// Conditions ("if") are short strings, all of which must hold: company / !company, industry:steel,glass,
// tech:open_hearth / !tech:bof, flag:name / !flag:name / flag:name=value, union:recognise, policy:waste=dump,
// men>=400, year>=1900, rival:carnegie (open and not owned).

import { GROUPS } from "./ancestry";
import type { Meters } from "./business";
import { allWorks, cal, type GameState, log, totalEmployees } from "./game";
import type { GatewayId } from "./freight";
import type { Good, IndustryId } from "./industries";
import type { ModKind } from "./events";
import type { RivalDef } from "./rivals";

export type Cond = string;

export interface Scope { industry?: IndustryId | IndustryId[]; good?: Good; gateway?: GatewayId | "rail" }
export type PoliticalEra = "early" | "machine" | "reform" | "newdeal" | "renaissance";

export interface Rule {
  /** a reason the action is blocked, or null to allow it again */
  blocked?: string | null;
  /** cost multiplier */
  cost?: number;
  /** what it yields (influence for lobby/bribe), as a multiplier */
  yield?: number;
  /** chance it goes wrong (bribe exposure, police violence) */
  risk?: number;
}

export type Effect =
  | { mods: [ModKind, number, number][]; scope?: Scope; if?: Cond }
  | { flood: number }
  | { epidemic: number; place?: string }
  | { meters: Partial<Meters> & { morale?: number }; if?: Cond }
  | { clear: string }
  | { place: string; unrest?: number; health?: number; seasons: number }
  | { flag: string; value?: number | string | boolean; if?: Cond }
  | { rule: string; set: Rule }
  | { politics: PoliticalEra }
  | { rival: string; expand?: number; damage?: [number, number]; strike?: number; close?: boolean; partial?: number; reopen?: boolean; style?: RivalDef["style"]; rename?: string }
  | { cash: number; if?: Cond; why?: string }
  | { migrate: { group: number; people: number; places: string[] } }
  | { landmark: string; state?: "open" | "closed" | "ruin" }
  | { blast: { place: string; radiusM: number; ruinSeasons: number } }
  | { clearance: { place: string; radiusM: number; to: string[] } }
  | { team: string; act: "found" | "move" | "title" | "rename"; ground?: string; name?: string }
  | { note: string };

// ---------------------------------------------------------------- conditions

export function cond(g: GameState, c?: Cond): boolean {
  if (!c) return true;
  return c.split(/\s+/).every((part) => atom(g, part));
}

function atom(g: GameState, a: string): boolean {
  if (!a) return true;
  const neg = a.startsWith("!");
  const s = neg ? a.slice(1) : a;
  const r = evalAtom(g, s);
  return neg ? !r : r;
}

function evalAtom(g: GameState, s: string): boolean {
  const c = g.company;
  if (s === "company") return !!c;
  const m = /^(men|year|cash|reputation|labour|influence|morale)(>=|<=|>|<)(-?\d+)$/.exec(s);
  if (m) {
    const v = m[1] === "men" ? (c ? totalEmployees(c) : 0) : m[1] === "year" ? cal(g).year : m[1] === "cash" ? c?.cash ?? 0
      : m[1] === "morale" ? g.morale : c ? c.biz.meters[m[1] as keyof Meters] : 0;
    const n = Number(m[3]);
    return m[2] === ">=" ? v >= n : m[2] === "<=" ? v <= n : m[2] === ">" ? v > n : v < n;
  }
  const [k, rest = ""] = s.split(":");
  switch (k) {
    case "industry": return !!c && allWorks(c).some((w) => rest.split(",").includes(w.industry));
    case "tech": return !!c && allWorks(c).some((w) => w.techs.includes(rest));
    case "flag": { const [f, val] = rest.split("="); const v = c?.biz.flags[f] ?? g.flags[f]; return val === undefined ? !!v : String(v) === val; }
    case "union": return !!c && c.biz.policy.union === rest;
    case "policy": { const [p, val] = rest.split("="); return !!c && String((c.biz.policy as unknown as Record<string, unknown>)[p]) === val; }
    case "rival": return g.rivals.some((r) => r.id === rest && r.active && !r.owned && !r.closed);
    case "politics": return g.politics === rest;
  }
  return true;
}

// ---------------------------------------------------------------- applying effects

export interface EffectHooks {
  /** set by game.ts so effects.ts needn't import the map-changing systems directly */
  landmark?: (g: GameState, id: string, state?: "open" | "closed" | "ruin") => void;
  migrate?: (g: GameState, group: number, people: number, places: string[]) => number;
  blast?: (g: GameState, place: string, radiusM: number, ruinSeasons: number) => void;
  clearance?: (g: GameState, place: string, radiusM: number, to: string[]) => number;
  epidemic?: (g: GameState, share: number, place?: string) => void;
  team?: (g: GameState, team: string, act: "found" | "move" | "title" | "rename", ground?: string, name?: string) => void;
}
export const HOOKS: EffectHooks = {};

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** Apply one event's effects (name is the Event Name, used as the source of its timed mods). */
export function applyEffects(g: GameState, name: string, effects: Effect[]) {
  const c = g.company;
  for (const ef of effects) {
    if ("mods" in ef) {
      if (!cond(g, ef.if)) continue;
      for (const [kind, mult, dur] of ef.mods) g.mods.push({ kind, mult, until: g.turn + dur, source: name, ...scopeOf(ef.scope) });
    } else if ("flood" in ef) g.floodNow = ef.flood;
    else if ("epidemic" in ef) HOOKS.epidemic?.(g, ef.epidemic, ef.place);
    else if ("meters" in ef) {
      if (!cond(g, ef.if)) continue;
      for (const [k, v] of Object.entries(ef.meters) as [keyof Meters | "morale", number][]) {
        if (k === "morale") g.morale = clamp(g.morale + v, 0, 100);
        else if (c) c.biz.meters[k] = clamp(c.biz.meters[k] + v, k === "influence" ? 0 : -100, 100);
      }
    } else if ("clear" in ef) {
      g.mods = g.mods.filter((m) => m.source !== ef.clear);
      g.placeFx = g.placeFx.filter((p) => p.source !== ef.clear);
    } else if ("place" in ef) g.placeFx.push({ place: ef.place, unrest: ef.unrest ?? 0, health: ef.health ?? 0, until: g.turn + ef.seasons, source: name });
    else if ("flag" in ef) {
      if (!cond(g, ef.if)) continue;
      g.flags[ef.flag] = ef.value ?? true;
    } else if ("rule" in ef) {
      g.rules[ef.rule] = { ...(g.rules[ef.rule] ?? {}), ...ef.set };
      // a policy the law now forbids is dropped
      const p = g.company?.biz.policy;
      if (p && ef.set.blocked) {
        if (ef.rule === "police" && p.police) { p.police = false; log(g, "Your company police are disbanded by law."); }
        if (ef.rule === "halfHoliday" && p.halfHoliday) p.halfHoliday = false;
      }
    }
    else if ("politics" in ef) g.politics = ef.politics;
    else if ("rival" in ef) rivalEffect(g, name, ef);
    else if ("cash" in ef) {
      if (!c || !cond(g, ef.if)) continue;
      c.cash += ef.cash;
      if (ef.why) log(g, `${ef.why} (${ef.cash < 0 ? "−" : "+"}$${Math.abs(ef.cash).toLocaleString()})`);
    } else if ("migrate" in ef) {
      const n = HOOKS.migrate?.(g, ef.migrate.group, ef.migrate.people, ef.migrate.places) ?? 0;
      if (n) log(g, `${n.toLocaleString()} ${GROUPS[ef.migrate.group]?.name ?? ""} ${ef.migrate.people < 0 ? "leave" : "arrive"}.`);
    } else if ("landmark" in ef) HOOKS.landmark?.(g, ef.landmark, ef.state);
    else if ("blast" in ef) HOOKS.blast?.(g, ef.blast.place, ef.blast.radiusM, ef.blast.ruinSeasons);
    else if ("clearance" in ef) HOOKS.clearance?.(g, ef.clearance.place, ef.clearance.radiusM, ef.clearance.to);
    else if ("team" in ef) HOOKS.team?.(g, ef.team, ef.act, ef.ground, ef.name);
    else if ("note" in ef) log(g, ef.note);
  }
}

function scopeOf(s?: Scope): { industry?: IndustryId[]; good?: Good; gateway?: GatewayId | "rail" } {
  if (!s) return {};
  return { industry: s.industry ? (Array.isArray(s.industry) ? s.industry : [s.industry]) : undefined, good: s.good, gateway: s.gateway };
}

function rivalEffect(g: GameState, source: string, ef: Extract<Effect, { rival: string }>) {
  const r = g.rivals.find((x) => x.id === ef.rival);
  if (!r) { if (ef.reopen === undefined) g.pendingRivalFx.push({ source, ef }); return; }
  if (r.owned) return; // it's yours now: history happens to the rivals, not to you
  if (ef.expand) r.expand = Math.min(1.5, r.expand + ef.expand);
  if (ef.damage) r.damage.push({ mult: ef.damage[0], until: g.turn + ef.damage[1], why: source });
  if (ef.strike) { r.strikeUntil = g.turn + ef.strike; r.damage.push({ mult: 0.1, until: g.turn + ef.strike, why: `strike (${source})` }); }
  if (ef.partial !== undefined) r.partial = ef.partial;
  if (ef.close) { r.closed = true; r.lastMove = `${cal(g).year}: closed`; }
  if (ef.reopen) r.closed = false;
  if (ef.style) r.style = ef.style;
  if (ef.rename) { r.name = ef.rename; r.nameYear = cal(g).year; }
}

/** rival effects that arrived before the rival opened (applied when it does) */
export function applyPendingRivalFx(g: GameState) {
  const keep: typeof g.pendingRivalFx = [];
  for (const p of g.pendingRivalFx) {
    if (g.rivals.some((r) => r.id === (p.ef as { rival: string }).rival)) rivalEffect(g, p.source, p.ef as Extract<Effect, { rival: string }>);
    else keep.push(p);
  }
  g.pendingRivalFx = keep;
}
