// v0.16, the Struggle: the family ledger, eras and successions, the union, politics and the laws, the owners'
// answers, a political career, and saving it all.
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { advanceTurn, allWorks, cal, foundCompany, newGame, type GameState } from "../src/core/game";
import { parseMap, type MapMeta } from "../src/core/map";
import { Rng } from "../src/core/rng";
import { evaluateSite, footprintTiles, popSAT } from "../src/core/site";
import { because, hasMark, ledgerSeason, mark, standing } from "../src/core/ledger";
import { beginSuccession, estateRate, head, makeMain, resolveSuccession, successionDue } from "../src/core/family";
import { holderAt, illegal, LAWS, lawsOf, lawYear, passLaw, suppressEvent } from "../src/core/politics";
import { breakUnion, demandDecision, startSiege, type Union, unionName, unionsOf } from "../src/core/labour";
import { ownersOf, ownersSeason, recordMove } from "../src/core/owners";
import { raceYear } from "../src/core/career";
import { resolveDecision, setPolicy, takeAction } from "../src/core/business";
import { buildProject, suggestProject } from "../src/core/projects";
import { packGame, unpackGame } from "../src/core/save";
import { legacy } from "../src/core/legacy";
import { readLedger } from "../src/core/branches";
import { allDecisions } from "../src/core/eventdata";

const base = new URL("../public/maps/", import.meta.url);
const meta = JSON.parse(readFileSync(new URL("mon-valley.json", base), "utf8")) as MapMeta;
const map = parseMap(meta, new Uint8Array(gunzipSync(readFileSync(new URL(meta.binary, base)))));

function site(g: GameState, ind: "steel" | "glass" | "power" | "metalworks") {
  const sat = popSAT(map, g.world), fp = footprintTiles(map, ind);
  for (let y = 60; y < map.height - fp - 4; y += 6) for (let x = 60; x < map.width - fp - 4; x += 6) {
    const r = evaluateSite(map, g.world, g.fields, ind, x, y, sat);
    if (r.ok && r.cost <= 100000 && r.score > 55) return { x, y };
  }
  throw new Error("no site");
}
function founded(seed = 5, ind: "steel" | "glass" | "power" | "metalworks" = "steel") {
  const g = newGame(map, seed);
  const s = site(g, ind);
  expect(foundCompany(g, ind, s.x, s.y, "Test Works", { first: "Thomas", surname: "Kerr" }).ok).toBe(true);
  return g;
}
const at = (g: GameState, year: number, season = 0) => { g.turn = (year - 1850) * 4 + season; g.world.year = year; };

describe("the family ledger", () => {
  it("stacks repeated acts, keeps the first precedent, fades, and says who did it", () => {
    const g = founded();
    mark(g, { id: "deaths", side: "labour", kind: "grievance", weight: 5, text: "let men die" });
    mark(g, { id: "deaths", side: "labour", kind: "grievance", weight: 5, text: "let men die" });
    expect(hasMark(g, "deaths")!.weight).toBe(10);
    mark(g, { id: "crushed", side: "labour", kind: "precedent", weight: 20, text: "broke the union in 1850" });
    at(g, 1870);
    mark(g, { id: "crushed", side: "labour", kind: "precedent", weight: 20, text: "broke the union in 1870" });
    expect(hasMark(g, "crushed")!.text).toContain("1850");
    expect(standing(g, "labour")).toBe(-10);
    for (let k = 0; k < 40; k++) ledgerSeason(g);
    expect(hasMark(g, "deaths")!.weight).toBeLessThan(7);
    expect(hasMark(g, "crushed")).toBeTruthy();
    expect(because(g, "crushed")).toMatch(/^Because you broke the union in 1850/);
    g.family!.heads.push({ first: "Ann", sex: "f", born: 1850, traits: [], from: 1893, path: "business" });
    expect(because(g, "crushed")).toMatch(/^Because your father/);
  });
});

describe("eras and the family", () => {
  it("names the founder, raises heirs and hands over at the first spring of an era", () => {
    const g = founded();
    expect(head(g)!.first).toBe("Thomas");
    expect(g.family!.heirs.length).toBeGreaterThanOrEqual(2);
    at(g, 1893, 0);
    expect(successionDue(g)).toBe(true);
    beginSuccession(g);
    expect(g.family!.succession!.paths).toContain("politics");
    g.company!.cash = 1_000_000;
    resolveSuccession(g, { heir: 1, path: "business" });
    expect(g.family!.heads.length).toBe(2);
    expect(g.family!.succession).toBeUndefined();
    expect(estateRate(1893)).toBe(0);
    expect(estateRate(1950)).toBeGreaterThan(0.7);
  });
  it("lets the heir buy into a new industry: the new works becomes the company's main works", () => {
    const g = founded(6);
    at(g, 1893, 0);
    beginSuccession(g);
    g.company!.cash = 5_000_000;
    resolveSuccession(g, { heir: 0, path: "industry", industry: "glass", sellOld: true });
    const p = suggestProject(g, "found", "glass");
    expect(p?.ok).toBe(true);
    expect(buildProject(g, p!).ok).toBe(true);
    expect(g.company!.industry).toBe("glass");
    expect(g.company!.id).toBe("p");
    expect(allWorks(g.company!).length).toBe(1);
  });
  it("swaps works cleanly", () => {
    const g = founded(7);
    g.company!.cash = 5_000_000;
    at(g, 1895);
    const p = suggestProject(g, "found", "power")!;
    buildProject(g, p);
    const other = g.company!.others[0];
    makeMain(g, other);
    expect(g.company!.industry).toBe("power");
    expect(g.company!.others[0].industry).toBe("steel");
  });
});

