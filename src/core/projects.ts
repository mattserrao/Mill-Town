// Things you build on the map. The game suggests a spot; you confirm it or click somewhere else.
//
//   Expand the works     more furnaces and mills on ground touching the works: +30% capacity each (up to 3)
//   Company housing      a block of company doubles near a works: more men close by, labour a little steadier,
//                        and a house the company can take back from a striker
//   Private dock         a landing of your own on the river: no wagon haul and first call on the barges
//   A new works          from 1890: found a second works, in any industry, with the processes of the day

import { permitBlock } from "./enviro";
import { feet } from "./units";
import { bump } from "./business";
import { type Annex, cal, claimFootprint, type Company, type GameState, log, nextWorksId, riverSideOf, updateWorksAccess, type Works } from "./game";
import { INDUSTRIES, type IndustryId } from "./industries";
import { inBounds, vh } from "./map";
import { newestGroup } from "./business";
import { evaluateSite, footprintTiles, popSAT } from "./site";
import { habitable, Terrain } from "./terrain";
import { HouseSub, Street, Use } from "./town";
import { standardTechs, techCost } from "./market";
import { priceLevel } from "./time";
import { foundedWorks } from "./family";
import { recordMove } from "./owners";
import { saleQuote } from "./rivalai";

export type ProjectKind = "expand" | "housing" | "dock" | "found";

export const PROJECTS: Record<ProjectKind, { name: string; blurb: string; from?: number }> = {
  expand: { name: "Expand the works", blurb: "More furnaces and mills on ground beside the works: +30% capacity (up to three times). Homes in the way are cleared." },
  housing: { name: "Build company housing", blurb: "A block of company doubles for 400 people near the works. Labour steadier (+4), strikes a little rarer." },
  dock: { name: "Build a private dock", blurb: "Your own landing on the river: no wagon haul, and first call on the barges when the river is crowded." },
  found: { name: "Found a new works", blurb: "A second works in any industry, built with the processes of the day.", from: 1890 },
};

export interface Proposal {
  kind: ProjectKind;
  x: number; y: number; size: number;
  ok: boolean;
  reason?: string;
  cost: number;
  industry?: IndustryId;
  /** people whose homes are in the way */
  displaced: number;
}

const era = priceLevel;

export function projectSize(g: GameState, kind: ProjectKind, industry?: IndustryId): number {
  const c = g.company!;
  if (kind === "expand") return Math.max(3, Math.round(c.footprint / 2));
  if (kind === "housing") return 5;
  if (kind === "dock") return 3;
  return footprintTiles(g.map, industry ?? c.industry);
}

/** null if the project can be started at all now, otherwise why not */
export function projectBlocked(g: GameState, kind: ProjectKind): string | null {
  const c = g.company;
  if (!c) return "Found your company first";
  if (c.biz.actionsLeft <= 0) return "No actions left this season";
  const y = cal(g).year;
  if (PROJECTS[kind].from && y < PROJECTS[kind].from! && !(kind === "found" && g.family?.newIndustry)) return `From ${PROJECTS[kind].from}`;
  if (kind === "expand" && c.annexes.filter((a) => a.kind === "expand").length >= 3) return "The works has been expanded three times";
  if (kind === "expand") { const pb = permitBlock(g, c); if (pb) return pb; }
  if (kind === "dock" && c.dock) return "The works already has a dock";
  if (kind === "housing" && c.annexes.filter((a) => a.kind === "housing").length >= 4) return "Four blocks of company housing is plenty";
  return null;
}

const blocked = (u: number) => u === Use.Civic || u === Use.Landmark || u === Use.Incline || u === Use.Park || u === Use.Wharf || u === Use.Industry || u === Use.Rival || u === Use.Mine;

