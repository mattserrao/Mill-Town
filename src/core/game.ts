// Game state and the seasonal turn loop. First pass: found a works, produce each season,
// pay wages, spread smoke, and let the town grow toward the jobs along real street alignments.

import { distance, feet } from "./units";
import { INDUSTRIES, type IndustryId } from "./industries";
import { type GameMap, inBounds, recomputeElevation, resetMap, type Span, tilesFor } from "./map";
import { roadsSeason } from "./roads";
import { freightMult, holdingsSeason, type Holdings, inputMult, upkeepMult } from "./holdings";
import { nameNow, RIVALS, type RivalDef } from "./rivals";
import { Rng, tileNoise } from "./rng";
import { evaluateSite, footprintTiles, popSAT, siteFields, type SiteFields } from "./site";
import { habitable, Terrain } from "./terrain";
import { calendar, priceLevel, SEASON_EFFECTS, TOTAL_TURNS, type Calendar } from "./time";
import { activateFeatures, activateStreets, addSteps, CivicSub, densityCap, terrainCap, generateTown, civicSeason, HouseSub, POP_CAP, recomputeLandValue, Street, Use, useForPop, type World } from "./town";
import { HILLSIDES, INCLINES, latLonToTile, PARKS, regionTarget, tileLine } from "./features";
import { blockCosts, buildCommute, type Commute, jobCenters, runTrips, travelField, type WorksSite } from "./commute";
import { besideWorks, growByDesire } from "./growth";
import { PRICE, shipSeason, type Shipper, type ShipResult, siteAccess, spurOption } from "./freight";
import { placeNamed } from "./places";
import { hospitals, type PlacedLandmark } from "./landmarks";
import { clearRuins, publicHousing, registerMapHooks } from "./mapfx";
import { civicYear } from "./civic";
import { hoodBoosts } from "./hood";
import { closureSeason, idleCost, marketFor, type MarketView } from "./world";
import { recordProfits } from "./value";
import { type PublicState, publicSeason } from "./ownership";
import { companyWorth, type StockState, updateStocks } from "./holdings";
import { clearMarkets, fuelPriceMult, MARKET_FROM, marketPrice, type MarketState, rivalsAnswer } from "./supply";
import { type Compliance, controlUpkeep, envSeason } from "./enviro";
import { sportsSeason, type TeamState } from "./sports";
import { type Business, businessSeason, type Decision, newBusiness, policyEffects, type PolicyEffects, type PublicWorks, resolveDecision } from "./business";
import { applyEffects, cond, applyPendingRivalFx, type PoliticalEra, type Rule } from "./effects";
import { allDecisions, allEffects, initialRules } from "./eventdata";
import type { ModContext } from "./events";
import { advanceResearch, marketFactor, rivalMult, rivalTechs, techStanding } from "./market";
import { rivalSeason } from "./rivalai";
import { eventsFor, type HistEvent, type Mod, modMult } from "./events";
import { GROUPS, immigrationPressure, pickGroup } from "./ancestry";
import { type History, newHistory, recordHistory } from "./neighbourhood";
import { type Env, newEnv, type Plant, SOOT_SCALE, updateAir, updateHealth, updateRivers } from "./environment";
import { blockGrid, blockOf } from "./blocks";
import { ledgerSeason, type Mark } from "./ledger";
import { beginSuccession, defaultSuccession, type Family, familySeason, FOUNDER_NAMES, hasTrait, managerSeason, startFamily, successionDue, SURNAMES } from "./family";
import { labourSeason, sieges, settle, unorganisedStrikeChance, type Union } from "./labour";
import { type LawState, lawsOf, politicsSeason, type PoliticsState, suppressEvent } from "./politics";
import { type Move, type OwnersState, ownersSeason, ownersSuccession, type Intent } from "./owners";
import { type Career, careerSeason } from "./career";
import { commission } from "./market";
import { readLedger, returningUnion } from "./branches";

export type RiverSide = "N" | "S" | "E" | "W";
export type PlantStatus = "running" | "idle" | "strike" | "flooded" | "lockout";

/** something built beside a works: more furnaces and mills, or a private dock */
export interface Annex { kind: "expand" | "dock" | "housing"; x: number; y: number; fp: number; year: number }

/** One works: the first one you founded, or one you bought or built later. */
export interface Works {
  /** "p" for the first works, "p:1", "p:2"… for the others */
  id: string;
  name: string;
  industry: IndustryId;
  x: number; y: number;
  footprint: number;
  techs: string[];
  employees: number;
  produced: number;
  seasonsOperating: number;
  lastSeason?: SeasonReport;
  riverSide: RiverSide;
  status: PlantStatus;
  strikeTurns: number;
  /** average health (0..1) and unrest (0..1) of the workforce within walking distance */
  health: number;
  unrest: number;
  /** rail siding built by the player: the rail tile it reaches */
  spur?: [number, number];
  /** a private dock: the water tile it serves */
  dock?: [number, number];
  /** this season's shipping: lanes, delivered share, costs */
  freight?: ShipResult;
  /** a process being built: id and seasons left */
  research?: { id: string; left: number };
  annexes: Annex[];
  /** bought from this rival */
  fromRival?: string;
  /** minutes from this works to every block (the first works uses g.access) */
  access?: Float32Array;
  founded: number;
  /** investments in the neighbourhood around it (src/core/hood.ts): id -> year */
  hood?: Record<string, number>;
  /** what the market allowed it last season (src/core/world.ts) */
  market?: MarketView;
  /** sold out of the family's hands (v0.18.2): it runs on under its buyer, or went for scrap */
  sold?: { to: string; year: number };
  /** unsold output in the yards (v0.18.2) */
  stock?: number;
  /** profit, the last eight seasons (for its value) */
  profits?: number[];
  /** shut for good (the 1980s closure card): it stands cold, with a caretaker's upkeep */
  closed?: boolean;
  lossSeasons?: number;
}

export interface Company extends Works {
  cash: number;
  library: boolean;
  /** migrants settled since the last civic building went up */
  civicDue: number;
  /** standings, policies, actions and the record of decisions */
  biz: Business;
  /** your other works */
  others: Works[];
  /** last number used for a works id (ids are never reused, even after a works is sold) */
  worksSeq?: number;
  /** owed to the bank (a Mellon loan), repaid from profits */
  debt: number;
  /** last season's accounts for the whole company */
  totals?: SeasonReport;
  /** seasons in a row with an overdrawn account */
  redSeasons?: number;
  /** the receivers have taken the works: the game is over */
  bankrupt?: boolean;
  /** businesses, stakes and shares beyond the works (holdings.ts) */
  holdings?: Holdings;
  /** retired men drawing a company pension (from 1950) */
  retirees?: number;
  /** listed on the exchange (v0.18.2): the outsiders' share and the dividends missed */
  public?: PublicState;
}

export interface RivalState {
  id: string;
  ownerId: number;
  x: number; y: number;
  footprint: number;
  active: boolean;
  riverSide: RiverSide;
  /** bought by you: now one of your works */
  owned?: boolean;
  /** extra capacity from expansions (0.2 = +20%) */
  expand: number;
  /** fires, strikes, poaching and the like: output multiplier until a turn */
  damage: { mult: number; until: number; why: string }[];
  /** how much they hold against you (caught sabotage, raids) */
  grudge: number;
  /** what they did last (for the panel) */
  lastMove?: string;
  /** out on strike (or locked out) until this turn */
  strikeUntil?: number;
  /** shut down for good (by history or by you) */
  closed?: boolean;
  /** lasting cut in output (a partial closure): multiplier */
  partial?: number;
  /** personality, if events have changed it */
  style?: RivalDef["style"];
  /** name, if it has changed (J&L → LTV Steel) */
  name?: string;
  nameYear?: number;
  /** −100 hostile … +100 ally, toward your family (owners.ts) */
  stance?: number;
  /** its works lie off the map (v0.18): it competes, but draws, smokes and ships nothing on the map */
  offmap?: boolean;
  /** furnaces banked in a glut (v0.18.2): output multiplier */
  bank?: number;
  /** what it's preparing (shown a season ahead) */
  intent?: Intent;
  /** a defence against your stakes: their price ×this */
  defence?: number;
  /** the last answer it made to one of your moves */
  answered?: string;
}

export interface SeasonReport {
  produced: number;
  revenue: number;
  inputCost: number;
  wages: number;
  /** repairs, salaries, interest on the plant: paid whether the works runs or not */
  upkeep: number;
  /** safety men, fines and the like, less what the company store earns */
  other: number;
  profit: number;
  workersWanted: number;
  workersHired: number;
  migrants: number;
  notes: string[];
  /** income from businesses, stakes and shares (company totals only) */
  holdings?: number;
  /** corporate income tax, pensions and other burdens of the later years (company totals only) */
  tax?: number;
  pensions?: number;
}

