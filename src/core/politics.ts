// Politics: who holds office, who controls the council and the legislature, and when the laws come.
//
// Office-holders are the real ones, year by year (mayors of Pittsburgh, governors of Pennsylvania, presidents).
// What can change is the balance behind them: at each election the business bloc and the reform/labour bloc
// fight for the council, the legislature and Congress, with your money, the rivals' money, the union vote and
// the public's mood. The balance moves the laws: each has its historical year and a range it can move in.
// When a law passes, your policies must follow it (or you defy it and pay).

import { type ActionDef, bump, type DecisionOption, type Decision, type Policy, pushHeadline } from "./business";
import { allWorks, cal, type GameState, log } from "./game";
import { applyEffects } from "./effects";
import { allEffects } from "./eventdata";
import { mark, standing } from "./ledger";
import { priceLevel } from "./time";
import { hasTrait } from "./family";
import { eventsFor } from "./events";
import { familyHolder } from "./career";

export type Level = "city" | "state" | "federal";
export const LEVELS: Level[] = ["city", "state", "federal"];
export const LEVEL_NAME: Record<Level, string> = { city: "City Hall", state: "Harrisburg", federal: "Washington" };
export const BODY: Record<Level, string> = { city: "the council", state: "the legislature", federal: "Congress" };

/** [from year, name, party, lean −1 business … +1 reform/labour] */
type H = [number, string, string, number];
const MAYORS: H[] = [
  [1850, "Joseph Barker", "Know-Nothing", -0.2], [1851, "John B. Guthrie", "Democrat", 0.1], [1853, "Robert M. Riddle", "Whig", -0.3], [1854, "Ferdinand E. Volz", "Democrat", 0],
  [1856, "William Bingham", "Republican", -0.3], [1857, "Henry A. Weaver", "Republican", -0.3], [1860, "George Wilson", "Republican", -0.3], [1862, "B. C. Sawyer", "Republican", -0.3],
  [1864, "James Lowry Jr.", "Republican", -0.3], [1866, "W. C. McCarthy", "Republican", -0.3], [1868, "James Blackmore", "Democrat", 0], [1869, "Jared M. Brush", "Republican", -0.4],
  [1872, "James Blackmore", "Democrat", 0], [1875, "W. C. McCarthy", "Republican", -0.3], [1878, "Robert Liddell", "Democrat", 0.1], [1881, "Robert W. Lyon", "Republican", -0.5],
  [1884, "Andrew Fulton", "Republican", -0.5], [1887, "William McCallin", "Republican", -0.6], [1890, "H. I. Gourley", "Republican", -0.5], [1893, "Bernard McKenna", "Democrat", 0],
  [1896, "Henry P. Ford", "Republican", -0.6], [1899, "William J. Diehl", "Republican", -0.6], [1901, "J. O. Brown (recorder)", "Republican", -0.7], [1903, "William B. Hays", "Citizens", 0.2],
  [1906, "George W. Guthrie", "Democrat (reform)", 0.6], [1909, "William A. Magee", "Republican (progressive)", 0.2], [1914, "Joseph G. Armstrong", "Republican", -0.4],
  [1918, "E. V. Babcock", "Republican", -0.5], [1922, "William A. Magee", "Republican", 0], [1926, "Charles H. Kline", "Republican", -0.7], [1933, "John S. Herron", "Republican", -0.4],
  [1934, "William N. McNair", "Democrat", 0.6], [1936, "Cornelius D. Scully", "Democrat", 0.5], [1946, "David L. Lawrence", "Democrat", 0.3], [1959, "Thomas J. Gallagher", "Democrat", 0.3],
  [1959.5, "Joseph M. Barr", "Democrat", 0.4], [1970, "Pete Flaherty", "Democrat (independent)", 0.5], [1977, "Richard Caliguiri", "Democrat", 0.3],
];
const GOVERNORS: H[] = [
  [1848, "William F. Johnston", "Whig", -0.3], [1852, "William Bigler", "Democrat", 0], [1855, "James Pollock", "Whig/Know-Nothing", -0.3], [1858, "William Packer", "Democrat", 0],
  [1861, "Andrew Curtin", "Republican", -0.2], [1867, "John W. Geary", "Republican", -0.4], [1873, "John F. Hartranft", "Republican", -0.6], [1879, "Henry M. Hoyt", "Republican", -0.5],
  [1883, "Robert E. Pattison", "Democrat", 0.3], [1887, "James A. Beaver", "Republican", -0.6], [1891, "Robert E. Pattison", "Democrat", 0.3], [1895, "Daniel H. Hastings", "Republican", -0.6],
  [1899, "William A. Stone", "Republican", -0.7], [1903, "Samuel Pennypacker", "Republican", -0.6], [1907, "Edwin S. Stuart", "Republican", -0.5], [1911, "John K. Tener", "Republican", -0.4],
  [1915, "Martin G. Brumbaugh", "Republican", -0.3], [1919, "William C. Sproul", "Republican", -0.5], [1923, "Gifford Pinchot", "Republican (progressive)", 0.6], [1927, "John S. Fisher", "Republican", -0.6],
  [1931, "Gifford Pinchot", "Republican (progressive)", 0.7], [1935, "George H. Earle III", "Democrat", 0.8], [1939, "Arthur H. James", "Republican", -0.5], [1943, "Edward Martin", "Republican", -0.5],
  [1947, "James H. Duff", "Republican", -0.1], [1951, "John S. Fine", "Republican", -0.3], [1955, "George M. Leader", "Democrat", 0.5], [1959, "David L. Lawrence", "Democrat", 0.4],
  [1963, "William Scranton", "Republican", 0], [1967, "Raymond P. Shafer", "Republican", -0.1], [1971, "Milton Shapp", "Democrat", 0.5], [1979, "Dick Thornburgh", "Republican", -0.3],
];
const PRESIDENTS: H[] = [
  [1849, "Zachary Taylor", "Whig", -0.2], [1850.5, "Millard Fillmore", "Whig", -0.2], [1853, "Franklin Pierce", "Democrat", 0], [1857, "James Buchanan", "Democrat", 0],
  [1861, "Abraham Lincoln", "Republican", -0.1], [1865.3, "Andrew Johnson", "Democrat", 0], [1869, "Ulysses S. Grant", "Republican", -0.5], [1877, "Rutherford B. Hayes", "Republican", -0.6],
  [1881, "James Garfield", "Republican", -0.4], [1881.7, "Chester A. Arthur", "Republican", -0.4], [1885, "Grover Cleveland", "Democrat", 0], [1889, "Benjamin Harrison", "Republican", -0.6],
  [1893, "Grover Cleveland", "Democrat", -0.1], [1897, "William McKinley", "Republican", -0.7], [1901.7, "Theodore Roosevelt", "Republican", 0.2], [1909, "William Howard Taft", "Republican", -0.2],
  [1913, "Woodrow Wilson", "Democrat", 0.4], [1921, "Warren G. Harding", "Republican", -0.6], [1923.6, "Calvin Coolidge", "Republican", -0.7], [1929, "Herbert Hoover", "Republican", -0.5],
  [1933, "Franklin D. Roosevelt", "Democrat", 0.8], [1945.3, "Harry S. Truman", "Democrat", 0.5], [1953, "Dwight D. Eisenhower", "Republican", -0.2], [1961, "John F. Kennedy", "Democrat", 0.4],
  [1963.9, "Lyndon B. Johnson", "Democrat", 0.6], [1969, "Richard Nixon", "Republican", -0.1], [1974.6, "Gerald Ford", "Republican", -0.2], [1977, "Jimmy Carter", "Democrat", 0.3],
  [1981, "Ronald Reagan", "Republican", -0.7],
];
const HOLDERS: Record<Level, H[]> = { city: MAYORS, state: GOVERNORS, federal: PRESIDENTS };
const TITLE: Record<Level, string> = { city: "Mayor", state: "Governor", federal: "President" };

