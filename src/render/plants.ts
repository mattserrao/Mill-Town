// Industrial plants: process-flow layouts, multi-tile buildings drawn as per-tile segments,
// technology stages, owner palettes and rival signatures.
//
// Layout coordinates: a = rows back from the river (0 = dock), b = position along the river.
// Long buildings run along b and are split into tile segments (start / middle / end / single)
// so painter's order stays correct while they read as one continuous building.

import type { RiverSide } from "../core/game";
import type { IndustryId } from "../core/industries";
import { tileNoise } from "../core/rng";
import { blob, box, type Box, chimney, cylinder, gable, lerp, Painter, shade, type Sprite } from "./sprites";
import { weather } from "./houses";

export type Seg = "s" | "m" | "e" | "1";
export type Ground = "yard" | "dock" | "spur" | "paved" | "grass";

export interface PlantTile {
  part: string;
  ground: Ground;
  seg?: Seg;
  axis?: "u" | "v";
  group?: number; // id of the long building this tile belongs to
}

export interface PlantCtx {
  ind: IndustryId;
  techs: string[];
  fp: number;
  side: RiverSide;
  owner: string; // "p" or rival id
  status: string;
  fill: number;  // 0..2 stockpile level
  /** the process being built (scaffolding and a crane go up at the back of the works) */
  research?: string;
  /** which expansion this is (0, 1, 2): each is a different kind of wing */
  wing?: number;
}

export interface Palette { wall: string; roof: string; trim: string; steel: string }

export const PALETTES: Record<string, Palette> = {
  p: { wall: "#8e3f2e", roof: "#3a3a42", trim: "#e0b050", steel: "#4a4a52" },
  jl: { wall: "#6a6e78", roof: "#3a3e48", trim: "#d0d0d0", steel: "#55585e" },
  carnegie: { wall: "#7a2e22", roof: "#2a2a30", trim: "#c9a24a", steel: "#3e3a3a" },
  frick: { wall: "#6e5a4a", roof: "#2e2a28", trim: "#a0805a", steel: "#4a4440" },
  westinghouse: { wall: "#b89a5a", roof: "#4a4038", trim: "#2e5a8a", steel: "#5a5a60" },
  ppg: { wall: "#8a8e7a", roof: "#2e4a3a", trim: "#e0e0d0", steel: "#4e5a52" },
  mellon: { wall: "#5e5248", roof: "#3a2e2a", trim: "#b0a080", steel: "#4a4642" },
  dravo: { wall: "#6a5a4a", roof: "#3a3a40", trim: "#3a5a8a", steel: "#3a5a8a" },
  alcoa: { wall: "#9aa0a8", roof: "#4a5058", trim: "#2a5a9a", steel: "#7a8088" },
  koppers: { wall: "#6a5040", roof: "#3a3430", trim: "#b8782a", steel: "#4a4440" },
  neville: { wall: "#7a6a5a", roof: "#3a3a3a", trim: "#9a3a2a", steel: "#505050" },
  mobay: { wall: "#a8a49a", roof: "#4a4e52", trim: "#2a7a4a", steel: "#6a6e72" },
  mellon_inst: { wall: "#c8bca0", roof: "#5a5448", trim: "#7a5a2a", steel: "#6a6460" },
  wresearch: { wall: "#b8a888", roof: "#4a4a50", trim: "#2e5a8a", steel: "#6a6a70" },
  bettis: { wall: "#a4a8ac", roof: "#5a5e64", trim: "#e0c040", steel: "#6a6e74" },
  astro: { wall: "#b0b4b8", roof: "#5a5e64", trim: "#3a6aa0", steel: "#6a6e74" },
  presby: { wall: "#b06a50", roof: "#4a4644", trim: "#e0d8c0", steel: "#6a6460" },
  uhc: { wall: "#c4b8a4", roof: "#4a4a4e", trim: "#2a4a7a", steel: "#6a6a70" },
};

const has = (c: PlantCtx, t: string) => c.techs.includes(t);

/** Local (a, b) -> footprint (lx, ly), and the global axis that b runs along. */
function orient(side: RiverSide, fp: number) {
  const toL = (a: number, b: number): [number, number] =>
    side === "N" ? [b, a] : side === "S" ? [b, fp - 1 - a] : side === "W" ? [a, b] : [fp - 1 - a, b];
  const axisB: "u" | "v" = side === "N" || side === "S" ? "u" : "v";
  const axisA: "u" | "v" = axisB === "u" ? "v" : "u";
  return { toL, axisB, axisA };
}

