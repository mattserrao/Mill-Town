// What could hurt the company next (and what's helping it), worst first: shown as "Watch" on the Overview tab
// and in full on Trends. Everything is read from the current state and the season-by-season history.

import { relationOf } from "../core/economy";
import { allWorks, cal, type GameState, type PricePoint, RECEIVERSHIP } from "../core/game";
import { INDUSTRIES, type IndustryId } from "../core/industries";
import { techStanding } from "../core/market";
import { RIVALS } from "../core/rivals";
import { calendar } from "../core/time";
import { esc } from "../core/text";
import { money } from "./fx";
import { roadPlans } from "../core/roads";
import { complianceOf } from "../core/enviro";
import { marginDebt } from "../core/holdings";

export type Level = "bad" | "warn" | "good";
export interface Risk { level: Level; title: string; detail: string; /** a tab or view that deals with it */ go?: "works" | "policy" | "rivals" | "holdings" | "struggle" }

/** your share of an industry's output in one season (0–1), or undefined before you made any */
export function shareAt(p: PricePoint, ind: IndustryId): number | undefined {
  const mine = p.prodInd?.[ind];
  if (mine === undefined) return undefined;
  let theirs = 0;
  for (const [id, v] of Object.entries(p.rivals ?? {})) {
    const d = RIVALS.find((r) => r.id === id);
    if (d && relationOf(ind, d.industry, id) === "competitor") theirs += v;
  }
  return mine + theirs > 0 ? mine / (mine + theirs) : undefined;
}

/** good for you when the multiplier goes up (price, output) or down (costs, strikes) */
const UP_GOOD: Record<string, boolean> = { price: true, output: true, input: false, wage: false, strike: false, freightCost: false, freightCap: true, labour: true };
const KIND_WORD: Record<string, string> = { price: "price", output: "output", input: "raw materials", wage: "wages", strike: "strikes", freightCost: "freight", freightCap: "barge capacity", labour: "men available" };

