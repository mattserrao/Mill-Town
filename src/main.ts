import { advanceTurn, cal, foundCompany, newGame, totalPopulation, type GameState } from "./core/game";
import { INDUSTRIES, INDUSTRY_IDS, type IndustryId } from "./core/industries";
import { loadMap, tileLatLon, type GameMap } from "./core/map";
import { evaluateSite } from "./core/site";
import { TERRAIN_NAMES } from "./core/terrain";
import { USE_NAMES } from "./core/town";
import { type Camera, pickTile, tileToWorld, ZOOMS } from "./render/iso";
import { Renderer } from "./render/renderer";
import { buildSprites } from "./render/sprites";
import { makeOverlay, overlayLegend, OVERLAYS, type OverlayId, type SiteCache } from "./ui/overlays";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const fmt = (n: number) => Math.round(n).toLocaleString("en-US");
const money = (n: number) => (n < 0 ? "-$" : "$") + fmt(Math.abs(n));

const canvas = $<HTMLCanvasElement>("view");
const ctx = canvas.getContext("2d")!;
const mini = $<HTMLCanvasElement>("minimap");
const mctx = mini.getContext("2d")!;

let map: GameMap;
let game: GameState;
let renderer: Renderer;
const cam: Camera = { x: 0, y: 0, zoom: 1 };
let overlay: OverlayId = "none";
const overlayCache: { site?: SiteCache } = {};
let hover: { x: number; y: number } | null = null;
let selected: { x: number; y: number } | null = null;
let industry: IndustryId = "steel";
let placing = false;

async function start() {
  const params = new URLSearchParams(location.search);
  const seed = Number(params.get("seed") ?? Math.floor(Math.random() * 1e6));
  map = await loadMap("maps/mon-valley.json");
  renderer = new Renderer(buildSprites(), map);
  setupUI();
  newTown(seed);
  // open on the Point
  const p = map.landmarks.find((l) => l.name.startsWith("The Point"))!;
  centerOn(p.x + 30, p.y + 20, 1);
  resize();
}

function newTown(seed: number) {
  game = newGame(map, seed);
  ($<HTMLInputElement>("seed")).value = String(seed);
  overlayCache.site = undefined;
  renderer.invalidate();
  selected = null;
  refreshPanels();
  drawMinimapBase();
  requestRender();
}

// ---------------------------------------------------------------- camera
function centerOn(tx: number, ty: number, zoom = cam.zoom) {
  const { sx, sy } = tileToWorld(tx, ty, map.level[ty * map.width + tx]);
  cam.zoom = zoom;
  cam.x = sx - canvas.width / 2 / zoom;
  cam.y = sy - canvas.height / 2 / zoom;
  clampCam();
}

function clampCam() {
  const b = renderer.worldBounds();
  const vw = canvas.width / cam.zoom, vh = canvas.height / cam.zoom;
  cam.x = Math.min(Math.max(cam.x, b.left - vw / 2), b.right - vw / 2);
  cam.y = Math.min(Math.max(cam.y, b.top - vh / 2), b.bottom - vh / 2);
}

function zoomAt(px: number, py: number, dir: number) {
  const i = ZOOMS.indexOf(cam.zoom);
  const ni = Math.max(0, Math.min(ZOOMS.length - 1, i + dir));
  if (ni === i) return;
  const wx = cam.x + px / cam.zoom, wy = cam.y + py / cam.zoom;
  cam.zoom = ZOOMS[ni];
  cam.x = wx - px / cam.zoom;
  cam.y = wy - py / cam.zoom;
  clampCam();
  requestRender();
}

function resize() {
  const r = canvas.getBoundingClientRect();
  canvas.width = Math.max(1, Math.floor(r.width));
  canvas.height = Math.max(1, Math.floor(r.height));
  clampCam();
  requestRender();
}

// ---------------------------------------------------------------- render
let pending = false;
function requestRender() {
  if (pending) return;
  pending = true;
  requestAnimationFrame(() => {
    pending = false;
    const fp = placing && hover
      ? { x: hover.x, y: hover.y, size: INDUSTRIES[industry].site.footprint,
          ok: !game.company && evaluateSite(map, game.world, game.fields, industry, hover.x, hover.y).ok }
      : null;
    renderer.draw(ctx, cam, game, {
      overlay: makeOverlay(overlay, game, overlayCache),
      labels: $<HTMLInputElement>("labels").checked,
      grid: $<HTMLInputElement>("grid").checked,
      hover, selected, footprint: fp,
    });
    drawMinimapView();
    $("zoom").textContent = `${cam.zoom}×`;
  });
}

