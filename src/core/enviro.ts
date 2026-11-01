// Clean air and water as a fight, not a switch (v0.18). The environmental laws (politics.ts, `env`) set the level
// of smoke control or water treatment a works must reach. When a law catches a works short the owner chooses:
// install the equipment now, sign a consent decree (a deadline with weak interim limits, violations that pile up and
// can collapse into lawsuits, as Clairton's did in 1972–75), or defy the law (fines, the papers, and from 1969 GASP).
// Valley inversions (Donora 1948, November 1975) punish a works without a curtailment plan; after the 1977
// amendments a nonattainment valley needs offsets before any expansion. Research: docs/V018-RESEARCH.md §1.

import { type ActionDef, bump, type Decision, type DecisionOption, pushHeadline } from "./business";
import { allWorks, cal, type GameState, log, type Works } from "./game";
import { INDUSTRIES } from "./industries";
import { mark } from "./ledger";
import { techCost } from "./market";
import { LAWS, type LawDef, lawsOf } from "./politics";
import type { Rng } from "./rng";
import { priceLevel } from "./time";
import { DIAMOND, latLonToTile } from "./features";

export interface Compliance {
  mode: "decree" | "defy" | "ok";
  since: number;
  /** a decree's deadline (turn) */
  due?: number;
  violations: number;
  collapsed?: boolean;
  stretched?: boolean;
}

const LADDER = ["ctl_firing", "ctl_precip", "ctl_hoods", "ctl_scrub"];

/** the smoke-control level a works has reached (0–4) */
export function controlLevel(w: Works): number {
  let n = 0;
  for (const id of LADDER) { if (!w.techs.includes(id)) break; n++; }
  return n;
}
export const waterTreated = (g: GameState, w: Works) => w.techs.includes("ctl_water") || g.company?.biz.policy.waste === "abate";

const envLaws = () => LAWS.filter((l) => l.env && (l.env.level || l.env.water));
const compOf = (g: GameState) => (g.compliance ??= {});
const key = (l: LawDef, w: Works) => `${l.id}:${w.id}`;

/** is the works inside the old city (city ordinances reach only that far: about 4 miles from the Point) */
function inCity(g: GameState, w: Works): boolean {
  const [px, py] = latLonToTile(g.map, DIAMOND[0], DIAMOND[1]);
  return Math.hypot(w.x - px, w.y - py) * g.map.metersPerTile < 6500;
}

/** what a law asks of a works that it doesn't have: [missing control techs, needs water] */
export function shortOf(g: GameState, l: LawDef, w: Works): { techs: string[]; water: boolean } | null {
  const e = l.env!;
  // laboratories and hospitals hardly smoke: the smoke and stream laws are for furnaces and outfalls
  if (INDUSTRIES[w.industry].pollutionPerUnit < 0.005) return null;
  if (e.scope === "city" && !inCity(g, w)) return null;
  const techs = e.level ? LADDER.slice(0, e.level).filter((id) => !w.techs.includes(id)) : [];
  const water = !!e.water && !waterTreated(g, w);
  return techs.length || water ? { techs: water ? [...techs, "ctl_water"] : techs, water } : null;
}

/** what installing it all now would cost (a rush job: a quarter over the usual price) */
export function rushCost(g: GameState, w: Works, techs: string[]): number {
  const y = cal(g).year, ind = INDUSTRIES[w.industry];
  return Math.round(techs.reduce((s, id) => s + techCost(ind.tech.find((t) => t.id === id)!, y), 0) * 1.25);
}

const scaleOf = (w: Works) => Math.max(0.3, INDUSTRIES[w.industry].startCost / 60000);

