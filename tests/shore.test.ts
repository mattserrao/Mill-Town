import { expect, test } from "vitest";
import { readFileSync } from "fs";
import { gunzipSync } from "zlib";
import { parseMap } from "../src/core/map";
import { shoreField, shoreLines, wetAt } from "../src/core/shore";
import { Terrain } from "../src/core/terrain";

function load() {
  const meta = JSON.parse(readFileSync("public/maps/mon-valley.json", "utf8"));
  let bin = readFileSync("public/maps/mon-valley.bin");
  if (bin[0] === 0x1f) bin = gunzipSync(bin);
  return parseMap(meta, new Uint8Array(bin));
}

test("smooth shoreline keeps every tile centre on its own side", () => {
  const m = load();
  const s = shoreField(m), w: [number, number, number] = [0, 0, 0];
  for (let y = 0; y < m.height; y += 3) for (let x = 0; x < m.width; x += 3) {
    const wet = wetAt(s, x + 0.5, y + 0.5, w)[0] > 0.5;
    expect(wet).toBe(m.terrain[y * m.width + x] === Terrain.Water);
  }
});

test("rivers come back as long lines crossing many tiles", () => {
  const m = load();
  const lines = shoreLines(m);
  const longest = Math.max(...lines.map((l) => l.length / 2));
  expect(longest).toBeGreaterThan(400);
});