// ---------------------------------------------------------------- minimap
let miniBase: ImageData;
function drawMinimapBase() {
  const W = map.width, H = map.height;
  mini.width = W; mini.height = H;
  const img = mctx.createImageData(W, H);
  let lo = Infinity, hi = -Infinity;
  for (const e of map.elevation) { lo = Math.min(lo, e); hi = Math.max(hi, e); }
  const useCol: Record<number, [number, number, number]> = {
    1: [52, 92, 44], 2: [150, 150, 80], 3: [170, 150, 120], 4: [180, 140, 110], 5: [160, 80, 60], 6: [230, 220, 200], 7: [230, 160, 60], 8: [200, 200, 200],
  };
  for (let i = 0; i < W * H; i++) {
    let c: [number, number, number];
    if (map.terrain[i] === 0) c = [43, 93, 155];
    else if (game.world.road[i]) c = [120, 100, 70];
    else if (useCol[game.world.use[i]]) c = useCol[game.world.use[i]];
    else { const t = (map.elevation[i] - lo) / (hi - lo); c = [90 + t * 80, 130 + t * 50, 60 + t * 40]; }
    img.data.set([c[0], c[1], c[2], 255], i * 4);
  }
  miniBase = img;
}

function drawMinimapView() {
  if (!miniBase) return;
  mctx.putImageData(miniBase, 0, 0);
  const pts = renderer.viewGround(cam, canvas.width, canvas.height);
  mctx.strokeStyle = "#fff";
  mctx.lineWidth = 1;
  mctx.beginPath();
  pts.forEach((p, k) => (k ? mctx.lineTo(p.x, p.y) : mctx.moveTo(p.x, p.y)));
  mctx.closePath();
  mctx.stroke();
}

// ---------------------------------------------------------------- panels
function row(k: string, v: string, cls = "") {
  return `<div class="k">${k}</div><div class="v ${cls}">${v}</div>`;
}

function refreshPanels() {
  const c = cal(game);
  $("calendar").innerHTML = `<b>${c.season} ${c.year}</b> · Era ${c.era.id}: ${c.era.name}`;
  $("population").innerHTML = `Population <b>${fmt(totalPopulation(game))}</b>`;
  $("cash").innerHTML = game.company ? `Cash <b>${money(game.company.cash)}</b>` : `Capital <b>$100,000</b>`;
  inspect();
  companyPanel();
  $("log").innerHTML = game.log.slice(-40).reverse().map((l) => {
    const lc = cal({ ...game, turn: l.turn });
    return `<li>${lc.season.slice(0, 3)} ${lc.year} — <b>${l.text}</b></li>`;
  }).join("");
}

function inspect() {
  const el = $("inspector");
  const site = $("siteSection");
  if (!selected) { el.innerHTML = `<p class="hint">Click a tile.</p>`; site.hidden = true; return; }
  const { x, y } = selected;
  const i = y * map.width + x;
  const w = game.world;
  const ll = tileLatLon(map, x, y);
  const water = map.water[i] ? map.waterNames[String(map.water[i])] : "";
  const creek = map.creek[i] ? map.creekNames[String(map.creek[i])] : "";
  let near = map.landmarks[0], nd = Infinity;
  for (const l of map.landmarks) { const d = Math.hypot(l.x - x, l.y - y); if (d < nd) { nd = d; near = l; } }
  const owner = w.owner[i] === 0 ? "—" : w.owner[i] === 1 ? game.company?.name ?? "You" : game.rivals.find((r) => r.ownerId === w.owner[i])?.id ?? "Rival";
  el.innerHTML = [
    row("Tile", `${x}, ${y}`),
    row("Lat / Lon", `${ll.lat.toFixed(4)}, ${ll.lon.toFixed(4)}`),
    row("Elevation", `${map.elevation[i]} m (${fmt(map.elevation[i] * 3.281)} ft)`),
    row("Height level", String(map.level[i])),
    row("Terrain", TERRAIN_NAMES[map.terrain[i]]),
    row("Slope", `${map.slope[i]}°`),
    water ? row("Water", water) : "",
    creek ? row("Creek", creek) : "",
    row("Coal", ["None", "Seam underground", "Seam outcrop"][map.coal[i]]),
    row("Land use", USE_NAMES[w.use[i]]),
    row("Residents", fmt(w.pop[i])),
    row("Land value", money(w.landValue[i])),
    row("Pollution", w.pollution[i].toFixed(3)),
    row("Owner", owner),
    row("Nearest place", `${near.name} (${(nd * map.metersPerTile / 1000).toFixed(1)} km)`),
  ].join("");

  site.hidden = false;
  const rep = evaluateSite(map, game.world, game.fields, industry, x, y);
  $("site").innerHTML = [
    row("Industry", INDUSTRIES[industry].name),
    row("Footprint", `${INDUSTRIES[industry].site.footprint}×${INDUSTRIES[industry].site.footprint} from this corner`),
    row("Score", `${rep.score} / 100`, rep.ok ? "good" : "bad"),
    row("Cost", money(rep.cost), rep.cost > 100000 ? "bad" : ""),
    row("Labor nearby", fmt(rep.labor)),
    row("River", rep.riverDist === 0xffff ? "—" : `${rep.riverDist} tiles`),
    row("Coal outcrop", rep.coalDist === 0xffff ? "—" : `${rep.coalDist} tiles`),
    `<div class="full hint">${rep.reasons.join(" · ")}</div>`,
  ].join("");
  ($<HTMLButtonElement>("found")).disabled = !!game.company || !rep.ok || rep.cost > 100000;
}

