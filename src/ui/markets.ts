// The Markets view: what each industry's product fetches over the years, what you actually got, wages,
// raw materials, and your company's accounts. Line charts drawn on canvas; hover for the values.

import { cal, type GameState, type PricePoint } from "../core/game";
import { INDUSTRIES, INDUSTRY_IDS, type IndustryId } from "../core/industries";
import { calendar } from "../core/time";

interface Series { name: string; colour: string; values: (number | undefined)[]; dash?: boolean; width?: number; /** shown in the legend instead of the plotted value */ shown?: (number | undefined)[] }

const IND_COLOUR: Record<IndustryId, string> = { steel: "#e07a4a", power: "#e8d050", glass: "#7ac8e0", metalworks: "#a8a0e0" };
const money = (n: number) => { const a = Math.abs(n), s = n < 0 ? "-" : ""; return a >= 1e6 ? `${s}$${(a / 1e6).toFixed(1)}M` : a >= 1e4 ? `${s}$${Math.round(a / 1000)}k` : a >= 100 ? `${s}$${Math.round(a).toLocaleString()}` : `${s}$${a.toFixed(2)}`; };
const index = (n: number) => `${Math.round(n)}`;
/** axis labels: round numbers ($5k, $10k, $2.50) */
const moneyAxis = (n: number) => { const a = Math.abs(n), s = n < 0 ? "-" : ""; return a >= 1e6 ? `${s}$${+(a / 1e6).toFixed(1)}M` : a >= 1000 ? `${s}$${+(a / 1000).toFixed(1)}k` : a >= 10 ? `${s}$${Math.round(a)}` : `${s}$${a.toFixed(2)}`; };

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

function chart(cv: HTMLCanvasElement, years: number[], series: Series[], legend: HTMLElement, fmt = money, axis: (n: number) => string = fmt === money ? moneyAxis : fmt) {
  const dpr = window.devicePixelRatio || 1;
  const W = cv.clientWidth, H = cv.clientHeight;
  cv.width = W * dpr; cv.height = H * dpr;
  const ctx = cv.getContext("2d")!;
  ctx.scale(dpr, dpr);
  const L = 54, R = 8, T = 8, B = 20;
  const vals = series.flatMap((s) => s.values.filter((v): v is number => v !== undefined && isFinite(v)));
  if (!vals.length || years.length < 2) { ctx.fillStyle = "#777"; ctx.font = "11px monospace"; ctx.fillText("Not enough history yet.", L, H / 2); return; }
  let lo = Math.min(0, ...vals), hi = Math.max(...vals);
  if (hi === lo) hi = lo + 1;
  const step = niceStep(hi - lo);
  lo = Math.floor(lo / step) * step; hi = Math.ceil(hi / step) * step;
  const x = (k: number) => L + (k / (years.length - 1)) * (W - L - R);
  const y = (v: number) => T + (1 - (v - lo) / (hi - lo)) * (H - T - B);
  const draw = (hover?: number) => {
    ctx.clearRect(0, 0, W, H);
    ctx.font = "10px monospace"; ctx.textBaseline = "middle";
    // grid and axes
    for (let v = lo; v <= hi + step / 2; v += step) {
      const yy = y(v);
      ctx.strokeStyle = "#2c3038"; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(L, yy); ctx.lineTo(W - R, yy); ctx.stroke();
      ctx.fillStyle = "#8a909a"; ctx.textAlign = "right"; ctx.fillText(axis(v), L - 4, yy);
    }
    if (lo < 0) { ctx.strokeStyle = "#8a909a"; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(L, y(0)); ctx.lineTo(W - R, y(0)); ctx.stroke(); }
    const y0 = years[0], y1 = years[years.length - 1], ystep = y1 - y0 > 60 ? 20 : y1 - y0 > 20 ? 10 : 2;
    ctx.textAlign = "center"; ctx.fillStyle = "#8a909a";
    for (let k = 0; k < years.length; k++) if (years[k] % ystep === 0 && (k === 0 || years[k - 1] !== years[k])) ctx.fillText(String(years[k]), x(k), H - 8);
    for (const s of series) {
      ctx.strokeStyle = s.colour; ctx.lineWidth = s.width ?? 1.6; ctx.setLineDash(s.dash ? [4, 3] : []);
      ctx.beginPath();
      let pen = false;
      s.values.forEach((v, k) => { if (v === undefined || !isFinite(v)) { pen = false; return; } if (pen) ctx.lineTo(x(k), y(v)); else { ctx.moveTo(x(k), y(v)); pen = true; } });
      ctx.stroke();
    }
    ctx.setLineDash([]);
    if (hover !== undefined) {
      ctx.strokeStyle = "rgba(255,255,255,0.35)"; ctx.beginPath(); ctx.moveTo(x(hover), T); ctx.lineTo(x(hover), H - B); ctx.stroke();
      for (const s of series) { const v = s.values[hover]; if (v === undefined) continue; ctx.fillStyle = s.colour; ctx.beginPath(); ctx.arc(x(hover), y(v), 3, 0, 7); ctx.fill(); }
    }
    legend.innerHTML = series.map((s) => { const arr = s.shown ?? s.values; const v = hover !== undefined ? arr[hover] : arr[arr.length - 1]; return `<span><i style="background:${s.colour}"></i>${s.name}${v !== undefined ? ` ${fmt(v)}` : ""}</span>`; }).join("") + (hover !== undefined ? `<span>· ${years[hover]}</span>` : "");
  };
  draw();
  cv.onmousemove = (e) => { const r = cv.getBoundingClientRect(); const k = Math.round(((e.clientX - r.left - L) / (W - L - R)) * (years.length - 1)); draw(Math.max(0, Math.min(years.length - 1, k))); };
  cv.onmouseleave = () => draw();
}

