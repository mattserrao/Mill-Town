// Small shared bits of the interface: money in short form, and effect "chips" pulled from a description
// ("Labour +15, reputation +5." → [Lab +15] [Rep +5]) so the full sentence can live in the tooltip.

import { esc } from "../core/text";

/** $8.34M, $146k, $7,949 */
export function money(n: number): string {
  const a = Math.abs(n), s = n < 0 ? "−" : "";
  return a >= 1e6 ? `${s}$${(a / 1e6).toFixed(a >= 1e7 ? 1 : 2)}M` : a >= 1e4 ? `${s}$${Math.round(a / 1000)}k` : `${s}$${Math.round(a).toLocaleString("en-US")}`;
}

const SHORT: [RegExp, string][] = [
  [/^labour$/i, "Lab"], [/^reputation$/i, "Rep"], [/^influence$/i, "Inf"], [/^morale$/i, "Mor"], [/^jobless$/i, "Jobless"],
  [/^strike chance$/i, "Strikes"], [/^capacity$/i, "Capacity"], [/^prices?$/i, "Price"], [/^barge capacity$/i, "Barges"],
];
/** effects whose number going up is bad for you */
const UP_IS_BAD = new Set(["Strikes", "Jobless"]);

/** Pull the numeric effects out of a description, as chips. */
export function chips(text: string): string {
  const out: { k: string; v: string }[] = [];
  const add = (name: string, v: string) => {
    const k = SHORT.find(([re]) => re.test(name.trim()))?.[1];
    if (k && !out.some((o) => o.k === k)) out.push({ k, v: v.replace(/^-/, "−") });
  };
  // "Labour +15", "reputation −10", "Strike chance ×0.6", "Jobless −60%"
  for (const m of text.matchAll(/(labour|reputation|influence|morale|jobless|strike chance)\s*\(?([+−\-×]\s?[\d.]+%?)/gi)) add(m[1], m[2].replace(/\s/g, ""));
  // "+35% barge capacity", "+30% capacity", "your prices +4%", "lift your prices 6%"
  for (const m of text.matchAll(/([+−\-]\d+%)\s+(barge capacity|capacity)/gi)) add(m[2], m[1]);
  for (const m of text.matchAll(/prices\s+(?:\w+\s+)?([+−\-]?\d+%)/gi)) add("prices", m[1].startsWith("+") || m[1].startsWith("−") || m[1].startsWith("-") ? m[1] : `+${m[1]}`);
  return out.map(({ k, v }) => {
    const up = v.startsWith("+") || (v.startsWith("×") && Number(v.slice(1)) > 1);
    const good = UP_IS_BAD.has(k) ? !up : up;
    return `<span class="fx ${good ? "fx-good" : "fx-bad"}">${k} ${esc(v)}</span>`;
  }).join("");
}
