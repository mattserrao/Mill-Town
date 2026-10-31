import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { advanceTurn, foundCompany, newGame, totalPopulation } from "../src/core/game";
import { parseMap, type MapMeta } from "../src/core/map";
import { Rng } from "../src/core/rng";
import { evaluateSite, footprintTiles } from "../src/core/site";
import { Terrain } from "../src/core/terrain";
import { calendar, TOTAL_TURNS } from "../src/core/time";
import { Street, Use } from "../src/core/town";

const base = new URL("../public/maps/", import.meta.url);
const meta = JSON.parse(readFileSync(new URL("mon-valley.json", base), "utf8")) as MapMeta;
const map = parseMap(meta, new Uint8Array(gunzipSync(readFileSync(new URL(meta.binary, base)))));
const at = (name: string) => map.landmarks.find((l) => l.name === name)!;
const near = (x: number, y: number, r: number, f: (i: number) => boolean) => {
  for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) if (f((y + dy) * map.width + x + dx)) return true;
  return false;
};

describe("map", () => {
  it("decodes all layers at full size", () => {
    expect(map.width).toBe(720);
    expect(map.metersPerTile).toBe(30);
    expect(map.vert.length).toBe(721 * 721);
    expect(map.maxHeight - map.minHeight).toBeGreaterThan(120);
  });

  it("has the three rivers meeting at the Point", () => {
    const p = at("The Point (Pittsburgh)");
    const rivers = new Set<string>();
    for (let dy = -10; dy <= 10; dy++) for (let dx = -10; dx <= 10; dx++) {
      const i = (p.y + dy) * map.width + p.x + dx;
      if (map.water[i]) rivers.add(map.waterNames[String(map.water[i])]);
    }
    expect([...rivers].sort()).toEqual(["Allegheny River", "Monongahela River", "Ohio River"]);
  });

  it("puts mill sites on river flats, Coal Hill high above, and the 1850 bridges downtown", () => {
    for (const s of ["Homestead Works site", "Edgar Thomson Works site", "Eliza Furnaces site (J&L)"]) {
      const l = at(s);
      expect(near(l.x, l.y, 3, (i) => map.terrain[i] === Terrain.Floodplain || map.terrain[i] === Terrain.Flat)).toBe(true);
    }
    const hill = at("Coal Hill (Mt. Washington)");
    expect(map.elevation[hill.y * map.width + hill.x]).toBeGreaterThan(300);
    const names = Object.values(map.bridges).map((b) => b.name);
    expect(names).toContain("Smithfield Street Bridge");
    expect(Object.values(map.railLines).some((l) => l.name.startsWith("Pennsylvania Railroad"))).toBe(true);
  });
});

describe("rng + time", () => {
  it("is deterministic", () => {
    const a = new Rng(42), b = new Rng(42);
    expect([a.next(), a.next()]).toEqual([b.next(), b.next()]);
  });
  it("maps turns to seasons and eras", () => {
    expect(calendar(0)).toMatchObject({ year: 1850, season: "Spring" });
    expect(calendar(4 * 40).era.id).toBe("II");
    expect(calendar(TOTAL_TURNS - 1)).toMatchObject({ year: 1985, season: "Winter" });
  });
});

describe("town + game loop", () => {
  it("generates the same town from the same seed, different from another", () => {
    const a = newGame(map, 7);
    const popA = totalPopulation(a), useA = a.world.use.slice();
    const b = newGame(map, 7);
    expect(totalPopulation(b)).toBe(popA);
    expect(b.world.use).toEqual(useA);
    const c = newGame(map, 8);
    expect(totalPopulation(c)).not.toBe(popA);
    expect(popA).toBeGreaterThan(60000);
  });

  it("builds downtown streets, a Mon bridge, wharves and landmarks", () => {
    const g = newGame(map, 3);
    const p = at("The Point (Pittsburgh)");
    let streets = 0, bridge = 0, wharf = 0;
    for (let i = 0; i < g.world.street.length; i++) {
      if (g.world.street[i]) streets++;
      if (g.world.street[i] === Street.Bridge) bridge++;
      if (g.world.use[i] === Use.Wharf) wharf++;
    }
    expect(streets).toBeGreaterThan(500);
    expect(bridge).toBeGreaterThan(5);
    expect(wharf).toBeGreaterThan(20);
    expect(near(p.x, p.y, 25, (i) => g.world.use[i] === Use.Rowhouses)).toBe(true);
    expect(g.world.structure.some((s) => s > 0 && s < 255)).toBe(true);
  });

  it("founds a steel works near Homestead, grades it flat, and runs 10 years", () => {
    const g = newGame(map, 1850);
    const h = at("Homestead Works site");
    let best = { x: 0, y: 0, score: -1 };
    for (let dy = -20; dy <= 20; dy += 2) for (let dx = -20; dx <= 20; dx += 2) {
      const r = evaluateSite(map, g.world, g.fields, "steel", h.x + dx, h.y + dy);
      if (r.ok && r.cost <= 100000 && r.score > best.score) best = { x: h.x + dx, y: h.y + dy, score: r.score };
    }
    expect(best.score).toBeGreaterThan(0);
    expect(foundCompany(g, "steel", best.x, best.y).ok).toBe(true);
    const fp = footprintTiles(map, "steel");
    const V = map.width + 1;
    const mid = map.vert[(best.y + 2) * V + best.x + 2], mid2 = map.vert[(best.y + fp - 2) * V + best.x + fp - 2];
    expect(Math.abs(mid - mid2)).toBeLessThan(0.01);
    const pop0 = totalPopulation(g);
    for (let t = 0; t < 40; t++) advanceTurn(g);
    expect(g.company!.produced).toBeGreaterThan(0);
    expect(totalPopulation(g)).toBeGreaterThan(pop0);
    expect(g.world.pollution[(best.y + 1) * map.width + best.x + 1]).toBeGreaterThan(0);
    expect(g.rivals.map((r) => r.id)).toContain("jl");
  });
});
