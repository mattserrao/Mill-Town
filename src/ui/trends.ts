// Trends: how the business, the markets and the town have moved, season by season. Three tabs (Business,
// Prices & wages, Town). Line charts drawn on canvas; hover a chart to read off a year.

import { cal, type GameState, type PricePoint } from "../core/game";
import { INDUSTRIES, INDUSTRY_IDS, type IndustryId } from "../core/industries";
import { RIVALS } from "../core/rivals";
import { relationOf } from "../core/economy";
import { nameNow } from "../core/rivals";
import { calendar } from "../core/time";
import { riskRows, risks, shareAt } from "./risks";

interface Series {
  name: string; colour: string; values: (number | undefined)[];
  dash?: boolean; width?: number; fill?: boolean;
  /** shown in the legend instead of the plotted value */ shown?: (number | undefined)[];
}
interface ChartOpts { fmt?: (n: number) => string; axis?: (n: number) => string; stacked?: boolean; marks?: { k: number; label: string }[]; max?: number }

const IND_COLOUR: Record<IndustryId, string> = { steel: "#e07a4a", power: "#e8d050", glass: "#7ac8e0", metalworks: "#a8a0e0", aluminium: "#c8ccd4", chemicals: "#8ac06a", research: "#e0a0d0", nuclear: "#60d0b0", medicine: "#f08080" };
const money = (n: number) => { const a = Math.abs(n), s = n < 0 ? "−" : ""; return a >= 1e6 ? `${s}$${(a / 1e6).toFixed(2)}M` : a >= 1e4 ? `${s}$${Math.round(a / 1000)}k` : a >= 100 ? `${s}$${Math.round(a).toLocaleString()}` : `${s}$${a.toFixed(2)}`; };
const moneyAxis = (n: number) => { const a = Math.abs(n), s = n < 0 ? "−" : ""; return a >= 1e6 ? `${s}$${+(a / 1e6).toFixed(1)}M` : a >= 1000 ? `${s}$${+(a / 1000).toFixed(1)}k` : a >= 10 ? `${s}$${Math.round(a)}` : `${s}$${a.toFixed(2)}`; };
const count = (n: number) => (Math.abs(n) >= 1e6 ? `${+(n / 1e6).toFixed(2)}M` : Math.abs(n) >= 1e4 ? `${Math.round(n / 1000)}k` : Math.round(n).toLocaleString());
const countAxis = (n: number) => (Math.abs(n) >= 1e6 ? `${+(n / 1e6).toFixed(1)}M` : Math.abs(n) >= 1000 ? `${+(n / 1000).toFixed(1)}k` : `${Math.round(n)}`);
const pct = (n: number) => `${Math.round(n)}%`;
const index = (n: number) => `${Math.round(n)}`;

/** a "nice" gridline step (1, 2, 2.5 or 5 × a power of ten) giving about four divisions */
function niceStep(span: number): number {
  const raw = span / 4, p = 10 ** Math.floor(Math.log10(raw)), f = raw / p;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * p;
}

/** a year's running average (four seasons), so the season-to-season jitter doesn't hide the trend */
const yearly = (v: (number | undefined)[]) => v.map((_, k) => {
  const w = v.slice(Math.max(0, k - 3), k + 1).filter((x): x is number => x !== undefined && isFinite(x));
  return w.length ? w.reduce((s, x) => s + x, 0) / w.length : undefined;
});

let range: "all" | "30" | "10" = "all";
let tab: "business" | "prices" | "town" = "business";

