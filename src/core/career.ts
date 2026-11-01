// Politics as a career: when the head of the family goes into politics, a manager runs the works and the
// family climbs the ladder — council, mayor, state senate, governor, Congress, the Senate. Each step is an
// election. In office you hold the levers the owners and the union fight over: the police at the picket line,
// the troops, the bills on the desk, the tariff. The rivals and the union lobby you; your own company asks for
// favours, and the papers watch for it.

import { type ActionDef, bump, pushHeadline } from "./business";
import { cal, type GameState, log } from "./game";
import { fullName, hasTrait, head } from "./family";
import { mark, standing } from "./ledger";
import { electionBonus, holderAt, type Holder, LAWS, lawById, lawsOf, lawYear, type Level, passLaw, polOf } from "./politics";
import { priceLevel } from "./time";
import { sieges, settle } from "./labour";
import type { Rng } from "./rng";

export type OfficeId = "council" | "mayor" | "statesenate" | "governor" | "congress" | "senate";
export const OFFICES: Record<OfficeId, { name: string; level: Level; term: number; next?: OfficeId; cost: number; from?: number }> = {
  council: { name: "City council", level: "city", term: 4, next: "mayor", cost: 4000 },
  mayor: { name: "Mayor of Pittsburgh", level: "city", term: 4, next: "statesenate", cost: 15000 },
  statesenate: { name: "State senator", level: "state", term: 4, next: "governor", cost: 15000 },
  governor: { name: "Governor of Pennsylvania", level: "state", term: 4, next: "congress", cost: 60000 },
  congress: { name: "Congressman", level: "federal", term: 2, next: "senate", cost: 30000 },
  senate: { name: "United States Senator", level: "federal", term: 6, cost: 80000, from: 1914 },
};

export interface Career {
  side: "business" | "reform";
  office?: OfficeId;
  since?: number;
  /** the term ends in the autumn of this year */
  until?: number;
  /** standing for this office at this autumn's election */
  running?: { office: OfficeId; year: number; spent: number };
  record: string[];
  /** the highest seat the family has held */
  best?: OfficeId;
  /** laws signed or killed */
  laws: { id: string; act: "passed" | "killed"; year: number }[];
}

export const careerOf = (g: GameState) => g.career;
const RANK: OfficeId[] = ["council", "mayor", "statesenate", "governor", "congress", "senate"];
export const inPolitics = (g: GameState) => head(g)?.path === "politics";
export const partyName = (side: Career["side"], y: number) => side === "business" ? "Republican" : y === 1912 ? "Progressive" : "Democrat";

/** the family member holds this level's top office now: they are the holder */
export function familyHolder(g: GameState, level: Level): Holder | null {
  const c = g.career, h = head(g);
  if (!c?.office || !h || !inPolitics(g)) return null;
  const o = OFFICES[c.office];
  if (o.level !== level || !(c.office === "mayor" || c.office === "governor")) return null;
  return { name: fullName(g, h), party: partyName(c.side, cal(g).year), lean: c.side === "reform" ? 0.5 : -0.5, title: c.office === "mayor" ? "Mayor" : "Governor", from: c.since ?? cal(g).year };
}

/** an election for this office this year (council and mayor with the city, the state ones in state years, Congress every even year) */
export function raceYear(o: OfficeId, y: number): boolean {
  const lv = OFFICES[o].level;
  if (o === "senate" && y < 1914) return false;
  return lv === "city" ? y % 2 === 1 : lv === "state" ? (o === "governor" ? y % 4 === 2 : y % 2 === 0) : y % 2 === 0;
}

