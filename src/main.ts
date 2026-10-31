import { advanceTurn, buildIncline, buildSteps, cal, commuteWeight, foundCompany, fundLibrary, INCLINE_COST, LIBRARY_COST, newGame, STEPS_COST, totalPopulation, walkMinutes, type GameState } from "./core/game";
import { INDUSTRIES, INDUSTRY_IDS, type IndustryId } from "./core/industries";
import { loadMap, tileLatLon, type GameMap } from "./core/map";
import { evaluateSite, footprintTiles } from "./core/site";
import { TERRAIN_NAMES } from "./core/terrain";
import { STRUCTURES, SUB_NAMES, USE_NAMES } from "./core/town";
import { type Camera, pickTile, project, ZOOMS } from "./render/iso";
import { Renderer } from "./render/renderer";
import { makeOverlay, overlayLegend, OVERLAYS, type OverlayCache, type OverlayId } from "./ui/overlays";

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
const cam: Camera = { x: 0, y: 0, zoom: 0.5 };
let overlay: OverlayId = "none";
const overlayCache: OverlayCache = {};
let hover: { x: number; y: number } | null = null;
let selected: { x: number; y: number } | null = null;
let industry: IndustryId = "steel";
let placing = false;

async function start() {
  $("zoom").textContent = "Loading map…";
  const params = new URLSearchParams(location.search);
  const seed = Number(params.get("seed") ?? Math.floor(Math.random() * 1e6));
  map = await loadMap("maps/mon-valley.json");
  renderer = new Renderer(map);
  setupUI();
  resize();
  newTown(seed);
  const p = map.landmarks.find((l) => l.name.startsWith("The Point"))!;
  centerOn(p.x + 25, p.y + 15, 0.5);
}

function newTown(seed: number) {
  game = newGame(map, seed);
  ($<HTMLInputElement>("seed")).value = String(seed);
  overlayCache.site = undefined;
  renderer.updateHeights();
  renderer.invalidateAll();
  selected = null;
  refreshPanels();
  drawMinimapBase();
  requestRender();
}

// ---------------------------------------------------------------- camera
function centerOn(tx: number, ty: number, zoom = cam.zoom) {
  const [sx, sy] = project(tx, ty, map.elevation[ty * map.width + tx]);
  cam.zoom = zoom;
  cam.x = sx - canvas.width / 2 / zoom;
  cam.y = sy - canvas.height / 2 / zoom;
  clampCam();
  requestRender();
}

function clampCam() {
  const b = renderer.worldBounds();
  const vw = canvas.width / cam.zoom, vh = canvas.height / cam.zoom;
  cam.x = Math.min(Math.max(cam.x, b.left - vw / 2), b.right - vw / 2);
  cam.y = Math.min(Math.max(cam.y, b.top - vh / 2), b.bottom - vh / 2);
}

function setZoom(px: number, py: number, ni: number) {
  ni = Math.max(0, Math.min(ZOOMS.length - 1, ni));
  if (ZOOMS[ni] === cam.zoom) return;
  const wx = cam.x + px / cam.zoom, wy = cam.y + py / cam.zoom;
  cam.zoom = ZOOMS[ni];
  cam.x = wx - px / cam.zoom;
  cam.y = wy - py / cam.zoom;
  clampCam();
  $("zoom").textContent = `${cam.zoom}×`;
  requestRender();
}
const zoomIndex = () => { const i = ZOOMS.indexOf(cam.zoom); return i < 0 ? 4 : i; };

function resize() {
  const r = canvas.getBoundingClientRect();
  canvas.width = Math.max(1, Math.floor(r.width));
  canvas.height = Math.max(1, Math.floor(r.height));
  if (renderer) { clampCam(); requestRender(); }
}

