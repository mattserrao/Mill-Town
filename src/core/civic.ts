// The valley's civic landmarks on their real dates (v0.18): hospitals, high schools, colleges, ballparks and arenas,
// memorials and the downtown towers. Each stands at its real position, opens in its year, can be renamed and closes
// or comes down on its date. Sources: docs/V018-RESEARCH.md §4. (Parks are in features.ts PARKS; the landmarks fired
// by events are in the era files.)

import { cal, type GameState, log } from "./game";
import { type LandmarkDef, type LandmarkKind, placeLandmark } from "./landmarks";

export interface Civic {
  id: string; name: string; kind: LandmarkKind; at: [number, number];
  open: number;
  /** closes (stands empty) or comes down (a ruin, then cleared) */
  close?: number; demolish?: number;
  /** later names: [year, name] */
  renames?: [number, string][];
  hospital?: boolean;
  /** a company's headquarters: it rises with its firm */
  hq?: string;
}

const H = (id: string, name: string, lat: number, lon: number, open: number, o: Partial<Civic> = {}): Civic => ({ id, name, kind: "hospital", at: [lat, lon], open, hospital: true, ...o });
const S = (id: string, name: string, lat: number, lon: number, open: number, o: Partial<Civic> = {}): Civic => ({ id, name, kind: "school", at: [lat, lon], open, ...o });

