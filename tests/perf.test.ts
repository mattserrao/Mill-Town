// A guard against the turn getting slow again: forty seasons of a founded steel company in the 1850s.
// v0.19 took ~190 ms a turn here on a laptop; v0.20 ~140 ms. CI machines are slower, so the bar is loose —
// it catches a doubling, not a drift. The save-size guard is in save.test.ts.
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { advanceTurn, foundCompany, newGame } from "../src/core/game";
import { parseMap, type MapMeta } from "../src/core/map";
import { resolveDecision } from "../src/core/business";
import { Rng } from "../src/core/rng";
import { evaluateSite, footprintTiles, popSAT } from "../src/core/site";

const base = new URL("../public/maps/", import.meta.url);

describe("turn time", () => {
  it("stays under the bar", () => {
    const meta = JSON.parse(readFileSync(new URL("mon-valley.json", base), "utf8")) as MapMeta;
    const map = parseMap(meta, new Uint8Array(gunzipSync(readFileSync(new URL(meta.binary, base)))));
    const g = newGame(map, 11);
    const sat = popSAT(map, g.world), fp = footprintTiles(map, "steel");
    outer: for (let y = 60; y < map.height - fp - 4; y += 6) for (let x = 60; x < map.width - fp - 4; x += 6) {
      const r = evaluateSite(map, g.world, g.fields, "steel", x, y, sat);
      if (r.ok && r.cost <= 100000 && r.score > 55) { foundCompany(g, "steel", x, y); break outer; }
    }
    expect(g.company).toBeTruthy();
    const times: number[] = [];
    for (let k = 0; k < 40; k++) {
      while (g.pendingDecision) resolveDecision(g, new Rng(g.turn));
      const t = performance.now();
      advanceTurn(g);
      times.push(performance.now() - t);
    }
    times.sort((a, b) => a - b);
    const p50 = times[20], mean = times.reduce((a, b) => a + b, 0) / times.length;
    console.log(`turn p50 ${p50.toFixed(0)} ms, mean ${mean.toFixed(0)} ms, max ${times[39].toFixed(0)} ms`);
    expect(p50).toBeLessThan(400);
  }, 120000);
});
