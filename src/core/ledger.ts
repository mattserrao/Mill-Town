// The family ledger: what the valley remembers about your family. Every lasting act leaves a mark — a grievance
// or trust with the men, a favour or a debt in politics, a grudge with a rival owner, a precedent later choices
// read. Marks fade (about a third in a generation) except martyrs and precedents, which never do; at each
// succession the heir inherits them, a little weaker. Later cards read the ledger and say why: "because your
// father sent the Pinkertons".

import { cal, type GameState } from "./game";

export type LedgerSide = "labour" | "public" | "politics" | "owners" | `rival:${string}`;
export type MarkKind = "grievance" | "trust" | "favour" | "grudge" | "precedent";

export interface Mark {
  id: string;
  year: number;
  /** which head of the family made it (0 = the founder) */
  gen: number;
  side: LedgerSide;
  kind: MarkKind;
  weight: number;
  /** what was done, as a clause: "sent the Pinkertons to the works" */
  text: string;
  /** never fades (martyrs, precedents) */
  permanent?: boolean;
  /** men killed */
  martyrs?: number;
  /** the office-holder or rival it concerns */
  who?: string;
}

export type MarkSpec = Omit<Mark, "year" | "gen"> & { year?: number };

export const ledgerOf = (g: GameState): Mark[] => (g.ledger ??= []);
export const generation = (g: GameState) => Math.max(0, (g.family?.heads.length ?? 1) - 1);

/** Leave a mark. The same id again adds to it (a second picnic, another death in the furnaces). */
export function mark(g: GameState, m: MarkSpec): Mark {
  const L = ledgerOf(g), y = cal(g).year;
  const old = L.find((x) => x.id === m.id);
  // a precedent is set once: later cards remember the first time
  if (old?.kind === "precedent") return old;
  if (old) {
    old.weight = Math.min(100, old.weight + m.weight);
    old.year = m.year ?? y; old.gen = generation(g); old.text = m.text;
    if (m.martyrs) old.martyrs = (old.martyrs ?? 0) + m.martyrs;
    return old;
  }
  const n: Mark = { ...m, year: m.year ?? y, gen: generation(g), weight: Math.min(100, m.weight) };
  if (n.martyrs || n.kind === "precedent") n.permanent = true;
  L.push(n);
  return n;
}

export const hasMark = (g: GameState, id: string) => ledgerOf(g).find((m) => m.id === id);
export const anyMark = (g: GameState, ...ids: string[]) => ids.map((id) => hasMark(g, id)).find((m) => m);

const SIGN: Record<MarkKind, number> = { trust: 1, favour: 1, grievance: -1, grudge: -1, precedent: 0 };

/** what a side thinks of the family, from the marks (negative: they hold it against you); martyrs weigh 10 each */
export function standing(g: GameState, side: LedgerSide): number {
  let s = 0;
  for (const m of ledgerOf(g)) if (m.side === side) s += SIGN[m.kind] * m.weight - (m.martyrs ?? 0) * 10;
  return s;
}

/** total of one kind for one side */
export const weightOf = (g: GameState, side: LedgerSide, kind: MarkKind) => ledgerOf(g).filter((m) => m.side === side && m.kind === kind).reduce((s, m) => s + m.weight, 0);
export const martyrsOf = (g: GameState) => ledgerOf(g).reduce((s, m) => s + (m.martyrs ?? 0), 0);

/** "you", "your father", "your grandmother"… for a mark made by an earlier head */
export function whoDid(g: GameState, m: Mark): string {
  const d = generation(g) - m.gen;
  if (d <= 0) return "you";
  const head = g.family?.heads[m.gen];
  const parent = head?.sex === "f" ? "mother" : "father";
  const grand = head?.sex === "f" ? "grandmother" : "grandfather";
  return d === 1 ? `your ${parent}` : d === 2 ? `your ${grand}` : `your great-${grand}`;
}

/** "because your father sent the Pinkertons (1892)" — or "" if there's no such mark */
export function because(g: GameState, ...ids: string[]): string {
  const m = anyMark(g, ...ids);
  return m ? `Because ${whoDid(g, m)} ${m.text} (${m.year}).` : "";
}

/** Once a season: marks fade (about 4% a year) unless permanent; faint ones are forgotten. */
export function ledgerSeason(g: GameState) {
  const L = ledgerOf(g);
  for (const m of L) if (!m.permanent) m.weight *= 0.99;
  g.ledger = L.filter((m) => m.permanent || m.weight >= 1);
}

/** At a succession: the heir inherits the marks, a little weaker (martyrs and precedents in full). */
export function inheritLedger(g: GameState) {
  for (const m of ledgerOf(g)) if (!m.permanent) m.weight *= 0.7;
}

/** the biggest marks, for the timeline strip and the end paper */
export function topMarks(g: GameState, n = 8): Mark[] {
  return [...ledgerOf(g)].sort((a, b) => (b.weight + (b.martyrs ?? 0) * 10) - (a.weight + (a.martyrs ?? 0) * 10)).slice(0, n);
}