/** Full footprint layout, indexed ly * fp + lx. */
export function layoutPlant(c: PlantCtx): PlantTile[] {
  const fp = c.fp;
  const { toL, axisB, axisA } = orient(c.side, fp);
  const out: PlantTile[] = Array.from({ length: fp * fp }, () => ({ part: "", ground: "yard" as Ground }));
  let gid = 1;
  const set = (a: number, b: number, t: PlantTile) => {
    if (a < 0 || b < 0 || a >= fp || b >= fp) return;
    const [lx, ly] = toL(a, b);
    out[ly * fp + lx] = t;
  };
  /** a long building along b from b0..b1 on row a */
  const run = (a: number, b0: number, b1: number, part: string, ground: Ground = "yard") => {
    const g = gid++;
    for (let b = b0; b <= b1; b++) set(a, b, { part, ground, axis: axisB, group: g });
  };
  /** a long building along a (perpendicular to the river), e.g. slipways */
  const runA = (b: number, a0: number, a1: number, part: string, ground: Ground = "yard") => {
    const g = gid++;
    for (let a = a0; a <= a1; a++) set(a, b, { part, ground, axis: axisA, group: g });
  };
  const one = (a: number, b: number, part: string, ground: Ground = "yard") => set(a, b, { part, ground });

  switch (c.ind) {
    case "steel": {
      for (let b = 0; b < fp; b++) one(0, b, b % 3 === 1 ? (has(c, "open_hearth") ? "gantrycrane" : "derrick") : "bollards", "dock");
      if (has(c, "coke_furnace")) { run(1, 0, 3, "oreyard_bridge"); run(1, 4, fp - 1, "coalyard_bridge"); }
      else { for (let b = 0; b < fp; b++) one(1, b, b < fp / 2 ? "oreyard" : "coalyard"); }
      const big = has(c, "coke_furnace");
      const furnaceEvery = c.owner === "carnegie" ? 2 : 3;
      for (let b = 0; b < fp; b++) {
        const k = b % furnaceEvery;
        if (k === 1) one(2, b, big ? "furnace_iron" : "furnace_stone");
        else if (k === 2 && has(c, "hot_blast")) one(2, b, "stoves");
        else one(2, b, "casthouse");
      }
      // every melting process the works owns stands in its own shop: the newest takes most of the row
      const shops = (["puddle", "bessemer", "openhearth", "bof"] as const).filter((sh) => sh === "puddle" ? true : has(c, sh === "openhearth" ? "open_hearth" : sh));
      const newest = shops[shops.length - 1], older = shops.length > 1 ? shops[shops.length - 2] : null;
      if (older && fp >= 5) { const cut = Math.max(2, Math.floor(fp * 0.4)); run(3, 0, cut - 1, older); run(3, cut, fp - 1, newest); }
      else run(3, 0, fp - 1, newest);
      if (has(c, "continuous_cast")) { run(4, 0, fp - 1, "strip"); run(5, 0, fp - 1, "caster"); }
      else if (has(c, "strip_mill")) { run(4, 0, fp - 1, "strip"); run(5, 0, fp - 1, "rolling"); }
      else { run(4, 0, fp - 1, "rolling"); run(5, 0, fp - 1, "rolling2"); }
      const cokeHeavy = c.owner === "frick";
      // rail cars on the spur: more of them the harder the works runs
      const every = c.fill >= 2 ? 2 : c.fill >= 1 ? 3 : 0;
      for (let b = 0; b < fp; b++) set(6, b, { part: cokeHeavy || !every ? "" : b % every === 0 ? "hotmetalcar" : b % every === 1 && every === 3 ? "ingotcar" : every === 2 ? "ingotcar" : "", ground: "spur" });
      if (cokeHeavy) run(6, 0, fp - 1, has(c, "byproduct_coke") ? "cokebattery" : "cokeovens");
      one(7, 0, has(c, "automation") ? "control" : "office"); one(7, 1, "gate", "paved"); run(7, 2, 3, "stockyard"); one(7, 4, "stack");
      if (has(c, "coke_furnace") || cokeHeavy) run(7, 5, fp - 1, has(c, "byproduct_coke") ? "cokebattery" : "cokeovens");
      else run(7, 5, fp - 1, "warehouse");
      break;
    }
    case "glass": {
      for (let b = 0; b < fp; b++) one(0, b, b % 2 ? "derrick" : "bollards", "dock");
      for (let b = 0; b < fp; b++) one(1, b, b === 0 ? "batchhouse" : "sandyard");
      if (has(c, "float_glass")) { run(2, 0, fp - 1, "floatline"); run(3, 0, fp - 1, "floatline"); }
      else if (has(c, "gas_furnace")) {
        run(2, 0, fp - 1, has(c, "bottle_machine") ? "bottleplant" : "tankfurnace");
        run(3, 0, fp - 1, has(c, "plate_glass") ? "grinding" : "lehr");
      } else {
        for (let a = 2; a <= 3; a++) for (let b = 0; b < fp; b++) one(a, b, (a + b) % 2 === 0 ? "cone" : "glassshed");
      }
      one(fp - 1, 0, "office"); one(fp - 1, 1, "gate", "paved"); one(fp - 1, 2, "stack");
      run(fp - 1, 3, fp - 1, "warehouse");
      break;
    }
    case "power": {
      for (let b = 0; b < fp; b++) one(0, b, b % 2 ? "derrick" : "bollards", "dock");
      for (let b = 0; b < fp; b++) one(1, b, "coalyard");
      const electric = has(c, "dc_dynamo");
      if (has(c, "nuclear")) { one(2, 1, "containment"); run(2, 2, fp - 1, "turbinehall"); run(3, 0, fp - 1, "turbinehall"); }
      else if (has(c, "steam_turbine")) { run(2, 0, fp - 1, "boilerhouse"); run(3, 0, fp - 1, "turbinehall"); }
      else if (has(c, "ac_system")) { run(2, 0, fp - 1, "powerhouse"); for (let b = 0; b < fp; b++) one(3, b, b < 2 ? "gasholder" : "purifier"); }
      else if (electric) { run(2, 0, 2, "enginehouse"); run(2, 3, fp - 1, "retort"); for (let b = 0; b < fp; b++) one(3, b, b < 2 ? "purifier" : "gasholder"); }
      else { run(2, 0, fp - 1, "retort"); for (let b = 0; b < fp; b++) one(3, b, b < 2 ? "purifier" : has(c, "gas_mains") || b === 3 ? "gasholder" : ""); }
      one(fp - 1, 0, "office"); one(fp - 1, 1, "gate", "paved"); one(fp - 1, 2, "stack");
      for (let b = 3; b < fp; b++) one(fp - 1, b, electric ? (has(c, "interconnect") ? "switchyard" : "pylon") : "gasholder");
      break;
    }
    case "metalworks": {
      const hull = has(c, "steel_barges") || has(c, "welded_hulls") ? "steel" : has(c, "iron_hulls") ? "iron" : "wood";
      for (let b = 0; b < fp; b++) {
        if (b % 2 === 0) runA(b, 0, 1, `slip_${hull}`, "dock");
        else { one(0, b, has(c, "steel_barges") ? "gantrycrane" : "derrick", "dock"); one(1, b, hull === "wood" ? "lumber" : "platestack"); }
      }
      run(2, 0, fp - 1, has(c, "heavy_machinery") ? "heavyshop" : has(c, "machine_shop") ? "machineshop" : "sawmill");
      run(3, 0, 2, "foundry"); run(3, 3, fp - 1, hull === "wood" ? "sawmill" : "plateshop");
      for (let b = 0; b < fp; b++) set(4, b, { part: c.fill && b % (c.fill >= 2 ? 2 : 3) === 0 ? "ingotcar" : "", ground: "spur" });
      one(fp - 1, 0, "office"); one(fp - 1, 1, "gate", "paved"); one(fp - 1, 2, "stack");
      run(fp - 1, 3, fp - 1, "warehouse");
      break;
    }
    case "aluminium": {
      for (let b = 0; b < fp; b++) one(0, b, b % 2 ? "derrick" : "bollards", "dock");
      if (has(c, "bayer")) { run(1, 0, Math.min(2, fp - 1), "refinery_run"); for (let b = 3; b < fp; b++) one(1, b, "bauxiteyard"); }
      else for (let b = 0; b < fp; b++) one(1, b, "bauxiteyard");
      run(2, 0, fp - 1, "potline"); run(3, 0, fp - 1, "potline");
      if (fp > 5) {
        if (has(c, "cans")) run(4, 0, fp - 1, "sheetmill");
        else if (has(c, "extrusion")) { run(4, 0, 2, "sheetmill"); run(4, 3, fp - 1, "machineshop"); }
        else if (has(c, "sheet_mill")) run(4, 0, fp - 1, "sheetmill");
        else for (let b = 0; b < fp; b++) one(4, b, b % 2 ? "rectifier" : "");
      }
      one(fp - 1, 0, has(c, "automation") ? "control" : "office"); one(fp - 1, 1, "gate", "paved"); one(fp - 1, 2, "stack");
      for (let b = 3; b < fp; b++) one(fp - 1, b, "rectifier");
      break;
    }
    case "chemicals": {
      for (let b = 0; b < fp; b++) one(0, b, b % 2 ? "derrick" : "bollards", "dock");
      for (let b = 0; b < fp; b++) one(1, b, "tankfarm");
      run(2, 0, fp - 1, "tarstills");
      if (has(c, "polyurethane")) run(3, 0, fp - 1, "chemplant");
      else for (let b = 0; b < fp; b++) one(3, b, has(c, "synthetic_rubber") || has(c, "resins") ? (b % 2 ? "column" : "tankfarm") : "tankfarm");
      if (fp > 5) for (let b = 0; b < fp; b++) one(4, b, has(c, "plasticisers") || has(c, "activated_carbon") ? (b % 3 === 0 ? "column" : "tankfarm") : b % 2 ? "warehouse" : "");
      one(fp - 1, 0, has(c, "automation") ? "control" : "office"); one(fp - 1, 1, "gate", "paved"); one(fp - 1, 2, "stack");
      run(fp - 1, 3, fp - 1, "warehouse");
      break;
    }
    case "research": case "nuclear": case "medicine": {
      // campuses: buildings on lawns, no river landing
      for (let b = 0; b < fp; b++) one(0, b, "campus", "grass");
      const main = c.ind === "medicine" ? "hospitalwing" : c.ind === "nuclear" ? "reactorhall" : "labblock";
      if (c.ind === "nuclear") { one(1, 0, "containment", "grass"); run(1, 1, fp - 1, main); }
      else run(1, 0, fp - 1, main);
      const second = c.ind === "medicine" ? (has(c, "health_center") ? "medtower" : "hospitalwing")
        : c.ind === "nuclear" ? (has(c, "fuel") ? "fuelplant" : "labblock")
        : has(c, "campus") ? "labblock" : "";
      if (second) run(2, 0, fp - 1, second); else for (let b = 0; b < fp; b++) one(2, b, "campus", "grass");
      for (let b = 0; b < fp; b++) one(3, b, c.ind === "research" && has(c, "physics") && b === 1 ? "vandegraaff" : "campus", "grass");
      if (fp > 5) run(4, 0, fp - 1, c.ind === "medicine" ? "labblock" : c.ind === "nuclear" && has(c, "pwr") ? "reactorhall" : has(c, "computing") ? "labblock" : "campus");
      one(fp - 1, 0, "control"); one(fp - 1, 1, "gate", "paved");
      for (let b = 2; b < fp; b++) one(fp - 1, b, "carpark", "paved");
      break;
    }
  }
  // a process being built: scaffolding and a crane on two tiles at the back of the works
  if (c.research) {
    const back = c.ind === "steel" ? Math.min(7, fp - 1) : fp - 1;
    for (const b of [fp - 2, fp - 1]) set(back, b, { part: "construction", ground: "yard" });
  }
  return segments(out, fp);
}

