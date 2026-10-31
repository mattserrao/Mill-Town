// Turns, seasons, eras.

export const SEASONS = ["Spring", "Summer", "Autumn", "Winter"] as const;
export type Season = (typeof SEASONS)[number];

export interface Era {
  id: "I" | "II" | "III";
  name: string;
  startYear: number;
  endYear: number; // inclusive
  /** short design note for the era */
  theme: string;
}

export const ERAS: readonly Era[] = [
  {
    id: "I",
    name: "Iron, Coal & Steam",
    startYear: 1850,
    endYear: 1889,
    theme: "Found the company. River logistics, coal, puddled iron, Bessemer arrives.",
  },
  {
    id: "II",
    name: "The Age of Steel",
    startYear: 1890,
    endYear: 1944,
    theme: "Scale up. Mid-game: buy into other industries. Labor wars, electrification, two world wars.",
  },
  {
    id: "III",
    name: "Peak & Collapse",
    startYear: 1945,
    endYear: 1985,
    theme: "Postwar peak, then imports, obsolete plant and the collapse. Survive it — or manage the fall.",
  },
];

export const START_YEAR = ERAS[0].startYear;
export const END_YEAR = ERAS[ERAS.length - 1].endYear;
export const TOTAL_TURNS = (END_YEAR - START_YEAR + 1) * SEASONS.length;
/** Buying into a second industry unlocks at the start of Era II. */
export const DIVERSIFY_YEAR = ERAS[1].startYear;

export interface Calendar {
  turn: number;
  year: number;
  season: Season;
  era: Era;
}

export function calendar(turn: number): Calendar {
  const year = START_YEAR + Math.floor(turn / SEASONS.length);
  const season = SEASONS[turn % SEASONS.length];
  const era = ERAS.find((e) => year >= e.startYear && year <= e.endYear) ?? ERAS[ERAS.length - 1];
  return { turn, year, season, era };
}

/** Seasonal effects on logistics and risk. */
export const SEASON_EFFECTS: Record<Season, { river: number; floodRisk: number; note: string }> = {
  Spring: { river: 1.0, floodRisk: 0.12, note: "High water. Floodplain sites may flood." },
  Summer: { river: 0.8, floodRisk: 0.02, note: "Low water slows barges." },
  Autumn: { river: 1.0, floodRisk: 0.03, note: "Good river season." },
  Winter: { river: 0.5, floodRisk: 0.05, note: "Ice on the rivers. Barge traffic halved." },
};