export interface GameState {
  seed: number;
  map: GameMap;
  world: World;
  fields: SiteFields;
  turn: number;
  company?: Company;
  rivals: RivalState[];
  log: { turn: number; text: string }[];
  /** minutes from the works to every block (walk / streetcar / car by year) */
  access?: Float32Array;
  inclinesBuilt: number;
  /** timed modifiers from historical events */
  mods: Mod[];
  /** events that fired at the start of the current turn (for headlines) */
  headlines: HistEvent[];
  /** set by a flood event for this season */
  floodNow?: number;
  /** true once the last season (Winter 1985) has been played */
  over?: boolean;
  stats: GameStats;
  /** neighbourhood composition over time (5-yearly) and when each community first arrived */
  history: History;
  /** air, rivers, health, unrest, traffic and freight fields */
  env: Env;
  /** works running this season (yours and the rivals'), for smoke and outfalls */
  plants: Plant[];
  /** travel-time fields from the job centres (rebuilt yearly) */
  commute: Commute;
  lastGrowth?: { placed: number; byGroup: number[] };
  /** river improvements won by lobbying */
  publicWorks: PublicWorks;
  /** a historical moment waiting for your decision */
  pendingDecision?: Decision;
  /** permanent share of the market lost to imports (the 1959 strike) */
  priceLoss?: number;
  /** prices, wages and your accounts each season, for the Markets view */
  prices: PricePoint[];
  /** every issue of the paper: the seasons with headlines */
  news: { turn: number; items: HistEvent[] }[];
  /** decisions waiting behind the one on the table */
  moreDecisions: Decision[];
  /** town morale 0..100 (50 = ordinary): titles, openings, disasters, layoffs */
  morale: number;
  /** states of the world that events set and later effects read */
  flags: Record<string, number | string | boolean>;
  /** lasting pressure on a meter's drift target, from events (Donora 1948) */
  pressures: { meter: "reputation" | "labour" | "influence"; amount: number; until: number; source: string }[];
  /** taverns and saloons shuttered by Prohibition: tile index and the shop they were */
  dryShops: [number, number][];
  /** blasted tiles left as rubble: [tile, turn they may be rebuilt] */
  ruins: [number, number][];
  /** fixed structures (the courthouse) burnt out: [tile, structure they were] */
  burnt: [number, number][];
  /** what actions cost, whether they're allowed, what they yield (set by events: laws, eras) */
  rules: Record<string, Rule>;
  politics: PoliticalEra;
  /** timed unrest/health offsets for named places */
  placeFx: { place: string; unrest: number; health: number; until: number; source: string }[];
  /** works on strike this season, and last season (for strike contagion) */
  strikeAt: [number, number][];
  lastStrikes: [number, number][];
  /** men out of work after layoffs and closures (drift away or find work over time) */
  jobless: number;
  /** dated landmarks on the map */
  landmarks: PlacedLandmark[];
  /** bridges you (or the city, for you) built: drawn like the real spans */
  spans?: Span[];
  roadsBuilt?: number;
  /** landmarks and parks you funded ahead of history: id or park name → year */
  funded?: Record<string, number>;
  /** sports teams (sports.ts) */
  teams: TeamState[];
  /** rival effects waiting for their rival to open */
  pendingRivalFx: { source: string; ef: unknown }[];
  /** what the valley remembers about your family (ledger.ts) */
  ledger?: Mark[];
  /** the founder, the heads and the heirs (family.ts) */
  family?: Family;
  /** the unions at your works, by industry (labour.ts) */
  unions?: Partial<Record<IndustryId, Union>>;
  /** the political balance, favours, elections (politics.ts) */
  pol?: PoliticsState;
  laws?: Record<string, LawState>;
  /** the stock market's state (holdings.ts) */
  stock?: StockState;
  /** each industry's market this season (src/core/supply.ts) */
  markets?: Partial<Record<IndustryId, MarketState>>;
  /** environmental compliance by law and works (src/core/enviro.ts) */
  compliance?: Record<string, Compliance>;
  /** the owners' association and your recent moves the rivals answer (owners.ts) */
  owners?: OwnersState;
  moves?: Move[];
  /** where strikers were killed: a memorial on the map */
  memorials?: { x: number; y: number; year: number; dead: number; text: string }[];
  /** the family member in politics (career.ts) */
  career?: Career;
}

export interface PricePoint {
  turn: number;
  /** what a unit fetches on the market, by industry */
  market: Record<IndustryId, number>;
  /** what your works actually got per unit (by industry, averaged over your works) */
  yours: Partial<Record<IndustryId, number>>;
  /** $ per man per season */
  wage: number;
  /** $ per ton of coal or ore at the mine, and what you paid per ton delivered */
  raw: number;
  delivered?: number;
  revenue?: number; costs?: number; profit?: number; cash?: number;
  /** your works: rated capacity and output (all works), men employed, cost per unit made */
  capacity?: number; produced?: number; employees?: number; unitCost?: number;
  /** your capacity and output by industry (output is what market share is measured on) */
  capInd?: Partial<Record<IndustryId, number>>; prodInd?: Partial<Record<IndustryId, number>>;
  /** every process your works run (ids, all works together), so the charts can mark when each arrived */
  techs?: string[];
  /** what each open rival works made this season, by rival id */
  rivals?: Record<string, number>;
  /** the valley: population, town morale, men out of work; your workforce's health and unrest (0–1) */
  pop?: number; morale?: number; jobless?: number; health?: number; unrest?: number;
  /** the family's net worth (v0.18.2) */
  worth?: number;
  /** each market: demand and supply (units a season), from 1893 */
  mkt?: Partial<Record<IndustryId, [number, number]>>;
}

/** rated capacity of a works: its processes and expansions */
export function worksCapacity(w: Works): number {
  return Math.round(INDUSTRIES[w.industry].baseCapacity * (1 + techMods(w).capacity));
}

/** File this season's prices (called after the season is played). */
export function recordPrices(g: GameState) {
  const year = cal(g).year;
  const market = {} as Record<IndustryId, number>;
  for (const id of Object.keys(INDUSTRIES) as IndustryId[])
    market[id] = Math.round(INDUSTRIES[id].basePrice * (1 + (year - 1850) * PRICE_TREND) * mod(g, "price", { industry: id }) * marketFactor(g, id) * marketPrice(g, id) * 100) / 100;
  const p: PricePoint = { turn: g.turn, market, yours: {}, wage: Math.round(WAGE_PER_SEASON_1850 * priceLevel(year) * mod(g, "wage") * 100) / 100, raw: Math.round(PRICE(year) * mod(g, "input", { good: "coal" }) * 100) / 100 };
  const c = g.company;
  if (c?.totals) {
    const made: Partial<Record<IndustryId, [number, number]>> = {};
    let tons = 0, paid = 0;
    for (const w of allWorks(c)) {
      const s = w.lastSeason;
      if (!s || !s.produced) continue;
      const m = (made[w.industry] ??= [0, 0]); m[0] += s.revenue; m[1] += s.produced;
      for (const l of w.freight?.lanes ?? []) tons += l.delivered;
      paid += s.inputCost;
    }
    for (const [k, [r, n]] of Object.entries(made) as [IndustryId, [number, number]][]) p.yours[k] = Math.round((r / n) * 100) / 100;
    if (tons) p.delivered = Math.round((paid / tons) * 100) / 100;
    const t = c.totals;
    p.revenue = t.revenue; p.costs = t.revenue - t.profit; p.profit = t.profit; p.cash = Math.round(c.cash);
    const works = allWorks(c);
    p.capacity = works.reduce((n, w) => n + worksCapacity(w), 0);
    p.capInd = {};
    p.prodInd = {};
    for (const w of works) {
      p.capInd[w.industry] = (p.capInd[w.industry] ?? 0) + worksCapacity(w);
      p.prodInd[w.industry] = (p.prodInd[w.industry] ?? 0) + (w.lastSeason?.produced ?? 0);
    }
    p.produced = works.reduce((n, w) => n + (w.lastSeason?.produced ?? 0), 0);
    p.employees = works.reduce((n, w) => n + w.employees, 0);
    p.techs = [...new Set(works.flatMap((w) => w.techs))];
    if (p.produced) p.unitCost = Math.round((p.costs / p.produced) * 100) / 100;
    p.health = Math.round(c.health * 100) / 100; p.unrest = Math.round(c.unrest * 100) / 100;
    p.worth = companyWorth(g).total;
  }
  if (g.markets) { p.mkt = {}; for (const [k, v] of Object.entries(g.markets)) if (v) p.mkt[k as IndustryId] = [Math.round(v.demand), Math.round(v.supply)]; }
  p.rivals = {};
  for (const r of g.rivals) { const v = rivalOutput(g, r, year); if (v > 0 && !r.owned) p.rivals[r.id] = v; }
  p.pop = totalPopulation(g); p.morale = Math.round(g.morale); p.jobless = g.jobless;
  if (g.prices[g.prices.length - 1]?.turn === g.turn) g.prices[g.prices.length - 1] = p;
  else g.prices.push(p);
}

export interface GameStats {
  peakPop: number; peakPopYear: number;
  peakEmployees: number; peakEmployeesYear: number;
  peakCash: number; peakCashYear: number;
  totalProfit: number;
  strikes: number;
  foundedYear?: number;
}

export const STARTING_CASH = 100000;
const WAGE_PER_SEASON_1850 = 60;
const PARTICIPATION = 0.32;

let fieldsCache: { map: GameMap; fields: SiteFields } | null = null;

/** the site fields of the map as it was loaded (shared by every game on that map) */
export function fieldsFor(map: GameMap): SiteFields {
  if (!fieldsCache || fieldsCache.map !== map) fieldsCache = { map, fields: siteFields(map) };
  return fieldsCache.fields;
}

export function newGame(map: GameMap, seed: number): GameState {
  registerMapHooks();
  resetMap(map);
  const world = generateTown(map, seed, 1850);
  if (!fieldsCache || fieldsCache.map !== map) fieldsCache = { map, fields: siteFields(map) };
  const g: GameState = { seed, map, world, fields: fieldsCache.fields, turn: 0, rivals: [], log: [{ turn: 0, text: `Spring 1850. Seed ${seed}.` }], inclinesBuilt: 0, mods: [], headlines: [],
    stats: { peakPop: 0, peakPopYear: 1850, peakEmployees: 0, peakEmployeesYear: 1850, peakCash: 0, peakCashYear: 1850, totalProfit: 0, strikes: 0 },
    history: newHistory(map), env: newEnv(map), plants: [], commute: undefined as unknown as Commute, publicWorks: { locks: {} }, prices: [], news: [],
    moreDecisions: [], morale: 50, flags: {}, pressures: [], dryShops: [], ruins: [], burnt: [], rules: initialRules(), politics: "early", placeFx: [], pendingRivalFx: [], strikeAt: [], lastStrikes: [], landmarks: [], teams: [], jobless: 0 };
  civicYear(g, 1850, true);
  g.commute = buildCommute(map, world, centersFor(g));
  recordHistory(map, world, g.history);
  warmEnvironment(g);
  g.stats.peakPop = totalPopulation(g);
  fireEvents(g);
  recordPrices(g);
  return g;
}

/** Fire the historical events for the current season (headline, log, effects). */
export function fireEvents(g: GameState) {
  const c = cal(g);
  // a law's events wait for the law (politics can move it earlier or later than history)
  g.headlines = eventsFor(c.year, c.season).filter((e) => !suppressEvent(g, e.name));
  if (g.headlines.length) fileNews(g);
  g.floodNow = undefined;
  const effects = allEffects(), decisions = allDecisions();
  for (const e of g.headlines) {
    const dec = decisions[e.name]?.(g);
    if (dec) { dec.source = e.name; readLedger(g, dec); }
    if (dec) { if (!g.pendingDecision) g.pendingDecision = dec; else g.moreDecisions.push(dec); }
    log(g, `${e.name}.`); // the story itself is in the newspaper
    const fx = effects[e.name];
    if (fx) applyEffects(g, e.name, fx);
  }
  g.mods = g.mods.filter((m) => m.until > g.turn);
  g.placeFx = g.placeFx.filter((p) => p.until > g.turn);
  g.pressures = g.pressures.filter((p) => p.until > g.turn);
}

/** make sure this season's headlines are in the paper's archive (they are shared, so later stories join them) */
export function fileNews(g: GameState) {
  const last = g.news[g.news.length - 1];
  if (last?.turn === g.turn) last.items = g.headlines;
  else g.news.push({ turn: g.turn, items: g.headlines });
}

