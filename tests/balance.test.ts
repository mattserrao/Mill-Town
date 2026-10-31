// Economy balance run (slow): SIM=1 npx vitest run tests/balance.test.ts
// Plays a steel company to 1985 with a simple owner (commissions every process it can afford, expands when rich)
// and one that never invests, and writes the yearly accounts to /tmp/balance-<who>.log.
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { describe, it } from "vitest";
import { advanceTurn, cal, foundCompany, newGame } from "../src/core/game";
import { INDUSTRIES } from "../src/core/industries";
import { parseMap, type MapMeta } from "../src/core/map";
import { commission, marketFactor, techBlocked, techCost, techStanding } from "../src/core/market";
import { buildProject, projectBlocked, suggestProject } from "../src/core/projects";

const base = new URL("../public/maps/", import.meta.url);
const meta = JSON.parse(readFileSync(new URL("mon-valley.json", base), "utf8")) as MapMeta;
const map = parseMap(meta, new Uint8Array(gunzipSync(readFileSync(new URL(meta.binary, base)))));

function play(who: "invests" | "idle", seed: number) {
  const out = `/tmp/balance-${who}.log`;
  writeFileSync(out, "");
  const g = newGame(map, seed);
  foundCompany(g, "steel", 483, 237);
  const c = g.company!;
  while (!g.over) {
    const y = cal(g).year;
    if (who === "invests") {
      for (const t of INDUSTRIES.steel.tech) if (!techBlocked(g, c, t) && c.cash > techCost(t, y) * 1.1) commission(g, c, t.id);
      if (!projectBlocked(g, "expand") && c.cash > 2_000_000 * (1 + (y - 1850) * 0.02)) { const p = suggestProject(g, "expand"); if (p) buildProject(g, p); }
    }
    advanceTurn(g);
    const t = c.totals;
    if (cal(g).season === "Spring" && t) {
      const st = techStanding(g, c);
      appendFileSync(out, `${c.bankrupt ? "BANKRUPT " : ""}${cal(g).year} cash ${Math.round(c.cash).toLocaleString()} rev ${t.revenue.toLocaleString()} in ${t.inputCost.toLocaleString()} wages ${t.wages.toLocaleString()} upkeep ${t.upkeep.toLocaleString()} other ${t.other.toLocaleString()} profit ${t.profit.toLocaleString()} made ${t.produced}/${t.workersHired}men techs ${c.techs.length} behind ${st.behind.length} px ${st.factor.toFixed(2)} mkt ${marketFactor(g, "steel").toFixed(2)} annex ${c.annexes.length} rep ${Math.round(c.biz.meters.reputation)} lab ${Math.round(c.biz.meters.labour)}\n`);
    }
  }
}

describe.skipIf(!process.env.SIM)("balance", () => {
  it("plays a steel company that invests", () => play("invests", 7), 900000);
  it("plays a steel company that never invests", () => play("idle", 7), 900000);
});
