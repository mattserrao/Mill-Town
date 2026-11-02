// v0.26 plat layout (src/core/platlayout.ts): plats lie on their own street angles, lay alleys and squares, set land
// aside for a church, build civic land as they grow, and leave a fringe of gardens and yards at their edges.
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { advanceTurn, cal, newGame } from "../src/core/game";
import { parseMap, type MapMeta } from "../src/core/map";
import { blockTiles } from "../src/core/sleuth";
import { Street, Use } from "../src/core/town";
import { FarmSub, LotSub, ParkSub } from "../src/core/platlayout";

const base = new URL("../public/maps/", import.meta.url);
const meta = JSON.parse(readFileSync(new URL("mon-valley.json", base), "utf8")) as MapMeta;
const map = parseMap(meta, new Uint8Array(gunzipSync(readFileSync(new URL(meta.binary, base)))));

describe("plat layout (v0.26)", () => {
  const g = newGame(map, 5, "sleuth");
  while (cal(g).year < 1905) advanceTurn(g);
  const w = g.world, bs = g.sleuth!.blocks;
  const count = (f: (i: number) => boolean) => { let n = 0; for (let i = 0; i < w.use.length; i++) if (w.blockId![i] && f(i)) n++; return n; };

  it("lay plats out on more than one angle, diagonals included", () => {
    const angles = new Set(bs.map((b) => b.angle));
    expect(angles.size).toBeGreaterThanOrEqual(3);
    expect(bs.some((b) => b.angle >= 2)).toBe(true);
  });

  it("give each plat a main street and the dense ones rear alleys", () => {
    expect(bs.every((b) => b.main === 0 || b.main === 1)).toBe(true);
    expect(count((i) => w.street[i] === Street.Alley)).toBeGreaterThan(50);
    // no alleys in suburbs or on the hillsides
    for (const b of bs.filter((b) => b.type === "suburb" || b.type === "hillside"))
      for (const i of blockTiles(g, b)) expect(w.street[i]).not.toBe(Street.Alley);
  });

  it("lay out squares: markets in cores and mill towns, greens elsewhere", () => {
    expect(count((i) => w.use[i] === Use.Park && w.sub[i] === ParkSub.Paved)).toBeGreaterThan(0);
    expect(count((i) => w.use[i] === Use.Park && (w.sub[i] === ParkSub.Green || w.sub[i] === ParkSub.Bandstand))).toBeGreaterThan(0);
  });

  it("build churches, schools and cemeteries as the plats grow", () => {
    const civ = bs.flatMap((b) => b.civ ?? []);
    expect(civ.filter((c) => c === "church").length).toBeGreaterThan(5);
    expect(count((i) => w.use[i] === Use.Cemetery)).toBeGreaterThan(0);
    // a reserved church lot is never built over by houses
    for (const b of bs) for (const i of b.res ?? []) expect(w.use[i] === Use.Houses || w.use[i] === Use.Rowhouses || w.use[i] === Use.Cottage).toBe(false);
  });

  it("leave a fringe of gardens, orchards and works yards, and lawns in the suburbs", () => {
    expect(count((i) => w.use[i] === Use.Farm && (w.sub[i] === FarmSub.Garden || w.sub[i] === FarmSub.Orchard))).toBeGreaterThan(20);
    expect(count((i) => w.use[i] === Use.Empty && w.sub[i] === LotSub.Yard)).toBeGreaterThan(0);
  });

  it("give cores and mill towns market squares", () => {
    expect(count((i) => w.use[i] === Use.Commerce && (w.sub[i] & 31) === 5)).toBeGreaterThanOrEqual(8);
    expect(bs.filter((b) => b.civ?.includes("market")).length).toBeGreaterThanOrEqual(8);
  });

  it("build each plat in its majority community's style", () => {
    expect(bs.filter((b) => (b.kit ?? 0) > 0).length).toBeGreaterThan(10);
  });

  it("announce the founding of named plats", () => {
    const items = g.news.flatMap((n) => n.items);
    expect(items.filter((h) => h.category === "Society" && /Laid Out|Streetcar|Incorporated|Villa Lots/.test(h.name)).length).toBeGreaterThan(5);
  });
});
