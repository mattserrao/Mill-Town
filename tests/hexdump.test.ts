// Dumps the resampled hex map for tools/hexmap_preview.py (HEXDUMP=1 npx vitest run tests/hexdump.test.ts)
import { describe, it } from "vitest";
import { readFileSync, writeFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { parseMap, type MapMeta } from "../src/core/map";

const base = new URL("../public/maps/", import.meta.url);
describe.skipIf(!process.env.HEXDUMP)("hex dump", () => {
  it("writes /tmp/hexmap.*", () => {
    const meta = JSON.parse(readFileSync(new URL("mon-valley.json", base), "utf8")) as MapMeta;
    const m = parseMap(meta, new Uint8Array(gunzipSync(readFileSync(new URL(meta.binary, base)))));
    const layers: Record<string, Uint8Array> = { valid: m.valid, terrain: m.terrain, water: m.water, creek: m.creek, rail: m.rail, road: m.road, bridge: m.bridge, special: m.special, coal: m.coal, slope: m.slope };
    const h8 = new Uint8Array(m.vert.length);
    for (let i = 0; i < h8.length; i++) h8[i] = m.valid[i] ? Math.max(0, Math.min(255, Math.round(((m.vert[i] - m.minHeight) / (m.maxHeight - m.minHeight)) * 255))) : 0;
    layers.height = h8;
    writeFileSync("/tmp/hexmap.json", JSON.stringify({ width: m.width, height: m.height, q0: m.q0, r0: m.r0, minHeight: m.minHeight, maxHeight: m.maxHeight, layers: Object.keys(layers), landmarks: m.landmarks, spans: m.spans, rail: m.lines.rail.length, creekLines: m.lines.creek.length }));
    writeFileSync("/tmp/hexmap.bin", Buffer.concat(Object.values(layers).map((a) => Buffer.from(a.buffer, a.byteOffset, a.byteLength))));
  });
});