function companyPanel() {
  const c = game.company;
  $("companySection").hidden = !c;
  if (!c) return;
  const ind = INDUSTRIES[c.industry];
  const s = c.lastSeason;
  $("company").innerHTML = [
    row("Name", c.name),
    row("Business", ind.startsAs),
    row("Cash", money(c.cash), c.cash < 0 ? "bad" : ""),
    row("Employees", fmt(c.employees)),
    row("Lifetime output", fmt(c.produced)),
    row("Tech", c.techs.map((t) => ind.tech.find((x) => x.id === t)?.name).join(", ")),
    ...(s ? [
      `<div class="full hint">Last season</div>`,
      row("Produced", fmt(s.produced)),
      row("Revenue", money(s.revenue)),
      row("Inputs", money(-s.inputCost)),
      row("Wages", money(-s.wages)),
      row("Profit", money(s.profit), s.profit < 0 ? "bad" : "good"),
      row("Workers", `${fmt(s.workersHired)} / ${fmt(s.workersWanted)}`),
      s.notes.length ? `<div class="full hint">${s.notes.join(" ")}</div>` : "",
    ] : []),
  ].join("");
}

// ---------------------------------------------------------------- UI wiring
function setupUI() {
  $("overlays").innerHTML = OVERLAYS.map((o) =>
    `<label><input type="radio" name="overlay" value="${o.id}" ${o.id === overlay ? "checked" : ""}/> ${o.label}</label>`).join("");
  $("overlays").addEventListener("change", (e) => {
    overlay = (e.target as HTMLInputElement).value as OverlayId;
    $("legend").textContent = overlayLegend(overlay);
    if (overlay.startsWith("site:")) { industry = overlay.slice(5) as IndustryId; ($<HTMLSelectElement>("industry")).value = industry; industryNote(); }
    renderer.invalidate();
    inspect();
    requestRender();
  });
  const sel = $<HTMLSelectElement>("industry");
  sel.innerHTML = INDUSTRY_IDS.map((k) => `<option value="${k}">${INDUSTRIES[k].name}</option>`).join("");
  sel.addEventListener("change", () => { industry = sel.value as IndustryId; industryNote(); inspect(); requestRender(); });
  industryNote();
  $<HTMLInputElement>("placing").addEventListener("change", (e) => { placing = (e.target as HTMLInputElement).checked; requestRender(); });
  for (const id of ["labels", "grid"]) $(id).addEventListener("change", () => { renderer.invalidate(); requestRender(); });

  $("found").addEventListener("click", () => {
    if (!selected) return;
    const r = foundCompany(game, industry, selected.x, selected.y);
    if (!r.ok) alertLog(r.reason!);
    placing = false; ($<HTMLInputElement>("placing")).checked = false;
    afterChange();
  });
  $("next").addEventListener("click", nextSeason);
  $("regen").addEventListener("click", () => {
    const v = ($<HTMLInputElement>("seed")).value.trim();
    newTown(v && !isNaN(Number(v)) ? Number(v) : Math.floor(Math.random() * 1e6));
  });

  // mouse
  let down: { x: number; y: number; cx: number; cy: number } | null = null;
  let dragged = false;
  canvas.addEventListener("mousedown", (e) => { down = { x: e.offsetX, y: e.offsetY, cx: cam.x, cy: cam.y }; dragged = false; });
  window.addEventListener("mouseup", (e) => {
    if (down && !dragged && e.target === canvas) {
      const t = pickTile(map, cam.x + e.offsetX / cam.zoom, cam.y + e.offsetY / cam.zoom);
      selected = t;
      inspect();
      requestRender();
    }
    down = null;
  });
  canvas.addEventListener("mousemove", (e) => {
    if (down) {
      const dx = e.offsetX - down.x, dy = e.offsetY - down.y;
      if (Math.abs(dx) + Math.abs(dy) > 4) dragged = true;
      if (dragged) { cam.x = down.cx - dx / cam.zoom; cam.y = down.cy - dy / cam.zoom; clampCam(); }
    }
    const t = pickTile(map, cam.x + e.offsetX / cam.zoom, cam.y + e.offsetY / cam.zoom);
    if (t?.x !== hover?.x || t?.y !== hover?.y || dragged) { hover = t; requestRender(); }
  });
  canvas.addEventListener("mouseleave", () => { hover = null; requestRender(); });
  canvas.addEventListener("wheel", (e) => { e.preventDefault(); zoomAt(e.offsetX, e.offsetY, e.deltaY < 0 ? 1 : -1); }, { passive: false });

  mini.addEventListener("click", (e) => {
    const r = mini.getBoundingClientRect();
    const tx = Math.floor((e.clientX - r.left) / r.width * map.width);
    const ty = Math.floor((e.clientY - r.top) / r.height * map.height);
    centerOn(Math.max(0, Math.min(map.width - 1, tx)), Math.max(0, Math.min(map.height - 1, ty)));
    requestRender();
  });

  window.addEventListener("keydown", (e) => {
    if ((e.target as HTMLElement).tagName === "INPUT" && (e.target as HTMLInputElement).type === "text") return;
    const step = 120 / cam.zoom;
    const k = e.key.toLowerCase();
    if (k === "arrowleft" || k === "a") cam.x -= step;
    else if (k === "arrowright" || k === "d") cam.x += step;
    else if (k === "arrowup" || k === "w") cam.y -= step;
    else if (k === "arrowdown" || k === "s") cam.y += step;
    else if (k === "+" || k === "=") zoomAt(canvas.width / 2, canvas.height / 2, 1);
    else if (k === "-" || k === "_") zoomAt(canvas.width / 2, canvas.height / 2, -1);
    else if (k === " ") { e.preventDefault(); nextSeason(); return; }
    else if (k === "escape") { placing = false; ($<HTMLInputElement>("placing")).checked = false; }
    else return;
    clampCam();
    requestRender();
  });
  window.addEventListener("resize", resize);
}

