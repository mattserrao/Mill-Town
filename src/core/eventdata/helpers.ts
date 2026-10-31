// Helpers for writing event decisions: who gets the card, and options built from the same effects events use.

import type { Decision, DecisionOption } from "../business";
import { applyEffects, cond, type Effect } from "../effects";
import { allWorks, cal, type GameState, totalEmployees } from "../game";
import type { IndustryId } from "../industries";

/** the player has a company and the condition holds (see effects.ts for the condition language) */
export const when = (g: GameState, c?: string) => !!g.company && cond(g, c);
export const hasIndustry = (g: GameState, ...ids: IndustryId[]) => !!g.company && allWorks(g.company).some((w) => ids.includes(w.industry));
export const men = (g: GameState) => (g.company ? totalEmployees(g.company) : 0);
export const year = (g: GameState) => cal(g).year;

/**
 * An option whose consequences are effects (plus an optional cost in cash) and a sentence for the log.
 * The option's source for timed mods is "decision: <label>", so later events can `clear` it by that name.
 */
export function option(label: string, detail: string, effects: Effect[], text: string, cost = 0): DecisionOption {
  return {
    label, detail,
    apply: (g) => {
      if (cost && g.company) g.company.cash -= cost;
      applyEffects(g, `decision: ${label}`, effects);
      return text;
    },
  };
}

/** build a decision card; `historical` is the index of what the real owners did (taken if the player doesn't choose) */
export function decision(id: string, title: string, text: string, options: DecisionOption[], historical: number): Decision {
  return { id, title, text, options, historical };
}
