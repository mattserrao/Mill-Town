// Saving: size, a faithful round trip (the loaded game plays on exactly as the saved one), and older formats.
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { advanceTurn, cal, foundCompany, newGame, totalPopulation, type GameState } from "../src/core/game";
import { parseMap, type MapMeta } from "../src/core/map";
import { Rng } from "../src/core/rng";
import { resolveDecision } from "../src/core/business";
import { evaluateSite, footprintTiles, popSAT } from "../src/core/site";
import { packGame, SAVE_FORMAT, unpackGame } from "../src/core/save";

const base = new URL("../public/maps/", import.meta.url);
const meta = JSON.parse(readFileSync(new URL("mon-valley.json", base), "utf8")) as MapMeta;
const map = parseMap(meta, new Uint8Array(gunzipSync(readFileSync(new URL(meta.binary, base)))));

function founded(seed: number) {
  const g = newGame(map, seed);
  const sat = popSAT(map, g.world), fp = footprintTiles(map, "steel");
  for (let y = 60; y < map.height - fp - 4; y += 6) for (let x = 60; x < map.width - fp - 4; x += 6) {
    const r = evaluateSite(map, g.world, g.fields, "steel", x, y, sat);
    if (r.ok && r.cost <= 100000 && r.score > 55) { expect(foundCompany(g, "steel", x, y, "Test Works", { first: "Thomas", surname: "Kerr" }).ok).toBe(true); return g; }
  }
  throw new Error("no site");
}
const play = (g: GameState, seasons: number) => { for (let k = 0; k < seasons; k++) { while (g.pendingDecision) resolveDecision(g, new Rng(g.turn)); advanceTurn(g); } };
const fingerprint = (g: GameState) => ({ turn: g.turn, cash: Math.round(g.company!.cash), pop: totalPopulation(g), morale: Math.round(g.morale * 100), version: g.world.version, log: g.log.length, news: g.news.length });

describe("saving", () => {
  it("is small, and the loaded game plays on exactly as the saved one", async () => {
    const g = founded(7);
    play(g, 60); // to 1865
    const blob = await packGame(g);
    // a sixth of what v0.19 wrote (4.2 MB); mostly land value, soot and air, which are noise to gzip
    expect(blob.size).toBeLessThan(1_200_000);
    const h = await unpackGame(blob, map);
    expect(cal(h).year).toBe(cal(g).year);
    expect(fingerprint(h)).toEqual(fingerprint(g));
    // what's left out of the save comes back
    expect(h.commute).toBeTruthy();
    expect(h.world.landValue.length).toBe(map.width * map.height);
    let lv = 0; for (const v of h.world.landValue) lv += v;
    expect(lv).toBeGreaterThan(0);
    // and the two games stay in step afterwards
    play(g, 12); play(h, 12);
    expect(fingerprint(h)).toEqual(fingerprint(g));
  }, 300000);

  it("reads a save without the fields newer versions added", async () => {
    const g = founded(8);
    play(g, 8);
    const blob = await packGame(g);
    // rewrite the header as an older format missing some state
    const buf = new Uint8Array(await new Response(blob.stream().pipeThrough(new DecompressionStream("gzip"))).arrayBuffer());
    const dv = new DataView(buf.buffer);
    const headLen = dv.getUint32(0, true);
    const header = JSON.parse(new TextDecoder().decode(buf.subarray(8, 8 + headLen)));
    expect(header.format).toBe(SAVE_FORMAT);
    header.format = 2;
    delete header.state.landmarks; delete header.state.teams; delete header.state.strikeAt; delete header.state.pendingRivalFx;
    const head = new TextEncoder().encode(JSON.stringify(header));
    const len = new Uint32Array([head.length, dv.getUint32(4, true)]);
    let at = 8 + headLen; at += (8 - (at % 8)) % 8;
    const parts: BlobPart[] = [len, head, new Uint8Array((8 - ((8 + head.length) % 8)) % 8), buf.subarray(at)];
    const older = await new Response(new Blob(parts).stream().pipeThrough(new CompressionStream("gzip"))).blob();
    const h = await unpackGame(older, map);
    expect(h.landmarks).toEqual([]);
    expect(h.teams).toEqual([]);
    play(h, 4);
    expect(cal(h).year).toBe(1853);
  }, 300000);
});
