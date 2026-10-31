// All event effects and decisions, merged from the era files. Each era file is keyed by Event Name.

import { type Decision, DECISIONS as LABOUR_DECISIONS } from "../business";
import type { Effect, Rule } from "../effects";
import type { LandmarkDef } from "../landmarks";
import type { GameState } from "../game";
import * as era1 from "./era1";
import * as era2 from "./era2";
import * as era3 from "./era3";
import * as era4 from "./era4";

export type DecisionFn = (g: GameState) => Decision | null;

const ERAS = [era1, era2, era3, era4];

let effects: Record<string, Effect[]> | null = null;
let decisions: Record<string, DecisionFn> | null = null;

export function allEffects(): Record<string, Effect[]> {
  if (effects) return effects;
  effects = {};
  for (const e of ERAS) for (const [k, v] of Object.entries(e.EFFECTS)) effects[k] = [...(effects[k] ?? []), ...v];
  return effects;
}

export function allDecisions(): Record<string, DecisionFn> {
  if (decisions) return decisions;
  decisions = { ...LABOUR_DECISIONS };
  for (const e of ERAS) Object.assign(decisions, e.DECISIONS);
  return decisions;
}

/** places named by the era files */
export function allPlaces(): [string, number, number, number][] { return ERAS.flatMap((e) => e.PLACES); }

let landmarks: LandmarkDef[] | null = null;
export function allLandmarks(): LandmarkDef[] {
  if (!landmarks) landmarks = ERAS.flatMap((e) => e.LANDMARKS);
  return landmarks;
}

/** what's allowed at the start of 1850 (later events change these: see the `rule` effects) */
export function initialRules(): Record<string, Rule> {
  return {
    // no union to deal with until the puddlers organise (Sons of Vulcan, 1858)
    union: { blocked: "No union yet (the Sons of Vulcan form in 1858)" },
    // company police need a state commission (1865)
    police: { blocked: "Private police need a state commission (from 1865)" },
    // lockouts need a union to lock out
    lockout: { blocked: "No union to lock out yet" },
    halfHoliday: { blocked: "No one gives Saturday afternoons off yet (Westinghouse is first, 1871)" },
    scale: { blocked: "No sliding scale yet (the Vulcans win the first in 1864)" },
    advertise: { blocked: "Radio advertising begins with KDKA (1920)" },
    lab: { blocked: "Industrial research laboratories begin in 1906 (Westinghouse)" },
    contract_research: { blocked: "The Mellon Institute opens in 1913" },
    relief: { blocked: "Relief committees form in hard times (from the Crash of 1929)" },
    endow: { blocked: "The university looks for patrons once Mellon joins its board (1894)" },
    ura: { blocked: "The Urban Redevelopment Authority is formed in 1946" },
    retrain: { blocked: "Retraining begins with the Community College (1966)" },
    sell_workers: { blocked: "Employee buy-outs begin with Weirton (1983)" },
    sell_authority: { blocked: "The Steel Valley Authority forms in 1985" },
    bribe: { risk: 0.2, yield: 1 },
    lobby: { yield: 1 },
  };
}
