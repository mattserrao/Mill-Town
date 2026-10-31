// Industry definitions: site needs, production model and tech trees.
// Numbers are first-pass tuning values — expect to change them while balancing.

export type IndustryId = "steel" | "power" | "glass" | "metalworks";
export type Good = "coal" | "ore" | "coke" | "sand" | "limestone" | "iron" | "steel" | "electricity" | "glass" | "machinery" | "vessels";

/** Site needs in metres (converted to tiles with the map's scale). */
export interface SiteNeeds {
  /** square footprint edge */
  footprintM: number;
  /** max distance to a navigable river for barge access; 0 = not needed */
  riverWithinM: number;
  /** preferred max distance to a coal outcrop */
  coalWithinM: number;
  /** labor catchment radius */
  laborRadiusM: number;
  /** max ground relief across the footprint that can be graded flat */
  maxReliefM: number;
}

export interface Tech {
  id: string;
  name: string;
  era: "I" | "II" | "III";
  year: number;           // earliest year available
  cost: number;           // dollars
  seasons: number;        // research/build time in turns
  requires: string[];     // other tech ids
  /** business accomplishments required, e.g. { produced: 50000 } */
  milestones?: Partial<Record<"produced" | "employees" | "revenue" | "seasonsOperating", number>>;
  effects: Partial<{ capacity: number; efficiency: number; pollution: number; workersPerUnit: number; quality: number }>;
  note?: string;
}

export interface Industry {
  id: IndustryId;
  name: string;
  /** what the company is called / does in 1850 */
  startsAs: string;
  output: Good;
  /** inputs per unit of output */
  inputs: Partial<Record<Good, number>>;
  baseCapacity: number;     // units per season
  workersPerUnit: number;   // workers per unit of seasonal capacity
  basePrice: number;        // $ per unit in 1850
  startCost: number;        // founding cost (land + plant), $
  pollutionPerUnit: number; // added to surrounding tiles per unit produced
  site: SiteNeeds;
  tech: Tech[];
}

