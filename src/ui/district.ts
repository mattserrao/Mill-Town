// The "Neighbourhood" panel: who lives in the selected tile's neighbourhood, what each community has built
// there, and what it builds next as more of its people arrive.

import { GROUPS } from "../core/ancestry";
import { cityName, districts, zoneName } from "../core/districts";
import type { GameState } from "../core/game";
import { CivicSub, communityTargets, zoneCensus } from "../core/town";

const fmt = (n: number) => Math.round(n).toLocaleString("en-US");
const plural = (n: number, one: string, many = one + "s") => `${n} ${n === 1 ? one : many}`;

export function zoneAt(g: GameState, x: number, y: number): number {
  const d = districts(g.map);
  return x < 0 || y < 0 || x >= g.map.width || y >= g.map.height ? -1 : d.zone[y * g.map.width + x];
}

export function districtPanel(g: GameState, el: HTMLElement, zone: number): boolean {
  if (zone < 0) return false;
  const d = districts(g.map), year = g.world.year;
  const c = zoneCensus(g.map, g.world)[zone];
  if (!c) return false;
  const zn = zoneName(d, zone, year);
  const t0 = d.zoneTiles[d.zoneStart[zone]];
  const city = cityName(d, d.muni[t0], year);
  const groups = [...c.pop.keys()].filter((k) => k > 0 && c.pop[k] >= 50).sort((a, b) => c.pop[b] - c.pop[a]);
  const civicBy: Record<number, string[]> = {};
  const rows = groups.map((gid) => {
    const p = c.pop[gid], gr = GROUPS[gid];
    const shops = [...(c.shops.get(gid)?.values() ?? [])].reduce((s, n) => s + n, 0);
    const have = [
      c.church[gid] ? plural(c.church[gid], gr.church === CivicSub.Synagogue ? "synagogue" : "church", gr.church === CivicSub.Synagogue ? "synagogues" : "churches") : "",
      c.school[gid] ? plural(c.school[gid], "parish school") : "",
      c.hall[gid] ? (c.hall[gid] > 1 ? `${c.hall[gid]} halls` : gr.hall) : "",
      shops ? plural(shops, "shop") : "",
      c.boarding[gid] ? plural(c.boarding[gid], "boarding house") : "",
    ].filter(Boolean);
    civicBy[gid] = have;
    // the next thing this community builds here, and at how many people
    const t = communityTargets(p, gid, year, c.church[gid]);
    let next = "";
    if (!shops && p < 300) next = `its own shops at 300 people`;
    else if (!c.church[gid] && p < 700) next = `${gr.church === CivicSub.Synagogue ? "a synagogue" : "a church"} at 700 people`;
    else if (!c.church[gid]) next = `${gr.church === CivicSub.Synagogue ? "a synagogue" : "a church"} — coming soon`;
    else if (!c.hall[gid] && year < 1870) next = `a social hall (from 1870)`;
    else if (!c.hall[gid]) next = `the ${gr.hall} — coming soon`;
    else if (t.school === 0 && p < 1200 && gid !== 1 && gid !== 4 && gid !== 11) next = `a parish school at 1,200 people`;
    else if (c.church[gid] < 4 && p < 700 + 4000 * c.church[gid]) next = `another church at ${fmt(700 + 4000 * c.church[gid])} people`;
    const share = c.tot ? p / c.tot : 0;
    return `<div class="dist-grp"><span><b style="color:rgb(${gr.colour.join(",")})">■</b> ${gr.name}</span><span style="text-align:right">${fmt(p)}</span>
      <div class="dist-bar"><b style="width:${Math.max(2, share * 100)}%;background:rgb(${gr.colour.join(",")})"></b></div>
      <div class="dist-next">${have.length ? `Has ${have.join(", ")}.` : "Nothing of its own yet."}${next ? ` Next: ${next}.` : ""}</div></div>`;
  }).join("");
  el.innerHTML = `<div class="dist-name">${zn.name}</div>
    <div class="dist-city">${zn.named ? `${city} · ` : ""}${fmt(c.tot)} people</div>
    ${rows || `<p class="hint">Hardly anyone lives here yet.</p>`}
    <p class="hint">Each community builds in its own neighbourhood as its people arrive: boarding houses first, then its own shops (300 people), a church (700), a social hall, and a parish school (1,200). When a community moves away, its church passes to the newcomers or closes.</p>`;
  return true;
}
