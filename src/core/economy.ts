// Economic connections of a works: where its raw materials come from, which utilities it draws on
// or supplies, and where its finished goods go — and who else is in the business.
// A display model built on the season's real numbers (output, input ratios, prices). Routes follow
// the rivers and the rail lines open that year; off-map trade enters and leaves at real gateways
// (the Ohio downriver, the Allegheny and Mon upriver, the Yough to Connellsville, the railroads east and west).

import { type GameState, PRICE_TREND, type RivalState, rivalOutput } from "./game";
import { latLonToTile } from "./features";
import { INDUSTRIES, type IndustryId } from "./industries";
import type { GameMap } from "./map";
import { RIVALS, type RivalDef } from "./rivals";
import { rivalTechs } from "./market";
import { navigable } from "./site";
import { Terrain } from "./terrain";
import { GATEWAYS as FREIGHT_GATEWAYS, type GatewayId as FreightGateway, type Lane, sourceRiver } from "./freight";
import type { Good } from "./industries";

// ---------------------------------------------------------------- types

export type FlowKind = "input" | "utilityIn" | "utilityOut" | "output";
export type Mode = "river" | "rail" | "wagon" | "pipe" | "wire" | "canal";

export interface Endpoint { x: number; y: number; name: string }

export interface Flow {
  id: string;
  kind: FlowKind;
  good: string;
  /** units per season (0 for utilities without a meaningful quantity) */
  qty: number;
  /** share of this works' inputs (by value) or of its output */
  share: number;
  /** approximate $ per season */
  value: number;
  from: Endpoint;
  to: Endpoint;
  mode: Mode;
  /** carrier, e.g. "Monongahela barges", "Pennsylvania Railroad" */
  via: string;
  /** supplier or customer */
  partner: string;
  /** set when the partner is a rival works on the map */
  rival?: string;
}

/** A works on the map: yours or a rival's. */
export interface WorksRef {
  industry: IndustryId;
  x: number; y: number; fp: number;
  techs: string[];
  /** units produced last season (or capacity for a works not yet running) */
  produced: number;
  name: string;
  rival?: string;
  /** last season's shipping lanes from the freight simulation (your works): the map shows these routes */
  lanes?: Lane[];
}

export type Relation = "competitor" | "supplier" | "customer" | "lender" | "other";

// ---------------------------------------------------------------- gateways

export type GatewayId = "ohio" | "allegheny" | "mon" | "yough" | "prrEast" | "ftWayne" | "pc" | "gasEast";
export interface Gateway { id: GatewayId; name: string; x: number; y: number }

const gatewayCache = new WeakMap<GameMap, Record<GatewayId, Gateway>>();
const navCache = new WeakMap<GameMap, Uint8Array>();
const nav = (m: GameMap) => { let n = navCache.get(m); if (!n) { n = navigable(m); navCache.set(m, n); } return n; };

/** Where a river or rail line leaves the map: the middle of a run of border tiles that pass a test,
 *  preferring long runs close to a hint point (a line can touch the border in more than one place). */
function borderExit(m: GameMap, test: (i: number) => boolean, hint: [number, number]): [number, number] | null {
  const W = m.width, H = m.height;
  const ring: [number, number][] = [];
  for (let x = 0; x < W; x++) ring.push([x, 0]);
  for (let y = 1; y < H; y++) ring.push([W - 1, y]);
  for (let x = W - 2; x >= 0; x--) ring.push([x, H - 1]);
  for (let y = H - 2; y > 0; y--) ring.push([0, y]);
  const runs: [number, number][][] = [];
  let run: [number, number][] = [];
  for (const p of ring) {
    if (test(p[1] * W + p[0])) run.push(p);
    else if (run.length) { runs.push(run); run = []; }
  }
  if (run.length) runs.push(run);
  let best: [number, number] | null = null, bs = -Infinity;
  for (const r of runs) {
    const mid = r[r.length >> 1];
    const s = Math.min(r.length, 12) * 20 - Math.hypot(mid[0] - hint[0], mid[1] - hint[1]);
    if (s > bs) { bs = s; best = mid; }
  }
  return best;
}

