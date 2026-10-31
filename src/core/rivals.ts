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
  },
  {
    id: "carnegie",
    company: "Carnegie Steel (Edgar Thomson Works)",
    figures: ["Andrew Carnegie", "Henry Phipps"],
    industry: "steel",
    entryYear: 1872,
    site: "Edgar Thomson Works site",
    style: "aggressive",
    note: "Cuts costs ruthlessly, buys out rivals, builds libraries.",
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
  },
  {
    id: "westinghouse",
    company: "Westinghouse Electric",
    figures: ["George Westinghouse"],
    industry: "power",
    entryYear: 1886,
    site: "East Liberty",
    style: "innovator",
    note: "AC power; competes for the valley's electric market.",
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
  },
];