/**
 * An expansion beside a works. Each one is a different wing, facing the same way: the first a new melting
 * (or main) shop, the second a finishing mill, the third the furnaces and yards that feed them. A stack stands
 * at one corner and rail cars on a spur when the works is busy.
 */
export function layoutAnnex(c: PlantCtx): PlantTile[] {
  const fp = c.fp;
  const { toL, axisB } = orient(c.side, fp);
  const out: PlantTile[] = Array.from({ length: fp * fp }, () => ({ part: "", ground: "yard" as Ground }));
  let gid = 1;
  const wing = (c.wing ?? 0) % 3;
  const shop = has(c, "bof") ? "bof" : has(c, "open_hearth") ? "openhearth" : has(c, "bessemer") ? "bessemer" : "puddle";
  const car = c.fill >= 1 ? "ingotcar" : "";
  // each row: a long building, or "tiles:" a row of single-tile parts repeating
  const WINGS: Record<IndustryId, string[][]> = {
    steel: [
      [shop, shop, "spur", "stockyard"],
      [has(c, "strip_mill") ? "strip" : "rolling", "rolling2", "spur", "warehouse"],
      ["tiles:furnace,stoves,casthouse", "tiles:oreyard,coalyard", "spur", "stockyard"],
    ],
    glass: [
      [has(c, "gas_furnace") ? (has(c, "bottle_machine") ? "bottleplant" : "tankfurnace") : "tiles:cone,glassshed", "lehr", "warehouse"],
      [has(c, "plate_glass") ? "grinding" : "lehr", has(c, "float_glass") ? "floatline" : "lehr", "warehouse"],
      ["tiles:batchhouse,sandyard", "tiles:sandyard", "warehouse"],
    ],
    power: [
      has(c, "steam_turbine") ? ["boilerhouse", "turbinehall", "tiles:coalyard"] : has(c, "dc_dynamo") ? ["powerhouse", "retort", "tiles:coalyard"] : ["retort", "tiles:purifier", "tiles:coalyard"],
      has(c, "dc_dynamo") ? ["tiles:switchyard", has(c, "interconnect") ? "tiles:pylon,switchyard" : "tiles:pylon", "warehouse"] : ["tiles:gasholder", "tiles:gasholder,purifier", "warehouse"],
      ["tiles:coalyard", has(c, "steam_turbine") ? "boilerhouse" : "retort", "warehouse"],
    ],
    metalworks: [
      [has(c, "heavy_machinery") ? "heavyshop" : has(c, "machine_shop") ? "machineshop" : "sawmill", "spur", "warehouse"],
      ["foundry", "plateshop", "spur"],
      ["tiles:platestack", "warehouse", "tiles:lumber,platestack"],
    ],
    aluminium: [["potline", "potline", "tiles:rectifier"], ["sheetmill", "spur", "warehouse"], ["tiles:bauxiteyard", "refinery_run", "warehouse"]],
    chemicals: [["tarstills", "tiles:tankfarm,column", "warehouse"], ["chemplant", "tiles:tankfarm", "spur"], ["tiles:column,tankfarm", "warehouse", "tiles:tankfarm"]],
    research: [["labblock", "tiles:campus", "tiles:carpark"], ["labblock", "labblock", "tiles:campus"], ["tiles:campus", "labblock", "tiles:carpark"]],
    nuclear: [["reactorhall", "tiles:campus", "labblock"], ["fuelplant", "tiles:carpark", "tiles:campus"], ["labblock", "tiles:campus", "tiles:carpark"]],
    medicine: [["hospitalwing", "tiles:campus", "tiles:carpark"], ["medtower", "tiles:campus", "labblock"], ["hospitalwing", "tiles:carpark", "tiles:campus"]],
  };
  const rows = WINGS[c.ind][wing];
  for (let a = 0; a < fp; a++) {
    const r = rows[a % rows.length];
    if (r === "spur") {
      for (let b = 0; b < fp; b++) { const [lx, ly] = toL(a, b); out[ly * fp + lx] = { part: car && b % (c.fill >= 2 ? 2 : 3) === 0 ? car : "", ground: "spur" }; }
    } else if (r.startsWith("tiles:")) {
      const parts = r.slice(6).split(",").map((x) => (x === "furnace" ? (has(c, "coke_furnace") ? "furnace_iron" : "furnace_stone") : x));
      for (let b = 0; b < fp; b++) { const [lx, ly] = toL(a, b); out[ly * fp + lx] = { part: parts[b % parts.length], ground: "yard" }; }
    } else {
      const g = gid++;
      for (let b = 0; b < fp; b++) { const [lx, ly] = toL(a, b); out[ly * fp + lx] = { part: r, ground: "yard", axis: axisB, group: g }; }
    }
  }
  // a stack at the far corner of the wing
  const [sx, sy] = toL(fp - 1, fp - 1);
  if (!out[sy * fp + sx].group) out[sy * fp + sx] = { part: "stack", ground: "yard" };
  return segments(out, fp);
}

function segments(out: PlantTile[], fp: number): PlantTile[] {
  // segment positions from global coordinates
  const groups = new Map<number, { idx: number[] }>();
  out.forEach((t, i) => { if (t.group) { const gr = groups.get(t.group) ?? { idx: [] }; gr.idx.push(i); groups.set(t.group, gr); } });
  for (const gr of groups.values()) {
    const key = (i: number) => (out[i].axis === "u" ? i % fp : Math.floor(i / fp));
    const ks = gr.idx.map(key);
    const lo = Math.min(...ks), hi = Math.max(...ks);
    for (const i of gr.idx) {
      const k = key(i);
      out[i].seg = lo === hi ? "1" : k === lo ? "s" : k === hi ? "e" : "m";
    }
  }
  return out;
}

export function plantKey(t: PlantTile, c: PlantCtx, soot: number, variant: number): string {
  const pal = PALETTES[c.owner] ? c.owner : "p";
  return `P|${t.part}|${pal}|${t.axis ?? "u"}|${t.seg ?? "1"}|${variant}|${c.fill}|${soot}|${c.status === "strike" && t.part === "gate" ? 1 : 0}`;
}

// ---------------------------------------------------------------- emitters for the animation layer
export interface Emitter { u: number; v: number; z: number; kind: "smoke" | "glow" | "flame" | "steam"; size: number }

export function emittersFor(part: string): Emitter[] {
  switch (part) {
    case "stack": return [{ u: 0.5, v: 0.5, z: 112, kind: "smoke", size: 1.7 }];
    case "furnace_iron": return [{ u: 0.5, v: 0.5, z: 82, kind: "smoke", size: 1 }, { u: 0.6, v: 0.75, z: 6, kind: "glow", size: 1 }];
    case "furnace_stone": return [{ u: 0.5, v: 0.5, z: 34, kind: "flame", size: 0.6 }, { u: 0.55, v: 0.7, z: 4, kind: "glow", size: 0.7 }];
    case "casthouse": return [{ u: 0.5, v: 0.6, z: 6, kind: "glow", size: 0.8 }];
    case "bessemer": return [{ u: 0.5, v: 0.5, z: 46, kind: "flame", size: 1.4 }];
    case "openhearth": return [{ u: 0.3, v: 0.5, z: 62, kind: "smoke", size: 0.9 }, { u: 0.7, v: 0.5, z: 62, kind: "smoke", size: 0.9 }, { u: 0.5, v: 0.6, z: 4, kind: "glow", size: 0.6 }];
    case "bof": return [{ u: 0.5, v: 0.5, z: 70, kind: "smoke", size: 1.6 }];
    case "puddle": return [{ u: 0.3, v: 0.5, z: 30, kind: "smoke", size: 0.5 }, { u: 0.75, v: 0.5, z: 30, kind: "smoke", size: 0.5 }, { u: 0.5, v: 0.6, z: 3, kind: "glow", size: 0.5 }];
    case "cokeovens": return [{ u: 0.5, v: 0.5, z: 10, kind: "smoke", size: 0.9 }, { u: 0.5, v: 0.62, z: 3, kind: "glow", size: 0.8 }];
    case "cokebattery": return [{ u: 0.5, v: 0.5, z: 40, kind: "steam", size: 1.2 }];
    case "cone": return [{ u: 0.5, v: 0.5, z: 74, kind: "smoke", size: 0.8 }, { u: 0.5, v: 0.8, z: 4, kind: "glow", size: 0.6 }];
    case "tankfurnace": return [{ u: 0.5, v: 0.5, z: 52, kind: "smoke", size: 0.8 }];
    case "retort": return [{ u: 0.5, v: 0.5, z: 40, kind: "smoke", size: 0.7 }, { u: 0.5, v: 0.65, z: 3, kind: "glow", size: 0.5 }];
    case "enginehouse": case "powerhouse": return [{ u: 0.5, v: 0.5, z: 78, kind: "smoke", size: 1.1 }];
    case "boilerhouse": return [{ u: 0.35, v: 0.5, z: 96, kind: "smoke", size: 1.1 }, { u: 0.75, v: 0.5, z: 96, kind: "smoke", size: 1.1 }];
    case "foundry": return [{ u: 0.7, v: 0.4, z: 52, kind: "smoke", size: 0.7 }, { u: 0.7, v: 0.45, z: 6, kind: "glow", size: 0.6 }];
    case "sawmill": return [{ u: 0.8, v: 0.4, z: 36, kind: "smoke", size: 0.5 }];
    case "containment": return [{ u: 0.5, v: 0.5, z: 60, kind: "steam", size: 1.6 }];
    case "potline": return [{ u: 0.3, v: 0.5, z: 22, kind: "steam", size: 0.6 }, { u: 0.7, v: 0.5, z: 22, kind: "steam", size: 0.6 }];
    case "tarstills": return [{ u: 0.5, v: 0.5, z: 30, kind: "smoke", size: 0.7 }];
    case "column": return [{ u: 0.5, v: 0.5, z: 70, kind: "steam", size: 0.6 }];
    case "refinery_run": return [{ u: 0.5, v: 0.5, z: 40, kind: "steam", size: 0.8 }];
  }
  return [];
}

