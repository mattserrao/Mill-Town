// The seed list (src/core/seeds.ts): ~100 seeds placed (company rows add more as works open), all in the band.
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { simBand } from "../src/core/band";
import { parseMap, type MapMeta } from "../src/core/map";
import { SEED_TYPES, seedsFor } from "../src/core/seeds";

const base = new URL("../public/maps/", import.meta.url);
const meta = JSON.parse(readFileSync(new URL("mon-valley.json", base), "utf8")) as MapMeta;
const map = parseMap(meta, new Uint8Array(gunzipSync(readFileSync(new URL(meta.binary, base)))));

describe("seeds", () => {
  const seeds = seedsFor(map), band = simBand(map).mask;
  it("are many and varied", () => {
    if (process.env.PRINT_SEEDS) console.log(seeds.length, Object.keys(SEED_TYPES).map((t) => `${t}:${seeds.filter((s) => s.type === t).length}`).join(" "));
    expect(seeds.length).toBeGreaterThanOrEqual(95); // plus company rows as works open
    for (const t of Object.keys(SEED_TYPES)) expect(seeds.some((s) => s.type === t), t).toBe(true);
  });
  it("all sit in the simulated band, with unique ids and sane dates and sizes", () => {
    const ids = new Set<string>();
    for (const s of seeds) {
      expect(band[s.y * map.width + s.x], s.id).toBe(1);
      expect(ids.has(s.id), s.id).toBe(false); ids.add(s.id);
      expect(s.opens).toBeGreaterThanOrEqual(1850); expect(s.opens).toBeLessThanOrEqual(1960);
      expect(s.size).toBeGreaterThan(10);
    }
  });
});
