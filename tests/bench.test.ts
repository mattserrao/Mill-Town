// Turn-time benchmark without the profiler: BENCH=1 npx vitest run tests/bench.test.ts
// Same play as prof.test.ts (an investing steel company from 1850, seed 11) through 1985.
import { appendFileSync, readFileSync } from "node:fs";
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

const out = (line: string) => { console.log(line); appendFileSync(process.env.BENCH_OUT ?? "/tmp/bench.txt", line + "\n"); };
const base = new URL("../public/maps/", import.meta.url);

describe.skipIf(!process.env.BENCH)("bench", () => {
  it("turn time", () => {
    const meta = JSON.parse(readFileSync(new URL("mon-valley.json", base), "utf8")) as MapMeta;
    const map = parseMap(meta, new Uint8Array(gunzipSync(readFileSync(new URL(meta.binary, base)))));
    const t0 = performance.now();
    const g = newGame(map, 11);
    const tNew = performance.now() - t0;
    const sat = popSAT(map, g.world), fp = footprintTiles(map, "steel");
    let best = { x: 0, y: 0, s: -1 };
    for (let y = 4; y < map.height - fp - 4; y += 6) for (let x = 4; x < map.width - fp - 4; x += 6) {
      const r = evaluateSite(map, g.world, g.fields, "steel", x, y, sat);
      if (r.ok && r.cost <= 100000 && r.score > best.s) best = { x, y, s: r.score };
    }
    foundCompany(g, "steel", best.x, best.y);
    const c = g.company!;
    const all: number[] = [], byEra: Record<string, number[]> = {}, bySeason: number[][] = [[], [], [], []];
    let n = 0;
    while (!g.over && cal(g).year < 1985) {
      const y = cal(g).year;
      if (g.family?.succession) resolveSuccession(g, { heir: 0, path: "business" });
      while (g.pendingDecision) resolveDecision(g, new Rng(`11:${g.turn}:${n}`));
      for (const w of allWorks(c)) for (const t of INDUSTRIES[w.industry].tech) if (!techBlocked(g, w, t) && c.cash > techCost(t, y) * 1.1) commission(g, w, t.id);
      const s = performance.now();
      advanceTurn(g);
      const d = performance.now() - s;
      all.push(d); (byEra[cal(g).era.id] ??= []).push(d); bySeason[g.turn % 4].push(d);
      n++;
    }
    const mean = (a: number[]) => a.reduce((p, q) => p + q, 0) / a.length;
    const pct = (a: number[], p: number) => [...a].sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(a.length * p))];
    out(`${process.env.LABEL ?? "?"}|newGame ${tNew.toFixed(0)}|turns ${all.length}|mean ${mean(all).toFixed(1)}|p50 ${pct(all, 0.5).toFixed(1)}|p95 ${pct(all, 0.95).toFixed(1)}|max ${Math.max(...all).toFixed(0)}|eras ${Object.entries(byEra).map(([k, v]) => `${k}:${mean(v).toFixed(0)}`).join(",")}|seasons ${bySeason.map((v) => `${mean(v).toFixed(0)}/${pct(v, 0.95).toFixed(0)}`).join(",")}|pop ${Array.from(g.world.pop).reduce((a, b) => a + b, 0)}`);
  }, 3_600_000);
});