describe("politics and the laws", () => {
  it("knows who held office", () => {
    expect(holderAt("state", 1936).name).toBe("George H. Earle III");
    expect(holderAt("city", 1950).name).toBe("David L. Lawrence");
    expect(holderAt("federal", 1934).name).toBe("Franklin D. Roosevelt");
  });
  it("moves a law, forces policy, and holds its event back until it passes", () => {
    const g = founded();
    const L = LAWS.find((l) => l.id === "police")!;
    lawsOf(g).police.shift = -5;
    expect(lawYear(g, L)).toBe(1940);
    at(g, 1935, 1);
    expect(suppressEvent(g, "Coal and Iron Police Abolished")).toBe(true);
    const cl = LAWS.find((l) => l.id === "childlabour")!;
    g.company!.biz.policy.childLabour = true;
    at(g, 1915);
    passLaw(g, cl);
    expect(g.pendingDecision?.source).toBe("law:childlabour");
    resolveDecision(g, new Rng(1), 0);
    expect(g.company!.biz.policy.childLabour).toBe(false);
    expect(illegal(g, { childLabour: true })).toMatch(/illegal since 1915/);
    g.company!.biz.actionsLeft = 3;
    expect(setPolicy(g, { childLabour: true }).ok).toBe(false);
  });
  it("runs races in the right years", () => {
    expect(raceYear("governor", 1934)).toBe(true);
    expect(raceYear("governor", 1936)).toBe(false);
    expect(raceYear("senate", 1912)).toBe(false);
  });
});

describe("labour", () => {
  it("names the union of the era and runs a strike to its end", () => {
    expect(unionName("steel", 1937)).toBe("Steel Workers Organizing Committee");
    expect(unionName("glass", 1890)).toMatch(/Knights of Labor/);
    const g = founded();
    at(g, 1890);
    const u: Union = (unionsOf(g).steel = { industry: "steel", membership: 0.6, militancy: 70, fund: 3, recognised: false, contractUntil: 0, lastDemand: 0, won: 0, lost: 0 });
    u.demand = { kind: "wages", due: g.turn + 1, since: g.turn };
    const d = demandDecision(g, "steel")!;
    expect(d.options.map((o) => o.label)).toContain("Negotiate");
    startSiege(g, u, "wages", "test");
    expect(g.company!.strikeTurns).toBeGreaterThan(0);
    breakUnion(g, u, "test");
    expect(u.membership).toBeLessThan(0.2);
    expect(hasMark(g, "crushed")).toBeTruthy();
  });
});

describe("the owners", () => {
  it("answer your moves, and throw you out for recognising the union", () => {
    const g = founded();
    at(g, 1885);
    for (let k = 0; k < 12; k++) advanceTurn(g); // the rivals open
    const before = g.rivals.filter((r) => r.answered || r.intent).length;
    recordMove(g, "undercut", undefined, "steel");
    ownersSeason(g, new Rng(3));
    g.turn++;
    ownersSeason(g, new Rng(4));
    expect(g.rivals.filter((r) => r.answered || r.intent).length).toBeGreaterThan(before);
    recordMove(g, "recognise");
    expect(ownersOf(g).member).toBe(false);
  });
});

describe("cards that read the ledger", () => {
  it("tells the 1919 strike why your men won't arbitrate", () => {
    const g = founded();
    at(g, 1892, 1);
    mark(g, { id: "homestead_pinkertons", side: "labour", kind: "precedent", weight: 20, text: "sent the Pinkertons in the Homestead summer" });
    g.company!.employees = 400;
    at(g, 1919, 2);
    const d = allDecisions()["Great Steel Strike"](g);
    if (d) { readLedger(g, d); expect(d.text).toMatch(/Because you sent the Pinkertons/); }
  });
});

describe("a whole succession in play", () => {
  it("plays to 1893, hands over, saves and loads", async () => {
    const g = founded(9);
    while (cal(g).year < 1893) { while (g.pendingDecision) resolveDecision(g, new Rng(g.turn)); advanceTurn(g); }
    expect(g.family!.succession).toBeTruthy();
    expect(g.ledger!.length).toBeGreaterThan(0);
    resolveSuccession(g, { heir: 0, path: "politics", side: "reform" });
    g.company!.biz.actionsLeft = 3;
    at(g, 1893, 1);
    const r = takeAction(g, "run", new Rng(1));
    expect(r.ok).toBe(true);
    const blob = await packGame(g);
    const h = await unpackGame(blob, map);
    expect(h.family!.heads.length).toBe(2);
    expect(h.career!.running?.office).toBe("council");
    expect(h.ledger!.length).toBe(g.ledger!.length);
    expect(legacy(h).total).toBeGreaterThan(0);
  }, 120000);
});
