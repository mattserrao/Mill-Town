// Sports teams and the town's morale. Teams are founded on their historical dates, play in their real grounds
// as they open (dated landmarks), rise and fall in strength, and win the titles history gave them (fired by
// events) or, for the leagues the event list doesn't follow, their own. Titles lift the town; long losing
// seasons and a team leaving town lower it. You can sponsor a team, or field a works team of your own.

import { ACTIONS, type ActionDef } from "./business";
import { cal, type GameState, log } from "./game";
import type { Rng } from "./rng";

export type Sport = "baseball" | "football" | "hockey";

export interface TeamDef {
  id: string;
  /** names over the years: [from year, name] */
  names: [number, string][];
  sport: Sport;
  founded: number;
  /** leaves or folds in this year */
  folds?: number;
  /** grounds over the years: [from year, ground name] */
  grounds: [number, string][];
  /** can win titles on its own (leagues the event list doesn't follow); otherwise only by events */
  ownTitles?: boolean;
  /** the season in which its year's result is known */
  decided: "Autumn" | "Winter";
}

export const TEAMS: TeamDef[] = [
  { id: "pirates", names: [[1887, "Pittsburgh Alleghenys"], [1891, "Pittsburgh Pirates"]], sport: "baseball", founded: 1887, decided: "Autumn",
    grounds: [[1887, "Recreation Park"], [1890, "Exposition Park"], [1909, "Forbes Field"], [1970, "Three Rivers Stadium"]] },
  { id: "pitt", names: [[1890, "Western University football"], [1908, "Pitt Panthers"]], sport: "football", founded: 1890, decided: "Winter", ownTitles: true,
    grounds: [[1890, "Exposition Park"], [1909, "Forbes Field"], [1925, "Pitt Stadium"]] },
  { id: "grays", names: [[1912, "Homestead Grays"]], sport: "baseball", founded: 1912, folds: 1951, decided: "Autumn", ownTitles: true,
    grounds: [[1912, "West Field, Munhall"], [1932, "Greenlee Field"], [1939, "Forbes Field"]] },
  { id: "crawfords", names: [[1931, "Pittsburgh Crawfords"]], sport: "baseball", founded: 1931, folds: 1939, decided: "Autumn", ownTitles: true,
    grounds: [[1931, "Ammon Field"], [1932, "Greenlee Field"]] },
  { id: "steelers", names: [[1933, "Pittsburgh Pirates (football)"], [1940, "Pittsburgh Steelers"]], sport: "football", founded: 1933, decided: "Winter",
    grounds: [[1933, "Forbes Field"], [1958, "Pitt Stadium"], [1970, "Three Rivers Stadium"]] },
  { id: "penguins", names: [[1967, "Pittsburgh Penguins"]], sport: "hockey", founded: 1967, decided: "Winter", ownTitles: true,
    grounds: [[1967, "Civic Arena"]] },
];

export interface TeamState { id: string; strength: number; fans: number; titles: number[]; last?: string; sponsored?: boolean; active: boolean }

const def = (id: string) => TEAMS.find((t) => t.id === id)!;
export const teamName = (id: string, year: number) => { const d = def(id); let n = d.names[0][1]; for (const [y, nm] of d.names) if (year >= y) n = nm; return n; };
export const teamGround = (id: string, year: number) => { const d = def(id); let n = d.grounds[0][1]; for (const [y, gr] of d.grounds) if (year >= y) n = gr; return n; };