export function gateways(m: GameMap): Record<GatewayId, Gateway> {
  const hit = gatewayCache.get(m);
  if (hit) return hit;
  const waterId = (name: string) => Number(Object.entries(m.waterNames).find(([, n]) => n === name)?.[0] ?? -1);
  const railId = (name: string) => Number(Object.entries(m.railLines).find(([, l]) => l.name.startsWith(name))?.[0] ?? -1);
  const river = (name: string, fb: [number, number]) => { const id = waterId(name); return borderExit(m, (i) => m.water[i] === id, fb) ?? fb; };
  const rail = (name: string, fb: [number, number]) => { const id = railId(name); return borderExit(m, (i) => m.rail[i] === id, fb) ?? fb; };
  const W = m.width - 1, H = m.height - 1;
  const mk = (id: GatewayId, name: string, [x, y]: [number, number]): Gateway => ({ id, name, x, y });
  const g: Record<GatewayId, Gateway> = {
    ohio: mk("ohio", "Down the Ohio", river("Ohio River", [0, 100])),
    allegheny: mk("allegheny", "Up the Allegheny", river("Allegheny River", [330, 0])),
    mon: mk("mon", "Up the Monongahela", river("Monongahela River", [580, H])),
    yough: mk("yough", "Up the Youghiogheny", river("Youghiogheny River", [W, 607])),
    prrEast: mk("prrEast", "Pennsylvania Railroad east", rail("Pennsylvania Railroad", [W, 276])),
    ftWayne: mk("ftWayne", "Fort Wayne line west", rail("Ohio & Pennsylvania", [112, 0])),
    pc: mk("pc", "Pittsburgh & Connellsville RR", rail("Pittsburgh & Connellsville", [W, 604])),
    gasEast: mk("gasEast", "Murrysville gas field", [W, Math.round(m.height * 0.12)]),
  };
  gatewayCache.set(m, g);
  return g;
}

const railOpen = (m: GameMap, prefix: string, year: number) =>
  Object.values(m.railLines).some((l) => l.name.startsWith(prefix) && l.year <= year);

// ---------------------------------------------------------------- works

export function capacityOf(industry: IndustryId, techs: string[]): number {
  const ind = INDUSTRIES[industry];
  let cap = 0;
  for (const t of ind.tech) if (techs.includes(t.id)) cap += t.effects.capacity ?? 0;
  return Math.round(ind.baseCapacity * (1 + cap));
}


export function playerWorks(g: GameState): WorksRef | null {
  const c = g.company;
  if (!c) return null;
  return { industry: c.industry, x: c.x, y: c.y, fp: c.footprint, techs: c.techs, produced: c.lastSeason?.produced ?? capacityOf(c.industry, c.techs), name: c.name, lanes: c.freight?.lanes };
}

export function rivalWorks(g: GameState, r: RivalState): WorksRef {
  const def = RIVALS.find((d) => d.id === r.id)!;
  const techs = rivalTechs(def.industry, def.id, g.world.year, r.style);
  return { industry: def.industry, x: r.x, y: r.y, fp: r.footprint, techs, produced: rivalOutput(g, r), name: shortName(def), rival: r.id };
}

export const shortName = (d: RivalDef) => d.company.replace(/ \(.*\)$/, "");
const centre = (w: WorksRef): Endpoint => ({ x: w.x + w.fp / 2, y: w.y + w.fp / 2, name: w.name });
const gate = (gw: Gateway, name?: string): Endpoint => ({ x: gw.x + 0.5, y: gw.y + 0.5, name: name ?? gw.name });

/** How another industry relates to yours. */
export function relationOf(mine: IndustryId, theirs: IndustryId, rivalId?: string): Relation {
  if (rivalId === "mellon") return "lender"; // the bank, not a boatyard: it lends and finances
  if (rivalId === "frick") return mine === "steel" || mine === "power" ? "supplier" : "other"; // coke and coal
  if (mine === theirs) return "competitor";
  if (theirs === "power") return "supplier";
  if (mine === "power") return "customer";
  if (mine === "metalworks" && theirs === "steel") return "supplier";
  if (mine === "steel" && theirs === "metalworks") return "customer";
  return "other";
}

// ---------------------------------------------------------------- the model

const UNIT_PRICE: Record<string, number> = { "Iron ore": 3.2, Coal: 1.6, Coke: 3.4, Limestone: 1.2, Sand: 1.4, "Pig iron": 22, Uranium: 9 };

