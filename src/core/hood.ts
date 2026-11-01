// Your neighbourhood (v0.18): the streets around each works. Five measures (health, housing, amenity, cohesion,
// land value) and the investments a company could make in them, each in its historical window — from water mains
// and paving to Carnegie-style baths, settlement houses, company homes sold to the men, and later restoration funds
// and rehab lending. Investments show on the map (a hospital, a hall, a playground, mended houses) and work through
// the valley model: better water and care raise health, amenity and cohesion take the edge off unrest.
// Research: docs/V018-RESEARCH.md §2.

import { type ActionDef, bump } from "./business";
import { blockGrid, blockOf } from "./blocks";
import { cal, type GameState, type Works, allWorks } from "./game";
import { type LandmarkKind, placeLandmark } from "./landmarks";
import { mark } from "./ledger";
import { inBounds } from "./map";
import { priceLevel } from "./time";
import { CivicSub, HouseSub, Use } from "./town";
import { Terrain } from "./terrain";

/** the neighbourhood: tiles within this radius of a works' centre (about a third of a mile) */
export const HOOD_R = 20;

export interface Invest {
  id: string; name: string; from: number; until?: number;
  /** 1850 dollars (scaled by the price level) */
  cost: number;
  blurb: string;
  /** what it does to the valley model in the neighbourhood: drinking-water risk ×water, health +, unrest − */
  water?: number; health?: number; unrest?: number;
  /** what it adds to the measures shown */
  housing?: number; amenity?: number; cohesion?: number;
  /** a building it puts up beside the works */
  building?: LandmarkKind | "park";
  /** what else it does when made */
  run?: (g: GameState, w: Works) => string | void;
}

export const INVESTS: Invest[] = [
  { id: "water", name: "Water mains and sewers", from: 1850, cost: 12000, water: 0.35, health: 0.02, amenity: 5,
    blurb: "Clean water piped in and sewage carried away: typhoid and dysentery fall. (The city's filtered water reaches most of Pittsburgh in 1908–14; before that only a company that pays has it.)" },
  { id: "paving", name: "Pave and light the streets", from: 1850, cost: 8000, health: 0.01, amenity: 12, unrest: 0.01,
    blurb: "Brick paving, gutters and gas lamps instead of mud: amenity and land values up." },
  { id: "baths", name: "Bath house, library and gym", from: 1888, cost: 40000, amenity: 25, unrest: 0.02, building: "library",
    blurb: "The Carnegie model (Braddock 1888, Homestead 1898): baths, books, a gym and a music hall. Reputation +6, morale +3 — less if men died at your gates (it's read as penance).",
    run: (g, w) => {
      const blood = (g.memorials ?? []).some((m) => Math.hypot(m.x - w.x, m.y - w.y) < HOOD_R * 2);
      bump(g, "reputation", blood ? 2 : 6); g.morale = Math.min(100, g.morale + 3);
      return blood ? "The papers call it penance for the men killed at your gates." : undefined;
    } },
  { id: "hospital", name: "Company hospital and relief fund", from: 1890, cost: 30000, health: 0.03, building: "hospital",
    blurb: "A hospital by the works and a fund for the injured and the widows. Labour +6 (+3 once workmen's compensation becomes law in 1915).",
    run: (g) => { bump(g, "labour", cal(g).year >= 1915 ? 3 : 6); } },
  { id: "settlement", name: "Sponsor a settlement house", from: 1893, cost: 15000, cohesion: 20, unrest: 0.03, building: "hall",
    blurb: "Kingsley House (1893), Soho (1905): kindergartens, classes and clubs. Cohesion up; the reformers who run it also write about your works (influence −2).",
    run: (g) => { bump(g, "influence", -2); } },
  { id: "homes", name: "Sell houses to the men", from: 1895, until: 1955, cost: 50000, housing: 22, unrest: 0.04,
    blurb: "Company houses sold on easy terms (Vandergrift 1895, Aliquippa's Plans 1907–17). Loyalty and labour peace (labour +8) — but the Plans were laid out by nation, and the union finds the men harder to bring together.",
    run: (g, w) => {
      bump(g, "labour", 8);
      for (const u of Object.values(g.unions ?? {})) if (u && !u.coop) u.membership *= 0.85;
      mark(g, { id: "plans", side: "labour", kind: "grievance", weight: 5, text: "laid out the company houses in Plans by nation" });
      upgradeHouses(g, w, 0.4);
    } },
  { id: "playground", name: "Playground and ball field", from: 1896, cost: 5000, health: 0.01, amenity: 10, building: "park",
    blurb: "The Civic Club opened Pittsburgh's first playground in 1896. Health and morale (+1); some parents would rather have trade classes." ,
    run: (g) => { g.morale = Math.min(100, g.morale + 1); } },
  { id: "parklets", name: "Parklets and a clean-up", from: 1944, cost: 10000, amenity: 12, unrest: 0.01, building: "park",
    blurb: "The Allegheny Conference turned vacant lots into small parks. Amenity, morale +2.",
    run: (g) => { g.morale = Math.min(100, g.morale + 2); } },
  { id: "restore", name: "Revolving restoration fund", from: 1966, cost: 40000, housing: 18, cohesion: 5,
    blurb: "As History & Landmarks did on the North and South Sides (1966): old houses bought, mended and sold on to the families who live there — better housing without moving anyone out.",
    run: (g, w) => { upgradeHouses(g, w, 1); bump(g, "reputation", 3); } },
  { id: "rehab", name: "Rehab loans with the banks", from: 1968, cost: 30000, housing: 15, cohesion: 10, unrest: 0.02,
    blurb: "Neighborhood Housing Services began in the Central North Side (1968): a block club, sixteen lenders and a revolving fund that say 'fix the houses', not tear them down.",
    run: (g, w) => { upgradeHouses(g, w, 0.6); } },
  { id: "cdc", name: "Back a community development corporation", from: 1978, cost: 25000, cohesion: 15, unrest: 0.04, building: "hall",
    blurb: "A neighbourhood corporation for housing, storefronts and jobs: it slows the decline when the mills go (the Mon Valley's CDCs joined up in 1988). Morale +3.",
    run: (g) => { g.morale = Math.min(100, g.morale + 3); } },
];

