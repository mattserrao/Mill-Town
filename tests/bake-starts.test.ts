// Bakes the later-start snapshots (slow, opt-in): BAKE=1 npx vitest run tests/bake-starts.test.ts
// For each start year and 1850 industry the valley and the family are simulated from 1850 to the succession
// by the AI owner (src/core/autoplay.ts) and saved to public/starts/<year>-<industry>.mtsave, the same gzip
// format as a save. The game loads one instead of simulating two minutes behind a progress card.
// The seed is fixed per start (START_SEED): "Start in 1920" always means the same valley.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { cal } from "../src/core/game";
import { parseMap, type MapMeta } from "../src/core/map";
import { BAKED_FOUNDER, laterStartGame, simulateSome, START_SEED, startFile } from "../src/core/autoplay";
import { packGame } from "../src/core/save";
import { industriesIn, INDUSTRIES } from "../src/core/industries";
import { ERAS } from "../src/core/time";

const base = new URL("../public/maps/", import.meta.url);
const out = new URL("../public/starts/", import.meta.url);

describe.skipIf(!process.env.BAKE)("bake the later starts", () => {
  it("simulates every start and writes it", async () => {
    const meta = JSON.parse(readFileSync(new URL("mon-valley.json", base), "utf8")) as MapMeta;
    const map = parseMap(meta, new Uint8Array(gunzipSync(readFileSync(new URL(meta.binary, base)))));
    mkdirSync(out, { recursive: true });
    const years = ERAS.map((e) => e.startYear).filter((y) => y > 1850);
    const only = process.env.ONLY ? process.env.ONLY.split(",") : null;
    for (const year of years) for (const industry of industriesIn(1850)) {
      const file = startFile(year, industry);
      if (only && !only.includes(file)) continue;
      const t0 = Date.now();
      const o = { year, faction: "industrialist" as const, industry, founder: BAKED_FOUNDER, name: `${BAKED_FOUNDER.surname} & Co. ${INDUSTRIES[industry].name} Works` };
      const g = laterStartGame(map, START_SEED, o);
      expect(g, `${file}: no site`).toBeTruthy();
      while (!simulateSome(g!, o, 20, true));
      expect(g!.over, `${file}: the family went under before ${year}`).toBeFalsy();
      expect(cal(g!).year).toBe(year);
      expect(g!.family!.succession).toBeTruthy();
      const blob = await packGame(g!);
      writeFileSync(new URL(file, out), new Uint8Array(await blob.arrayBuffer()));
      console.log(`${file}: ${(blob.size / 1024).toFixed(0)} kB, ${((Date.now() - t0) / 1000).toFixed(0)} s, cash $${Math.round(g!.company!.cash).toLocaleString("en-US")}`);
    }
  }, 3_600_000);
});
