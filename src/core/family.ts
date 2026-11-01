// The family: four eras, four heads. You name the founder in 1850; children are born, grow up and show what
// kind of people they are (shaped by what the family did: an endowed university makes scholars, a fortune makes
// spoiled heirs, the works makes men the men respect). At the first spring of each new era the head steps down
// and an heir takes over — and chooses the family's path: stay in the business, buy into a new industry, go
// into politics, give the works to the men, or sell up and live as a financier. A merger or a takeover can force
// the succession early.

import { bump, pushHeadline } from "./business";
import { allWorks, cal, type GameState, log, updateAccess, updateWorksAccess, type Works } from "./game";
import { INDUSTRIES, industriesIn, type IndustryId } from "./industries";
import { inheritLedger, mark, martyrsOf, standing, topMarks, whoDid } from "./ledger";
import { Rng } from "./rng";
import { ERAS, priceLevel } from "./time";
import { sellWorks } from "./rivalai";
import { holdingsValue, sellBiz, sellShares, sellStake } from "./holdings";

export type Path = "business" | "industry" | "politics" | "coop" | "financier";
export type TraitId = "works" | "scholar" | "abroad" | "spoiled" | "married" | "orator" | "iron" | "reformer";

export interface Person { first: string; sex: "m" | "f"; born: number; traits: TraitId[] }
export interface Head extends Person {
  from: number; to?: number; path: Path;
  /** a line for the family tree: what they were remembered for */
  verdict?: string;
  /** cash when they took over and left */
  cashFrom?: number; cashTo?: number;
  /** offices held (politics path) */
  offices?: string[];
}

export interface Succession {
  year: number;
  reason: "era" | "merger" | "takeover";
  /** paths open this time (all, unless forced) */
  paths: Path[];
  /** a line on why it came now */
  note: string;
  /** what the buyer paid, in cash or stock (merger / takeover) */
  proceeds?: number;
}

export interface Family {
  surname: string;
  heads: Head[];
  heirs: Person[];
  succession?: Succession;
  /** the heir chose a new industry: the next works founded in it becomes the company's main works */
  newIndustry?: { industry: IndustryId; sellOld: boolean };
  /** a hired manager runs the works (politics, financier, or a division of U.S. Steel) */
  managed?: boolean;
  /** policy changes are free until this turn (a new head's fresh start) */
  freshUntil?: number;
}

export const PATHS: Record<Path, { name: string; blurb: string }> = {
  business: { name: "Stay in the family business", blurb: "Carry on at the works. A fresh start: policy changes cost no actions this year." },
  industry: { name: "Buy into a new industry", blurb: "Found a works in another industry; it becomes the company's main works. Sell the old works or keep them." },
  politics: { name: "Go into politics", blurb: "Run for office. A manager runs the works; you hold the levers of the city, the state, then Washington." },
  coop: { name: "Give the works to the men", blurb: "Employee ownership: profits shared, the union a partner, no strikes. The other owners throw you out; the banks charge more." },
  financier: { name: "Sell up and invest", blurb: "Sell the other works; a manager runs the first. Live off stakes, shares and businesses." },
};

/** a word or two for the family tree */
export const PATH_SHORT: Record<Path, string> = { business: "the business", industry: "a new industry", politics: "politics", coop: "the co-op", financier: "finance" };

export const TRAITS: Record<TraitId, { name: string; blurb: string }> = {
  works: { name: "Raised in the works", blurb: "Knows the men by name: labour relations +10, the union less militant." },
  scholar: { name: "Schooled at the university", blurb: "New processes are built 15% faster." },
  abroad: { name: "Sent abroad", blurb: "European contacts: new processes cost 10% less." },
  spoiled: { name: "Spoiled by the fortune", blurb: "Houses, yachts and Paris: 1% of the fortune a season; reputation −5." },
  married: { name: "Married money", blurb: "A match with an old Pittsburgh family: a dowry, and their bank is a friend." },
  orator: { name: "A born speaker", blurb: "Better odds in elections; influence fades more slowly." },
  iron: { name: "Hard as iron", blurb: "Strikebreakers and guards work better; labour relations −8." },
  reformer: { name: "A reformer", blurb: "Reputation +8; the other owners are wary." },
};