/** the chance of winning a race now */
export function raceOdds(g: GameState, o: OfficeId, spent = 0): number {
  const c = g.career!, b = g.company!.biz.meters, y = cal(g).year;
  const lean = polOf(g).balance[OFFICES[o].level] / 100; // the body's mood
  const sideFit = c.side === "reform" ? lean : -lean;
  const rank = ["council", "mayor", "statesenate", "governor", "congress", "senate"].indexOf(o);
  const money = Math.min(0.2, 0.1 * Math.log2(1 + spent / (OFFICES[o].cost * priceLevel(y))));
  const union = c.side === "reform" ? Math.max(-0.1, standing(g, "labour") / 300) : -Math.max(0, -standing(g, "labour")) / 600;
  return Math.max(0.05, Math.min(0.92, 0.42 - rank * 0.04 + b.influence / 300 + b.reputation / 400 + sideFit * 0.2 + money + union + electionBonus(g)));
}

/** what the family can stand for next */
export function nextOffice(g: GameState): OfficeId | null {
  const c = g.career;
  if (!c) return "council";
  // out of office: stand again for the highest seat ever held
  if (!c.office) return c.best ?? "council";
  const n = OFFICES[c.office].next;
  return n && (!OFFICES[n].from || cal(g).year >= OFFICES[n].from!) ? n : null;
}

/** Autumn: the votes for a race you're in, and for a term that's ending. */
export function careerSeason(g: GameState, rng: Rng) {
  const c = g.career, cl = cal(g);
  if (!c || !inPolitics(g) || cl.season !== "Autumn") return;
  const y = cl.year, h = head(g)!, who = fullName(g, h);
  if (c.running && c.running.year === y) {
    const r = c.running, odds = raceOdds(g, r.office, r.spent);
    c.running = undefined;
    if (rng.chance(odds)) {
      c.office = r.office; c.since = y + 1; c.until = y + OFFICES[r.office].term;
      if (!c.best || RANK.indexOf(r.office) > RANK.indexOf(c.best)) c.best = r.office;
      c.record.push(`${y}: elected ${OFFICES[r.office].name}`);
      (h.offices ??= []).push(`${OFFICES[r.office].name} (${y + 1})`);
      bump(g, "influence", 10);
      mark(g, { id: `elected_${r.office}`, side: "politics", kind: "favour", weight: 10, text: `was elected ${OFFICES[r.office].name.toLowerCase()}` });
      pushHeadline(g, `${who} Elected ${OFFICES[r.office].name}`, `The ${partyName(c.side, y)} ${who} wins with ${Math.round(odds * 100)}% of the bookmakers' money behind ${h.sex === "f" ? "her" : "him"}.`, "Politics");
    } else {
      c.record.push(`${y}: lost the race for ${OFFICES[r.office].name.toLowerCase()}`);
      bump(g, "influence", -5);
      pushHeadline(g, `${who} Defeated`, `The race for ${OFFICES[r.office].name.toLowerCase()} goes the other way.`, "Politics");
    }
    return;
  }
  // a term ends: run again (automatically) or step down
  if (c.office && c.until && y >= c.until) {
    const o = c.office;
    const odds = raceOdds(g, o) + 0.08; // incumbency
    if (o !== "governor" && rng.chance(odds)) { c.until = y + OFFICES[o].term; c.record.push(`${y}: re-elected ${OFFICES[o].name.toLowerCase()}`); log(g, `${who} is re-elected ${OFFICES[o].name.toLowerCase()}.`); }
    else { c.record.push(`${y}: left office as ${OFFICES[o].name.toLowerCase()}`); log(g, `${who} leaves office.`); c.office = undefined; c.since = undefined; c.until = undefined; }
  }
}

const era = (g: GameState) => priceLevel(cal(g).year);
const office = (g: GameState) => g.career?.office;
const at = (...os: OfficeId[]) => (g: GameState) => (!inPolitics(g) ? "Only for a family member in politics" : office(g) && os.includes(office(g)!) ? null : `Needs a seat: ${os.map((o) => OFFICES[o].name.toLowerCase()).join(" or ")}`);
/** using office for the family company: a chance the papers find out */
function conflict(g: GameState, rng: Rng, p: number): string {
  if (!rng.chance(p)) return "";
  bump(g, "reputation", -12); polOf(g).scandal = Math.min(30, polOf(g).scandal + 8);
  mark(g, { id: "conflict", side: "public", kind: "grievance", weight: 10, text: "used public office for the family company" });
  pushHeadline(g, "Conflict of Interest", `The papers show the family's company profiting from ${fullName(g, head(g)!)}'s votes.`, "Politics");
  return " The papers have the story.";
}
/** a pending law at this level the office can act on */
const billAt = (g: GameState, lv: Level[], arg?: string) => (arg ? lawById(arg) : undefined) ?? LAWS.find((l) => lv.includes(l.level) && lawsOf(g)[l.id].passed === undefined && cal(g).year >= l.range[0] && cal(g).year <= l.range[1]);
const lvOf = (g: GameState): Level[] => { const o = office(g); return o ? [OFFICES[o].level] : []; };