const done = (w: Works, id: string) => !!w.hood?.[id];

/** mend the worst houses in the neighbourhood: shanties and boarding houses become ordinary houses */
function upgradeHouses(g: GameState, w: Works, share: number) {
  const m = g.map, W = g.world, [cx, cy] = centre(w);
  let n = 0;
  for (let y = cy - HOOD_R; y <= cy + HOOD_R; y++) for (let x = cx - HOOD_R; x <= cx + HOOD_R; x++) {
    if (!inBounds(m, x, y) || Math.hypot(x - cx, y - cy) > HOOD_R) continue;
    const i = y * m.width + x;
    if (W.use[i] < Use.Cottage || W.use[i] > Use.Rowhouses) continue;
    if ((W.sub[i] === HouseSub.Shanty || W.sub[i] === HouseSub.Boarding) && ((x * 31 + y * 17) % 100) / 100 < share) { W.sub[i] = HouseSub.Normal; W.built[i] = cal(g).year; n++; }
  }
  if (n) W.version++;
}

const centre = (w: Works): [number, number] => [w.x + (w.footprint >> 1), w.y + (w.footprint >> 1)];

/** a small park of a few lots near the works (playgrounds, parklets) */
function smallPark(g: GameState, w: Works, n: number): boolean {
  const m = g.map, W = g.world, [cx, cy] = centre(w);
  const cands: [number, number][] = [];
  for (let y = cy - HOOD_R; y <= cy + HOOD_R; y++) for (let x = cx - HOOD_R; x <= cx + HOOD_R; x++) {
    if (!inBounds(m, x, y)) continue;
    const d = Math.hypot(x - cx, y - cy);
    if (d < w.footprint / 2 + 3 || d > HOOD_R) continue;
    const i = y * m.width + x, u = W.use[i];
    if (m.terrain[i] === Terrain.Water || m.terrain[i] === Terrain.Cliff || W.street[i] || W.owner[i]) continue;
    if (u !== Use.Empty && u !== Use.Cottage && u !== Use.Houses) continue;
    cands.push([x, y]);
  }
  if (!cands.length) return false;
  // the emptiest lot nearest the works, then its neighbours
  cands.sort((a, b) => (W.pop[a[1] * m.width + a[0]] - W.pop[b[1] * m.width + b[0]]) * 0.2 + Math.hypot(a[0] - cx, a[1] - cy) - Math.hypot(b[0] - cx, b[1] - cy));
  const [sx, sy] = cands[0];
  let k = 0;
  for (const [x, y] of cands.filter(([x, y]) => Math.abs(x - sx) <= 2 && Math.abs(y - sy) <= 2).slice(0, n)) {
    const i = y * m.width + x;
    W.use[i] = Use.Park; W.pop[i] = 0; W.sub[i] = 0; k++;
  }
  W.version++;
  return k > 0;
}

/** put an investment's building up beside the works */
function build(g: GameState, w: Works, inv: Invest): boolean {
  if (!inv.building) return true;
  if (inv.building === "park") return smallPark(g, w, inv.id === "playground" ? 4 : 6);
  const [cx, cy] = centre(w);
  const off = (w.footprint >> 1) + 4;
  const name = `${w.name.replace(/ (Works|Company|Co\.)$/, "")} ${inv.building === "library" ? "Library and Baths" : inv.building === "hospital" ? "Hospital" : inv.id === "cdc" ? "Community Development Corp." : "Settlement House"}`;
  return placeLandmark(g, { id: `hood_${w.id}_${inv.id}`, name, kind: inv.building, place: w.name, tile: [cx + off, cy - 2], hospital: inv.building === "hospital" });
}