export const mod = (g: GameState, k: Parameters<typeof modMult>[1], ctx?: ModContext) => {
  const m = modMult(g.mods, k, g.turn, ctx);
  // the Westinghouse–GE patent pool (1896) steadies electricity prices: swings are halved
  return k === "price" && ctx?.industry === "power" && g.flags.patentTruce ? 1 + (m - 1) * 0.5 : m;
};

export function cal(g: GameState): Calendar {
  return calendar(g.turn);
}

export interface Founder { first: string; surname: string; sex?: "m" | "f" }
/** what a new company starts with: $100,000 in 1850; later (and in the dearer modern industries) more */
export function foundingCapital(industry: IndustryId, year: number): number {
  return Math.round(Math.max(STARTING_CASH, INDUSTRIES[industry].startCost * 1.6) * priceLevel(year) / 1000) * 1000;
}

export function foundCompany(g: GameState, industry: IndustryId, x: number, y: number, name?: string, founder?: Founder): { ok: boolean; reason?: string } {
  if (g.company) return { ok: false, reason: "Company already founded" };
  if ((INDUSTRIES[industry].from ?? 1850) > cal(g).year) return { ok: false, reason: `${INDUSTRIES[industry].name} from ${INDUSTRIES[industry].from}` };
  const rep = evaluateSite(g.map, g.world, g.fields, industry, x, y);
  if (!rep.ok) return { ok: false, reason: rep.reasons.join("; ") };
  const STARTING_CASH = foundingCapital(industry, cal(g).year);
  if (rep.cost > STARTING_CASH) return { ok: false, reason: `Costs $${rep.cost.toLocaleString()}, you have $${STARTING_CASH.toLocaleString()}` };
  const ind = INDUSTRIES[industry];
  claimFootprint(g, x, y, rep.footprint, 1, Use.Industry);
  g.company = {
    name: name ?? `${ind.name} Co.`,
    industry,
    cash: STARTING_CASH - rep.cost,
    x, y,
    footprint: rep.footprint,
    techs: [ind.tech[0].id],
    employees: 0,
    produced: 0,
    seasonsOperating: 0,
    riverSide: riverSideOf(g.map, x, y, rep.footprint),
    status: "running",
    strikeTurns: 0,
    library: false,
    civicDue: 0,
    health: 1,
    unrest: 0,
    biz: newBusiness(cal(g).year),
    id: "p",
    annexes: [],
    others: [],
    debt: 0,
    founded: cal(g).year,
  };
  g.stats.foundedYear = cal(g).year;
  const f = founder ?? { first: FOUNDER_NAMES[g.seed % FOUNDER_NAMES.length], surname: SURNAMES[(g.seed * 7) % SURNAMES.length] };
  startFamily(g, f.first, f.surname, f.sex ?? "m");
  lawsOf(g);
  g.commute = buildCommute(g.map, g.world, centersFor(g));
  log(g, `Founded ${g.company.name} (${ind.startsAs}) for $${rep.cost.toLocaleString()}.`);
  recomputeLandValue(g.map, g.world);
  updateAccess(g);
  return { ok: true };
}

// ---------------------------------------------------------------- commuting

const MAX_WALK_MIN = 60;

/** Rebuild the commute model now (after a new road or bridge), not just at the new year. */
export function buildCommuteNow(g: GameState) { g.commute = buildCommute(g.map, g.world, centersFor(g)); }

/** Recompute walking times from the works (after streets, steps or inclines change). */
export function updateAccess(g: GameState) {
  const c = g.company;
  if (!c) { g.access = undefined; return; }
  // travel time on the block grid by the modes of the year (walk, streetcar, car), steps and inclines included
  g.access = travelField(g.map, blockCosts(g.map, g.world), c.x + (c.footprint >> 1), c.y + (c.footprint >> 1));
}

/** minutes from a tile to the works (Infinity beyond reach); another works' field if given */
export function walkMinutes(g: GameState, i: number, acc = g.access): number {
  if (!acc) return Infinity;
  const W = g.map.width, b = blockOf(blockGrid(g.map), i % W, (i / W) | 0);
  const a = acc[b];
  return a > MAX_WALK_MIN ? Infinity : a;
}

/** travel times from one of your other works */
export function updateWorksAccess(g: GameState, w: Works) {
  w.access = travelField(g.map, blockCosts(g.map, g.world), w.x + (w.footprint >> 1), w.y + (w.footprint >> 1));
}

/** every works you own, the first one first */
/** the works the family still owns (a works sold or scrapped stays on record but leaves this list) */
export const allWorks = (c: Company): Works[] => [c, ...c.others].filter((w) => !w.sold);
export const totalEmployees = (c: Company) => allWorks(c).reduce((s, w) => s + w.employees, 0);

/** Share of a tile's working men who'll take a job at the works, by walking time. */
export function commuteWeight(min: number): number {
  if (min <= 15) return 1;
  if (min <= 40) return 1 - (0.8 * (min - 15)) / 25;
  if (min <= MAX_WALK_MIN) return 0.2 * (1 - (min - 40) / (MAX_WALK_MIN - 40));
  return 0;
}

export const STEPS_COST = 4000;
export const INCLINE_COST = 60000;

/** Build public steps from the nearest unserved hillside houses down to the street. */
export function buildSteps(g: GameState): { ok: boolean; reason?: string } {
  const c = g.company;
  if (!c) return { ok: false, reason: "No company" };
  if (c.cash < STEPS_COST) return { ok: false, reason: `Needs $${STEPS_COST.toLocaleString()}` };
  const made = addSteps(g.map, g.world, 1, [c.x + (c.footprint >> 1), c.y + (c.footprint >> 1), 70], true);
  if (!made) return { ok: false, reason: "No hillside houses near the works need steps" };
  c.cash -= STEPS_COST;
  updateAccess(g);
  log(g, `${c.name} builds a flight of public steps up the hillside.`);
  return { ok: true };
}

/** Build an inclined plane from a street near the works up to the hillside houses the longest walk away. */
export function buildIncline(g: GameState): { ok: boolean; reason?: string } {
  const c = g.company;
  if (!c) return { ok: false, reason: "No company" };
  if (cal(g).year < 1870) return { ok: false, reason: "Inclines come to Pittsburgh in 1870" };
  if (c.cash < INCLINE_COST) return { ok: false, reason: `Needs $${INCLINE_COST.toLocaleString()}` };
  const { map: m, world: w } = g;
  if (!g.access) updateAccess(g);
  const cx = c.x + (c.footprint >> 1), cy = c.y + (c.footprint >> 1);
  // foot: a street close to the works; head: hillside houses up to ~1 km away that are a long walk now
  let bottom = -1, top = -1, best = -Infinity, bd = 0;
  const MAXL = 22; // ~650 m: as long as Pittsburgh's longest inclines
  for (let y = cy - 45; y <= cy + 45; y += 2) for (let x = cx - 45; x <= cx + 45; x += 2) {
    if (!inBounds(m, x, y)) continue;
    const b = y * m.width + x;
    if (!w.street[b] || w.street[b] === Street.Steps || w.street[b] === Street.Bridge || walkMinutes(g, b) > 15) continue;
    for (let ty = y - MAXL; ty <= y + MAXL; ty += 2) for (let tx = x - MAXL; tx <= x + MAXL; tx += 2) {
      if (!inBounds(m, tx, ty)) continue;
      const t = ty * m.width + tx;
      const len = Math.hypot(tx - x, ty - y);
      if (!w.pop[t] || len < 5 || len > MAXL || w.use[t] === Use.Incline) continue;
      const rise = m.elevation[t] - m.elevation[b];
      if (rise < 35) continue;
      // houses served: populated tiles within 6 tiles of the head
      let served = 0;
      for (let dy = -6; dy <= 6; dy += 2) for (let dx = -6; dx <= 6; dx += 2) if (inBounds(m, tx + dx, ty + dy)) served += w.pop[(ty + dy) * m.width + tx + dx];
      const saving = Math.min(90, walkMinutes(g, t)) - (walkMinutes(g, b) + len * 0.15);
      const score = saving * Math.sqrt(served + 1) * 0.2 + rise * 0.1 - len * 0.3;
      if (score <= best || saving < 8) continue;
      const line = tileLine(x, y, tx, ty);
      if (line.some(([lx, ly]) => { const j = ly * m.width + lx; const u = w.use[j]; return m.terrain[j] === Terrain.Water || u === Use.Industry || u === Use.Rival || u === Use.Civic || u === Use.Landmark || u === Use.Incline || u === Use.Commerce; })) continue;
      best = score; bottom = b; top = t; bd = len;
    }
  }
  if (top < 0) return { ok: false, reason: "No hillside houses above the works that an incline would bring closer" };
  const tx = top % m.width, ty = (top / m.width) | 0;
  const id = 100 + g.inclinesBuilt++;
  const path = tileLine(bottom % m.width, (bottom / m.width) | 0, tx, ty);
  const name = `${c.name.replace(/ Co\.$/, "")} Incline${g.inclinesBuilt > 1 ? ` No. ${g.inclinesBuilt}` : ""}`;
  w.inclines.push({ id, name, year: cal(g).year, path });
  for (const [x, y] of path) {
    const i = y * m.width + x;
    w.use[i] = Use.Incline; w.sub[i] = id; w.pop[i] = 0; w.street[i] = 0; w.built[i] = cal(g).year;
  }
  w.version++;
  c.cash -= INCLINE_COST;
  updateAccess(g);
  log(g, `${c.name} opens the ${name}, ${feet(bd * m.metersPerTile)} up the hill.`);
  return { ok: true };
}

/** Which side of a footprint faces the river (where the dock goes). */
export function riverSideOf(m: GameMap, x: number, y: number, fp: number): RiverSide {
  const count = (x0: number, y0: number, x1: number, y1: number) => {
    let c = 0;
    for (let yy = y0; yy <= y1; yy++) for (let xx = x0; xx <= x1; xx++)
      if (inBounds(m, xx, yy) && m.terrain[yy * m.width + xx] === Terrain.Water) c++;
    return c;
  };
  const sides: [RiverSide, number][] = [
    ["N", count(x, y - 4, x + fp - 1, y - 1)], ["S", count(x, y + fp, x + fp - 1, y + fp + 3)],
    ["W", count(x - 4, y, x - 1, y + fp - 1)], ["E", count(x + fp, y, x + fp + 3, y + fp - 1)],
  ];
  sides.sort((a, b) => b[1] - a[1]);
  return sides[0][0];
}

/** Technologies a rival would be running in a given year. */
export function techsForYear(ind: IndustryId, year: number): string[] {
  return INDUSTRIES[ind].tech.filter((t) => t.year <= year - 2).map((t) => t.id);
}