/** Is a square at (x, y) good for the project, and what would it cost? */
export function checkProject(g: GameState, kind: ProjectKind, x: number, y: number, industry?: IndustryId): Proposal {
  const c = g.company!, m = g.map, w = g.world, year = cal(g).year;
  const size = projectSize(g, kind, industry);
  const out: Proposal = { kind, x, y, size, ok: true, cost: 0, industry, displaced: 0 };
  const fail = (reason: string) => { out.ok = false; out.reason ??= reason; return out; };
  if (kind === "found" && industry && (INDUSTRIES[industry].from ?? 1850) > year) return fail(`${INDUSTRIES[industry].name} can be founded from ${INDUSTRIES[industry].from}`);
  if (kind === "found") {
    const ind = industry ?? c.industry;
    const rep = evaluateSite(m, w, g.fields, ind, x, y);
    // a modern works: the land and grading, the plant, and the processes of the day
    const std = standardTechs(g, ind).map((id) => INDUSTRIES[ind].tech.find((t) => t.id === id)!);
    out.cost = Math.round((rep.cost * era(year)) + std.reduce((s, t) => s + techCost(t, year) * 0.5, 0));
    out.displaced = 0;
    if (!rep.ok) return fail(rep.reasons.join("; "));
    for (let dy = 0; dy < size; dy++) for (let dx = 0; dx < size; dx++) {
      const i = (y + dy) * m.width + x + dx;
      if (m.rail[i] || m.bridge[i]) return fail("A railroad or bridge is in the way");
    }
    return out;
  }
  let lo = Infinity, hi = -Infinity, water = 0;
  for (let dy = 0; dy < size; dy++) for (let dx = 0; dx < size; dx++) {
    const tx = x + dx, ty = y + dy;
    if (!inBounds(m, tx, ty)) return fail("Off the map");
    const i = ty * m.width + tx;
    if (m.terrain[i] === Terrain.Water) return fail("Runs into the river");
    if (!habitable(m.terrain[i])) return fail("Too steep to build");
    if (w.owner[i] !== 0) return fail("Land already owned by a company");
    if (blocked(w.use[i])) return fail("A church, landmark or works is in the way");
    if (m.rail[i] || m.bridge[i]) return fail("A railroad or bridge is in the way");
    out.displaced += w.pop[i];
    for (const [vx, vy] of [[tx, ty], [tx + 1, ty + 1]]) { const h = vh(m, vx, vy); lo = Math.min(lo, h); hi = Math.max(hi, h); }
    for (const [ax, ay] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (inBounds(m, tx + ax, ty + ay) && m.terrain[(ty + ay) * m.width + tx + ax] === Terrain.Water) water++;
  }
  const relief = hi - lo;
  const site = INDUSTRIES[c.industry].site;
  if (kind === "expand") {
    if (relief > site.maxReliefM * 1.5) return fail(`Ground too uneven (${feet(relief)})`);
    const touches = [c as Works | Annex, ...c.annexes.filter((a) => a.kind === "expand")].some((a) => {
      const ax = a.x, ay = a.y, af = "footprint" in a ? a.footprint : a.fp;
      const gapX = Math.max(ax - (x + size), x - (ax + af)), gapY = Math.max(ay - (y + size), y - (ay + af));
      return Math.max(gapX, gapY) <= 0 && !(gapX === 0 && gapY === 0);
    });
    if (!touches) return fail("Must touch the works");
    out.cost = Math.round(INDUSTRIES[c.industry].startCost * 0.6 * era(year) + out.displaced * 15 * era(year));
  } else if (kind === "housing") {
    if (relief > 20) return fail("Too hilly for a block of houses");
    if (out.displaced > 60) return fail("Too many homes already there");
    const near = [c, ...c.others].some((wk) => Math.hypot(wk.x + wk.footprint / 2 - (x + size / 2), wk.y + wk.footprint / 2 - (y + size / 2)) <= 40);
    if (!near) return fail("Too far from your works (within ¾ mile)");
    out.cost = Math.round(18000 * era(year));
  } else if (kind === "dock") {
    if (!water) return fail("Must be on the riverbank");
    const d = Math.max(c.x - (x + size), x - (c.x + c.footprint), c.y - (y + size), y - (c.y + c.footprint));
    if (d > 12) return fail("Too far from the works (within 1,150 ft)");
    out.cost = Math.round(25000 * era(year));
  }
  return out;
}

/** The best spot the game can find for a project (or null). */
export function suggestProject(g: GameState, kind: ProjectKind, industry?: IndustryId): Proposal | null {
  const c = g.company!;
  const size = projectSize(g, kind, industry);
  const cx = c.x + c.footprint / 2, cy = c.y + c.footprint / 2;
  let best: Proposal | null = null, bs = -Infinity;
  const consider = (x: number, y: number, score: (p: Proposal) => number) => {
    const p = checkProject(g, kind, x, y, industry);
    if (!p.ok) return;
    const s = score(p);
    if (s > bs) { bs = s; best = p; }
  };
  if (kind === "expand") {
    // every position whose edge touches the works or an expansion
    for (const a of [{ x: c.x, y: c.y, fp: c.footprint }, ...c.annexes.filter((q) => q.kind === "expand")]) {
      for (let k = -size + 1; k < a.fp; k++) {
        for (const [x, y] of [[a.x + k, a.y - size], [a.x + k, a.y + a.fp], [a.x - size, a.y + k], [a.x + a.fp, a.y + k]])
          consider(x, y, (p) => -p.displaced * 0.2 - p.cost / 10000);
      }
    }
  } else if (kind === "housing") {
    for (let y = Math.round(cy) - 36; y <= cy + 36; y += 2) for (let x = Math.round(cx) - 36; x <= cx + 36; x += 2)
      consider(x, y, (p) => -Math.hypot(x + size / 2 - cx, y + size / 2 - cy) - p.displaced * 0.3);
  } else if (kind === "dock") {
    for (let y = c.y - 14; y <= c.y + c.footprint + 14; y++) for (let x = c.x - 14; x <= c.x + c.footprint + 14; x++)
      consider(x, y, (p) => -Math.hypot(x + 1.5 - cx, y + 1.5 - cy) - p.displaced * 0.1);
  } else {
    const ind = industry ?? c.industry;
    const m = g.map, ps = popSAT(m, g.world);
    for (let y = 4; y < m.height - size - 4; y += 6) for (let x = 4; x < m.width - size - 4; x += 6) {
      const rep = evaluateSite(m, g.world, g.fields, ind, x, y, ps);
      if (!rep.ok) continue;
      const s = rep.score - Math.hypot(x - cx, y - cy) * 0.02;
      if (s > bs) { const p = checkProject(g, kind, x, y, industry); if (p.ok) { bs = s; best = p; } }
    }
  }
  return best;
}

/** Build it: pay, take an action, change the map. */
export function buildProject(g: GameState, p: Proposal): { ok: boolean; text: string } {
  const c = g.company;
  if (!c) return { ok: false, text: "No company" };
  const why = projectBlocked(g, p.kind);
  if (why) return { ok: false, text: why };
  const q = checkProject(g, p.kind, p.x, p.y, p.industry);
  if (!q.ok) return { ok: false, text: q.reason ?? "Can't build there" };
  // the heir's new industry: the old works will be sold when the new one opens, so the bank lends against it
  const heirs = p.kind === "found" && g.family?.newIndustry?.industry === q.industry;
  const bridge = heirs && g.family!.newIndustry!.sellOld && !c.biz.flags.toUss ? saleQuote(g, c) : 0;
  if (c.cash + bridge < q.cost) return { ok: false, text: `Needs $${q.cost.toLocaleString()}` };
  c.cash -= q.cost;
  if (!heirs) c.biz.actionsLeft--;
  const year = cal(g).year, m = g.map, w = g.world;
  let text = "";
  if (p.kind === "expand") {
    claimFootprint(g, q.x, q.y, q.size, 1, Use.Industry);
    c.annexes.push({ kind: "expand", x: q.x, y: q.y, fp: q.size, year });
    if (q.displaced) bump(g, "reputation", -Math.min(10, q.displaced / 100));
    text = `New furnaces and mills go up beside ${c.name.replace(/\.$/, "")}${q.displaced ? `; ${q.displaced} people lose their homes` : ""}.`;
  } else if (p.kind === "housing") {
    const group = newestGroup(year);
    for (let dy = 0; dy < q.size; dy++) for (let dx = 0; dx < q.size; dx++) {
      const i = (q.y + dy) * m.width + q.x + dx;
      w.owner[i] = 0; w.sub[i] = HouseSub.Company; w.built[i] = year; w.was[i] = w.eth[i];
      if (dy === 2) { w.use[i] = Use.Empty; w.street[i] = Street.Lane; w.pop[i] = 0; continue; }
      w.street[i] = 0; w.use[i] = Use.Houses; w.pop[i] = 16; w.eth[i] = w.eth[i] || group;
    }
    c.annexes.push({ kind: "housing", x: q.x, y: q.y, fp: q.size, year });
    text = `${c.name} builds a block of company doubles.`;
  } else if (p.kind === "dock") {
    let water: [number, number] | undefined;
    for (let dy = 0; dy < q.size; dy++) for (let dx = 0; dx < q.size; dx++) {
      const x = q.x + dx, y = q.y + dy, i = y * m.width + x;
      w.use[i] = Use.Wharf; w.owner[i] = 1; w.pop[i] = 0; w.street[i] = 0; w.built[i] = year;
      for (const [ax, ay] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (!water && inBounds(m, x + ax, y + ay) && m.terrain[(y + ay) * m.width + x + ax] === Terrain.Water) water = [x + ax, y + ay];
    }
    c.dock = water;
    c.annexes.push({ kind: "dock", x: q.x, y: q.y, fp: q.size, year });
    text = `${c.name} opens its own river landing.`;
  } else {
    const ind = q.industry ?? c.industry;
    claimFootprint(g, q.x, q.y, q.size, 1, Use.Industry);
    const nw = newWorks(c, ind, q.x, q.y, q.size, riverSideOf(m, q.x, q.y, q.size), year, [INDUSTRIES[ind].tech[0].id, ...standardTechs(g, ind)]);
    let place = "", pd = Infinity;
    for (const l of m.landmarks) if (l.kind === "town") { const d = Math.hypot(l.x - q.x, l.y - q.y); if (d < pd) { pd = d; place = l.name.replace(/ \(.*\)$/, ""); } }
    nw.name = `${place || "New"} ${INDUSTRIES[ind].name} Works`;
    updateWorksAccess(g, nw);
    text = `${c.name} breaks ground on a new ${INDUSTRIES[ind].name.toLowerCase()} works.`;
    foundedWorks(g, nw);
  }
  w.version++;
  if (p.kind === "expand" || p.kind === "found") recordMove(g, "expand", undefined, p.kind === "found" ? q.industry : c.industry);
  c.biz.record.push(`${cal(g).season} ${year}: ${PROJECTS[p.kind].name}`);
  log(g, text);
  return { ok: true, text };
}

export function newWorks(c: Company, industry: IndustryId, x: number, y: number, fp: number, side: Works["riverSide"], year: number, techs: string[]): Works {
  const w: Works = {
    id: nextWorksId(c), name: INDUSTRIES[industry].name, industry, x, y, footprint: fp, techs: [...new Set(techs)],
    employees: 0, produced: 0, seasonsOperating: 0, riverSide: side, status: "running", strikeTurns: 0, health: 1, unrest: 0,
    annexes: [], founded: year,
  };
  c.others.push(w);
  return w;
}