export const CIVICS: Civic[] = [
  // ---- hospitals
  H("mercy", "Mercy Hospital", 40.4363, -79.9851, 1848),
  H("passavant", "Passavant Hospital", 40.4420, -79.9830, 1849),
  H("st_francis", "St. Francis Hospital", 40.4700, -79.9595, 1865),
  H("south_side_hosp", "South Side Hospital", 40.4275, -79.9760, 1893),
  H("mckeesport_hosp", "McKeesport Hospital", 40.3500, -79.8460, 1894),
  H("homestead_hosp", "Homestead Hospital", 40.4035, -79.9075, 1904),
  H("braddock_hosp", "Braddock General Hospital", 40.4060, -79.8700, 1906),
  H("montefiore_hill", "Montefiore Hospital (Centre Avenue)", 40.4430, -79.9800, 1908, { close: 1929 }),
  H("shadyside_hosp", "Homeopathic Hospital (Shadyside)", 40.4546, -79.9401, 1910, { renames: [[1938, "Shadyside Hospital"]] }),
  H("magee", "Elizabeth Steel Magee Hospital", 40.4370, -79.9607, 1915, { renames: [[1962, "Magee-Womens Hospital"]] }),
  H("childrens", "Children's Hospital of Pittsburgh", 40.4419, -79.9585, 1926),
  H("montefiore", "Montefiore Hospital", 40.4390, -79.9620, 1929),
  H("wpic", "Western Psychiatric Institute", 40.4445, -79.9590, 1940),
  H("va_oakland", "Veterans Hospital (University Drive)", 40.4440, -79.9615, 1954),
  { id: "scaife_hall", name: "Scaife Hall (Pitt School of Medicine)", kind: "college", at: [40.4431, -79.9613], open: 1956 },
  // ---- high schools
  S("fifth_ave_hs", "Fifth Avenue High School", 40.4381, -79.9808, 1894, { close: 1976 }),
  S("south_hs", "South High School", 40.4281, -79.9894, 1897),
  S("peabody_hs", "Peabody High School", 40.4669, -79.9233, 1911),
  S("westinghouse_hs", "Brushton High School", 40.4608, -79.9012, 1912, { renames: [[1915, "Westinghouse High School"]] }),
  S("mckeesport_tech", "McKeesport Technical High School", 40.3460, -79.8480, 1916, { close: 1961 }),
  S("south_hills_hs", "South Hills High School", 40.4250, -80.0100, 1917),
  S("langley_hs", "Langley High School", 40.4560, -80.0560, 1923),
  S("carrick_hs", "Carrick High School", 40.3960, -79.9860, 1924),
  S("oliver_hs", "Oliver High School", 40.4680, -80.0280, 1925),
  S("allderdice_hs", "Taylor Allderdice High School", 40.4295, -79.9194, 1927),
  S("connelley", "Connelley Trade School", 40.4442, -79.9887, 1931),
  S("mckeesport_area_hs", "McKeesport Area High School", 40.3439, -79.8314, 1961),
  // ---- colleges and libraries
  { id: "mount_mercy", name: "Mount Mercy College", kind: "college", at: [40.4397, -79.9641], open: 1929, renames: [[1969, "Carlow College"]] },
  { id: "pts", name: "Pittsburgh Theological Seminary", kind: "college", at: [40.4667, -79.9217], open: 1959 },
  { id: "point_park", name: "Point Park Junior College", kind: "college", at: [40.4386, -80.0019], open: 1960, renames: [[1966, "Point Park College"]] },
  { id: "hunt_library", name: "Hunt Library", kind: "library", at: [40.4411, -79.9437], open: 1961 },
  { id: "hillman", name: "Hillman Library", kind: "library", at: [40.4425, -79.9540], open: 1968 },
  { id: "wean_hall", name: "Wean Hall", kind: "college", at: [40.4427, -79.9456], open: 1971 },
  { id: "mckeesport_library", name: "Carnegie Free Library of McKeesport", kind: "library", at: [40.3450, -79.8556], open: 1902 },
  // ---- ballparks, arenas and halls
  { id: "recreation_park", name: "Recreation Park", kind: "ballpark", at: [40.4547, -80.0186], open: 1867, demolish: 1905 },
  { id: "exposition_park", name: "Exposition Park", kind: "ballpark", at: [40.4469, -80.0108], open: 1890, demolish: 1915 },
  { id: "duquesne_gardens", name: "Duquesne Gardens", kind: "arena", at: [40.4478, -79.9496], open: 1895, demolish: 1956 },
  { id: "motor_square", name: "East Liberty Market House", kind: "hall", at: [40.4598, -79.9273], open: 1900, renames: [[1915, "Motor Square Garden"]] },
  { id: "hunt_armory", name: "Hunt Armory", kind: "hall", at: [40.4561, -79.9239], open: 1916 },
  { id: "ammon_field", name: "Ammon Field", kind: "ballpark", at: [40.4479, -79.9773], open: 1929 },
  { id: "west_field", name: "West Field", kind: "ballpark", at: [40.3950, -79.9060], open: 1937 },
  { id: "fitzgerald", name: "Fitzgerald Field House", kind: "arena", at: [40.4435, -79.9641], open: 1951 },
  { id: "convention_center", name: "David L. Lawrence Convention Center", kind: "arena", at: [40.4458, -79.9964], open: 1981 },
  // ---- memorials and civic buildings
  { id: "union_station", name: "Union Station", kind: "terminal", at: [40.4448, -79.9921], open: 1901 },
  { id: "soldiers_sailors", name: "Soldiers and Sailors Memorial Hall", kind: "museum", at: [40.4451, -79.9563], open: 1910 },
  { id: "syria_mosque", name: "Syria Mosque", kind: "theatre", at: [40.4456, -79.9563], open: 1916 },
  { id: "city_county", name: "City-County Building", kind: "hall", at: [40.4377, -79.9970], open: 1917 },
  { id: "schenley_fountain", name: "Mary Schenley Memorial Fountain", kind: "fountain", at: [40.4427, -79.9526], open: 1918 },
  { id: "westinghouse_memorial", name: "Westinghouse Memorial", kind: "fountain", at: [40.4395, -79.9427], open: 1930 },
  { id: "foster_memorial", name: "Stephen Foster Memorial", kind: "theatre", at: [40.4438, -79.9528], open: 1937 },
  // ---- the towers: each rises with its company
  { id: "frick_building", name: "Frick Building", kind: "skyscraper", at: [40.4392, -79.9975], open: 1902, hq: "frick" },
  { id: "union_trust", name: "Union Trust Building", kind: "skyscraper", at: [40.4400, -79.9969], open: 1916, hq: "mellon" },
  { id: "koppers_building", name: "Koppers Building", kind: "skyscraper", at: [40.4419, -79.9956], open: 1929, hq: "koppers" },
  { id: "grant_building", name: "Grant Building", kind: "skyscraper", at: [40.4375, -79.9975], open: 1929 },
  { id: "gulf_tower", name: "Gulf Tower", kind: "skyscraper", at: [40.4425, -79.9953], open: 1932 },
  { id: "alcoa_building", name: "Alcoa Building", kind: "glasstower", at: [40.4420, -79.9972], open: 1953, hq: "alcoa" },
  { id: "uss_tower", name: "U.S. Steel Building", kind: "skytower", at: [40.4413, -79.9947], open: 1970, hq: "carnegie" },
  { id: "oxford_centre", name: "One Oxford Centre", kind: "glasstower", at: [40.4383, -79.9971], open: 1983 },
  { id: "ppg_place", name: "PPG Place", kind: "glasstower", at: [40.4398, -80.0032], open: 1984, hq: "ppg" },
  { id: "one_mellon", name: "One Mellon Bank Center", kind: "glasstower", at: [40.4397, -79.9961], open: 1984, hq: "mellon" },
  // ---- big employers outside the mills
  { id: "heinz_plant", name: "H. J. Heinz Company plant", kind: "factory", at: [40.4544, -79.9908], open: 1907 },
  { id: "nabisco", name: "Nabisco bakery (East Liberty)", kind: "factory", at: [40.4572, -79.9168], open: 1918 },
];