// ---------------------------------------------------------------- drawing

/** A long building's segment on its tile. Cross-axis extent c0..c1, along the full tile. */
function seg(p: Painter, axis: "u" | "v", s: Seg, c0: number, c1: number, h: number, o: { wall: string; z0?: number; top?: string }) {
  const end = s === "e" || s === "1";
  const a0 = s === "s" || s === "1" ? 0.04 : 0, a1 = end ? 0.96 : 1;
  return axis === "u"
    ? box(p, a0, c0, a1, c1, h, { wall: o.wall, z0: o.z0, top: o.top, right: end, foundation: 2, fnd: "#5a524a" })
    : box(p, c0, a0, c1, a1, h, { wall: o.wall, z0: o.z0, top: o.top, left: end, foundation: 2, fnd: "#5a524a" });
}

function longFace(axis: "u" | "v"): "left" | "right" { return axis === "u" ? "left" : "right"; }

function winRow(p: Painter, b: Box, face: "left" | "right", n: number, z: number, h: number, col: string, frame?: string) {
  const a = face === "left" ? b.D(b.z0) : b.C(b.z0), c = face === "left" ? b.C(b.z0) : b.B(b.z0);
  for (let k = 0; k < n; k++) {
    const [x, y] = lerp(a, c, (k + 0.5) / n);
    p.px(x, y - z - h, col, 2, h);
    if (frame) p.px(x, y - z - h - 1, frame, 2, 1);
  }
}

function monitor(p: Painter, axis: "u" | "v", s: Seg, c0: number, c1: number, z: number, wall: string, roof: string) {
  const m = (c0 + c1) / 2, w = (c1 - c0) * 0.18;
  const mb = seg(p, axis, s, m - w, m + w, 5, { wall: "#c9b27a", z0: z });
  gable(p, mb, axis, 3, roof, undefined, s === "e" || s === "1");
  void wall;
}

function stackAt(p: Painter, u: number, v: number, z0: number, h: number, col: string, w = 0.07) {
  box(p, u - w, v - w, u + w, v + w, h, { wall: col, top: "#1a1818", z0 });
  for (let z = z0 + 16; z < z0 + h; z += 16) p.line(p.P(u - w, v + w, z), p.P(u + w, v + w, z), shade(col, 0.6));
}

function pile(p: Painter, u: number, v: number, size: number, pal: string[], seed: number) {
  const [x, y] = p.P(u, v);
  blob(p, x, y - 3 - size * 2, 10 + size * 6, 4 + size * 2.5, pal, (k) => tileNoise(seed, k, 9, 2));
}

function people(p: Painter, u0: number, v0: number, u1: number, v1: number, n: number, seed: number) {
  const cols = ["#2a2a2e", "#e8e4dc", "#4a3a2a", "#c8c0b0", "#2e3a4a", "#8a3a2a"];
  for (let k = 0; k < n; k++) {
    const u = u0 + tileNoise(seed, k, 1, 1) * (u1 - u0), v = v0 + tileNoise(seed, k, 2, 1) * (v1 - v0);
    const [x, y] = p.P(u, v);
    p.px(x, y - 5, cols[k % cols.length], 2, 4);
    p.px(x, y - 7, "#d8b090", 2, 2);
    p.px(x, y - 8, "#2a2420", 2, 1);
    if (k % 5 === 0) { p.px(x + 1, y - 9, "#5a4a3a", 1, 5); p.px(x - 1, y - 11, "#efe9da", 4, 3); } // placards
  }
}

