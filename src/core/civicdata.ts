// v0.27 civic life: the real places — cemeteries, and the dates the city's services began.
// Sources: docs/V027-RESEARCH.md. Dated landmarks (jail, libraries, churches, downtown, labour, reform, water) are in
// civic.ts CIVICS beside the v0.18 ones.

/** what a burying ground's stones look like: by the faith of those buried there */
export const enum Faith { Mixed = 0, Catholic = 1, Orthodox = 2, Jewish = 3 }

export interface CemeteryDef {
  id: string; name: string;
  /** the ground's middle (latitude, longitude) */
  at: [number, number];
  open: number;
  acres: number;
  faith: Faith;
  /** who it is for, in a line for the query panel */
  who: string;
  /** the great rural cemeteries: winding drives, old trees, monuments */
  rural?: boolean;
  /** later names: [year, name] */
  renames?: [number, string][];
}

/**
 * The real burying grounds on the map. Acreage is today's (the grounds grew into it); where the research found no
 * founding year or acreage (marked ≈) the game uses a likely one.
 */
export const CEMETERIES: CemeteryDef[] = [
  { id: "allegheny", name: "Allegheny Cemetery", at: [40.4725, -79.9478], open: 1844, acres: 300, faith: Faith.Mixed, rural: true, who: "Pittsburgh's great rural cemetery: the founding families, the Arsenal's dead (1862), anyone who could pay" },
  { id: "union_dale", name: "Mount Union Cemetery", at: [40.4636, -80.0215], open: 1846, acres: 85, faith: Faith.Mixed, rural: true, renames: [[1869, "Union Dale Cemetery"]], who: "Allegheny City's dead (Mount Union, then Union Dale after it merged with Hilldale in 1869)" },
  { id: "troy_hill_jewish", name: "Troy Hill Jewish Cemetery", at: [40.4630, -79.9800], open: 1847, acres: 3, faith: Faith.Jewish, who: "the first Jewish burying ground in western Pennsylvania (Rodef Shalom's from 1906)" },
  { id: "st_mary", name: "St. Mary Cemetery", at: [40.4685, -79.9545], open: 1849, acres: 44, faith: Faith.Catholic, who: "the diocese's Catholics, beside Allegheny Cemetery" },
  { id: "mckeesport", name: "McKeesport & Versailles Cemetery", at: [40.3460, -79.8420], open: 1856, acres: 60, faith: Faith.Mixed, rural: true, who: "McKeesport's dead (the 1770s graveyard's remains were moved here)" },
  { id: "south_side", name: "South Side Cemetery", at: [40.4010, -79.9880], open: 1868, acres: 30, faith: Faith.Mixed, who: "the South Side's dead, on Brownsville Road (≈ founding year)" },
  { id: "homewood", name: "Homewood Cemetery", at: [40.4410, -79.9090], open: 1878, acres: 175, faith: Faith.Mixed, rural: true, who: "the East End's fortunes: the Fricks, the Heinzes, the Mellons" },
  { id: "monongahela", name: "Monongahela Cemetery", at: [40.4050, -79.8520], open: 1880, acres: 30, faith: Faith.Mixed, who: "Braddock's and North Braddock's dead (≈ founding year and acreage)" },
  { id: "homestead", name: "Homestead Cemetery", at: [40.3972, -79.9003], open: 1885, acres: 34, faith: Faith.Mixed, who: "Homestead's dead, the men killed in the 1892 battle among them (≈ founding year)" },
  { id: "calvary", name: "Calvary Cemetery", at: [40.4190, -79.9325], open: 1886, acres: 200, faith: Faith.Catholic, rural: true, who: "the diocese's great Catholic cemetery, on the hill over Hazelwood" },
  { id: "beth_abraham", name: "Beth Abraham Cemetery", at: [40.3935, -79.9845], open: 1895, acres: 8, faith: Faith.Jewish, who: "the Hill's and the South Hills' Jewish congregations (≈ founding year and acreage)" },
];

/** the city's services on their real dates */
export const SERVICE_DATES = {
  /** Pittsburgh's police (night watch and day police joined under a chief) */
  police: 1857,
  /** Pittsburgh's paid fire department replaces the volunteer companies */
  paidFire: 1870,
  /** motor engines replace the horses */
  motorFire: 1915,
  /** Pennsylvania's compulsory school attendance law */
  schoolLaw: 1895,
  /** the State Police */
  statePolice: 1905,
  /** the School Code: the ward school boards give way to one Board of Public Education */
  schoolCode: 1911,
  /** the Coal and Iron Police abolished */
  coalIronEnd: 1931,
  /** the Amalgamated Association of Iron and Steel Workers */
  amalgamated: 1876,
  /** the Steel Workers Organizing Committee, then the United Steelworkers (1942) */
  swoc: 1936,
};

/** Pittsburgh's volunteer fire companies, in the order the game gives out their names */
export const VOLUNTEER_COMPANIES = ["Eagle", "Neptune", "Vigilant", "Niagara", "Allegheny", "Duquesne", "Relief", "Good Intent", "Independence", "Washington", "Columbia", "Mechanics'", "Lafayette", "Franklin", "Hope", "Union"];

/** a cemetery's name in a year */
export function cemeteryName(c: CemeteryDef, year: number): string { let n = c.name; for (const [y, nm] of c.renames ?? []) if (year >= y) n = nm; return n; }

/** disasters on their real dates that leave dead to bury (and a funeral through the streets): [lat, lon] */
export const DATED_DEAD: { year: number; season: number; at: [number, number]; dead: number; name: string }[] = [
  { year: 1862, season: 2, at: [40.4672, -79.9606], dead: 78, name: "the funeral of the Arsenal's dead" },
  { year: 1892, season: 1, at: [40.4128, -79.8972], dead: 10, name: "the funeral of the men killed at the Pump House" },
  { year: 1927, season: 2, at: [40.4480, -80.0230], dead: 28, name: "the funeral of the gasometer explosion's dead" },
  { year: 1931, season: 1, at: [40.4660, -79.9600], dead: 48, name: "the funeral of the forty-eight burned at the Little Sisters' home" },
];

/** the fires history set on their dates: they start at the real spot and burn about as far as they did */
export const DATED_FIRES: { year: number; season: number; at: [number, number]; size: number; name: string; cause: string }[] = [
  { year: 1897, season: 0, at: [40.4420, -80.0040], size: 19, name: "The Great Fire of 1897", cause: "a fire in the T. C. Jenkins warehouse that spread to Horne's" },
];