export function marketsView(g: GameState, el: HTMLElement) {
  const all = g.prices;
  const now = cal(g).year;
  const pts: PricePoint[] = range === "all" ? all : all.filter((p) => calendar(p.turn).year > now - Number(range));
  const years = pts.map((p) => calendar(p.turn).year);
  const c = g.company;
  const mine = c ? [...new Set([c.industry, ...c.others.map((w) => w.industry)])] : [];
  el.innerHTML = `<button class="mk-close" title="Close (Esc)">✕</button>
    <h3>Markets</h3>
    <p class="hint">What things fetched and cost, season by season. Hover a chart to read off a season. Dashed lines are what your works actually got — below the market when your processes are behind, above when you own your rivals or they're crippled.</p>
    <div class="mk-tabs">Show ${(["all", "30", "10"] as const).map((r) => `<button data-r="${r}" class="${r === range ? "on" : ""}">${r === "all" ? "Since 1850" : `Last ${r} years`}</button>`).join(" ")}</div>
    <div class="mk-row">
      <div class="mk-chart"><h4>Prices by industry (1850 = 100; the legend gives $ per unit)</h4><canvas id="mkPrice"></canvas><div class="mk-legend" id="mkPriceL"></div></div>
      <div class="mk-chart"><h4>Wages: $ per man per season</h4><canvas id="mkWage"></canvas><div class="mk-legend" id="mkWageL"></div></div>
      <div class="mk-chart"><h4>Coal and ore: $ per ton (at the mine, and delivered to you)</h4><canvas id="mkRaw"></canvas><div class="mk-legend" id="mkRawL"></div></div>
      <div class="mk-chart"><h4>${c ? `${c.name}: revenue, costs and profit per season (lines: yearly average)` : "Your company (found one to see its accounts)"}</h4><canvas id="mkCo"></canvas><div class="mk-legend" id="mkCoL"></div></div>
    </div>`;
  el.hidden = false;
  el.querySelector(".mk-close")!.addEventListener("click", () => { el.hidden = true; });
  el.querySelectorAll<HTMLButtonElement>("button[data-r]").forEach((b) => b.addEventListener("click", () => { range = b.dataset.r as typeof range; marketsView(g, el); }));
  const $ = (id: string) => el.querySelector<HTMLElement>(`#${id}`)!;
  const ix = (id: IndustryId, v: number | undefined) => (v === undefined ? undefined : (v / INDUSTRIES[id].basePrice) * 100);
  chart($("mkPrice") as HTMLCanvasElement, years, [
    ...INDUSTRY_IDS.map((id) => ({ name: INDUSTRIES[id].name, colour: IND_COLOUR[id], values: pts.map((p) => ix(id, p.market[id])), shown: pts.map((p) => p.market[id]), width: mine.includes(id) ? 2.2 : 1.2 })),
    ...mine.map((id) => ({ name: `yours (${INDUSTRIES[id].name.toLowerCase()})`, colour: IND_COLOUR[id], dash: true, values: pts.map((p) => ix(id, p.yours[id])), shown: pts.map((p) => p.yours[id]) })),
  ], $("mkPriceL"), money, index);
  chart($("mkWage") as HTMLCanvasElement, years, [{ name: "Wages", colour: "#7cc87c", values: pts.map((p) => p.wage) }], $("mkWageL"));
  chart($("mkRaw") as HTMLCanvasElement, years, [
    { name: "At the mine", colour: "#c8a040", values: pts.map((p) => p.raw) },
    { name: "Delivered to you (year avg.)", colour: "#e07a64", dash: true, values: yearly(pts.map((p) => p.delivered)), shown: pts.map((p) => p.delivered) },
  ], $("mkRawL"));
  chart($("mkCo") as HTMLCanvasElement, years, [
    { name: "Revenue", colour: "#7ac8e0", values: yearly(pts.map((p) => p.revenue)), shown: pts.map((p) => p.revenue) },
    { name: "Costs", colour: "#e07a64", values: yearly(pts.map((p) => p.costs)), shown: pts.map((p) => p.costs) },
    { name: "Profit", colour: "#7cc87c", values: yearly(pts.map((p) => p.profit)), shown: pts.map((p) => p.profit), width: 2.2 },
  ], $("mkCoL"));
}
