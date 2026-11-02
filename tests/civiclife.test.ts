// v0.27 civic life (src/core/civiclife.ts): engine houses, station houses and borough buildings by ward; fires that
// burn blocks, riskier by the furnaces; the real cemeteries filling with the valley's dead; the family plot.
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { advanceTurn, cal, foundCompany, newGame } from "../src/core/game";
import { parseMap, type MapMeta } from "../src/core/map";
import { autoOwner, bestSite } from "../src/core/autoplay";
import { CEM_FILL, CEM_RURAL, civOf, ignite } from "../src/core/civiclife";
import { CEMETERIES } from "../src/core/civicdata";
import { CivicSub, Use } from "../src/core/town";
import { LotSub } from "../src/core/platlayout";
import { RIVALS } from "../src/core/rivals";
import { Rng } from "../src/core/rng";
import { packGame, unpackGame } from "../src/core/save";

const base = new URL("../public/maps/", import.meta.url);
const meta = JSON.parse(readFileSync(new URL("mon-valley.json", base), "utf8")) as MapMeta;
const map = parseMap(meta, new Uint8Array(gunzipSync(readFileSync(new URL(meta.binary, base)))));

describe("civic life (v0.27)", () => {
  const g = newGame(map, 5, "sleuth");
  const s = bestSite(g, "steel")!;
  foundCompany(g, "steel", s.x, s.y, "Calder Iron Works", { first: "Henry", surname: "Calder" } as never);
  while (cal(g).year < 1898 && !g.over) { autoOwner(g); advanceTurn(g); }
  const civ = civOf(g), w = g.world;
  const count = (f: (i: number) => boolean) => { let n = 0; for (let i = 0; i < w.use.length; i++) if (f(i)) n++; return n; };

  it("gives the wards engine houses, station houses and borough buildings", () => {
    const live = (k: string) => civ.services.filter((x) => x.kind === k && w.use[x.tile] === Use.Civic);
    expect(live("fire").length).toBeGreaterThanOrEqual(10);
    expect(live("police").length).toBeGreaterThanOrEqual(3);
    expect(live("hall").length).toBeGreaterThanOrEqual(3);
    for (const x of live("fire")) expect(w.sub[x.tile]).toBe(CivicSub.Firehouse);
    // the city's volunteers became numbered companies of the paid department in 1870
    expect(civ.services.some((x) => x.kind === "fire" && /^Engine Company No\. \d+$/.test(x.name))).toBe(true);
    expect(civ.services.some((x) => x.kind === "hall" && /Borough Building/.test(x.name))).toBe(true);
  });

  it("lays out the real cemeteries on their dates and fills them", () => {
    for (const c of CEMETERIES) expect(civ.laid.includes(c.id)).toBe(c.open <= 1898);
    const rural = count((i) => w.use[i] === Use.Cemetery && (w.sub[i] & CEM_RURAL) !== 0);
    expect(rural).toBeGreaterThan(2000);
    // Allegheny Cemetery, open since 1844, has stones; the burials add up to tens of thousands
    expect(count((i) => w.use[i] === Use.Cemetery && w.was[i] === 1 && (w.sub[i] & CEM_FILL) > 0)).toBeGreaterThan(100);
    expect(civ.buried.reduce((a, b) => a + b, 0)).toBeGreaterThan(100000);
  });

  it("burns blocks, and the furnaces make it likelier nearby", () => {
    expect(civ.fires.length).toBeGreaterThan(10);
    expect(civ.fires.some((f) => f.tiles >= 10)).toBe(true);
    const hot: number[] = [], cool: number[] = [];
    const steel = g.rivals.filter((r) => r.active && !r.offmap && RIVALS.find((d) => d.id === r.id)?.industry === "steel");
    for (const b of g.sleuth!.blocks) {
      const r = civ.risk[b.id - 1];
      if (!r) continue;
      const d = Math.min(...steel.map((x) => Math.hypot(x.x - b.x, x.y - b.y)));
      if (d < 22) hot.push(r); else if (d > 45) cool.push(r);
    }
    const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
    expect(hot.length).toBeGreaterThanOrEqual(3);
    expect(mean(hot)).toBeGreaterThan(mean(cool) * 1.5);
  });

  it("a fire turns houses into burnt-out lots and takes the people out", () => {
    const b = [...g.sleuth!.blocks].filter((x) => x.pop > 800).sort((p, q) => q.pop - p.pop)[0];
    const before = b.pop;
    const rec = ignite(g, b, new Rng("test-fire"), { size: 30 });
    expect(rec).not.toBeNull();
    expect(rec!.tiles).toBeGreaterThan(0);
    expect(count((i) => w.use[i] === Use.Empty && w.sub[i] === LotSub.Burnt)).toBeGreaterThanOrEqual(rec!.tiles);
    expect(b.pop).toBeLessThanOrEqual(before);
  });

  it("keeps a family plot with the founder's parents", () => {
    expect(civ.plot).toBeTruthy();
    expect(civ.plot!.graves.length).toBeGreaterThanOrEqual(1);
    expect(w.use[civ.plot!.tile]).toBe(Use.Cemetery);
    expect(civ.plot!.graves.every((gr) => gr.name.endsWith("Calder"))).toBe(true);
  });

  it("saves and loads the civic state", async () => {
    const g2 = await unpackGame(await packGame(g), map);
    expect(g2.civ!.services.length).toBe(civ.services.length);
    expect(g2.civ!.plot!.graves.length).toBe(civ.plot!.graves.length);
    expect(g2.civ!.buried.map(Math.round)).toEqual(civ.buried.map(Math.round));
  });
});