export interface Holder { name: string; party: string; lean: number; title: string; from: number }
export function holderAt(level: Level, year: number): Holder {
  const list = HOLDERS[level];
  let h = list[0];
  for (const x of list) if (x[0] <= year + 0.01) h = x;
  return { name: h[1], party: h[2], lean: h[3], title: TITLE[level], from: Math.floor(h[0]) };
}
export const holderNow = (g: GameState, level: Level): Holder => familyHolder(g, level) ?? holderAt(level, cal(g).year + (["Spring", "Summer", "Autumn", "Winter"].indexOf(cal(g).season)) / 4);

/** where each level's balance sits by history alone (−100 business … +100 reform/labour) */
export function baseline(level: Level, year: number): number {
  const h = holderAt(level, year);
  // the bodies behind the office lean the same way, a little less
  return Math.round(h.lean * 55);
}

export interface PoliticsState {
  balance: Record<Level, number>;
  /** money pledged to a side before the next election at a level */
  fund: Partial<Record<Level, { side: "business" | "reform"; amount: number }>>;
  /** favours you can call in, from whoever holds an office now */
  favours: { who: string; level: Level; n: number }[];
  /** reform outrage from exposed graft and massacres (decays) */
  scandal: number;
  /** the results, for the Struggle view */
  results: { year: number; level: Level; text: string; balance: number }[];
}

