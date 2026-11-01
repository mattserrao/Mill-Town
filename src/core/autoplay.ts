// Starting later: the valley and your family are simulated from 1850 to the start of the chosen era, with an
// AI owner running the family company the way a careful owner of the day would (the historical choice at each
// decision, the processes the industry has, a settlement when a strike drags on, credit from the bank rather
// than the receivers). You arrive at the succession and take over — as the industrialist or as the politician.

import { resolveDecision, takeAction } from "./business";
import { advanceTurn, allWorks, cal, type Founder, foundCompany, type GameState, newGame } from "./game";
import { INDUSTRIES, type IndustryId } from "./industries";
import type { GameMap } from "./map";
import { commission, techBlocked, techPrice } from "./market";
import { buildProject, projectBlocked, suggestProject } from "./projects";
import { resolveSuccession, type Path } from "./family";
import { Rng } from "./rng";
import { evaluateSite, footprintTiles, popSAT } from "./site";
import { ERAS, priceLevel } from "./time";
import { sieges } from "./labour";

export type Faction = "industrialist" | "politician";
export const START_YEARS = ERAS.map((e) => e.startYear);

/** the best site for an industry that the founding capital can buy */
export function bestSite(g: GameState, ind: IndustryId): { x: number; y: number } | null {
  const m = g.map, sat = popSAT(m, g.world), fp = footprintTiles(m, ind);
  let best: { x: number; y: number; s: number } | null = null;
  for (let y = 4; y < m.height - fp - 4; y += 6) for (let x = 4; x < m.width - fp - 4; x += 6) {
    const r = evaluateSite(m, g.world, g.fields, ind, x, y, sat);
    if (r.ok && r.cost <= 100000 && (!best || r.score > best.s)) best = { x, y, s: r.score };
  }
  return best;
}

/** one season of the AI owner's work, before the season is played */
export function autoOwner(g: GameState) {
  const c = g.company;
  if (!c) return;
  const y = cal(g).year, rng = new Rng(`${g.seed}:auto:${g.turn}`);
  // a decision: what the owners did — but a union's demands are met halfway
  for (let k = 0; g.pendingDecision && k < 10; k++) {
    const d = g.pendingDecision;
    resolveDecision(g, rng.fork(`d${k}`), d.source?.startsWith("demand:") ? 1 : d.source === "takeover" ? 1 : undefined);
  }
  // a careful heir stays in the business (the player takes over at the start year)
  if (g.family?.succession) resolveSuccession(g, { heir: 0, path: "business" });
  // a strike that drags on is settled
  if (sieges(g).some((u) => (u.siege?.seasons ?? 0) >= 2)) takeAction(g, "negotiate", rng.fork("settle"));
  // keep up with the industry
  for (const w of allWorks(c)) for (const t of INDUSTRIES[w.industry].tech)
    if (!techBlocked(g, w, t) && c.cash > techPrice(g, t) * 1.5 && c.biz.actionsLeft > 0) commission(g, w, t.id);
  if (!projectBlocked(g, "expand") && c.cash > 1_500_000 * priceLevel(y) * 1.5) { const p = suggestProject(g, "expand"); if (p?.ok) buildProject(g, p); }
  // short of cash: the family borrows rather than lose the works
  if (c.cash < 0) { c.debt += Math.round(-c.cash * 1.25); c.cash = 0; c.redSeasons = 0; }
}

export interface LaterStart { year: number; faction: Faction; industry: IndustryId; founder: Founder; name?: string }

/** set up a game to be simulated: the valley, the family and its company in 1850 */
export function laterStartGame(map: GameMap, seed: number, o: LaterStart): GameState | null {
  const g = newGame(map, seed);
  const s = bestSite(g, o.industry);
  if (!s) return null;
  if (!foundCompany(g, o.industry, s.x, s.y, o.name, o.founder).ok) return null;
  g.flags.laterStart = o.year;
  g.flags.faction = o.faction;
  return g;
}

/** play seasons until the start year's succession comes due (call repeatedly: returns true when done) */
export function simulateSome(g: GameState, o: LaterStart, seasons: number): boolean {
  for (let k = 0; k < seasons; k++) {
    if (g.family?.succession && cal(g).year >= o.year) return arrive(g, o);
    autoOwner(g);
    advanceTurn(g);
    if (g.over) return true;
  }
  if (g.family?.succession && cal(g).year >= o.year) return arrive(g, o);
  return false;
}

/** you arrive: the succession card waits for you, with the paths of your faction */
function arrive(g: GameState, o: LaterStart): boolean {
  const s = g.family!.succession!;
  const paths: Path[] = o.faction === "politician" ? ["politics"] : ["business", "industry", "coop", "financier"];
  s.paths = paths;
  s.note = `${s.note} You join the family as its next head${o.faction === "politician" ? ", bound for public life" : ""}.`;
  delete g.flags.laterStart;
  return true;
}

/** the share of the simulation done (for a progress bar) */
export const simProgress = (g: GameState, year: number) => Math.min(1, (cal(g).year - 1850) / Math.max(1, year - 1850));