/** each season: teams found and fold on their dates; at the end of a team's season, a result */
export function sportsSeason(g: GameState, rng: Rng) {
  const { year, season } = cal(g);
  for (const d of TEAMS) {
    let t = g.teams.find((x) => x.id === d.id);
    if (!t && year >= d.founded && (d.folds === undefined || year < d.folds)) {
      t = { id: d.id, strength: 0.35 + rng.next() * 0.2, fans: 0, titles: [], active: true };
      g.teams.push(t);
      log(g, `The ${teamName(d.id, year)} take the field at ${teamGround(d.id, year)}.`);
    }
    if (!t || !t.active) continue;
    if (d.folds !== undefined && year >= d.folds) { t.active = false; g.morale = Math.max(0, g.morale - 3); log(g, `The ${teamName(d.id, year)} play their last season.`); continue; }
    if (season !== d.decided) continue;
    // a year of baseball (or football, or hockey): strength drifts; the sponsor's money helps
    t.strength = Math.max(0.05, Math.min(0.98, t.strength + (rng.next() - 0.5) * 0.18 + (t.sponsored ? 0.03 : 0) + (0.5 - t.strength) * 0.08));
    t.fans = Math.round(Math.min(1, t.fans + 0.05) * 100) / 100;
    const r = t.strength + (rng.next() - 0.5) * 0.3;
    t.last = r > 0.8 ? "a pennant race" : r > 0.6 ? "a winning season" : r > 0.4 ? "a middling season" : "a losing season";
    g.morale = Math.max(0, Math.min(100, g.morale + (r > 0.6 ? 1 : r < 0.35 ? -1 : 0) * (0.5 + t.fans)));
    if (d.ownTitles && r > 0.92) win(g, t, `${teamName(d.id, year)} Win the Championship`);
  }
}

function win(g: GameState, t: TeamState, headline: string) {
  const { year, season } = cal(g);
  t.titles.push(year);
  g.morale = Math.min(100, g.morale + 8);
  g.headlines.push({ year, season, name: headline, description: `The town turns out to cheer the ${teamName(t.id, year)}. For a week nobody talks about anything else.`, category: "Culture" });
}

/** team events from the event list: found (early), move to a new ground, a historical title, a rename */
export function teamEvent(g: GameState, team: string, act: "found" | "move" | "title" | "rename", _ground?: string, _name?: string) {
  let t = g.teams.find((x) => x.id === team);
  if (!t && def(team)) { t = { id: team, strength: 0.5, fans: 0.1, titles: [], active: true }; g.teams.push(t); }
  if (!t) return;
  if (act === "title") {
    t.titles.push(cal(g).year);
    t.strength = Math.max(t.strength, 0.85);
    g.morale = Math.min(100, g.morale + 10);
    if (g.company) g.company.biz.meters.labour = Math.min(100, g.company.biz.meters.labour + 2);
  } else if (act === "move") g.morale = Math.min(100, g.morale + 2);
}

const SPORTS_ACTIONS: ActionDef[] = [
  {
    id: "sponsor", group: "Public", name: "Back the home team",
    blurb: "Money for players and a box at the ballpark: the team gets stronger, the town notices. Morale +3, reputation +3.",
    cost: (g) => Math.round(4000 * (1 + (cal(g).year - 1850) * 0.012)),
    blocked: (g) => (g.teams.some((t) => t.active) ? null : "No professional team yet (the Alleghenys, 1887)"),
    run: (g) => {
      const t = [...g.teams].filter((x) => x.active).sort((a, b) => b.fans - a.fans)[0];
      t.sponsored = true; t.strength = Math.min(0.98, t.strength + 0.05);
      g.morale = Math.min(100, g.morale + 3);
      g.company!.biz.meters.reputation = Math.min(100, g.company!.biz.meters.reputation + 3);
      return `Your company backs the ${teamName(t.id, cal(g).year)}.`;
    },
  },
  {
    id: "works_team", group: "Labour", name: "Field a works ball team",
    blurb: "A ballfield by the works and a team in the mill league (the Homestead Grays began as one). Labour +6, morale +2. Once.",
    cost: (g) => Math.round(3000 * (1 + (cal(g).year - 1850) * 0.012)),
    blocked: (g) => (cal(g).year < 1870 ? "Mill leagues start in the 1870s" : g.company!.biz.flags.worksTeam ? "You have a works team" : null),
    run: (g) => {
      g.company!.biz.flags.worksTeam = true;
      g.company!.biz.meters.labour = Math.min(100, g.company!.biz.meters.labour + 6);
      g.morale = Math.min(100, g.morale + 2);
      return "The works nine plays its first game on a Saturday afternoon.";
    },
  },
];
ACTIONS.push(...SPORTS_ACTIONS);