export function risks(g: GameState): Risk[] {
  const c = g.company;
  if (!c) return [];
  const out: Risk[] = [];
  const works = allWorks(c);
  const s = c.totals ?? c.lastSeason;
  const year = cal(g).year;

  // strikes and lockouts
  const striking = works.filter((w) => w.status === "strike" || w.strikeTurns > 0);
  if (striking.length) out.push({ level: "bad", title: "On strike", detail: striking.map((w) => w.name).join(", "), go: "policy" });
  if (c.biz.lockout > 0) out.push({ level: "bad", title: "Locked out", detail: `${c.biz.lockout} more season${c.biz.lockout > 1 ? "s" : ""}`, go: "policy" });

  // money
  if (c.cash < 0) out.push({ level: "bad", title: "Overdrawn", detail: `receivers after ${RECEIVERSHIP - (c.redSeasons ?? 0)} more season${RECEIVERSHIP - (c.redSeasons ?? 0) === 1 ? "" : "s"} in the red` });
  else if (s && s.profit < 0) {
    const runway = Math.floor(c.cash / -s.profit);
    out.push({ level: runway < 12 ? "bad" : "warn", title: "Losing money", detail: `${money(s.profit)} a season · cash lasts ${runway > 99 ? "99+" : runway} seasons` });
  }
  if (c.debt > 0) out.push({ level: "warn", title: "Owed to the bank", detail: money(c.debt) });

  // falling behind the industry
  for (const w of works) {
    const st = techStanding(g, w);
    if (st.behind.length) out.push({ level: st.behind.length >= 2 ? "bad" : "warn", title: `${st.behind.length} process${st.behind.length > 1 ? "es" : ""} behind${works.length > 1 ? ` (${w.name})` : ""}`, detail: `price −${Math.round((1 - st.factor) * 100)}% · ${st.behind.map((t) => t.name).join(", ")}`, go: "works" });
  }

  // the world market: orders for only part of the plant (from 1946)
  for (const w of works) {
    const mk = w.market;
    if (!mk || mk.util >= 0.85) continue;
    out.push({ level: mk.util < 0.7 ? "bad" : "warn", title: `Orders for ${Math.round(mk.util * 100)}% of capacity${works.length > 1 ? ` (${w.name})` : ""}`,
      detail: `${mk.imports !== undefined ? `imports ${Math.round(mk.imports * 100)}% · minimills ${Math.round((mk.minimills ?? 0) * 100)}% · ` : ""}your costs ${mk.comp >= 1 ? "at or under" : "over"} the world's${mk.comp < 1 ? " (modernise or cut costs)" : ""}`, go: "works" });
  }
  // the market (from 1893): a glut, and stock piling up in the yards
  for (const ind of new Set(works.map((w) => w.industry))) {
    const mk = g.markets?.[ind];
    if (mk && mk.price < 0.9) out.push({ level: mk.price < 0.8 ? "bad" : "warn", title: `Glut: ${INDUSTRIES[ind].name.toLowerCase()} prices ${Math.round((mk.price - 1) * 100)}%`, detail: `${Math.round((mk.supply / Math.max(1, mk.demand)) * 100)}% of demand on offer · run to orders, bank the furnaces, or wait`, go: "policy" });
  }
  const yards = works.reduce((s2, w) => s2 + (w.stock ?? 0), 0);
  if (yards > 0) out.push({ level: "warn", title: `${yards.toLocaleString("en-US")} unsold in the yards`, detail: "it costs 1.5% of its value a season to carry · dump it or wait for the market", go: "policy" });
  const md = marginDebt(g);
  if (md > 0) out.push({ level: md > c.cash ? "bad" : "warn", title: "Shares on margin", detail: `${money(md)} borrowed from the brokers · a fall of a quarter brings a call`, go: "holdings" });
  if (c.public?.missed) out.push({ level: c.public.missed >= 3 ? "bad" : "warn", title: `${c.public.missed} dividend${c.public.missed > 1 ? "s" : ""} missed`, detail: `outsiders hold ${c.public.outside}% · the shares slide, raiders circle`, go: "holdings" });
  // environmental law: decrees and defiance
  for (const w of works) for (const cp of complianceOf(g, w)) out.push({ level: cp.mode === "defy" ? "bad" : "warn", title: cp.mode === "defy" ? `Defying the ${cp.law}` : `Consent decree: ${cp.law}`,
    detail: cp.mode === "decree" && cp.due !== undefined ? `${w.name} · ${Math.max(0, Math.ceil((cp.due - g.turn) / 4))} years left · ${cp.violations} violations` : `${w.name} · fines most seasons`, go: "works" });

  // the men
  if (c.unrest >= 0.35) out.push({ level: c.unrest >= 0.5 ? "bad" : "warn", title: `Unrest: ${c.unrest >= 0.5 ? "angry" : "restless"}`, detail: "strike risk up", go: "policy" });
  if (c.health < 0.8) out.push({ level: c.health < 0.65 ? "bad" : "warn", title: `Workforce health ${Math.round(c.health * 100)}%`, detail: "sick men make less" });
  const ls = c.lastSeason;
  if (ls && ls.workersWanted > 0 && ls.workersHired < ls.workersWanted * 0.9) out.push({ level: "warn", title: "Short of men", detail: `${ls.workersHired} of ${ls.workersWanted} hired`, go: "policy" });

  // freight lanes filling up
  for (const l of c.freight?.lanes ?? []) if (l.util > 0.85) out.push({ level: l.util > 1 ? "bad" : "warn", title: `${l.good[0].toUpperCase()}${l.good.slice(1)} lane ${Math.round(l.util * 100)}% full`, detail: l.util > 1 ? "deliveries cut, costs up" : "near congestion", go: "works" });

  // market share against ten years ago
  const now = g.prices[g.prices.length - 1];
  const then = g.prices.find((p) => calendar(p.turn).year >= year - 10 && p.prodInd?.[c.industry]);
  if (now && then && then !== now) {
    const a = shareAt(then, c.industry), b = shareAt(now, c.industry);
    if (a !== undefined && b !== undefined && calendar(now.turn).year - calendar(then.turn).year >= 5) {
      if (b < a * 0.85) out.push({ level: "warn", title: "Market share falling", detail: `${Math.round(a * 100)}% → ${Math.round(b * 100)}% since ${calendar(then.turn).year}`, go: "rivals" });
      else if (b > a * 1.15) out.push({ level: "good", title: "Market share rising", detail: `${Math.round(a * 100)}% → ${Math.round(b * 100)}% since ${calendar(then.turn).year}` });
    }
  }

  // timed effects of events on your industry
  const mine = new Set(works.map((w) => w.industry));
  const seen = new Set<string>();
  for (const m of g.mods) {
    if (m.until <= g.turn || Math.abs(m.mult - 1) < 0.02 || !(m.kind in UP_GOOD)) continue;
    if (m.industry && !m.industry.some((i) => mine.has(i))) continue;
    const key = `${m.source}|${m.kind}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const good = (m.mult > 1) === UP_GOOD[m.kind];
    // effects that outlast the game are the new normal: worth knowing, not alarming
    const lasting = calendar(m.until).year > 1985;
    out.push({ level: good ? "good" : !lasting && Math.abs(m.mult - 1) >= 0.15 ? "bad" : "warn", title: m.source, detail: `${KIND_WORD[m.kind]}${m.good ? ` (${m.good})` : ""} ${m.mult > 1 ? "+" : "−"}${Math.round(Math.abs(m.mult - 1) * 100)}% · ${lasting ? "lasting" : `to ${calendar(m.until).year}`}` });
  }

  // stakes in works that history is about to close
  for (const [id, pct] of Object.entries(c.holdings?.stakes ?? {})) {
    const d = RIVALS.find((r) => r.id === id);
    if (d?.closes && d.closes - year <= 4 && d.closes >= year) out.push({ level: "bad", title: `Your ${pct}% of ${d.company.replace(/ \(.*\)$/, "")} at risk`, detail: `the works is due to close · sell before ${d.closes}`, go: "holdings" });
  }
  // a road that would bring many more men within reach
  const road = roadPlans(g)[0];
  if (road && road.gain >= 150) out.push({ level: "good", title: `Road to ${road.to} would help`, detail: `+${road.gain.toLocaleString("en-US")} in reach · ${money(road.cost)} or influence`, go: "works" });

  const rank: Record<Level, number> = { bad: 0, warn: 1, good: 2 };
  return out.sort((a, b) => rank[a.level] - rank[b.level]);
}

export const LEVEL_COLOUR: Record<Level, string> = { bad: "#e06a5a", warn: "#e0a243", good: "#7fc77a" };

export function riskRows(list: Risk[], buttons = true): string {
  if (!list.length) return `<p class="hint">Nothing to worry about this season.</p>`;
  return list.map((r) => `<div class="risk"><i style="background:${LEVEL_COLOUR[r.level]}"></i><div><b>${esc(r.title)}</b><span>${esc(r.detail)}</span></div>${buttons && r.go ? `<button data-go="${r.go}">${{ works: "Works", policy: "Policy", rivals: "Rivals", holdings: "Holdings", struggle: "Struggle" }[r.go]}</button>` : ""}</div>`).join("");
}

export const industryName = (id: IndustryId) => INDUSTRIES[id].name;