export const polOf = (g: GameState): PoliticsState => (g.pol ??= { balance: { city: baseline("city", cal(g).year), state: baseline("state", cal(g).year), federal: baseline("federal", cal(g).year) }, fund: {}, favours: [], scandal: 0, results: [] });

/** elections: the city in years 1 mod 4 (1933, 1937…), the governor in years 2 mod 4 from 1874, Congress every even year */
export function electionYear(level: Level, year: number): boolean {
  return level === "city" ? year % 4 === 1 : level === "state" ? year >= 1874 && year % 4 === 2 : year % 2 === 0;
}
export function nextElection(level: Level, year: number): number { for (let y = year; y < year + 6; y++) if (electionYear(level, y)) return y; return year + 4; }

/** what decides an election: history, money, the union vote, the public mood, scandal. Returns the swing toward reform. */
export function electionForces(g: GameState, level: Level): { label: string; v: number }[] {
  const p = polOf(g), y = cal(g).year, era = priceLevel(y);
  const out: { label: string; v: number }[] = [];
  const f = p.fund[level];
  if (f) out.push({ label: `Your money (${f.side})`, v: (f.side === "reform" ? 1 : -1) * Math.min(25, 10 * Math.log2(1 + f.amount / (5000 * era))) });
  // the other owners always fund the business side (history counts that); hostile ones spend more against you
  const hostile = g.rivals.filter((r) => r.active && !r.closed && !r.owned && (r.stance ?? 0) <= -50).length;
  if (hostile) out.push({ label: "Owners who hate you", v: -Math.min(15, hostile * 4) });
  // the union vote, above or below what history had
  const mem = unionStrength(g), expected = y < 1890 ? 0.05 : y < 1933 ? 0.15 : y < 1950 ? 0.45 : 0.55;
  if (g.unions && Object.keys(g.unions).length) out.push({ label: "The union vote", v: (mem - expected) * (y >= 1933 ? 40 : 20) });
  // hard times and grievances turn voters to reform
  out.push({ label: "The public mood", v: (50 - g.morale) / 2.5 });
  if (p.scandal) out.push({ label: "Scandal", v: p.scandal });
  return out.filter((x) => Math.abs(x.v) >= 0.5);
}

const unionStrength = (g: GameState) => { const us = Object.values(g.unions ?? {}).filter(Boolean); return us.length ? us.reduce((s, u) => s + u!.membership, 0) / us.length : 0; };

/** the chance the reform/labour side carries the body, from where the balance would land */
export function reformOdds(g: GameState, level: Level): number {
  const swing = electionForces(g, level).reduce((s, x) => s + x.v, 0);
  const b = baseline(level, cal(g).year + 1) + swing;
  return Math.max(0.03, Math.min(0.97, 0.5 + b / 120));
}

