// Memory and save-size profile (slow): MEM=1 NODE_OPTIONS=--expose-gc npx vitest run tests/mem.test.ts
import { readFileSync, writeFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { describe, it } from "vitest";
import { advanceTurn, cal, foundCompany, newGame } from "../src/core/game";
import { parseMap, type MapMeta } from "../src/core/map";
import { resolveDecision } from "../src/core/business";
import { Rng } from "../src/core/rng";
import { packGame } from "../src/core/save";
import { INDUSTRIES } from "../src/core/industries";
import { commission, techBlocked, techCost } from "../src/core/market";

const base = new URL("../public/maps/", import.meta.url);
const meta = JSON.parse(readFileSync(new URL("mon-valley.json", base), "utf8")) as MapMeta;
const map = parseMap(meta, new Uint8Array(gunzipSync(readFileSync(new URL(meta.binary, base)))));
const size = (v: unknown) => { try { return JSON.stringify(v, (_k, x) => (ArrayBuffer.isView(x) ? `ta${(x as ArrayBufferView).byteLength}` : x))?.length ?? 0; } catch { return -1; } };
const taBytes = (o: unknown, seen = new Set<unknown>()): number => {
  if (!o || typeof o !== "object" || seen.has(o)) return 0; seen.add(o);
  if (ArrayBuffer.isView(o)) return o.byteLength;
  let n = 0; for (const v of Object.values(o as object)) n += taBytes(v, seen); return n;
};

describe.skipIf(!process.env.MEM)("memory", () => {
  it("profiles a game", async () => {
    const g = newGame(map, 11);
    const { evaluateSite, popSAT } = await import("../src/core/site");
    const sat = popSAT(map, g.world); let best = { x: 0, y: 0, s: -1 };
    for (let y = 4; y < 700; y += 6) for (let x = 4; x < 700; x += 6) { const r = evaluateSite(map, g.world, g.fields, "steel", x, y, sat); if (r.ok && r.cost <= 100000 && r.score > best.s) best = { x, y, s: r.score }; }
    foundCompany(g, "steel", best.x, best.y);
    const out: unknown[] = [];
    const gc = (globalThis as { gc?: () => void }).gc;
    while (!g.over) {
      while (g.pendingDecision) resolveDecision(g, new Rng(g.turn));
      const c0 = g.company!;
      for (const t of INDUSTRIES.steel.tech) if (!techBlocked(g, c0, t) && c0.cash > techCost(t, cal(g).year) * 1.1) commission(g, c0, t.id);
      advanceTurn(g);
      const c = cal(g);
      if (c.season === "Spring" && c.year % 10 === 0 || g.over) {
        gc?.(); gc?.();
        const keys = Object.keys(g).filter((k) => k !== "map" && k !== "fields");
        const parts = Object.fromEntries(keys.map((k) => [k, size((g as unknown as Record<string, unknown>)[k])]).filter(([, v]) => (v as number) > 20000).sort((a, b) => (b[1] as number) - (a[1] as number)));
        const blob = await packGame(g);
        out.push({ year: c.year, heapMB: +(process.memoryUsage().heapUsed / 1e6).toFixed(1), rssMB: +(process.memoryUsage().rss / 1e6).toFixed(1), saveKB: Math.round(blob.size / 1024), stateJsonKB: Math.round(size(Object.fromEntries(keys.map((k) => [k, (g as unknown as Record<string, unknown>)[k]]))) / 1024), typedMB: +(taBytes(g.world) / 1e6 + taBytes(g.env) / 1e6 + taBytes(g.history) / 1e6 + taBytes(g.commute) / 1e6).toFixed(1), parts,
          counts: { log: g.log.length, news: g.news.length, prices: g.prices.length, headlinesInNews: g.news.reduce((s, n) => s + n.items.length, 0), ledger: g.ledger?.length, moves: g.moves?.length, mods: g.mods.length, landmarks: g.landmarks.length, record: g.company?.biz.record.length, pressures: g.pressures.length, ruins: g.ruins.length } });
        writeFileSync("/tmp/memt/mem.json", JSON.stringify(out, null, 1));
      }
    }
  }, 3600 * 1000);
});