export const OFFICE_ACTIONS: ActionDef[] = [
  {
    id: "run", group: "Office", name: "Run for office",
    blurb: "Stand at the next election for the next office up the ladder. Campaign money improves the odds.",
    cost: (g) => { const n = nextOffice(g); return n ? Math.round(OFFICES[n].cost * era(g)) : 0; },
    blocked: (g) => {
      if (!inPolitics(g)) return "Only for a family member in politics";
      const n = nextOffice(g);
      if (!n) return "At the top of the ladder";
      if (g.career?.running) return "Already in the race";
      if (!raceYear(n, cal(g).year)) return `No election for ${OFFICES[n].name.toLowerCase()} this year`;
      if (cal(g).season === "Autumn" || cal(g).season === "Winter") return "The campaign starts in spring";
      return null;
    },
    run: (g) => {
      const c = (g.career ??= { side: "business", record: [], laws: [] }), n = nextOffice(g)!;
      c.running = { office: n, year: cal(g).year, spent: Math.round(OFFICES[n].cost * era(g)) };
      return `${fullName(g, head(g)!)} stands for ${OFFICES[n].name.toLowerCase()} (${Math.round(raceOdds(g, n, c.running.spent) * 100)}% odds).`;
    },
  },
  {
    id: "pass_bill", group: "Office", name: "Pass a bill",
    blurb: "Use your vote and your office to pass a pending law at your level now.",
    cost: () => 0,
    blocked: (g, arg) => at("council", "mayor", "statesenate", "governor", "congress", "senate")(g) ?? (billAt(g, lvOf(g), arg) ? null : "No bill at your level is ready"),
    run: (g, rng, arg) => {
      const l = billAt(g, lvOf(g), arg)!, o = office(g)!;
      const odds = o === "governor" || o === "mayor" ? 0.8 : 0.45 + (head(g) && hasTrait(g, "orator") ? 0.15 : 0);
      if (!rng.chance(odds)) { lawsOf(g)[l.id].shift += 2; return `The ${l.name} falls short — but it's closer (due ${lawYear(g, l)}).`; }
      passLaw(g, l);
      g.career!.laws.push({ id: l.id, act: "passed", year: cal(g).year });
      mark(g, { id: `passed_${l.id}`, side: l.side === "reform" ? "labour" : "owners", kind: l.side === "reform" ? "trust" : "favour", weight: 12, text: `passed the ${l.name}` });
      if (l.side === "reform") for (const r of g.rivals) r.stance = Math.max(-100, (r.stance ?? 0) - 6);
      return `The ${l.name} passes.`;
    },
  },
  {
    id: "kill_bill", group: "Office", name: "Kill a bill",
    blurb: "Bury a pending law at your level: four years later at the earliest (a governor's veto, a chairman's drawer).",
    cost: () => 0,
    blocked: (g, arg) => at("council", "mayor", "statesenate", "governor", "congress", "senate")(g) ?? (billAt(g, lvOf(g), arg) ? null : "No bill at your level to kill"),
    run: (g, _rng, arg) => {
      const l = billAt(g, lvOf(g), arg)!;
      lawsOf(g)[l.id].shift -= 4;
      g.career!.laws.push({ id: l.id, act: "killed", year: cal(g).year });
      mark(g, { id: `killed_${l.id}`, side: l.side === "reform" ? "labour" : "owners", kind: l.side === "reform" ? "grievance" : "grudge", weight: 10, text: `killed the ${l.name}` });
      if (l.side === "reform") for (const r of g.rivals) r.stance = Math.min(100, (r.stance ?? 0) + 6);
      return `The ${l.name} is dead for now (due ${lawYear(g, l)} at the earliest).`;
    },
  },
  {
    id: "police_out", group: "Office", name: "Keep the police out of the strikes",
    blurb: "As mayor or governor: no police, no troops for the owners at any picket line in the valley. The union won't forget; the owners won't either.",
    cost: () => 0, blocked: at("mayor", "governor"),
    run: (g) => {
      for (const u of sieges(g)) u.siege!.force = 0;
      for (const r of g.rivals) { if (r.strikeUntil && r.strikeUntil > g.turn) r.strikeUntil += 1; r.stance = Math.max(-100, (r.stance ?? 0) - 8); }
      mark(g, { id: "policeOut", side: "labour", kind: "trust", weight: 12, text: "kept the police away from the picket lines" });
      return "The police stay in their stations; the strikers hold the streets.";
    },
  },
  {
    id: "police_in", group: "Office", name: "Send the police to the mills",
    blurb: "As mayor or governor: police (or the militia) open the gates of every struck works in the valley. Strikes end sooner; there may be shooting.",
    cost: () => 0, blocked: at("mayor", "governor"),
    run: (g, rng) => {
      let ended = 0;
      for (const r of g.rivals) if (r.strikeUntil && r.strikeUntil > g.turn) { r.strikeUntil = g.turn; r.stance = Math.min(100, (r.stance ?? 0) + 10); ended++; }
      for (const u of sieges(g)) u.siege!.force += 0.7;
      mark(g, { id: "policeIn", side: "labour", kind: "grievance", weight: 14, text: "sent the police against the strikers" });
      if (rng.chance(0.3)) { polOf(g).scandal += 6; pushHeadline(g, "Police Club Strikers", "Mounted police charge a picket line; dozens are hurt.", "Labor"); }
      return ended ? `The police open the gates at ${ended} works.` : "The police stand ready at the mill gates.";
    },
  },
  {
    id: "tariff_vote", group: "Office", name: "Write the tariff",
    blurb: "In Congress: protect the valley's industries. Every works' prices +6% for five years — and the family's more than most.",
    cost: () => 0, blocked: at("congress", "senate"),
    run: (g, rng) => {
      g.company!.biz.tariffUntil = g.turn + 20;
      return "The tariff schedule protects iron, steel, glass and machinery." + conflict(g, rng, 0.2);
    },
  },
  {
    id: "city_contract", group: "Office", name: "Steer a contract to the family works",
    blurb: "As councilman or mayor: the city's orders go to the family company: prices +8% for a year. A one-in-four chance the papers find out.",
    cost: () => 0, blocked: at("council", "mayor"),
    run: (g, rng) => {
      for (const w of [g.company!, ...g.company!.others]) g.mods.push({ kind: "price", mult: 1.08, until: g.turn + 4, source: "City contracts", industry: [w.industry] });
      return "The city's orders go to the family's works." + conflict(g, rng, 0.25);
    },
  },
  {
    id: "mediate", group: "Office", name: "Mediate the strike",
    blurb: "As mayor or governor: bring both sides to the table. The family's works settles on a compromise; the union and the public remember a fair broker.",
    cost: () => 0, blocked: (g) => at("mayor", "governor")(g) ?? (sieges(g).length ? null : "No strike to mediate"),
    run: (g) => {
      for (const u of sieges(g)) settle(g, u, true);
      mark(g, { id: "mediated", side: "public", kind: "trust", weight: 8, text: "brought both sides to the table" });
      return "Both sides sign at City Hall.";
    },
  },
];

/** who holds the office at a level, taking the family's own officeholder into account */
export function holderWithFamily(g: GameState, level: Level, year: number): Holder {
  return familyHolder(g, level) ?? holderAt(level, year);
}
