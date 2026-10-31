import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { advanceTurn, foundCompany, newGame, totalPopulation } from "../src/core/game";
import { parseMap, type RawMap } from "../src/core/map";
import { Rng } from "../src/core/rng";
import { evaluateSite } from "../src/core/site";
import { Terrain } from "../src/core/terrain";
import { calendar, TOTAL_TURNS } from "../src/core/time";

const raw = JSON.parse(readFileSync(new URL("../public/maps/mon-valley.json", import.meta.url), "utf8")) as RawMap;
const map = parseMap(raw);
const at = (name: string) => map.landmarks.find((l) => l.name === name)!;

describe("map", () => {
  it("decodes all layers at full size", () => {
    expect(map.width).toBe(256);
    expect(map.elevation.length).toBe(256 * 256);
    expect(map.maxLevel).toBeGreaterThan(10);
  });

  it("has the three rivers meeting at the Point", () => {
    const names = Object.values(map.waterNames);
    for (const r of ["Allegheny River", "Monongahela River", "Ohio River"]) expect(names).toContain(r);
    const p = at("The Point (Pittsburgh)");
    let rivers = new Set<string>();
    for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
      const i = (p.y + dy) * map.width + p.x + dx;
      if (map.water[i]) rivers.add(map.waterNames[String(map.water[i])]);
    }
    expect([...rivers].sort()).toEqual(["Allegheny River", "Monongahela River", "Ohio River"]);
  });

  it("puts mill sites on the river flats and Coal Hill high above", () => {
    const flats = [Terrain.Floodplain, Terrain.Flat];
    for (const s of ["Homestead Works site", "Edgar Thomson Works site", "Eliza Furnaces site (J&L)"])
      expect(flats).toContain(map.terrain[at(s).y * map.width + at(s).x]);
    const hill = at("Coal Hill (Mt. Washington)");
    expect(map.elevation[hill.y * map.width + hill.x]).toBeGreaterThan(300);
  });
});

describe("rng + time", () => {
  it("is deterministic", () => {
    const a = new Rng(42), b = new Rng(42);
    expect([a.next(), a.next()]).toEqual([b.next(), b.next()]);
  });
  it("maps turns to seasons and eras", () => {
    expect(calendar(0)).toMatchObject({ year: 1850, season: "Spring" });
    expect(calendar(4 * 40 + 3)).toMatchObject({ year: 1890, season: "Winter" });
    expect(calendar(4 * 40).era.id).toBe("II");
    expect(calendar(TOTAL_TURNS - 1)).toMatchObject({ year: 1985, season: "Winter" });
  });
});

describe("town + game loop", () => {
  it("generates the same town from the same seed, different from another seed", () => {
    const a = newGame(map, 7), b = newGame(map, 7), c = newGame(map, 8);
    expect(totalPopulation(a)).toBe(totalPopulation(b));
    expect(a.world.use).toEqual(b.world.use);
    expect(totalPopulation(a)).not.toBe(totalPopulation(c));
    // Pittsburgh + Allegheny dominate 1850
    expect(totalPopulation(a)).toBeGreaterThan(60000);
  });

  it("founds a steel works near Homestead and runs 10 years", () => {
    const g = newGame(map, 1850);
    const h = at("Homestead Works site");
    let best = { x: 0, y: 0, score: -1 };
    for (let dy = -6; dy <= 6; dy++) for (let dx = -6; dx <= 6; dx++) {
      const r = evaluateSite(map, g.world, g.fields, "steel", h.x + dx, h.y + dy);
      if (r.ok && r.score > best.score) best = { x: h.x + dx, y: h.y + dy, score: r.score };
    }
    expect(best.score).toBeGreaterThan(0);
    expect(foundCompany(g, "steel", best.x, best.y).ok).toBe(true);
    const pop0 = totalPopulation(g);
    for (let t = 0; t < 40; t++) advanceTurn(g);
    expect(g.company!.produced).toBeGreaterThan(0);
    expect(totalPopulation(g)).toBeGreaterThan(pop0);
    const i = (best.y + 1) * map.width + best.x + 1;
    expect(g.world.pollution[i]).toBeGreaterThan(0);
    expect(g.rivals.map((r) => r.id)).toContain("jl");
  });
});