/** All economic links of a works in a given year. */
export function supplyChain(g: GameState, w: WorksRef): Flow[] {
  const m = g.map, year = g.world.year;
  const gw = gateways(m);
  const ind = INDUSTRIES[w.industry];
  const has = (t: string) => w.techs.includes(t);
  const me = centre(w);
  const out = Math.max(1, w.produced);
  const flows: Flow[] = [];
  const active = g.rivals.filter((r) => r.active).map((r) => ({ r, def: RIVALS.find((d) => d.id === r.id)! })).filter((x) => x.def && x.r.id !== w.rival);
  const prr = railOpen(m, "Pennsylvania Railroad", year);
  const ftw = railOpen(m, "Ohio & Pennsylvania", year);
  const pc = railOpen(m, "Pittsburgh & Connellsville", year);
  const kmTo = (x: number, y: number) => (Math.hypot(x - me.x, y - me.y) * m.metersPerTile) / 1000;

  // ---------------- raw materials
  const inputs: Omit<Flow, "share" | "value" | "id" | "kind">[] = [];
  const add = (f: Omit<Flow, "share" | "value" | "id" | "kind">) => inputs.push(f);
  // raw materials come the way the freight simulation ships them: by the river its gateway names (or by rail
  // when the river is full or the works has no landing); before founding, by the river the good comes down
  const FG: Record<FreightGateway, GatewayId> = { upper_mon: "mon", allegheny: "allegheny", ohio: "ohio" };
  const SOURCE: Record<string, { river: string; rail: string; partner: string }> = {
    coal: { river: "River pits up the Mon", rail: "Connellsville coal by rail", partner: "Coal operators up the Monongahela" },
    coke: { river: "Connellsville coke by the Mon", rail: "Connellsville coke ovens", partner: "Connellsville coke ovens" },
    ore: year < 1880 ? { river: "Allegheny valley ore banks", rail: "Juniata ore banks", partner: "Allegheny and Juniata ore banks" } : { river: "Lake Erie ore docks (via the Ohio)", rail: "Lake Erie ore docks", partner: "Lake Superior mines (Marquette, Mesabi)" },
    limestone: { river: "Allegheny valley quarries", rail: "Juniata limestone", partner: "Limestone quarries" },
    sand: { river: "Allegheny sand dredges", rail: "Juniata glass sand", partner: year >= 1880 ? "Glass-sand pits and river dredges" : "River sand dredges" },
    bauxite: { river: "Bauxite by the Ohio", rail: "Bauxite by rail", partner: year >= 1960 ? "Jamaica and Surinam bauxite" : "Arkansas bauxite (Bauxite, Ark.)" },
  };
  const rawLink = (good: Good, label: string, qty: number, key = good as string, partner?: string, rival?: string) => {
    const lane = w.lanes?.find((l) => l.good === good);
    const src = SOURCE[key];
    if (!lane || lane.mode === "river") {
      const gwF = lane?.gateway ?? sourceRiver(good, year);
      add({ good: label, qty: lane ? Math.round(lane.delivered) : qty, from: gate(gw[FG[gwF]], src.river), to: me, mode: "river", via: `${FREIGHT_GATEWAYS[gwF].name} barges`, partner: partner ?? src.partner, rival });
    } else {
      const railGate = good === "ore" ? (year < 1880 ? gw.prrEast : gw.ftWayne) : good === "coal" ? (pc ? gw.pc : gw.prrEast) : gw.prrEast;
      const via = good === "ore" && year >= 1879 ? "Pittsburgh & Lake Erie RR" : good === "coal" && pc ? "Pittsburgh & Connellsville RR" : prr ? "Pennsylvania Railroad" : "Railroad";
      add({ good: label, qty: Math.round(lane.delivered), from: gate(railGate, src.rail), to: me, mode: "rail", via, partner: partner ?? src.partner, rival });
    }
  };
  for (const [good, per] of Object.entries(ind.inputs)) {
    const qty = Math.round(out * (per ?? 0));
    if (good === "ore") rawLink("ore", "Iron ore", qty);
    else if (good === "coal" && w.industry === "steel" && has("coke_furnace") && !has("byproduct_coke")) {
      const frick = active.find((a) => a.def.id === "frick");
      rawLink("coal", "Coke", qty, "coke", frick ? "H. C. Frick Coke Co. (Connellsville)" : undefined, frick?.def.id);
    } else if (good === "coal" && w.industry === "power" && has("nuclear")) {
      add({ good: "Uranium", qty: Math.round(qty / 400), from: gate(gw.ftWayne, "Fuel fabricators"), to: me, mode: "rail", via: "Rail", partner: "Westinghouse nuclear fuel" });
    } else if (good === "coal" && w.industry === "glass" && has("gas_furnace")) {
      // the furnaces burn gas: shown as a utility below
    } else if (good === "coal") rawLink("coal", "Coal", qty);
    else if (good === "limestone") rawLink("limestone", "Limestone", qty);
    else if (good === "sand") rawLink("sand", "Sand", qty);
    else if (good === "bauxite") rawLink("bauxite", "Bauxite", qty);
    else if (good === "coke") rawLink("coke", "Coke-oven tar and light oil", qty, "coke", "By-product coke ovens");
    else if (good === "iron") {
      const mills = active.filter((a) => a.def.industry === "steel" && a.def.id !== "frick");
      mills.sort((a, b) => kmTo(a.r.x, a.r.y) - kmTo(b.r.x, b.r.y));
      const src = mills[0];
      if (src) add({ good: "Pig iron", qty, from: centre(rivalWorks(g, src.r)), to: me, mode: "river", via: "River barges", partner: shortName(src.def), rival: src.def.id });
      else add({ good: "Pig iron", qty, from: gate(gw.ohio, "Hanging Rock furnaces"), to: me, mode: "river", via: "Ohio River packets", partner: "Hanging Rock charcoal furnaces (Ohio)" });
    }
  }
  const inVal = inputs.reduce((s, f) => s + f.qty * (UNIT_PRICE[f.good] ?? 2), 0) || 1;
  inputs.forEach((f, k) => flows.push({ ...f, id: `in${k}`, kind: "input", value: Math.round(f.qty * (UNIT_PRICE[f.good] ?? 2)), share: (f.qty * (UNIT_PRICE[f.good] ?? 2)) / inVal }));

  // ---------------- utilities in
  const dock = nearestRiver(m, me.x, me.y);
  if (dock) flows.push({ id: "water", kind: "utilityIn", good: w.industry === "power" ? "Boiler & cooling water" : "Process water", qty: 0, share: 0, value: 0, from: { x: dock[0] + 0.5, y: dock[1] + 0.5, name: "River intake" }, to: me, mode: "pipe", via: "River intake", partner: m.waterNames[String(m.water[dock[1] * m.width + dock[0]])] ?? "River" });
  const gasYears = w.industry === "glass" ? year >= 1884 : year >= 1884 && year <= 1891;
  if (gasYears || (w.industry === "glass" && has("gas_furnace")))
    flows.push({ id: "gas", kind: "utilityIn", good: "Natural gas", qty: 0, share: 0, value: 0, from: gate(gw.gasEast), to: me, mode: "pipe", via: "Gas main", partner: year >= 1886 ? "Philadelphia Company (Westinghouse gas)" : "Murrysville wells" });
  if (w.industry !== "power" && year >= (w.industry === "glass" ? 1900 : 1890)) {
    const provider = g.company && g.company.industry === "power" && w.rival
      ? { name: g.company.name, at: centre(playerWorks(g)!), rival: undefined as string | undefined }
      : (() => {
        const wh = active.find((a) => a.def.industry === "power");
        if (wh) return { name: shortName(wh.def), at: centre(rivalWorks(g, wh.r)), rival: wh.def.id as string | undefined };
        return { name: year >= 1903 ? "Duquesne Light" : "Allegheny County Light Co.", at: { ...latLonToTileEp(m, 40.4419, -80.0036), name: year >= 1903 ? "Duquesne Light" : "Allegheny County Light Co." }, rival: undefined };
      })();
    flows.push({ id: "power", kind: "utilityIn", good: "Electricity", qty: 0, share: 0, value: 0, from: provider.at, to: me, mode: "wire", via: "Power lines", partner: provider.name, rival: provider.rival });
  }

  // ---------------- finished goods / utilities out
  const price = ind.basePrice * (1 + (year - 1850) * PRICE_TREND);
  const product = productName(w.industry, w.techs, year);
  const markets: { w: number; f: Omit<Flow, "share" | "value" | "id" | "kind" | "qty" | "good"> }[] = [];
  const mk = (weight: number, f: (typeof markets)[number]["f"]) => { if (weight > 0) markets.push({ w: weight, f }); };
  if (w.industry === "power") {
    const gasEra = !has("dc_dynamo");
    const reachKm = has("ac_system") ? 40 : has("dc_dynamo") ? 6 : has("gas_mains") ? 5 : 3;
    for (const lm of m.landmarks) {
      if (lm.kind !== "town" || kmTo(lm.x, lm.y) > reachKm) continue;
      mk(townWeight(g, lm.x, lm.y), { from: me, to: { x: lm.x + 0.5, y: lm.y + 0.5, name: lm.name }, mode: gasEra ? "pipe" : "wire", via: gasEra ? "Gas mains" : "Power lines", partner: `${lm.name} homes, shops and street lamps` });
    }
    if (!gasEra) for (const a of active) {
      if (kmTo(a.r.x, a.r.y) > reachKm) continue;
      mk(80, { from: me, to: centre(rivalWorks(g, a.r)), mode: "wire", via: "Power lines", partner: shortName(a.def), rival: a.def.id });
    }
    if (has("interconnect")) mk(150, { from: me, to: gate(gw.prrEast, "Regional grid"), mode: "wire", via: "High-voltage interconnect", partner: "Neighbouring utilities" });
    if (!markets.length) mk(1, { from: me, to: { x: me.x + 6, y: me.y, name: "Nearby streets" }, mode: gasEra ? "pipe" : "wire", via: gasEra ? "Gas mains" : "Power lines", partner: "Nearby streets" });
  } else {
    const local = (lat: number, lon: number, name: string): Endpoint => ({ ...latLonToTileEp(m, lat, lon), name });
    const downriver = { from: me, to: gate(gw.ohio, "Cincinnati, Louisville, St. Louis"), mode: "river" as Mode, via: "Ohio River packets and barges", partner: "Western river towns" };
    const east = { from: me, to: gate(gw.prrEast, "Philadelphia, New York"), mode: (prr ? "rail" : "canal") as Mode, via: prr ? "Pennsylvania Railroad" : "Main Line Canal", partner: "Eastern markets" };
    const west = { from: me, to: gate(gw.ftWayne, "Chicago and the West"), mode: "rail" as Mode, via: "Fort Wayne line", partner: "Western railroads" };
    const customers = (ids: IndustryId[], weight: number) => {
      for (const a of active) if (ids.includes(a.def.industry) && a.def.id !== "frick")
        mk(weight, { from: me, to: centre(rivalWorks(g, a.r)), mode: "river", via: "River barges", partner: shortName(a.def), rival: a.def.id });
    };
    if (w.industry === "steel") {
      mk(year < 1870 ? 45 : 20, downriver);
      mk(prr ? (has("bessemer") ? 30 : 20) : 8, east);
      if (ftw) mk(has("bessemer") ? 30 : 10, west);
      mk(15, { from: me, to: local(40.4406, -79.9959, "Pittsburgh foundries and machine shops"), mode: "wagon", via: "Drays", partner: "City foundries, nail and machine shops" });
      customers(["metalworks"], 12);
      if (year >= 1900 && year < 1983) mk(15, { from: me, to: gate(gw.ohio, "American Bridge, Ambridge"), mode: "river", via: "River barges", partner: "American Bridge Company" });
    } else if (w.industry === "glass") {
      mk(35, downriver);
      mk(prr ? 25 : 8, east);
      mk(20, { from: me, to: local(40.4406, -79.9959, "City builders and merchants"), mode: "wagon", via: "Drays", partner: "Builders and merchants (window glass)" });
      if (year >= 1869) {
        const northSide = year >= 1890;
        mk(has("pressed_glass") || has("bottle_machine") ? 20 : 8, northSide
          ? { from: me, to: local(40.4500, -79.9930, "H. J. Heinz works"), mode: "wagon", via: "Drays", partner: "H. J. Heinz Company (bottles)" }
          : { from: me, to: gate(gw.allegheny, "Heinz, Sharpsburg"), mode: "river", via: "Allegheny packets", partner: "Heinz, Noble & Co. (bottles)" });
      }
      if (year >= 1915 && ftw) mk(25, { ...west, to: gate(gw.ftWayne, "Detroit auto makers"), partner: "Auto makers (windshields)" });
    } else if (w.industry === "aluminium") {
      mk(30, east); if (ftw) mk(25, west);
      mk(20, { from: me, to: local(40.4406, -79.9959, "Pittsburgh fabricators and builders"), mode: "rail", via: "Rail", partner: year >= 1953 ? "Builders (curtain walls)" : "Cookware and wire makers" });
      if (year >= 1938) mk(year >= 1941 && year <= 1945 ? 60 : 15, { ...west, to: gate(gw.ftWayne, "Aircraft plants"), partner: "Aircraft makers" });
      if (has("cans")) mk(30, { from: me, to: local(40.4720, -79.9620, "Pittsburgh Brewing (Iron City)"), mode: "rail", via: "Rail", partner: "Brewers and canners" });
    } else if (w.industry === "chemicals") {
      mk(25, east); mk(20, downriver);
      mk(20, { from: me, to: local(40.4406, -79.9959, "Paint and coating makers"), mode: "rail", via: "Rail", partner: "PPG and the paint makers" });
      customers(["steel"], 10);
      if (has("synthetic_rubber")) mk(25, { ...west, to: gate(gw.ftWayne, "Akron tyre makers"), partner: "Rubber and tyre makers" });
    } else if (w.industry === "research" || w.industry === "nuclear") {
      customers(["steel", "glass", "power", "aluminium", "chemicals", "metalworks"], 6);
      mk(w.industry === "nuclear" ? 60 : 15, { ...east, to: gate(gw.prrEast, "Washington"), mode: "rail", via: "Contracts", partner: w.industry === "nuclear" ? "U.S. Navy and the Atomic Energy Commission" : "Federal research contracts" });
      if (w.industry === "nuclear" && has("pwr")) mk(30, { ...downriver, to: gate(gw.ohio, "Shippingport"), partner: "Duquesne Light and the utilities" });
    } else if (w.industry === "medicine") {
      for (const lm of m.landmarks) if (lm.kind === "town" && kmTo(lm.x, lm.y) < 15) mk(townWeight(g, lm.x, lm.y), { from: me, to: { x: lm.x + 0.5, y: lm.y + 0.5, name: lm.name }, mode: "wagon", via: "Patients and referrals", partner: `${lm.name} patients` });
      mk(15, { ...east, to: gate(gw.prrEast, "Washington"), mode: "rail", via: "Grants", partner: "National Institutes of Health" });
    } else {
      const war = year >= 1941 && year <= 1945;
      mk(war ? 70 : 45, { ...downriver, to: gate(gw.ohio, war ? "New Orleans (to the Navy)" : "Ohio & Mississippi trade"), partner: war ? "U.S. Navy (LSTs)" : "River packet lines" });
      mk(25, { from: me, to: gate(gw.mon, "Coal operators up the Mon"), mode: "river", via: "Towed upriver", partner: "Coal and towing companies" });
      if (has("machine_shop") || has("heavy_machinery")) customers(["steel"], 12);
    }
  }
  const tw = markets.reduce((s, x) => s + x.w, 0) || 1;
  markets.forEach((mkt, k) => {
    const share = mkt.w / tw;
    flows.push({ ...mkt.f, id: `out${k}`, kind: w.industry === "power" ? "utilityOut" : "output", good: product, qty: Math.round(out * share), share, value: Math.round(out * share * price) });
  });
  return flows;
}

