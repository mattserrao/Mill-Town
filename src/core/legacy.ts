// The legacy: how the family is judged at the end, on three counts — Fortune (what it kept), The Valley (what
// it left the town) and History's verdict (what the men, the public and the record say) — set beside the real
// dynasties of the valley.

import { allWorks, cal, type GameState, totalPopulation } from "./game";
import { holdingsValue } from "./holdings";
import { lawsOf, LAWS } from "./politics";
import { martyrsOf, standing } from "./ledger";
import { priceLevel } from "./time";

export interface Legacy { fortune: number; valley: number; verdict: number; total: number; title: string; lines: string[] }

/** the real dynasties, scored on the same three counts (Fortune, Valley, Verdict, out of 100 each) */
export const DYNASTIES: [string, number, number, number, string][] = [
  ["Carnegie", 95, 70, 30, "the richest man in the world; libraries everywhere; Homestead"],
  ["Mellon", 100, 75, 55, "the bank, the Treasury, the Renaissance"],
  ["Frick", 85, 35, 15, "coke, Homestead, an art collection in New York"],
  ["Westinghouse", 70, 65, 60, "air brakes and AC power; his men loved him; lost the company in 1907"],
  ["Heinz", 75, 60, 75, "pickles, fair treatment, a chapel at Pitt"],
  ["Jones & Laughlin", 70, 50, 35, "a century of steel on both banks; the Aliquippa case"],
];

const clamp = (v: number) => Math.max(0, Math.min(100, Math.round(v)));

export function legacy(g: GameState): Legacy {
  const c = g.company, lines: string[] = [];
  if (!c) return { fortune: 0, valley: 0, verdict: 0, total: 0, title: "No company, no legacy", lines };
  const y = cal(g).year, era = priceLevel(y);
  const hv = holdingsValue(g);
  const wealth = Math.max(0, c.cash) + hv.biz + hv.stakes + hv.shares - c.debt;
  // Fortune: $10M (in 1985 dollars of the game) is a great fortune; $100M a dynasty's
  const fortune = clamp(wealth <= 0 ? 0 : 20 * Math.log10(1 + wealth / (100000 * era)) + 20);
  // The Valley: the town's size against its peak, its morale and health, the great works the family founded
  const pop = totalPopulation(g), funded = Object.keys(g.funded ?? {}).length + (c.library ? 1 : 0) + (c.biz.flags.endowed ? 1 : 0);
  const valley = clamp(30 * (pop / Math.max(1, g.stats.peakPop)) + (g.morale - 30) * 0.6 + funded * 6 + (allWorks(c).some((w) => w.employees > 0) ? 10 : 0) - (c.retirees ? 0 : 0));
  // History's verdict: the men and the public, the martyrs, the laws, the co-op
  const reformLaws = (g.career?.laws ?? []).filter((l) => l.act === "passed" && LAWS.find((x) => x.id === l.id)?.side === "reform").length;
  const killedLaws = (g.career?.laws ?? []).filter((l) => l.act === "killed" && LAWS.find((x) => x.id === l.id)?.side === "reform").length;
  const verdict = clamp(45 + standing(g, "labour") * 0.25 + standing(g, "public") * 0.3 - martyrsOf(g) * 3 + reformLaws * 6 - killedLaws * 5 + (c.biz.flags.coop ? 15 : 0));
  const total = Math.round((fortune + valley + verdict) / 3);
  const title = total >= 75 ? "A great Pittsburgh dynasty" : total >= 60 ? "A family the valley remembers" : total >= 45 ? "One family among many" : total >= 30 ? "A name the valley would rather forget" : "A ruin and a grudge";
  if (martyrsOf(g)) lines.push(`${martyrsOf(g)} men were killed in the family's labour wars.`);
  if (reformLaws) lines.push(`The family passed ${reformLaws} reform law${reformLaws > 1 ? "s" : ""}.`);
  const early = LAWS.filter((l) => { const s = lawsOf(g)[l.id]; return s.passed !== undefined && s.passed < l.year; }).map((l) => l.name);
  const late = LAWS.filter((l) => { const s = lawsOf(g)[l.id]; return s.passed !== undefined && s.passed > l.year; }).map((l) => l.name);
  if (early.length) lines.push(`Earlier than history: ${early.join(", ")}.`);
  if (late.length) lines.push(`Later than history: ${late.join(", ")}.`);
  return { fortune, valley, verdict, total, title, lines };
}
