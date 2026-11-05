// v0.31 slag dumps: the steel works' slag goes onto open land on their own side of the river, never onto water,
// streets or lots, and the dump rises as it grows.
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { advanceTurn } from "../src/core/game";
import { parseMap, type MapMeta } from "../src/core/map";
import { unpackGame } from "../src/core/save";
import { Terrain } from "../src/core/terrain";
import { Use } from "../src/core/town";

const base = new URL("../public/maps/", import.meta.url);
const meta = JSON.parse(readFileSync(new URL("mon-valley.json", base), "utf8")) as MapMeta;
const bin = new Uint8Array(gunzipSync(readFileSync(new URL(meta.binary, base))));

describe("slag dumps", () => {
  it("grow on open land beside the steel works", async () => {
    const map = parseMap(meta, bin);
    const g = await unpackGame(new Blob([readFileSync(new URL("../public/starts/1893-steel.mtsave", import.meta.url))]), map);
    const w = g.world;
    expect(w.slag, "the baked start carries its dumps").toBeTruthy();
    const before = w.slagN ?? 0;
    expect(before).toBeGreaterThan(0);
    for (let k = 0; k < 8; k++) advanceTurn(g);
    expect(w.slagN!).toBeGreaterThan(before);
    let tiles = 0, raised = 0;
    for (let i = 0; i < w.slag!.length; i++) {
      if (!w.slag![i]) continue;
      if (w.use[i] !== Use.Rock) continue; // a road may since have been laid over an old dump
      tiles++;
      expect(map.terrain[i]).not.toBe(Terrain.Water);
      expect(w.pop[i]).toBe(0);
      const V = map.width + 1, a = ((i / map.width) | 0) * V + (i % map.width);
      const was = (map.vert0[a] + map.vert0[a + 1] + map.vert0[a + V] + map.vert0[a + V + 1]) / 4;
      if (map.elevation[i] - was > 3) raised++;
    }
    expect(tiles).toBeGreaterThan(20);
    expect(raised).toBeGreaterThan(0);
  }, 120_000);
});
