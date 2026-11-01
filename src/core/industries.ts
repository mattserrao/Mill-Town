// Industry definitions: site needs, production model and tech trees.
// Numbers are first-pass tuning values — expect to change them while balancing.

export type IndustryId = "steel" | "power" | "glass" | "metalworks" | "aluminium" | "chemicals" | "research" | "nuclear" | "medicine";
export type Good = "coal" | "ore" | "coke" | "sand" | "limestone" | "iron" | "steel" | "electricity" | "glass" | "machinery" | "vessels"
  | "bauxite" | "aluminium" | "chemicals" | "research" | "reactors" | "care";

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
  /** pollution-control equipment (v0.18): the level of smoke control it gives (1–4), or water treatment */
  control?: number;
  water?: boolean;
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
  /** the first year a works in this industry can be founded or bought into (v0.18's modern industries) */
  from?: number;
  /** salaried staff who rarely strike the way mill hands do */
  quiet?: boolean;
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
  // ---------------------------------------------------------------- v0.18: the modern industries
  aluminium: {
    id: "aluminium",
    name: "Aluminium",
    startsAs: "Reduction works (Hall–Héroult pots)",
    output: "aluminium",
    inputs: { bauxite: 2.0, coal: 1.0 },
    baseCapacity: 300,
    workersPerUnit: 0.3,
    basePrice: 95,
    startCost: 120000,
    pollutionPerUnit: 0.012,
    from: 1893,
    site: { footprintM: 180, riverWithinM: 90, coalWithinM: 3000, laborRadiusM: 1600, maxReliefM: 10 },
    tech: [
      { id: "hall_heroult", name: "Hall–Héroult reduction pots", era: "I", year: 1888, cost: 0, seasons: 0, requires: [], effects: {}, note: "Starting tech: Charles Martin Hall's electrolytic process (Smallman Street, 1888)." },
      { id: "bayer", name: "Bayer alumina refinery", era: "II", year: 1900, cost: 150000, seasons: 6, requires: ["hall_heroult"], effects: { capacity: 0.5, efficiency: 0.15 } },
      { id: "sheet_mill", name: "Sheet and foil mill", era: "II", year: 1910, cost: 250000, seasons: 8, requires: ["hall_heroult"], effects: { capacity: 0.3, quality: 1 } },
      { id: "extrusion", name: "Extrusion presses", era: "II", year: 1923, cost: 400000, seasons: 8, requires: ["sheet_mill"], effects: { capacity: 0.5 }, note: "Shapes for aircraft and building (New Kensington, 1923)." },
      { id: "aircraft", name: "Aircraft alloys", era: "II", year: 1938, cost: 800000, seasons: 8, requires: ["extrusion"], effects: { capacity: 1.0, quality: 1 }, note: "Duralumin for the bombers: the war makes aluminium a mass metal." },
      { id: "curtain_wall", name: "Architectural curtain wall", era: "III", year: 1953, cost: 1200000, seasons: 8, requires: ["extrusion"], effects: { capacity: 0.5, quality: 1 }, note: "The Alcoa Building (1953): the first skyscraper skinned in aluminium." },
      { id: "cans", name: "Pull-tab can ends", era: "III", year: 1962, cost: 2500000, seasons: 10, requires: ["sheet_mill"], effects: { capacity: 1.0, workersPerUnit: -0.2 }, note: "Tested on Iron City beer in 1962; cans move from steel to aluminium." },
      { id: "automation", name: "Computer-controlled potlines", era: "III", year: 1982, cost: 3000000, seasons: 8, requires: ["cans"], effects: { workersPerUnit: -0.3, efficiency: 0.1 } },
    ],
  },
  chemicals: {
    id: "chemicals",
    name: "Coal chemicals & coatings",
    startsAs: "Tar works (coke-oven by-products)",
    output: "chemicals",
    inputs: { coke: 1.0, coal: 0.5 },
    baseCapacity: 300,
    workersPerUnit: 0.25,
    basePrice: 85,
    startCost: 150000,
    pollutionPerUnit: 0.018,
    from: 1915,
    site: { footprintM: 180, riverWithinM: 90, coalWithinM: 3000, laborRadiusM: 1400, maxReliefM: 10 },
    tech: [
      { id: "tar_stills", name: "Tar stills and benzol plant", era: "II", year: 1910, cost: 0, seasons: 0, requires: [], effects: {}, note: "Starting tech: tar, benzol and ammonia from the by-product ovens (Koppers, 1915)." },
      { id: "resins", name: "Coal-tar resins", era: "II", year: 1925, cost: 200000, seasons: 6, requires: ["tar_stills"], effects: { capacity: 0.5, quality: 1 }, note: "Resins for paints and rubber (Neville Chemical, 1925)." },
      { id: "wood_treating", name: "Wood-treating plant", era: "II", year: 1930, cost: 250000, seasons: 6, requires: ["tar_stills"], effects: { capacity: 0.3, pollution: 0.2 }, note: "Creosoted ties and poles: a good trade, and a poisoned yard." },
      { id: "synthetic_rubber", name: "Synthetic rubber monomer", era: "II", year: 1943, cost: 1000000, seasons: 8, requires: ["resins"], effects: { capacity: 1.0 }, note: "Styrene for GR-S rubber: the war cuts off Malaya's plantations." },
      { id: "polyurethane", name: "Polyurethanes", era: "III", year: 1954, cost: 2000000, seasons: 10, requires: ["synthetic_rubber"], effects: { capacity: 1.0, quality: 1 }, note: "Foams and coatings (Mobay, 1954)." },
      { id: "activated_carbon", name: "Activated carbon", era: "III", year: 1962, cost: 1500000, seasons: 8, requires: ["tar_stills"], effects: { capacity: 0.5, pollution: -0.2 }, note: "Carbon for water and air purification (Pittsburgh Activated Carbon → Calgon, 1965)." },
      { id: "plasticisers", name: "Plasticisers (phthalic anhydride)", era: "III", year: 1969, cost: 3000000, seasons: 10, requires: ["polyurethane"], effects: { capacity: 1.0 } },
      { id: "automation", name: "Computer process control", era: "III", year: 1982, cost: 2500000, seasons: 8, requires: ["polyurethane"], effects: { workersPerUnit: -0.3, efficiency: 0.1 } },
    ],
  },
  research: {
    id: "research",
    name: "Industrial research",
    startsAs: "Contract research laboratory",
    output: "research",
    inputs: {},
    baseCapacity: 200,
    workersPerUnit: 0.35,
    basePrice: 115,
    startCost: 100000,
    pollutionPerUnit: 0.001,
    from: 1915,
    quiet: true,
    site: { footprintM: 150, riverWithinM: 0, coalWithinM: 99999, laborRadiusM: 2500, maxReliefM: 14 },
    tech: [
      { id: "fellowships", name: "Industrial fellowships", era: "II", year: 1913, cost: 0, seasons: 0, requires: [], effects: {}, note: "Starting tech: firms pay for a fellow to work on their problem, and own what he finds (the Mellon Institute, 1913)." },
      { id: "physics", name: "Atomic physics laboratory", era: "II", year: 1937, cost: 400000, seasons: 8, requires: ["fellowships"], effects: { capacity: 0.5, quality: 1 }, note: "Westinghouse's Van de Graaff atom smasher (Forest Hills, 1937)." },
      { id: "petroleum", name: "Petroleum and coal chemistry", era: "II", year: 1935, cost: 300000, seasons: 6, requires: ["fellowships"], effects: { capacity: 0.5 }, note: "Gulf's Harmarville laboratories (1935)." },
      { id: "campus", name: "Research campus", era: "III", year: 1956, cost: 1500000, seasons: 10, requires: ["physics"], effects: { capacity: 1.0 }, note: "Hilltop campuses at Churchill and Monroeville (1956)." },
      { id: "computing", name: "Computing centre", era: "III", year: 1956, cost: 1000000, seasons: 8, requires: ["fellowships"], effects: { capacity: 0.5, quality: 1 } },
      { id: "robotics", name: "Robotics", era: "III", year: 1979, cost: 2500000, seasons: 8, requires: ["computing"], effects: { capacity: 1.0, quality: 1 }, note: "The Robotics Institute (Carnegie Mellon, 1979; a $3M grant from Westinghouse)." },
      { id: "software", name: "Software engineering", era: "III", year: 1984, cost: 2000000, seasons: 6, requires: ["computing"], effects: { capacity: 0.5 }, note: "The Software Engineering Institute (1984)." },
    ],
  },
  nuclear: {
    id: "nuclear",
    name: "Nuclear",
    startsAs: "Atomic power laboratory",
    output: "reactors",
    inputs: { iron: 0.5 },
    baseCapacity: 120,
    workersPerUnit: 0.6,
    basePrice: 280,
    startCost: 400000,
    pollutionPerUnit: 0.002,
    from: 1949,
    quiet: true,
    site: { footprintM: 180, riverWithinM: 0, coalWithinM: 99999, laborRadiusM: 2500, maxReliefM: 10 },
    tech: [
      { id: "naval_reactor", name: "Naval reactor design", era: "III", year: 1949, cost: 0, seasons: 0, requires: [], effects: {}, note: "Starting tech: a pressurised-water reactor for the Navy's submarines (Bettis, 1949)." },
      { id: "nautilus", name: "Submarine prototype", era: "III", year: 1954, cost: 1500000, seasons: 8, requires: ["naval_reactor"], effects: { capacity: 0.5, quality: 1 }, note: "USS Nautilus goes to sea under nuclear power (1955)." },
      { id: "pwr", name: "Commercial power reactor", era: "III", year: 1957, cost: 3000000, seasons: 12, requires: ["naval_reactor"], effects: { capacity: 1.0 }, note: "Shippingport: the first U.S. commercial atomic power station (1957)." },
      { id: "fuel", name: "Fuel fabrication", era: "III", year: 1957, cost: 1500000, seasons: 8, requires: ["naval_reactor"], effects: { capacity: 0.5, efficiency: 0.2 } },
      { id: "nerva", name: "Nuclear rocket engines", era: "III", year: 1959, cost: 2500000, seasons: 10, requires: ["pwr"], effects: { capacity: 0.5, quality: 1 }, note: "NERVA for NASA (Westinghouse Astronuclear, 1959–72)." },
      { id: "automation", name: "Computer design and control", era: "III", year: 1982, cost: 2500000, seasons: 8, requires: ["pwr"], effects: { workersPerUnit: -0.2, efficiency: 0.1 } },
    ],
  },
  medicine: {
    id: "medicine",
    name: "Medicine",
    startsAs: "Teaching hospital and laboratories",
    output: "care",
    inputs: {},
    baseCapacity: 300,
    workersPerUnit: 0.5,
    basePrice: 72,
    startCost: 120000,
    pollutionPerUnit: 0,
    from: 1947,
    quiet: true,
    site: { footprintM: 150, riverWithinM: 0, coalWithinM: 99999, laborRadiusM: 2000, maxReliefM: 14 },
    tech: [
      { id: "teaching", name: "Teaching hospital", era: "III", year: 1938, cost: 0, seasons: 0, requires: [], effects: {}, note: "Starting tech: wards, operating theatres and a medical school beside them (Presbyterian, Oakland, 1938)." },
      { id: "virus_lab", name: "Virus research laboratory", era: "III", year: 1947, cost: 500000, seasons: 6, requires: ["teaching"], effects: { capacity: 0.3, quality: 1 }, note: "Jonas Salk comes to Pitt in 1947." },
      { id: "vaccine", name: "Killed-virus vaccine", era: "III", year: 1952, cost: 800000, seasons: 8, requires: ["virus_lab"], effects: { capacity: 0.5, quality: 1 }, note: "The polio vaccine: tested in Pittsburgh from February 1954, announced 'safe and effective' in April 1955." },
      { id: "health_center", name: "Academic health centre", era: "III", year: 1965, cost: 2000000, seasons: 10, requires: ["teaching"], effects: { capacity: 1.0 }, note: "The University Health Center of Pittsburgh (1965)." },
      { id: "transplant", name: "Organ transplantation", era: "III", year: 1981, cost: 2500000, seasons: 8, requires: ["health_center"], effects: { capacity: 1.0, quality: 1 }, note: "Thomas Starzl arrives in 1981: the liver transplant programme." },
    ],
  },
};