export const INDUSTRIES: Record<IndustryId, Industry> = {
  steel: {
    id: "steel",
    name: "Iron & Steel",
    startsAs: "Iron furnace and rolling mill",
    output: "iron",
    inputs: { ore: 1.6, coal: 1.2, limestone: 0.3 },
    baseCapacity: 600,
    workersPerUnit: 0.25,
    basePrice: 45,
    startCost: 60000,
    pollutionPerUnit: 0.02,
    site: { footprintM: 240, riverWithinM: 60, coalWithinM: 2000, laborRadiusM: 1600, maxReliefM: 8 },
    tech: [
      { id: "puddling", name: "Puddling furnaces", era: "I", year: 1850, cost: 0, seasons: 0, requires: [], effects: {}, note: "Starting tech." },
      { id: "hot_blast", name: "Hot-blast stoves", era: "I", year: 1855, cost: 15000, seasons: 4, requires: ["puddling"], effects: { efficiency: 0.15 } },
      { id: "coke_furnace", name: "Coke blast furnace", era: "I", year: 1859, cost: 40000, seasons: 6, requires: ["hot_blast"], milestones: { produced: 5000 }, effects: { capacity: 0.5 } },
      { id: "bessemer", name: "Bessemer converter", era: "I", year: 1868, cost: 120000, seasons: 8, requires: ["coke_furnace"], milestones: { produced: 20000 }, effects: { capacity: 1.5, quality: 1 }, note: "Output switches from iron to steel rail." },
      { id: "open_hearth", name: "Open-hearth furnaces", era: "I", year: 1886, cost: 300000, seasons: 8, requires: ["bessemer"], effects: { capacity: 1.0, quality: 1 } },
      { id: "byproduct_coke", name: "By-product coke ovens", era: "II", year: 1916, cost: 400000, seasons: 8, requires: ["open_hearth"], effects: { efficiency: 0.2, pollution: 0.2 } },
      { id: "strip_mill", name: "Continuous strip mill", era: "II", year: 1927, cost: 900000, seasons: 10, requires: ["open_hearth"], milestones: { produced: 120000 }, effects: { capacity: 1.0, workersPerUnit: -0.3 } },
      { id: "bof", name: "Basic oxygen furnace", era: "III", year: 1955, cost: 3000000, seasons: 12, requires: ["strip_mill"], effects: { capacity: 1.0, workersPerUnit: -0.4 } },
      { id: "continuous_cast", name: "Continuous casting", era: "III", year: 1965, cost: 5000000, seasons: 12, requires: ["bof"], effects: { efficiency: 0.25, workersPerUnit: -0.3 } },
      { id: "automation", name: "Computer controls and robots", era: "III", year: 1982, cost: 4000000, seasons: 8, requires: ["continuous_cast"], effects: { workersPerUnit: -0.3, efficiency: 0.1 }, note: "Fewer men per ton; the men laid off stay in the valley." },
    ],
  },
  power: {
    id: "power",
    name: "Power",
    startsAs: "Coal-gas works (street lighting)",
    output: "electricity",
    inputs: { coal: 1.5 },
    baseCapacity: 400,
    workersPerUnit: 0.12,
    basePrice: 30,
    startCost: 40000,
    pollutionPerUnit: 0.015,
    site: { footprintM: 150, riverWithinM: 60, coalWithinM: 2500, laborRadiusM: 1200, maxReliefM: 8 },
    tech: [
      { id: "gas_works", name: "Coal-gas works", era: "I", year: 1850, cost: 0, seasons: 0, requires: [], effects: {}, note: "Starting tech." },
      { id: "gas_mains", name: "Iron gas mains", era: "I", year: 1855, cost: 20000, seasons: 4, requires: ["gas_works"], effects: { capacity: 0.4 } },
      { id: "dc_dynamo", name: "DC dynamo station", era: "I", year: 1882, cost: 90000, seasons: 6, requires: ["gas_mains"], milestones: { seasonsOperating: 40 }, effects: { capacity: 0.8 } },
      { id: "ac_system", name: "Alternating current", era: "I", year: 1886, cost: 150000, seasons: 8, requires: ["dc_dynamo"], effects: { capacity: 1.5 }, note: "Westinghouse's system — serve the whole valley." },
      { id: "steam_turbine", name: "Steam turbines", era: "II", year: 1903, cost: 400000, seasons: 8, requires: ["ac_system"], effects: { capacity: 1.5, efficiency: 0.2 } },
      { id: "hv_ring", name: "69,000-volt ring", era: "II", year: 1915, cost: 500000, seasons: 8, requires: ["steam_turbine"], effects: { capacity: 0.5, efficiency: 0.1 }, note: "Duquesne Light's high-voltage loop round the city." },
      { id: "interconnect", name: "Regional grid interconnect", era: "II", year: 1925, cost: 800000, seasons: 10, requires: ["steam_turbine"], effects: { capacity: 1.0 } },
      { id: "nuclear", name: "Nuclear station (Shippingport)", era: "III", year: 1957, cost: 6000000, seasons: 16, requires: ["interconnect"], effects: { capacity: 2.0, pollution: -0.6 } },
      { id: "automation", name: "Computer dispatch and controls", era: "III", year: 1982, cost: 3000000, seasons: 8, requires: ["interconnect"], effects: { workersPerUnit: -0.3, efficiency: 0.1 } },
    ],
  },
  glass: {
    id: "glass",
    name: "Glass",
    startsAs: "Glasshouse (hand-blown bottles & window glass)",
    output: "glass",
    inputs: { sand: 1.2, coal: 0.8 },
    baseCapacity: 300,
    workersPerUnit: 0.3,
    basePrice: 55,
    startCost: 30000,
    pollutionPerUnit: 0.01,
    site: { footprintM: 150, riverWithinM: 90, coalWithinM: 2000, laborRadiusM: 1200, maxReliefM: 10 },
    tech: [
      { id: "hand_blown", name: "Hand-blown glass", era: "I", year: 1850, cost: 0, seasons: 0, requires: [], effects: {}, note: "Starting tech." },
      { id: "pressed_glass", name: "Pressed glass", era: "I", year: 1855, cost: 12000, seasons: 4, requires: ["hand_blown"], effects: { capacity: 0.5 } },
      { id: "gas_furnace", name: "Natural-gas furnaces", era: "I", year: 1883, cost: 60000, seasons: 6, requires: ["pressed_glass"], effects: { efficiency: 0.3, pollution: -0.3 } },
      { id: "plate_glass", name: "Plate glass", era: "II", year: 1890, cost: 200000, seasons: 8, requires: ["gas_furnace"], effects: { capacity: 1.0, quality: 1 } },
      { id: "bottle_machine", name: "Owens bottle machine", era: "II", year: 1905, cost: 300000, seasons: 8, requires: ["pressed_glass"], effects: { capacity: 2.0, workersPerUnit: -0.5 } },
      { id: "float_glass", name: "Float glass", era: "III", year: 1962, cost: 2500000, seasons: 12, requires: ["plate_glass"], effects: { capacity: 2.0, workersPerUnit: -0.3 } },
      { id: "automation", name: "Automated lines", era: "III", year: 1982, cost: 2500000, seasons: 8, requires: ["float_glass"], effects: { workersPerUnit: -0.3, efficiency: 0.1 } },
    ],
  },
  metalworks: {
    id: "metalworks",
    name: "Metalworking & Shipbuilding",
    startsAs: "Boatyard and foundry (steamboats)",
    output: "vessels",
    inputs: { iron: 1.0, coal: 0.4 },
    baseCapacity: 120,
    workersPerUnit: 0.8,
    basePrice: 160,
    startCost: 45000,
    pollutionPerUnit: 0.008,
    site: { footprintM: 180, riverWithinM: 60, coalWithinM: 2500, laborRadiusM: 1600, maxReliefM: 10 },
    tech: [
      { id: "steamboats", name: "Wooden steamboats", era: "I", year: 1850, cost: 0, seasons: 0, requires: [], effects: {}, note: "Starting tech." },
      { id: "iron_hulls", name: "Iron-hulled boats", era: "I", year: 1860, cost: 25000, seasons: 6, requires: ["steamboats"], effects: { quality: 1, capacity: 0.3 } },
      { id: "machine_shop", name: "Machine shop", era: "I", year: 1870, cost: 50000, seasons: 6, requires: ["steamboats"], effects: { capacity: 0.5 } },
      { id: "steel_barges", name: "Steel barges", era: "II", year: 1895, cost: 180000, seasons: 8, requires: ["iron_hulls"], effects: { capacity: 1.0 } },
      { id: "heavy_machinery", name: "Heavy machinery", era: "II", year: 1905, cost: 250000, seasons: 8, requires: ["machine_shop"], effects: { capacity: 1.0, quality: 1 } },
      { id: "welded_hulls", name: "Welded hulls / LSTs", era: "II", year: 1940, cost: 600000, seasons: 6, requires: ["steel_barges"], effects: { capacity: 2.0 }, note: "War production." },
      { id: "towboats", name: "Diesel towboats", era: "III", year: 1946, cost: 1500000, seasons: 10, requires: ["welded_hulls"], effects: { capacity: 1.0, workersPerUnit: -0.3 } },
      { id: "automation", name: "Industrial robots", era: "III", year: 1982, cost: 2500000, seasons: 8, requires: ["heavy_machinery"], effects: { workersPerUnit: -0.3, efficiency: 0.1 }, note: "Westinghouse's Unimation arms on the line." },
    ],
  },
};

export const INDUSTRY_IDS = Object.keys(INDUSTRIES) as IndustryId[];