/** Fund a public library near the works (the Carnegie gambit). */
export const LIBRARY_COST = 40000;
export function fundLibrary(g: GameState): { ok: boolean; reason?: string } {
  const c = g.company;
  if (!c) return { ok: false, reason: "No company" };
  if (c.library) return { ok: false, reason: "Already funded a library" };
  if (cal(g).year < 1880) return { ok: false, reason: "Libraries become a thing in the 1880s" };
  if (c.cash < LIBRARY_COST) return { ok: false, reason: `Needs $${LIBRARY_COST.toLocaleString()}` };
  const at = placeCivic(g, c.x + (c.footprint >> 1), c.y + (c.footprint >> 1), CivicSub.Library);
  if (!at) return { ok: false, reason: "No site for a library near the works" };
  c.cash -= LIBRARY_COST;
  c.library = true;
  log(g, `${c.name} funds a free public library for the town.`);
  return { ok: true };
}

/** Most numerous community within r tiles. */
export function dominantGroup(g: GameState, cx: number, cy: number, r: number): number {
  const { map: m, world: w } = g;
  const c = new Float64Array(GROUPS.length);
  for (let y = cy - r; y <= cy + r; y += 2) for (let x = cx - r; x <= cx + r; x += 2) {
    if (!inBounds(m, x, y)) continue;
    const i = y * m.width + x;
    if (w.pop[i] && w.eth[i]) c[w.eth[i]] += w.pop[i];
  }
  let best = 1;
  for (let k = 1; k < c.length; k++) if (c[k] > c[best]) best = k;
  return best;
}

/** Put a civic building on a settled lot near (cx, cy) that fronts a street. */
function placeCivic(g: GameState, cx: number, cy: number, sub: CivicSub): boolean {
  const { map: m, world: w } = g;
  let best = -1, bd = Infinity;
  for (let r = 3; r <= 45 && best < 0; r += 6) {
    for (let y = cy - r; y <= cy + r; y++) for (let x = cx - r; x <= cx + r; x++) {
      if (!inBounds(m, x, y)) continue;
      const i = y * m.width + x;
      const u = w.use[i];
      if (u !== Use.Houses && u !== Use.Rowhouses && u !== Use.Cottage) continue;
      if (w.owner[i] || !nearStreet(g, x, y)) continue;
      const d = Math.hypot(x - cx, y - cy) + tileNoise(g.seed, x, y, 77) * 3;
      if (d < bd) { bd = d; best = i; }
    }
  }
  if (best < 0) return false;
  w.use[best] = Use.Civic;
  w.sub[best] = sub;
  if (sub === CivicSub.School || sub === CivicSub.Firehouse || sub === CivicSub.Library) w.eth[best] = 0;
  w.pop[best] = 0;
  w.built[best] = cal(g).year;
  w.was[best] = w.eth[best];
  w.version++;
  return true;
}

/** Take the land, clear it, and grade it flat (vertex heights averaged). */
export function claimFootprint(g: GameState, x: number, y: number, fp: number, owner: number, use: Use) {
  const { map: m, world: w } = g;
  const V = m.width + 1;
  let sum = 0, cnt = 0;
  for (let vy = y; vy <= y + fp; vy++) for (let vx = x; vx <= x + fp; vx++) { sum += m.vert[vy * V + vx]; cnt++; }
  const level = sum / cnt;
  // inner vertices flat; edge vertices meet the surrounding ground halfway (an embankment)
  for (let vy = y; vy <= y + fp; vy++) for (let vx = x; vx <= x + fp; vx++) {
    const edge = vx === x || vy === y || vx === x + fp || vy === y + fp;
    const k = vy * V + vx;
    m.vert[k] = edge ? (m.vert[k] + level) / 2 : level;
  }
  recomputeElevation(m);
  for (let dy = 0; dy < fp; dy++) for (let dx = 0; dx < fp; dx++) {
    const i = (y + dy) * m.width + (x + dx);
    w.owner[i] = owner;
    w.use[i] = use;
    w.pop[i] = 0;
    w.street[i] = 0;
    w.sub[i] = 0;
  }
  // a works keeps a yard round it: houses against its walls are cleared (streets stay)
  if (use === Use.Industry || use === Use.Rival) for (let dy = -1; dy <= fp; dy++) for (let dx = -1; dx <= fp; dx++) {
    if (dx >= 0 && dy >= 0 && dx < fp && dy < fp) continue;
    if (!inBounds(m, x + dx, y + dy)) continue;
    const i = (y + dy) * m.width + (x + dx);
    const u = w.use[i];
    if (w.owner[i] || w.street[i] || !(u === Use.Houses || u === Use.Rowhouses || u === Use.Cottage)) continue;
    w.pop[i] = 0; w.use[i] = Use.Empty; w.sub[i] = 0;
  }
  w.version++;
}

export function log(g: GameState, text: string) {
  g.log.push({ turn: g.turn, text });
}

/** each expansion adds 30% of the original capacity */
export const ANNEX_CAPACITY = 0.3;

export function techMods(c: Works) {
  const ind = INDUSTRIES[c.industry];
  const mods = { capacity: c.annexes.filter((a) => a.kind === "expand").length * ANNEX_CAPACITY, efficiency: 0, pollution: 0, workersPerUnit: 0, labour: 1 };
  for (const t of ind.tech) if (c.techs.includes(t.id)) {
    mods.capacity += t.effects.capacity ?? 0;
    mods.efficiency += t.effects.efficiency ?? 0;
    mods.pollution += t.effects.pollution ?? 0;
    mods.workersPerUnit += t.effects.workersPerUnit ?? 0;
    mods.labour *= 1 + (t.effects.workersPerUnit ?? 0);
  }
  return mods;
}

export function advanceTurn(g: GameState): void {
  if (g.over) return;
  const c0 = cal(g);
  const last = g.turn >= TOTAL_TURNS - 1;
  const rng = new Rng(g.seed).fork(`turn${g.turn}`);
  const fx = SEASON_EFFECTS[c0.season];

  // a decision left open takes the course history took
  for (let k = 0; g.pendingDecision && k < 10; k++) resolveDecision(g, rng.fork(`decision${k}`));
  // a succession left open: the eldest stays in the business
  if (g.family?.succession) defaultSuccession(g);
  g.morale += (50 - g.morale) * 0.05;
  // the jobless find other work, or leave; while they're many, the town is low
  g.jobless = Math.round(g.jobless * 0.93);
  if (g.jobless > 500) g.morale = Math.max(0, g.morale - Math.min(2, g.jobless / 5000));
  g.plants = [];
  g.lastStrikes = g.strikeAt; g.strikeAt = [];
  clearRuins(g);
  publicHousing(g);
  sportsSeason(g, rng.fork("sports"));
  for (const r of g.rivals) if (r.active && !r.owned && (r.strikeUntil ?? 0) > g.turn) g.strikeAt.push([r.x, r.y]);
  spawnRivals(g, c0.year);
  // dated closures: the works shuts for good
  for (const r of g.rivals) {
    const def = RIVALS.find((d) => d.id === r.id);
    if (def?.closes !== undefined && c0.year >= def.closes && !r.closed && !r.owned) { r.closed = true; r.lastMove = `${c0.year}: closed`; log(g, `${nameNow(def, c0.year, r.name, r.nameYear)} closes for good.`); }
  }
  applyPendingRivalFx(g);
  // the rivals make their moves (by personality) before the season's work
  ownersSeason(g, rng.fork("owners"));
  rivalSeason(g, rng.fork("rivals"));
  // the union organises, the politicians count votes, the heirs grow up, memories fade
  if (g.company) labourSeason(g, rng.fork("labour"));
  { const pr = rng.fork("politics"); politicsSeason(g, () => pr.next()); }
  envSeason(g, rng.fork("env"));
  closureSeason(g);
  careerSeason(g, rng.fork("career"));
  familySeason(g);
  ledgerSeason(g);
  rivalsAnswer(g);
  const rivals = rivalPlants(g, c0.year);
  if (g.company) runCompany(g, rng, fx.river, fx.floodRisk, rivals);
  else { clearMarkets(g, {}, (r) => rivalOutput(g, r)); shipSeason(g.map, c0.year, fx.river, rivalShippers(g, rivals), g.env.freight, "p", g.publicWorks.locks, (link) => mod(g, "freightCap", { gateway: link })); }
  g.plants.push(...rivals);
  updateStocks(g);
  const season = g.turn % 4;
  updateAir(g.map, g.world, g.env, g.plants, season, mod(g, "pollution"));
  updateRivers(g.map, g.world, g.env, g.plants, mod(g, "riverLoad"));
  naturalGrowth(g, rng);
  recordPrices(g);
  if (g.company?.bankrupt && !last) {
    g.over = true;
    g.headlines.push({ year: c0.year, season: c0.season, name: `Receivers Take ${g.company.name}`, description: `After ${RECEIVERSHIP} seasons overdrawn, the bank has put ${g.company.name} into receivership. The works will be sold.`, category: "Labor" });
    fileNews(g);
    updateStats(g, c0.year);
    log(g, `${g.company.name} is in receivership. Your story in the valley is over.`);
    g.world.version++;
    return;
  }
  if (last) {
    // Winter 1985 was the last season: the game ends here and the clock stays put
    g.over = true;
    g.headlines = [];
    updateStats(g, c0.year);
    log(g, "The end of the steel era. Your story in the valley is over.");
    g.world.version++;
    return;
  }

  g.turn++;
  const c1 = cal(g);
  g.world.year = c1.year;
  const s1 = g.turn % 4;
  if (c1.year !== c0.year) g.commute = buildCommute(g.map, g.world, centersFor(g));
  roadsSeason(g);
  {
    const plants: [number, number][] = g.rivals.filter((r) => !r.offmap).map((r) => [Math.round(r.x + r.footprint / 2), Math.round(r.y + r.footprint / 2)]);
    if (g.company) plants.push([Math.round(g.company.x + g.company.footprint / 2), Math.round(g.company.y + g.company.footprint / 2)]);
    {
      // the census curve sets how many arrive this season; desirability sets where
      // (after 1975 the curve falls; newcomers only replace losses where the valley is below it)
      const room = Math.round((regionTarget(c1.year + (s1 + 1) / 4) - totalPopulation(g)) * (c1.year < 1975 ? 0.12 : 0.04));
      g.lastGrowth = growByDesire(g.map, g.world, g.commute.access, plants, room, s1);
    }
    civicSeason(g.map, g.world, s1);
    g.env.trafficNorm = runTrips(g.map, g.world, g.commute, g.env.traffic, rng.fork("trips"));
    if (s1 === 1 || s1 === 3) recomputeLandValue(g.map, g.world);
  }
  if (c1.year !== c0.year) {
    activateStreets(g.map, g.world);
    activateFeatures(g.map, g.world);
    for (const [, l] of Object.entries(g.map.railLines)) if (l.year === c1.year) log(g, `The ${l.name} opens.`);
    for (const [, b] of Object.entries(g.map.bridges)) if (b.year === c1.year) log(g, `The ${b.name} opens.`);
    for (const inc of INCLINES) if (inc.year === c1.year) log(g, `The ${inc.name} opens.`);
    for (const pk of PARKS) if (pk.year === c1.year && !g.world.parks?.includes(pk.name)) log(g, `${pk.name} is laid out as a public park.`);
    civicYear(g, c1.year);
    for (const h of HILLSIDES) if (h.year === c1.year) log(g, `Houses begin to climb the hillside at ${h.name}.`);
    recordHistory(g.map, g.world, g.history);
    returningUnion(g);
    updateHealth(g.map, g.world, g.env, hospitals(g), hoodBoosts(g));
    updateAccess(g);
    if (g.company) for (const w of g.company.others) updateWorksAccess(g, w);
  }
  if (c1.era.id !== c0.era.id) log(g, `A new era begins: ${c1.era.name}.`);
  // the first spring of a new era: the head of the family steps down; the rivals' heirs take over too
  if (successionDue(g)) { beginSuccession(g); ownersSuccession(g); }
  fireEvents(g);
  updateStats(g, c1.year);
  g.world.version++;
}