function latLonToTileEp(m: GameMap, lat: number, lon: number) {
  const [x, y] = latLonToTile(m, lat, lon);
  return { x: Math.max(1, Math.min(m.width - 2, x)) + 0.5, y: Math.max(1, Math.min(m.height - 2, y)) + 0.5 };
}

function townWeight(g: GameState, x: number, y: number) {
  const m = g.map;
  let s = 0;
  for (let yy = y - 20; yy <= y + 20; yy += 2) for (let xx = x - 20; xx <= x + 20; xx += 2)
    if (xx >= 0 && yy >= 0 && xx < m.width && yy < m.height) s += g.world.pop[yy * m.width + xx];
  return Math.max(5, s / 100);
}

export function productName(ind: IndustryId, techs: string[], year: number): string {
  const has = (t: string) => techs.includes(t);
  switch (ind) {
    case "steel": return has("strip_mill") ? "Sheet & strip steel" : has("open_hearth") ? "Structural steel & plate" : has("bessemer") ? "Steel rail" : "Bar iron & nails";
    case "power": return has("dc_dynamo") ? "Electricity" : "Coal gas";
    case "aluminium": return has("cans") ? "Can sheet and ends" : has("curtain_wall") ? "Building panels and extrusions" : has("aircraft") ? "Aircraft alloys" : has("extrusion") ? "Extrusions and sheet" : "Aluminium ingot";
    case "chemicals": return has("plasticisers") ? "Plastics and plasticisers" : has("polyurethane") ? "Polyurethanes" : has("synthetic_rubber") ? "Styrene for synthetic rubber" : has("resins") ? "Resins and coal-tar chemicals" : "Tar, benzol and ammonia";
    case "research": return has("robotics") ? "Robotics and computing research" : has("campus") ? "Industrial research contracts" : "Industrial fellowships";
    case "nuclear": return has("pwr") ? "Reactors and fuel" : "Naval reactors";
    case "medicine": return has("transplant") ? "Transplants and specialist care" : has("vaccine") ? "Vaccines and hospital care" : "Hospital care";
    case "glass": return has("float_glass") ? "Float glass" : has("plate_glass") ? "Plate glass" : has("bottle_machine") ? "Machine-made bottles" : "Window glass & bottles";
    default: return year >= 1941 && year <= 1945 && has("welded_hulls") ? "Landing ships (LSTs)" : has("towboats") ? "Diesel towboats" : has("steel_barges") ? "Steel barges" : has("heavy_machinery") ? "Machinery & barges" : "Steamboats";
  }
}

