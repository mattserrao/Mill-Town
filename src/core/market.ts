// The market: what your product fetches against the rivals', and the technology race that sets it.
//
//   Technology   every process your industry has had for four years or more is the standard; each one you lack
//                makes your product dearer to make and worse than theirs (−10% on price each), each one you have
//                before the rivals do is worth +4%. Westinghouse (the innovator) sets the standard as soon as a
//                process appears.
//   Supply       when rival works in your industry are crippled (strikes, fires, your sabotage) the price rises;
//                every rival works you own gives you a little pricing power.
//   Research     commission a process: pay up front, wait its seasons, meet its milestones.

import { INDUSTRIES, type IndustryId, type Tech } from "./industries";
import { cal, type GameState, log, type RivalState, techsForYear, type Works } from "./game";
import { RIVALS } from "./rivals";

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** what a rival works is producing relative to its standard: expansions, damage, the collapse */
export function rivalMult(g: GameState, r: RivalState): number {
  let m = (1 + r.expand) * (r.partial ?? 1);
  for (const d of r.damage) if (d.until > g.turn) m *= d.mult;
  return m;
}

/** the processes a rival in this industry runs this year */
export function rivalTechs(ind: IndustryId, id: string, year: number): string[] {
  const def = RIVALS.find((d) => d.id === id);
  return techsForYear(ind, (def?.style === "innovator" ? year + 2 : year) - (def?.techLag ?? 0));
}

/** the industry's standard processes: what every serious works has (the innovator sets it early) */
export function standardTechs(g: GameState, ind: IndustryId): string[] {
  const year = cal(g).year;
  const innovator = g.rivals.some((r) => r.active && RIVALS.find((d) => d.id === r.id && d.industry === ind)?.style === "innovator");
  return INDUSTRIES[ind].tech.filter((t) => t.cost > 0 && t.year <= (innovator ? year : year - 4)).map((t) => t.id);
}

export interface TechStanding { behind: Tech[]; ahead: Tech[]; factor: number }

/** how a works' processes compare with the industry's: the price factor and what you lack */
export function techStanding(g: GameState, w: Works): TechStanding {
  const ind = INDUSTRIES[w.industry], year = cal(g).year;
  const std = new Set(standardTechs(g, w.industry));
  const common = new Set(techsForYear(w.industry, year));
  const behind = ind.tech.filter((t) => std.has(t.id) && !w.techs.includes(t.id));
  const ahead = ind.tech.filter((t) => t.cost > 0 && w.techs.includes(t.id) && !common.has(t.id));
  return { behind, ahead, factor: clamp((1 - 0.1 * behind.length) * (1 + 0.04 * ahead.length), 0.4, 1.2) };
}

/** supply in an industry: crippled rivals lift the price, owned works give pricing power */
export function marketFactor(g: GameState, ind: IndustryId): number {
  let nominal = 0, lost = 0, owned = 0;
  for (const r of g.rivals) {
    const def = RIVALS.find((d) => d.id === r.id);
    if (!def || def.industry !== ind || def.id === "frick") continue;
    if (r.owned) { owned++; continue; }
    if (!r.active || r.closed) continue;
    nominal += 1 + r.expand;
    lost += Math.max(0, 1 + r.expand - rivalMult(g, r));
  }
  const mine = g.company ? [g.company, ...g.company.others].filter((w) => w.industry === ind).length : 0;
  const share = nominal ? lost / (nominal + mine) : 0;
  return clamp(1 + 0.3 * share + 0.03 * owned, 0.8, 1.25) * imports(ind, cal(g).year);
}

/** from 1960, Japanese and European steel (and then everything else) undercuts the valley */
export function imports(ind: IndustryId, year: number): number {
  const per = ind === "steel" ? 0.025 : ind === "metalworks" ? 0.015 : ind === "glass" ? 0.01 : 0;
  return Math.max(0.45, 1 - per * Math.max(0, year - 1960));
}

// ---------------------------------------------------------------- research

const ERA = (year: number) => 1 + Math.max(0, year - 1900) * 0.01; // dearer to build as the century goes on

/** what a process costs to commission now */
export function techCost(t: Tech, year: number) { return Math.round(t.cost * ERA(year)); }

/** null if a works can commission a process now, otherwise why not */
export function techBlocked(g: GameState, w: Works, t: Tech): string | null {
  const year = cal(g).year;
  if (w.techs.includes(t.id)) return "Installed";
  if (w.research) return w.research.id === t.id ? "Being built" : "Another project is under way";
  if (t.year > year) return `Not invented until ${t.year}`;
  const missing = t.requires.filter((r) => !w.techs.includes(r));
  if (missing.length) return `Needs ${missing.map((r) => INDUSTRIES[w.industry].tech.find((x) => x.id === r)?.name ?? r).join(", ")}`;
  const ms = t.milestones ?? {};
  if (ms.produced && w.produced < ms.produced) return `Needs ${ms.produced.toLocaleString()} units made (${Math.round(w.produced).toLocaleString()} so far)`;
  if (ms.employees && w.employees < ms.employees) return `Needs ${ms.employees.toLocaleString()} men employed`;
  if (ms.seasonsOperating && w.seasonsOperating < ms.seasonsOperating) return `Needs ${ms.seasonsOperating} seasons in operation`;
  return null;
}

/** start building a process at a works (the cash is spent at once) */
export function commission(g: GameState, w: Works, techId: string, free = false): { ok: boolean; text: string } {
  const c = g.company;
  if (!c) return { ok: false, text: "No company" };
  const t = INDUSTRIES[w.industry].tech.find((x) => x.id === techId);
  if (!t) return { ok: false, text: "Unknown process" };
  const why = techBlocked(g, w, t);
  if (why) return { ok: false, text: why };
  if (!free && c.biz.actionsLeft <= 0) return { ok: false, text: "No actions left this season" };
  const cost = techCost(t, cal(g).year);
  if (c.cash < cost) return { ok: false, text: `Needs $${cost.toLocaleString()}` };
  c.cash -= cost;
  if (!free) c.biz.actionsLeft--;
  w.research = { id: t.id, left: Math.max(1, Math.round(t.seasons * (c.biz.flags.lab ? 0.75 : 1) * (c.biz.flags.endowed ? 0.9 : 1))) };
  c.biz.record.push(`${cal(g).season} ${cal(g).year}: Commissioned ${t.name} at ${w.name}`);
  log(g, `${w.name} commissions ${t.name} ($${cost.toLocaleString()}, ${t.seasons} seasons).`);
  return { ok: true, text: `Work begins on ${t.name}: ready in ${t.seasons} seasons.` };
}

/** a season's work on the projects under way; returns notes for the works that finished */
export function advanceResearch(g: GameState, w: Works): string | null {
  if (!w.research) return null;
  if (--w.research.left > 0) return null;
  const t = INDUSTRIES[w.industry].tech.find((x) => x.id === w.research!.id)!;
  w.research = undefined;
  if (!w.techs.includes(t.id)) w.techs.push(t.id);
  g.world.version++;
  log(g, `${t.name} goes into operation at ${w.name}.`);
  return `${t.name} is in operation.`;
}