const NAMES: Record<"m" | "f", [number, string[]][]> = {
  m: [[1800, ["James", "John", "William", "Thomas", "Andrew", "Henry", "Benjamin", "Robert", "Samuel", "George"]],
    [1850, ["Henry", "Charles", "Richard", "Edward", "Walter", "Arthur", "Frederick", "Howard", "Albert", "Harold"]],
    [1890, ["Richard", "Robert", "John", "William", "Thomas", "Paul", "Edward", "Frank", "Joseph", "Lawrence"]],
    [1920, ["Richard", "David", "Robert", "John", "Michael", "Thomas", "Peter", "James", "Stephen", "Mark"]]],
  f: [[1800, ["Mary", "Margaret", "Elizabeth", "Sarah", "Anna", "Jane", "Martha", "Catherine"]],
    [1850, ["Helen", "Alice", "Frances", "Edith", "Florence", "Grace", "Louise", "Clara"]],
    [1890, ["Ruth", "Dorothy", "Katherine", "Eleanor", "Marion", "Virginia", "Margaret", "Elizabeth"]],
    [1920, ["Barbara", "Joan", "Nancy", "Patricia", "Carol", "Susan", "Anne", "Judith"]]],
};
export const SURNAMES = ["Calder", "Ashworth", "Wolcott", "Brannock", "Haldane", "Strachan", "Kerr", "Lindsay", "Moorhead", "Thaw", "Denny", "Blackburn"];
export const FOUNDER_NAMES = NAMES.m[0][1];

const pickName = (rng: Rng, sex: "m" | "f", born: number) => { const list = [...NAMES[sex]].reverse().find(([y]) => born >= y)![1]; return list[rng.int(0, list.length - 1)]; };

export const familyOf = (g: GameState) => g.family;
export const head = (g: GameState): Head | undefined => g.family?.heads[g.family.heads.length - 1];
export const hasTrait = (g: GameState, t: TraitId) => !!head(g)?.traits.includes(t);
export const fullName = (g: GameState, p: Person) => `${p.first} ${g.family?.surname ?? ""}`.trim();
export const age = (g: GameState, p: Person) => cal(g).year - p.born;
export const managed = (g: GameState) => !!g.family?.managed;

/** Start the family when the company is founded. */
export function startFamily(g: GameState, first: string, surname: string, sex: "m" | "f" = "m") {
  const y = cal(g).year;
  g.family = { surname, heads: [{ first, sex, born: y - 30, traits: [], from: y, path: "business", cashFrom: g.company?.cash }], heirs: [] };
  g.family.heirs = children(g, y);
}

/** two or three children for a new head, born over the next decade */
function children(g: GameState, from: number): Person[] {
  const rng = new Rng(`${g.seed}:children:${from}`);
  const n = rng.int(2, 3), out: Person[] = [];
  for (let k = 0; k < n; k++) {
    const sex: "m" | "f" = k === 0 || rng.chance(0.55) ? "m" : "f";
    const born = from - 6 + k * 4 + rng.int(0, 3);
    let first = pickName(rng, sex, born);
    for (let t = 0; t < 5 && out.some((o) => o.first === first); t++) first = pickName(rng, sex, born);
    out.push({ first, sex, born, traits: [] });
  }
  return out;
}

/** the traits an heir grows into, from what the family did while they grew up */
function growTraits(g: GameState, p: Person): TraitId[] {
  const c = g.company!, f = c.biz.flags, m = c.biz.meters;
  const rng = new Rng(`${g.seed}:traits:${p.first}:${p.born}`);
  const w: [TraitId, number][] = [
    ["works", 1 + (standing(g, "labour") > 0 ? 2 : 0) + c.annexes.filter((a) => a.kind === "housing").length * 0.5],
    ["scholar", 1 + (f.endowed ? 4 : 0) + (f.lab ? 2 : 0)],
    ["abroad", 1 + (c.cash > 1e6 ? 1 : 0)],
    ["spoiled", 0.5 + (c.cash > 5e6 ? 3 : c.cash > 1e6 ? 1.5 : 0)],
    ["married", 1 + (m.influence > 30 ? 1 : 0)],
    ["orator", 1 + (m.influence > 40 ? 2 : 0)],
    ["iron", 1 + (standing(g, "labour") < -30 ? 2.5 : 0)],
    ["reformer", 1 + (m.reputation > 20 ? 2 : 0) + (f.relief ? 1 : 0)],
  ];
  const out: TraitId[] = [];
  const n = rng.chance(0.6) ? 2 : 1;
  while (out.length < n) {
    const pool = w.filter(([t]) => !out.includes(t));
    const tot = pool.reduce((s, [, v]) => s + v, 0);
    let r = rng.next() * tot;
    for (const [t, v] of pool) { r -= v; if (r <= 0) { out.push(t); break; } }
    if (out.length < n && r > 0) out.push(pool[pool.length - 1][0]);
  }
  return out;
}