function nearestRiver(m: GameMap, cx: number, cy: number): [number, number] | null {
  const nv = nav(m);
  let best: [number, number] | null = null, bd = Infinity;
  const R = 30;
  for (let y = Math.round(cy) - R; y <= Math.round(cy) + R; y++) for (let x = Math.round(cx) - R; x <= Math.round(cx) + R; x++) {
    if (x < 0 || y < 0 || x >= m.width || y >= m.height || !nv[y * m.width + x]) continue;
    const d = Math.hypot(x - cx, y - cy);
    if (d < bd) { bd = d; best = [x, y]; }
  }
  return best;
}

// ---------------------------------------------------------------- competitors

export interface Competitor {
  def: RivalDef;
  /** bought by you */
  owned?: boolean;
  relation: Relation;
  state?: RivalState;
  /** estimated output per season (0 if not yet open) */
  capacity: number;
  km?: number;
  near: string;
  product: string;
}

/** Every rival works, open or still to come, ranked by how much it matters to an industry. */
export function competitors(g: GameState, industry: IndustryId, from?: { x: number; y: number }): Competitor[] {
  const year = g.world.year;
  const order: Record<Relation, number> = { competitor: 0, supplier: 1, customer: 2, lender: 3, other: 4 };
  return RIVALS.map((def) => {
    const st = g.rivals.find((r) => r.id === def.id && r.active);
    const techs = rivalTechs(def.industry, def.id, year, st?.style);
    const at = st ? { x: st.x + st.footprint / 2, y: st.y + st.footprint / 2 } : g.map.landmarks.find((l) => l.name === def.site) ?? { x: 0, y: 0 };
    let near = def.site, nd = Infinity;
    for (const l of g.map.landmarks) if (l.kind === "town") { const d = Math.hypot(l.x - at.x, l.y - at.y); if (d < nd) { nd = d; near = l.name; } }
    return {
      def,
      owned: g.rivals.some((r) => r.id === def.id && r.owned),
      relation: relationOf(industry, def.industry, def.id),
      state: st,
      capacity: st && !st.closed ? rivalOutput(g, st) : 0,
      km: from ? (Math.hypot(at.x - from.x, at.y - from.y) * g.map.metersPerTile) / 1000 : undefined,
      near,
      product: def.id === "frick" ? "Connellsville coke" : def.id === "mellon" ? "Banking and loans" : productName(def.industry, techs, year),
    };
  }).sort((a, b) => order[a.relation] - order[b.relation] || (a.state ? 0 : 1) - (b.state ? 0 : 1) || a.def.entryYear - b.def.entryYear);
}