/** Autumn of an election year: the votes are counted. */
function runElection(g: GameState, level: Level, rng: () => number) {
  const p = polOf(g), y = cal(g).year;
  const forces = electionForces(g, level);
  const swing = forces.reduce((s, x) => s + x.v, 0);
  const noise = (rng() - 0.5) * 24;
  const b = Math.max(-100, Math.min(100, baseline(level, y + 1) + swing + noise));
  p.balance[level] = Math.round(b);
  const reform = b > 0;
  const h = holderAt(level, y + 1);
  const text = `${reform ? "Reform and labour carry" : "The business men hold"} ${BODY[level]}${level === "federal" ? "" : ` under ${h.title} ${h.name}`} (${Math.round(Math.abs(b))} ${reform ? "toward reform" : "toward business"}).`;
  p.results.push({ year: y, level, text, balance: Math.round(b) });
  if (p.results.length > 40) p.results.shift();
  const f = p.fund[level];
  if (f && g.company) {
    const won = (f.side === "reform") === reform;
    if (won) {
      const fav = p.favours.find((x) => x.who === h.name);
      if (fav) fav.n++; else p.favours.push({ who: h.name, level, n: 1 });
      mark(g, { id: `backed_${level}_${y}`, side: "politics", kind: "favour", weight: 8, text: `backed the winning side in ${y}`, who: h.name });
      bump(g, "influence", 8);
    } else bump(g, "influence", -6);
    if (f.side === "reform") for (const r of g.rivals) r.stance = Math.max(-100, (r.stance ?? 0) - 6);
    if (f.side === "business") mark(g, { id: `fundBusiness_${level}`, side: "labour", kind: "grievance", weight: 3, text: "paid for the business ticket" });
  }
  p.fund[level] = undefined;
  log(g, `Election (${LEVEL_NAME[level]}): ${text}`);
  if (level !== "federal" || y % 4 === 0) pushHeadline(g, reform ? `Reform Sweeps ${level === "city" ? "City Council" : level === "state" ? "the Legislature" : "Congress"}` : `${level === "city" ? "The Organisation" : "Business Men"} Hold ${level === "city" ? "Council" : level === "state" ? "Harrisburg" : "Congress"}`, text, "Politics");
}

// ---------------------------------------------------------------- laws

export interface LawDef {
  id: string; name: string; level: Level; year: number; range: [number, number];
  /** reform laws pass sooner when reform holds the body; business laws (Taft-Hartley) the other way */
  side: "reform" | "business";
  blurb: string;
  /** the historical events this law is (they fire when the law passes, not on their dates if it's moved) */
  events?: string[];
  /** the policy it forces: a test and the compliant change */
  forbids?: { test: (p: Policy) => boolean; fix: Partial<Policy>; what: string };
  /** an environmental law (v0.18): the smoke-control level (1–4) or water treatment it requires, where, and how
   *  hard it is enforced (src/core/enviro.ts) */
  env?: { level?: number; water?: boolean; scope: "city" | "all"; light?: boolean; permits?: boolean; stretch?: boolean };
}