/** each season: heirs come of age (18) and show their character; the spoiled spend */
export function familySeason(g: GameState) {
  const f = g.family, c = g.company;
  if (!f || !c) return;
  const y = cal(g).year;
  for (const p of f.heirs) if (!p.traits.length && y - p.born >= 18) {
    p.traits = growTraits(g, p);
    log(g, `${fullName(g, p)} comes of age: ${p.traits.map((t) => TRAITS[t].name.toLowerCase()).join(", ")}.`);
  }
  if (hasTrait(g, "spoiled") && c.cash > 0) c.cash -= Math.round(c.cash * 0.01);
}

/** the succession falls due at the first spring of each new era */
export function successionDue(g: GameState): boolean {
  const c = cal(g);
  return !!g.company && !!g.family && !g.family.succession && c.season === "Spring" && c.era.id !== "I" && c.year === c.era.startYear;
}

export function beginSuccession(g: GameState, reason: Succession["reason"] = "era", proceeds?: number, paths?: Path[]) {
  const f = g.family!, y = cal(g).year, h = head(g)!;
  const prev = ERAS.find((e) => y - 1 >= e.startYear && y - 1 <= e.endYear);
  const note = reason === "era" ? `${prev?.name ?? "An era"} is over. ${fullName(g, h)}, ${y - h.born}, steps down.`
    : reason === "merger" ? `Morgan's men have bought the works for U.S. Steel stock. ${fullName(g, h)} retires a rich man.`
      : `The buyers have taken the company. ${fullName(g, h)} hands the proceeds to the next generation.`;
  f.succession = { year: y, reason, note, proceeds, paths: paths ?? (Object.keys(PATHS) as Path[]) };
  // an heir too young is still a candidate (a guardian runs things); none at all: a nephew
  if (!f.heirs.length) f.heirs = children(g, y - 25);
  for (const p of f.heirs) if (!p.traits.length) p.traits = growTraits(g, p);
}

/** federal estate tax, top rate, by year (half of it is what a family with good lawyers really paid) */
export function estateRate(y: number): number {
  return y < 1916 ? 0 : y < 1917 ? 0.1 : y < 1924 ? 0.25 : y < 1926 ? 0.4 : y < 1932 ? 0.2 : y < 1934 ? 0.45 : y < 1935 ? 0.6 : y < 1941 ? 0.7 : y < 1977 ? 0.77 : y < 1982 ? 0.7 : 0.65;
}
export function estateTax(g: GameState, foundation: boolean): number {
  const c = g.company!, y = cal(g).year, hv = holdingsValue(g);
  // the estate is the cash and everything held beyond the works (the works themselves pass in the company)
  const base = Math.max(0, c.cash + hv.biz + hv.stakes + hv.shares - 60000 * priceLevel(y));
  return Math.round(base * estateRate(y) * 0.5 * (foundation ? 0.5 : 1));
}
/** what a family foundation takes from the fortune (a fifth) */
export const foundationGift = (g: GameState) => Math.max(0, Math.round(g.company!.cash * 0.2));

export interface SuccessionChoice { heir: number; path: Path; industry?: IndustryId; sellOld?: boolean; foundation?: boolean; side?: "business" | "reform" }