function updateStats(g: GameState, year: number) {
  const st = g.stats, c = g.company;
  const pop = totalPopulation(g);
  if (pop > st.peakPop) { st.peakPop = pop; st.peakPopYear = year; }
  if (!c) return;
  if (c.cash > st.peakCash) { st.peakCash = c.cash; st.peakCashYear = year; }
  const emp = totalEmployees(c);
  if (emp > st.peakEmployees) { st.peakEmployees = emp; st.peakEmployeesYear = year; }
  if (c.totals) st.totalProfit += c.totals.profit;
}

/** per-unit upkeep of a works' capacity each season, as a share of the 1850 price (repairs, salaries, interest) */
export const UPKEEP = 0.05;
/** prices rise 0.8% a year (wages 1.2%): only better processes keep a works ahead */
export const PRICE_TREND = 0.008;
/** seasons in the red before the bank takes the works */
export const RECEIVERSHIP = 8;

interface WorksPlan {
  w: Works; capacity: number; wpu: number; workersWanted: number; workersHired: number;
  output: number; notes: string[]; needs: Shipper["needs"];
  /** what sells this season (output plus stock drawn down, less what goes into the yards) */
  sold?: number;
}

/** Labour, strikes and floods at one works: what it could make this season, and the inputs it needs. */
function planWorks(g: GameState, w: Works, rng: Rng, pe: PolicyEffects, floodRisk: number, lockedOut: boolean): WorksPlan {
  const m = g.map;
  const ind = INDUSTRIES[w.industry];
  const mods = techMods(w);
  const cx = w.x + (w.footprint >> 1), cy = w.y + (w.footprint >> 1);
  const notes: string[] = [];
  // a unit retired for offsets (after the 1977 amendments) takes a share of the first works for good
  const capacity = ind.baseCapacity * (1 + mods.capacity) * (w === g.company && g.company.biz.flags.offsets ? 0.85 : 1);
  // bigger plant needs fewer men per ton (the Bessemer converter, the open hearth): men grow with capacity^0.8;
  // labour-saving processes each cut the men per ton by their share; long shifts need fewer men
  const wpu = Math.max(0.02, ind.workersPerUnit * mods.labour) * pe.wpuMult * Math.pow(1 + mods.capacity, -0.2);
  const workersWanted = Math.round(capacity * wpu);
  const main = w === g.company;
  if (main && !g.access) updateAccess(g);
  if (!main && !w.access) updateWorksAccess(g, w);
  const acc = main ? g.access : w.access;
  // the labor pool is everyone within an hour's travel, weighted by how long it takes
  let pool = 0, healthSum = 0, unrestSum = 0;
  const RR = 160, bg = blockGrid(m);
  for (let y = cy - RR; y <= cy + RR; y++) for (let x = cx - RR; x <= cx + RR; x++) {
    if (!inBounds(m, x, y)) continue;
    const i = y * m.width + x;
    if (!g.world.pop[i]) continue;
    const wgt = g.world.pop[i] * commuteWeight(walkMinutes(g, i, acc));
    if (!wgt) continue;
    pool += wgt;
    const b = blockOf(bg, x, y);
    healthSum += g.env.health[b] * wgt; unrestSum += g.env.unrest[b] * wgt;
  }
  // the workforce's health sets how much a shift gets done; its grievances, how likely a walkout is
  w.health = pool ? healthSum / pool : 1;
  w.unrest = pool ? unrestSum / pool : 0;
  // other works share the pool with the first one where their districts overlap: count a little less
  // named places with trouble (or good news) of their own
  if (g.placeFx.length) {
    const fx = placeOffsets(g, cx, cy);
    w.unrest = Math.max(0, Math.min(1, w.unrest + fx.unrest));
    w.health = Math.max(0.1, Math.min(1, w.health + fx.health));
  }
  // town morale steadies the men (or sours them)
  w.unrest = Math.max(0, Math.min(1, w.unrest - (g.morale - 50) / 500));
  const ctx = { industry: w.industry };
  const laidOff = g.company!.biz.layoffUntil > g.turn ? 0.75 : 1;
  let workersHired = Math.round(laidOff * Math.min(workersWanted, pool * PARTICIPATION * pe.participationMult * mod(g, "labour", ctx) * (main ? 1 : 0.8)));
  let output = Math.min(capacity, workersHired / wpu);
  w.status = "running";
  if (w.closed) {
    output = 0; workersHired = 0;
    w.status = "idle";
    notes.push(`${w.name} stands cold.`);
  } else if (lockedOut) {
    output = 0;
    w.status = "lockout";
    notes.push("The gates are locked. The works is dark.");
  } else if (w.strikeTurns > 0) {
    w.strikeTurns--;
    output = 0;
    w.status = "strike";
    notes.push("The men are out on strike. The works stand cold.");
  } else if (unorganisedStrikeChance(g, w) > 0 && rng.chance(unorganisedStrikeChance(g, w) * (0.02 + Math.min(0.04, w.employees / 60000)) * mod(g, "strike", ctx) * (0.4 + 1.6 * w.unrest) * pe.strikeMult * strikeContagion(g, w) * (ind.quiet ? 0.3 : 1))) {
    w.strikeTurns = rng.int(1, 3); // long enough to negotiate, call the Pinkertons or bring in strikebreakers
    g.stats.strikes++;
    output = 0;
    w.status = "strike";
    notes.push("Strike! The men walked out over wages and hours.");
    log(g, `Strike at ${w.name}.`);
  }
  output *= 0.75 + 0.25 * w.health;

  let flood = 0;
  for (let dy = 0; dy < w.footprint; dy++) for (let dx = 0; dx < w.footprint; dx++)
    if (m.terrain[(w.y + dy) * m.width + w.x + dx] === Terrain.Floodplain) flood++;
  const guard = flood ? mod(g, "floodRisk", { gateway: worksRiver(g, w) }) : 1;
  if (flood && g.floodNow !== undefined) {
    output *= 1 - (1 - g.floodNow) * guard;
    w.status = "flooded";
    notes.push("The great flood put the works under water.");
  } else if (flood && rng.chance(floodRisk * guard)) {
    output *= 0.6;
    w.status = "flooded";
    notes.push("Flood! The works stood in water for weeks.");
    log(g, `Flood damaged ${w.name}.`);
  }
  // wartime orders can push a works past its rated capacity (a little)
  output = Math.floor(output * Math.min(1.2, mod(g, "output", ctx)));
  if (output === 0 && w.status === "running") w.status = "idle";
  const needs: Shipper["needs"] = {};
  for (const [good, per] of Object.entries(ind.inputs)) needs[good as keyof typeof needs] = output * (per ?? 0);
  return { w, capacity, wpu, workersWanted: w.closed ? 0 : workersWanted, workersHired, output, notes, needs };
}

/**
 * The market's answer for one works (from 1893; src/core/supply.ts, world.ts): what sells, what goes into the yards,
 * what's drawn from them, and how many men the works keeps. From 1946 your costs against the world's set your share.
 */
function applyMarket(g: GameState, p: WorksPlan) {
  const w = p.w, y = cal(g).year, ind = INDUSTRIES[w.industry];
  const view = marketFor(g, w);
  const m = g.markets?.[w.industry];
  const offered = p.output;
  if (y < MARKET_FROM || !m || w.closed) { p.sold = offered; w.market = { ...view, util: 1, comp: 1, price: 1 }; return; }
  const comp = y >= 1946 ? view.comp : 1;
  const share = Math.min(1, m.sold * comp);
  const run = g.company!.biz.policy.run ?? "market";
  let stock = w.stock ?? 0;
  // when there's room in the market the yards are drawn down first
  const room = m.sold >= 1 ? Math.max(0, (m.demand - m.supply) * (offered / Math.max(1, m.supply))) + offered * 0.1 : 0;
  const fromStock = Math.min(stock, Math.floor(room));
  stock -= fromStock;
  const sellable = Math.floor(offered * share);
  let made = offered, sold = sellable + fromStock;
  if (run === "banked") { made = 0; sold = fromStock; }
  else if (run === "market") made = sellable;
  else stock += offered - sellable;
  w.stock = Math.round(stock);
  if (made < offered) {
    const keep = run === "banked" ? Math.round(p.workersHired * 0.08) : Math.ceil((made * p.wpu) / (0.75 + 0.25 * w.health));
    const cut = Math.max(0, p.workersHired - keep);
    if (cut > 0) {
      if (w.employees > keep) g.jobless += Math.max(0, w.employees - keep);
      p.workersHired -= cut;
      if (w.seasonsOperating % 4 === 0) p.notes.push(run === "banked" ? `The furnaces are banked: ${cut.toLocaleString()} men laid off.` : `Orders for only ${Math.round((made / Math.max(1, p.capacity)) * 100)}% of capacity: ${cut.toLocaleString()} men laid off.`);
    }
    p.output = made;
    for (const [good, per] of Object.entries(ind.inputs)) p.needs[good as keyof typeof p.needs] = made * (per ?? 0);
    if (made === 0 && w.status === "running") w.status = "idle";
  }
  if (offered > sellable && run === "full" && w.seasonsOperating % 4 === 0) p.notes.push(`${(offered - sellable).toLocaleString()} units unsold went into the yards (${w.stock.toLocaleString()} there now).`);
  p.sold = sold;
  // what stands idle because of the market (its upkeep still runs: src/core/world.ts idleCost)
  w.market = { ...view, comp, util: Math.max(0, 1 - (offered - made) / Math.max(1, p.capacity)), price: m.price };
}

