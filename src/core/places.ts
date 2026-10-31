// Named places that events refer to: neighbourhoods, towns, map landmarks and a few extra places the
// neighbourhood list doesn't name (Homewood, the Lower Hill, West Homestead…), plus the stand-in sites where
// places beyond the map edge are put so they can be built and seen (the Observatory, Neville Island, Donora…).

import { ANCHORS } from "./ancestry";
import { districts } from "./districts";
import { allPlaces } from "./eventdata";
import { HILLSIDES, latLonToTile } from "./features";
import type { GameMap } from "./map";

export interface Place { name: string; x: number; y: number; r: number }

/** extra named places: [name, lat, lon, radius m] */
export const EXTRA_PLACES: [string, number, number, number][] = [
  ["Homewood", 40.4555, -79.8990, 800],
  ["Lower Hill", 40.4415, -79.9900, 450],
  ["Upper Hill", 40.4495, -79.9700, 600],
  ["West Homestead", 40.3995, -79.9130, 500],
  ["Wilkinsburg", 40.4415, -79.8820, 800],
  ["North Side", 40.4540, -80.0060, 1100],
  ["Squirrel Hill", 40.4380, -79.9230, 1000],
  ["Shadyside", 40.4540, -79.9350, 700],
  ["Oakland", 40.4440, -79.9560, 800],
  ["Beltzhoover", 40.4210, -80.0000, 500],
  ["South Hills", 40.4040, -80.0250, 1500],
  ["East Pittsburgh", 40.3960, -79.8390, 600],
  ["Swissvale", 40.4230, -79.8830, 700],
  ["Mon Valley", 40.3700, -79.8800, 4000],
  ["Downtown", 40.4410, -79.9970, 700],
  ["The Point", 40.4415, -80.0080, 350],
  ["Clairton", 40.2950, -79.8820, 1200],
];

/**
 * Stand-in sites for places beyond the map edge: the real place, and where on the map it is put (an under-used
 * hillside, river bank or valley of the same character). Events and landmarks use the real name.
 */