// ---------------------------------------------------------------- the measures

export interface HoodReport { health: number; housing: number; amenity: number; cohesion: number; land: number; people: number }

export function hoodReport(g: GameState, w: Works): HoodReport {
  const m = g.map, W = g.world, bg = blockGrid(m), [cx, cy] = centre(w);
  let pop = 0, hp = 0, homes = 0, land = 0, lots = 0, amen = 0, coh = 0, parks = 0, bad = 0;
  for (let y = cy - HOOD_R; y <= cy + HOOD_R; y++) for (let x = cx - HOOD_R; x <= cx + HOOD_R; x++) {
    if (!inBounds(m, x, y) || Math.hypot(x - cx, y - cy) > HOOD_R) continue;
    const i = y * m.width + x, u = W.use[i];
    if (W.pop[i]) { pop += W.pop[i]; hp += g.env.health[blockOf(bg, x, y)] * W.pop[i]; }
    if (u >= Use.Cottage && u <= Use.Rowhouses) { homes++; land += W.landValue[i]; lots++; if (W.sub[i] === HouseSub.Shanty || W.sub[i] === HouseSub.Boarding) bad++; }
    if (u === Use.Park) parks++;
    if (u === Use.Civic) { if (W.sub[i] === CivicSub.Library || W.sub[i] === CivicSub.School) amen += 4; else coh += W.sub[i] === CivicSub.Hall ? 3 : W.sub[i] === CivicSub.Firehouse ? 0 : 2; }
  }
  for (const l of g.landmarks) if (l.state === "open" && Math.hypot(l.x - cx, l.y - cy) <= HOOD_R && l.kind !== "factory" && l.kind !== "plant") amen += 8;
  let valley = 0, vn = 0;
  for (let i = 0; i < W.use.length; i += 7) if (W.use[i] >= Use.Cottage && W.use[i] <= Use.Rowhouses) { valley += W.landValue[i]; vn++; }
  const inv = (k: "housing" | "amenity" | "cohesion") => INVESTS.reduce((s, v) => s + (done(w, v.id) ? v[k] ?? 0 : 0), 0);
  const crowd = homes ? Math.max(0, Math.min(1, pop / homes / 50 - 0.3)) : 0;
  const cleared = Number(g.company?.biz.flags.uraCount ?? 0);
  const clamp = (v: number) => Math.round(Math.max(0, Math.min(100, v)));
  return {
    people: pop,
    health: clamp((pop ? hp / pop : 1) * 100),
    housing: clamp(70 - crowd * 60 - (lots ? (bad / lots) * 60 : 0) + inv("housing")),
    amenity: clamp(10 + Math.min(40, amen) + Math.min(20, parks * 2) + inv("amenity")),
    cohesion: clamp(15 + Math.min(45, coh) + inv("cohesion") - cleared * 15),
    land: clamp(lots && vn ? (land / lots) / (valley / vn) * 50 : 50),
  };
}

/** what the neighbourhoods' investments do to the valley model this year (read by updateHealth) */
export function hoodBoosts(g: GameState): { x: number; y: number; r: number; water: number; health: number; unrest: number }[] {
  const c = g.company;
  if (!c) return [];
  const out: { x: number; y: number; r: number; water: number; health: number; unrest: number }[] = [];
  for (const w of allWorks(c)) {
    if (!w.hood) continue;
    let water = 1, health = 0, unrest = 0;
    for (const v of INVESTS) if (done(w, v.id)) { water *= v.water ?? 1; health += v.health ?? 0; unrest += v.unrest ?? 0; }
    const [x, y] = centre(w);
    out.push({ x, y, r: HOOD_R + 4, water, health, unrest });
  }
  return out;
}

// ---------------------------------------------------------------- as actions (one action and the cost)

const worksArg = (g: GameState, arg?: string) => (arg ? allWorks(g.company!).find((w) => w.id === arg) : undefined) ?? g.company!;

export const HOOD_ACTIONS: ActionDef[] = INVESTS.map((v) => ({
  id: `hood_${v.id}`, group: "Neighbourhood" as const, name: v.name, blurb: v.blurb,
  cost: (g: GameState) => Math.round(v.cost * priceLevel(cal(g).year) / 100) * 100,
  blocked: (g: GameState, arg?: string) => {
    const y = cal(g).year, w = worksArg(g, arg);
    if (y < v.from) return `From ${v.from}`;
    if (v.until !== undefined && y > v.until) return `Not after ${v.until}`;
    if (done(w, v.id)) return "Already done here";
    return null;
  },
  run: (g: GameState, _rng, arg?: string) => {
    const w = worksArg(g, arg);
    const built = build(g, w, v);
    (w.hood ??= {})[v.id] = cal(g).year;
    const extra = v.run?.(g, w);
    return extra || (built ? `${v.name}: done by ${w.name}.` : `${v.name} by ${w.name} (no room for a new building: the money goes into the old ones).`);
  },
}));