/** Sell what the works made with what arrived; the works' own accounts for the season. */
function settleWorks(g: GameState, p: WorksPlan, fr: ShipResult | undefined, riverMult: number, pe: PolicyEffects): SeasonReport {
  const { w } = p;
  const ind = INDUSTRIES[w.industry];
  const mods = techMods(w);
  const year = cal(g).year;
  let output = p.output;
  w.freight = fr;
  if (fr) {
    output = Math.floor(output * fr.delivered);
    if (riverMult < 1 && fr.lanes.some((l) => l.mode === "river")) p.notes.push(riverMult <= 0.5 ? "Ice on the rivers: barge capacity halved." : "Low water: barges run light.");
    for (const n of fr.notes.slice(0, 2)) p.notes.push(n);
  }
  const era = 1 + (year - 1850) * PRICE_TREND;
  const standing = techStanding(g, w);
  const ctx = { industry: w.industry };
  const price = ind.basePrice * era * mod(g, "price", ctx) * pe.priceMult * (w.industry === "steel" ? 1 - (g.priceLoss ?? 0) : 1) * standing.factor * marketFactor(g, w.industry) * marketPrice(g, w.industry);
  // men are dearer where they're scarce (a works short of hands bids for them)
  const scarce = p.workersHired < p.workersWanted * 0.9 && year >= MARKET_FROM ? 1.04 : 1;
  const wage = WAGE_PER_SEASON_1850 * priceLevel(year) * mod(g, "wage", ctx) * pe.wageMult * scarce;
  const sold = p.sold === undefined ? output : Math.max(0, Math.round(p.sold * (fr ? fr.delivered : 1)));
  const revenue = Math.round(sold * price);
  // what was bought and hauled, less what better furnaces save (and more if someone has cornered the supply)
  // each good at its own price (Frick's coke, a mine disaster) and each lane at its own haulage rate
  let bought = 0;
  const fuel = year >= MARKET_FROM ? fuelPriceMult(g) : 1;
  if (fr) for (const l of fr.lanes) bought += l.delivered * (PRICE(year) * mod(g, "input", { ...ctx, good: l.good }) * inputMult(g, l.good, w.industry) * (l.good === "coal" || l.good === "coke" ? fuel : 1) + l.costPerTon * mod(g, "freightCost", { gateway: l.mode === "rail" ? "rail" : l.gateway }) * freightMult(g, l.mode));
  const inputCost = Math.round(bought * (1 - mods.efficiency) * pe.inputCostMult);
  // no work, no pay: strikers and locked-out men draw nothing from the company
  if (w.status === "strike") g.strikeAt.push([w.x, w.y]);
  const working = w.status !== "lockout" && w.status !== "strike";
  const wages = working ? Math.round(p.workersHired * wage) : 0;
  const upkeep = Math.round(p.capacity * ind.basePrice * UPKEEP * (1 + (year - 1850) * 0.008) * upkeepMult(g) * (1 + controlUpkeep(w)) * (w.closed ? 0.1 : 1));
  // plant the market leaves idle still costs: maintenance crews, the laid-off men's benefits (SUB pay from 1956),
  // property taxes and interest — so a mill broke even only near 70% of capacity (src/core/world.ts)
  const idle = w.closed ? 0 : Math.round(p.capacity * Math.max(0, 1 - (w.market?.util ?? 1)) * ind.basePrice * era * idleCost(w.industry));
  // stock in the yards: interest, storage and spoilage
  const carry = Math.round((w.stock ?? 0) * price * 0.015);
  const profit = revenue - inputCost - wages - upkeep - idle - carry;
  if (idle > 0 && w.seasonsOperating % 4 === 0) p.notes.push(`Idle plant: $${idle.toLocaleString()} a season to keep it ready.`);
  if (standing.behind.length && w.seasonsOperating % 4 === 0) p.notes.push(`Behind the industry (${standing.behind.map((t) => t.name).join(", ")}): prices ${Math.round((1 - standing.factor) * 100)}% under the rivals'.`);
  w.employees = working ? p.workersHired : 0;
  w.produced += output;
  w.seasonsOperating++;
  g.plants.push({ x: w.x, y: w.y, fp: w.footprint, output, pollutionPerUnit: ind.pollutionPerUnit * Math.max(0.1, 1 + mods.pollution) * pe.pollutionMult * (cond(g, "flag:conference") ? 0.85 : 1), owner: w.id, outfall: pe.outfallMult });
  const done = advanceResearch(g, w);
  if (done) p.notes.push(done);
  return { produced: output, revenue, inputCost, wages, upkeep: upkeep + idle + carry, other: 0, profit, workersWanted: p.workersWanted, workersHired: p.workersHired, migrants: 0, notes: p.notes };
}

function runCompany(g: GameState, rng: Rng, riverMult: number, floodRisk: number, rivals: Plant[]) {
  const c = g.company!;
  const m = g.map;
  const ind = INDUSTRIES[c.industry];
  const cx = c.x + (c.footprint >> 1), cy = c.y + (c.footprint >> 1);
  const pe = policyEffects(g);
  const year0 = cal(g).year;
  const lockedOut = c.biz.lockout > 0;
  if (lockedOut) c.biz.lockout--;

  // a family with no works of its own (sold up): it lives on its holdings
  if (!allWorks(c).length) { investorSeason(g, rng, rivals); return; }
  // every works plans its season; then all the inputs ship together with the rivals'
  const plans = allWorks(c).map((w, k) => planWorks(g, w, rng.fork(`works${k}`), pe, floodRisk, lockedOut));
  // the market clears with what everyone offers (from 1893): then each works learns what sells
  const yours: Partial<Record<IndustryId, number>> = {};
  const cap: Partial<Record<IndustryId, number>> = {};
  for (const p of plans) { yours[p.w.industry] = (yours[p.w.industry] ?? 0) + p.output + (p.w.stock ?? 0) * 0.25; cap[p.w.industry] = (cap[p.w.industry] ?? 0) + (p.w.closed ? 0 : p.capacity * 0.85); }
  clearMarkets(g, yours, (r) => rivalOutput(g, r), cap);
  for (const p of plans) applyMarket(g, p);
  const ship = shipSeason(m, year0, riverMult, [
    ...rivalShippers(g, rivals),
    ...plans.map((p) => ({ id: p.w.id, site: { x: p.w.x, y: p.w.y, fp: p.w.footprint, spur: p.w.spur, dock: p.w.dock }, needs: p.needs })),
  ], g.env.freight, "p", g.publicWorks.locks, (link) => mod(g, "freightCap", { gateway: link }));
  g.env.freightNorm = ship.norm;
  const reports = plans.map((p) => settleWorks(g, p, ship.players[p.w.id], riverMult, pe));
  const sum = (k: "revenue" | "inputCost" | "wages" | "upkeep" | "produced" | "workersHired" | "workersWanted") => reports.reduce((s, r) => s + r[k], 0);

  // the season's business: meters drift, accidents, inspectors; safety men cost money; the company store earns
  const biz = businessSeason(g, rng.fork("biz"), allWorks(c).reduce((s, w) => s + w.employees, 0));
  // the bank takes its share of the profits until the loan is paid
  const before = sum("revenue") - sum("inputCost") - sum("wages") - sum("upkeep");
  const repay = c.debt > 0 ? Math.min(c.debt, Math.max(Math.round(c.debt * 0.05), Math.round(Math.max(0, before) * 0.25))) : 0;
  c.debt -= repay;
  const other = Math.round(biz.extraCost + biz.fines - sum("wages") * pe.storeIncomeShare + repay);
  const held = holdingsSeason(g); // paid into cash there
  // the later burdens: the income tax, pensions, cleaning up, the co-op's members, the trust's share, the manager
  const bd = burdens(g, before - other, held);
  const profit = before - other - bd.total;
  c.cash += profit;
  const main = reports[0];
  main.other = other;
  main.profit -= other;
  for (const n of biz.notes) main.notes.push(n);
  if (repay) main.notes.push(`$${repay.toLocaleString()} repaid to the bank.`);
  main.other += bd.total; main.profit -= bd.total;
  for (const n of bd.notes) main.notes.push(n);
  // in the red too long and the bank sends in the receivers
  c.redSeasons = c.cash < 0 ? (c.redSeasons ?? 0) + 1 : 0;
  if (c.redSeasons >= RECEIVERSHIP / 2 && c.redSeasons < RECEIVERSHIP) main.notes.push(`Overdrawn for ${c.redSeasons} seasons: the bank will take the works after ${RECEIVERSHIP}.`);
  if (c.redSeasons >= RECEIVERSHIP) c.bankrupt = true;

  // newcomers come where the works are short of men
  let migrants = 0;
  plans.forEach((p, k) => {
    const shortfall = Math.max(0, p.workersWanted - p.workersHired);
    const n = settleMigrants(g, p.w.x + (p.w.footprint >> 1), p.w.y + (p.w.footprint >> 1), tilesFor(m, INDUSTRIES[p.w.industry].site.laborRadiusM),
      Math.round((shortfall / PARTICIPATION * 0.35 + p.workersHired * 0.05) * mod(g, "migrants") * Math.min(1.8, Math.max(0.5, 0.5 + immigrationPressure(year0) * 0.25))));
    reports[k].migrants = n;
    if (n > 0) reports[k].notes.push(`${n} newcomers settled near the works.`);
    migrants += n;
  });
  // a growing mill town needs churches, schools and firehouses
  c.civicDue += migrants;
  if (c.civicDue >= 1500) {
    c.civicDue = 0;
    const kinds: CivicSub[] = [GROUPS[dominantGroup(g, cx, cy, 30)].church as CivicSub];
    if (year0 >= 1865) kinds.push(CivicSub.School);
    if (year0 >= 1870) kinds.push(CivicSub.Firehouse);
    const kind = kinds[rng.int(0, kinds.length - 1)];
    if (placeCivic(g, cx, cy, kind)) log(g, `The town near the works builds a new ${kind === CivicSub.School ? "school" : kind === CivicSub.Firehouse ? "firehouse" : kind === CivicSub.Synagogue ? "synagogue" : "church"}.`);
  }
  // families brought by recruiting agents or as strikebreakers
  for (const [gid, n] of c.biz.recruits.splice(0)) {
    const placed = settleMigrants(g, cx, cy, tilesFor(m, ind.site.laborRadiusM), n, gid);
    if (placed) main.notes.push(`${placed} ${GROUPS[gid].name} newcomers arrived for the works.`);
  }
  plans.forEach((p, k) => { p.w.lastSeason = reports[k]; });
  recordProfits(c);
  c.totals = {
    produced: sum("produced"), revenue: sum("revenue"), inputCost: sum("inputCost"), wages: sum("wages"), upkeep: sum("upkeep"), other: other + bd.total, profit: profit + held, holdings: held, tax: bd.tax, pensions: bd.pensions,
    workersWanted: sum("workersWanted"), workersHired: sum("workersHired"), migrants, notes: main.notes,
  };
  for (const n of publicSeason(g)) main.notes.push(n);
}