export const LAWS: LawDef[] = [
  { id: "workcomp", name: "Workmen's Compensation", level: "state", year: 1915, range: [1905, 1925], side: "reform", blurb: "Owners pay for every man killed or maimed: each death costs the company." },
  { id: "childlabour", name: "Child Labor Act", level: "state", year: 1915, range: [1905, 1925], side: "reform", blurb: "No boys under 14 in the mills, none under 16 at night.",
    forbids: { test: (p) => p.childLabour, fix: { childLabour: false }, what: "Boys in the works" } },
  { id: "police", name: "Coal and Iron Police abolished", level: "state", year: 1935, range: [1915, 1945], side: "reform", blurb: "No more private police with state commissions.",
    events: ["Coal and Iron Police Abolished"], forbids: { test: (p) => p.police, fix: { police: false }, what: "Company police" } },
  { id: "wagner", name: "The Wagner Act", level: "federal", year: 1935, range: [1920, 1945], side: "reform", blurb: "Collective bargaining by law: no fighting the union, no firing organisers, no lockouts.",
    events: ["The Wagner Act", "The Aliquippa Case"], forbids: { test: (p) => p.union === "fight", fix: { union: "tolerate" }, what: "Fighting the union" } },
  { id: "hours", name: "Fair Labor Standards Act", level: "federal", year: 1938, range: [1916, 1950], side: "reform", blurb: "The eight-hour day and the forty-hour week, by law.",
    forbids: { test: (p) => p.hours !== "eight", fix: { hours: "eight" }, what: "Shifts longer than eight hours" } },
  { id: "smoke1869", name: "Locomotive smoke ordinance", level: "city", year: 1869, range: [1860, 1885], side: "reform", blurb: "Locomotives may not burn soft coal inside the city. Like the ordinances after it, it is hardly enforced.", env: { scope: "city", light: true } },
  { id: "smokebureau", name: "Bureau of Smoke Regulation", level: "city", year: 1908, range: [1895, 1920], side: "reform", blurb: "The city's smoke inspectors: 'the smoke nuisance is not a necessary evil.' Works in the city must fire their boilers cleanly.", env: { level: 1, scope: "city", light: true } },
  { id: "cleanstreams", name: "Clean Streams Law", level: "state", year: 1937, range: [1925, 1950], side: "reform", blurb: "Pennsylvania limits what industry pours into its rivers (mine drainage still exempt). Works must treat their waste water.", env: { water: true, scope: "all", light: true } },
  { id: "smoke", name: "Smoke Control", level: "city", year: 1946, range: [1935, 1960], side: "reform", blurb: "Smokeless fuel for homes and mills; the skies clear. Works in the city need precipitators.", events: ["Smoke Control Enforced"], env: { level: 2, scope: "city" } },
  { id: "county1949", name: "Allegheny County smoke law", level: "city", year: 1949, range: [1940, 1962], side: "reform", blurb: "After Donora, smoke control for the whole county: every works in the valley needs precipitators.", env: { level: 2, scope: "all" } },
  { id: "cleanair", name: "Clean Air Act and the EPA", level: "federal", year: 1970, range: [1960, 1978], side: "reform", blurb: "National air standards, state plans to meet them, and a federal agency to enforce them: furnaces and ovens must be hooded.", env: { level: 3, scope: "all" } },
  { id: "caa1977", name: "Clean Air Act amendments", level: "federal", year: 1977, range: [1970, 1984], side: "reform", blurb: "A valley that misses the standards is 'nonattainment': scrubbers on the stacks, and no new furnace without cleaning up an old one first.", env: { level: 4, scope: "all", permits: true } },
  { id: "stretchout", name: "Steel Compliance Extension Act", level: "federal", year: 1981, range: [1979, 1985], side: "business", blurb: "The 'stretch-out': steel firms under a consent decree get three more years if the money goes into modernising instead.", env: { scope: "all", stretch: true } },
  { id: "tafthartley", name: "Taft-Hartley Act", level: "federal", year: 1947, range: [1940, 1990], side: "business", blurb: "Limits on strikes and the closed shop; injunctions against strikes.", events: ["Taft-Hartley"] },
  { id: "osha", name: "Occupational Safety and Health Act", level: "federal", year: 1970, range: [1950, 1980], side: "reform", blurb: "Federal safety rules and inspectors in every works.",
    forbids: { test: (p) => p.safety === "none", fix: { safety: "basic" }, what: "No safety men" } },
  { id: "cleanwater", name: "Clean Water Act", level: "federal", year: 1972, range: [1955, 1982], side: "reform", blurb: "No more slag and acid in the rivers.",
    forbids: { test: (p) => p.waste === "dump", fix: { waste: "standard" }, what: "Dumping in the river" } },
];

export interface LawState { shift: number; passed?: number; defied?: boolean; passedTurn?: number }
export const lawsOf = (g: GameState): Record<string, LawState> => {
  const L = (g.laws ??= {});
  for (const l of LAWS) L[l.id] ??= { shift: 0 }; // laws added since the game was saved
  return L;
};
/** the year the law is due now (history, moved by the balance and by lobbying) */
export function lawYear(g: GameState, l: LawDef): number {
  const s = lawsOf(g)[l.id] ?? { shift: 0 };
  return Math.round(Math.max(l.range[0], Math.min(l.range[1], l.year - s.shift)));
}
export const lawPassed = (g: GameState, id: string) => lawsOf(g)[id]?.passed !== undefined;
export const lawById = (id: string) => LAWS.find((l) => l.id === id);
/** the law whose event this is */
export const lawForEvent = (name: string) => LAWS.find((l) => l.events?.includes(name));

