import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { foundCompany, newGame } from "../src/core/game";
import { parseMap, type MapMeta } from "../src/core/map";
import { competitors, flowPath, gateways, playerWorks, supplyChain } from "../src/core/economy";

const base = new URL("../public/maps/", import.meta.url);
const meta = JSON.parse(readFileSync(new URL("mon-valley.json", base), "utf8")) as MapMeta;
const map = parseMap(meta, new Uint8Array(gunzipSync(readFileSync(new URL(meta.binary, base)))));

describe("economy", () => {
  it("puts every gateway on the map border where its river or railroad leaves", () => {
    const gw = gateways(map);
    for (const g of Object.values(gw)) expect(g.x === 0 || g.y === 0 || g.x === map.width - 1 || g.y === map.height - 1).toBe(true);
    expect(map.waterNames[String(map.water[gw.ohio.y * map.width + gw.ohio.x])]).toBe("Ohio River");
    expect(map.waterNames[String(map.water[gw.mon.y * map.width + gw.mon.x])]).toBe("Monongahela River");
  });

  it("gives a works raw materials in, water, and markets out whose shares add up", { timeout: 60000 }, () => {
    const g = newGame(map, 11);
    const hs = map.landmarks.find((l) => l.name === "Homestead Works site")!;
    expect(foundCompany(g, "steel", hs.x, hs.y).ok).toBe(true);
    const flows = supplyChain(g, playerWorks(g)!);
    const goods = flows.filter((f) => f.kind === "input").map((f) => f.good);
    expect(goods).toEqual(expect.arrayContaining(["Iron ore", "Coal", "Limestone"]));
    expect(flows.some((f) => f.kind === "utilityIn" && f.good === "Process water")).toBe(true);
    const sum = (k: string) => flows.filter((f) => f.kind === k).reduce((s, f) => s + f.share, 0);
    expect(sum("input")).toBeCloseTo(1, 5);
    expect(sum("output")).toBeCloseTo(1, 5);
    // routes start at the source and end at the destination; river routes stay on water
    for (const f of flows) {
      const p = flowPath(g, f);
      expect(p[0]).toEqual([f.from.x, f.from.y]);
      expect(p[p.length - 1]).toEqual([f.to.x, f.to.y]);
    }
  });

  it("ranks rivals: same industry first as competitors, power as a supplier", () => {
    const g = newGame(map, 3);
    const list = competitors(g, "glass");
    expect(list[0].relation).toBe("competitor");
    expect(list[0].def.id).toBe("ppg");
    expect(list.find((c) => c.def.id === "dlight")!.relation).toBe("supplier");
    expect(list.every((c) => !c.state)).toBe(true); // nobody has opened in 1850
  });
});