/** v0.27 civic life (docs/V027-RESEARCH.md): justice, ward schools, branch libraries, churches, downtown, labour's
 * places, reform and water. Only under the seed-block model: v0.24's growth model keeps its results. */
export const CIVICS_V27: Civic[] = [
  // justice
  { id: "county_jail", name: "Allegheny County Jail", kind: "jail", at: [40.4380, -79.9953], open: 1886 },
  { id: "western_pen", name: "Western Penitentiary (Woods Run)", kind: "prison", at: [40.4699, -80.0391], open: 1882 },
  // ward schools
  S("bedford_school", "Bedford School", 40.4292, -79.9894, 1850, { close: 1957 }),
  S("birmingham_school", "Birmingham Public School", 40.4273, -79.9837, 1871, { close: 1944 }),
  S("springfield_school", "Springfield Public School", 40.4601, -79.9723, 1872, { close: 1934 }),
  S("lawrence_school", "Lawrence Public School", 40.4669, -79.9658, 1872, { close: 1939 }),
  S("morse_school", "Samuel F. B. Morse School", 40.4269, -79.9707, 1875, { close: 1979 }),
  S("fulton_school", "Fulton School", 40.4749, -79.9219, 1894),
  S("woolslair_school", "Woolslair School", 40.4633, -79.9572, 1897),
  S("latimer_school", "Latimer School", 40.4561, -80.0011, 1898, { close: 1982 }),
  S("minersville_school", "Minersville Public School", 40.4546, -79.9613, 1902),
  S("allegheny_hs", "Allegheny High School", 40.4531, -80.0089, 1904),
  S("letsche_school", "Letsche School", 40.4448, -79.9880, 1905),
  S("washington_school", "Washington Vocational School", 40.4694, -79.9631, 1908),
  S("lincoln_school", "Lincoln School", 40.4600, -79.9116, 1931),
  S("arsenal_jhs", "Arsenal Junior High School", 40.4675, -79.9628, 1932),
  S("schiller_school", "Schiller School", 40.4565, -79.9931, 1939),
  // Carnegie's branch libraries
  { id: "wylie_library", name: "Wylie Avenue Branch Library", kind: "library", at: [40.4440, -79.9830], open: 1899, close: 1982 },
  { id: "mt_washington_library", name: "Mount Washington Branch Library", kind: "library", at: [40.4317, -80.0070], open: 1900 },
  { id: "hazelwood_library", name: "Hazelwood Branch Library", kind: "library", at: [40.4121, -79.9432], open: 1900 },
  { id: "duquesne_library", name: "Carnegie Free Library of Duquesne", kind: "library", at: [40.3720, -79.8560], open: 1904, demolish: 1968 },
  { id: "east_liberty_library", name: "East Liberty Branch Library", kind: "library", at: [40.4625, -79.9218], open: 1905 },
  { id: "south_side_library", name: "South Side Branch Library", kind: "library", at: [40.4282, -79.9765], open: 1908 },
  { id: "homewood_library", name: "Homewood Branch Library", kind: "library", at: [40.4560, -79.8985], open: 1910 },
  // churches and temples
  { id: "st_paul_downtown", name: "St. Paul Cathedral (Grant Street)", kind: "cathedral", at: [40.4397, -79.9967], open: 1855, demolish: 1903 },
  { id: "st_paul_oakland", name: "St. Paul Cathedral", kind: "cathedral", at: [40.4458, -79.9500], open: 1906 },
  { id: "trinity_cathedral", name: "Trinity Church", kind: "cathedral", at: [40.4414, -79.9986], open: 1872, renames: [[1928, "Trinity Cathedral"]] },
  { id: "first_presbyterian", name: "First Presbyterian Church", kind: "church", at: [40.4415, -79.9991], open: 1905 },
  { id: "st_michael_ss", name: "St. Michael the Archangel Church", kind: "church", at: [40.4248, -79.9800], open: 1861 },
  { id: "st_mary_mercy", name: "St. Mary of Mercy", kind: "church", at: [40.4399, -80.0047], open: 1876 },
  { id: "st_stanislaus", name: "St. Stanislaus Kostka", kind: "church", at: [40.4523, -79.9836], open: 1892 },
  { id: "st_john_ukrainian", name: "St. John the Baptist Ukrainian Catholic Church", kind: "church", at: [40.4285, -79.9919], open: 1895 },
  { id: "st_mary_magdalene", name: "St. Mary Magdalene (Homestead)", kind: "church", at: [40.4058, -79.9100], open: 1895 },
  { id: "st_nicholas_troy", name: "St. Nicholas Croatian Church", kind: "church", at: [40.4625, -79.9850], open: 1901 },
  { id: "st_nicholas_millvale", name: "St. Nicholas Croatian Church (Millvale)", kind: "church", at: [40.4768, -79.9697], open: 1900 },
  { id: "st_john_munhall", name: "St. John the Baptist Greek Catholic Church", kind: "church", at: [40.4062, -79.9010], open: 1903 },
  { id: "immaculate_heart", name: "Immaculate Heart of Mary", kind: "church", at: [40.4564, -79.9678], open: 1905 },
  { id: "rodef_shalom", name: "Rodef Shalom Temple", kind: "hall", at: [40.4481, -79.9436], open: 1907 },
  { id: "sacred_heart", name: "Sacred Heart Church", kind: "church", at: [40.4555, -79.9215], open: 1926 },
  { id: "st_michael_munhall", name: "St. Michael's Slovak Church (Munhall)", kind: "church", at: [40.4060, -79.8990], open: 1927 },
  // downtown life
  { id: "monongahela_house", name: "Monongahela House", kind: "hotel", at: [40.4365, -80.0010], open: 1850, close: 1935, demolish: 1936 },
  { id: "boggs_buhl", name: "Boggs & Buhl", kind: "store", at: [40.4505, -80.0060], open: 1869, close: 1958, demolish: 1960 },
  { id: "allegheny_market", name: "Allegheny Market House", kind: "hall", at: [40.4523, -80.0050], open: 1863, demolish: 1966 },
  { id: "bo_station", name: "B&O Station", kind: "terminal", at: [40.4363, -80.0007], open: 1887, demolish: 1955 },
  { id: "kaufmanns", name: "Kaufmann's", kind: "store", at: [40.4410, -79.9985], open: 1887 },
  { id: "hornes", name: "Joseph Horne Co.", kind: "store", at: [40.4420, -80.0040], open: 1893 },
  { id: "allegheny_post_office", name: "Allegheny Post Office", kind: "hall", at: [40.4525, -80.0072], open: 1897 },
  { id: "ple_station", name: "Pittsburgh & Lake Erie Station", kind: "terminal", at: [40.4336, -80.0039], open: 1901 },
  { id: "fort_pitt_hotel", name: "Fort Pitt Hotel", kind: "hotel", at: [40.4446, -79.9950], open: 1905, demolish: 1967 },
  { id: "nickelodeon", name: "The Nickelodeon", kind: "theatre", at: [40.4394, -79.9993], open: 1905 },
  { id: "gimbels", name: "Gimbel Brothers", kind: "store", at: [40.4418, -79.9983], open: 1914 },
  { id: "william_penn", name: "William Penn Hotel", kind: "hotel", at: [40.4403, -79.9961], open: 1916 },
  { id: "stanley_theatre", name: "Stanley Theatre", kind: "theatre", at: [40.4431, -80.0000], open: 1928 },
  // labour's places
  { id: "bost_building", name: "Bost Building", kind: "hotel", at: [40.4090, -79.9045], open: 1892 },
  { id: "pump_house", name: "Homestead Pump House", kind: "hall", at: [40.4128, -79.8972], open: 1891 },
  { id: "labor_temple", name: "Labor Temple", kind: "hall", at: [40.4420, -79.9905], open: 1910 },
  { id: "uswa_building", name: "United Steelworkers Building", kind: "glasstower", at: [40.4394, -80.0056], open: 1973 },
  // reform and welfare
  { id: "orphan_asylum", name: "Orphan Asylum of Pittsburgh and Allegheny", kind: "hall", at: [40.4560, -80.0145], open: 1850 },
  { id: "kingsley_penn", name: "Kingsley House (Penn Avenue)", kind: "hall", at: [40.4485, -79.9875], open: 1893, close: 1901 },
  { id: "columbian_settlement", name: "Columbian School and Settlement", kind: "hall", at: [40.4430, -79.9830], open: 1895, renames: [[1911, "Irene Kaufmann Settlement"]] },
  { id: "kingsley_hill", name: "Kingsley House", kind: "hall", at: [40.4430, -79.9870], open: 1901, close: 1923 },
  { id: "oliver_baths", name: "Oliver Bath House", kind: "bathhouse", at: [40.4296, -79.9888], open: 1915 },
  // water
  { id: "highland_reservoir", name: "Highland Reservoir", kind: "reservoir", at: [40.4762, -79.9160], open: 1879 },
  { id: "herron_reservoir", name: "Herron Hill Reservoir", kind: "reservoir", at: [40.4555, -79.9565], open: 1880 },
  { id: "herron_pumping", name: "Herron Hill Pumping Station", kind: "hall", at: [40.4519, -79.9532], open: 1896 },
];