/** an illegal policy setting: why (or null) */
export function illegal(g: GameState, next: Partial<Policy>): string | null {
  const c = g.company;
  if (!c) return null;
  const p = { ...c.biz.policy, ...next };
  for (const l of LAWS) {
    const s = lawsOf(g)[l.id];
    if (!s.passed || s.defied || !l.forbids) continue;
    if (l.forbids.test(p) && Object.keys(next).some((k) => k in l.forbids!.fix)) return `${l.forbids.what}: illegal since ${s.passed} (${l.name})`;
  }
  return null;
}

/**
 * A law's events fire on their historical dates only if the law is due by then. The first event is the law
 * itself: delayed, it's dropped (and applied when the law passes); due, the law passes with it; already passed
 * early, it's dropped (its effects came then). Later events (the Aliquippa case) need the law to have passed.
 * Returns true to drop the event.
 */
export function suppressEvent(g: GameState, name: string): boolean {
  const l = lawForEvent(name);
  if (!l) return false;
  const s = lawsOf(g)[l.id], primary = l.events![0] === name;
  if (!primary) return s.passed === undefined;
  if (s.passed !== undefined) return true;
  if (lawYear(g, l) > cal(g).year) return true;
  passLaw(g, l, false);
  return false;
}

/** the law passes: its events' effects (if it came early or late), the headline, and your policies */
export function passLaw(g: GameState, l: LawDef, withEvents = true) {
  const s = lawsOf(g)[l.id], y = cal(g).year;
  if (s.passed !== undefined) return;
  s.passed = y; s.passedTurn = g.turn;
  const moved = y !== l.year;
  if (withEvents) {
    const fx = allEffects();
    // the law itself, and any later events that waited for it
    for (const e of l.events ?? []) { const t = firstTurnOf(e); if (fx[e] && (e === l.events![0] || (t !== undefined && t < g.turn))) applyEffects(g, e, fx[e]); }
  }
  if (moved || !l.events?.length) pushHeadline(g, `${l.name}${moved ? (y < l.year ? " Passes Early" : " Passes at Last") : " Becomes Law"}`,
    `${l.blurb}${moved ? ` (History had it in ${l.year}.)` : ""}`, "Politics");
  log(g, `${l.name} becomes law${moved ? ` (${y < l.year ? `${l.year - y} years early` : `${y - l.year} years late`})` : ""}.`);
  const c = g.company;
  if (c && l.forbids?.test(c.biz.policy)) {
    const d = complyDecision(l);
    if (!g.pendingDecision) g.pendingDecision = d; else g.moreDecisions.push(d);
  }
}

/** comply or defy: rebuilt from its source on load */
export function complyDecision(l: LawDef): Decision {
  const opts: DecisionOption[] = [
    { label: "Comply", detail: `${Object.entries(l.forbids!.fix).map(([k, v]) => `${k} → ${v}`).join(", ")}.`, apply: (g) => { Object.assign(g.company!.biz.policy, l.forbids!.fix); return `${g.company!.name} complies with the ${l.name}.`; } },
    { label: "Defy the law", detail: "Keep things as they are: fines most seasons, the papers and the union against you.", apply: (g) => {
      lawsOf(g)[l.id].defied = true;
      mark(g, { id: `defied_${l.id}`, side: "public", kind: "grievance", weight: 12, text: `defied the ${l.name}` });
      return `${g.company!.name} defies the ${l.name}.`;
    } },
  ];
  return { id: `law_${l.id}`, source: `law:${l.id}`, title: `The ${l.name} is law`, text: `${l.blurb} ${l.forbids!.what} at your works is now illegal.`, options: opts, historical: 0 };
}

