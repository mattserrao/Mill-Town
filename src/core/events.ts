// Historical events: read from docs/EVENTS.csv (the master list), fired at the start of their season.
// Effects are matched by Event Name; events without an entry are headlines only.

import csvText from "../../docs/EVENTS.csv?raw";
import type { Season } from "./time";

export interface HistEvent { year: number; season: Season; name: string; description: string }

/** Minimal RFC 4180 CSV parser (quoted fields, doubled quotes, commas and newlines inside quotes). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], field = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else q = false; }
      else field += c;
    } else if (c === '"') q = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field); field = "";
      if (row.some((f) => f !== "")) rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some((f) => f !== "")) rows.push(row);
  return rows;
}

export const EVENTS: HistEvent[] = parseCsv(csvText).slice(1).map((r) => ({
  year: Number(r[0]), season: r[1] as Season, name: r[2], description: r[3],
}));

export type ModKind = "price" | "strike" | "wage" | "migrants" | "pollution" | "output";

export interface Mod { kind: ModKind; mult: number; until: number; source: string }

export type Effect =
  | { mods: [ModKind, number, number][] } // kind, multiplier, duration in seasons
  | { flood: number }                      // floodplain output multiplier this season
  | { epidemic: number };                  // share of residents lost in crowded tiles

/** Gameplay effects keyed by Event Name (see docs/EVENTS.md). */
export const EFFECTS: Record<string, Effect[]> = {
  "Panic of 1857": [{ mods: [["price", 0.72, 8]] }],
  "Panic of 1873": [{ mods: [["price", 0.7, 16], ["wage", 0.85, 16]] }],
  "Panic of 1893": [{ mods: [["price", 0.72, 12], ["wage", 0.85, 12]] }],
  "Panic of 1907": [{ mods: [["price", 0.8, 6]] }],
  "The Crash": [{ mods: [["price", 0.6, 28], ["output", 0.55, 28], ["migrants", 0.3, 28]] }],
  "Civil War Begins": [{ mods: [["price", 1.35, 16]] }],
  "War in Europe": [{ mods: [["price", 1.3, 16], ["migrants", 0.3, 16]] }],
  "America Enters the War": [{ mods: [["price", 1.25, 7], ["output", 1.1, 7]] }],
  "War in Europe Again": [{ mods: [["price", 1.15, 9]] }],
  "Pearl Harbor": [{ mods: [["price", 1.3, 15], ["output", 1.15, 15]] }],
  "Great Railroad Strike": [{ mods: [["strike", 4, 2]] }],
  "Battle of Homestead": [{ mods: [["strike", 3, 4]] }],
  "Pressed Steel Car Strike": [{ mods: [["strike", 2, 2]] }],
  "Great Steel Strike": [{ mods: [["strike", 8, 2]] }],
  "Postwar Steel Strike": [{ mods: [["strike", 8, 1]] }],
  "Truman Seizes the Mills": [{ mods: [["strike", 6, 2]] }],
  "116-Day Strike": [{ mods: [["strike", 10, 2], ["price", 0.9, 12]] }],
  "Big Steel Signs": [{ mods: [["wage", 1.15, 200]] }],
  "Eight-Hour Day": [{ mods: [["wage", 1.1, 200]] }],
  "Natural Gas Boom": [{ mods: [["pollution", 0.6, 24]] }],
  "Smoke Control Enforced": [{ mods: [["pollution", 0.45, 400]] }],
  "St. Patrick's Day Flood": [{ flood: 0.35 }],
  "Cholera Epidemic": [{ epidemic: 0.04 }],
  "Influenza": [{ epidemic: 0.03 }],
  "Immigration Restricted": [{ mods: [["migrants", 0.6, 400]] }],
  "National Origins Act": [{ mods: [["migrants", 0.7, 400]] }],
  "Closures Announced": [{ mods: [["price", 0.85, 30]] }],
  "The Bottom Falls Out": [{ mods: [["price", 0.75, 20], ["output", 0.7, 20]] }],
};

export function eventsFor(year: number, season: Season): HistEvent[] {
  return EVENTS.filter((e) => e.year === year && e.season === season);
}

/** Product of active modifiers of a kind. */
export function modMult(mods: Mod[], kind: ModKind, turn: number): number {
  let m = 1;
  for (const x of mods) if (x.kind === kind && turn < x.until) m *= x.mult;
  return m;
}
