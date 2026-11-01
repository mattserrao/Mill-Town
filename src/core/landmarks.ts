// Dated landmarks: buildings history puts on the map (hospitals, libraries, colleges, ballparks, stadiums, the
// Civic Arena…). Each is placed in its year at a named place (src/core/places.ts), clearing homes in the way, and
// can later close or fall to ruin. Defined in the era files (src/core/eventdata) and fired by `landmark` effects.
// Sprites are struct:<kind> in src/render/sprites.ts.

import { STRUCTURES, type StructureKind, Use } from "./town";
import type { GameState } from "./game";
import { cal, log } from "./game";
import { inBounds } from "./map";
import { latLonToTile } from "./features";
import { type Place, placeNamed } from "./places";
import { Terrain } from "./terrain";

export type LandmarkKind = Exclude<StructureKind, "" | "blockhouse" | "courthouse" | "arsenal" | "penitentiary" | "ruin1" | "ruin2" | "ruin3" | "ruin4">;

/** footprint edge in tiles for each kind (the sprite is drawn to fit) */
export const LANDMARK_SIZE: Record<LandmarkKind, number> = {
  hospital: 2, library: 2, college: 2, tower: 2, museum: 3, conservatory: 2, ballpark: 3, stadium: 4, arena: 3, terminal: 2,
  chapel: 1, school: 2, theatre: 1, observatory: 1, zoo: 2, amusement: 3, airport: 4, plant: 3, office: 2, housing: 3,
  fountain: 1, factory: 2, shipyard: 3, planetarium: 1, church: 1, hall: 1,
  skyscraper: 1, skytower: 2, glasstower: 2, lab: 3, reactor: 3,
};

export interface LandmarkDef {
  id: string;
  name: string;
  kind: LandmarkKind;
  /** a named place (places.ts) */
  place: string;
  /** or its real position (latitude, longitude): it stands as close to it as the ground allows */
  at?: [number, number];
  /** or a tile (buildings the player puts up beside a works) */
  tile?: [number, number];
  /** what it does: hospitals improve health nearby and halve epidemic losses */
  hospital?: boolean;
}

export interface PlacedLandmark { id: string; name: string; kind: LandmarkKind; x: number; y: number; size: number; state: "open" | "closed" | "ruin"; year: number }

/** Put a landmark on the map near its place (or change its state). Returns false if no ground was found. */
export function placeLandmark(g: GameState, def: LandmarkDef, state: "open" | "closed" | "ruin" = "open"): boolean {
  const have = g.landmarks.find((l) => l.id === def.id);
  if (have) { setState(g, have, state); return true; }
  if (state !== "open") return false;
  const p: Place | null = def.tile ? { name: def.place, x: def.tile[0], y: def.tile[1], r: 1 }
    : def.at ? (() => { const [x, y] = latLonToTile(g.map, def.at![0], def.at![1]); return { name: def.place, x, y, r: 1 }; })()
    : placeNamed(g.map, def.place);
  if (!p) { log(g, `(${def.name}: no place called ${def.place})`); return false; }
  const size = LANDMARK_SIZE[def.kind];
  const m = g.map, w = g.world;
  let best: [number, number] | null = null, bs = Infinity;
  const R = def.at || def.tile ? 10 : Math.max(8, Math.ceil(p.r) + 10);
  for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
    const x: number = p.x + dx, y: number = p.y + dy;
    let ok = true, cost = Math.hypot(dx, dy);
    for (let j = 0; j < size && ok; j++) for (let k = 0; k < size; k++) {
      const xx: number = x + k, yy: number = y + j;
      if (!inBounds(m, xx, yy)) { ok = false; break; }
      const i = yy * m.width + xx, u = w.use[i];
      if (m.terrain[i] === Terrain.Water || m.terrain[i] === Terrain.Cliff || m.rail[i] || m.bridge[i] || w.owner[i]) { ok = false; break; }
      if (u === Use.Industry || u === Use.Rival || u === Use.Landmark || u === Use.Civic || u === Use.Incline || u === Use.Wharf || u === Use.Mine) { ok = false; break; }
      cost += w.pop[i] * 0.05 + (m.terrain[i] === Terrain.Steep ? 6 : 0) + (u === Use.Park ? 3 : 0);
    }
    if (ok && cost < bs) { bs = cost; best = [x, y]; }
  }
  if (!best) { log(g, `(${def.name}: no room near ${def.place})`); return false; }
  const [x0, y0] = best;
  const sidx = STRUCTURES.indexOf(def.kind);
  for (let j = 0; j < size; j++) for (let k = 0; k < size; k++) {
    const i = (y0 + j) * m.width + x0 + k;
    w.use[i] = Use.Landmark; w.pop[i] = 0; w.street[i] = 0; w.sub[i] = 0; w.built[i] = cal(g).year;
    w.structure[i] = j === size - 1 && k === size - 1 ? sidx : 255;
  }
  w.version++;
  g.landmarks.push({ id: def.id, name: def.name, kind: def.kind, x: x0, y: y0, size, state: "open", year: cal(g).year });
  return true;
}

function setState(g: GameState, l: PlacedLandmark, state: "open" | "closed" | "ruin") {
  if (l.state === state) return;
  l.state = state;
  const m = g.map, w = g.world;
  const kind = state === "ruin" ? (`ruin${Math.min(4, l.size)}` as StructureKind) : l.kind;
  const i = (l.y + l.size - 1) * m.width + l.x + l.size - 1;
  w.structure[i] = STRUCTURES.indexOf(kind);
  w.version++;
}

/** hospitals that are open: their tiles and reach (for health and epidemics) */
export function hospitals(g: GameState): { x: number; y: number }[] {
  return g.landmarks.filter((l) => l.state === "open" && l.kind === "hospital").map((l) => ({ x: l.x, y: l.y }));
}
