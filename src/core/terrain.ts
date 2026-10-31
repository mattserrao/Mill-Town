// Terrain codes — must match tools/mapgen/build_map.py

export const enum Terrain {
  Water = 0,
  Floodplain = 1,
  Flat = 2,
  Slope = 3,
  Steep = 4,
  Upland = 5,
}

export const TERRAIN_NAMES: Record<number, string> = {
  0: "Water",
  1: "Floodplain",
  2: "Flat",
  3: "Hillside",
  4: "Steep bluff",
  5: "Upland",
};

/** Cost to build heavy industry on this terrain (grading, fill). Infinity = not allowed. */
export const BUILD_COST_MULT: Record<number, number> = {
  0: Infinity,
  1: 1.0,
  2: 1.1,
  3: 1.8,
  4: Infinity,
  5: 1.2,
};

/** Movement cost for roads / paths (used by town road generation and logistics). */
export const TRAVEL_COST: Record<number, number> = {
  0: Infinity,
  1: 1.0,
  2: 1.0,
  3: 2.2,
  4: 6.0,
  5: 1.3,
};

export const enum Coal {
  None = 0,
  Underground = 1,
  Outcrop = 2,
}
