// Per-pass timing of the season's turn (v0.24): where the time goes, in the browser as well as in tests.
// advanceTurn marks the end of each pass; `mt.timing()` in the ?dev console prints the table.

export interface PassTime { ms: number; n: number; max: number }

export const PASS_TIMES: Record<string, PassTime> = {};

/** a clock for one turn: each call charges the time since the previous call to `name` */
export function passClock(): (name: string) => void {
  let t = performance.now();
  return (name: string) => {
    const t1 = performance.now(), d = t1 - t;
    t = t1;
    const p = (PASS_TIMES[name] ??= { ms: 0, n: 0, max: 0 });
    p.ms += d; p.n++;
    if (d > p.max) p.max = d;
  };
}

export function resetPassTimes() { for (const k of Object.keys(PASS_TIMES)) delete PASS_TIMES[k]; }

/** rows for console.table, slowest first: mean and worst per call, and share of all the time measured */
export function passTable(): { pass: string; calls: number; mean_ms: number; max_ms: number; share: string }[] {
  const all = Object.values(PASS_TIMES).reduce((a, p) => a + p.ms, 0) || 1;
  return Object.entries(PASS_TIMES).sort((a, b) => b[1].ms - a[1].ms).map(([pass, p]) => ({
    pass, calls: p.n, mean_ms: Math.round((p.ms / p.n) * 10) / 10, max_ms: Math.round(p.max * 10) / 10, share: `${((100 * p.ms) / all).toFixed(1)}%`,
  }));
}