// ---------------------------------------------------------------- routes

const pathCache = new Map<string, [number, number][]>();

/** The route a flow takes on the map, in tile coordinates from source to destination. */
export function flowPath(g: GameState, f: Flow): [number, number][] {
  const m = g.map, year = g.world.year;
  const key = `${f.mode}|${f.from.x},${f.from.y}|${f.to.x},${f.to.y}|${f.mode === "rail" ? year : ""}`;
  const hit = pathCache.get(key);
  if (hit) return hit;
  let pts: [number, number][];
  const a: [number, number] = [f.from.x, f.from.y], b: [number, number] = [f.to.x, f.to.y];
  if (f.mode === "river") {
    const nv = nav(m);
    const s = nearestRiver(m, a[0], a[1]), t = nearestRiver(m, b[0], b[1]);
    const p = s && t ? findPath(m, (i) => (nv[i] ? 1 : Infinity), s, t) : null;
    pts = p ? [a, ...p.map(([x, y]) => [x + 0.5, y + 0.5] as [number, number]), b] : [a, b];
  } else if (f.mode === "rail" || f.mode === "wagon") {
    const rail = f.mode === "rail";
    const open = new Set(Object.entries(m.railLines).filter(([, l]) => l.year <= year).map(([k]) => Number(k)));
    const cost = (i: number) => {
      if (m.bridge[i]) return 2;
      if (m.terrain[i] === Terrain.Water) return Infinity;
      if (rail && m.rail[i] && open.has(m.rail[i])) return 1;
      if (g.world.street[i] || m.road[i]) return rail ? 6 : 2;
      return m.terrain[i] === Terrain.Steep || m.terrain[i] === Terrain.Cliff ? 30 : rail ? 14 : 6;
    };
    const p = findPath(m, cost, [Math.floor(a[0]), Math.floor(a[1])], [Math.floor(b[0]), Math.floor(b[1])]);
    pts = p ? [a, ...p.map(([x, y]) => [x + 0.5, y + 0.5] as [number, number]), b] : [a, b];
  } else {
    pts = [a, b];
  }
  pts = simplify(pts, 1.2);
  if (pathCache.size > 400) pathCache.clear();
  pathCache.set(key, pts);
  return pts;
}