function chart(cv: HTMLCanvasElement, years: number[], series: Series[], legend: HTMLElement, o: ChartOpts = {}) {
  const fmt = o.fmt ?? money, axis = o.axis ?? (fmt === money ? moneyAxis : fmt === count ? countAxis : fmt);
  const dpr = window.devicePixelRatio || 1;
  const W = cv.clientWidth, H = cv.clientHeight;
  cv.width = W * dpr; cv.height = H * dpr;
  const ctx = cv.getContext("2d")!;
  ctx.scale(dpr, dpr);
  const L = 50, R = 10, T = 8, B = 20;
  // stacked: each series sits on the ones before it
  const base: number[] = new Array(years.length).fill(0);
  const tops = series.map((s) => {
    if (!o.stacked) return s.values;
    const t = s.values.map((v, k) => base[k] + (v ?? 0));
    t.forEach((v, k) => (base[k] = v));
    return t;
  });
  const vals = tops.flatMap((v) => v.filter((x): x is number => x !== undefined && isFinite(x)));
  if (!vals.length || years.length < 2) { ctx.fillStyle = "#777"; ctx.font = "11px monospace"; ctx.fillText("Not enough history yet.", L, H / 2); legend.innerHTML = ""; return; }
  let lo = Math.min(0, ...vals), hi = o.max ?? Math.max(...vals);
  if (hi === lo) hi = lo + 1;
  const step = fmt === count || fmt === index ? Math.max(1, niceStep(hi - lo)) : niceStep(hi - lo);
  lo = Math.floor(lo / step) * step; hi = Math.ceil(hi / step) * step;
  const x = (k: number) => L + (k / (years.length - 1)) * (W - L - R);
  const y = (v: number) => T + (1 - (v - lo) / (hi - lo)) * (H - T - B);
  const draw = (hover?: number) => {
    ctx.clearRect(0, 0, W, H);
    ctx.font = "10px monospace"; ctx.textBaseline = "middle";
    for (let v = lo; v <= hi + step / 2; v += step) {
      const yy = y(v);
      ctx.strokeStyle = "#2c3038"; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(L, yy); ctx.lineTo(W - R, yy); ctx.stroke();
      ctx.fillStyle = "#8a909a"; ctx.textAlign = "right"; ctx.fillText(axis(v), L - 4, yy);
    }
    if (lo < 0) { ctx.strokeStyle = "#8a909a"; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(L, y(0)); ctx.lineTo(W - R, y(0)); ctx.stroke(); }
    const y0 = years[0], y1 = years[years.length - 1], ystep = y1 - y0 > 60 ? 20 : y1 - y0 > 20 ? 10 : 2;
    ctx.textAlign = "center"; ctx.fillStyle = "#8a909a";
    for (let k = 0; k < years.length; k++) if (years[k] % ystep === 0 && (k === 0 || years[k - 1] !== years[k])) ctx.fillText(String(years[k]), x(k), H - 8);
    // milestones (new processes): dashed lines with staggered labels
    (o.marks ?? []).forEach((m, i) => {
      ctx.strokeStyle = "rgba(224,162,67,0.45)"; ctx.setLineDash([2, 3]); ctx.beginPath(); ctx.moveTo(x(m.k), T); ctx.lineTo(x(m.k), H - B); ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle = "#e0a243"; ctx.textAlign = "left"; ctx.fillText(m.label, x(m.k) + 3, T + 6 + (i % 3) * 11);
    });
    tops.forEach((top, si) => {
      const s = series[si];
      if (o.stacked || s.fill) {
        const prev = o.stacked && si > 0 ? tops[si - 1] : null;
        ctx.beginPath();
        let started = false;
        top.forEach((v, k) => { if (v === undefined) return; if (started) ctx.lineTo(x(k), y(v)); else { ctx.moveTo(x(k), y(v)); started = true; } });
        for (let k = top.length - 1; k >= 0; k--) ctx.lineTo(x(k), y(prev ? prev[k] ?? 0 : Math.max(lo, 0)));
        ctx.closePath();
        ctx.fillStyle = s.colour; ctx.globalAlpha = o.stacked ? 0.85 : 0.15; ctx.fill(); ctx.globalAlpha = 1;
        if (o.stacked) return;
      }
      ctx.strokeStyle = s.colour; ctx.lineWidth = s.width ?? 1.6; ctx.setLineDash(s.dash ? [4, 3] : []);
      ctx.beginPath();
      let pen = false;
      top.forEach((v, k) => { if (v === undefined || !isFinite(v)) { pen = false; return; } if (pen) ctx.lineTo(x(k), y(v)); else { ctx.moveTo(x(k), y(v)); pen = true; } });
      ctx.stroke();
    });
    ctx.setLineDash([]);
    if (hover !== undefined) {
      ctx.strokeStyle = "rgba(255,255,255,0.35)"; ctx.beginPath(); ctx.moveTo(x(hover), T); ctx.lineTo(x(hover), H - B); ctx.stroke();
      if (!o.stacked) for (const [si, s] of series.entries()) { const v = tops[si][hover]; if (v === undefined) continue; ctx.fillStyle = s.colour; ctx.beginPath(); ctx.arc(x(hover), y(v), 3, 0, 7); ctx.fill(); }
    }
    legend.innerHTML = series.map((s) => { const arr = s.shown ?? s.values; const v = hover !== undefined ? arr[hover] : arr[arr.length - 1]; return `<span><i style="background:${s.colour}"></i>${s.name}${v !== undefined ? ` <b>${fmt(v)}</b>` : ""}</span>`; }).join("") + (hover !== undefined ? `<span class="tr-year">${years[hover]}</span>` : "");
  };
  draw();
  cv.onmousemove = (e) => { const r = cv.getBoundingClientRect(); const k = Math.round(((e.clientX - r.left - L) / (W - L - R)) * (years.length - 1)); draw(Math.max(0, Math.min(years.length - 1, k))); };
  cv.onmouseleave = () => draw();
}

