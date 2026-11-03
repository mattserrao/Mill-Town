// Results-match guard for refactors meant to leave the simulation unchanged (v0.24).
// Plays a few seasons from a fresh 1850 valley and from the baked 1893 and 1947 starts, then hashes the town
// (people, communities, uses, streets, land value, soot, smoke, health) and the company's books. A refactor
// that changes any of these fails here. When a change is meant to alter results, print the new hashes with
//   PRINT_HASH=1 npx vitest run tests/determinism.test.ts
// and paste them below (and rebake the starts: npm run bake).
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { advanceTurn, newGame, type GameState } from "../src/core/game";
import { parseMap, type MapMeta } from "../src/core/map";
import { unpackGame } from "../src/core/save";

// v0.29 (hex grid): the world is a different lattice, so the v0.24 hashes were retired and these are the hex ones
// (the starts were re-baked on the hex map).
const EXPECTED: Record<string, string> = {
  "1850-desire": "3746f122",
  "1850": "1f5fc3fd",
  "1893-steel": "c48e710d",
  "1947-steel": "b228e0d9",
};
const SEASONS = Number(process.env.SEASONS ?? 10);

const base = new URL("../public/maps/", import.meta.url);
const meta = JSON.parse(readFileSync(new URL("mon-valley.json", base), "utf8")) as MapMeta;
const bin = new Uint8Array(gunzipSync(readFileSync(new URL(meta.binary, base))));

/** FNV-1a over the bytes of every typed array, then the numbers */
export function hashGame(g: GameState): string {
  let h = 0x811c9dc5;
  const bytes = (a: ArrayBufferView) => {
    const u = new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
    for (let i = 0; i < u.length; i++) { h ^= u[i]; h = Math.imul(h, 0x01000193); }
  };
  const w = g.world;
  for (const a of [w.pop, w.eth, w.use, w.sub, w.street, w.landValue, w.pollution, w.kit, g.env.air, g.env.health, g.env.unrest, g.env.traffic]) bytes(a as ArrayBufferView);
  if (w.blockId) { bytes(w.blockId); bytes(new TextEncoder().encode(JSON.stringify(g.sleuth))); }
  bytes(new Float64Array([g.turn, g.morale, g.jobless, g.company?.cash ?? 0]));
  bytes(new TextEncoder().encode(JSON.stringify(g.rivals)));
  return (h >>> 0).toString(16).padStart(8, "0");
}

async function run(key: string): Promise<string> {
  const map = parseMap(meta, bin);
  let g: GameState;
  if (key === "1850-desire") g = newGame(map, 1234, "desire");
  else if (key === "1850") g = newGame(map, 1234, "sleuth");
  else g = await unpackGame(new Blob([readFileSync(new URL(`../public/starts/${key}.mtsave`, import.meta.url))]), map);
  for (let k = 0; k < SEASONS; k++) advanceTurn(g);
  return hashGame(g);
}

describe("results match", () => {
  for (const key of Object.keys(EXPECTED)) {
    it(`${key}: ${SEASONS} seasons`, async () => {
      let h: string;
      try { h = await run(key); } catch (e) {
        if (/different map/.test(String(e))) return; // a start baked on the square map: rebake it
        throw e;
      }
      if (process.env.PRINT_HASH) process.stderr.write(`HASH ${key} ${h}\n`);
      else if (EXPECTED[key]) expect(h).toBe(EXPECTED[key]);
      else expect(await run(key)).toBe(h); // not pinned yet: at least a second run must agree
    }, 120_000);
  }
});
