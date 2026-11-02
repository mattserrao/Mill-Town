// The seed-block growth model (src/core/sleuth.ts): blocks grow into free-form shapes, are updated as units,
// join wards, and Pittsburgh's annexations happen; saves round-trip the blocks.
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { advanceTurn, cal, newGame, totalPopulation } from "../src/core/game";
import { parseMap, type MapMeta } from "../src/core/map";
import { packGame, unpackGame } from "../src/core/save";
import { blockFill, blockTiles, wardOf } from "../src/core/sleuth";

const base = new URL("../public/maps/", import.meta.url);
const meta = JSON.parse(readFileSync(new URL("mon-valley.json", base), "utf8")) as MapMeta;
const map = parseMap(meta, new Uint8Array(gunzipSync(readFileSync(new URL(meta.binary, base)))));

describe("seed blocks (sleuth)", () => {
  const g = newGame(map, 5, "sleuth");
  while (cal(g).year < 1873) advanceTurn(g);
  const bs = g.sleuth!.blocks;

  it("open on their dates and hold the town", () => {
    expect(bs.length).toBeGreaterThan(40);
    expect(bs.find((b) => b.seed === "homestead")).toBeTruthy();
    // nearly everyone in the band lives in a block
    let inBlocks = 0;
    for (const b of bs) inBlocks += b.pop;
    expect(inBlocks / totalPopulation(g)).toBeGreaterThan(0.85);
  });

  it("take free-form shapes, not rectangles", () => {
    const big = bs.filter((b) => b.land > 60);
    expect(big.length).toBeGreaterThan(10);
    expect(big.filter((b) => blockFill(g, b) < 0.6).length / big.length).toBeGreaterThan(0.5);
  });

  it("keep their totals in step with their tiles", () => {
    for (const b of bs.slice(0, 20)) {
      let pop = 0;
      for (const i of blockTiles(g, b)) { expect(g.world.blockId![i]).toBe(b.id); pop += g.world.pop[i]; }
      expect(Math.abs(pop - b.pop)).toBeLessThanOrEqual(Math.max(50, b.pop * 0.05));
    }
  });

  it("join wards, and Pittsburgh annexes its boroughs (1868, 1872)", () => {
    expect(new Set(bs.map((b) => wardOf(g, b.id))).size).toBeLessThan(bs.length);
    const names = g.headlines.map((h) => h.name).concat(g.log.map((l) => l.text));
    void names;
    expect(Object.keys(g.sleuth!.annexed)).toEqual(expect.arrayContaining(["Lawrenceville", "Birmingham"]));
    const pgh = bs.find((b) => b.seed === "pittsburgh")!, law = bs.find((b) => b.seed === "lawrenceville")!;
    expect(wardOf(g, law.id)).toBe(wardOf(g, pgh.id));
    expect(law.city).toBe("Pittsburgh");
  });

  it("round-trips through a save", async () => {
    const h = await unpackGame(await packGame(g), map);
    expect(h.growthModel).toBe("sleuth");
    expect(h.sleuth!.blocks.length).toBe(bs.length);
    expect(Array.from(h.world.blockId!.slice(0, 5000))).toEqual(Array.from(g.world.blockId!.slice(0, 5000)));
    advanceTurn(h);
    expect(blockTiles(h, h.sleuth!.blocks[0]).length).toBeGreaterThan(0);
  });
}, 300_000);