/** renames of landmarks that the era files put on the map */
const RENAMES: [string, number, string][] = [
  ["female_college", 1890, "Pennsylvania College for Women"],
  ["female_college", 1955, "Chatham College"],
  ["catholic_college", 1911, "Duquesne University"],
  ["carnegie_tech", 1912, "Carnegie Institute of Technology"],
  ["carnegie_tech", 1967, "Carnegie Mellon University"],
  ["westernu_allegheny", 1908, "University of Pittsburgh (Allegheny)"],
  ["reduction_smallman", 1907, "Alcoa (Smallman Street)"],
  ["alcoa_new_kensington", 1907, "Alcoa New Kensington Works"],
];

export const civicDef = (c: Civic): LandmarkDef => ({ id: c.id, name: c.name, kind: c.kind, place: c.name, at: c.at, hospital: c.hospital });

/** the name a civic landmark goes by in a year */
export function civicName(c: Civic, year: number): string {
  let n = c.name;
  for (const [y, nm] of c.renames ?? []) if (year >= y) n = nm;
  return n;
}

/** everything due by this year: open, rename, close, come down (run on each new year, and at the start) */
export function civicYear(g: GameState, year = cal(g).year, quiet = false) {
  for (const c of g.growthModel === "sleuth" ? [...CIVICS, ...CIVICS_V27] : CIVICS) {
    const placed = g.landmarks.find((l) => l.id === c.id);
    const gone = (c.demolish !== undefined && year >= c.demolish) || (c.close !== undefined && year >= c.close);
    if (!placed && year >= c.open && !gone) {
      if (placeLandmark(g, { ...civicDef(c), name: civicName(c, year) }) && !quiet && year === c.open) log(g, `${civicName(c, year)} opens.`);
      continue;
    }
    if (!placed) continue;
    const name = civicName(c, year);
    if (placed.name !== name) { if (!quiet) log(g, `${placed.name} is now ${name}.`); placed.name = name; }
    if (c.demolish !== undefined && year >= c.demolish && placed.state !== "ruin") { placeLandmark(g, civicDef(c), "ruin"); if (!quiet) log(g, `${name} comes down.`); }
    else if (c.close !== undefined && year >= c.close && placed.state === "open") { placeLandmark(g, civicDef(c), "closed"); if (!quiet) log(g, `${name} closes.`); }
  }
  for (const [id, y, nm] of RENAMES) {
    const l = g.landmarks.find((x) => x.id === id);
    if (l && year >= y && l.name !== nm && !RENAMES.some(([i2, y2]) => i2 === id && y2 > y && year >= y2)) { if (!quiet) log(g, `${l.name} is now ${nm}.`); l.name = nm; }
  }
}
