import { distance, feet } from "./core/units";
import { advanceTurn, allWorks, buildIncline, buildSpur, buildSteps, cal, spurQuote, commuteWeight, foundCompany, fundLibrary, INCLINE_COST, LIBRARY_COST, newGame, STEPS_COST, totalPopulation, walkMinutes, type GameState } from "./core/game";
import { INDUSTRIES, INDUSTRY_IDS, type IndustryId } from "./core/industries";
import { loadMap, tileLatLon, type GameMap } from "./core/map";
import { evaluateSite, footprintTiles, popSAT } from "./core/site";
import { TERRAIN_NAMES } from "./core/terrain";
import { STRUCTURES, SUB_NAMES, Use, USE_NAMES } from "./core/town";
import { ANCHORS, anchorAt, GROUPS } from "./core/ancestry";
import { type Camera, pickTile, project, ZOOMS } from "./render/iso";
import { Renderer } from "./render/renderer";
import { Traffic } from "./render/traffic";
import { drawHaze, drawSpills } from "./render/pollution";
import { SoundController, summarizeView } from "./audio";
import { HILLSIDES, latLonToTile } from "./core/features";
import { queryCard } from "./ui/query";
import { businessPanel, decisionCard, resetBusinessUi } from "./ui/business";
import { resetWorksUi, worksPanel, worksStatus } from "./ui/works";
import { marketsView } from "./ui/markets";
import { techStanding } from "./core/market";
import { districtPanel, zoneAt } from "./ui/district";
import { drawDistricts } from "./render/districts";
import { teamGround, teamName } from "./core/sports";
import { nameNow } from "./core/rivals";
import { type LandmarkKind, placeLandmark } from "./core/landmarks";
import { allDecisions, allEffects } from "./core/eventdata";
import { applyEffects } from "./core/effects";
import { buildProject, checkProject, PROJECTS, type ProjectKind, type Proposal, suggestProject } from "./core/projects";
import { isVectorOverlay, makeOverlay, overlayLegend, OVERLAYS, type OverlayCache, type OverlayId } from "./ui/overlays";
import { capacityOf, competitors, type Flow, playerWorks, supplyChain, type WorksRef } from "./core/economy";
import { drawRivals, drawSupply, FLOW_COLOUR, RELATION_COLOUR } from "./render/flows";
import { esc, fmt } from "./core/text";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const money = (n: number) => (n < 0 ? "-$" : "$") + fmt(Math.abs(n));

const canvas = $<HTMLCanvasElement>("view");
const ctx = canvas.getContext("2d")!;
const mini = $<HTMLCanvasElement>("minimap");
const mctx = mini.getContext("2d")!;

let map: GameMap;
let game: GameState;
let renderer: Renderer;
let traffic: Traffic;
const sound = new SoundController();
let lastNight = 0;
const cam: Camera = { x: 0, y: 0, zoom: 0.5 };
let overlay: OverlayId = "none";
const overlayCache: OverlayCache = {};
let hover: { x: number; y: number } | null = null;
let selected: { x: number; y: number } | null = null;
let industry: IndustryId = "steel";
let placing = true;
let playTimer = 0;
let seedEdited = false;
let newsAt = 0;
let querying = false;
let soundWanted = (() => { try { return localStorage.getItem("mt.sound") !== "off"; } catch { return true; } })();
let siteTried: { x: number; y: number }[] = [];
/** flow or rival hovered in the side panel: drawn on top, the rest faded */
let focusId: string | null = null;
/** a building project waiting for the player to confirm (or move) it */
let proposal: Proposal | null = null;

function announceVersion() {
  const v = window.__MT_VERSION__;
  const label = v ? v.label : "dev";
  console.log(`%cMILL TOWN%c ${label}${v?.date ? ` · committed ${v.date}` : ""}`, "color:#e0a243;font-weight:bold;letter-spacing:2px", "color:inherit");
  $("version").textContent = v ? `v${v.version}·${v.sha}${v.dirty ? "*" : ""}` : "";
  $("version").title = v ? `${v.label}, committed ${v.date}` : "";
}

async function start() {
  announceVersion();
  $("zoom").textContent = "Loading map…";
  const params = new URLSearchParams(location.search);
  const asked = Number(params.get("seed"));
  const seed = params.get("seed") && Number.isFinite(asked) ? Math.floor(asked) : Math.floor(Math.random() * 1e6);
  map = await loadMap("maps/mon-valley.json");
  renderer = new Renderer(map);
  traffic = new Traffic(map);
  setupUI();
  resize();
  newTown(seed);
  showNews();
  const p = map.landmarks.find((l) => l.name.startsWith("The Point"))!;
  centerOn(p.x + 25, p.y + 15, 0.5);
}

function newTown(seed: number) {
  stopPlay();
  // nothing from the last town carries over: placing, open views, panel state, cached flows and traffic
  if (game) {
    proposal = null; placeBar();
    if (querying) setQuerying(false);
    $("query").hidden = true;
    toggleMarkets(false);
    resetBusinessUi(); resetWorksUi();
  }
  focusId = null; chainCache = null; hoverSite = null; nameEdited = false;
  traffic.reset();
  game = newGame(map, seed);
  paperIdx = -1; paperSeen = 0;
  ($<HTMLInputElement>("seed")).value = String(seed);
  seedEdited = false;
  ($<HTMLInputElement>("companyName")).value = suggestName(industry, seed);
  setTab("company");
  siteTried = [];
  placing = true; ($<HTMLInputElement>("placing")).checked = true;
  $("final").hidden = true;
  overlayCache.site = undefined;
  renderer.updateHeights();
  renderer.invalidateAll();
  selected = null;
  refreshPanels();
  drawMinimapBase();
  requestRender();
}

/**
 * Keys typed into a form control are its own, not the game's shortcuts: everything in a text box, letters and
 * arrows in a dropdown, checkbox or slider (Space and Esc still reach the game from those).
 */