export function buildPlant(key: string): Sprite {
  const [, part, palId, axisS, segS, varS, fillS, sootS, strikeS] = key.split("|");
  const pal = PALETTES[palId] ?? PALETTES.p;
  const axis = axisS as "u" | "v";
  const s = segS as Seg;
  const v = +varS, fill = +fillS;
  const p = new Painter(1, 240);
  const W = pal.wall, R = pal.roof;
  const lf = longFace(axis);
  const endT = s === "e" || s === "1";
  const coal = ["#141418", "#212227", "#2e3036", "#454952"], ore = ["#5a2e24", "#7a3e2c", "#94503a"], sand = ["#c8b88a", "#d8c89a", "#e8dcb0"];
  void ore;

  switch (part) {
    case "bollards": {
      for (let k = 0; k < 3; k++) { const [x, y] = p.P(0.2 + k * 0.3, 0.2 + k * 0.3); p.px(x, y - 3, "#2a2420", 2, 3); }
      break;
    }
    case "derrick": {
      // timber derrick: mast + boom + guy lines
      const base = p.P(0.5, 0.5), top = p.P(0.5, 0.5, 46), tip = p.P(0.95, 0.15, 34);
      p.line(base, top, "#6a4a2a"); p.line([base[0] + 1, base[1]], [top[0] + 1, top[1]], "#4a3420");
      p.line(p.P(0.5, 0.5, 4), tip, "#7a5a34");
      p.line(top, tip, "#3a3a3a");
      p.line(tip, [tip[0], tip[1] + 18], "#2a2a2a");
      p.px(tip[0] - 2, tip[1] + 18, "#4a3a2a", 5, 3);
      p.line(top, p.P(0.05, 0.9), "#5a5a5a"); p.line(top, p.P(0.9, 0.9), "#5a5a5a");
      break;
    }
    case "gantrycrane": {
      const legs: [number, number][] = [[0.15, 0.2], [0.85, 0.2], [0.15, 0.8], [0.85, 0.8]];
      for (const [u, vv] of legs) { const a = p.P(u, vv), b = p.P(u, vv, 40); p.line(a, b, pal.steel); p.line([a[0] + 1, a[1]], [b[0] + 1, b[1]], shade(pal.steel, 0.7)); }
      box(p, 0.1, 0.15, 0.9, 0.85, 4, { wall: pal.trim, z0: 40 });
      box(p, 0.4, 0.35, 0.6, 0.65, 6, { wall: "#3a3a40", z0: 44 });
      break;
    }
    case "oreyard": case "coalyard": case "oreyard_bridge": case "coalyard_bridge": case "sandyard": {
      const pl = part.startsWith("ore") ? ore : part.startsWith("sand") ? sand : coal;
      pile(p, 0.5, 0.5, fill, pl, v + part.length);
      if (part.endsWith("bridge")) {
        // ore bridge: traveling girder spanning the yard on two legs at the ends
        const z = 34;
        const g = seg(p, axis, s, 0.42, 0.58, 5, { wall: pal.steel, z0: z });
        for (let t = 0; t <= 1; t += 0.25) p.line(...(axis === "u" ? [p.P(t, 0.58, z), p.P(Math.min(1, t + 0.25), 0.58, z + 5)] : [p.P(0.58, t, z), p.P(0.58, Math.min(1, t + 0.25), z + 5)]) as [[number, number], [number, number]], shade(pal.steel, 1.3));
        if (s === "s" || s === "e" || s === "1") { const q = axis === "u" ? p.P(s === "s" ? 0.1 : 0.9, 0.5) : p.P(0.5, s === "s" ? 0.1 : 0.9); p.line(q, [q[0], q[1] - z], pal.steel); p.line([q[0] + 2, q[1]], [q[0] + 2, q[1] - z], shade(pal.steel, 0.7)); }
        if (s === "m") box(p, ...(axis === "u" ? [0.45, 0.4, 0.6, 0.6] : [0.4, 0.45, 0.6, 0.6]) as [number, number, number, number], 6, { wall: "#2e2e34", z0: z - 6 });
        void g;
      }
      break;
    }
    case "furnace_stone": {
      // cold-blast stone furnace: truncated pyramid against a bank, charging bridge, casting shed
      const b = box(p, 0.22, 0.22, 0.78, 0.78, 6, { wall: "#8a7e6a", foundation: 2 });
      void b;
      const t = 30;
      p.poly([p.P(0.22, 0.78, 6), p.P(0.78, 0.78, 6), p.P(0.65, 0.65, t), p.P(0.35, 0.65, t)], "#9a8e78");
      p.poly([p.P(0.78, 0.78, 6), p.P(0.78, 0.22, 6), p.P(0.65, 0.35, t), p.P(0.65, 0.65, t)], "#7a6e5a");
      p.poly([p.P(0.35, 0.35, t), p.P(0.65, 0.35, t), p.P(0.65, 0.65, t), p.P(0.35, 0.65, t)], "#2a2624");
      const arch = p.P(0.5, 0.78, 2); p.px(arch[0] - 2, arch[1] - 5, "#e07a2a", 4, 4); p.px(arch[0] - 1, arch[1] - 4, "#ffd36a", 2, 2);
      box(p, 0.0, 0.42, 0.35, 0.58, 3, { wall: "#6a4a2a", z0: 26 }); // charging bridge
      break;
    }
    case "furnace_iron": {
      box(p, 0.08, 0.08, 0.92, 0.92, 8, { wall: W, top: "#3e3836" });
      cylinder(p, 0.5, 0.5, 0.3, 8, 44, "#5d5450", "#2a2624");
      cylinder(p, 0.5, 0.5, 0.22, 52, 18, "#4a4240", "#1d1a19");
      cylinder(p, 0.5, 0.5, 0.12, 70, 8, "#3a3432", "#141212");
      // bustle pipe ring and downcomer
      for (let k = 0; k < 12; k++) { const a = (k / 12) * Math.PI * 2; if (Math.sin(a) + Math.cos(a) > -0.4) p.px(...p.P(0.5 + Math.cos(a) * 0.32, 0.5 + Math.sin(a) * 0.32, 22), "#2e2a2a", 2, 2); }
      p.line(p.P(0.5, 0.5, 78), p.P(0.9, 0.2, 60), "#3a3432"); p.line(p.P(0.9, 0.2, 60), p.P(0.9, 0.2, 10), "#3a3432");
      // skip hoist incline from the stockyard
      p.line(p.P(0.05, 0.05, 6), p.P(0.42, 0.42, 74), "#2e2a2a"); p.line(p.P(0.09, 0.05, 6), p.P(0.46, 0.42, 74), "#4a4442");
      const [x, y] = p.P(0.6, 0.92, 2); p.px(x, y - 5, "#f08a2a", 4, 3); p.px(x + 1, y - 4, "#ffd36a", 2, 1);
      break;
    }
    case "stoves": {
      box(p, 0.06, 0.06, 0.94, 0.94, 4, { wall: "#4d4643", top: "#3a3432" });
      for (const [u, vv] of [[0.28, 0.28], [0.72, 0.28], [0.28, 0.72], [0.72, 0.72]] as const) {
        cylinder(p, u, vv, 0.15, 4, 54, "#6a605a", "#3a3432");
        const [x, y] = p.P(u, vv, 58); p.px(x - 1, y - 2, "#4a4240", 3, 2);
      }
      break;
    }
    case "casthouse": {
      const b = box(p, 0.1, 0.12, 0.9, 0.88, 12, { wall: W, foundation: 2 });
      gable(p, b, "u", 5, R);
      winRow(p, b, "left", 3, 2, 4, "#e07a2a");
      break;
    }
    case "puddle": case "bessemer": case "openhearth": case "bof": case "rolling": case "rolling2": case "strip": case "caster": case "warehouse":
    case "glassshed": case "tankfurnace": case "lehr": case "grinding": case "bottleplant": case "floatline":
    case "retort": case "enginehouse": case "powerhouse": case "boilerhouse": case "turbinehall":
    case "sawmill": case "machineshop": case "heavyshop": case "foundry": case "plateshop":
    case "potline": case "sheetmill": case "tarstills": case "chemplant": case "labblock": case "reactorhall": case "fuelplant": case "hospitalwing": case "medtower": case "refinery_run": {
      // ---- long buildings
      const spec: Record<string, { c: [number, number]; h: number; roof: "gable" | "monitor" | "flat" | "saw"; wall?: string; win?: number }> = {
        puddle: { c: [0.12, 0.88], h: 14, roof: "gable" },
        bessemer: { c: [0.08, 0.92], h: 30, roof: "monitor" },
        openhearth: { c: [0.08, 0.92], h: 28, roof: "monitor" },
        bof: { c: [0.05, 0.95], h: 46, roof: "flat", wall: "#7a7a80" },
        rolling: { c: [0.06, 0.48], h: 22, roof: "monitor" },
        rolling2: { c: [0.54, 0.94], h: 18, roof: "gable" },
        strip: { c: [0.04, 0.96], h: 16, roof: "saw", wall: "#8a8a8e" },
        caster: { c: [0.1, 0.9], h: 20, roof: "flat", wall: "#8e9298" },
        warehouse: { c: [0.15, 0.85], h: 16, roof: "gable" },
        glassshed: { c: [0.15, 0.85], h: 12, roof: "gable" },
        tankfurnace: { c: [0.12, 0.88], h: 20, roof: "monitor" },
        lehr: { c: [0.25, 0.75], h: 9, roof: "gable" },
        grinding: { c: [0.06, 0.94], h: 16, roof: "saw" },
        bottleplant: { c: [0.06, 0.94], h: 18, roof: "flat", wall: "#b8a888" },
        floatline: { c: [0.06, 0.94], h: 14, roof: "flat", wall: "#9aa0a6" },
        retort: { c: [0.12, 0.88], h: 18, roof: "gable" },
        enginehouse: { c: [0.15, 0.85], h: 22, roof: "gable", win: 1 },
        powerhouse: { c: [0.08, 0.92], h: 34, roof: "monitor", win: 1 },
        boilerhouse: { c: [0.1, 0.9], h: 30, roof: "flat" },
        turbinehall: { c: [0.06, 0.94], h: 32, roof: "monitor", wall: shade(W, 1.25), win: 1 },
        sawmill: { c: [0.15, 0.85], h: 12, roof: "gable", wall: "#8a6a48" },
        machineshop: { c: [0.08, 0.92], h: 20, roof: "saw" },
        heavyshop: { c: [0.05, 0.95], h: 30, roof: "monitor" },
        foundry: { c: [0.1, 0.9], h: 16, roof: "gable" },
        plateshop: { c: [0.08, 0.92], h: 18, roof: "saw" },
        potline: { c: [0.1, 0.9], h: 14, roof: "monitor", wall: "#8a8e94" },
        sheetmill: { c: [0.06, 0.94], h: 20, roof: "saw", wall: "#9a9ea4" },
        refinery_run: { c: [0.15, 0.85], h: 24, roof: "flat", wall: "#b0a898" },
        tarstills: { c: [0.15, 0.85], h: 12, roof: "flat", wall: "#4a4440" },
        chemplant: { c: [0.1, 0.9], h: 22, roof: "flat", wall: "#a8a49a" },
        labblock: { c: [0.15, 0.85], h: 26, roof: "flat", wall: "#b8b4aa", win: 1 },
        reactorhall: { c: [0.08, 0.92], h: 40, roof: "flat", wall: "#a4a8ac" },
        fuelplant: { c: [0.12, 0.88], h: 16, roof: "flat", wall: "#9aa0a6" },
        hospitalwing: { c: [0.15, 0.85], h: 44, roof: "flat", wall: "#b06a50", win: 1 },
        medtower: { c: [0.2, 0.8], h: 72, roof: "flat", wall: "#c8c4bc", win: 1 },
      };
      const sp = spec[part];
      const wall = sp.wall ?? W;
      const b = seg(p, axis, s, sp.c[0], sp.c[1], sp.h, { wall, top: sp.roof === "flat" ? R : undefined });
      const tall = sp.win ? 10 : 4;
      winRow(p, b, lf, 4, 4, Math.min(tall, sp.h - 8), part === "bessemer" || part === "openhearth" || part === "puddle" || part === "foundry" ? "#c06a2a" : "#2a2426", pal.trim);
      if (sp.h > 24 && !sp.win) winRow(p, b, lf, 4, sp.h - 9, 3, "#2a2426");
      if (endT) winRow(p, b, lf === "left" ? "right" : "left", 2, 4, Math.min(tall, sp.h - 8), "#2a2426");
      if (sp.roof === "gable") gable(p, b, axis, 6, R, undefined, endT);
      else if (sp.roof === "monitor") { gable(p, b, axis, 6, R, undefined, endT); monitor(p, axis, s, sp.c[0], sp.c[1], sp.h + 3, wall, R); }
      else if (sp.roof === "saw") {
        for (let k = 0; k < 3; k++) {
          const a0 = k / 3, a1 = (k + 1) / 3;
          const r = axis === "u" ? box(p, a0, sp.c[0], a1, sp.c[1], 0.1, { wall, z0: sp.h, left: false, right: false }) : box(p, sp.c[0], a0, sp.c[1], a1, 0.1, { wall, z0: sp.h, left: false, right: false });
          const top = sp.h;
          if (axis === "u") { p.poly([r.A(top), r.D(top), p.P(a1, sp.c[1], top + 6), p.P(a1, sp.c[0], top + 6)], shade(R, 1.1)); p.poly([p.P(a1, sp.c[0], top), p.P(a1, sp.c[1], top), p.P(a1, sp.c[1], top + 6), p.P(a1, sp.c[0], top + 6)], "#9ab0c0"); }
          else { p.poly([r.A(top), r.B(top), p.P(sp.c[1], a1, top + 6), p.P(sp.c[0], a1, top + 6)], shade(R, 0.9)); p.poly([p.P(sp.c[0], a1, top), p.P(sp.c[1], a1, top), p.P(sp.c[1], a1, top + 6), p.P(sp.c[0], a1, top + 6)], "#9ab0c0"); }
        }
      }
      // tall office-like blocks: a window band on every floor
      if (part === "labblock" || part === "hospitalwing" || part === "medtower") for (let z = 12; z < sp.h - 4; z += 8) winRow(p, b, lf, 5, z, 3, part === "labblock" ? "#9ab4c8" : "#2a2426", part === "labblock" ? undefined : pal.trim);
      // part-specific dressing
      const mid = (sp.c[0] + sp.c[1]) / 2;
      const at = (t: number, c: number, z: number) => (axis === "u" ? p.P(t, c, z) : p.P(c, t, z));
      if (part === "puddle") for (const t of [0.25, 0.75]) { const [u, vv] = axis === "u" ? [t, mid] : [mid, t]; stackAt(p, u, vv, 18, 14, "#5a524c", 0.04); }
      if (part === "openhearth") for (const t of [0.3, 0.7]) { const [u, vv] = axis === "u" ? [t, mid] : [mid, t]; stackAt(p, u, vv, 26, 36, shade(W, 0.9), 0.05); }
      if (part === "bessemer" && (s === "m" || s === "1")) {
        // converter tipped toward the open side with a flame
        const [x, y] = at(0.5, sp.c[1], 10);
        p.px(x - 3, y - 10, "#3a3432", 6, 9); p.px(x - 2, y - 12, "#3a3432", 4, 2);
        p.px(x - 2, y - 18, "#f0a030", 4, 6); p.px(x - 1, y - 22, "#ffe070", 2, 5);
      }
      if (part === "bof") { const [u, vv] = axis === "u" ? [0.5, mid] : [mid, 0.5]; if (s === "m" || s === "1") stackAt(p, u, vv, 46, 30, "#8a8a8e", 0.08); }
      if (part === "tankfurnace") for (const t of [0.3, 0.7]) { const [u, vv] = axis === "u" ? [t, mid] : [mid, t]; stackAt(p, u, vv, 20, 32, shade(W, 0.85), 0.05); }
      if (part === "retort") for (const t of [0.2, 0.5, 0.8]) chimney(p, ...(axis === "u" ? [t, mid] : [mid, t]) as [number, number], 24, 16, "#6a5a52");
      if (part === "enginehouse" || part === "powerhouse") { const [u, vv] = axis === "u" ? [0.5, mid] : [mid, 0.5]; if (s === "e" || s === "1") stackAt(p, u, vv, 0, 78, shade(W, 0.85), 0.07); }
      if (part === "boilerhouse") for (const t of [0.35, 0.75]) { const [u, vv] = axis === "u" ? [t, mid] : [mid, t]; stackAt(p, u, vv, 30, 66, "#8a8070", 0.06); }
      if (part === "foundry") { cylinder(p, 0.7, 0.4, 0.07, 16, 34, "#4a4240", "#141212"); const [x, y] = p.P(0.7, 0.48, 4); p.px(x - 1, y - 3, "#f08a2a", 3, 2); }
      if (part === "sawmill") { for (let k = 0; k < 4; k++) { const [x, y] = at(0.2 + k * 0.2, sp.c[1] + 0.06, 0); p.px(x - 4, y - 2, "#8a6a3a", 8, 2); } stackAt(p, 0.8, 0.4, 12, 22, "#7a6a5a", 0.03); }
      if (part === "caster" && (s === "s" || s === "1")) { const [u, vv] = axis === "u" ? [0.3, mid] : [mid, 0.3]; box(p, u - 0.14, vv - 0.14, u + 0.14, vv + 0.14, 24, { wall: "#6e7278", top: "#4a4e54", z0: 20 }); const q = at(0.3, sp.c[1], 26); p.px(q[0] - 2, q[1] - 4, "#f0a040", 4, 3); } // ladle turret
      if (part === "refinery_run") for (const t of [0.25, 0.75]) { const [u, vv] = axis === "u" ? [t, mid] : [mid, t]; cylinder(p, u, vv, 0.12, 24, 18, "#c8c0b0", "#9a9284"); }
      if (part === "tarstills") for (const t of [0.2, 0.5, 0.8]) chimney(p, ...(axis === "u" ? [t, mid] : [mid, t]) as [number, number], 12, 18, "#3a3430");
      if (part === "chemplant") for (let k = 0; k < 3; k++) { const q = at(0.2 + k * 0.3, sp.c[1] + 0.04, 8); p.px(q[0] - 3, q[1], "#8a8478", 6, 2); }
      if (part === "heavyshop" && (s === "m")) { const q = at(0.5, mid, sp.h + 2); p.px(q[0] - 6, q[1] - 2, pal.trim, 12, 2); }
      break;
    }
    case "cokeovens": {
      // beehive ovens: a bank of brick humps, each with a glowing door
      const b = seg(p, axis, s, 0.2, 0.8, 4, { wall: "#7a4a36" });
      for (let k = 0; k < 4; k++) {
        const t = (k + 0.5) / 4;
        const [x, y] = axis === "u" ? p.P(t, 0.5, 4) : p.P(0.5, t, 4);
        blob(p, x, y - 3, 5, 3.5, ["#5a3426", "#7a4a36", "#9a5e44"], (j) => tileNoise(k, j, v, 7));
        const [dx, dy] = axis === "u" ? p.P(t, 0.8, 2) : p.P(0.8, t, 2);
        p.px(dx - 1, dy - 3, "#f08a2a", 2, 2);
      }
      void b;
      break;
    }
    case "cokebattery": {
      const b = seg(p, axis, s, 0.2, 0.8, 22, { wall: "#6a5a52", top: "#3a3432" });
      winRow(p, b, lf, 6, 2, 16, "#3a2a24");
      if (s === "e" || s === "1") { const [u, vv] = axis === "u" ? [0.85, 0.5] : [0.5, 0.85]; stackAt(p, u, vv, 0, 70, "#7a6a60", 0.06); }
      if (s === "s") { const q = box(p, 0.3, 0.3, 0.7, 0.7, 40, { wall: "#8a8278", top: "#5a5450" }); void q; } // quench tower
      break;
    }
    case "cone": {
      box(p, 0.05, 0.05, 0.95, 0.95, 6, { wall: W, top: "#4a3e38" });
      for (let k = 0; k < 22; k++) cylinder(p, 0.5, 0.5, 0.44 - k * 0.016, 6 + k * 3, 3, k % 4 === 0 ? shade(W, 0.85) : W, shade(W, 0.7));
      cylinder(p, 0.5, 0.5, 0.1, 72, 6, shade(W, 0.7), "#141212");
      const [x, y] = p.P(0.5, 0.92, 0); p.px(x - 2, y - 7, "#1a1414", 4, 7); p.px(x - 1, y - 5, "#f0a040", 2, 3);
      break;
    }
    case "batchhouse": {
      const b = box(p, 0.15, 0.15, 0.85, 0.85, 22, { wall: W, foundation: 2 });
      gable(p, b, "u", 6, R);
      winRow(p, b, "left", 3, 6, 4, "#2a2426");
      cylinder(p, 0.7, 0.3, 0.1, 22, 14, "#9a9a9e", "#6a6a70"); // hopper
      break;
    }
    case "gasholder": {
      const r = 0.4, h = 18 + fill * 8;
      cylinder(p, 0.5, 0.5, r, 0, h, "#6a7a72", "#5a665f");
      for (let k = 0; k < 10; k++) {
        const a = (k / 10) * Math.PI * 2;
        const u = 0.5 + Math.cos(a) * (r + 0.03), vv = 0.5 + Math.sin(a) * (r + 0.03);
        if (Math.sin(a) + Math.cos(a) > -0.6) p.line(p.P(u, vv, 0), p.P(u, vv, 44), pal.steel);
      }
      for (const z of [22, 44]) for (let k = 0; k < 24; k++) { const a = (k / 24) * Math.PI * 2; if (Math.sin(a) + Math.cos(a) > -0.6) p.px(...p.P(0.5 + Math.cos(a) * (r + 0.03), 0.5 + Math.sin(a) * (r + 0.03), z), pal.steel, 1, 1); }
      break;
    }
    case "purifier": {
      for (const [u0, v0] of [[0.1, 0.1], [0.55, 0.1], [0.1, 0.55], [0.55, 0.55]] as const) box(p, u0, v0, u0 + 0.35, v0 + 0.35, 5, { wall: "#6a6258", top: "#4a5a52" });
      break;
    }
    case "containment": {
      cylinder(p, 0.5, 0.5, 0.42, 0, 30, "#d8d8d4", "#c8c8c4");
      for (let k = 0; k < 8; k++) cylinder(p, 0.5, 0.5, 0.42 * Math.cos((k / 8) * Math.PI / 2), 30 + k * 3, 3, "#e4e4e0", "#d0d0cc");
      break;
    }
    case "switchyard": case "pylon": {
      const towers: [number, number][] = part === "pylon" ? [[0.5, 0.5]] : [[0.25, 0.25], [0.75, 0.25], [0.25, 0.75], [0.75, 0.75]];
      for (const [u, vv] of towers) {
        const h = part === "pylon" ? 52 : 30;
        const a = p.P(u - 0.06, vv), b = p.P(u + 0.06, vv), t = p.P(u, vv, h);
        p.line(a, t, "#5a5e66"); p.line(b, t, "#5a5e66");
        for (let z = 8; z < h; z += 8) p.line(p.P(u - 0.05, vv, z - 6), p.P(u + 0.05, vv, z), "#7a7e86");
        p.line(p.P(u - 0.14, vv, h - 6), p.P(u + 0.14, vv, h - 6), "#5a5e66");
        p.px(t[0] - 6, t[1] + 5, "#c8c8c0", 1, 2); p.px(t[0] + 6, t[1] + 5, "#c8c8c0", 1, 2);
      }
      if (part === "switchyard") for (let k = 0; k < 3; k++) box(p, 0.2 + k * 0.22, 0.45, 0.32 + k * 0.22, 0.57, 7, { wall: "#6a7078", top: "#8a9098" });
      break;
    }
    case "slip_wood": case "slip_iron": case "slip_steel": {
      // inclined ways running down to the river, with a hull on the stocks
      const hullCol = part === "slip_wood" ? "#7a5a3a" : part === "slip_iron" ? "#3a3a3e" : "#5a6068";
      for (let t = 0.1; t <= 0.9; t += 0.2) { const q = axis === "u" ? p.P(0.5, t, 0) : p.P(t, 0.5, 0); p.px(q[0] - 3, q[1] - 1, "#5a4a32", 6, 1); }
      const hb = axis === "u" ? box(p, s === "s" ? 0.1 : 0, 0.32, s === "e" ? 0.85 : 1, 0.68, 10, { wall: hullCol, top: "#8a7a5a", right: endT, z0: 3 }) : box(p, 0.32, s === "s" ? 0.1 : 0, 0.68, s === "e" ? 0.85 : 1, 10, { wall: hullCol, top: "#8a7a5a", left: endT, z0: 3 });
      for (let k = 0; k < 4; k++) { const t = (k + 0.5) / 4; const q = axis === "u" ? p.P(t, 0.3, 0) : p.P(0.3, t, 0); p.line(q, [q[0], q[1] - 10], "#6a5030"); }
      if (part !== "slip_wood") for (let k = 0; k < 5; k++) p.px(...lerp(axis === "u" ? hb.D(9) : hb.C(9), axis === "u" ? hb.C(9) : hb.B(9), k / 5), "#8a8a90", 1, 1);
      break;
    }
    case "lumber": {
      for (let k = 0; k < 3; k++) box(p, 0.12 + k * 0.27, 0.2, 0.32 + k * 0.27, 0.8, 6 + (k + fill) * 2, { wall: "#b08a5a", top: "#c9a46e" });
      break;
    }
    case "platestack": case "stockyard": {
      const n = part === "stockyard" ? 4 : 3;
      for (let k = 0; k < n; k++) {
        const b = axis === "u" ? box(p, 0.1, 0.12 + k * 0.2, 0.9, 0.24 + k * 0.2, 3 + fill * 2, { wall: "#5a5a60", top: "#7a7a82" }) : box(p, 0.12 + k * 0.2, 0.1, 0.24 + k * 0.2, 0.9, 3 + fill * 2, { wall: "#5a5a60", top: "#7a7a82" });
        void b;
      }
      break;
    }
    case "hotmetalcar": case "ingotcar": {
      const [u0, u1] = [0.3, 0.7];
      const b = axis === "u" ? box(p, u0, 0.4, u1, 0.6, 3, { wall: "#2a2a2e", top: "#3a3a40" }) : box(p, 0.4, u0, 0.6, u1, 3, { wall: "#2a2a2e", top: "#3a3a40" });
      void b;
      if (part === "hotmetalcar") { cylinder(p, 0.5, 0.5, 0.1, 3, 8, "#3a3432", "#e07a2a"); }
      else for (let k = 0; k < 3; k++) { const q = axis === "u" ? p.P(0.36 + k * 0.12, 0.5, 4) : p.P(0.5, 0.36 + k * 0.12, 4); p.px(q[0], q[1] - 6, "#3a3432", 2, 6); }
      break;
    }
    case "office": {
      const b = box(p, 0.15, 0.2, 0.85, 0.8, 20, { wall: W, foundation: 2 });
      const top = 20;
      const um = 0.5, vm = 0.5;
      p.poly([b.D(top), b.C(top), p.P(um + 0.2, vm, top + 7), p.P(um - 0.2, vm, top + 7)], R);
      p.poly([b.C(top), b.B(top), p.P(um + 0.2, vm, top + 7)], shade(R, 0.72));
      winRow(p, b, "left", 4, 3, 4, "#2a2426", pal.trim);
      winRow(p, b, "left", 4, 12, 4, "#2a2426", pal.trim);
      winRow(p, b, "right", 3, 3, 4, "#2a2426");
      const [x, y] = lerp(b.D(top), b.C(top), 0.5); p.px(x - 5, y - 4, pal.trim, 10, 3); // company name board
      p.px(x - 1, y - 9, "#efe9da", 3, 3); // clock
      break;
    }
    case "control": {
      // a modern office: glass curtain walls on a concrete base, a dish on the roof
      const b = box(p, 0.15, 0.2, 0.85, 0.8, 26, { wall: "#7a8a96", top: "#5a646e", foundation: 2 });
      for (let z = 4; z < 24; z += 5) winRow(p, b, "left", 6, z, 3, "#b8d0e0");
      for (let z = 4; z < 24; z += 5) winRow(p, b, "right", 4, z, 3, "#9ab4c8");
      const [x, y] = p.P(0.6, 0.5, 26); p.px(x - 3, y - 4, "#d8d8d0", 6, 3); p.px(x, y - 8, "#8a8a8a", 1, 4);
      break;
    }
    case "construction": {
      // a process going up: brick walls part-built inside a timber scaffold, a derrick crane, beams and bricks
      const b = box(p, 0.15, 0.15, 0.85, 0.85, 10, { wall: shade(W, 0.95), foundation: 2 });
      void b;
      const pole = "#8a6a3e";
      for (const [u, vv] of [[0.1, 0.1], [0.9, 0.1], [0.1, 0.9], [0.9, 0.9], [0.5, 0.9], [0.9, 0.5]] as const) p.line(p.P(u, vv, 0), p.P(u, vv, 30), pole);
      for (const z of [10, 20, 30]) { p.line(p.P(0.1, 0.9, z), p.P(0.9, 0.9, z), pole); p.line(p.P(0.9, 0.9, z), p.P(0.9, 0.1, z), pole); }
      for (let k = 0; k < 3; k++) p.line(p.P(0.1 + k * 0.27, 0.9, 10), p.P(0.37 + k * 0.27, 0.9, 20), shade(pole, 0.8)); // bracing
      // the crane: mast, jib and a load on the hook
      const base = p.P(0.25, 0.3, 0), top = p.P(0.25, 0.3, 58), tip = p.P(0.95, 0.65, 52);
      p.line(base, top, "#3a3a40"); p.line([base[0] + 1, base[1]], [top[0] + 1, top[1]], "#2a2a30");
      p.line(top, tip, pal.trim); p.line(p.P(0.25, 0.3, 56), p.P(0.05, 0.15, 54), pal.trim);
      p.line(tip, [tip[0], tip[1] + 22], "#2a2a2a");
      p.px(tip[0] - 4, tip[1] + 22, pal.steel, 9, 2);
      // materials
      box(p, 0.05, 0.92, 0.35, 1.0, 3, { wall: "#9a4a32", top: "#b45a3a" });
      box(p, 0.92, 0.05, 1.0, 0.45, 2, { wall: "#4a4a52", top: "#6a6a72" });
      people(p, 0.2, 0.2, 0.8, 0.8, 4, v + 3);
      break;
    }
    case "gate": {
      for (let t = 0; t <= 1; t += 0.08) { const q = p.P(t, 0.9); p.px(q[0], q[1] - 6, "#2a2a2e", 1, 6); }
      const g = box(p, 0.1, 0.1, 0.35, 0.35, 10, { wall: W });
      gable(p, g, "u", 4, R);
      if (strikeS === "1") {
        people(p, 0.05, 0.45, 0.95, 0.95, 34, v);
        // banner on poles
        const a = p.P(0.2, 1.05, 0), b = p.P(0.8, 1.05, 0);
        p.line(a, [a[0], a[1] - 14], "#4a3a2a"); p.line(b, [b[0], b[1] - 14], "#4a3a2a");
        p.poly([[a[0], a[1] - 14], [b[0], b[1] - 14], [b[0], b[1] - 9], [a[0], a[1] - 9]], "#e8e0d0");
        p.line([a[0] + 2, a[1] - 12], [b[0] - 2, b[1] - 12], "#a82a22");
      }
      break;
    }
    case "stack": {
      box(p, 0.25, 0.25, 0.75, 0.75, 6, { wall: "#5a524c", top: "#3a3432" });
      stackAt(p, 0.5, 0.5, 6, 104, palId === "p" ? "#93503c" : shade(W, 0.95), 0.08);
      break;
    }
    case "bauxiteyard": {
      pile(p, 0.5, 0.5, fill + 0.5, ["#8a3a24", "#a84a2c", "#c06038"], v + 11);
      break;
    }
    case "rectifier": {
      // the rectifier yard: transformers and busbars feeding the potlines
      for (let k = 0; k < 3; k++) box(p, 0.15 + k * 0.25, 0.3, 0.32 + k * 0.25, 0.6, 9, { wall: "#6a7078", top: "#8a9098" });
      p.line(p.P(0.1, 0.75, 12), p.P(0.9, 0.75, 12), "#b08a4a"); p.line(p.P(0.1, 0.8, 12), p.P(0.9, 0.8, 12), "#b08a4a");
      break;
    }
    case "tankfarm": {
      for (const [u, vv] of [[0.3, 0.3], [0.72, 0.3], [0.3, 0.72], [0.72, 0.72]] as const) cylinder(p, u, vv, 0.17, 0, 10 + ((u * 10 + vv * 7) % 3) * 4, "#c8c4b8", "#a8a498");
      p.line(p.P(0.1, 0.5, 4), p.P(0.9, 0.5, 4), "#6a6a6e");
      break;
    }
    case "column": {
      box(p, 0.2, 0.2, 0.8, 0.8, 4, { wall: "#5a5a5e", top: "#6a6a6e" });
      cylinder(p, 0.4, 0.4, 0.09, 4, 64, "#b0aca4", "#8a8680");
      cylinder(p, 0.66, 0.6, 0.07, 4, 46, "#a4a098", "#807c76");
      for (const z of [18, 34, 50]) p.px(...p.P(0.4, 0.4, z), "#6a6660", 3, 1);
      p.line(p.P(0.4, 0.4, 60), p.P(0.66, 0.6, 44), "#7a7670");
      break;
    }
    case "campus": {
      for (const [u, vv, k] of [[0.3, 0.35, 1], [0.75, 0.6, 2]] as const) {
        const [x, y] = p.P(u, vv);
        if ((v + k) % 3 !== 0) { blob(p, x, y - 9, 8, 7, ["#3e6a2a", "#4e7e32", "#5e8e3a"], (j) => tileNoise(v, j, k, 5)); p.px(x, y - 3, "#5a4030", 1, 3); }
      }
      break;
    }
    case "carpark": {
      const cols = ["#a83a2a", "#3a5a8a", "#d8d0b8", "#2a2a2e", "#5a7a4a", "#c8a040"];
      for (let k = 0; k < 4; k++) { const [x, y] = p.P(0.2 + (k % 2) * 0.45, 0.3 + Math.floor(k / 2) * 0.4); if ((v + k) % 4 !== 0) { p.px(x - 3, y - 3, cols[(v + k) % cols.length], 7, 3); p.px(x - 2, y - 5, shade(cols[(v + k) % cols.length], 0.8), 5, 2); } }
      break;
    }
    case "vandegraaff": {
      // Westinghouse's atom smasher (1937): a pear-shaped steel tank on a brick base
      box(p, 0.25, 0.25, 0.75, 0.75, 8, { wall: "#8e4a36", top: "#5a4a40" });
      cylinder(p, 0.5, 0.5, 0.2, 8, 30, "#b8bcc0", "#a0a4a8");
      for (let k = 0; k < 6; k++) cylinder(p, 0.5, 0.5, 0.26 * Math.sin(((k + 1) / 7) * Math.PI) + 0.05, 38 + k * 4, 4, "#c8ccd0", "#b0b4b8");
      break;
    }
    case "": break;
  }
  const sp = p.sprite();
  if (+sootS > 0) weather(sp.canvas, +sootS);
  return sp;
}