/** each season: laws come due; defiance costs; in the autumn of election years, the votes. Each new year the balance moves the laws. */
export function politicsSeason(g: GameState, rng: () => number) {
  const p = polOf(g), c = cal(g), y = c.year, L = lawsOf(g);
  p.scandal *= 0.9;
  // laws that came due ahead of (or without) their events
  for (const l of LAWS) {
    if (L[l.id].passed !== undefined || lawYear(g, l) > y) continue;
    // a law that is its event passes with it if the event is still to come this year
    const t = l.events ? firstTurnOf(l.events[0]) : undefined;
    if (t !== undefined && t > g.turn && Math.floor(t / 4) + 1850 === y) continue;
    passLaw(g, l);
  }
  // defiance: inspectors, fines, the papers
  const co = g.company;
  if (co) for (const l of LAWS) {
    const s = L[l.id];
    if (!s.defied || !l.forbids) continue;
    if (!l.forbids.test(co.biz.policy)) { s.defied = false; continue; }
    if (rng() < 0.35) {
      const fine = Math.round(8000 * priceLevel(y));
      co.cash -= fine; bump(g, "reputation", -4);
      log(g, `Fined $${fine.toLocaleString("en-US")} for defying the ${l.name}.`);
    }
  }
  if (c.season === "Autumn") for (const lv of LEVELS) if (electionYear(lv, y)) runElection(g, lv, rng);
  // favours lapse when their holder leaves office
  p.favours = p.favours.filter((f) => holderNow(g, f.level).name === f.who && f.n > 0);
  if (c.season === "Spring") {
    for (const l of LAWS) {
      const s = L[l.id];
      if (s.passed !== undefined) continue;
      const lean = (p.balance[l.level] - baseline(l.level, y)) / 100;
      s.shift += (l.side === "reform" ? 1 : -1) * lean * 0.8;
    }
  }
}

const firstTurn: Record<string, number | undefined> = {};
/** the turn an event fires on (its first appearance in the calendar) */
function firstTurnOf(name: string): number | undefined {
  if (name in firstTurn) return firstTurn[name];
  const S = ["Spring", "Summer", "Autumn", "Winter"] as const;
  for (let y = 1850; y <= 1985; y++) for (let k = 0; k < 4; k++) if (eventsFor(y, S[k]).some((e) => e.name === name)) return (firstTurn[name] = (y - 1850) * 4 + k);
  return (firstTurn[name] = undefined);
}

/** favours you hold with whoever is in office at a level now */
export const favoursAt = (g: GameState, level: Level) => polOf(g).favours.find((f) => f.level === level && f.who === holderNow(g, level).name)?.n ?? 0;
export function spendFavour(g: GameState, level: Level): boolean {
  const f = polOf(g).favours.find((x) => x.level === level && x.who === holderNow(g, level).name);
  if (!f || f.n <= 0) return false;
  f.n--;
  return true;
}
/** gain a favour with the holder at a level */
export function earnFavour(g: GameState, level: Level, n = 1) {
  const p = polOf(g), who = holderNow(g, level).name;
  const f = p.favours.find((x) => x.who === who && x.level === level);
  if (f) f.n += n; else p.favours.push({ who, level, n });
}

/** a governor who leans to reform won't send the militia or the state police to a strike */
export const governorWillSendTroops = (g: GameState) => holderNow(g, "state").lean < 0.3;

// ---------------------------------------------------------------- actions

const era = (g: GameState) => priceLevel(cal(g).year);
const pending = (g: GameState) => LAWS.filter((l) => lawsOf(g)[l.id].passed === undefined && l.range[1] >= cal(g).year);