/** the card when a law catches a works short (rebuilt from its source on load) */
export function envDecision(g: GameState, lawId: string, worksId: string): Decision | null {
  const l = LAWS.find((x) => x.id === lawId), w = g.company && allWorks(g.company).find((x) => x.id === worksId);
  if (!l || !w) return null;
  const short = shortOf(g, l, w);
  if (!short) return null;
  const y = cal(g).year, ind = INDUSTRIES[w.industry];
  const notYet = short.techs.map((id) => ind.tech.find((t) => t.id === id)!).filter((t) => t.year > y);
  const cost = rushCost(g, w, short.techs);
  const names = short.techs.map((id) => ind.tech.find((t) => t.id === id)!.name).join(", ");
  const decreeYears = l.env!.light ? 10 : y >= 1970 ? 6 : 8;
  const opts: DecisionOption[] = [
    {
      label: "Install it now", detail: notYet.length ? `Not possible yet: ${notYet.map((t) => `${t.name} (${t.year})`).join(", ")} — you'll be held to a decree.` : `${names}: $${cost.toLocaleString("en-US")}, installed at once. Reputation +4.`,
      apply: (g2) => {
        const c = g2.company!;
        if (notYet.length) return signDecree(g2, l, w, decreeYears);
        c.cash -= cost;
        for (const id of short.techs) if (!w.techs.includes(id)) w.techs.push(id);
        if (short.water && !w.techs.includes("ctl_water")) w.techs.push("ctl_water");
        compOf(g2)[key(l, w)] = { mode: "ok", since: g2.turn, violations: 0 };
        bump(g2, "reputation", 4);
        return `${w.name} installs ${names}.`;
      },
    },
    {
      label: "Sign a consent decree", detail: `${decreeYears} years to comply, with weak limits meanwhile. Violations pile up; a decree can collapse into lawsuits and daily fines.`,
      apply: (g2) => signDecree(g2, l, w, decreeYears),
    },
    {
      label: "Defy the law", detail: `Fines most seasons and the papers against you${y >= 1969 ? "; GASP will campaign against your works" : ""}.`,
      apply: (g2) => {
        compOf(g2)[key(l, w)] = { mode: "defy", since: g2.turn, violations: 0 };
        mark(g2, { id: `defied_${l.id}`, side: "public", kind: "grievance", weight: l.env!.light ? 3 : 10, text: `defied the ${l.name}` });
        return `${w.name} carries on as before.`;
      },
    },
  ];
  // what the owners did: the smoke ordinances were ignored, Smoke Control was obeyed, the federal laws met by decree
  const historical = l.env!.light ? 2 : l.id === "smoke" || l.id === "county1949" ? 0 : 1;
  return { id: `env_${l.id}_${w.id}`, source: `env:${l.id}:${w.id}`, title: `${l.name}: ${w.name} falls short`, text: `${l.blurb} ${w.name} needs ${names}.`, options: opts, historical };
}

function signDecree(g: GameState, l: LawDef, w: Works, years: number): string {
  compOf(g)[key(l, w)] = { mode: "decree", since: g.turn, due: g.turn + years * 4, violations: 0 };
  bump(g, "reputation", -1);
  return `${w.name} signs a consent decree: ${years} years to comply.`;
}

/** every season: laws that catch works short, decrees and their violations, defiance, the stretch-out, inversions */
export function envSeason(g: GameState, rng: Rng) {
  const c = g.company;
  if (!c) return;
  const y = cal(g).year, L = lawsOf(g), C = compOf(g), era = priceLevel(y);
  for (const l of envLaws()) {
    if (L[l.id]?.passed === undefined) continue;
    for (const w of allWorks(c)) {
      const k = key(l, w), st = C[k], short = shortOf(g, l, w);
      if (!short) {
        if (st && st.mode !== "ok") {
          if (st.mode === "decree") { bump(g, "reputation", 3); log(g, `${w.name} meets its consent decree under the ${l.name}.`); }
          else log(g, `${w.name} now complies with the ${l.name}.`);
          st.mode = "ok";
        }
        continue;
      }
      if (!st) {
        // one new card a season at most; the rest wait
        if (g.flags.envCardTurn === g.turn) continue;
        const d = envDecision(g, l.id, w.id);
        if (!d) continue;
        C[k] = { mode: "decree", since: g.turn, due: undefined, violations: 0 }; // until answered: treated as a decree
        if (!g.pendingDecision) g.pendingDecision = d; else g.moreDecisions.push(d);
        g.flags.envCardTurn = g.turn;
        continue;
      }
      if (st.mode === "ok") { st.mode = "decree"; st.since = g.turn; st.due = g.turn + 16; st.violations = 0; continue; } // fell behind a later standard
      const scale = scaleOf(w) * era;
      if (st.mode === "decree") {
        st.due ??= g.turn + 24;
        if (rng.chance(l.env!.light ? 0.04 : 0.12)) {
          st.violations++;
          const fine = Math.round((l.env!.light ? 200 : 1500) * scale);
          c.cash -= fine;
          if (st.violations % 4 === 1) log(g, `${w.name}: violations under its consent decree (${st.violations} so far), fined $${fine.toLocaleString("en-US")}.`);
        }
        // a decree that is broken too often collapses into lawsuits (Clairton, January 1975)
        if (!l.env!.light && y >= 1965 && st.violations >= 8 && rng.chance(0.15)) {
          st.mode = "defy"; st.collapsed = true;
          const suit = Math.round(40000 * scale);
          c.cash -= suit; bump(g, "reputation", -8);
          pushHeadline(g, `Decree Collapses at ${w.name}`, `After ${st.violations} violations the county and the state go to court: $${suit.toLocaleString("en-US")} in penalties, and fines for every day the works runs out of compliance.`, "Politics");
          continue;
        }
        if (g.turn >= st.due) {
          st.mode = "defy";
          pushHeadline(g, `${w.name} Misses Its Deadline`, `The consent decree under the ${l.name} has run out and the equipment isn't in. Daily fines begin.`, "Politics");
        }
        continue;
      }
      // defiance: inspectors, fines, the papers; from 1969, GASP
      if (rng.chance(l.env!.light ? 0.15 : 0.6)) {
        const fine = Math.round((l.env!.light ? 400 : 5000) * scale * (st.collapsed ? 2 : 1));
        c.cash -= fine; bump(g, "reputation", y >= 1969 ? -2 : -1);
        if (rng.chance(0.25)) log(g, `${w.name} fined $${fine.toLocaleString("en-US")} under the ${l.name}.`);
      }
      if (y >= 1969 && !c.biz.flags[`gasp_${w.id}`]) {
        c.biz.flags[`gasp_${w.id}`] = y;
        bump(g, "reputation", -5);
        pushHeadline(g, `GASP Targets ${w.name}`, `The Group Against Smog and Pollution pickets ${w.name} and takes the county to court to make it enforce the law.`, "Politics");
      }
    }
  }
  // the stretch-out: steel works under a decree get three more years (the money goes into modernising instead)
  if (L.stretchout?.passed !== undefined && !g.flags.stretchApplied) {
    g.flags.stretchApplied = true;
    for (const [k, st] of Object.entries(C)) {
      const w = allWorks(c).find((x) => k.endsWith(`:${x.id}`));
      if (w?.industry === "steel" && st.mode !== "ok") { st.mode = "decree"; st.due = Math.max(st.due ?? g.turn, g.turn) + 12; st.stretched = true; }
    }
  }
  inversions(g);
}

