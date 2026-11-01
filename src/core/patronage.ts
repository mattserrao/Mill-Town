// Great works you can found ahead of history: the universities, schools, libraries, hospitals, museums and parks
// that the valley got on their historical dates. Each opens to you as an opportunity some years before its date;
// fund it and it opens now (your gift: reputation, influence or morale, and whatever it does for the town:
// hospitals soften epidemics, parks raise land values around them). If nobody funds it, history builds it.

import { bump } from "./business";
import { allEffects, allLandmarks } from "./eventdata";
import { CIVICS, civicDef } from "./civic";
import { EVENTS } from "./events";
import { PARKS } from "./features";
import { cal, type GameState, log } from "./game";
import { type LandmarkDef, type LandmarkKind, placeLandmark } from "./landmarks";
import { latLonToTile } from "./features";
import { priceLevel } from "./time";
import { layPark } from "./town";
import type { Meters } from "./business";

/** how many years ahead of history a great work can be founded */
export const WINDOW = 15;

/** what each kind costs (1850 dollars) and gives you */
const KINDS: Partial<Record<LandmarkKind | "park", { cost: number; give: Partial<Meters> & { morale?: number }; word: string }>> = {
  library: { cost: 40000, give: { reputation: 6, morale: 2 }, word: "Library" },
  school: { cost: 20000, give: { reputation: 4, labour: 3 }, word: "School" },
  college: { cost: 120000, give: { reputation: 5, influence: 6 }, word: "College" },
  tower: { cost: 300000, give: { reputation: 8, influence: 8 }, word: "University" },
  hospital: { cost: 80000, give: { reputation: 8, labour: 3 }, word: "Hospital" },
  museum: { cost: 150000, give: { reputation: 8, morale: 3 }, word: "Museum" },
  conservatory: { cost: 50000, give: { reputation: 5, morale: 3 }, word: "Conservatory" },
  observatory: { cost: 40000, give: { reputation: 4, influence: 2 }, word: "Observatory" },
  planetarium: { cost: 100000, give: { reputation: 5, morale: 3 }, word: "Planetarium" },
  zoo: { cost: 60000, give: { reputation: 4, morale: 4 }, word: "Zoo" },
  theatre: { cost: 90000, give: { reputation: 5, morale: 3 }, word: "Theatre" },
  fountain: { cost: 15000, give: { reputation: 2, morale: 2 }, word: "Fountain" },
  park: { cost: 20000, give: { reputation: 4, morale: 4 }, word: "Park" },
};

export interface GreatWork {
  id: string;
  name: string;
  kind: LandmarkKind | "park";
  word: string;
  /** the year history builds it */
  year: number;
  place: string;
  /** where it stands (or will) on the map */
  x?: number; y?: number;
  /** built: by history or by you (the year you funded it) */
  built?: boolean; funded?: number; state?: "open" | "closed" | "ruin";
  cost: number;
  give: Partial<Meters> & { morale?: number };
}

let table: { id: string; year: number; def?: LandmarkDef; park?: (typeof PARKS)[number] }[] | null = null;
/** every great work with the year history builds it (first event that opens it) */
function works() {
  if (table) return table;
  const fx = allEffects(), defs = allLandmarks();
  const seen = new Map<string, number>();
  for (const e of EVENTS) for (const ef of fx[e.name] ?? []) {
    if (!("landmark" in ef) || (ef.state && ef.state !== "open")) continue;
    if (!seen.has(ef.landmark)) seen.set(ef.landmark, e.year);
  }
  table = [];
  for (const [id, year] of seen) {
    const def = defs.find((d) => d.id === id);
    if (def && KINDS[def.kind]) table.push({ id, year, def });
  }
  for (const pk of PARKS) table.push({ id: `park:${pk.name}`, year: pk.year, park: pk });
  // the civic landmarks on their real dates (towers rise with their companies: not yours to found)
  for (const c of CIVICS) if (KINDS[c.kind] && !c.hq && c.open > 1850) table.push({ id: c.id, year: c.open, def: civicDef(c) });
  table.sort((a, b) => a.year - b.year);
  return table;
}

export function greatWorks(g: GameState): GreatWork[] {
  const pl = priceLevel(cal(g).year);
  return works().map(({ id, year, def, park }) => {
    const k = KINDS[def ? def.kind : "park"]!;
    const placed = def ? g.landmarks.find((l) => l.id === id) : undefined;
    let x = placed ? placed.x + placed.size / 2 : undefined, y = placed ? placed.y + placed.size / 2 : undefined;
    if (park) [x, y] = latLonToTile(g.map, park.lat, park.lon);
    const built = def ? !!placed : g.world.parks?.includes(park!.name) || g.world.year >= year;
    const area = park ? Math.PI * (park.radiusM / g.map.metersPerTile) ** 2 : 0;
    return {
      id, name: def ? def.name : park!.name, kind: def ? def.kind : "park", word: k.word, year, place: def ? def.place : park!.name,
      x, y, built, funded: g.funded?.[id], state: placed?.state ?? (built ? "open" : undefined),
      cost: Math.round(((k.cost + area * 12) * pl) / 1000) * 1000, give: k.give,
    };
  });
}

/** null if you can fund it now, otherwise why not */
export function fundBlocked(g: GameState, w: GreatWork): string | null {
  const c = g.company, y = cal(g).year;
  if (!c) return "Found your company first";
  if (w.built) return "Already built";
  if (y < w.year - WINDOW) return `Can be founded from ${w.year - WINDOW}`;
  if (c.biz.actionsLeft <= 0) return "No actions left this season";
  if (c.cash < w.cost) return `Needs $${w.cost.toLocaleString("en-US")}`;
  return null;
}

/** Found it now: it opens on the map, with your name on it. */
export function fund(g: GameState, id: string): { ok: boolean; text: string } {
  const w = greatWorks(g).find((x) => x.id === id);
  if (!w) return { ok: false, text: "No such work" };
  const why = fundBlocked(g, w);
  if (why) return { ok: false, text: why };
  const c = g.company!;
  if (w.kind === "park") {
    const pk = PARKS.find((p) => `park:${p.name}` === id)!;
    layPark(g.map, g.world, pk);
    (g.world.parks ??= []).push(pk.name);
  } else {
    const civ = CIVICS.find((x) => x.id === id);
    const def = civ ? civicDef(civ) : allLandmarks().find((d) => d.id === id)!;
    if (!placeLandmark(g, def)) return { ok: false, text: `No ground for it at ${def.place}` };
  }
  c.cash -= w.cost;
  c.biz.actionsLeft--;
  (g.funded ??= {})[id] = cal(g).year;
  for (const [k, v] of Object.entries(w.give)) {
    if (k === "morale") g.morale = Math.min(100, g.morale + v!);
    else bump(g, k as keyof Meters, v!);
  }
  g.world.version++;
  const early = w.year - cal(g).year;
  log(g, `${c.name} founds ${w.name}${early > 0 ? `, ${early} year${early > 1 ? "s" : ""} before the city would have` : ""}.`);
  c.biz.record.push(`${cal(g).season} ${cal(g).year}: founded ${w.name}`);
  return { ok: true, text: `${w.name} opens.` };
}

export const giveText = (give: GreatWork["give"]) =>
  Object.entries(give).map(([k, v]) => `${{ reputation: "Rep", labour: "Lab", influence: "Inf", morale: "Mor" }[k]} +${v}`);