/** the heir takes over and sets the family's course */
export function resolveSuccession(g: GameState, ch: SuccessionChoice): string {
  const f = g.family!, c = g.company!, s = f.succession!, y = cal(g).year;
  const old = head(g)!;
  const heir = f.heirs[ch.heir] ?? f.heirs[0];
  const path = s.paths.includes(ch.path) ? ch.path : s.paths[0];
  old.to = y; old.cashTo = Math.round(c.cash);
  old.verdict = verdictOf(g, old);
  // the estate: tax, or a foundation (Heinz, Mellon, Carnegie did both)
  const parts: string[] = [];
  if (ch.foundation) {
    const gift = foundationGift(g);
    c.cash -= gift;
    bump(g, "reputation", 12);
    mark(g, { id: `foundation${y}`, side: "public", kind: "trust", weight: 20, text: `endowed the ${f.surname} Foundation` });
    parts.push(`The ${f.surname} Foundation is endowed with $${gift.toLocaleString("en-US")}.`);
  }
  const tax = estateTax(g, !!ch.foundation);
  if (tax) {
    c.cash -= tax;
    parts.push(`Estate tax: $${tax.toLocaleString("en-US")}.`);
    // the executors sell what they must to pay it: shares first, then stakes, then the businesses
    if (c.cash < 0) parts.push(payFromHoldings(g));
  }
  inheritLedger(g);
  const h: Head = { ...heir, from: y, path, cashFrom: Math.round(c.cash), offices: [] };
  f.heads.push(h);
  f.heirs = children(g, y);
  f.succession = undefined;
  f.freshUntil = g.turn + 4;
  const was = f.managed;
  // a head who leaves politics leaves office
  if (path !== "politics" && g.career?.office) { g.career.record.push(`${y}: left office with the succession`); g.career.office = undefined; g.career.until = undefined; }
  f.managed = path === "politics" || path === "financier";
  if (c.biz.flags.division && path !== "industry") f.managed = true;
  // one-off traits
  if (h.traits.includes("married")) {
    const dowry = Math.round(150000 * priceLevel(y));
    c.cash += dowry;
    const mellon = g.rivals.find((r) => r.id === "mellon");
    if (mellon) mellon.stance = Math.min(100, (mellon.stance ?? 0) + 40);
    parts.push(`The wedding brings a dowry of $${dowry.toLocaleString("en-US")} and friends at the Mellon bank.`);
  }
  // the path
  switch (path) {
    case "business": if (g.career && !g.career.office) g.career = undefined; parts.push(was ? "The family takes the works back from the managers." : "The works stays in the family's hands."); break;
    case "industry": {
      const ind = ch.industry && ch.industry !== c.industry ? ch.industry : industriesIn(cal(g).year).find((i) => i !== c.industry)!;
      f.newIndustry = { industry: ind, sellOld: !!ch.sellOld };
      if (ch.sellOld) for (const w of [...c.others]) if (w.industry !== ind) parts.push(sellWorks(g, w, "market"));
      parts.push(`The family will build a ${INDUSTRIES[ind].name.toLowerCase()} works: found it from the Works tab.`);
      break;
    }
    case "politics": {
      bump(g, "influence", 15);
      g.career = { side: ch.side ?? (standing(g, "labour") > 10 ? "reform" : "business"), record: [], laws: [] };
      parts.push(`A manager runs the works; ${h.first} runs for the city council.`);
      break;
    }
    case "coop": {
      makeCoop(g);
      parts.push("The works passes to the men who work it.");
      break;
    }
    case "financier": {
      for (const w of [...c.others]) parts.push(sellWorks(g, w, "market"));
      parts.push("A manager runs the first works; the family lives on its investments.");
      break;
    }
  }
  const traitLine = h.traits.length ? ` (${h.traits.map((t) => TRAITS[t].name.toLowerCase()).join(", ")})` : "";
  pushHeadline(g, `${fullName(g, h)} Takes the Helm`, `${s.note} ${fullName(g, h)}${traitLine} takes over: ${PATHS[path].name.toLowerCase()}. ${parts.join(" ")}`, "Industry");
  c.biz.record.push(`${y}: ${fullName(g, h)} succeeds ${fullName(g, old)} — ${PATHS[path].name}`);
  log(g, `${fullName(g, h)} succeeds ${old.first}. ${parts.join(" ")}`);
  return parts.join(" ");
}

/** sell holdings until the cash is back above zero; returns what was sold */
function payFromHoldings(g: GameState): string {
  const c = g.company!, h = c.holdings, sold: string[] = [];
  if (!h) return "";
  for (const id of Object.keys(h.shares)) { if (c.cash >= 0) break; if (sellShares(g, id).ok) sold.push(`shares in ${id}`); }
  for (const id of Object.keys(h.stakes)) while (c.cash < 0 && (h.stakes[id] ?? 0) > 0) { if (!sellStake(g, id).ok) break; if (!sold.includes(`stake in ${id}`)) sold.push(`stake in ${id}`); }
  for (const b of [...h.biz]) { if (c.cash >= 0) break; if (sellBiz(g, b.id).ok) sold.push(b.id); }
  return sold.length ? `The executors sell ${sold.length} holding${sold.length > 1 ? "s" : ""} to pay it.` : "";
}

/** a left-open succession: the eldest takes over and stays in the business (or, if forced, the first path open) */
export function defaultSuccession(g: GameState): string {
  const s = g.family!.succession!;
  return resolveSuccession(g, { heir: 0, path: s.paths.includes("business") ? "business" : s.paths[0], industry: undefined, sellOld: false });
}