const box = (id: string, title: string, now = "") => `<div class="tr-box"><h4>${title}${now ? `<b>${now}</b>` : ""}</h4><canvas id="${id}"></canvas><div class="tr-legend" id="${id}L"></div></div>`;

export function trendsView(g: GameState, el: HTMLElement, onGo?: (tab: string) => void) {
  const now = cal(g).year;
  const c = g.company;
  const founded = g.prices.findIndex((p) => p.revenue !== undefined);
  let pts: PricePoint[] = range === "all" ? g.prices : g.prices.filter((p) => calendar(p.turn).year > now - Number(range));
  if (tab === "business" && founded >= 0 && range === "all") pts = g.prices.slice(founded);
  const years = pts.map((p) => calendar(p.turn).year);
  const last = pts[pts.length - 1];
  const ind = c?.industry;
  const mine = c ? [...new Set([c.industry, ...c.others.map((w) => w.industry)])] : [];

  let body = "";
  if (tab === "business") {
    if (!c) body = `<p class="hint tr-empty">Found a company to see its history here.</p>`;
    else {
      const sh = last ? shareAt(last, c.industry) : undefined;
      const uc = last?.unitCost, price = last?.yours[c.industry] ?? last?.market[c.industry];
      body = `<div class="tr-grid">
        ${box("trCash", "Cash and net worth", money(c.cash))}
        ${box("trProfit", "Revenue, costs, profit — per season", last?.profit !== undefined ? money(last.profit) : "")}
        ${box("trMargin", "Price and cost per unit", uc && price ? `margin ${Math.round((1 - uc / price) * 100)}%` : "")}
        ${box("trGrowth", "Capacity, output and men", last?.capacity ? `${count(last.capacity)} cap · ${count(last.employees ?? 0)} men` : "")}
        ${box("trShare", `Share of ${INDUSTRIES[c.industry].name.toLowerCase()} output`, sh !== undefined ? pct(sh * 100) : "")}
        ${box("trMarket", `The ${INDUSTRIES[c.industry].name.toLowerCase()} market: demand and supply`, last?.mkt?.[c.industry] ? `${count(last.mkt[c.industry]![0])} wanted · ${count(last.mkt[c.industry]![1])} offered` : "from 1893")}
        <div class="tr-box"><h4>Watch</h4><div class="tr-risks">${riskRows(risks(g))}</div></div>
      </div>`;
    }
  } else if (tab === "prices") {
    body = `<div class="tr-grid tr-grid2">
      ${box("trPrice", "Prices by industry (1850 = 100; legend in $)")}
      ${box("trWage", "Wages: $ per man per season", last ? money(last.wage) : "")}
      ${box("trRaw", "Coal and ore: $ per ton", last ? money(last.raw) : "")}
      ${box("trYours", ind ? "What you got against the market (1850 = 100)" : "Your prices (found a company first)")}
    </div>`;
  } else {
    body = `<div class="tr-grid tr-grid2">
      ${box("trPop", "Valley population", last?.pop ? count(last.pop) : "")}
      ${box("trMorale", "Town morale (0–100)", last?.morale !== undefined ? String(last.morale) : "")}
      ${box("trJobless", "Out of work", last?.jobless !== undefined ? count(last.jobless) : "")}
      ${box("trMen", "Your workforce: health and unrest", c ? `${Math.round(c.health * 100)}% · ${Math.round(c.unrest * 100)}%` : "")}
    </div>`;
  }

  el.innerHTML = `<div class="tr-head"><h3>Trends</h3>
    <div class="tr-tabs">${([["business", "Business"], ["prices", "Prices & wages"], ["town", "Town"]] as const).map(([k, n]) => `<button data-t="${k}" class="${k === tab ? "on" : ""}">${n}</button>`).join("")}</div>
    <span class="spacer"></span>
    <div class="tr-range">${(["all", "30", "10"] as const).map((r) => `<button data-r="${r}" class="${r === range ? "on" : ""}">${r === "all" ? (tab === "business" ? "All" : "Since 1850") : `${r} yrs`}</button>`).join("")}</div>
    <button class="tr-close" title="Close (Esc)">✕</button></div>${body}`;
  el.hidden = false;
  el.querySelector(".tr-close")!.addEventListener("click", () => { el.hidden = true; });
  el.querySelectorAll<HTMLButtonElement>("button[data-r]").forEach((b) => b.addEventListener("click", () => { range = b.dataset.r as typeof range; trendsView(g, el, onGo); }));
  el.querySelectorAll<HTMLButtonElement>("button[data-t]").forEach((b) => b.addEventListener("click", () => { tab = b.dataset.t as typeof tab; trendsView(g, el, onGo); }));
  el.querySelectorAll<HTMLButtonElement>("button[data-go]").forEach((b) => b.addEventListener("click", () => { el.hidden = true; onGo?.(b.dataset.go!); }));
  const $ = (id: string) => el.querySelector<HTMLElement>(`#${id}`)!;
  const cv = (id: string) => $(id) as HTMLCanvasElement;
  const ix = (id: IndustryId, v: number | undefined) => (v === undefined ? undefined : (v / INDUSTRIES[id].basePrice) * 100);

  if (tab === "business" && c) {
    chart(cv("trCash"), years, [{ name: "Cash", colour: "#e0a243", values: pts.map((p) => p.cash), fill: true, width: 2 }, { name: "Net worth", colour: "#7cc87c", values: pts.map((p) => p.worth ?? p.cash), width: 2 }], $("trCashL"));
    chart(cv("trProfit"), years, [
      { name: "Revenue", colour: "#7ac8e0", values: yearly(pts.map((p) => p.revenue)), shown: pts.map((p) => p.revenue) },
      { name: "Costs", colour: "#e07a64", values: yearly(pts.map((p) => p.costs)), shown: pts.map((p) => p.costs) },
      { name: "Profit", colour: "#7cc87c", values: yearly(pts.map((p) => p.profit)), shown: pts.map((p) => p.profit), width: 2.2 },
    ], $("trProfitL"));
    chart(cv("trMargin"), years, [
      { name: "Market", colour: "#9c978b", dash: true, values: pts.map((p) => p.market[c.industry]) },
      { name: "You got", colour: "#e0a243", width: 2, values: pts.map((p) => p.yours[c.industry]) },
      { name: "Your cost", colour: "#e07a64", width: 2, values: yearly(pts.map((p) => p.unitCost)), shown: pts.map((p) => p.unitCost) },
    ], $("trMarginL"));
    // a mark where each new process first appears
    const marks: { k: number; label: string }[] = [];
    let had = new Set<string>(pts[0]?.techs ?? []);
    pts.forEach((p, k) => {
      for (const t of p.techs ?? []) if (!had.has(t)) { const def = INDUSTRY_IDS.map((i) => INDUSTRIES[i].tech.find((x) => x.id === t)).find(Boolean); if (def) marks.push({ k, label: def.name.split(/[ -]/)[0] }); }
      if (p.techs) had = new Set(p.techs);
    });
    chart(cv("trMarket"), years, [
      { name: "Demand", colour: "#7cc87c", width: 2, values: pts.map((p) => p.mkt?.[c.industry]?.[0]) },
      { name: "Supply", colour: "#e07a64", width: 2, values: pts.map((p) => p.mkt?.[c.industry]?.[1]) },
    ], $("trMarketL"), { fmt: count });
    chart(cv("trGrowth"), years, [
      { name: "Capacity", colour: "#e0a243", width: 2, values: pts.map((p) => p.capacity) },
      { name: "Output", colour: "#7ac8e0", values: yearly(pts.map((p) => p.produced)), shown: pts.map((p) => p.produced) },
      { name: "Men", colour: "#7cc87c", dash: true, values: pts.map((p) => p.employees) },
    ], $("trGrowthL"), { fmt: count, marks });
    // share of the industry's output: you and each rival works, stacked to 100%
    const rivalIds = [...new Set(pts.flatMap((p) => Object.keys(p.rivals ?? {})))].filter((id) => { const d = RIVALS.find((r) => r.id === id); return d && relationOf(c.industry, d.industry, id) === "competitor"; });
    const total = pts.map((p) => (p.prodInd?.[c.industry] ?? 0) + rivalIds.reduce((s, id) => s + (p.rivals?.[id] ?? 0), 0));
    const reds = ["#c8503a", "#d8784a", "#a84434", "#e09a6a", "#8c3a2e", "#b8604a", "#70302a", "#d0866a"];
    chart(cv("trShare"), years, [
      { name: "You", colour: "#ffd34a", values: pts.map((p, k) => (total[k] ? ((p.prodInd?.[c.industry] ?? 0) / total[k]) * 100 : undefined)) },
      ...rivalIds.map((id, i) => { const d = RIVALS.find((r) => r.id === id)!; const st = g.rivals.find((r) => r.id === id); return { name: ((n: string) => n.match(/\((.*)\)$/)?.[1] ?? n)(nameNow(d, now, st?.name, st?.nameYear)), colour: reds[i % reds.length], values: pts.map((p, k) => (total[k] ? ((p.rivals?.[id] ?? 0) / total[k]) * 100 : undefined)) }; }),
    ], $("trShareL"), { fmt: pct, stacked: true, max: 100 });
  } else if (tab === "prices") {
    chart(cv("trPrice"), years, INDUSTRY_IDS.map((id) => ({ name: INDUSTRIES[id].name, colour: IND_COLOUR[id], values: pts.map((p) => ix(id, p.market[id])), shown: pts.map((p) => p.market[id]), width: mine.includes(id) ? 2.2 : 1.2 })), $("trPriceL"), { fmt: money, axis: index });
    chart(cv("trWage"), years, [{ name: "Wages", colour: "#7cc87c", values: pts.map((p) => p.wage) }], $("trWageL"));
    chart(cv("trRaw"), years, [
      { name: "At the mine", colour: "#c8a040", values: pts.map((p) => p.raw) },
      { name: "Delivered to you", colour: "#e07a64", dash: true, values: yearly(pts.map((p) => p.delivered)), shown: pts.map((p) => p.delivered) },
    ], $("trRawL"));
    chart(cv("trYours"), years, mine.flatMap((id) => [
      { name: `${INDUSTRIES[id].name} market`, colour: IND_COLOUR[id], dash: true, values: pts.map((p) => ix(id, p.market[id])), shown: pts.map((p) => p.market[id]) },
      { name: "you got", colour: IND_COLOUR[id], width: 2.2, values: pts.map((p) => ix(id, p.yours[id])), shown: pts.map((p) => p.yours[id]) },
    ]), $("trYoursL"), { fmt: money, axis: index });
  } else {
    chart(cv("trPop"), years, [{ name: "People", colour: "#7ac8e0", values: pts.map((p) => p.pop), fill: true }], $("trPopL"), { fmt: count });
    chart(cv("trMorale"), years, [{ name: "Morale", colour: "#e0a243", values: pts.map((p) => p.morale) }], $("trMoraleL"), { fmt: index, max: 100 });
    chart(cv("trJobless"), years, [{ name: "Jobless", colour: "#e07a64", values: pts.map((p) => p.jobless), fill: true }], $("trJoblessL"), { fmt: count });
    chart(cv("trMen"), years, [
      { name: "Health", colour: "#7cc87c", values: pts.map((p) => (p.health === undefined ? undefined : p.health * 100)) },
      { name: "Unrest", colour: "#e07a64", values: pts.map((p) => (p.unrest === undefined ? undefined : p.unrest * 100)) },
    ], $("trMenL"), { fmt: pct, max: 100 });
  }
}

export function resetTrends() { tab = "business"; }