/** the deadly inversions: Donora (October 1948) and the November 1975 episode */
function inversions(g: GameState) {
  const c = g.company!, cl = cal(g), y = cl.year;
  if (cl.season !== "Autumn" || (y !== 1948 && y !== 1975)) return;
  const smoky = allWorks(c).filter((w) => controlLevel(w) < (y < 1970 ? 2 : 3) && INDUSTRIES[w.industry].pollutionPerUnit >= 0.01);
  if (!smoky.length) return;
  const plan = !!c.biz.flags.curtailPlan;
  if (y === 1948) {
    bump(g, "reputation", -3);
    log(g, "The Donora smog: twenty dead in the next valley. Every smoky works is in the papers.");
    return;
  }
  if (plan) {
    // the plan works: the furnaces are banked for the season and nobody blames you
    g.mods.push({ kind: "output", mult: 0.7, until: g.turn + 1, source: "Curtailment plan", industry: [...new Set(smoky.map((w) => w.industry))] });
    bump(g, "reputation", 2);
    log(g, "The inversion: your curtailment plan banks the furnaces until the air clears.");
    return;
  }
  const fine = Math.round(50000 * priceLevel(y));
  c.cash -= fine; bump(g, "reputation", -8);
  mark(g, { id: "inversion1975", side: "public", kind: "grievance", weight: 8, text: "kept the furnaces going through the killing smog of 1975" });
  pushHeadline(g, "No Plan to Cut the Smoke", `As fourteen die in the November inversion, the county finds ${c.name} had no plan to curtail its furnaces: fined $${fine.toLocaleString("en-US")}.`, "Politics");
}

/** after the 1977 amendments a nonattainment valley needs offsets: no expansion until the works is hooded */
export function permitBlock(g: GameState, w: Works): string | null {
  if (lawsOf(g).caa1977?.passed === undefined || g.company?.biz.flags.offsets) return null;
  return controlLevel(w) >= 3 ? null : "Nonattainment: no new capacity until the works has hoods and baghouses (offsets)";
}

/** the season's cost of running the control equipment (fans, filters, sludge): a share of the works' upkeep */
export const controlUpkeep = (w: Works) => 0.05 * controlLevel(w) + (w.techs.includes("ctl_water") ? 0.04 : 0);

/** compliance at a glance for the Works tab */
export function complianceOf(g: GameState, w: Works): { law: string; mode: Compliance["mode"]; due?: number; violations: number }[] {
  const C = compOf(g);
  return envLaws().filter((l) => C[key(l, w)] && C[key(l, w)].mode !== "ok").map((l) => ({ law: l.name, ...C[key(l, w)] }));
}

export const ENV_ACTIONS: ActionDef[] = [
  {
    id: "curtail_plan", group: "Environment", name: "File a curtailment plan",
    blurb: "A signed plan to bank the furnaces when an inversion holds the smoke in the valley (the county demanded them after 1975). Reputation +2.",
    cost: (g) => Math.round(5000 * priceLevel(cal(g).year)),
    blocked: (g) => (cal(g).year < 1967 ? "From 1967 (air-pollution episodes are watched from then)" : g.company!.biz.flags.curtailPlan ? "Your plan is filed" : null),
    run: (g) => { g.company!.biz.flags.curtailPlan = cal(g).year; bump(g, "reputation", 2); return "The plan is filed with the county."; },
  },
  {
    id: "offsets", group: "Environment", name: "Retire an old unit (offsets)",
    blurb: "Shut the oldest, dirtiest furnace at your first works: capacity −15% for good, and the smoke it made counts as an offset for new plant. Reputation +3.",
    cost: () => 0,
    blocked: (g) => (lawsOf(g).caa1977?.passed === undefined ? "Offsets begin with the 1977 amendments" : g.company!.biz.flags.offsets ? "Already retired" : null),
    run: (g) => { g.company!.biz.flags.offsets = cal(g).year; bump(g, "reputation", 3); return "The old unit is shut and its smoke credited against new plant."; },
  },
];
