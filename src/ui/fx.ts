// Shared bits of the interface (v0.19): one money format, the four meters with their names and icons, effect
// chips, and the one action row every tab uses. One word for each thing, everywhere.

import { esc } from "../core/text";

/** $940 · $9,500 · $95k · $2.61M — negatives as −$11k */
export function money(n: number): string {
  const a = Math.abs(n), s = n < 0 ? "−" : "";
  return a >= 1e6 ? `${s}$${(a / 1e6).toFixed(a >= 1e7 ? 1 : 2)}M` : a >= 1e4 ? `${s}$${Math.round(a / 1000)}k` : `${s}$${Math.round(a).toLocaleString("en-US")}`;
}
/** +$5,108 / −$11k */
export const signed = (n: number) => (n > 0 ? "+" : "") + money(n);

// ---------------------------------------------------------------- the four meters
export type MeterKey = "reputation" | "labour" | "influence" | "morale";
const ICON_PATH: Record<MeterKey, string> = {
  // a star (the public's regard), a hammer (the men), a pillared building (City Hall), a flag (the town's spirit)
  reputation: "M8 1.5l1.9 4 4.3.5-3.2 3 .9 4.3L8 11.1 4.1 13.3l.9-4.3-3.2-3 4.3-.5z",
  labour: "M9.6 1.2l5.2 5.2-2.1 2.1-1.3-1.3-6.9 6.9-2.6-2.6 6.9-6.9-1.3-1.3z",
  influence: "M8 1.5l6.5 3.5v1.5h-13V5z M3 8h2v4.5H3z M7 8h2v4.5H7z M11 8h2v4.5h-2z M1.5 13.5h13V15h-13z",
  morale: "M3 1.5h1.5V15H3z M4.5 2h9l-2 3 2 3h-9z",
};
export const METERS: Record<MeterKey, { name: string; tip: string }> = {
  reputation: { name: "Reputation", tip: "What the public and the papers think of the family" },
  labour: { name: "Labour", tip: "What the men and their union think of you" },
  influence: { name: "Influence", tip: "Your pull at City Hall, Harrisburg and Washington" },
  morale: { name: "Morale", tip: "The town's spirit" },
};
export const icon = (k: MeterKey, cls = "mi") => `<svg class="${cls}" viewBox="0 0 16 16" aria-hidden="true"><path d="${ICON_PATH[k]}"/></svg>`;
const METER_OF = (label: string): MeterKey | undefined =>
  (Object.keys(METERS) as MeterKey[]).find((k) => label.toLowerCase().startsWith(METERS[k].name.toLowerCase()) || label.toLowerCase().startsWith(k));

/** one effect chip; a meter's name gets its icon. tone: good / bad / neutral */
export function chip(label: string, tone: "good" | "bad" | "" = ""): string {
  const m = METER_OF(label);
  return `<span class="fx${tone ? ` fx-${tone}` : ""}">${m ? icon(m) : ""}${esc(label)}</span>`;
}
/** a meter effect as a chip ("Reputation +8") */
export const meterChip = (k: MeterKey, v: number | string) => {
  const n = typeof v === "number" ? v : Number(String(v).replace("−", "-"));
  const txt = typeof v === "number" ? `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v)}` : v;
  return chip(`${METERS[k].name} ${txt}`, isNaN(n) ? (String(v).startsWith("−") ? "bad" : "good") : n >= 0 ? "good" : "bad");
};

const NAMED: [RegExp, string][] = [
  [/^labour$/i, "Labour"], [/^reputation$/i, "Reputation"], [/^influence$/i, "Influence"], [/^morale$/i, "Morale"], [/^jobless$/i, "Jobless"],
  [/^strike chance$/i, "Strikes"], [/^capacity$/i, "Capacity"], [/^prices?$/i, "Price"], [/^barge capacity$/i, "Barges"],
];
/** effects whose number going up is bad for you */
const UP_IS_BAD = new Set(["Strikes", "Jobless"]);

/** Pull the numeric effects out of a description, as chips ("Labour +15, reputation −5." → two chips). */
export function chips(text: string): string {
  const out: { k: string; v: string }[] = [];
  const add = (name: string, v: string) => {
    const k = NAMED.find(([re]) => re.test(name.trim()))?.[1];
    if (k && !out.some((o) => o.k === k)) out.push({ k, v: v.replace(/^-/, "−") });
  };
  for (const m of text.matchAll(/(labour|reputation|influence|morale|jobless|strike chance)\s*\(?([+−\-×]\s?[\d.]+%?)/gi)) add(m[1], m[2].replace(/\s/g, ""));
  for (const m of text.matchAll(/([+−\-]\d+%)\s+(barge capacity|capacity)/gi)) add(m[2], m[1]);
  for (const m of text.matchAll(/prices\s+(?:\w+\s+)?([+−\-]?\d+%)/gi)) add("prices", m[1].startsWith("+") || m[1].startsWith("−") || m[1].startsWith("-") ? m[1] : `+${m[1]}`);
  return out.map(({ k, v }) => {
    const up = v.startsWith("+") || (v.startsWith("×") && Number(v.slice(1)) > 1);
    const good = UP_IS_BAD.has(k) ? !up : up;
    return chip(`${k} ${v.replace(/\.$/, "")}`, good ? "good" : "bad");
  }).join("");
}

// ---------------------------------------------------------------- the action row
/** the button for a row: its cost, or "Free"; greyed with the reason on hover */
export function costButton(attrs: string, cost: number, why: string | null, label?: string): string {
  return `<button ${attrs} ${why ? `disabled title="${esc(why)}"` : ""}>${label ?? (cost ? money(cost) : "Free")}</button>`;
}
/** a row: name (with tooltip), any picker, the button(s); effect chips underneath */
export function actRow(name: string, button: string, fx: string, title: string, extra = "") {
  return `<div class="act" title="${esc(title)}"><span class="act-n">${name}</span>${extra}${button}${fx ? `<div class="act-fx">${fx}</div>` : ""}</div>`;
}
/** a section header with an optional note or link on the right */
export const head = (title: string, right = "") => `<h4 class="mh">${title}${right ? `<span>${right}</span>` : ""}</h4>`;
/** "Show all (12)" / "Show fewer" */
export const more = (key: string, isOpen: boolean, n: number, what = "all") => n ? `<button class="link more" data-more="${key}">${isOpen ? "Show fewer" : `Show ${what} (${n})`}</button>` : "";
