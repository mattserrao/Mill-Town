import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { advanceTurn, buildIncline, foundCompany, newGame, totalPopulation, walkMinutes } from "../src/core/game";
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
  it("generates the same town from the same seed, different from another", { timeout: 30000 }, () => {
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

  it("founds a steel works near Homestead, grades it flat, and runs 10 years", { timeout: 30000 }, () => {
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

describe("hillsides", () => {
  it("fills the slopes as the region grows, with public steps, and inclines shorten the climb", () => {
    const g = newGame(map, 1850);
    expect(foundCompany(g, "steel", 483, 237).ok).toBe(true);
    g.company!.cash = 1e9; // solvent without investing
    for (let t = 0; t < 4 * 50; t++) advanceTurn(g);
    let steepLots = 0, steps = 0;
    for (let i = 0; i < g.world.pop.length; i++) {
      if (g.world.pop[i] && map.terrain[i] === Terrain.Steep) steepLots++;
      if (g.world.street[i] === Street.Steps) steps++;
    }
    expect(totalPopulation(g)).toBeGreaterThan(400000);
    expect(steepLots).toBeGreaterThan(150);
    expect(steps).toBeGreaterThan(10);
    // the furthest-uphill populated tile gets closer once an incline is built
    g.company!.cash = 1e6;
    const n = g.world.pop.length;
    const before = new Float64Array(n);
    for (let i = 0; i < n; i++) if (g.world.pop[i]) before[i] = walkMinutes(g, i);
    expect(buildIncline(g).ok).toBe(true);
    let improved = 0;
    for (let i = 0; i < n; i++) if (g.world.pop[i] && walkMinutes(g, i) < Math.min(before[i], 90) - 5) improved++;
    expect(improved).toBeGreaterThan(5);
    expect(isFinite(walkMinutes(g, 237 * map.width + 483))).toBe(true);
  }, 60000);
});

describe("events", () => {
  it("parses the master CSV and fires events in their season", async () => {
    const { EVENTS, EFFECTS, CATEGORIES } = await import("../src/core/events");
    expect(EVENTS.length).toBeGreaterThan(300);
    for (const e of EVENTS) {
      expect(["Spring", "Summer", "Autumn", "Winter"]).toContain(e.season);
      expect(e.year).toBeGreaterThanOrEqual(1850);
      expect(e.year).toBeLessThanOrEqual(1985);
      expect(e.description.length).toBeGreaterThan(20);
      expect(CATEGORIES).toContain(e.category);
    }
    const order = ["Spring", "Summer", "Autumn", "Winter"];
    for (let i = 1; i < EVENTS.length; i++) {
      const a = EVENTS[i - 1], b = EVENTS[i];
      expect(a.year * 4 + order.indexOf(a.season)).toBeLessThanOrEqual(b.year * 4 + order.indexOf(b.season));
    }
    for (const name of Object.keys(EFFECTS)) expect(EVENTS.some((e) => e.name === name)).toBe(true);
    const g = newGame(map, 5);
    expect(g.headlines[0].name).toBe("A City Rebuilt");
    while (g.world.year < 1858) advanceTurn(g);
    expect(g.log.some((l) => l.text.startsWith("Panic of 1857"))).toBe(true);
  }, 60000);
});

describe("time", () => {
  it("grows the town every season, not just in Spring", () => {
    const g = newGame(map, 11);
    const pops = [totalPopulation(g)];
    for (let t = 0; t < 4; t++) { advanceTurn(g); pops.push(totalPopulation(g)); }
    for (let t = 1; t < pops.length; t++) expect(pops[t]).toBeGreaterThan(pops[t - 1] + 500);
  }, 60000);

  it("ends after Winter 1985 and stays ended", () => {
    const g = newGame(map, 12);
    g.turn = TOTAL_TURNS - 2; // Autumn 1985
    g.world.year = 1985;
    advanceTurn(g);
    expect(calendar(g.turn)).toMatchObject({ year: 1985, season: "Winter" });
    expect(g.over).toBeFalsy();
    advanceTurn(g);
    expect(g.over).toBe(true);
    const t = g.turn;
    advanceTurn(g);
    expect(g.turn).toBe(t);
  }, 60000);

  it("indexes vector creeks and rails for smooth drawing", async () => {
    const { lineIndex } = await import("../src/core/lines");
    const idx = lineIndex(map);
    expect(map.lines.creek.length).toBeGreaterThan(100);
    expect([...idx.values()].some((l) => l.some((s) => s.kind === "rail"))).toBe(true);
  });
});

describe("valley systems", () => {
  it("rivals and homes smoke the air, freight moves, institutions follow communities", () => {
    const g = newGame(map, 1850);
    expect(foundCompany(g, "steel", 483, 237).ok).toBe(true);
    g.company!.cash = 1e9; // stay solvent without investing
    while (calendar(g.turn).year < 1905 && !g.over) advanceTurn(g);
    const w = g.world, W = map.width;
    // soot: next to a rival steel works vs. open country far from anything
    const rival = g.rivals.find((r) => r.id === "carnegie" || r.id === "jl")!;
    const near = w.pollution[(rival.y + (rival.footprint >> 1)) * W + rival.x + (rival.footprint >> 1)];
    expect(near).toBeGreaterThan(0.3);
    let rural = 0, rn = 0;
    for (let i = 0; i < w.pop.length; i += 97) if (!w.pop[i] && map.terrain[i] !== Terrain.Water && w.use[i] === Use.Forest) { rural += w.pollution[i]; rn++; }
    expect(rural / rn).toBeLessThan(near / 4);
    // freight: the works ships its inputs on real lanes
    const fr = g.company!.freight!;
    expect(fr.lanes.length).toBeGreaterThan(0);
    expect(fr.delivered).toBeGreaterThan(0.3);
    expect(fr.delivered).toBeLessThanOrEqual(1);
    // health and unrest are in range, and the commute model makes traffic
    for (const v of g.env.health) { expect(v).toBeGreaterThanOrEqual(0.15); expect(v).toBeLessThanOrEqual(1); }
    expect(g.env.traffic.some((v) => v > 0)).toBe(true);
    // institutions: boarding houses, community shops, churches, halls
    let boarding = 0, shops = 0, halls = 0;
    for (let i = 0; i < w.pop.length; i++) {
      if (w.sub[i] === 4 && (w.use[i] === Use.Houses || w.use[i] === Use.Rowhouses)) boarding++;
      if (w.use[i] === 12 && w.sub[i] >= 9) shops++;
      if (w.use[i] === Use.Civic && w.sub[i] === 8) halls++;
    }
    expect(boarding).toBeGreaterThan(5);
    expect(shops).toBeGreaterThan(5);
    expect(halls).toBeGreaterThan(2);
    expect(w.kit.some((k) => k >= 5)).toBe(true); // some neighbourhood is held by a new-immigrant community
  }, 300000);
});

describe("running the business", () => {
  it("has an action budget, strike-only actions, policies that move the meters, and recruits who arrive", async () => {
    const { takeAction, setPolicy, ACTIONS_PER_SEASON } = await import("../src/core/business");
    const g = newGame(map, 21);
    expect(foundCompany(g, "steel", 483, 237).ok).toBe(true);
    const c = g.company!;
    c.cash = 1e7;
    const rng = new Rng(5);
    expect(takeAction(g, "negotiate", rng).ok).toBe(false); // no strike
    expect(takeAction(g, "picnic", rng).ok).toBe(true);
    expect(takeAction(g, "donate", rng).ok).toBe(true);
    expect(takeAction(g, "recruit", rng, "10").ok).toBe(true);
    expect(c.biz.actionsLeft).toBe(0);
    expect(takeAction(g, "lobby", rng).ok).toBe(false); // budget spent
    advanceTurn(g);
    expect(c.biz.actionsLeft).toBe(ACTIONS_PER_SEASON);
    let italians = 0;
    for (let i = 0; i < g.world.pop.length; i++) if (g.world.eth[i] === 10 && g.world.pop[i]) italians++;
    expect(italians).toBeGreaterThan(5); // the agents' families arrived
    // high wages, eight hours and a safety programme earn labour peace; the opposite earns bitterness
    expect(setPolicy(g, { wages: "high", hours: "eight", safety: "programme" }).ok).toBe(true);
    for (let t = 0; t < 12; t++) advanceTurn(g);
    const good = c.biz.meters.labour;
    setPolicy(g, { wages: "low", hours: "twelve", safety: "none", companyStore: true });
    for (let t = 0; t < 12; t++) advanceTurn(g);
    expect(c.biz.meters.labour).toBeLessThan(good - 20);
    // a strike opens the strike actions; negotiating ends it
    c.strikeTurns = 2;
    expect(takeAction(g, "negotiate", rng).ok).toBe(true);
    expect(c.strikeTurns).toBe(0);
  }, 120000);

  it("puts Homestead 1892 to a steel owner as a decision, and history decides if you don't", () => {
    const g = newGame(map, 22);
    expect(foundCompany(g, "steel", 483, 237).ok).toBe(true);
    g.company!.techs = ["puddling", "hot_blast", "coke_furnace", "bessemer"];
    g.company!.cash = 1e9;
    while (!(calendar(g.turn).year === 1892 && calendar(g.turn).season === "Summer") && !g.over) advanceTurn(g);
    if (g.company!.employees >= 250) {
      expect(g.pendingDecision?.id).toBe("homestead1892");
      advanceTurn(g); // left open: the owners' course (lockout and Pinkertons)
      expect(g.pendingDecision).toBeUndefined();
      expect(g.company!.biz.policy.union).toBe("fight");
    }
  }, 300000);
});

describe("works, technology and rivals", () => {
  it("commissions processes, punishes falling behind, expands the works and docks it", async () => {
    const { commission, techStanding } = await import("../src/core/market");
    const { suggestProject, buildProject } = await import("../src/core/projects");
    const g = newGame(map, 31);
    expect(foundCompany(g, "steel", 483, 237).ok).toBe(true);
    const c = g.company!;
    c.cash = 1e7;
    expect(commission(g, c, "hot_blast").ok).toBe(false); // not invented until 1855
    while (calendar(g.turn).year < 1860) advanceTurn(g);
    expect(techStanding(g, c).behind.map((t) => t.id)).toContain("hot_blast"); // the industry has it, you don't
    expect(techStanding(g, c).factor).toBeLessThan(1);
    expect(commission(g, c, "hot_blast").ok).toBe(true);
    expect(c.research?.id).toBe("hot_blast");
    for (let t = 0; t < 4; t++) advanceTurn(g);
    expect(c.techs).toContain("hot_blast");
    expect(techStanding(g, c).behind.length).toBe(0);
    // expansion: the game finds ground touching the works; building it adds capacity
    const p = suggestProject(g, "expand");
    expect(p?.ok).toBe(true);
    expect(buildProject(g, p!).ok).toBe(true);
    expect(c.annexes.length).toBe(1);
    expect(g.world.owner[p!.y * map.width + p!.x]).toBe(1);
    const d = suggestProject(g, "dock");
    if (d) { expect(buildProject(g, d).ok).toBe(true); expect(c.dock).toBeDefined(); }
  }, 200000);

  it("lets you hurt a rival, buy one, and run it as a second works", async () => {
    const { takeAction } = await import("../src/core/business");
    const g = newGame(map, 32);
    expect(foundCompany(g, "steel", 483, 237).ok).toBe(true);
    const c = g.company!;
    c.cash = 5e7;
    while (calendar(g.turn).year < 1880) advanceTurn(g);
    const jl = g.rivals.find((r) => r.id === "jl")!;
    expect(jl.active).toBe(true);
    const rng = new Rng(3);
    expect(takeAction(g, "poach", rng, "jl").ok).toBe(true);
    expect(jl.damage.length).toBeGreaterThan(0);
    expect(takeAction(g, "buy", rng, "carnegie").ok).toBe(false); // Carnegie won't sell
    expect(takeAction(g, "buy", rng, "jl").ok).toBe(true);
    expect(jl.owned).toBe(true);
    expect(c.others.length).toBe(1);
    advanceTurn(g);
    const w = c.others[0];
    expect(w.lastSeason).toBeDefined();
    expect(w.employees).toBeGreaterThan(0);
    expect(c.totals!.revenue).toBeGreaterThan(c.lastSeason!.revenue); // both works sold iron
  }, 300000);

  it("sends a company that stays overdrawn into receivership", () => {
    const g = newGame(map, 33);
    expect(foundCompany(g, "glass", 300, 300).ok || foundCompany(g, "steel", 483, 237).ok).toBe(true);
    g.company!.cash = -1e9;
    for (let t = 0; t < 10 && !g.over; t++) advanceTurn(g);
    expect(g.company!.bankrupt).toBe(true);
    expect(g.over).toBe(true);
  }, 120000);
});