function industryNote() {
  const ind = INDUSTRIES[industry];
  $("industryNote").textContent = `Starts as: ${ind.startsAs}. Founding from $${fmt(ind.startCost)} plus land. Needs ${ind.site.footprint}×${ind.site.footprint} level ground${ind.site.riverWithin ? `, river within ${ind.site.riverWithin} tiles` : ""}.`;
}

function alertLog(text: string) {
  game.log.push({ turn: game.turn, text });
}

function nextSeason() {
  advanceTurn(game);
  afterChange();
}

function afterChange() {
  renderer.invalidate();
  drawMinimapBase();
  refreshPanels();
  requestRender();
}

// Debug handle for iterating from the browser console: window.mt
Object.assign(window, {
  mt: {
    get game() { return game; },
    get map() { return map; },
    cam,
    center: (x: number, y: number, z?: number) => { centerOn(x, y, z); requestRender(); },
    select: (x: number, y: number) => { selected = { x, y }; inspect(); requestRender(); },
    overlay: (id: OverlayId) => { (document.querySelector(`input[value="${id}"]`) as HTMLInputElement)?.click(); },
    industry: (id: IndustryId) => { industry = id; ($<HTMLSelectElement>("industry")).value = id; industryNote(); inspect(); requestRender(); },
    next: (n = 1) => { for (let k = 0; k < n; k++) advanceTurn(game); afterChange(); },
  },
});

start().catch((e) => {
  document.body.innerHTML = `<pre style="color:#e06a5a;padding:20px">${String(e?.stack ?? e)}</pre>`;
});