// ---------------------------------------------------------------- render
let pending = false;
const t0 = performance.now();
let lastFrame = 0;
function nightLevel(t: number): number {
  const mode = ($<HTMLSelectElement>("tod")).value;
  if (mode === "day") return 0;
  if (mode === "night") return 1;
  const ph = (t / 120) % 1; // two-minute day
  return Math.max(0, Math.min(1, -Math.cos(ph * Math.PI * 2) * 1.4 + 0.2));
}
function animating() { return ($<HTMLInputElement>("animate")).checked || ($<HTMLSelectElement>("tod")).value === "cycle"; }
function requestRender() {
  if (pending || !game) return;
  pending = true;
  requestAnimationFrame((now) => {
    pending = false;
    if (animating() && now - lastFrame < 40) { requestRender(); return; } // ~25 fps
    lastFrame = now;
    const fpSize = footprintTiles(map, industry);
    const fp = placing && hover
      ? { x: hover.x, y: hover.y, size: fpSize, ok: !game.company && evaluateSite(map, game.world, game.fields, industry, hover.x, hover.y).ok }
      : null;
    const ov = makeOverlay(overlay, game, overlayCache);
    const more = renderer.draw(ctx, cam, game, { overlay: ov.fn, overlayKey: ov.key, grid: $<HTMLInputElement>("grid").checked },
      { hover, selected, footprint: fp, labels: $<HTMLInputElement>("labels").checked });
    const t = (now - t0) / 1000;
    const night = nightLevel(t);
    if (game.world.inclines.length && cam.zoom >= 0.25) renderer.drawInclines(ctx, cam, game, ($<HTMLInputElement>("animate")).checked ? t : 0);
    if (($<HTMLInputElement>("animate")).checked || night > 0) renderer.drawAnimated(ctx, cam, game, ($<HTMLInputElement>("animate")).checked ? t : 0, night);
    drawMinimapView();
    $("zoom").textContent = `${cam.zoom}×${more ? " · drawing…" : ""}`;
    if (more || animating()) requestRender();
  });
}

// ---------------------------------------------------------------- minimap
let miniBase: ImageData;
function drawMinimapBase() {
  const W = map.width, H = map.height;
  mini.width = W; mini.height = H;
  const img = mctx.createImageData(W, H);
  const lo = map.minHeight, hi = map.maxHeight;
  const useCol: Record<number, [number, number, number]> = {
    1: [52, 92, 44], 2: [160, 150, 80], 3: [170, 150, 120], 4: [190, 150, 110], 5: [170, 80, 60], 6: [230, 220, 200],
    7: [230, 160, 60], 8: [200, 200, 200], 9: [150, 150, 150], 10: [220, 220, 255], 11: [140, 120, 100],
  };
  for (let i = 0; i < W * H; i++) {
    let c: [number, number, number];
    if (map.terrain[i] === 0) c = [43, 93, 155];
    else if (game.world.street[i]) c = [120, 100, 70];
    else if (useCol[game.world.use[i]]) c = useCol[game.world.use[i]];
    else { const t = (map.elevation[i] - lo) / (hi - lo); c = [90 + t * 80, 130 + t * 50, 60 + t * 40]; }
    img.data[i * 4] = c[0]; img.data[i * 4 + 1] = c[1]; img.data[i * 4 + 2] = c[2]; img.data[i * 4 + 3] = 255;
  }
  miniBase = img;
}

