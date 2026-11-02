// The simulated band (src/core/band.ts): about half the map, and every place the game names stays inside it.
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { BAND_DIST, BAND_SHARE, buildBand, simBand } from "../src/core/band";
import { HILLSIDES, INCLINES, latLonToTile } from "../src/core/features";
import { parseMap, type MapMeta } from "../src/core/map";
import { placeNamed } from "../src/core/places";
import { RIVALS } from "../src/core/rivals";
import { evaluateSite } from "../src/core/site";
import { newGame } from "../src/core/game";

const base = new URL("../public/maps/", import.meta.url);
const meta = JSON.parse(readFileSync(new URL("mon-valley.json", base), "utf8")) as MapMeta;
const map = parseMap(meta, new Uint8Array(gunzipSync(readFileSync(new URL(meta.binary, base)))));

describe("simulated band", () => {
  const b = simBand(map);

  it("covers about half the map", () => {
    expect(b.dist).toBe(BAND_DIST);
    expect(Math.abs(b.share - BAND_SHARE)).toBeLessThan(0.01);
    // BAND_DIST is the bisection result: a little less gives under half, a little more over
    expect(buildBand(map, BAND_DIST - 2).share).toBeLessThan(BAND_SHARE);
    expect(buildBand(map, BAND_DIST + 2).share).toBeGreaterThan(BAND_SHARE);
  });

  it("spans and blocks agree with the mask", () => {
    let n = 0;
    for (let s = 0; s < b.spans.length; s += 3) for (let x = b.spans[s + 1]; x < b.spans[s + 2]; x++) { expect(b.mask[b.spans[s] * map.width + x]).toBe(1); n++; }
    expect(n).toBe(b.tiles);
  });

  it("keeps every hillside, incline, on-map rival and town inside", () => {
    const at = (x: number, y: number) => b.mask[y * map.width + x] === 1;
    for (const h of HILLSIDES) expect(at(...latLonToTile(map, h.lat, h.lon)), h.name).toBe(true);
    for (const inc of INCLINES) expect(at(...latLonToTile(map, inc.upper[0], inc.upper[1])), inc.name).toBe(true);
    for (const r of RIVALS) {
      if (r.offmap) continue;
      const p = r.at ? latLonToTile(map, r.at[0], r.at[1]) : (() => { const q = placeNamed(map, r.site); return q ? [q.x, q.y] as [number, number] : null; })();
      if (p) expect(at(p[0], p[1]), r.id).toBe(true);
    }
    for (const l of map.landmarks) if (l.kind === "town") expect(at(l.x, l.y), l.name).toBe(true);
  });

  it("won't site a works in the countryside", () => {
    const g = newGame(map, 7);
    let x = 0, y = 0;
    outer: for (y = 10; y < map.height - 30; y += 5) for (x = 10; x < map.width - 30; x += 5) if (!b.mask[y * map.width + x]) break outer;
    expect(evaluateSite(map, g.world, g.fields, "steel", x, y).reasons).toContain("Too far from the river towns");
  });
});