function inFormControl(e: KeyboardEvent): boolean {
  const t = e.target as HTMLElement | null;
  if (!t) return false;
  if (t.tagName === "TEXTAREA" || t.isContentEditable) return true;
  if (t.tagName === "INPUT" && ["text", "number", "search"].includes((t as HTMLInputElement).type)) return true;
  if (t.tagName === "SELECT" || t.tagName === "INPUT") {
    if (e.key === " " || e.key === "Escape") { e.preventDefault(); return false; }
    return true;
  }
  return false;
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

/** screen position (canvas px) of a tile's centre */
function tileScreen(x: number, y: number): [number, number] {
  const [wx, wy] = project(x + 0.5, y + 0.5, map.elevation[y * map.width + x]);
  return [(wx - cam.x) * cam.zoom, (wy - cam.y) * cam.zoom];
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
/** is the tile under the cursor a valid site? (evaluated once per tile and town state, not every frame) */
let hoverSite: { key: string; ok: boolean } | null = null;
function hoverSiteOk(x: number, y: number): boolean {
  const key = `${game.seed}:${game.world.version}:${industry}:${x},${y}`;
  if (hoverSite?.key !== key) hoverSite = { key, ok: evaluateSite(map, game.world, game.fields, industry, x, y).ok };
  return hoverSite.ok;
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
    const fp = proposal
      ? { x: proposal.x, y: proposal.y, size: proposal.size, ok: proposal.ok }
      : placing && hover
      ? { x: hover.x, y: hover.y, size: fpSize, ok: !game.company && hoverSiteOk(hover.x, hover.y) }
      : null;
    const ov = makeOverlay(overlay, game, overlayCache);
    const more = renderer.draw(ctx, cam, game, { overlay: ov.fn, overlayKey: ov.key, grid: $<HTMLInputElement>("grid").checked },
      { hover, selected, footprint: fp, labels: $<HTMLInputElement>("labels").checked });
    const t = (now - t0) / 1000;
    const night = nightLevel(t);
    lastNight = night;
    const anim = ($<HTMLInputElement>("animate")).checked;
    const ovOn = overlay !== "none" && !isVectorOverlay(overlay);
    if (anim && !ovOn && cam.zoom >= 0.1875) drawSpills(ctx, game, cam, t, night);
    if (anim && !ovOn) { traffic.update(game, cam, canvas.width, canvas.height, now, night); traffic.drawBoats(ctx, cam, t); }
    if (cam.zoom >= 0.1875) renderer.drawBridges(ctx, cam, game);
    if (cam.zoom >= 0.25) renderer.drawSpur(ctx, cam, game);
    if (anim && !ovOn) traffic.draw(ctx, cam, game, t, night);
    if (game.world.inclines.length && cam.zoom >= 0.25) renderer.drawInclines(ctx, cam, game, anim ? t : 0);
    if (!ovOn) drawHaze(ctx, game, cam, canvas.width, canvas.height, anim ? t : 0);
    if (anim || night > 0) renderer.drawAnimated(ctx, cam, game, anim ? t : 0, night);
    if (anim && !ovOn && night > 0.02) traffic.drawLights(ctx, cam, night); // lamps over the night tint, at full strength
    if (($<HTMLInputElement>("labels")).checked) renderer.drawLabels(ctx, cam, game, reservedRects());
    if (overlay === "supply") {
      const sc = currentChain();
      if (sc) drawSupply(ctx, cam, game, sc.works, sc.flows, anim ? t : 0, focusId, sc.preview, reservedRects());
    } else if (overlay === "districts") {
      drawDistricts(ctx, cam, game, selected ? zoneAt(game, selected.x, selected.y) : -1, reservedRects());
    } else if (overlay === "rivals") {
      const mine = playerWorks(game);
      drawRivals(ctx, cam, game, competitors(game, mine?.industry ?? industry, mine ? { x: mine.x + mine.fp / 2, y: mine.y + mine.fp / 2 } : undefined), mine, focusId, reservedRects());
    }
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

/** Screen areas covered by on-map controls (zoom buttons, minimap, zoom badge), in canvas px. */
function reservedRects() {
  const vr = canvas.getBoundingClientRect();
  const sx = canvas.width / vr.width, sy = canvas.height / vr.height;
  return ["zoomButtons", "minimap", "zoom"].map((id) => {
    const r = $(id).getBoundingClientRect();
    return { x: (r.left - vr.left) * sx - 4, y: (r.top - vr.top) * sy - 4, w: r.width * sx + 8, h: r.height * sy + 8 };
  });
}

// ---------------------------------------------------------------- supply chain
let chainCache: { key: string; works: WorksRef; flows: Flow[]; preview: boolean } | null = null;
/** Your works' supply chain, or (before founding) a preview for the selected site and industry. */
function currentChain() {
  let works = playerWorks(game), preview = false;
  if (!works) {
    if (!selected) return null;
    const rep = evaluateSite(map, game.world, game.fields, industry, selected.x, selected.y);
    if (!rep.ok) return null;
    const techs = [INDUSTRIES[industry].tech[0].id];
    works = { industry, x: selected.x, y: selected.y, fp: rep.footprint, techs, produced: capacityOf(industry, techs), name: `${INDUSTRIES[industry].name} Co.` };
    preview = true;
  }
  const key = `${game.turn}|${works.industry}|${works.x},${works.y}|${works.techs.join()}|${works.produced}|${game.rivals.length}`;
  if (!chainCache || chainCache.key !== key) chainCache = { key, works, flows: supplyChain(game, works), preview };
  return chainCache;
}

// ---------------------------------------------------------------- panels
/** "Carnegie Steel (Duquesne Works)" → "Carnegie Steel — Duquesne Works": owner first, but the plant still named */
const plantName = (n: string) => n.replace(/ \((.*)\)$/, " — $1");

/** right panel tabs: company · business · town · rivals */
function setTab(tab: string) {
  $("right").dataset.tab = tab;
  for (const b of document.querySelectorAll<HTMLButtonElement>("#rightTabs button")) b.classList.toggle("on", b.dataset.tab === tab);
  $("right").scrollTop = 0;
}

/** a company name of the period for the industry, different each town ("Lyon, Shorb & Co. Iron Works") */
function suggestName(ind: IndustryId, seed: number): string {
  const S = ["Shoenberger", "Lyon", "Bakewell", "Zug", "Painter", "Moorhead", "McKnight", "Singer", "Spang", "Graff", "Hussey", "Lewis", "Wood", "Brown", "Park", "Oliver", "Byers", "Laughlin", "Shorb", "Black", "Everson"];
  const a = S[Math.abs(seed) % S.length], b = S[(Math.abs(seed) * 7 + 3) % S.length];
  const tail = { steel: "Iron Works", glass: "Glass Works", power: "Gas Light Company", metalworks: "Boat & Engine Works" }[ind];
  return (seed % 3 === 0 && a !== b ? `${a}, ${b} & Co.` : seed % 3 === 1 ? `${a} Brothers` : `${a} & Co.`) + ` ${tail}`;
}
function row(k: string, v: string, cls = "") {
  return `<div class="k">${k}</div><div class="v ${cls}">${v}</div>`;
}

const PAPERS = ["Pittsburgh Gazette", "Pittsburgh Dispatch", "Pittsburgh Press", "Pittsburgh Post-Gazette"];
/** which issue of the paper is shown (the archive is game.news, newest last) */
let paperIdx = -1, paperSeen = 0;
/** Show the newest issue in the newspaper at the bottom left when a new one comes out. */
function showNews() {
  if (game.news.length !== paperSeen) {
    paperSeen = game.news.length;
    paperIdx = game.news.length - 1;
    newsAt = performance.now();
  }
  renderPaper();
}

function renderPaper() {
  const el = $("news");
  const issue = game.news[paperIdx];
  const fresh = !!issue && issue.turn === game.turn;
  el.classList.toggle("fresh", fresh);
  const n = game.news.length;
  $("paperNav").innerHTML = n ? `<button data-p="-1" ${paperIdx <= 0 ? "disabled" : ""} title="Older issue">◀</button><span>${paperIdx + 1}/${n}</span><button data-p="1" ${paperIdx >= n - 1 ? "disabled" : ""} title="Newer issue">▶</button>` : "";
  if (!issue) { el.innerHTML = `<p class="none">No news yet.</p>`; return; }
  const c = cal({ ...game, turn: issue.turn });
  const paper = PAPERS[c.year < 1880 ? 0 : c.year < 1920 ? 1 : c.year < 1927 ? 2 : 3];
  el.innerHTML = `<div class="mast"><span>${paper}</span><span>${c.season} ${c.year}</span></div>` +
    (fresh ? "" : `<p class="none">${paperIdx === n - 1 ? "No news this season. The last issue:" : "From the archive:"}</p>`) +
    issue.items.map((e) => `<div class="kicker">${e.category}</div><h3>${esc(e.name)}</h3><p>${esc(e.description)}</p>`).join("");
  el.scrollTop = 0;
  // several stories: say so, and let the reader scroll
  if (issue.items.length > 1 && el.scrollHeight > el.clientHeight + 4) {
    el.insertAdjacentHTML("beforeend", `<div class="more">▾ ${issue.items.length} stories — scroll</div>`);
    el.onscroll = () => { const m = el.querySelector<HTMLElement>(".more"); if (m) m.hidden = el.scrollTop + el.clientHeight >= el.scrollHeight - 6; };
  } else el.onscroll = null;
}

function refreshPanels() {
  const c = cal(game);
  $("calendar").innerHTML = `<b>${c.season} ${c.year}</b> · Era ${c.era.id}`;
  $("calendar").title = `Era ${c.era.id}: ${c.era.name}`;
  $("population").innerHTML = `Pop. <b>${fmt(totalPopulation(game))}</b>`;
  $("cash").innerHTML = game.company ? `Cash <b>${money(game.company.cash)}</b>` : `Capital <b>$100,000</b>`;
  const bz = game.company?.biz.meters;
  $("standing").innerHTML = (bz ? ["Rep", "Labour", "Infl"].map((k, i) => { const v = Math.round([bz.reputation, bz.labour, bz.influence][i]); return `${k} <b class="${i < 2 ? (v >= 0 ? "up" : "down") : ""}">${i < 2 && v > 0 ? "+" : ""}${v}</b>`; }).join(" · ") + " · " : "") + `Morale <b class="${game.morale >= 50 ? "up" : "down"}">${Math.round(game.morale)}</b>`;
  townPanel();
  $("businessSection").hidden = !game.company;
  $("worksSection").hidden = !game.company;
  worksPanel(game, $("works"), () => { afterChange(); }, startPlacing);
  businessPanel(game, $("biz"), () => { afterChange(); });
  decisionCard(game, $("decision"), () => { afterChange(); });
  inspect();
  companyPanel();
  supplyPanel();
  rivalsPanel();
  $("legend").innerHTML = overlayLegend(overlay, game);
  showNews();
  $("log").innerHTML = game.log.slice(-40).reverse().map((l) => {
    const lc = cal({ ...game, turn: l.turn });
    return `<li>${lc.season.slice(0, 3)} ${lc.year} — <b>${esc(l.text)}</b></li>`;
  }).join("");
}

/** morale, the jobless, the teams and their grounds */
function townPanel() {
  const g = game, y = g.world.year, mo = Math.round(g.morale);
  const word = mo < 25 ? "Despairing" : mo < 40 ? "Low" : mo < 60 ? "Steady" : mo < 75 ? "Proud" : "Jubilant";
  const teams = g.teams.filter((t) => t.active);
  $("town").innerHTML = `<div class="bz-meter"><div class="bz-k">Town morale</div><div class="bz-bar"><b style="left:0;width:${mo}%;background:${mo >= 50 ? "#5aa860" : "#c8a040"}"></b></div><div class="bz-v">${mo} · ${word}</div></div>
    ${g.jobless > 50 ? `<div class="kv"><div class="k">Out of work</div><div class="v bad">${fmt(g.jobless)}</div></div>` : ""}
    ${teams.length ? `<div class="kv">${teams.map((t) => `<div class="k">${teamName(t.id, y)}</div><div class="v">${teamGround(t.id, y)}${t.last ? ` · ${t.last}` : ""}${t.titles.length ? ` · 🏆 ${t.titles.join(", ")}` : ""}</div>`).join("")}</div>` : `<p class="hint">No professional teams yet (the Alleghenys take the field in 1887).</p>`}
    ${g.landmarks.length ? `<p class="hint">${g.landmarks.length} landmarks built${g.landmarks.some((l) => l.state !== "open") ? `, ${g.landmarks.filter((l) => l.state !== "open").length} closed or ruined` : ""}.</p>` : ""}`;
}

function inspect() {
  const el = $("inspector");
  const site = $("siteSection");
  $("districtSection").hidden = !selected || !districtPanel(game, $("district"), zoneAt(game, selected.x, selected.y));
  $("bizEmpty").hidden = !!game.company;
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
    row("Elevation", feet(map.elevation[i])),
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
    w.eth[i] ? row(w.use[i] === Use.Civic ? "Congregation" : "Community", w.use[i] === Use.Civic && w.sub[i] === 8 ? GROUPS[w.eth[i]].hall : GROUPS[w.eth[i]].name) : "",
    anchorAt(map, x, y) ? row("Neighbourhood", anchorAt(map, x, y)!.name) : "",
    row("Land value", money(w.landValue[i])),
    row("Pollution", w.pollution[i].toFixed(3)),
    row("Owner", owner),
    row("Nearest place", `${near.name} (${distance(nd * map.metersPerTile)})`),
  ].join("");

  site.hidden = !!game.company;
  if (game.company) return;
  const rep = evaluateSite(map, game.world, game.fields, industry, x, y);
  $("site").innerHTML = [
    row("Industry", INDUSTRIES[industry].name),
    row("Footprint", `${rep.footprint}×${rep.footprint} tiles (${feet(rep.footprint * map.metersPerTile)} square)`),
    row("Score", `${rep.score} / 100`, rep.ok ? "good" : "bad"),
    row("Cost", money(rep.cost), rep.cost > 100000 ? "bad" : ""),
    row("Labor nearby", fmt(rep.labor)),
    row("River", rep.riverM > 60000 ? "—" : distance(rep.riverM)),
    row("Coal outcrop", rep.coalM > 60000 ? "—" : distance(rep.coalM)),
    row("Relief", feet(rep.reliefM)),
    `<div class="full hint">${rep.reasons.join(" · ")}</div>`,
  ].join("");
  ($<HTMLButtonElement>("found")).disabled = !!game.company || !rep.ok || rep.cost > 100000;
}

/** what the works is now, from its newest process ("Bessemer steel", not 1850's "iron furnace" in 1985) */
function businessNow(c: { industry: IndustryId; techs: string[] }): string {
  const ind = INDUSTRIES[c.industry];
  const newest = [...ind.tech].reverse().find((t) => c.techs.includes(t.id) && t.cost > 0);
  return newest ? `${ind.name} · ${newest.name.toLowerCase()}` : ind.startsAs;
}

/** a warning in the Company panel when the works has fallen well behind the industry */
function behindWarning(): string[] {
  const out: string[] = [];
  for (const w of allWorks(game.company!)) {
    const st = techStanding(game, w);
    if (st.behind.length >= 2) out.push(`<div class="full warn">${esc(w.name)} is ${st.behind.length} processes behind the industry (${st.behind.map((t) => esc(t.name)).join(", ")}): its prices are ${Math.round((1 - st.factor) * 100)}% under the rivals'. Commission them on the Business tab.</div>`);
  }
  return out;
}

function companyPanel() {
  const c = game.company;
  $("companySection").hidden = !c;
  $("foundSection").hidden = !!c;
  if (!c) return;
  const ind = INDUSTRIES[c.industry];
  const s = c.lastSeason;
  $("company").innerHTML = [
    row("Name", esc(c.name)),
    row("Business", businessNow(c)),
    row("Status", c.status === "running" ? "Running" : c.status === "strike" ? "On strike" : c.status === "flooded" ? "Flooded" : c.status === "lockout" ? "Locked out" : "Idle", c.status === "running" ? "good" : "bad"),
    row("Cash", money(c.cash), c.cash < 0 ? "bad" : ""),
    c.debt ? row("Owed to the bank", money(c.debt), "bad") : "",
    c.others.length ? row("Works", `${c.others.length + 1} (${allWorks(c).map((w) => w.name.replace(/ Co\.$/, "")).join(", ")})`) : "",
    row("Employees", fmt(allWorks(c).reduce((s, w) => s + w.employees, 0))),
    row("Lifetime output", fmt(c.produced)),
    row("Tech", c.techs.map((t) => ind.tech.find((x) => x.id === t)?.name).join(", ")),
    ...behindWarning(),
    ...(s ? [
      `<div class="full hint">Last season${c.others.length ? " (first works; the company's costs)" : ""}</div>`,
      row("Produced", fmt(s.produced)),
      row("Revenue", money(s.revenue)),
      row("Inputs", money(-s.inputCost)),
      row("Wages", money(-s.wages)),
      s.upkeep ? row("Upkeep", money(-s.upkeep)) : "",
      s.other ? row("Other", money(-s.other), s.other > 0 ? "" : "good") : "",
      row("Profit", money(s.profit), s.profit < 0 ? "bad" : "good"),
      c.others.length && c.totals ? row("All works", money(c.totals.profit), c.totals.profit < 0 ? "bad" : "good") : "",
      row("Workers", `${fmt(s.workersHired)} / ${fmt(s.workersWanted)}`),
      row("Workforce health", `${Math.round(c.health * 100)}%`, c.health < 0.7 ? "bad" : ""),
      row("Unrest", c.unrest < 0.2 ? "Quiet" : c.unrest < 0.35 ? "Grumbling" : c.unrest < 0.5 ? "Restless" : "Angry", c.unrest >= 0.35 ? "bad" : ""),
      ...(c.freight ? [
        `<div class="full hint">Shipping in (last season)</div>`,
        ...c.freight.lanes.map((l) => row(l.good[0].toUpperCase() + l.good.slice(1), `${fmt(l.delivered)} t by ${l.mode === "river" ? (l.gateway === "upper_mon" ? "Mon barge" : l.gateway === "allegheny" ? "Allegheny barge" : "Ohio barge") : "rail"} · $${l.costPerTon.toFixed(2)}/t${l.util > 0.85 ? ` · ${Math.round(l.util * 100)}% full` : ""}`, l.util > 1 ? "bad" : "")),
      ] : []),
      s.notes.length ? `<div class="full hint">${s.notes.join(" ")}</div>` : "",
    ] : []),
  ].join("");
  const lib = $<HTMLButtonElement>("library");
  lib.disabled = c.library || cal(game).year < 1880 || c.cash < LIBRARY_COST;
  lib.textContent = c.library ? "Library funded" : `Fund a library ($${fmt(LIBRARY_COST)})`;
  ($<HTMLButtonElement>("steps")).disabled = c.cash < STEPS_COST;
  const q = spurQuote(game), sp = $<HTMLButtonElement>("spur");
  sp.hidden = !q && !c.spur;
  sp.disabled = !q || c.cash < (q?.cost ?? Infinity);
  sp.textContent = c.spur ? "Rail siding built" : q ? `Build a rail siding ($${fmt(q.cost)}, ${distance(q.len * map.metersPerTile)})` : "";
  const inc = $<HTMLButtonElement>("incline");
  inc.disabled = c.cash < INCLINE_COST || cal(game).year < 1870;
  inc.title = cal(game).year < 1870 ? "Inclines arrive in 1870" : "Build an incline from a street near the works up to the hilltop houses";
}

const KIND_TITLE: Record<Flow["kind"], string> = { input: "Raw materials in", utilityIn: "Utilities in", utilityOut: "Utilities out (your customers)", output: "Finished goods out" };
function supplyPanel() {
  const sc = game.company ? currentChain() : null;
  $("supplySection").hidden = !sc;
  if (!sc) return;
  const groups = (["input", "utilityIn", "utilityOut", "output"] as const).map((k) => [k, sc.flows.filter((f) => f.kind === k)] as const).filter(([, fl]) => fl.length);
  $("supply").innerHTML = groups.map(([k, fl]) => `<div class="sc-head">${KIND_TITLE[k]}</div>` + fl.map((f) => `
    <div class="sc-row" data-flow="${f.id}" data-x="${(f.kind === "input" || f.kind === "utilityIn" ? f.from : f.to).x}" data-y="${(f.kind === "input" || f.kind === "utilityIn" ? f.from : f.to).y}" title="Hover to highlight on the Supply chain overlay, click to go there">
      <div class="sc-top"><i style="background:${FLOW_COLOUR(f)}"></i><b>${f.good}</b><span>${f.qty ? fmt(f.qty) : ""}</span></div>
      ${f.qty ? `<div class="sc-bar"><div style="width:${Math.max(3, f.share * 100)}%;background:${FLOW_COLOUR(f)}"></div></div>` : ""}
      <div class="sc-sub">${f.partner} · ${f.via}${f.value ? ` · ${money(f.value)}` : ""}</div>
    </div>`).join("")).join("") + `<p class="hint">Quantities are units per season. Bars show each link's share of inputs (by value) or of output.</p>`;
}

function rivalsPanel() {
  const mine = playerWorks(game);
  const ind = mine?.industry ?? industry;
  const list = competitors(game, ind, mine ? { x: mine.x + mine.fp / 2, y: mine.y + mine.fp / 2 } : undefined);
  $("rivalsTitle").textContent = mine ? "Competitors" : `Who you'd face in ${INDUSTRIES[ind].name}`;
  const direct = list.filter((c) => c.relation === "competitor" && c.state);
  const myCap = game.company ? allWorks(game.company).filter((w) => w.industry === ind).reduce((t, w) => t + capacityOf(w.industry, w.techs), 0) : 0;
  const total = myCap + direct.reduce((s, c) => s + c.capacity, 0);
  const share = mine && total ? `<div class="full hint">Your share of ${INDUSTRIES[ind].name.toLowerCase()} capacity on the map</div>
    <div class="ms-bar">${[{ n: "You", v: myCap, c: "#ffd34a" }, ...direct.map((c) => ({ n: plantName(nameNow(c.def, game.world.year, c.state?.name, c.state?.nameYear)), v: c.capacity, c: RELATION_COLOUR.competitor }))]
      .map((p, k) => `<div title="${p.n}: ~${fmt(p.v)}/season" style="width:${(p.v / total) * 100}%;background:${p.c};opacity:${k ? 1 - k * 0.15 : 1}"></div>`).join("")}</div>
    <div class="hint">You ${Math.round((myCap / total) * 100)}% · ${direct.length} rival works open</div>` : "";
  const label: Record<string, string> = { competitor: "Competitor", supplier: "Supplier", customer: "Customer", lender: "Bank", other: "Other industry" };
  $("rivalsList").innerHTML = share + list.map((c) => `
    <div class="sc-row ${c.state ? "" : "later"}" data-rival="${c.def.id}" title="Hover to highlight on the Competitors overlay, click to go there">
      <div class="sc-top"><i style="background:${RELATION_COLOUR[c.relation]}"></i><b>${esc(plantName(nameNow(c.def, game.world.year, c.state?.name, c.state?.nameYear)))}${c.state?.closed ? " (closed)" : ""}</b><span>${label[c.relation]}</span></div>
      <div class="sc-sub">${c.owned ? `<span class="owned">Yours now</span> · ${c.product}` : c.state ? `${c.product} · ~${fmt(c.capacity)}/season · ${c.near}${c.km !== undefined ? ` · ${distance(c.km * 1000)}` : ""}` : c.def.entryYear > game.world.year ? `Opens ${c.def.entryYear} near ${c.def.site}` : `Never opened: no site near ${c.def.site}`}</div>
      <div class="sc-sub">${esc(c.def.figures.join(" & "))} — ${esc(c.def.note)}</div>
      ${c.state?.lastMove ? `<div class="sc-sub"><i>Last move ${c.state.lastMove}</i></div>` : ""}
      ${c.state?.damage.length ? `<div class="sc-sub bad">Hurt: ${c.state.damage.map((d) => `${d.why} (−${Math.round((1 - d.mult) * 100)}%)`).join(", ")}</div>` : ""}
    </div>`).join("");
}

function setOverlay(id: OverlayId) {
  (document.querySelector(`input[name="overlay"][value="${id}"]`) as HTMLInputElement | null)?.click();
}

// ---------------------------------------------------------------- UI wiring
function setupUI() {
  $("overlays").innerHTML = (["Land", "Town", "Business"] as const).map((grp) => `<div class="ov-group">${grp}</div>` + OVERLAYS.filter((o) => o.group === grp).map((o) =>
    `<label class="ov"><input type="radio" name="overlay" value="${o.id}" ${o.id === overlay ? "checked" : ""}/> <span class="ov-name">${o.label}</span>${o.swatch ? `<span class="ov-sw" style="background:${o.swatch}"></span>` : ""}</label>`).join("")).join("");
  $("overlays").addEventListener("change", (e) => {
    overlay = (e.target as HTMLInputElement).value as OverlayId;
    focusId = null;
    $("legend").innerHTML = overlayLegend(overlay, game);
    if (overlay.startsWith("site:")) { industry = overlay.slice(5) as IndustryId; ($<HTMLSelectElement>("industry")).value = industry; industryNote(); }
    inspect();
    requestRender();
  });
  const sel = $<HTMLSelectElement>("industry");
  sel.innerHTML = INDUSTRY_IDS.map((k) => `<option value="${k}">${INDUSTRIES[k].name}</option>`).join("");
  sel.addEventListener("change", () => { industry = sel.value as IndustryId; industryNote(); inspect(); rivalsPanel(); requestRender(); });
  industryNote();
  // supply chain and competitor lists: hover highlights on the map, click flies there
  for (const [list, attr, ov] of [["supply", "flow", "supply"], ["rivalsList", "rival", "rivals"]] as const) {
    const el = $(list);
    el.addEventListener("mouseover", (e) => {
      const row = (e.target as HTMLElement).closest<HTMLElement>(".sc-row");
      const id = row?.dataset[attr] ?? null;
      if (id !== focusId) { focusId = id; if (overlay === ov) requestRender(); }
    });
    el.addEventListener("mouseleave", () => { focusId = null; if (overlay === ov) requestRender(); });
    el.addEventListener("click", (e) => {
      const row = (e.target as HTMLElement).closest<HTMLElement>(".sc-row");
      if (!row) return;
      if (overlay !== ov) setOverlay(ov);
      focusId = row.dataset[attr] ?? null;
      let x = Number(row.dataset.x), y = Number(row.dataset.y);
      if (attr === "rival") {
        const st = game.rivals.find((r) => r.id === focusId);
        const lm = map.landmarks.find((l) => l.name === competitors(game, playerWorks(game)?.industry ?? industry).find((c) => c.def.id === focusId)?.def.site);
        if (st) { x = st.x + st.footprint / 2; y = st.y + st.footprint / 2; } else if (lm) { x = lm.x; y = lm.y; }
      }
      if (isFinite(x) && isFinite(y)) centerOn(Math.round(x), Math.round(y));
      requestRender();
    });
  }
  $("showSupply").addEventListener("click", () => setOverlay(overlay === "supply" ? "none" : "supply"));
  $("showRivals").addEventListener("click", () => setOverlay(overlay === "rivals" ? "none" : "rivals"));
  $<HTMLInputElement>("placing").addEventListener("change", (e) => { placing = (e.target as HTMLInputElement).checked; if (placing && querying) setQuerying(false); requestRender(); });
  for (const id of ["labels", "grid", "animate", "tod"]) $(id).addEventListener("change", () => requestRender());
  for (const [id, fn] of [["steps", buildSteps], ["incline", buildIncline], ["spur", buildSpur]] as const) $(id).addEventListener("click", () => {
    const r = fn(game);
    if (!r.ok) game.log.push({ turn: game.turn, text: r.reason! });
    afterChange();
  });
  // Sound. Browsers (Safari above all) only allow audio to start inside a user gesture, so sound is
  // "wanted" by default and starts on the first click or key press anywhere; the choice is remembered.
  // Every later gesture also revives a context Safari has suspended or interrupted on its own.
  const toggleSound = () => {
    // in the "click to start" state a press means start, not mute
    if (soundWanted && !sound.running) { sound.start().then(() => { soundUI(); updateSound(); }); return; }
    soundWanted = !soundWanted;
    try { localStorage.setItem("mt.sound", soundWanted ? "on" : "off"); } catch { /* private mode */ }
    if (soundWanted) sound.start().then(soundUI); else sound.stop().then(soundUI);
    soundUI();
  };
  $("sound").addEventListener("click", (e) => { e.stopPropagation(); toggleSound(); });
  $("soundTop").addEventListener("click", (e) => { e.stopPropagation(); toggleSound(); });
  const wake = (e: Event) => {
    if (e instanceof KeyboardEvent && e.key.toLowerCase() === "m") return; // the M key toggles instead
    if (soundWanted && !sound.running) sound.start().then(() => { soundUI(); updateSound(); });
  };
  for (const ev of ["pointerdown", "click", "keydown"]) window.addEventListener(ev, wake, true);
  window.addEventListener("keydown", (e) => {
    if (inFormControl(e)) return;
    if (e.key.toLowerCase() === "m") toggleSound();
  });
  sound.onState = soundUI;
  soundUI();
  const vols = () => sound.setVolumes(Number(($<HTMLInputElement>("musicVol")).value), Number(($<HTMLInputElement>("ambVol")).value));
  $("musicVol").addEventListener("input", vols); $("ambVol").addEventListener("input", vols);
  setInterval(updateSound, 500);
  $("library").addEventListener("click", () => {
    const r = fundLibrary(game);
    if (!r.ok) game.log.push({ turn: game.turn, text: r.reason! });
    afterChange();
  });

  $("found").addEventListener("click", () => {
    if (!selected) return;
    const name = ($<HTMLInputElement>("companyName")).value.trim() || suggestName(industry, game.seed);
    const r = foundCompany(game, industry, selected.x, selected.y, name);
    if (!r.ok) game.log.push({ turn: game.turn, text: r.reason! });
    placing = false; ($<HTMLInputElement>("placing")).checked = false;
    if (r.ok) { selected = null; hover = null; setTab("business"); }
    renderer.updateHeights();
    afterChange();
  });
  $("next").addEventListener("click", nextSeason);
  $("paperNav").addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>("button[data-p]");
    if (!b) return;
    e.stopPropagation();
    paperIdx = Math.max(0, Math.min(game.news.length - 1, paperIdx + Number(b.dataset.p)));
    renderPaper();
  });
  // every section heading folds its section away (remembered between visits)
  document.querySelectorAll<HTMLElement>("section > h2").forEach((h) => {
    const sec = h.parentElement!, key = `mt.fold.${sec.id}`;
    try { if (sec.id && localStorage.getItem(key) === "1") sec.classList.add("collapsed"); } catch { /* private mode */ }
    h.addEventListener("click", (e) => {
      if ((e.target as HTMLElement).closest("button")) return;
      sec.classList.toggle("collapsed");
      try { if (sec.id) localStorage.setItem(key, sec.classList.contains("collapsed") ? "1" : "0"); } catch { /* private mode */ }
    });
  });
  $("speeds").addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>("button[data-speed]");
    if (b) setSpeed(Number(b.dataset.speed));
  });
  $("marketsBtn").addEventListener("click", () => toggleMarkets());
  $("regen").addEventListener("click", () => {
    // a typed seed replays that town; otherwise every press is a fresh one
    const v = ($<HTMLInputElement>("seed")).value.trim();
    newTown(seedEdited && v && !isNaN(Number(v)) ? Number(v) : Math.floor(Math.random() * 1e6));
    $("gameDrop").hidden = true;
    showNews();
  });
  $("seed").addEventListener("input", () => { seedEdited = true; });
  $("companyName").addEventListener("input", () => { nameEdited = true; });
  $("rightTabs").addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>("button[data-tab]");
    if (b) setTab(b.dataset.tab!);
  });
  // the Game menu holds the seed and New town; it closes on any click outside it
  $("gameBtn").addEventListener("click", (e) => { e.stopPropagation(); $("gameDrop").hidden = !$("gameDrop").hidden; });
  document.addEventListener("click", (e) => { if (!(e.target as HTMLElement).closest("#gameMenu")) $("gameDrop").hidden = true; });
  $("nextYear").addEventListener("click", nextYear);
  $("bestSite").addEventListener("click", showBestSite);

  // mouse: drag to pan, click to select
  let down: { x: number; y: number; cx: number; cy: number } | null = null;
  let dragged = false;
  canvas.addEventListener("mousedown", (e) => { down = { x: e.offsetX, y: e.offsetY, cx: cam.x, cy: cam.y }; dragged = false; });
  window.addEventListener("mouseup", (e) => {
    if (down && !dragged && e.target === canvas && proposal) {
      // placing a project: the click moves it there
      const t = pickTile(map, cam.x + e.offsetX / cam.zoom, cam.y + e.offsetY / cam.zoom);
      if (t) { proposal = checkProject(game, proposal.kind, t.x - (proposal.size >> 1), t.y - (proposal.size >> 1), proposal.industry); placeBar(); requestRender(); }
      down = null;
      return;
    }
    if (down && !dragged && e.target === canvas) {
      selected = pickTile(map, cam.x + e.offsetX / cam.zoom, cam.y + e.offsetY / cam.zoom);
      inspect();
      if (querying && selected) showQuery(selected.x, selected.y, e.offsetX, e.offsetY);
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
  $("queryBtn").addEventListener("click", () => setQuerying(!querying));
  $("query").addEventListener("click", (e) => { if ((e.target as HTMLElement).classList.contains("q-close")) $("query").hidden = true; });
  $("zoomIn").addEventListener("click", () => setZoom(canvas.width / 2, canvas.height / 2, zoomIndex() + 1));
  $("zoomOut").addEventListener("click", () => setZoom(canvas.width / 2, canvas.height / 2, zoomIndex() - 1));

  window.addEventListener("keydown", (e) => {
    if (inFormControl(e)) return;
    const step = 160 / cam.zoom;
    const k = e.key.toLowerCase();
    if (k === "arrowleft" || k === "a") cam.x -= step;
    else if (k === "arrowright" || k === "d") cam.x += step;
    else if (k === "arrowup" || k === "w") cam.y -= step;
    else if (k === "arrowdown" || k === "s") cam.y += step;
    else if (k === "+" || k === "=") return setZoom(canvas.width / 2, canvas.height / 2, zoomIndex() + 1);
    else if (k === "-" || k === "_") return setZoom(canvas.width / 2, canvas.height / 2, zoomIndex() - 1);
    else if (k === " ") { e.preventDefault(); if (e.shiftKey) nextYear(); else nextSeason(); return; }
    else if (k === "p") { if (playTimer) stopPlay(); else startPlay(); return; }
    else if (k >= "1" && k <= "4" && !e.ctrlKey && !e.metaKey) { setSpeed(Number(k)); return; }
    else if (k === "escape") { if (!$("markets").hidden) toggleMarkets(false); else if (proposal) stopPlacing(); else if (!$("query").hidden) $("query").hidden = true; else if (querying) setQuerying(false); else { placing = false; ($<HTMLInputElement>("placing")).checked = false; selected = null; inspect(); requestRender(); } }
    else if (k === "q") { setQuerying(!querying); return; }
    else return;
    clampCam();
    requestRender();
  });
  window.addEventListener("resize", resize);
}

/** Name of the place at the centre of the view. */
function placeName(): string {
  const wx = cam.x + canvas.width / 2 / cam.zoom, wy = cam.y + canvas.height / 2 / cam.zoom + (260 - 200) * 1.15;
  const a = wx / 32, b = wy / 16;
  const cx = (a + b) / 2, cy = (b - a) / 2;
  let best = "", bd = 40;
  const consider = (name: string, x: number, y: number) => { const d = Math.hypot(x - cx, y - cy); if (d < bd) { bd = d; best = name; } };
  for (const an of ANCHORS) { const [x, y] = latLonToTile(map, an.lat, an.lon); consider(an.name, x, y); }
  for (const h of HILLSIDES) { const [x, y] = latLonToTile(map, h.lat, h.lon); consider(h.name, x, y); }
  for (const l of map.landmarks) if (l.kind === "town") consider(l.name.replace(/ \(.*\)$/, ""), l.x, l.y);
  return best;
}

/** Query tool on/off: while on, clicks open a card at the tile instead of placing works */
function setQuerying(on: boolean) {
  querying = on;
  $("queryBtn").classList.toggle("on", on);
  canvas.classList.toggle("querying", on);
  if (on) { placing = false; ($<HTMLInputElement>("placing")).checked = false; }
  else $("query").hidden = true;
  requestRender();
}

/** open the query card for a tile, beside the click point but kept inside the map view */
function showQuery(x: number, y: number, px: number, py: number) {
  const el = $("query");
  el.innerHTML = queryCard({ game, map, renderer }, x, y);
  el.hidden = false;
  const vp = $("viewport"), vw = vp.clientWidth, vh = vp.clientHeight, w = el.offsetWidth, h = el.offsetHeight;
  let left = px + 24 + w < vw - 8 ? px + 24 : Math.max(8, px - 24 - w);
  let top = Math.max(8, Math.min(vh - h - 8, py - 40));
  // don't sit on the minimap (bottom right): move up above it, or to its left
  const mm = mini.getBoundingClientRect(), vr = vp.getBoundingClientRect();
  const mx = mm.left - vr.left, my = mm.top - vr.top;
  if (left + w > mx - 6 && top + h > my - 6) {
    if (my - h - 8 >= 8) top = my - h - 8; else left = Math.max(8, mx - w - 8);
  }
  el.style.left = `${left}px`;
  el.style.top = `${top}px`;
}

function soundUI() {
  const on = sound.running;
  const top = $("soundTop");
  top.classList.toggle("on", on);
  top.classList.toggle("waiting", soundWanted && !on);
  // a drawn speaker (emoji fonts aren't everywhere) and a word
  const waves = on ? `<path d="M10.5 5.5a3.5 3.5 0 0 1 0 5M12.5 3.5a6.5 6.5 0 0 1 0 9" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>`
    : `<path d="M10.5 5.5l4 5M14.5 5.5l-4 5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>`;
  top.innerHTML = `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2 6h3l4-3v10l-4-3H2z" fill="currentColor"/>${soundWanted && !on ? "" : waves}</svg><span>${on ? "Sound" : soundWanted ? "Start sound" : "Muted"}</span>`;
  top.title = on ? "Sound is on — click or press M to mute" : soundWanted ? "Browsers start audio on your first click or key press" : "Sound is off — click or press M to turn it on";
  $("sound").textContent = on ? "Sound off" : "Sound on";
  if (!on && !soundWanted) $("nowPlaying").textContent = "Music follows the era, the neighbourhood in view and how close you are.";
}

function updateSound() {
  if (!sound.running || !game) return;
  const v = summarizeView(game, map, cam, canvas.width, canvas.height, { ...traffic.counts(), night: lastNight, place: placeName() });
  sound.update(v);
  $("nowPlaying").textContent = `Now playing: ${sound.nowPlaying}`;
}

let nameEdited = false;
function industryNote() {
  const ind = INDUSTRIES[industry];
  if (!nameEdited && game) ($<HTMLInputElement>("companyName")).value = suggestName(industry, game.seed);
  const fp = footprintTiles(map, industry);
  $("industryNote").textContent = `Starts as: ${ind.startsAs}. From $${fmt(ind.startCost)} plus land and grading. Needs ${fp}×${fp} tiles (${feet(fp * map.metersPerTile)} square) of ground with under ${feet(ind.site.maxReliefM)} of relief${ind.site.riverWithinM ? `, within ${feet(ind.site.riverWithinM)} of a river` : ""}.`;
}

// ---------------------------------------------------------------- building projects
/** the game suggests a spot and shows it; the player clicks to move it, then confirms */
function startPlacing(kind: ProjectKind, ind?: IndustryId) {
  const p = suggestProject(game, kind, ind);
  stopPlay();
  if (querying) setQuerying(false);
  placing = false; ($<HTMLInputElement>("placing")).checked = false;
  proposal = p ?? { kind, x: game.company!.x, y: game.company!.y, size: 1, ok: false, reason: "No suitable spot found nearby — click the map to try one", cost: 0, industry: ind, displaced: 0 };
  if (p) centerOn(Math.round(p.x + p.size / 2), Math.round(p.y + p.size / 2), Math.max(cam.zoom, 0.75));
  placeBar();
  requestRender();
}

function stopPlacing() { proposal = null; placeBar(); requestRender(); }

function placeBar() {
  const el = $("placeBar");
  if (!proposal) { el.hidden = true; return; }
  const p = proposal;
  const name = PROJECTS[p.kind].name + (p.kind === "found" && p.industry ? `: ${INDUSTRIES[p.industry].name}` : "");
  el.innerHTML = `<span><b>${name}</b> — ${p.ok ? `${money(p.cost)}${p.displaced ? ` · ${fmt(p.displaced)} people moved out` : ""}` : `<span class="why">${esc(p.reason ?? "Can't build here")}</span>`}<br><span class="hint">Click the map to move it.</span></span>
    <button id="placeOk" class="primary" ${p.ok && game.company && game.company.cash >= p.cost ? "" : "disabled"}>Build here</button><button id="placeCancel">Cancel</button>`;
  el.hidden = false;
  $("placeOk").addEventListener("click", () => {
    const r = buildProject(game, p);
    worksStatus(r.text);
    if (r.ok) { proposal = null; renderer.updateHeights(); renderer.invalidateAll(); }
    afterChange();
    placeBar();
  });
  $("placeCancel").addEventListener("click", stopPlacing);
}

function nextSeason() {
  if (game.over) return;
  // a historical moment is waiting for your answer
  if (game.pendingDecision) { stopPlay(); decisionCard(game, $("decision"), () => afterChange()); return; }
  resetBusinessUi(); resetWorksUi();
  if (proposal) stopPlacing();
  advanceTurn(game);
  afterTurn();
}

function nextYear() {
  if (game.over) return;
  // play out the rest of this year and stop at next Spring; show every headline on the way in the log
  if (game.pendingDecision) { stopPlay(); decisionCard(game, $("decision"), () => afterChange()); return; }
  resetBusinessUi(); resetWorksUi();
  if (proposal) stopPlacing();
  do advanceTurn(game); while (!game.over && !game.pendingDecision && cal(game).season !== "Spring");
  afterTurn();
}

function afterTurn() {
  afterChange();
  if (!$("markets").hidden) marketsView(game, $("markets"));
  if (querying && selected && !$("query").hidden) { const el = $("query"); el.innerHTML = queryCard({ game, map, renderer }, selected.x, selected.y); }
  showNews();
  if (game.over) { stopPlay(); showFinal(); }
}

/** ms per season at each speed: 1× takes a game (540 seasons) about two hours */
const SPEED_MS = [0, 13300, 6650, 3300, 900];
let speed = 0, lastSpeed = 1;

function setSpeed(k: number) {
  if (playTimer) clearInterval(playTimer);
  playTimer = 0;
  speed = game?.over ? 0 : k;
  if (speed > 0) {
    lastSpeed = speed;
    let due = performance.now() + SPEED_MS[speed];
    playTimer = window.setInterval(() => {
      const now = performance.now();
      if (now < due || renderer.pending > 40) return;
      // at the fastest speed, hold a moment on seasons with news so the headline can be read
      if (speed === 4 && game.news[game.news.length - 1]?.turn === game.turn && now - newsAt < 2500) return;
      due = now + SPEED_MS[speed];
      nextSeason();
    }, 100);
  }
  document.querySelectorAll<HTMLButtonElement>("#speeds button").forEach((b) => b.classList.toggle("on", Number(b.dataset.speed) === speed));
}

function toggleMarkets(force?: boolean) {
  const el = $("markets");
  if (force === false || (force === undefined && !el.hidden)) { el.hidden = true; return; }
  marketsView(game, el);
}

function startPlay() { if (!game.over) setSpeed(lastSpeed); }
function stopPlay() { setSpeed(0); }

function updateTimeControls() {
  const over = !!game.over;
  for (const id of ["next", "nextYear"]) ($<HTMLButtonElement>(id)).disabled = over;
  document.querySelectorAll<HTMLButtonElement>("#speeds button").forEach((b) => { b.disabled = over && b.dataset.speed !== "0"; });
  $("next").textContent = over ? "The end" : "Season ▶";
}

/** jump to the best affordable site for the chosen industry (press again for the next one) */
function showBestSite() {
  const pSat = popSAT(map, game.world);
  const fp = footprintTiles(map, industry);
  const cands: { x: number; y: number; score: number }[] = [];
  for (let y = 4; y < map.height - fp - 4; y += 5) for (let x = 4; x < map.width - fp - 4; x += 5) {
    const r = evaluateSite(map, game.world, game.fields, industry, x, y, pSat);
    if (r.ok && r.cost <= 100000) cands.push({ x, y, score: r.score });
  }
  cands.sort((a, b) => b.score - a.score);
  const pick = cands.find((c) => siteTried.every((t) => Math.hypot(t.x - c.x, t.y - c.y) > 30));
  if (!pick) { siteTried = []; return; }
  siteTried.push(pick);
  selected = { x: pick.x, y: pick.y };
  centerOn(pick.x + fp / 2, pick.y + fp / 2, 1);
  inspect();
  requestRender();
}

function showFinal() {
  const g = game, st = g.stats, c = g.company;
  const pop = totalPopulation(g);
  const rows: [string, string][] = [
    ["Valley population, peak", `${fmt(st.peakPop)} (${st.peakPopYear})`],
    ["Valley population, 1985", fmt(pop)],
  ];
  let verdict: string;
  if (c) {
    rows.unshift(
      [esc(c.name), `founded ${st.foundedYear ?? "?"} · ${esc(businessNow(c))}`],
      ["Processes owned", `${allWorks(c).reduce((n, w) => n + w.techs.length, 0)} (${esc(INDUSTRIES[c.industry].tech.filter((t) => c.techs.includes(t.id)).map((t) => t.name).join(", "))})`],
      ["Seasons in operation", fmt(c.seasonsOperating)],
      ["Lifetime output", fmt(c.produced)],
      ["Most workers", `${fmt(st.peakEmployees)} (${st.peakEmployeesYear})`],
      ["Cash, peak", `${money(st.peakCash)} (${st.peakCashYear})`],
      ["Cash, 1985", money(c.cash)],
      ["Strikes", fmt(st.strikes)],
      ["Reputation · labour · influence", `${Math.round(c.biz.meters.reputation)} · ${Math.round(c.biz.meters.labour)} · ${Math.round(c.biz.meters.influence)}`],
    );
    if (c.others.length) rows.splice(1, 0, ["Works owned", allWorks(c).map((w) => w.name).join(", ")]);
    verdict = c.bankrupt ? `${c.name} went into receivership in ${cal(g).year}. The bank sold the works to whoever would have them.` : c.cash > 0
      ? `${c.name} is still standing when the valley's great mills go quiet. Whether the town around it survives is another question.`
      : `${c.name} did not outlast the collapse. The works stand cold beside the river.`;
  } else verdict = "You never founded a company. The valley's story went on without you.";
  const epi = c ? epilogue() : [];
  $("final").innerHTML = `<div class="paper">
    <div class="mast"><span>Pittsburgh Post-Gazette</span><span>${c?.bankrupt ? `${cal(g).season} ${cal(g).year}` : "Winter 1985"}</span></div>
    <h3>${c?.bankrupt ? "Receivers Sell the Works" : "The Mills Go Quiet"}</h3>
    <p>${verdict}</p>
    ${epi.length ? `<p class="epilogue">${epi.join(" ")}</p>` : ""}
    <table>${rows.map(([k, v]) => `<tr><td>${k}</td><td>${v}</td></tr>`).join("")}</table>
    ${c && c.biz.record.length ? `<p style="font-size:12px"><b>Your choices:</b> ${c.biz.record.filter((r) => r.includes("—")).concat(c.biz.record.filter((r) => !r.includes("—")).slice(-4)).slice(0, 8).map(esc).join(" · ")}</p>` : ""}
    <div class="actions"><button id="finalLook">Look around</button><button id="finalNew" class="primary">New town</button></div>
  </div>`;
  $("final").hidden = false;
  $("finalLook").addEventListener("click", () => { $("final").hidden = true; });
  $("finalNew").addEventListener("click", () => { newTown(Math.floor(Math.random() * 1e6)); showNews(); });
}

/** a few sentences on how the company played its part, from the choices it made and how it ended */
function epilogue(): string[] {
  const g = game, c = g.company!, f = { ...g.flags, ...c.biz.flags }, m = c.biz.meters, out: string[] = [];
  const st = techStanding(g, c);
  if (f.sheltered) out.push("In 1850 its cellars hid fugitives on the road to Canada.");
  if (f.stayedUnion1897) out.push("When J&L broke with the union in 1897, it kept faith with the Amalgamated.");
  else if (f.nonUnion1897) out.push("It followed J&L out of the union in 1897.");
  if (f.usSteel === "pact") out.push("It dined with Judge Gary and held the trust's prices.");
  else if (f.usSteel === "sold") out.push("It sold a works to Morgan's trust in 1901.");
  if (f.bannedMeetings) out.push("It shut Mother Jones out of its company town in 1919.");
  if (f.warOrders || f.warContract) out.push("It took the government's war orders.");
  if (f.conference) out.push("It joined the Allegheny Conference to clear the smoke.");
  if (f.decreeStalled) out.push("It signed the clean-air decree and dragged its feet.");
  if (f.relief || f.reliefGiven) out.push("In hard times it fed the families out of work.");
  if (f.laidOff) out.push("When the orders stopped, it laid men off.");
  if (c.library) out.push("A library with its name on it still stands.");
  if (f.endowed) out.push("The university keeps a laboratory in its name.");
  if (st.behind.length >= 2) out.push(`It never caught up with the industry: at the end it still lacked ${st.behind.length} processes its rivals ran.`);
  else if (c.techs.length > 3) out.push("It kept its furnaces up to date to the end.");
  out.push(m.reputation >= 30 ? "The valley remembers it kindly." : m.reputation <= -40 ? "The valley remembers it bitterly." : "The valley remembers it as one mill among many.");
  if (m.labour <= -30) out.push("Its men never trusted it.");
  else if (m.labour >= 30) out.push("Its men stood by it.");
  return out;
}

function afterChange() {
  drawMinimapBase();
  refreshPanels();
  updateTimeControls();
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
    overlay: (id: OverlayId) => setOverlay(id),
    chain: () => currentChain(),
    industry: (id: IndustryId) => { industry = id; ($<HTMLSelectElement>("industry")).value = id; industryNote(); inspect(); requestRender(); },
    next: (n = 1) => { for (let k = 0; k < n; k++) advanceTurn(game); afterTurn(); },
    found: (x: number, y: number, id: IndustryId = industry) => { const r = foundCompany(game, id, x, y); renderer.updateHeights(); afterChange(); return r; },
    library: () => { const r = fundLibrary(game); afterChange(); return r; },
    steps: () => { const r = buildSteps(game); afterChange(); return r; },
    incline: () => { const r = buildIncline(game); afterChange(); return r; },
    tech: (ids: string[]) => { if (game.company) { game.company.techs = ids; game.world.version++; afterChange(); } },
    tod: (v: string) => { ($<HTMLSelectElement>("tod")).value = v; requestRender(); },
    get pending() { return renderer.pending; },
    query: (x: number, y: number) => { if (!querying) setQuerying(true); selected = { x, y }; const [sx, sy] = tileScreen(x, y); showQuery(x, y, sx, sy); requestRender(); },
    get traffic() { return traffic; },
    /** place a test landmark of a kind at a named place (for checking sprites) */
    landmark: (kind: LandmarkKind, place: string) => { const r = placeLandmark(game, { id: `test-${kind}-${place}`, name: kind, kind, place }); renderer.invalidateAll(); afterChange(); return r; },
    /** fire an event's effects by name (for testing) */
    fire: (name: string) => { const fx = allEffects()[name]; if (fx) applyEffects(game, name, fx); const d = allDecisions()[name]?.(game); if (d) game.pendingDecision = d; afterChange(); return { effects: fx?.length ?? 0, decision: !!d }; },
    sound,
  },
});

start().catch((e) => {
  document.body.innerHTML = `<pre style="color:#e06a5a;padding:20px">${String(e?.stack ?? e)}</pre>`;
});
