// Terrain codes — must match tools/mapgen/build_map.py

export const enum Terrain {
  Water = 0,
  Floodplain = 1,
  Flat = 2,
  Slope = 3,
  Steep = 4,
  Upland = 5,
  Cliff = 6,
}

export const TERRAIN_NAMES: Record<number, string> = {
  0: "Water",
  1: "Floodplain",
  2: "Flat",
  3: "Hillside",
  4: "Steep hillside",
  5: "Upland",
  6: "Bluff / cliff",
};

/** Cost multiplier to grade and build heavy industry. Infinity = not allowed. */
export const BUILD_COST_MULT: Record<number, number> = {
  0: Infinity,
  1: 1.0,
  2: 1.1,
  3: 1.8,
  4: Infinity,
  5: 1.2,
  6: Infinity,
};

/** Movement cost for roads (town road generation, logistics). */
export const TRAVEL_COST: Record<number, number> = {
  0: Infinity,
  1: 1.0,
  2: 1.0,
  3: 2.0,
  4: 5.0,
  5: 1.2,
  6: 14.0,
};

export const enum Coal {
  None = 0,
  Underground = 1,
  Outcrop = 2,
}

export function habitable(t: number): boolean {
  return t === Terrain.Floodplain || t === Terrain.Flat || t === Terrain.Slope || t === Terrain.Upland;
}
