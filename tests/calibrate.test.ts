// SLEUTH-style calibration of the block model (slow, opt-in): CALIBRATE=1 npx vitest run tests/calibrate.test.ts
// Brute force over spread × slope resistance × road gravity (SLEUTH's coarse pass, three values each), each run a
// fresh 1850 valley (seed 21, no company) to 1920. Fit is the Lee–Sallee index — shared built area ÷ combined
// built area — against v0.24's built extents in 1893 and 1920 (tests/fixtures), with the census fit as a check.
// The best set goes into BASE_COEF in src/core/sleuth.ts.
import { appendFileSync, readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { describe, it } from "vitest";
import { advanceTurn, cal, newGame, totalPopulation, type GameState } from "../src/core/game";
import { regionTarget } from "../src/core/features";
import { parseMap, type MapMeta } from "../src/core/map";
import { BASE_COEF, setBaseCoef } from "../src/core/sleuth";

const base = new URL("../public/maps/", import.meta.url);
const out = (s: string) => { console.log(s); appendFileSync(process.env.CAL_OUT ?? "/tmp/calibrate.txt", s + "\n"); };

/** Lee–Sallee: |A ∩ B| / |A ∪ B| of two built extents */
export function leeSallee(a: Uint8Array, b: Uint8Array): number {
  let and = 0, or = 0;
  for (let i = 0; i < a.length; i++) { if (a[i] && b[i]) and++; if (a[i] || b[i]) or++; }
  return or ? and / or : 1;
}
function extent(g: GameState): Uint8Array { const e = new Uint8Array(g.world.pop.length); for (let i = 0; i < e.length; i++) e[i] = g.world.pop[i] > 0 ? 1 : 0; return e; }
function fixture(year: number): Uint8Array {
  const bits = gunzipSync(readFileSync(new URL(`fixtures/v024-extent-${year}.bin.gz`, import.meta.url))), n = 720 * 720, e = new Uint8Array(n);
  for (let i = 0; i < n; i++) e[i] = (bits[i >> 3] >> (i & 7)) & 1;
  return e;
}

describe.skipIf(!process.env.CALIBRATE)("calibrate", () => {
  it("coarse pass", () => {
    const meta = JSON.parse(readFileSync(new URL("mon-valley.json", base), "utf8")) as MapMeta;
    const map = parseMap(meta, new Uint8Array(gunzipSync(readFileSync(new URL(meta.binary, base)))));
    const t1893 = fixture(1893), t1920 = fixture(1920);
    // SPREAD / SLOPE / ROAD override VALUES for one coefficient (the fine pass)
    const vals = (process.env.VALUES ?? "30,50,70").split(",").map(Number);
    const pick = (k: string) => (process.env[k] ? process.env[k]!.split(",").map(Number) : vals);
    const rows: { k: string; ls: number; census: number }[] = [];
    for (const spread of pick("SPREAD")) for (const slope of pick("SLOPE")) for (const road of pick("ROAD")) {
      setBaseCoef({ ...BASE_COEF, spread, slope, road });
      const g = newGame(map, 21, "sleuth");
      let ls93 = 0;
      while (cal(g).year < 1920) { advanceTurn(g); if (cal(g).year === 1893 && g.turn % 4 === 0) ls93 = leeSallee(extent(g), t1893); }
      const ls20 = leeSallee(extent(g), t1920), census = totalPopulation(g) / regionTarget(1920);
      const k = `spread ${spread} slope ${slope} road ${road}`;
      rows.push({ k, ls: (ls93 + ls20) / 2, census });
      out(`${k}: Lee–Sallee 1893 ${ls93.toFixed(3)} 1920 ${ls20.toFixed(3)} · population ${(census * 100).toFixed(0)}% of census`);
    }
    setBaseCoef(BASE_COEF);
    rows.sort((a, b) => b.ls - a.ls);
    if (process.env.REFERENCE) {
      // the ceiling: v0.24's own lot model, same seed and play, against its baked extents
      const g = newGame(map, 21, "desire");
      let ls93 = 0;
      while (cal(g).year < 1920) { advanceTurn(g); if (cal(g).year === 1893 && g.turn % 4 === 0) ls93 = leeSallee(extent(g), t1893); }
      out(`REFERENCE v0.24 lot model, seed 21: Lee–Sallee 1893 ${ls93.toFixed(3)} 1920 ${leeSallee(extent(g), t1920).toFixed(3)}`);
    }
    out(`BEST ${rows[0].k} (mean Lee–Sallee ${rows[0].ls.toFixed(3)}, population ${(rows[0].census * 100).toFixed(0)}%)`);
  }, 7_200_000);
});
