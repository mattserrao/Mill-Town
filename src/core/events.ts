// Historical events: read from docs/EVENTS.csv (the master list), fired at the start of their season.
// Effects are matched by Event Name; events without an entry are headlines only.

import type { Effect } from "./effects";
import type { Good, IndustryId } from "./industries";
import csvText from "../../docs/EVENTS.csv?raw";
import type { Season } from "./time";

export const CATEGORIES = [
  "Industry", "Economy", "Labor", "Politics", "Parks", "Libraries", "Universities",
  "Culture", "Health", "Infrastructure", "Disaster", "Society",
] as const;
export type Category = (typeof CATEGORIES)[number];

export interface HistEvent { year: number; season: Season; name: string; description: string; category: Category }

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
  year: Number(r[0]), season: r[1] as Season, name: r[2], description: r[3], category: (r[4] || "Society") as Category,
}));

/**
 * price, wage, strike, output, input (purchase price of raw materials), migrants, pollution (region-wide smoke),
 * labour (share of the pool willing to work), freightCost / freightCap (by gateway), riverLoad (sewage),
 * floodRisk (flood damage and odds, by river gateway)
 */
export type ModKind = "price" | "strike" | "wage" | "migrants" | "pollution" | "output" | "input" | "labour" | "freightCost" | "freightCap" | "riverLoad" | "floodRisk";

/** A timed multiplier. With a scope (industry, good, gateway) it applies only where that matches. */
export interface Mod { kind: ModKind; mult: number; until: number; source: string; industry?: IndustryId[]; good?: Good; gateway?: string }

export interface ModContext { industry?: IndustryId; good?: Good; gateway?: string }

/** Gameplay effects keyed by Event Name (see docs/EVENTS.md). */
/** Event effects now live in src/core/eventdata/ (one file per era); kept here for older imports. */
export const EFFECTS: Record<string, Effect[]> = {};

export function eventsFor(year: number, season: Season): HistEvent[] {
  return EVENTS.filter((e) => e.year === year && e.season === season);
}

/** Product of active modifiers of a kind. */
export function modMult(mods: Mod[], kind: ModKind, turn: number, ctx: ModContext = {}): number {
  let m = 1;
  for (const x of mods) {
    if (x.kind !== kind || turn >= x.until) continue;
    if (x.industry && (!ctx.industry || !x.industry.includes(ctx.industry))) continue;
    if (x.good && x.good !== ctx.good) continue;
    if (x.gateway && x.gateway !== ctx.gateway) continue;
    m *= x.mult;
  }
  return m;
}