export const POLITICS_ACTIONS: ActionDef[] = [
  {
    id: "fund_business", group: "Politics", name: "Fund the business ticket",
    blurb: "Money for the organisation's candidates at the next election (choose where). The other owners approve; the union notices.",
    cost: (g) => Math.round(8000 * era(g)), blocked: () => null,
    run: (g, _rng, arg) => {
      const lv = (arg as Level) || "city", p = polOf(g);
      const f = p.fund[lv];
      p.fund[lv] = { side: "business", amount: (f?.side === "business" ? f.amount : 0) + Math.round(8000 * era(g)) };
      for (const r of g.rivals) r.stance = Math.min(100, (r.stance ?? 0) + 2);
      return `Your money goes to the business men's campaign for ${BODY[lv]} (${nextElection(lv, cal(g).year)}).`;
    },
  },
  {
    id: "fund_reform", group: "Politics", name: "Fund the reform ticket",
    blurb: "Money for reform and labour candidates at the next election. The other owners won't forgive it easily.",
    cost: (g) => Math.round(8000 * era(g)), blocked: () => null,
    run: (g, _rng, arg) => {
      const lv = (arg as Level) || "city", p = polOf(g);
      const f = p.fund[lv];
      p.fund[lv] = { side: "reform", amount: (f?.side === "reform" ? f.amount : 0) + Math.round(8000 * era(g)) };
      mark(g, { id: `fundReform_${lv}`, side: "labour", kind: "trust", weight: 4, text: "paid for the reform ticket" });
      return `Your money goes to the reformers' campaign for ${BODY[lv]} (${nextElection(lv, cal(g).year)}).`;
    },
  },
  {
    id: "push_law", group: "Politics", name: "Back a bill",
    blurb: "Spend influence (20): your men in the capitol push a pending law three years sooner.",
    cost: (g) => Math.round(4000 * era(g)), blocked: (g) => (g.company!.biz.meters.influence < 20 ? "Needs 20 influence" : null),
    run: (g, _rng, arg) => {
      const l = lawById(arg ?? "") ?? pending(g)[0];
      if (!l) return "No bill to back.";
      lawsOf(g)[l.id].shift += 3; bump(g, "influence", -20);
      if (l.side === "reform") mark(g, { id: `backed_${l.id}`, side: "public", kind: "trust", weight: 6, text: `backed the ${l.name}` });
      return `The ${l.name} moves up the calendar: due ${lawYear(g, l)}.`;
    },
  },
  {
    id: "block_law", group: "Politics", name: "Block a bill",
    blurb: "Spend influence (20): your friends bury a pending law in committee for three more years.",
    cost: (g) => Math.round(4000 * era(g)), blocked: (g) => (g.company!.biz.meters.influence < 20 ? "Needs 20 influence" : null),
    run: (g, _rng, arg) => {
      const l = lawById(arg ?? "") ?? pending(g)[0];
      if (!l) return "No bill to block.";
      lawsOf(g)[l.id].shift -= 3; bump(g, "influence", -20);
      if (l.side === "reform") mark(g, { id: `blocked_${l.id}`, side: "labour", kind: "grievance", weight: 8, text: `buried the ${l.name} in committee` });
      return `The ${l.name} is buried in committee: due ${lawYear(g, l)} at the earliest.`;
    },
  },
  {
    id: "favour_troops", group: "Politics", name: "Call in a favour: troops at the strike",
    blurb: "The governor sends the state police or the militia to your picket lines (needs a favour with the governor, and a governor who will).",
    cost: () => 0,
    blocked: (g) => (!g.unions || !Object.values(g.unions).some((u) => u?.siege) ? "Only during a strike" : !governorWillSendTroops(g) ? `Governor ${holderNow(g, "state").name} won't send troops against strikers` : favoursAt(g, "state") < 1 ? "No favour owed by the governor" : null),
    run: (g) => {
      spendFavour(g, "state");
      for (const u of Object.values(g.unions ?? {})) if (u?.siege) u.siege.force += 0.5;
      mark(g, { id: "troops", side: "labour", kind: "grievance", weight: 12, text: "had the militia sent to the picket lines" });
      pushHeadline(g, "Troops Called to the Mills", `The governor orders the state police to keep the gates open at ${g.company!.name}.`, "Labor");
      return "The troopers ride into town.";
    },
  },
  {
    id: "favour_contract", group: "Politics", name: "Call in a favour: a public contract",
    blurb: "City or federal orders at a good price: prices +5% for a year (needs a favour with the mayor or the president).",
    cost: () => 0,
    blocked: (g) => (favoursAt(g, "city") + favoursAt(g, "federal") < 1 ? "No favour owed at City Hall or in Washington" : null),
    run: (g) => {
      if (!spendFavour(g, "federal")) spendFavour(g, "city");
      for (const w of allWorks(g.company!)) g.mods.push({ kind: "price", mult: 1.05, until: g.turn + 4, source: "A public contract", industry: [w.industry] });
      return "The orders come in at a price no one else is offered.";
    },
  },
];

export const electionBonus = (g: GameState) => (hasTrait(g, "orator") ? 0.15 : 0) + Math.max(-0.2, Math.min(0.2, standing(g, "public") / 300));