function drawMinimapView() {
  if (!miniBase) return;
  mctx.putImageData(miniBase, 0, 0);
  const pts = [[0, 0], [canvas.width, 0], [canvas.width, canvas.height], [0, canvas.height]].map(([px, py]) => {
    // invert the projection on a plane at a typical ground height (~260 m)
    const wx = cam.x + px / cam.zoom, wy = cam.y + py / cam.zoom;
    const a = wx / 32, b = (wy + (260 - 200) * 1.15) / 16;
    return [(a + b) / 2, (b - a) / 2];
  });
  mctx.strokeStyle = "#fff";
  mctx.lineWidth = 2;
  mctx.beginPath();
  pts.forEach((p, k) => (k ? mctx.lineTo(p[0], p[1]) : mctx.moveTo(p[0], p[1])));
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
  const rail = map.rail[i] ? map.railLines[String(map.rail[i])] : null;
  const bridge = map.bridge[i] ? map.bridges[String(map.bridge[i])] : null;
  let near = map.landmarks[0], nd = Infinity;
  for (const l of map.landmarks) { const d = Math.hypot(l.x - x, l.y - y); if (d < nd) { nd = d; near = l; } }
  const owner = w.owner[i] === 0 ? "—" : w.owner[i] === 1 ? game.company?.name ?? "You" : game.rivals.find((r) => r.ownerId === w.owner[i])?.id ?? "Rival";
  const struct = w.structure[i] > 0 && w.structure[i] < 255 ? STRUCTURES[w.structure[i]] : "";
  el.innerHTML = [
    row("Tile", `${x}, ${y}`),
    row("Lat / Lon", `${ll.lat.toFixed(4)}, ${ll.lon.toFixed(4)}`),
    row("Elevation", `${map.elevation[i].toFixed(0)} m (${fmt(map.elevation[i] * 3.281)} ft)`),
    row("Terrain", TERRAIN_NAMES[map.terrain[i]]),
    row("Slope", `${map.slope[i]}°`),
    water ? row("Water", water) : "",
    creek ? row("Creek", creek) : "",
    rail ? row("Rail", `${rail.name} (${rail.year})`, rail.year > w.year ? "bad" : "") : "",
    bridge ? row("Bridge", `${bridge.name} (${bridge.year})`, bridge.year > w.year ? "bad" : "") : "",
    w.street[i] ? row("Street", ["", "Lane", "Pike", "Bridge", "Public steps"][w.street[i]]) : "",
    game.company && game.access ? row("Walk to works", isFinite(walkMinutes(game, i)) ? `${walkMinutes(game, i).toFixed(0)} min (${Math.round(commuteWeight(walkMinutes(game, i)) * 100)}% take the job)` : "over an hour") : "",
    row("Coal", ["None", "Seam underground", "Seam outcrop"][map.coal[i]]),
    row("Land use", struct ? struct[0].toUpperCase() + struct.slice(1) : SUB_NAMES[w.use[i]]?.[w.sub[i]] ?? USE_NAMES[w.use[i]]),
    w.built[i] ? row("Built", String(w.built[i])) : "",
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
    row("Footprint", `${rep.footprint}×${rep.footprint} tiles (${rep.footprint * map.metersPerTile} m)`),
    row("Score", `${rep.score} / 100`, rep.ok ? "good" : "bad"),
    row("Cost", money(rep.cost), rep.cost > 100000 ? "bad" : ""),
    row("Labor nearby", fmt(rep.labor)),
    row("River", rep.riverM > 60000 ? "—" : `${fmt(rep.riverM)} m`),
    row("Coal outcrop", rep.coalM > 60000 ? "—" : `${fmt(rep.coalM)} m`),
    row("Relief", `${rep.reliefM.toFixed(1)} m`),
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
    row("Status", c.status === "running" ? "Running" : c.status === "strike" ? "On strike" : c.status === "flooded" ? "Flooded" : "Idle", c.status === "running" ? "good" : "bad"),
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
  const lib = $<HTMLButtonElement>("library");
  lib.disabled = c.library || cal(game).year < 1880 || c.cash < LIBRARY_COST;
  lib.textContent = c.library ? "Library funded" : `Fund a library ($${fmt(LIBRARY_COST)})`;
  ($<HTMLButtonElement>("steps")).disabled = c.cash < STEPS_COST;
  const inc = $<HTMLButtonElement>("incline");
  inc.disabled = c.cash < INCLINE_COST || cal(game).year < 1870;
  inc.title = cal(game).year < 1870 ? "Inclines arrive in 1870" : "Build an incline from a street near the works up to the hilltop houses";
}

// ---------------------------------------------------------------- UI wiring
function setupUI() {
  $("overlays").innerHTML = OVERLAYS.map((o) =>
    `<label><input type="radio" name="overlay" value="${o.id}" ${o.id === overlay ? "checked" : ""}/> ${o.label}</label>`).join("");
  $("overlays").addEventListener("change", (e) => {
    overlay = (e.target as HTMLInputElement).value as OverlayId;
    $("legend").textContent = overlayLegend(overlay);
    if (overlay.startsWith("site:")) { industry = overlay.slice(5) as IndustryId; ($<HTMLSelectElement>("industry")).value = industry; industryNote(); }
    inspect();
    requestRender();
  });
  const sel = $<HTMLSelectElement>("industry");
  sel.innerHTML = INDUSTRY_IDS.map((k) => `<option value="${k}">${INDUSTRIES[k].name}</option>`).join("");
  sel.addEventListener("change", () => { industry = sel.value as IndustryId; industryNote(); inspect(); requestRender(); });
  industryNote();
  $<HTMLInputElement>("placing").addEventListener("change", (e) => { placing = (e.target as HTMLInputElement).checked; requestRender(); });
  for (const id of ["labels", "grid", "animate", "tod"]) $(id).addEventListener("change", () => requestRender());
  for (const [id, fn] of [["steps", buildSteps], ["incline", buildIncline]] as const) $(id).addEventListener("click", () => {
    const r = fn(game);
    if (!r.ok) game.log.push({ turn: game.turn, text: r.reason! });
    afterChange();
  });
  $("library").addEventListener("click", () => {
    const r = fundLibrary(game);
    if (!r.ok) game.log.push({ turn: game.turn, text: r.reason! });
    afterChange();
  });

  $("found").addEventListener("click", () => {
    if (!selected) return;
    const r = foundCompany(game, industry, selected.x, selected.y);
    if (!r.ok) game.log.push({ turn: game.turn, text: r.reason! });
    placing = false; ($<HTMLInputElement>("placing")).checked = false;
    renderer.updateHeights();
    afterChange();
  });
  $("next").addEventListener("click", nextSeason);
  $("regen").addEventListener("click", () => {
    const v = ($<HTMLInputElement>("seed")).value.trim();
    newTown(v && !isNaN(Number(v)) ? Number(v) : Math.floor(Math.random() * 1e6));
  });

  // mouse: drag to pan, click to select
  let down: { x: number; y: number; cx: number; cy: number } | null = null;
  let dragged = false;
  canvas.addEventListener("mousedown", (e) => { down = { x: e.offsetX, y: e.offsetY, cx: cam.x, cy: cam.y }; dragged = false; });
  window.addEventListener("mouseup", (e) => {
    if (down && !dragged && e.target === canvas) {
      selected = pickTile(map, cam.x + e.offsetX / cam.zoom, cam.y + e.offsetY / cam.zoom);
      inspect();
      requestRender();
    }
    down = null;
  });
  let hoverT = 0;
  canvas.addEventListener("mousemove", (e) => {
    if (down) {
      const dx = e.offsetX - down.x, dy = e.offsetY - down.y;
      if (Math.abs(dx) + Math.abs(dy) > 4) dragged = true;
      if (dragged) { cam.x = down.cx - dx / cam.zoom; cam.y = down.cy - dy / cam.zoom; clampCam(); requestRender(); return; }
    }
    const now = performance.now();
    if (now - hoverT < 30) return;
    hoverT = now;
    const t = pickTile(map, cam.x + e.offsetX / cam.zoom, cam.y + e.offsetY / cam.zoom);
    if (t?.x !== hover?.x || t?.y !== hover?.y) { hover = t; requestRender(); }
  });
  canvas.addEventListener("mouseleave", () => { hover = null; requestRender(); });

  // wheel zoom: trackpads fire many tiny events, so accumulate and step at most once per 160 ms
  let wheelAcc = 0, lastStep = 0;
  canvas.addEventListener("wheel", (e) => {
    e.preventDefault();
    const unit = e.deltaMode === 1 ? 40 : e.deltaMode === 2 ? 800 : 1;
    wheelAcc += e.deltaY * unit;
    const now = performance.now();
    if (Math.abs(wheelAcc) < 100 || now - lastStep < 160) return;
    setZoom(e.offsetX, e.offsetY, zoomIndex() + (wheelAcc < 0 ? 1 : -1));
    wheelAcc = 0;
    lastStep = now;
  }, { passive: false });

  mini.addEventListener("click", (e) => {
    const r = mini.getBoundingClientRect();
    const tx = Math.floor((e.clientX - r.left) / r.width * map.width);
    const ty = Math.floor((e.clientY - r.top) / r.height * map.height);
    centerOn(Math.max(0, Math.min(map.width - 1, tx)), Math.max(0, Math.min(map.height - 1, ty)));
  });
  $("zoomIn").addEventListener("click", () => setZoom(canvas.width / 2, canvas.height / 2, zoomIndex() + 1));
  $("zoomOut").addEventListener("click", () => setZoom(canvas.width / 2, canvas.height / 2, zoomIndex() - 1));

  window.addEventListener("keydown", (e) => {
    if ((e.target as HTMLElement).tagName === "INPUT" && (e.target as HTMLInputElement).type === "text") return;
    const step = 160 / cam.zoom;
    const k = e.key.toLowerCase();
    if (k === "arrowleft" || k === "a") cam.x -= step;
    else if (k === "arrowright" || k === "d") cam.x += step;
    else if (k === "arrowup" || k === "w") cam.y -= step;
    else if (k === "arrowdown" || k === "s") cam.y += step;
    else if (k === "+" || k === "=") return setZoom(canvas.width / 2, canvas.height / 2, zoomIndex() + 1);
    else if (k === "-" || k === "_") return setZoom(canvas.width / 2, canvas.height / 2, zoomIndex() - 1);
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
  const fp = footprintTiles(map, industry);
  $("industryNote").textContent = `Starts as: ${ind.startsAs}. From $${fmt(ind.startCost)} plus land and grading. Needs ${fp}×${fp} tiles (${fp * map.metersPerTile} m) of ground with under ${ind.site.maxReliefM} m of relief${ind.site.riverWithinM ? `, within ${ind.site.riverWithinM} m of a river` : ""}.`;
}

function nextSeason() {
  advanceTurn(game);
  afterChange();
}

function afterChange() {
  drawMinimapBase();
  refreshPanels();
  requestRender();
}

// Debug handle for iterating from the browser console: window.mt
Object.assign(window, {
  mt: {
    get game() { return game; },
    get map() { return map; },
    get renderer() { return renderer; },
    cam,
    center: (x: number, y: number, z?: number) => centerOn(x, y, z),
    select: (x: number, y: number) => { selected = { x, y }; inspect(); requestRender(); },
    overlay: (id: OverlayId) => { (document.querySelector(`input[value="${id}"]`) as HTMLInputElement)?.click(); },
    industry: (id: IndustryId) => { industry = id; ($<HTMLSelectElement>("industry")).value = id; industryNote(); inspect(); requestRender(); },
    next: (n = 1) => { for (let k = 0; k < n; k++) advanceTurn(game); afterChange(); },
    found: (x: number, y: number, id: IndustryId = industry) => { const r = foundCompany(game, id, x, y); renderer.updateHeights(); afterChange(); return r; },
    library: () => { const r = fundLibrary(game); afterChange(); return r; },
    steps: () => { const r = buildSteps(game); afterChange(); return r; },
    incline: () => { const r = buildIncline(game); afterChange(); return r; },
    tech: (ids: string[]) => { if (game.company) { game.company.techs = ids; game.world.version++; afterChange(); } },
    tod: (v: string) => { ($<HTMLSelectElement>("tod")).value = v; requestRender(); },
    get pending() { return renderer.pending; },
  },
});

start().catch((e) => {
  document.body.innerHTML = `<pre style="color:#e06a5a;padding:20px">${String(e?.stack ?? e)}</pre>`;
});