/** a season for a family that sold its works: the holdings pay, the taxes and the family's costs come out */
function investorSeason(g: GameState, rng: Rng, rivals: Plant[]) {
  const c = g.company!;
  clearMarkets(g, {}, (r) => rivalOutput(g, r));
  shipSeason(g.map, cal(g).year, 1, rivalShippers(g, rivals), g.env.freight, "p", g.publicWorks.locks, (link) => mod(g, "freightCap", { gateway: link }));
  const biz = businessSeason(g, rng.fork("biz"), 0);
  const held = holdingsSeason(g);
  const bd = burdens(g, 0, held);
  const other = Math.round(biz.extraCost + biz.fines + bd.total);
  c.cash -= other;
  c.redSeasons = c.cash < 0 ? (c.redSeasons ?? 0) + 1 : 0;
  if (c.redSeasons >= RECEIVERSHIP) c.bankrupt = true;
  const notes = ["The family lives on its holdings.", ...biz.notes, ...bd.notes];
  c.totals = { produced: 0, revenue: 0, inputCost: 0, wages: 0, upkeep: 0, other, profit: held - other, holdings: held, tax: bd.tax, pensions: bd.pensions, workersWanted: 0, workersHired: 0, migrants: 0, notes };
  c.lastSeason = c.totals;
}

/** corporate income tax, top rate by year (the federal tax from 1909) */
export function corporateTax(y: number): number {
  return y < 1909 ? 0 : y < 1916 ? 0.01 : y < 1917 ? 0.02 : y < 1918 ? 0.06 : y < 1919 ? 0.12 : y < 1922 ? 0.1 : y < 1925 ? 0.125 : y < 1928 ? 0.13 : y < 1932 ? 0.12 : y < 1936 ? 0.1375 : y < 1940 ? 0.15
    : y < 1941 ? 0.24 : y < 1942 ? 0.31 : y < 1946 ? 0.4 : y < 1950 ? 0.38 : y < 1951 ? 0.42 : y < 1964 ? 0.52 : y < 1965 ? 0.5 : y < 1979 ? 0.48 : 0.46;
}

/**
 * What the later years cost a company: the income tax on profits (from 1909), pensions and health care for the
 * men who retire (won in the 1949 strike), cleaning up the slag and acid it dumped (Superfund, 1980), the
 * members' share in a co-operative, U.S. Steel's share of a division, and a hired manager's fee.
 */
function burdens(g: GameState, operating: number, held: number): { total: number; tax: number; pensions: number; notes: string[] } {
  const c = g.company!, y = cal(g).year, f = c.biz.flags, notes: string[] = [];
  let total = 0, pensions = 0;
  // pensions: every man who retires draws one for the rest of his life, whether the works still runs or not
  if (y >= 1950) {
    c.retirees = (c.retirees ?? g.stats.peakEmployees * 0.25) * 0.988 + totalEmployees(c) * 0.008;
    const wage = WAGE_PER_SEASON_1850 * priceLevel(y) * mod(g, "wage");
    pensions = Math.round(c.retirees * wage * (0.3 + (y >= 1960 ? 0.15 : 0)) * (c.biz.policy.union === "recognise" || f.coop ? 1 : 0.6));
    total += pensions;
    if (pensions) notes.push(`Pensions and health care for ${Math.round(c.retirees).toLocaleString()} retired men: $${pensions.toLocaleString()}.`);
  }
  // the river remembers: from 1980 the government bills the dumping of the decades before
  if (y >= 1980 && Number(f.dumped ?? 0) > 0) {
    const liability = Number(f.dumped) * 4000 * priceLevel(y), paid = Number(f.cleanupPaid ?? 0);
    const bill = Math.round(Math.min(Math.max(0, liability - paid), liability * 0.05));
    if (bill > 0) { f.cleanupPaid = paid + bill; total += bill; notes.push(`Superfund cleanup of the slag and acid dumped in the river: $${bill.toLocaleString()}.`); }
  }
  const pre = operating - total;
  if (f.division && pre > 0) { const share = Math.round(pre * 0.55); total += share; notes.push(`U.S. Steel's share of the division's profit: $${share.toLocaleString()}.`); }
  if (f.coop && pre > 0) { const share = Math.round(pre * 0.3); total += share; notes.push(`The members' share of the profit: $${share.toLocaleString()}.`); }
  if (hasTrait(g, "spoiled")) notes.push("The family's houses and yachts are not cheap.");
  // a manager runs the works: buys the processes the industry has, settles long strikes, takes his fee
  const fee = managerSeason(g, (w, id) => { commission(g, w, id, true); }, () => { for (const u of sieges(g)) settle(g, u, true); });
  if (fee) { total += fee; notes.push(`The manager's fee: $${fee.toLocaleString()}.`); }
  const tax = Math.round(Math.max(0, operating - total + held) * corporateTax(y));
  if (tax) { total += tax; notes.push(`Income tax: $${tax.toLocaleString()}.`); }
  return { total, tax, pensions, notes };
}

/** Add people near (cx,cy): fill existing homes first, then new lots beside streets. */
export function settleMigrants(g: GameState, cx: number, cy: number, r: number, count: number, group?: number): number {
  if (count <= 0) return 0;
  const { map: m, world: w } = g;
  const cands: { i: number; d: number }[] = [];
  for (let y = cy - r; y <= cy + r; y++) for (let x = cx - r; x <= cx + r; x++) {
    if (!inBounds(m, x, y)) continue;
    const i = y * m.width + x;
    if (w.owner[i] || w.street[i] || !habitable(m.terrain[i])) continue;
    const u = w.use[i];
    if (u === Use.Civic || u === Use.Landmark || u === Use.Wharf || u === Use.Commerce || u === Use.Park || u === Use.Incline || u === Use.Mine) continue;
    if (!w.pop[i] && besideWorks(m, w, x, y)) continue;
    // prefer lots on today's street grid (where the real town grew)
    const streetBonus = m.road[i] ? 6 : nearStreet(g, x, y) ? -3 : 4;
    cands.push({ i, d: Math.hypot(x - cx, y - cy) + (m.terrain[i] === Terrain.Slope ? 4 : 0) + streetBonus });
  }
  cands.sort((a, b) => a.d - b.d);
  let left = count;
  for (const { i } of cands) {
    if (left <= 0) break;
    const room = Math.min(capFor(w.sub[i]), terrainCap(m.terrain[i]), densityCap(m, w, i)) - w.pop[i];
    if (room <= 0) continue;
    const add = Math.min(room, left, 12);
    const fresh = w.pop[i] === 0;
    w.pop[i] += add;
    left -= add;
    w.use[i] = useForPop(w.pop[i]);
    if (fresh && w.use[i] === Use.Cottage) w.use[i] = Use.Houses;
    const x = i % m.width, y = (i / m.width) | 0;
    const d = Math.hypot(x - cx, y - cy);
    if (fresh) {
      w.built[i] = g.world.year;
      w.eth[i] = group ?? pickGroup(m, w.eth, w.pop, i % m.width, (i / m.width) | 0, w.year, ethRng(g));
      w.sub[i] = d <= 10 && w.landValue[i] < 60 ? HouseSub.Shanty : d <= 28 && g.world.year >= 1855 ? HouseSub.Company : HouseSub.Normal;
    } else if (w.use[i] === Use.Rowhouses) {
      if (w.sub[i] === HouseSub.Shanty || w.sub[i] === HouseSub.Company) { w.sub[i] = d <= 18 ? HouseSub.Boarding : HouseSub.Normal; w.built[i] = g.world.year; }
    }
  }
  if (left < count) w.version++;
  return count - left;
}

let ethRngCache: { g: GameState; turn: number; rng: Rng } | null = null;
function ethRng(g: GameState) {
  if (!ethRngCache || ethRngCache.g !== g || ethRngCache.turn !== g.turn) ethRngCache = { g, turn: g.turn, rng: new Rng(`${g.seed}:eth:${g.turn}`) };
  return ethRngCache.rng;
}

/** Company doubles and shanty patches stay low-density; ordinary lots can fill up to rowhouses. */
function capFor(sub: number) {
  return sub === HouseSub.Shanty ? 16 : sub === HouseSub.Company ? POP_CAP.houses : POP_CAP.rowhouses;
}

function nearStreet(g: GameState, x: number, y: number) {
  const m = g.map;
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++)
    if (inBounds(m, x + dx, y + dy) && g.world.street[(y + dy) * m.width + x + dx]) return true;
  return false;
}

function naturalGrowth(g: GameState, rng: Rng) {
  const w = g.world;
  const n = w.pop.length;
  if (w.year >= 1975) {
    // the collapse: families leave the mill towns; empty houses stand boarded up
    // the steel towns: within ~1.3 km of a steel works (yours if it's steel, and the rivals')
    const steel: [number, number][] = g.rivals.filter((r) => RIVALS.find((d) => d.id === r.id)?.industry === "steel").map((r) => [r.x + r.footprint / 2, r.y + r.footprint / 2]);
    if (g.company) for (const w of allWorks(g.company)) if (w.industry === "steel") steel.push([w.x + w.footprint / 2, w.y + w.footprint / 2]);
    const W = g.map.width;
    for (let i = 0; i < n; i++) {
      if (!w.pop[i] || w.use[i] < Use.Cottage || w.use[i] > Use.Rowhouses || w.sub[i] === HouseSub.Estate) continue;
      const x = i % W, y = (i / W) | 0;
      const millTown = steel.some(([px, py]) => Math.abs(px - x) < 45 && Math.abs(py - y) < 45);
      // the steel towns lose about a third of their people over the decade (empty houses stand boarded up)
      if (millTown && rng.chance(0.008)) w.pop[i] = 0;
      else if (millTown && rng.chance(0.5)) w.pop[i] = Math.floor(w.pop[i] * 0.985);
    }
    w.version++;
    return;
  }
  const bg = blockGrid(g.map), W = g.map.width;
  // disease: where air, water and crowding are worst, people die faster than they're born
  for (let k = 0; k < 6000; k++) {
    const i = rng.int(0, n - 1);
    if (!w.pop[i]) continue;
    const h = g.env.health[blockOf(bg, i % W, (i / W) | 0)];
    if (h < 0.6 && rng.chance((0.6 - h) * 1.5)) w.pop[i] = Math.max(1, Math.floor(w.pop[i] * 0.95));
  }
  for (let k = 0; k < 3000; k++) {
    const i = rng.int(0, n - 1);
    const cap = Math.min(capFor(w.sub[i]), terrainCap(g.map.terrain[i]), densityCap(g.map, w, i));
    // families grow where it's healthy
    if (w.pop[i] > 0 && !rng.chance(g.env.health[blockOf(bg, i % W, (i / W) | 0)])) continue;
    if (w.pop[i] > 0 && w.pop[i] < cap && (w.use[i] >= Use.Cottage && w.use[i] <= Use.Rowhouses)) {
      w.pop[i] = Math.min(cap, Math.ceil(w.pop[i] * 1.05));
      w.use[i] = useForPop(w.pop[i]);
    }
  }
}

