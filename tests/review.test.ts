// Review run (slow): REVIEW=1 npx vitest run tests/review.test.ts
// Plays industries with several kinds of owner to 1985 and writes a summary to /tmp/review-<tag>.json.
// Filter with IND=steel,glass WHO=idle,invests SEED=11 TAG=a (so several runs can go in parallel).
import { readFileSync, writeFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { describe, it } from "vitest";
import { advanceTurn, allWorks, cal, foundCompany, newGame, totalPopulation, type GameState } from "../src/core/game";
import { INDUSTRIES, type IndustryId } from "../src/core/industries";
import { parseMap, type MapMeta } from "../src/core/map";
import { commission, techBlocked, techCost, techStanding } from "../src/core/market";
import { buildProject, projectBlocked, suggestProject } from "../src/core/projects";
import { evaluateSite, footprintTiles, popSAT } from "../src/core/site";
import { BUSINESSES, buyBiz, buyShares, buyStake, holdingsValue, LISTED } from "../src/core/holdings";
import { resolveDecision, takeAction } from "../src/core/business";
import { Rng } from "../src/core/rng";
import { ledgerOf, martyrsOf, topMarks } from "../src/core/ledger";
import { type Path, resolveSuccession } from "../src/core/family";
import { LAWS, lawsOf, polOf } from "../src/core/politics";
import { sieges } from "../src/core/labour";

const base = new URL("../public/maps/", import.meta.url);
const meta = JSON.parse(readFileSync(new URL("mon-valley.json", base), "utf8")) as MapMeta;
const map = parseMap(meta, new Uint8Array(gunzipSync(readFileSync(new URL(meta.binary, base)))));

function bestSite(g: GameState, ind: IndustryId) {
  const sat = popSAT(map, g.world), fp = footprintTiles(map, ind);
  let best = { x: 0, y: 0, s: -1 };
  for (let y = 4; y < map.height - fp - 4; y += 6) for (let x = 4; x < map.width - fp - 4; x += 6) {
    const r = evaluateSite(map, g.world, g.fields, ind, x, y, sat);
    if (r.ok && r.cost <= 100000 && r.score > best.s) best = { x, y, s: r.score };
  }
  return best;
}

/** idle: never invests; invests: processes and expansions; tycoon: + holdings; crush / recognise: invests, and fights or deals with labour; politics / coop / newind: invests, and the heir takes that path in 1893 */
type Owner = "idle" | "invests" | "tycoon" | "crush" | "recognise" | "politics" | "coop" | "newind";

function play(ind: IndustryId, who: Owner, seed: number) {
  const g = newGame(map, seed);
  const site = bestSite(g, ind);
  const f = foundCompany(g, ind, site.x, site.y);
  if (!f.ok) return { ind, who, error: f.reason };
  const c = g.company!;
  const t0 = Date.now();
  let seasons = 0, decisions = 0, demands = 0, slowest = 0, moves = 0, answers = 0;
  const yearly: Record<number, { cash: number; profit: number; men: number; tax?: number; pensions?: number }> = {};
  let peak = { cash: 0, year: 1850 }, bankrupt: number | null = null;
  const answered = new Map<string, string | undefined>();
  const strikeYears: number[] = [];
  const successions: string[] = [];
  while (!g.over) {
    const y = cal(g).year;
    // the succession: the owner's chosen path the first time, then stay
    if (g.family?.succession) {
      const s = g.family.succession;
      const want: Path = s.paths.includes("business") ? "business" : s.paths[0];
      const path: Path = successions.length === 0 && ["politics", "coop", "newind"].includes(who) ? (who === "newind" ? "industry" : who as Path) : want;
      const other = (["glass", "power", "metalworks", "steel"] as IndustryId[]).find((i) => i !== c.industry)!;
      resolveSuccession(g, { heir: 0, path: s.paths.includes(path) ? path : want, industry: other, sellOld: true, side: who === "politics" ? "reform" : undefined });
      successions.push(`${y}: ${path}`);
    }
    if (g.family?.newIndustry && !projectBlocked(g, "found")) { const p = suggestProject(g, "found", g.family.newIndustry.industry); if (p?.ok) buildProject(g, p); }
    while (g.pendingDecision) {
      decisions++;
      const d = g.pendingDecision;
      if (d.source?.startsWith("demand:")) demands++;
      let k: number | undefined;
      if (d.source?.startsWith("demand:")) k = who === "recognise" ? 0 : who === "crush" ? (d.options.length > 3 ? 3 : 2) : undefined;
      resolveDecision(g, new Rng(`${seed}:${g.turn}:${decisions}`), k);
    }
    if (who === "crush" && sieges(g).length) { takeAction(g, "strikebreakers", new Rng(`${seed}:sb${g.turn}`)); takeAction(g, "pinkertons", new Rng(`${seed}:pk${g.turn}`)); }
    if (who === "recognise" && sieges(g).length) takeAction(g, "negotiate", new Rng(`${seed}:ng${g.turn}`));
    if (who === "politics" && g.family?.heads.length === 2) takeAction(g, "run", new Rng(`${seed}:run${g.turn}`));
    if (who !== "idle") {
      for (const w of allWorks(c)) for (const t of INDUSTRIES[w.industry].tech) if (!techBlocked(g, w, t) && c.cash > techCost(t, y) * 1.1) commission(g, w, t.id);
      if (!projectBlocked(g, "expand") && c.cash > 1_500_000 * (1 + (y - 1850) * 0.02)) { const p = suggestProject(g, "expand"); if (p?.ok) buildProject(g, p); }
    }
    if (who === "tycoon") {
      for (const d of BUSINESSES) if (c.cash > 300000 && c.biz.actionsLeft > 0) buyBiz(g, d.id);
      for (const r of g.rivals) if (r.active && !r.closed && !r.owned && c.cash > 2_000_000 && c.biz.actionsLeft > 0) buyStake(g, r.id);
      for (const L of LISTED) if (c.cash > 3_000_000) buyShares(g, L.id, 10);
    }
    const s0 = Date.now();
    advanceTurn(g);
    slowest = Math.max(slowest, Date.now() - s0);
    seasons++;
    moves += (g.moves ?? []).filter((m) => m.turn === g.turn - 1).length;
    for (const r of g.rivals) { if (r.answered && answered.get(r.id) !== r.answered) answers++; answered.set(r.id, r.answered); }
    if (sieges(g).length && strikeYears[strikeYears.length - 1] !== y) strikeYears.push(y);
    if (c.cash > peak.cash) peak = { cash: Math.round(c.cash), year: y };
    if (c.bankrupt && bankrupt === null) bankrupt = y;
    if (cal(g).season === "Spring" && (y % 5 === 0 || y >= 1975)) yearly[y] = { cash: Math.round(c.cash), profit: c.totals?.profit ?? 0, men: c.totals?.workersHired ?? 0, tax: c.totals?.tax, pensions: c.totals?.pensions };
  }
  const hv = holdingsValue(g);
  const L = lawsOf(g);
  return {
    ind, who, seed, bankrupt, peak, closed: allWorks(c).filter((w) => w.closed).map((w) => w.name), util: c.market?.util, endCash: Math.round(c.cash), endYear: cal(g).year, endIndustry: c.industry, keptPct: peak.cash ? Math.round((c.cash / peak.cash) * 100) : 0,
    strikes: g.stats.strikes, strikeYears, demands, decisions, moves, answers, msPerSeason: Math.round((Date.now() - t0) / seasons), slowestMs: slowest,
    rep: Math.round(c.biz.meters.reputation), lab: Math.round(c.biz.meters.labour), infl: Math.round(c.biz.meters.influence), morale: Math.round(g.morale),
    unions: Object.fromEntries(Object.entries(g.unions ?? {}).map(([k, u]) => [k, { mem: +u!.membership.toFixed(2), mil: Math.round(u!.militancy), rec: u!.recognised, won: u!.won, lost: u!.lost }])),
    laws: Object.fromEntries(LAWS.map((l) => [l.id, L[l.id].passed ?? null])),
    elections: polOf(g).results.length, marks: ledgerOf(g).length, martyrs: martyrsOf(g), top: topMarks(g, 5).map((m) => `${m.year} ${m.text} (${Math.round(m.weight)})`),
    family: g.family?.heads.map((h) => `${h.first} ${h.from}-${h.to ?? ""} ${h.path} [${h.traits.join(",")}]`), successions, career: g.career?.record,
    pop: totalPopulation(g), holdings: Math.round(hv.biz + hv.stakes + hv.shares), holdingsBy: { biz: Math.round(hv.biz), stakes: Math.round(hv.stakes), shares: Math.round(hv.shares) }, behind: techStanding(g, c).behind.length, yearly,
  };
}

describe.skipIf(!process.env.REVIEW)("review", () => {
  it("plays the industries", () => {
    const out: unknown[] = [];
    const inds = (process.env.IND ?? "steel,glass,power,metalworks").split(",") as IndustryId[];
    const whos = (process.env.WHO ?? "idle,invests,tycoon").split(",") as Owner[];
    const seed = Number(process.env.SEED ?? 11);
    for (const ind of inds) for (const who of whos) {
      out.push(play(ind, who, seed));
      writeFileSync(`/tmp/review-${process.env.TAG ?? "all"}.json`, JSON.stringify(out, null, 1));
    }
  }, 6 * 3600 * 1000);
});