function verdictOf(g: GameState, h: Head): string {
  const top = topMarks(g, 20).filter((m) => m.gen === g.family!.heads.indexOf(h));
  const known = top[0] ? `remembered because ${h.sex === "f" ? "she" : "he"} ${top[0].text}` : "remembered for little";
  const delta = (h.cashTo ?? 0) - (h.cashFrom ?? 0);
  return `${delta >= 0 ? "grew" : "lost"} the fortune by $${Math.abs(Math.round(delta)).toLocaleString("en-US")}; ${known}.`;
}

/** employee ownership: the union a partner, profits shared, the owners and the banks cold */
export function makeCoop(g: GameState) {
  const c = g.company!, p = c.biz.policy;
  c.biz.flags.coop = true;
  p.union = "recognise"; p.wages = "scale"; p.companyStore = false; p.childLabour = false; if (p.safety === "none") p.safety = "basic";
  bump(g, "labour", 40); bump(g, "reputation", 15); g.morale = Math.min(100, g.morale + 6);
  mark(g, { id: "coop", side: "labour", kind: "precedent", weight: 40, text: "gave the works to the men" });
  mark(g, { id: "coopTrust", side: "labour", kind: "trust", weight: 40, text: "gave the works to the men" });
  for (const r of g.rivals) r.stance = Math.max(-100, (r.stance ?? 0) - 30);
  if (g.owners) g.owners.member = false;
  for (const u of Object.values(g.unions ?? {})) if (u) { u.recognised = true; u.coop = true; u.militancy = 0; u.demand = undefined; u.siege = undefined; }
}

/**
 * Make another works the company's main works (the heir's new industry): the two swap places in the company.
 * The company keeps its name, cash, standing and holdings; the old main works becomes one of the others.
 */
const WORKS_KEYS = ["name", "industry", "x", "y", "footprint", "techs", "employees", "produced", "seasonsOperating", "lastSeason", "riverSide", "status", "strikeTurns", "health", "unrest", "spur", "dock", "freight", "research", "annexes", "fromRival", "founded"] as const;
export function makeMain(g: GameState, w: Works): Works {
  const c = g.company! as unknown as Record<string, unknown>, o = w as unknown as Record<string, unknown>;
  for (const k of WORKS_KEYS) { const t = c[k]; c[k] = o[k]; o[k] = t; }
  // the old main keeps the new works' id; the company stays "p"
  o.access = undefined;
  g.access = undefined;
  updateAccess(g);
  updateWorksAccess(g, w);
  g.world.version++;
  return w;
}

/** called when a works is founded: if it's the heir's new industry, it becomes the main works (and the old one may be sold) */
export function foundedWorks(g: GameState, w: Works) {
  const f = g.family, c = g.company!;
  if (!f?.newIndustry || w.industry !== f.newIndustry.industry) return;
  const sell = f.newIndustry.sellOld;
  f.newIndustry = undefined;
  const old = makeMain(g, w);
  delete c.biz.flags.division;
  log(g, `${c.name} is now a ${INDUSTRIES[c.industry].name.toLowerCase()} company.`);
  if (sell) log(g, sellWorks(g, old, "market", c.biz.flags.toUss ? 0 : 1));
  delete c.biz.flags.toUss;
}

/** a hired manager runs the works: buys the processes the industry has, settles long strikes, takes a fee */
export function managerSeason(g: GameState, commission: (w: Works, id: string) => void, settle: () => void): number {
  const c = g.company;
  if (!c || !g.family?.managed) return 0;
  const y = cal(g).year;
  for (const w of allWorks(c)) {
    if (w.research) continue;
    const t = INDUSTRIES[w.industry].tech.find((t) => t.cost > 0 && t.year <= y - 3 && !w.techs.includes(t.id) && t.requires.every((r) => w.techs.includes(r)));
    if (t && c.cash > t.cost * priceLevel(y) * 2.5) commission(w, t.id);
  }
  if (allWorks(c).some((w) => w.status === "strike") && (g.unions && Object.values(g.unions).some((u) => u?.siege && u.siege.seasons >= 2))) settle();
  return Math.round((c.totals?.revenue ?? 0) * 0.02);
}

export const generationWord = (g: GameState, gen: number) => whoDid(g, { gen } as never);
export const martyrs = martyrsOf;
