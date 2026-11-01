// AI rivals: real Pittsburgh industrialists. Data only for now; behaviour comes later.
// `site` is a landmark name from the map; if it's taken, the rival takes the best nearby site.

import type { IndustryId } from "./industries";

export interface RivalDef {
  id: string;
  company: string;
  figures: string[];
  industry: IndustryId;
  entryYear: number;
  site: string;
  style: "aggressive" | "integrator" | "financier" | "innovator" | "steady";
  note: string;
  /** a site by latitude/longitude when there's no map landmark for it */
  at?: [number, number];
  /** the works stands but makes nothing until this year (under construction) */
  opens?: number;
  /** closes for good in this year */
  closes?: number;
  /** cutbacks: from year, run at this share of normal */
  decline?: [number, number][];
  /** later names: from year */
  renames?: [number, string][];
  /** adopts new processes this many years late (or early, if negative) */
  techLag?: number;
  /** its works lie off the map (New Kensington, Neville Island…): it competes and is shown at the map's edge, and its
   *  headquarters tower (src/core/civic.ts) stands downtown */
  offmap?: string;
}

export const RIVALS: readonly RivalDef[] = [
  {
    id: "jl",
    company: "Jones & Laughlin (American Iron Works)",
    figures: ["Benjamin F. Jones", "James Laughlin"],
    industry: "steel",
    entryYear: 1853,
    site: "Birmingham (South Side)",
    style: "steady",
    note: "South Side iron works; later the Eliza furnaces across the Mon in Hazelwood.",
    decline: [[1979, 0.65]],
    closes: 1985,
    renames: [[1968, "Jones & Laughlin (LTV)"], [1984, "LTV Steel"]],
  },
  {
    id: "carnegie",
    company: "Carnegie Steel (Edgar Thomson Works)",
    figures: ["Andrew Carnegie", "Henry Phipps"],
    industry: "steel",
    entryYear: 1872,
    opens: 1875,
    site: "Edgar Thomson Works site",
    style: "aggressive",
    note: "Cuts costs ruthlessly, buys out rivals, builds libraries.",
    decline: [[1979, 0.7]],
    renames: [[1892, "Carnegie Steel (Edgar Thomson Works)"], [1901, "U.S. Steel (Edgar Thomson Works)"]],
  },
  {
    id: "frick",
    company: "H. C. Frick Coke Company",
    figures: ["Henry Clay Frick"],
    industry: "steel",
    entryYear: 1881,
    site: "Homestead Works site",
    style: "integrator",
    note: "Controls coke supply; hard line on labor (Homestead, 1892).",
    decline: [[1979, 0.6], [1982, 0.3]],
    closes: 1985,
  },
  {
    id: "westinghouse",
    company: "Westinghouse Electric (East Pittsburgh Works)",
    figures: ["George Westinghouse"],
    industry: "metalworks",
    entryYear: 1894,
    site: "East Pittsburgh",
    at: [40.3960, -79.8390],
    style: "innovator",
    note: "Electrical machinery: generators, motors, transformers. Sets the pace in new processes.",
  },
  {
    id: "ppg",
    company: "Pittsburgh Plate Glass",
    figures: ["John Pitcairn", "John B. Ford"],
    industry: "glass",
    entryYear: 1883,
    site: "Lawrenceville",
    style: "steady",
    note: "Plate glass at scale.",
    renames: [[1968, "PPG Industries"]],
  },
  {
    id: "mellon",
    company: "Mellon interests",
    figures: ["Thomas Mellon", "Andrew W. Mellon"],
    industry: "metalworks",
    entryYear: 1869,
    site: "McKeesport",
    style: "financier",
    note: "Bankers first: finance rivals, buy distressed firms.",
  },
  {
    id: "dravo",
    company: "Dravo Corporation",
    figures: ["Frank R. Dravo", "Ralph M. Dravo"],
    industry: "metalworks",
    entryYear: 1891,
    site: "Allegheny City",
    style: "steady",
    note: "River contracting and barge building; LSTs in WWII.",
    decline: [[1982, 0.5]],
  },
  {
    id: "ntube",
    company: "National Tube Works",
    figures: ["Harvey Flagler", "John Flagler"],
    industry: "steel",
    entryYear: 1872,
    site: "McKeesport",
    at: [40.3450, -79.8560],
    style: "steady",
    note: "Pipe and tube at the mouth of the Youghiogheny; McKeesport grows around it.",
    decline: [[1982, 0.5]],
    renames: [[1899, "National Tube Company"], [1901, "U.S. Steel (National Tube)"]],
  },
  {
    id: "carrie",
    company: "Carrie Furnaces",
    figures: ["Carrie Furnace Company"],
    industry: "steel",
    entryYear: 1884,
    site: "Rankin",
    style: "steady",
    note: "Blast furnaces at Rankin, sending hot metal across the Mon to Homestead.",
    renames: [[1898, "Carnegie Steel (Carrie Furnaces)"], [1901, "U.S. Steel (Carrie Furnaces)"]],
    closes: 1978,
  },
  {
    id: "ussduq",
    company: "Duquesne Steel Works",
    figures: ["Allegheny Bessemer Steel Co."],
    industry: "steel",
    entryYear: 1889,
    site: "Duquesne Works site",
    style: "steady",
    note: "Bessemer rail mill at Duquesne; Carnegie's from 1890, U.S. Steel's from 1901 (Dorothy Six, 1963).",
    renames: [[1890, "Carnegie Steel (Duquesne Works)"], [1901, "U.S. Steel (Duquesne Works)"]],
    decline: [[1979, 0.7]],
    closes: 1984,
  },
  {
    id: "mesta",
    company: "Mesta Machine Company",
    figures: ["George Mesta"],
    industry: "metalworks",
    entryYear: 1898,
    site: "West Homestead",
    at: [40.3995, -79.9130],
    style: "steady",
    note: "Heavy machinery for the mills: rolling mills, forges, naval guns, the 50,000-ton press.",
    closes: 1983,
  },
  {
    id: "abridge",
    company: "American Bridge Company (Ambridge)",
    figures: ["J. P. Morgan's interests"],
    industry: "metalworks",
    entryYear: 1900,
    site: "Ambridge",
    at: [40.4560, -80.0720],
    style: "steady",
    note: "Bridges and structural steel from the company town on the Ohio; part of U.S. Steel from 1901.",
    renames: [[1901, "U.S. Steel (American Bridge)"]],
    closes: 1983,
  },
  {
    id: "clairton",
    company: "Crucible Steel (Clairton Works)",
    figures: ["Crucible Steel", "U.S. Steel"],
    industry: "steel",
    entryYear: 1903,
    site: "Clairton",
    at: [40.2990, -79.8850],
    style: "steady",
    note: "Furnaces and steel plant up the Mon, U.S. Steel's from 1904; beside it the world's largest coke works.",
    renames: [[1904, "U.S. Steel (Clairton Works)"]],
  },
  {
    id: "dlight",
    company: "Duquesne Light",
    figures: ["Duquesne Light Co."],
    industry: "power",
    entryYear: 1903,
    site: "Brunot Island",
    at: [40.4600, -80.0400],
    style: "steady",
    note: "The city's electric utility: Brunot Island station, then Elrama, Shippingport and Beaver Valley.",
  },
  // ---------------------------------------------------------------- v0.18: the modern industries (real firms)
  {
    id: "alcoa", company: "Pittsburgh Reduction Company", figures: ["Alfred E. Hunt", "Charles Martin Hall"],
    industry: "aluminium", entryYear: 1891, site: "New Kensington", at: [40.5700, -79.7650], offmap: "New Kensington",
    style: "innovator", note: "Hall's process, Mellon money; the smelters move to New Kensington (1891), Niagara Falls and Massena. A monopoly until the war (antitrust 1938–45).",
    renames: [[1907, "Aluminum Company of America"]],
  },
  {
    id: "koppers", company: "Koppers Company", figures: ["Heinrich Koppers", "Andrew W. Mellon"],
    industry: "chemicals", entryYear: 1915, site: "Bridgeville", at: [40.3560, -80.1100], offmap: "Bridgeville and Neville Island",
    style: "integrator", note: "By-product coke ovens and their chemicals; tar, wood treating, then plastics. Mellon bought out the founder.",
  },
  {
    id: "neville", company: "Neville Chemical Company", figures: ["Harvey Dauler"],
    industry: "chemicals", entryYear: 1925, site: "Neville Island", at: [40.5100, -80.1200], offmap: "Neville Island",
    style: "steady", note: "Hydrocarbon resins for paints, coatings and rubber.",
  },
  {
    id: "pcc", company: "Pittsburgh Coke & Chemical", figures: ["Pittsburgh Coke & Iron"],
    industry: "chemicals", entryYear: 1940, site: "Neville Island", at: [40.5050, -80.1100], offmap: "Neville Island",
    style: "integrator", note: "Coke for the mills, chemicals, coatings and activated carbon (sold to Calgon, 1965).",
    renames: [[1964, "USS Chemicals (Neville Island)"]],
  },
  {
    id: "mobay", company: "Mobay Chemical", figures: ["Monsanto", "Bayer"],
    industry: "chemicals", entryYear: 1954, site: "Robinson Township", at: [40.4500, -80.1500], offmap: "Robinson Township",
    style: "innovator", note: "Polyurethanes: a Monsanto–Bayer venture (1954), Bayer's alone from 1967.",
  },
  {
    id: "mellon_inst", company: "Mellon Institute of Industrial Research", figures: ["Andrew W. Mellon", "Richard B. Mellon"],
    industry: "research", entryYear: 1913, site: "Oakland", at: [40.4462, -79.9510],
    style: "steady", note: "Industrial fellowships: firms pay for a fellow and own what he finds. 1,600 patents; Dow Corning's silicones.",
    renames: [[1967, "Carnegie-Mellon University (Mellon Institute)"]],
  },
  {
    id: "wresearch", company: "Westinghouse Research Laboratories", figures: ["Westinghouse Electric"],
    industry: "research", entryYear: 1916, site: "Forest Hills", at: [40.4200, -79.8500],
    style: "innovator", note: "Forest Hills (1916), the atom smasher (1937), then a hilltop campus at Churchill (1956), 1,500 staff.",
  },
  {
    id: "gulf_rd", company: "Gulf Research & Development", figures: ["Gulf Oil"],
    industry: "research", entryYear: 1935, site: "Harmarville", at: [40.5400, -79.8400], offmap: "Harmarville",
    style: "steady", note: "Up to 2,000 scientists at Harmarville; closed when Chevron took Gulf (1985).", closes: 1985,
  },
  {
    id: "uss_research", company: "U.S. Steel Research Center", figures: ["U.S. Steel"],
    industry: "research", entryYear: 1956, site: "Monroeville", at: [40.4300, -79.7700], offmap: "Monroeville",
    style: "steady", note: "The steel corporation's laboratories (1956).", decline: [[1982, 0.6]],
  },
  {
    id: "bettis", company: "Bettis Atomic Power Laboratory", figures: ["Westinghouse Electric", "Hyman Rickover"],
    industry: "nuclear", entryYear: 1949, site: "West Mifflin", at: [40.3574, -79.8994],
    style: "innovator", note: "The Navy's reactors: Nautilus (1955), then Shippingport's core (1957).",
  },
  {
    id: "numec", company: "Nuclear Materials and Equipment Corp. (NUMEC)", figures: ["Zalman Shapiro"],
    industry: "nuclear", entryYear: 1957, site: "Apollo", at: [40.5800, -79.5700], offmap: "Apollo",
    style: "aggressive", note: "Reactor fuel; the 1965 inquiry into missing uranium.",
    renames: [[1967, "NUMEC (Atlantic Richfield)"], [1971, "Babcock & Wilcox (Apollo)"]],
  },
  {
    id: "astro", company: "Westinghouse Astronuclear Laboratory", figures: ["Westinghouse Electric"],
    industry: "nuclear", entryYear: 1959, site: "Large", at: [40.2960, -79.9350],
    style: "innovator", note: "NERVA nuclear rocket engines for NASA, 1,100 engineers; funding ends 1972.",
    decline: [[1972, 0.35]], renames: [[1976, "Westinghouse Advanced Energy Systems"]],
  },
  {
    id: "presby", company: "Presbyterian Hospital", figures: ["University of Pittsburgh"],
    industry: "medicine", entryYear: 1938, site: "Oakland", at: [40.4428, -79.9608],
    style: "steady", note: "900 beds beside the medical school (1938); the University Health Center (1965); Starzl's transplants (1981).",
    renames: [[1965, "Presbyterian-University Hospital"]],
  },
  {
    id: "uhc", company: "Children's and Magee hospitals", figures: ["University Health Center of Pittsburgh"],
    industry: "medicine", entryYear: 1955, site: "Oakland", at: [40.4380, -79.9590],
    style: "steady", note: "The Oakland hospitals that join the University Health Center (1965).",
  },
];

/** a rival's name in a given year (renames by year; a name set by an event wins) */
export function nameNow(def: RivalDef, year: number, override?: string, overrideYear = 0): string {
  let n = def.company, at = -1;
  for (const [y, nm] of def.renames ?? []) if (year >= y) { n = nm; at = y; }
  return override && overrideYear >= at ? override : n; // a later dated rename replaces an event's name
}
