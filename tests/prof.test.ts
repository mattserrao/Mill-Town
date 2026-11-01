// Turn-time profile (slow, opt-in): PROF=1 npx vitest run tests/prof.test.ts
// Plays an investing steel company from 1850 to YEARS (default 1985) and prints the mean turn time per era
// and the hottest functions (self time) from a CPU profile of the simulation alone.
import { Session } from "node:inspector/promises";
import { appendFileSync, readFileSync } from "node:fs";
const out = (line: string) => { console.log(line); appendFileSync(process.env.PROF_OUT ?? "/tmp/prof.txt", line + "\n"); };
import { gunzipSync } from "node:zlib";
import { describe, it } from "vitest";
import { advanceTurn, allWorks, cal, foundCompany, newGame } from "../src/core/game";
import { INDUSTRIES } from "../src/core/industries";
import { parseMap, type MapMeta } from "../src/core/map";
import { commission, techBlocked, techCost } from "../src/core/market";
import { evaluateSite, footprintTiles, popSAT } from "../src/core/site";
import { resolveDecision } from "../src/core/business";
import { resolveSuccession } from "../src/core/family";
import { Rng } from "../src/core/rng";

const base = new URL("../public/maps/", import.meta.url);

describe.skipIf(!process.env.PROF)("profile", () => {
  it("turn time", async () => {
    const meta = JSON.parse(readFileSync(new URL("mon-valley.json", base), "utf8")) as MapMeta;
    const map = parseMap(meta, new Uint8Array(gunzipSync(readFileSync(new URL(meta.binary, base)))));
    const until = Number(process.env.YEARS ?? 1985);
    const t0 = Date.now();
    const g = newGame(map, 11);
    out(`newGame ${Date.now() - t0} ms`);
    const sat = popSAT(map, g.world), fp = footprintTiles(map, "steel");
    let best = { x: 0, y: 0, s: -1 };
    for (let y = 4; y < map.height - fp - 4; y += 6) for (let x = 4; x < map.width - fp - 4; x += 6) {
      const r = evaluateSite(map, g.world, g.fields, "steel", x, y, sat);
      if (r.ok && r.cost <= 100000 && r.score > best.s) best = { x, y, s: r.score };
    }
    foundCompany(g, "steel", best.x, best.y);
    const c = g.company!;
    const session = new Session();
    session.connect();
    await session.post("Profiler.enable");
    await session.post("Profiler.setSamplingInterval", { interval: 500 });
    await session.post("Profiler.start");
    const byEra: Record<string, number[]> = {};
    let n = 0;
    while (!g.over && cal(g).year < until) {
      const y = cal(g).year;
      if (g.family?.succession) resolveSuccession(g, { heir: 0, path: "business" });
      while (g.pendingDecision) resolveDecision(g, new Rng(`11:${g.turn}:${n}`));
      for (const w of allWorks(c)) for (const t of INDUSTRIES[w.industry].tech) if (!techBlocked(g, w, t) && c.cash > techCost(t, y) * 1.1) commission(g, w, t.id);
      const s = performance.now();
      advanceTurn(g);
      (byEra[cal(g).era.id] ??= []).push(performance.now() - s);
      n++;
    }
    const { profile } = await session.post("Profiler.stop");
    for (const [era, ts] of Object.entries(byEra)) {
      const sorted = [...ts].sort((a, b) => a - b);
      out(`Era ${era}: ${ts.length} turns, mean ${(ts.reduce((a, b) => a + b, 0) / ts.length).toFixed(0)} ms, p50 ${sorted[ts.length >> 1].toFixed(0)}, max ${sorted[ts.length - 1].toFixed(0)}`);
    }
    const self = new Map<string, number>();
    const nodes = new Map(profile.nodes.map((x) => [x.id, x]));
    let total = 0;
    for (let i = 0; i < profile.samples!.length; i++) {
      const d = (profile.timeDeltas![i] || 0) / 1000; total += d;
      const nd = nodes.get(profile.samples![i])!;
      const k = `${nd.callFrame.functionName || "(anon)"} ${nd.callFrame.url.split("/").pop()}:${nd.callFrame.lineNumber}`;
      self.set(k, (self.get(k) || 0) + d);
    }
    out(`sampled ${total.toFixed(0)} ms over ${n} turns`);
    out([...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, 35).map(([k, v]) => `${(100 * v / total).toFixed(1).padStart(5)}%  ${k}`).join("\n"));
    // line-level ticks inside the hottest function, when asked
    if (process.env.LINES) for (const nd of profile.nodes) if (nd.callFrame.functionName === process.env.LINES && nd.positionTicks)
      out(`${nd.callFrame.functionName} lines: ` + nd.positionTicks.sort((a, b) => b.ticks - a.ticks).slice(0, 12).map((t) => `${t.line}:${t.ticks}`).join(" "));
    session.disconnect();
  }, 3_600_000);
});
