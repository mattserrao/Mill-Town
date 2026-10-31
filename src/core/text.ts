// Small shared helpers for text the player reads.

/** a whole number with thousands separators ("12,345") */
export const fmt = (n: number) => Math.round(n).toLocaleString("en-US");

/** escape text for innerHTML */
export const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