/** The rivals' input needs this season, for the shared river and rail lanes. */
function rivalShippers(_g: GameState, rivals: Plant[]): Shipper[] {
  return rivals.map((p) => {
    const def = RIVALS.find((d) => d.id === p.owner)!;
    const needs: Shipper["needs"] = {};
    for (const [good, per] of Object.entries(INDUSTRIES[def.industry].inputs)) needs[good as keyof typeof needs] = p.output * (per ?? 0);
    return { id: p.owner, site: { x: p.x, y: p.y, fp: p.fp }, needs };
  });
}

export const SPUR_BASE = 10000, SPUR_PER_TILE = 400;
/** Cost and reach of a rail siding from the works to the nearest open line, if one is worth building. */
export function spurQuote(g: GameState): { cost: number; len: number } | null {
  const c = g.company;
  if (!c) return null;
  const o = spurOption(g.map, { x: c.x, y: c.y, fp: c.footprint, spur: c.spur }, cal(g).year);
  return o ? { cost: SPUR_BASE + SPUR_PER_TILE * o.len, len: o.len } : null;
}

/** Build a rail siding from the works to the nearest open line. */
export function buildSpur(g: GameState): { ok: boolean; reason?: string } {
  const c = g.company;
  if (!c) return { ok: false, reason: "No company" };
  const o = spurOption(g.map, { x: c.x, y: c.y, fp: c.footprint, spur: c.spur }, cal(g).year);
  if (!o) return { ok: false, reason: c.spur ? "The works already has a siding" : "No open railroad within reach (or the works is already beside one)" };
  const cost = SPUR_BASE + SPUR_PER_TILE * o.len;
  if (c.cash < cost) return { ok: false, reason: `Needs $${cost.toLocaleString()}` };
  c.cash -= cost;
  c.spur = o.to;
  g.world.version++;
  log(g, `${c.name} lays a ${distance(o.len * g.map.metersPerTile)} rail siding to the main line.`);
  return { ok: true };
}

/** Job centres for the commute model: every works (by the jobs it offers), downtown and the town centres. */
function centersFor(g: GameState) {
  const mine = g.company ? allWorks(g.company) : [];
  const works: WorksSite[] = g.plants.map((p) => {
    const own = mine.find((w) => w.id === p.owner);
    const ind = own ? own.industry : RIVALS.find((d) => d.id === p.owner)?.industry ?? "steel";
    return { x: p.x, y: p.y, fp: p.fp, jobs: own ? Math.max(own.employees, 100) : p.output * INDUSTRIES[ind].workersPerUnit, name: p.owner };
  });
  if (g.company && !g.plants.some((p) => p.owner === "p")) works.push({ x: g.company.x, y: g.company.y, fp: g.company.footprint, jobs: Math.max(100, g.company.employees), name: "p" });
  return jobCenters(g.map, g.world, works, totalPopulation(g));
}

/** The rivals' works this season: their output from the technology of the day. */
function rivalPlants(g: GameState, year: number): Plant[] {
  const out: Plant[] = [];
  for (const r of g.rivals) {
    const def = RIVALS.find((d) => d.id === r.id);
    if (!def || !r.active || r.closed || r.offmap) continue;
    const ind = INDUSTRIES[def.industry];
    let pol = 1;
    for (const id of rivalTechs(def.industry, def.id, year, r.style)) pol += ind.tech.find((x) => x.id === id)?.effects.pollution ?? 0;
    out.push({ x: r.x, y: r.y, fp: r.footprint, output: rivalOutput(g, r, year), pollutionPerUnit: ind.pollutionPerUnit * Math.max(0.1, pol), owner: r.id });
  }
  return out;
}

/** A rival works' output this season: its own processes, expansions, damage (strikes included) and dated cutbacks. */
export function rivalOutput(g: GameState, r: RivalState, year = g.world.year): number {
  const def = RIVALS.find((d) => d.id === r.id);
  if (!def || !r.active || r.closed) return 0;
  if (def.opens !== undefined && year < def.opens) return 0; // still being built
  const ind = INDUSTRIES[def.industry];
  let cap = 1;
  for (const id of rivalTechs(def.industry, def.id, year, r.style)) cap += ind.tech.find((x) => x.id === id)?.effects.capacity ?? 0;
  return Math.round(ind.baseCapacity * cap * rivalRunning(def, year) * rivalMult(g, r));
}

/** how hard a rival works is running in a year: full (0.85) until its decline, then its dated cutbacks */
/** a fresh id for another works ("p:3"): never reuses one that was sold */
export function nextWorksId(c: Company): string {
  c.worksSeq = Math.max(c.worksSeq ?? 0, c.others.length) + 1;
  return `p:${c.worksSeq}`;
}

export function rivalRunning(def: RivalDef, year: number): number {
  if (def.closes !== undefined && year >= def.closes) return 0;
  let run = 0.85;
  for (const [y, m] of def.decline ?? []) if (year >= y) run = 0.85 * m;
  return run;
}

/** Start the air and rivers in their 1850 state (the city's coal fires have been burning for decades). */
function warmEnvironment(g: GameState) {
  for (let k = 0; k < 8; k++) { updateAir(g.map, g.world, g.env, [], k % 4, 1); updateRivers(g.map, g.world, g.env, []); }
  // long-term soot: the settled average of those seasons
  const bg = blockGrid(g.map), p = g.world.pollution, m = g.map;
  const avg = new Float32Array(bg.n);
  for (let k = 0; k < 4; k++) { updateAir(m, g.world, g.env, [], k, 1); for (let b = 0; b < bg.n; b++) avg[b] += g.env.air[b] / 4; }
  for (let y = 0; y < m.height; y++) for (let x = 0; x < m.width; x++) p[y * m.width + x] = avg[blockOf(bg, x, y)] * SOOT_SCALE;
  updateHealth(m, g.world, g.env);
}

function spawnRivals(g: GameState, year: number) {
  for (const def of RIVALS) {
    // a rival that found no room on its entry year keeps looking, further out, for ten years
    if (year < def.entryYear || year > def.entryYear + 10 || g.rivals.some((r) => r.id === def.id)) continue;
    if (def.offmap) {
      // a works beyond the map's edge: it competes from there (marked at the edge toward it)
      const [ex, ey] = latLonToTile(g.map, def.at![0], def.at![1]);
      const x = Math.max(1, Math.min(g.map.width - 2, ex)), y = Math.max(1, Math.min(g.map.height - 2, ey));
      g.rivals.push({ id: def.id, ownerId: 2 + g.rivals.length, x, y, footprint: 0, active: true, riverSide: "N", expand: 0, damage: [], grudge: 0, offmap: true });
      log(g, `${def.figures.join(" & ")} open ${def.company} at ${def.offmap}.`);
      applyPendingRivalFx(g);
      continue;
    }
    const named = g.map.landmarks.find((l) => l.name === def.site);
    const lm = def.at ? (() => { const [x, y] = latLonToTile(g.map, def.at![0], def.at![1]); return { x: Math.max(4, Math.min(g.map.width - 12, x)), y: Math.max(4, Math.min(g.map.height - 12, y)) }; })() : named;
    if (!lm) continue;
    const ps = popSAT(g.map, g.world);
    let best: { x: number; y: number; s: number } | null = null;
    const R = 24 + (year - def.entryYear) * 4;
    for (let dy = -R; dy <= R; dy += 2) for (let dx = -R; dx <= R; dx += 2) {
      const x = lm.x + dx, y = lm.y + dy;
      const rep = evaluateSite(g.map, g.world, g.fields, def.industry, x, y, ps);
      if (!rep.ok) continue;
      const s = rep.score - Math.hypot(dx, dy) * 0.8;
      if (!best || s > best.s) best = { x, y, s };
    }
    if (!best) continue;
    const fp = footprintTiles(g.map, def.industry);
    const ownerId = 2 + g.rivals.length;
    claimFootprint(g, best.x, best.y, fp, ownerId, Use.Rival);
    g.rivals.push({ id: def.id, ownerId, x: best.x, y: best.y, footprint: fp, active: true, riverSide: riverSideOf(g.map, best.x, best.y, fp), expand: 0, damage: [], grudge: 0 });
    log(g, `${def.figures.join(" & ")} open ${def.company} near ${def.site}.`);
    applyPendingRivalFx(g);
  }
}

/** unrest/health offsets from events at named places near (x, y) */
function placeOffsets(g: GameState, x: number, y: number) {
  let unrest = 0, health = 0;
  for (const f of g.placeFx) {
    const p = placeNamed(g.map, f.place);
    if (!p || Math.hypot(p.x - x, p.y - y) > p.r + 40) continue;
    unrest += f.unrest; health += f.health;
  }
  return { unrest, health };
}

/** the river a works stands on (its flood risk is that river's) */
function worksRiver(g: GameState, w: Works): string | undefined {
  const a = siteAccess(g.map, { x: w.x, y: w.y, fp: w.footprint, dock: w.dock }, cal(g).year);
  let best: string | undefined, bd = Infinity;
  for (const [k, d] of Object.entries(a.dock?.dist ?? {})) if (d! < bd) { bd = d!; best = k; }
  return best;
}

/** strikes nearby last season make one here likelier (the men talk; the organisers move on) */
function strikeContagion(g: GameState, w: Works): number {
  let n = 0;
  for (const [x, y] of g.lastStrikes) if (Math.hypot(x - w.x, y - w.y) < 70 && (x !== w.x || y !== w.y)) n++;
  return Math.min(2.5, 1 + 0.5 * n);
}

export function totalPopulation(g: GameState): number {
  const pop = g.world.pop, n = pop.length;
  let a = 0, b = 0, c = 0, d = 0, i = 0;
  for (; i + 3 < n; i += 4) { a += pop[i]; b += pop[i + 1]; c += pop[i + 2]; d += pop[i + 3]; }
  for (; i < n; i++) a += pop[i];
  return a + b + c + d;
}