export const STAND_INS: { name: string; real: string; lat: number; lon: number; r: number; why: string }[] = [
  { name: "Allegheny Observatory", real: "Riverview Park, Allegheny", lat: 40.4700, lon: -80.0180, r: 300, why: "the high ground on the north edge of Allegheny" },
  { name: "Riverview Park", real: "Observatory Hill", lat: 40.4710, lon: -80.0150, r: 600, why: "the wooded hilltop at the north edge of the map" },
  { name: "Highland Park", real: "Highland Park, by the reservoirs", lat: 40.4740, lon: -79.9150, r: 700, why: "the open ridge north-east of East Liberty" },
  { name: "Highland Park Zoo", real: "Highland Park", lat: 40.4735, lon: -79.9200, r: 250, why: "inside the Highland Park stand-in" },
  { name: "Creighton", real: "Creighton, up the Allegheny", lat: 40.4740, lon: -79.9610, r: 400, why: "the Allegheny bank at the north edge above Lawrenceville" },
  { name: "Sharpsburg", real: "Sharpsburg, across the Allegheny", lat: 40.4760, lon: -79.9450, r: 400, why: "the Allegheny bank at the north-east edge" },
  { name: "New Kensington", real: "New Kensington, up the Allegheny", lat: 40.4750, lon: -79.9300, r: 500, why: "the north-east corner by the Allegheny" },
  { name: "Neville Island", real: "Neville Island, down the Ohio", lat: 40.4620, lon: -80.0700, r: 500, why: "the Ohio shore at the west edge" },
  { name: "McKees Rocks", real: "McKees Rocks, down the Ohio", lat: 40.4660, lon: -80.0600, r: 500, why: "the Ohio shore below the West End" },
  { name: "Ambridge", real: "Ambridge, down the Ohio", lat: 40.4560, lon: -80.0750, r: 500, why: "the far west of the map along the Ohio" },
  { name: "Aliquippa", real: "Aliquippa, down the Ohio", lat: 40.4500, lon: -80.0780, r: 500, why: "the Ohio's west edge" },
  { name: "Wilmerding", real: "Wilmerding, up Turtle Creek", lat: 40.4000, lon: -79.8350, r: 400, why: "the Turtle Creek valley at the east edge" },
  { name: "Donora", real: "Donora, up the Monongahela", lat: 40.2900, lon: -79.8600, r: 500, why: "the Mon valley at the south edge" },
  { name: "Johnstown", real: "Johnstown, east over the mountains", lat: 40.3000, lon: -79.8350, r: 400, why: "the south-east corner" },
  { name: "Elrama", real: "Elrama, up the Monongahela", lat: 40.2880, lon: -79.8950, r: 400, why: "the Mon at the south edge" },
  { name: "Shippingport", real: "Shippingport, down the Ohio", lat: 40.4480, lon: -80.0790, r: 400, why: "the west edge on the Ohio" },
  { name: "North Park", real: "North Park, McCandless", lat: 40.4720, lon: -80.0350, r: 700, why: "the north-west hills" },
  { name: "South Park", real: "South Park, Bethel Park", lat: 40.3000, lon: -80.0000, r: 900, why: "the southern hills" },
  { name: "Boyce Park", real: "Boyce Park, Monroeville", lat: 40.4300, lon: -79.8350, r: 600, why: "the eastern hills" },
  { name: "Hartwood Acres", real: "Hartwood Acres, Hampton", lat: 40.4720, lon: -79.9050, r: 500, why: "the north-east hills" },
  { name: "Settlers Cabin", real: "Settlers Cabin Park, Robinson", lat: 40.4300, lon: -80.0750, r: 600, why: "the western hills" },
  { name: "New Stanton", real: "New Stanton, Westmoreland County", lat: 40.3200, lon: -79.8380, r: 500, why: "the south-east hills" },
  { name: "Greater Pittsburgh Airport", real: "Moon Township", lat: 40.3500, lon: -80.0700, r: 600, why: "the flat uplands of the south-west" },
  { name: "Kennywood", real: "West Mifflin (on the map)", lat: 40.3870, lon: -79.8640, r: 300, why: "on the bluff above the Mon" },
  { name: "Weirton", real: "Weirton, West Virginia", lat: 40.4520, lon: -80.0810, r: 300, why: "the far west edge" },
];

const cache = new WeakMap<GameMap, Map<string, Place>>();

/** look a place up by name (null if unknown) */
export function placeNamed(m: GameMap, name: string): Place | null {
  let map = cache.get(m);
  if (!map) {
    map = new Map();
    const add = (name: string, lat: number, lon: number, rM: number) => { const [x, y] = latLonToTile(m, lat, lon); map!.set(name.toLowerCase(), { name, x: clampX(m, x), y: clampY(m, y), r: rM / m.metersPerTile }); };
    for (const [n, la, lo, r] of EXTRA_PLACES) add(n, la, lo, r);
    for (const [n, la, lo, r] of allPlaces()) add(n, la, lo, r);
    for (const s of STAND_INS) add(s.name, s.lat, s.lon, s.r);
    for (const a of ANCHORS) add(a.name, a.lat, a.lon, a.radiusM);
    for (const h of HILLSIDES) add(h.name, h.lat, h.lon, h.radiusM);
    const d = districts(m);
    for (const nb of d.nbs) if (!map.has(nb.name.toLowerCase())) map.set(nb.name.toLowerCase(), { name: nb.name, x: nb.x, y: nb.y, r: 30 });
    for (const l of m.landmarks) {
      const short = l.name.replace(/ \(.*\)$/, "");
      if (!map.has(l.name.toLowerCase())) map.set(l.name.toLowerCase(), { name: l.name, x: l.x, y: l.y, r: l.kind === "town" ? 35 : 12 });
      if (!map.has(short.toLowerCase())) map.set(short.toLowerCase(), { name: short, x: l.x, y: l.y, r: l.kind === "town" ? 35 : 12 });
    }
    cache.set(m, map);
  }
  return map.get(name.toLowerCase()) ?? null;
}

const clampX = (m: GameMap, x: number) => Math.max(2, Math.min(m.width - 3, x));
const clampY = (m: GameMap, y: number) => Math.max(2, Math.min(m.height - 3, y));
