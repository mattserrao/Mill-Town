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
];

/** a rival's name in a given year (renames by year; a name set by an event wins) */
export function nameNow(def: RivalDef, year: number, override?: string, overrideYear = 0): string {
  let n = def.company, at = -1;
  for (const [y, nm] of def.renames ?? []) if (year >= y) { n = nm; at = y; }
  return override && overrideYear >= at ? override : n; // a later dated rename replaces an event's name
}