/**
 * Pollution-control equipment, the same ladder for every industry (scaled to its size): each level removes more of
 * the smoke and costs far more than the last (the 1979 Battelle curve for steel: 90% removal at $0.26 a ton, 97% at
 * $4.98, 99% at $32.20). The laws set the level a works must reach (src/core/enviro.ts).
 */
export function controlTechs(scale: number): Tech[] {
  const k = (n: number) => Math.round((n * scale) / 1000) * 1000;
  return [
    { id: "ctl_firing", name: "Smokeless firing (mechanical stokers)", era: "II", year: 1900, cost: k(8000), seasons: 2, requires: [], effects: { pollution: -0.15, efficiency: 0.03 }, control: 1, note: "Stokers and trained firemen: 'the smoke nuisance is the result of wasteful and careless combustion' (Bureau of Smoke Regulation, 1908)." },
    { id: "ctl_precip", name: "Electrostatic precipitators", era: "II", year: 1912, cost: k(40000), seasons: 4, requires: ["ctl_firing"], effects: { pollution: -0.25 }, control: 2, note: "Cottrell's precipitator (patented 1907) takes the dust out of the stack gas." },
    { id: "ctl_water", name: "Water treatment plant", era: "III", year: 1937, cost: k(60000), seasons: 4, requires: [], effects: {}, water: true, note: "Settling ponds and treatment instead of acid and slag in the river (the Clean Streams Law, 1937)." },
    { id: "ctl_hoods", name: "Hoods, baghouses and oven-door seals", era: "III", year: 1960, cost: k(300000), seasons: 6, requires: ["ctl_precip"], effects: { pollution: -0.25 }, control: 3, note: "Fumes caught at the furnace and the ovens; the costs climb steeply from here." },
    { id: "ctl_scrub", name: "Scrubbers and stack monitors", era: "III", year: 1972, cost: k(1500000), seasons: 8, requires: ["ctl_hoods"], effects: { pollution: -0.2 }, control: 4, note: "The last few per cent: the most expensive tons of smoke there are." },
  ];
}
for (const ind of Object.values(INDUSTRIES)) ind.tech.push(...controlTechs(ind.startCost / 60000));

export const INDUSTRY_IDS = Object.keys(INDUSTRIES) as IndustryId[];
/** the industries a works can be founded in this year */
export const industriesIn = (year: number) => INDUSTRY_IDS.filter((id) => (INDUSTRIES[id].from ?? 1850) <= year);