/** A* over the tile grid (8-connected). */
function findPath(m: GameMap, cost: (i: number) => number, s: [number, number], t: [number, number]): [number, number][] | null {
  const W = m.width, N = W * m.height;
  const start = s[1] * W + s[0], goal = t[1] * W + t[0];
  if (start === goal) return [s];
  const dist = new Float32Array(N).fill(Infinity);
  const prev = new Int32Array(N).fill(-1);
  const heap: number[] = [], hk: number[] = [];
  const h = (i: number) => Math.hypot((i % W) - t[0], ((i / W) | 0) - t[1]);
  const push = (i: number, k: number) => {
    heap.push(i); hk.push(k);
    let n = heap.length - 1;
    while (n > 0) { const p = (n - 1) >> 1; if (hk[p] <= hk[n]) break; [heap[p], heap[n]] = [heap[n], heap[p]]; [hk[p], hk[n]] = [hk[n], hk[p]]; n = p; }
  };
  const pop = () => {
    const top = heap[0];
    const li = heap.pop()!, lk = hk.pop()!;
    if (heap.length) {
      heap[0] = li; hk[0] = lk;
      let n = 0;
      for (;;) {
        const l = 2 * n + 1, r = l + 1;
        let mn = n;
        if (l < heap.length && hk[l] < hk[mn]) mn = l;
        if (r < heap.length && hk[r] < hk[mn]) mn = r;
        if (mn === n) break;
        [heap[mn], heap[n]] = [heap[n], heap[mn]]; [hk[mn], hk[n]] = [hk[n], hk[mn]]; n = mn;
      }
    }
    return top;
  };
  dist[start] = 0;
  push(start, h(start));
  const closed = new Uint8Array(N);
  let steps = 0;
  while (heap.length) {
    const i = pop();
    if (closed[i]) continue;
    closed[i] = 1;
    if (i === goal) break;
    if (++steps > 400000) return null;
    const x = i % W, y = (i / W) | 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= m.height) continue;
      const j = ny * W + nx;
      const c = j === goal ? 1 : cost(j);
      if (!isFinite(c) || closed[j]) continue;
      const nd = dist[i] + c * (dx && dy ? 1.414 : 1);
      if (nd < dist[j]) { dist[j] = nd; prev[j] = i; push(j, nd + h(j)); }
    }
  }
  if (prev[goal] < 0) return null;
  const out: [number, number][] = [];
  for (let i = goal; i >= 0; i = prev[i]) out.push([i % W, (i / W) | 0]);
  return out.reverse();
}

/** Douglas–Peucker. */
function simplify(pts: [number, number][], eps: number): [number, number][] {
  if (pts.length < 3) return pts;
  const [ax, ay] = pts[0], [bx, by] = pts[pts.length - 1];
  const L = Math.hypot(bx - ax, by - ay) || 1;
  let k = -1, dmax = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const d = Math.abs((bx - ax) * (ay - pts[i][1]) - (ax - pts[i][0]) * (by - ay)) / L;
    if (d > dmax) { dmax = d; k = i; }
  }
  if (dmax <= eps) return [pts[0], pts[pts.length - 1]];
  return [...simplify(pts.slice(0, k + 1), eps).slice(0, -1), ...simplify(pts.slice(k), eps)];
}
