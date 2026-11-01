// Turns, seasons, eras.

export const SEASONS = ["Spring", "Summer", "Autumn", "Winter"] as const;
export type Season = (typeof SEASONS)[number];

export interface Era {
  id: "I" | "II" | "III" | "IV";
  name: string;
  startYear: number;
  endYear: number; // inclusive
  /** short design note for the era */
  theme: string;
  /** what closes it (the succession comes at the next era's first spring) */
  endsWith: string;
}

/** Four eras, one head of the family each: the succession comes at the first spring of eras II–IV. */
export const ERAS: readonly Era[] = [
  { id: "I", name: "Iron and the Founders", startYear: 1850, endYear: 1892, endsWith: "Homestead",
    theme: "Found the company. Rivers, coal, puddled iron; Bessemer arrives; the Amalgamated rises." },
  { id: "II", name: "Steel and the Trusts", startYear: 1893, endYear: 1919, endsWith: "the Great Steel Strike",
    theme: "Carnegie, Frick and Westinghouse; the 1901 merger; Progressives and the immigrant mill towns." },
  { id: "III", name: "Depression, New Deal and War", startYear: 1920, endYear: 1946, endsWith: "the 1946 strikes",
    theme: "1929, the Wagner Act, SWOC, the Little New Deal, the arsenal of democracy." },
  { id: "IV", name: "Renaissance and Collapse", startYear: 1947, endYear: 1985, endsWith: "the end of the mills",
    theme: "Smoke control and the Renaissance, the 1959 strike, imports, the EPA, the mills close." },
];

export const START_YEAR = ERAS[0].startYear;
export const END_YEAR = ERAS[ERAS.length - 1].endYear;
/** the general wage and price level against 1850 (+1.2% a year): scales action costs, wages and quotes */
export const priceLevel = (year: number) => 1 + (year - 1850) * 0.012;

export const TOTAL_TURNS = (END_YEAR - START_YEAR + 1) * SEASONS.length;

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
