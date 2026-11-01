import { companyWorth } from "./core/holdings";
import { distance, feet } from "./core/units";
import { advanceTurn, allWorks, buildIncline, buildSteps, cal, foundCompany, foundingCapital, fundLibrary, newGame, totalPopulation, type GameState } from "./core/game";
import { INDUSTRIES, industriesIn, type IndustryId } from "./core/industries";
import { loadMap, type GameMap } from "./core/map";
import { evaluateSite, footprintTiles, popSAT } from "./core/site";
import { ANCHORS } from "./core/ancestry";
import { type Camera, pickTile, project, ZOOMS } from "./render/iso";
import { Renderer } from "./render/renderer";
import { Traffic } from "./render/traffic";
import { drawHaze, drawSpills } from "./render/pollution";
import { SoundController, summarizeView } from "./audio";
import { HILLSIDES, latLonToTile } from "./core/features";
import { queryCard } from "./ui/query";
import { businessPanel, decisionCard, resetBusinessUi } from "./ui/business";
import { resetWorksUi, worksPanel, worksStatus } from "./ui/works";
import { trendsView } from "./ui/trends";
import { resetTownUi, townPanel } from "./ui/town";
import { holdingsPanel, resetHoldingsUi, sellDialog } from "./ui/holdings";
import { bizDef } from "./core/holdings";
import { riskRows, risks, shareAt } from "./ui/risks";
import { icon, METERS, type MeterKey, money as short } from "./ui/fx";
import { loadGame, newSaveId, saveGame } from "./core/save";
import { mainMenu, type NewGameOptions, simCard } from "./ui/menu";
import { laterStartGame, simulateSome } from "./core/autoplay";
import { lobbyInfluence, lobbySeasons, orderRoad, type RoadPlan, roadBlocked } from "./core/roads";
import { techStanding } from "./core/market";
import { districtPanel, zoneAt } from "./ui/district";
import { drawDistricts } from "./render/districts";
import { nameNow } from "./core/rivals";
import { type LandmarkKind, placeLandmark } from "./core/landmarks";
import { allDecisions, allEffects } from "./core/eventdata";
import { applyEffects } from "./core/effects";
import { buildProject, checkProject, PROJECTS, type ProjectKind, type Proposal, suggestProject } from "./core/projects";
import { isVectorOverlay, makeOverlay, overlayLegend, OVERLAYS, type OverlayCache, type OverlayId } from "./ui/overlays";
import { capacityOf, competitors, type Flow, playerWorks, supplyChain, type WorksRef } from "./core/economy";
import { drawRivals, drawSupply, FLOW_COLOUR, RELATION_COLOUR } from "./render/flows";
import { esc, fmt } from "./core/text";
import { Use } from "./core/town";
import { resetStruggleUi, struggleRisks, struggleView, successionCard } from "./ui/struggle";
import { DYNASTIES, legacy } from "./core/legacy";
import { FOUNDER_NAMES, fullName, PATHS, SURNAMES } from "./core/family";
import { topMarks, whoDid } from "./core/ledger";
import { stanceWord } from "./core/owners";
import { actionRows, wireActions } from "./ui/actions";
import { actRow, chip, costButton } from "./ui/fx";
import { buyStake, stakeBlocked, stakePrice } from "./core/holdings";

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
let soundWanted = (() => { try { return localStorage.getItem("mt.sound") !== "off"; } catch { return true; } })();
let siteTried: { x: number; y: number }[] = [];
/** flow or rival hovered in the side panel: drawn on top, the rest faded */
let focusId: string | null = null;
/** a building project waiting for the player to confirm (or move) it */
let proposal: Proposal | null = null;
/** a road being looked at before you pay for it (or lobby for it) */
let roadPreview: RoadPlan | null = null;

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
  traffic.occluded = (sx, sy, d) => renderer.occluded(sx, sy, d);
  traffic.worksTile = (i) => { const u = game?.world.use[i]; return u === Use.Industry || u === Use.Rival; };
  setupUI();
  resize();
  newTown(seed);
  showNews();
  homeView();
  // a seed in the address goes straight into that town (handy for testing); otherwise the main menu
  if (!params.get("seed")) openMenu(true);
}

/** the view a new town opens on: the Point */
function homeView() {
  const p = map.landmarks.find((l) => l.name.startsWith("The Point"))!;
  centerOn(p.x + 25, p.y + 15, 0.5);
}

/** clear everything that belongs to the town on screen: placing, open views, panel state, cached flows, traffic */
function resetUiState() {
  stopPlay();
  if (game) {
    proposal = null; roadPreview = null; placeBar();
    $("query").hidden = true;
    toggleTrends(false); toggleStruggle(false); openPaper(false);
    resetBusinessUi(); resetWorksUi(); resetTownUi(); resetHoldingsUi(); resetStruggleUi();
  }
  focusId = null; chainCache = null; hoverSite = null; nameEdited = false;
  traffic.reset();
}

/** show a game (new or loaded) */
function showGame(g: GameState) {
  game = g;
  { const sel = $<HTMLSelectElement>("industry"); sel.innerHTML = ""; if (!industriesIn(cal(g).year).includes(industry)) industry = "steel"; industryOptions(); }
  paperIdx = -1; paperSeen = 0;
  ($<HTMLInputElement>("seed")).value = String(g.seed);
  seedEdited = false;
  ($<HTMLInputElement>("companyName")).value = suggestName(industry, g.seed);
  ($<HTMLInputElement>("founderFirst")).value = FOUNDER_NAMES[g.seed % FOUNDER_NAMES.length];
  ($<HTMLInputElement>("founderLast")).value = SURNAMES[(g.seed * 7) % SURNAMES.length];
  setTab("overview");
  siteTried = [];
  placing = !g.company; ($<HTMLInputElement>("placing")).checked = placing;
  $("final").hidden = true;
  overlayCache.site = undefined;
  renderer.updateHeights();
  renderer.invalidateAll();
  selected = null;
  refreshPanels();
  drawMinimapBase();
  updateTimeControls();
  requestRender();
}

/** a later start: simulate the valley and the family from 1850, a few seasons per frame, then hand over */
function startLater(seed: number, o: NewGameOptions) {
  resetUiState();
  const founder = { first: o.first || FOUNDER_NAMES[seed % FOUNDER_NAMES.length], surname: o.surname || SURNAMES[(seed * 7) % SURNAMES.length] };
  const lo = { year: o.year, faction: o.faction, industry: o.industry, founder, name: `${founder.surname} & Co. ${INDUSTRIES[o.industry].name} Works` };
  simCard($("menu"), o.year, 1850, "Laying out the town…");
  setTimeout(() => {
    const g = laterStartGame(map, seed, lo);
    if (!g) { openMenu(true); return; }
    const step = () => {
      const t0 = performance.now();
      let done = false;
      while (!done && performance.now() - t0 < 120) done = simulateSome(g, lo, 1);
      const h = g.headlines[0];
      simCard($("menu"), o.year, cal(g).year, `${cal(g).season} ${cal(g).year}${h ? ` · ${h.name}` : ""}`);
      if (!done) { setTimeout(step, 0); return; }
      closeMenu();
      showGame(g);
      showNews();
      const c = g.company;
      if (c) centerOn(c.x + (c.footprint >> 1), c.y + (c.footprint >> 1), 0.5);
      autosave();
    };
    step();
  }, 30);
}

function newTown(seed: number) {
  resetUiState();
  showGame(newGame(map, seed));
}

// ---------------------------------------------------------------- saving and the main menu
let autosaving = false;
/** save to the autosave slot (only a game with a company is worth resuming) */
function autosave() {
  if (!game?.company || autosaving) return;
  autosaving = true;
  saveGame(game).catch((e) => console.warn("autosave failed", e)).finally(() => { autosaving = false; });
}

function openMenu(atStart = false, saved = false, view: "main" | "load" = "main") {
  if (!atStart && !saved) autosave();
  mainMenu($("menu"), {
    inGame: !atStart,
    saved,
    onSave: saveNamed,
    onResume: () => closeMenu(),
    onNew: (seed, later) => {
      const s = seed ?? Math.floor(Math.random() * 1e6);
      if (later) { startLater(s, later); return; }
      closeMenu(); newTown(s); showNews(); homeView();
    },
    onLoad: async (id) => {
      const g = await loadGame(id, map);
      resetUiState();
      showGame(g);
      showNews();
      if (g.company) centerOn(g.company.x + (g.company.footprint >> 1), g.company.y + (g.company.footprint >> 1), 0.75); else homeView();
      closeMenu();
      if (g.over) showFinal();
    },
  }, view);
}
function closeMenu() { $("menu").hidden = true; }

/** a short note at the bottom of the map ("Saved") */
let toastT = 0;
function toast(text: string) {
  const el = $("toast");
  el.textContent = text; el.hidden = false;
  clearTimeout(toastT);
  toastT = window.setTimeout(() => { el.hidden = true; }, 2200);
}

/** save under a new name (☰ → Save game, Ctrl+S, or from the main menu) */
async function saveNamed(): Promise<boolean> {
  if (!game.company) { toast("Found a company first: there's nothing to save yet."); return false; }
  toast("Saving…");
  try { const m = await saveGame(game, newSaveId()); toast(`Saved: ${m.company} — ${m.season} ${m.year}`); return true; }
  catch (e) { toast("Couldn't save the game"); console.warn(e); return false; }
}

/** save the game and go to the main menu */
async function saveAndExit() {
  $("gameDrop").hidden = true;
  stopPlay();
  if (game.company) {
    toast("Saving…");
    try { await saveGame(game); toast("Game saved"); } catch (e) { toast("Couldn't save the game"); console.warn(e); }
  }
  openMenu(false, true);
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
    if (cam.zoom >= 0.25) renderer.drawMemorials(ctx, cam, game);
    drawRoadPreview();
    if (anim && !ovOn) traffic.draw(ctx, cam, game, t, night);
    if (game.world.inclines.length && cam.zoom >= 0.25) renderer.drawInclines(ctx, cam, game, anim ? t : 0);
    if (!ovOn) drawHaze(ctx, game, cam, canvas.width, canvas.height, anim ? t : 0);
    if (anim || night > 0) renderer.drawAnimated(ctx, cam, game, anim ? t : 0, night);
    if (anim && !ovOn && night > 0.02) traffic.drawLights(ctx, cam, night); // lamps over the night tint, at full strength
    if (($<HTMLInputElement>("labels")).checked) renderer.drawLabels(ctx, cam, game, reservedRects());
    drawHoldings();
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
    if (more || animating() || roadPreview) requestRender();
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
  return ["zoomButtons", "minimap", "zoom", "mapTools", "headline"].map((id) => {
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
  if (game && staleTabs.has(tab)) renderTab(tab);
}
const currentTab = () => $("right").dataset.tab ?? "overview";
/** tabs whose content is out of date: hidden tabs are rebuilt only when shown (a season rebuilt all six) */
const staleTabs = new Set<string>();
function renderTab(tab: string) {
  staleTabs.delete(tab);
  switch (tab) {
    case "overview": siteReport(); overviewPanel(); break;
    case "works": worksPanel(game, $("works"), () => { afterChange(); }, startPlacing); break;
    case "policy": businessPanel(game, $("biz"), () => { afterChange(); }); break;
    case "holdings": holdingsPanel(game, $("holdings"), () => { afterChange(); }, goTo, () => openDialog(true)); break;
    case "town": townPanel(game, $("town"), () => { afterChange(); }, goTo, startRoad); break;
    case "rivals": rivalsPanel(); break;
  }
}

/** a company name of the period for the industry, different each town ("Lyon, Shorb & Co. Iron Works") */
function suggestName(ind: IndustryId, seed: number): string {
  const S = ["Shoenberger", "Lyon", "Bakewell", "Zug", "Painter", "Moorhead", "McKnight", "Singer", "Spang", "Graff", "Hussey", "Lewis", "Wood", "Brown", "Park", "Oliver", "Byers", "Laughlin", "Shorb", "Black", "Everson"];
  const a = S[Math.abs(seed) % S.length], b = S[(Math.abs(seed) * 7 + 3) % S.length];
  const tail = { steel: "Iron Works", glass: "Glass Works", power: "Gas Light Company", metalworks: "Boat & Engine Works", aluminium: "Reduction Company", chemicals: "Chemical Company", research: "Research Laboratories", nuclear: "Atomic Laboratories", medicine: "Medical Center" }[ind];
  return (seed % 3 === 0 && a !== b ? `${a}, ${b} & Co.` : seed % 3 === 1 ? `${a} Brothers` : `${a} & Co.`) + ` ${tail}`;
}
function row(k: string, v: string, cls = "") {
  return `<div class="k">${k}</div><div class="v ${cls}">${v}</div>`;
}

const PAPERS = ["Pittsburgh Gazette", "Pittsburgh Dispatch", "Pittsburgh Press", "Pittsburgh Post-Gazette"];
/** which issue of the paper is shown (the archive is game.news, newest last) */
let paperIdx = -1, paperSeen = 0;
let paperTab: "paper" | "ledger" = "paper";
/** When a new issue comes out: show its first story in the headline strip, and the issue in the paper. */
function showNews() {
  if (game.news.length !== paperSeen) {
    paperSeen = game.news.length;
    paperIdx = game.news.length - 1;
    newsAt = performance.now();
  }
  renderHeadline();
  renderPaper();
}

function renderHeadline() {
  const el = $("headline");
  const issue = game.news[game.news.length - 1];
  if (!issue) { el.hidden = true; return; }
  const fresh = issue.turn === game.turn;
  const it = issue.items[0];
  el.hidden = !$("paper").hidden;
  el.classList.toggle("fresh", fresh);
  el.innerHTML = `<span class="hl-kick">${fresh ? esc(it.category) : `${cal({ ...game, turn: issue.turn }).season} ${cal({ ...game, turn: issue.turn }).year}`}</span><span class="hl-head">${esc(it.name)}</span><span class="hl-more">${issue.items.length > 1 ? `+${issue.items.length - 1} more · ` : ""}Read ▸</span>`;
}

function renderPaper() {
  const el = $("news");
  for (const b of document.querySelectorAll<HTMLButtonElement>("#paper [data-pp]")) b.classList.toggle("on", b.dataset.pp === paperTab);
  el.hidden = paperTab !== "paper";
  $("log").hidden = paperTab !== "ledger";
  $("paperNav").hidden = paperTab !== "paper";
  const issue = game.news[paperIdx];
  const n = game.news.length;
  $("paperNav").innerHTML = n ? `<button data-p="-1" ${paperIdx <= 0 ? "disabled" : ""} title="Older issue">◀</button><span>${paperIdx + 1}/${n}</span><button data-p="1" ${paperIdx >= n - 1 ? "disabled" : ""} title="Newer issue">▶</button>` : "";
  if (!issue) { el.innerHTML = `<p class="none">No news yet.</p>`; return; }
  const c = cal({ ...game, turn: issue.turn });
  const paper = PAPERS[c.year < 1880 ? 0 : c.year < 1920 ? 1 : c.year < 1927 ? 2 : 3];
  el.innerHTML = `<div class="mast"><span>${paper}</span><span>${c.season} ${c.year}</span></div>` +
    issue.items.map((e) => `<div class="kicker">${e.category}</div><h3>${esc(e.name)}</h3><p>${esc(e.description)}</p>`).join("");
  el.scrollTop = 0;
}

let paperRead = 0;
function openPaper(open: boolean) {
  $("paper").hidden = !open;
  $("paperBtn").classList.toggle("on", open);
  if (open) { paperIdx = game.news.length - 1; paperRead = game.news.length; renderPaper(); }
  $("paperCount").textContent = "";
  renderHeadline();
}

/** the sell-or-list dialog (Money tab) */
function openDialog(open: boolean) {
  const el = $("dialog");
  if (!open) { el.hidden = true; return; }
  sellDialog(game, el, () => afterChange(), () => openDialog(false));
}

/** a meter for the top bar: icon, number, and a small bar (signed meters run from the middle) */
function meterTop(k: MeterKey, v: number, signed: boolean, word: string) {
  const col = !signed ? "#c8a040" : v >= 0 ? "#5aa860" : "#c8503a";
  const bar = signed ? `<b style="left:${Math.min(50, (v + 100) / 2)}%;width:${Math.abs(v) / 2}%;background:${col}"></b><i class="mid"></i>` : `<b style="left:0;width:${Math.max(2, v)}%;background:${col}"></b>`;
  return `<div class="meter" title="${METERS[k].name}: ${Math.round(v)} · ${word}\n${METERS[k].tip}">${icon(k)}<span class="m-name">${METERS[k].name}</span><b class="${signed ? (v >= 0 ? "up" : "down") : ""}">${signed && v > 0 ? "+" : ""}${Math.round(v)}</b><span class="mbar">${bar}</span></div>`;
}

function refreshPanels() {
  const c = cal(game), co = game.company;
  $("calendar").innerHTML = `<small>Era ${c.era.id}</small><b>${c.season} ${c.year}</b>`;
  $("calendar").title = `Era ${c.era.id}: ${c.era.name}`;
  const p = co?.totals?.profit;
  $("cash").innerHTML = co ? `<small>Cash</small><b class="${co.cash < 0 ? "down" : ""}">${short(co.cash)}${p !== undefined ? ` <span class="pf ${p >= 0 ? "up" : "down"}">${p >= 0 ? "▲" : "▼"} ${short(Math.abs(p))}</span>` : ""}</b>` : `<small>To found a works</small><b>${short(foundingCapital(industry, cal(game).year))}</b>`;
  $("cash").title = co ? `Cash${p !== undefined ? ` · last season ${p >= 0 ? "made" : "lost"} ${short(Math.abs(p))}` : ""}` : "The family's capital";
  const unread = game.news.length - paperRead;
  $("paperCount").textContent = unread > 0 && $("paper").hidden ? ` ${unread > 9 ? "9+" : unread}` : "";
  const bz = co?.biz.meters, mo = Math.round(game.morale);
  const W = { rep: (v: number) => (v < -50 ? "reviled" : v < -20 ? "distrusted" : v < 15 ? "unremarkable" : v < 45 ? "respected" : "admired"), lab: (v: number) => (v < -50 ? "hostile" : v < -20 ? "bitter" : v < 15 ? "uneasy" : v < 45 ? "steady" : "loyal"), inf: (v: number) => (v < 10 ? "none to speak of" : v < 30 ? "a friend at City Hall" : v < 60 ? "heard in Harrisburg" : "heard in Washington") };
  $("standing").innerHTML = (bz ? meterTop("reputation", bz.reputation, true, W.rep(bz.reputation)) + meterTop("labour", bz.labour, true, W.lab(bz.labour)) + meterTop("influence", bz.influence, false, W.inf(bz.influence)) : "") +
    meterTop("morale", mo, false, mo < 25 ? "despairing" : mo < 40 ? "low" : mo < 60 ? "steady" : mo < 75 ? "proud" : "jubilant");
  for (const id of ["worksEmpty", "policyEmpty"]) $(id).hidden = !!co;
  // only the open tab is rebuilt now; the others when they are next shown
  for (const t of ["overview", "works", "policy", "holdings", "town", "rivals"]) staleTabs.add(t);
  renderTab(currentTab());
  if (!$("dialog").hidden) openDialog(true);
  decisionCard(game, $("decision"), () => { afterChange(); });
  successionCard(game, $("succession"), () => { afterChange(); });
  if (!$("struggle").hidden) struggleView(game, $("struggle"), () => afterChange(), () => toggleStruggle(false));
  supplyPanel();
  $("legend").innerHTML = overlayLegend(overlay, game);
  showNews();
  $("log").innerHTML = game.log.slice(-60).reverse().map((l) => {
    const lc = cal({ ...game, turn: l.turn });
    return `<li><span>${lc.season.slice(0, 3)} ${lc.year}</span> ${esc(l.text)}</li>`;
  }).join("");
}

/** before founding: the site report for the selected tile and the chosen industry */
function siteReport() {
  const show = !game.company;
  $("foundSection").hidden = !show;
  if (!show) return;
  const site = $("site");
  if (!selected) { site.hidden = true; $("siteHint").hidden = false; ($<HTMLButtonElement>("found")).disabled = true; return; }
  const rep = evaluateSite(map, game.world, game.fields, industry, selected.x, selected.y);
  site.hidden = false; $("siteHint").hidden = true;
  site.innerHTML = [
    row("Score", `${rep.score} / 100`, rep.ok ? "good" : "bad"),
    row("Cost", money(rep.cost), rep.cost > foundingCapital(industry, cal(game).year) ? "bad" : ""),
    row("Men nearby", fmt(rep.labor)),
    row("River", rep.riverM > 60000 ? "—" : distance(rep.riverM)),
    rep.ok ? "" : `<div class="full bad">${rep.reasons.join(" · ")}</div>`,
  ].join("");
  site.title = rep.reasons.join(" · ");
  ($<HTMLButtonElement>("found")).disabled = !rep.ok || rep.cost > foundingCapital(industry, cal(game).year);
}

/** what the works is now, from its newest process ("Bessemer steel", not 1850's "iron furnace" in 1985) */
function businessNow(c: { industry: IndustryId; techs: string[] }): string {
  const ind = INDUSTRIES[c.industry];
  const newest = [...ind.tech].reverse().find((t) => c.techs.includes(t.id) && t.cost > 0);
  return newest ? `${ind.name} · ${newest.name.toLowerCase()}` : ind.startsAs;
}

const spark = (vals: (number | undefined)[], col: string) => {
  const v = vals.filter((x): x is number => x !== undefined && isFinite(x));
  if (v.length < 3) return "";
  const lo = Math.min(...v), hi = Math.max(...v), w = 100, h = 18;
  const pts = v.map((x, k) => `${((k / (v.length - 1)) * w).toFixed(1)},${(h - 1 - ((x - lo) / (hi - lo || 1)) * (h - 2)).toFixed(1)}`).join(" ");
  return `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none"><polyline points="${pts}" fill="none" stroke="${col}" stroke-width="1.3" vector-effect="non-scaling-stroke"/></svg>`;
};

/** the Overview tab: the company's numbers at a glance, what to watch, last season's accounts */
let watchAll = false;
function overviewPanel() {
  const c = game.company, el = $("overview");
  if (!c) { el.innerHTML = ""; return; }
  const s = c.totals ?? c.lastSeason;
  const status = c.bankrupt ? "In receivership" : c.status === "running" ? "Running" : c.status === "strike" ? "On strike" : c.status === "flooded" ? "Flooded" : c.status === "lockout" ? "Locked out" : "Idle";
  const hist = game.prices.slice(-40);
  const now = game.prices[game.prices.length - 1];
  const then = game.prices.find((p) => cal({ ...game, turn: p.turn }).year >= cal(game).year - 10 && p.prodInd?.[c.industry]);
  const sh = now ? shareAt(now, c.industry) : undefined, sh0 = then && then !== now ? shareAt(then, c.industry) : undefined;
  const price = now?.yours[c.industry] ?? now?.market[c.industry], uc = now?.unitCost;
  const cap = now?.capacity ?? 0;
  const st = techStanding(game, c);
  const card = (k: string, v: string, sub: string, cls = "") => `<div class="card"><small>${k}</small><b class="${cls}">${v}</b>${sub}</div>`;
  const list = [...struggleRisks(game), ...risks(game)].sort((a, b) => ({ bad: 0, warn: 1, good: 2 }[a.level] - { bad: 0, warn: 1, good: 2 }[b.level]));
  el.innerHTML = `
    <div class="ov-name"><b title="${esc(businessNow(c))}">${esc(c.name)}</b><span class="${c.status === "running" && !c.bankrupt ? "up" : "down"}">● ${status}</span></div>
    <div class="cards">
      ${(() => { const nw = companyWorth(game); return card("Net worth", short(nw.total), spark(hist.map((p) => p.worth ?? p.cash), "#7cc87c") + `<em>works ${short(nw.works)} · cash ${short(nw.cash)}</em>`, nw.total < 0 ? "down" : ""); })()}
      ${card("Output", s ? fmt(s.produced) : "—", `<em>of ${fmt(cap)}${cap && s ? ` · ${Math.round((s.produced / cap) * 100)}% used` : ""}${sh !== undefined ? ` · ${Math.round(sh * 100)}% of the industry` : ""}</em>`)}
      ${card("Margin", uc && price ? `${Math.round((1 - uc / price) * 100)}%` : "—", `<em>${price ? `$${price.toFixed(2)} a unit · cost ${uc ? `$${uc.toFixed(2)}` : "—"}` : ""}${st.factor !== 1 ? ` · <span class="down">${st.factor > 1 ? "+" : "−"}${Math.round(Math.abs(st.factor - 1) * 100)}% vs rivals</span>` : ""}</em>`, uc && price && uc > price ? "down" : "")}
      ${(() => { const mk = game.markets?.[c.industry], stock = allWorks(c).reduce((s2, w) => s2 + (w.stock ?? 0), 0);
        if (!mk) return card("Market share", sh !== undefined ? `${Math.round(sh * 100)}%` : "—", sh !== undefined && sh0 !== undefined ? `<em><span class="${sh >= sh0 ? "up" : "down"}">${sh >= sh0 ? "▲" : "▼"}</span> ${Math.round(sh0 * 100)}% ten years ago</em>` : "<em>of the industry's output</em>");
        const glut = mk.supply > mk.demand, gap = Math.round(Math.abs(mk.supply / Math.max(1, mk.demand) - 1) * 100);
        return card("Market", gap < 3 ? "Balanced" : glut ? "Glut" : "Short", `<em>${gap < 3 ? "supply meets demand" : glut ? `${gap}% more made than wanted` : `${gap}% more wanted than made`} · price ${mk.price >= 1 ? "+" : "−"}${Math.abs(Math.round((mk.price - 1) * 100))}%${stock ? ` · ${fmt(stock)} in the yards` : ""}</em>`, gap < 3 ? "" : glut ? "down" : "up"); })()}
    </div>
    <h4 class="mh">Watch <button class="link" id="ovTrends">Trends ▸</button></h4>
    <div class="risks">${riskRows(watchAll ? list : list.slice(0, 5))}</div>${list.length > 5 ? `<button class="link more" id="watchAll">${watchAll ? "Show fewer" : `Show all (${list.length})`}</button>` : ""}
    ${s ? `<h4 class="mh">Last season${c.others.length ? " · all works" : ""}</h4>
    <div class="pl">
      ${([["Revenue", s.revenue, "#7ac8e0"], ["Raw materials", -s.inputCost, "#e07a64"], ["Wages", -s.wages, "#e07a64"], ["Upkeep", -s.upkeep, "#e07a64"], ...(s.other ? [["Other", -s.other, s.other > 0 ? "#e07a64" : "#7cc87c"]] : []), ...(c.totals?.holdings ? [["Holdings", c.totals.holdings, "#7cc87c"]] : [])] as [string, number, string][])
        .map(([k, v, col]) => `<span class="k">${k}</span><span class="bar"><b style="width:${s.revenue ? Math.min(100, (Math.abs(v) / s.revenue) * 100) : 0}%;background:${col}"></b></span><span class="v">${short(v)}</span>`).join("")}
      <span class="k tot">Profit</span><span class="tot"></span><span class="v tot ${s.profit < 0 ? "down" : "up"}">${short(s.profit)}</span>
    </div>
    <div class="kv mt">
      <div class="k">Men</div><div class="v">${fmt(c.lastSeason?.workersHired ?? 0)} / ${fmt(c.lastSeason?.workersWanted ?? 0)}</div>
      <div class="k">Health · unrest</div><div class="v"><span class="${c.health < 0.7 ? "bad" : ""}">${Math.round(c.health * 100)}%</span> · <span class="${c.unrest >= 0.35 ? "bad" : ""}">${c.unrest < 0.2 ? "quiet" : c.unrest < 0.35 ? "grumbling" : c.unrest < 0.5 ? "restless" : "angry"}</span></div>
      ${c.debt ? `<div class="k">Owed to the bank</div><div class="v bad">${short(c.debt)}</div>` : ""}
    </div>
    ${c.lastSeason?.notes.length ? `<p class="hint">${c.lastSeason.notes.map(esc).join(" ")}</p>` : ""}` : ""}`;
  $("ovTrends").addEventListener("click", () => toggleTrends(true));
  document.getElementById("watchAll")?.addEventListener("click", () => { watchAll = !watchAll; overviewPanel(); });
  el.querySelectorAll<HTMLButtonElement>("button[data-go]").forEach((b) => b.addEventListener("click", () => (b.dataset.go === "struggle" ? toggleStruggle(true) : setTab(b.dataset.go!))));
}

const KIND_TITLE: Record<Flow["kind"], string> = { input: "In", utilityIn: "Utilities in", utilityOut: "Your customers", output: "Out" };
/** the supply chain, shown under the map legend when its layer is on: each product once, its partners beneath */
function supplyPanel() {
  const sc = game.company && overlay === "supply" ? currentChain() : null;
  $("supply").hidden = !sc;
  if (!sc) { $("supply").innerHTML = ""; return; }
  const groups = (["input", "utilityIn", "utilityOut", "output"] as const).map((k) => {
    const byGood = new Map<string, Flow[]>();
    for (const f of sc.flows.filter((x) => x.kind === k)) byGood.set(f.good, [...(byGood.get(f.good) ?? []), f]);
    return [k, [...byGood.values()]] as const;
  }).filter(([, fl]) => fl.length);
  $("supply").innerHTML = groups.map(([k, goods]) => `<div class="sc-head">${KIND_TITLE[k]}</div>` + goods.map((fl) => {
    const f = fl.reduce((a, b) => (b.qty > a.qty ? b : a));
    const qty = fl.reduce((t, x) => t + x.qty, 0), value = fl.reduce((t, x) => t + x.value, 0), share = fl.reduce((t, x) => t + x.share, 0);
    const end = f.kind === "input" || f.kind === "utilityIn" ? f.from : f.to;
    const partners = [...new Set(fl.map((x) => x.partner))];
    return `<div class="sc-row" data-flow="${f.id}" data-x="${end.x}" data-y="${end.y}" title="${esc(fl.map((x) => `${x.partner} · ${x.via}`).join("\n"))} — click to show on the map">
      <div class="sc-top"><i style="background:${FLOW_COLOUR(f)}"></i><b>${f.good}</b><span>${qty ? `${fmt(qty)}/season` : ""}${value ? ` · ${short(value)}` : ""}</span></div>
      ${qty ? `<div class="sc-bar"><div style="width:${Math.max(3, Math.min(1, share) * 100)}%;background:${FLOW_COLOUR(f)}"></div></div>` : ""}
      <div class="sc-sub">${partners.length > 2 ? `${esc(partners[0])} and ${partners.length - 1} more` : partners.map(esc).join(" · ")}</div>
    </div>`;
  }).join("")).join("");
}

let rivalMenu: string | null = null, rivalStatus = "";
const rivalFolds = new Set<string>();
function rivalsPanel() {
  const mine = playerWorks(game);
  const ind = mine?.industry ?? industry;
  const list = competitors(game, ind, mine ? { x: mine.x + mine.fp / 2, y: mine.y + mine.fp / 2 } : undefined);
  const direct = list.filter((c) => c.relation === "competitor");
  const open = direct.filter((c) => c.state && !c.state.closed && !c.owned);
  const myOut = game.company ? allWorks(game.company).filter((w) => w.industry === ind).reduce((t, w) => t + (w.lastSeason?.produced ?? 0), 0) : 0;
  const total = myOut + open.reduce((s, c) => s + c.capacity, 0);
  const top = Math.max(myOut, ...open.map((c) => c.capacity), 1);
  const name = (c: (typeof list)[number]) => plantName(nameNow(c.def, game.world.year, c.state?.name, c.state?.nameYear));
  const tip = (c: (typeof list)[number]) => esc(`${c.def.figures.join(" & ")} — ${c.def.note}${c.state?.damage.length ? `\nHurt: ${c.state.damage.map((d) => `${d.why} (−${Math.round((1 - d.mult) * 100)}%)`).join(", ")}` : ""}`);
  const menu = (id: string) => {
    if (!game.company) return "";
    const { rows } = actionRows(game, (a) => !!a.target, id);
    const sw = stakeBlocked(game, id);
    const stake = actRow("Buy a 10% stake", costButton(`data-stakeriv="${id}"`, stakePrice(game, id), sw), chip("a share of its profit", "good"), "10% buys a share of its profit; at 20% its owners leave you alone; at 50% you can buy the rest.");
    return `<div class="riv-menu">${rows.join("")}${stake}</div>`;
  };
  const row2 = (c: (typeof list)[number]) => `
    <div class="sc-row riv${rivalMenu === c.def.id ? " open" : ""}" data-rival="${c.def.id}" title="${tip(c)}">
      <div class="sc-top"><b>${esc(name(c))}</b><span>${fmt(c.capacity)}</span>${game.company ? `<button class="dots" data-rmenu="${c.def.id}" title="Moves against this works">⋯</button>` : ""}</div>
      <div class="sc-bar"><div style="width:${(c.capacity / top) * 100}%;background:${RELATION_COLOUR.competitor}"></div></div>
      <div class="sc-sub">${c.state && game.company ? `<span class="${(c.state.stance ?? 0) <= -15 ? "bad" : (c.state.stance ?? 0) >= 25 ? "good" : ""}">${stanceWord(c.state.stance)}</span> · ` : ""}${c.near}${c.km !== undefined ? ` · ${distance(c.km * 1000)}` : ""}${c.state?.lastMove ? ` · ${esc(c.state.lastMove.replace(/^\d{4}: /, ""))}` : ""}${c.state?.damage.length ? ` · <span class="bad">hurt</span>` : ""}</div>
      ${c.state?.intent ? `<div class="sc-sub st-intent">${esc(c.state.intent.text)}</div>` : ""}
    </div>${rivalMenu === c.def.id ? menu(c.def.id) : ""}`;
  const coming = direct.filter((c) => !c.state && c.def.entryYear > game.world.year);
  const closed = direct.filter((c) => c.state?.closed);
  const others = list.filter((c) => c.relation !== "competitor" && c.state && !c.state.closed);
  const label: Record<string, string> = { supplier: "Supplier", customer: "Customer", lender: "Bank", other: "" };
  const fold = (k: string, title: string, n: number, body: string) => n ? `<h4 class="mh hd-sec" data-rfold="${k}">${rivalFolds.has(k) ? "▾" : "▸"} ${title}<span>${n}</span></h4>${rivalFolds.has(k) ? body : ""}` : "";
  const rejoin = game.company ? actionRows(game, (a) => a.id === "rejoin").rows.join("") : "";
  $("rivalsList").innerHTML = `
    ${rivalStatus ? `<div class="bz-status">${esc(rivalStatus)}</div>` : ""}
    ${rejoin}
    <h4 class="mh">${INDUSTRIES[ind].name}${mine ? "" : " (if you found here)"}${mine && total ? `<span>${Math.round((myOut / total) * 100)}% yours</span>` : ""}</h4>
    ${mine && total ? `<div class="ms-bar">${[{ n: "You", v: myOut, c: "#ffd34a" }, ...open.map((c) => ({ n: name(c), v: c.capacity, c: RELATION_COLOUR.competitor }))].map((p, k) => `<div title="${esc(p.n)}: ${fmt(p.v)}/season" style="width:${(p.v / total) * 100}%;background:${p.c};opacity:${k ? Math.max(0.35, 1 - k * 0.1) : 1}"></div>`).join("")}</div>` : ""}
    ${mine ? `<div class="sc-row riv you"><div class="sc-top"><b>You</b><span>${fmt(myOut)}</span></div><div class="sc-bar"><div style="width:${(myOut / top) * 100}%;background:#ffd34a"></div></div></div>` : ""}
    ${open.map(row2).join("") || `<p class="hint">No rival works open yet.</p>`}
    ${list.filter((c) => c.owned).map((c) => `<div class="sc-row"><div class="sc-top"><b>${esc(name(c))}</b><span class="owned">yours</span></div></div>`).join("")}
    <p class="hint">Output per season. Hover for the owners; click to find it on the map; ⋯ for moves against it.</p>
    ${fold("coming", "Coming", coming.length, coming.map((c) => `<div class="sc-row later" data-rival="${c.def.id}" title="${tip(c)}"><div class="sc-top"><b>${esc(name(c))}</b><span>${c.def.entryYear}</span></div></div>`).join(""))}
    ${fold("closed", "Closed", closed.length, closed.map((c) => `<div class="sc-row later" title="${tip(c)}"><div class="sc-top"><b>${esc(name(c))}</b></div></div>`).join(""))}
    ${fold("others", "Suppliers, customers, bank", others.length, others.map((c) => `<div class="sc-row" data-rival="${c.def.id}" title="${tip(c)}"><div class="sc-top"><b>${esc(name(c))}</b><span>${label[c.relation]}</span></div></div>`).join(""))}`;
  const el = $("rivalsList");
  el.querySelectorAll<HTMLButtonElement>("button[data-rmenu]").forEach((b) => b.addEventListener("click", (e) => { e.stopPropagation(); rivalMenu = rivalMenu === b.dataset.rmenu ? null : b.dataset.rmenu!; rivalsPanel(); }));
  el.querySelectorAll<HTMLElement>("[data-rfold]").forEach((h) => h.addEventListener("click", () => { const k = h.dataset.rfold!; if (rivalFolds.has(k)) rivalFolds.delete(k); else rivalFolds.add(k); rivalsPanel(); }));
  el.querySelectorAll<HTMLButtonElement>("button[data-stakeriv]").forEach((b) => b.addEventListener("click", (e) => { e.stopPropagation(); rivalStatus = buyStake(game, b.dataset.stakeriv!).text; afterChange(); }));
  wireActions(el, game, (t) => { rivalStatus = t; afterChange(); });
}

function setOverlay(id: OverlayId) {
  (document.querySelector(`input[name="overlay"][value="${id}"]`) as HTMLInputElement | null)?.click();
}

// ---------------------------------------------------------------- UI wiring
function setupUI() {
  // map layers: chips grouped Land / Town / Business / Best sites, behind the Map button
  // "Best sites" is one layer with an industry picker
  const siteDef = OVERLAYS.find((o) => o.group === "Best sites")!;
  $("overlays").innerHTML = (["Land", "Town", "Business"] as const).map((grp) => `<div class="ov-group">${grp}</div><div class="chips">` + OVERLAYS.filter((o) => o.group === grp).map((o) =>
    `<label class="chip ov" title="${o.title ?? o.label}"><input type="radio" name="overlay" value="${o.id}" ${o.id === overlay ? "checked" : ""}/>${o.swatch ? `<span class="ov-sw" style="background:${o.swatch}"></span>` : ""}${o.label}</label>`).join("")
    + (grp === "Business" ? `<label class="chip ov" title="Where a new works would do best"><input type="radio" name="overlay" id="siteRadio" value="site:${industry}"/><span class="ov-sw" style="background:${siteDef.swatch}"></span>Best sites</label><select id="siteInd" title="Best sites for which industry">${(Object.keys(INDUSTRIES) as IndustryId[]).map((k) => `<option value="${k}"${k === industry ? " selected" : ""}>${INDUSTRIES[k].name}</option>`).join("")}</select>` : "") + `</div>`).join("");
  $("siteInd").addEventListener("change", (e) => {
    const v = (e.target as HTMLSelectElement).value;
    $<HTMLInputElement>("siteRadio").value = `site:${v}`;
    if (overlay.startsWith("site:")) applyOverlay(`site:${v}` as OverlayId);
  });
  $("overlays").addEventListener("change", (e) => {
    const t = e.target as HTMLInputElement;
    if (t.name === "overlay") applyOverlay(t.value as OverlayId);
  });
  const applyOverlay = (id: OverlayId) => {
    overlay = id;
    focusId = null;
    const def = OVERLAYS.find((o) => o.id === overlay)!;
    $("layerName").textContent = def.group === "Best sites" ? `Best sites: ${def.label}` : def.label;
    $("layerBtn").classList.toggle("on", overlay !== "none");
    $("legend").innerHTML = overlayLegend(overlay, game);
    $("legendBox").hidden = overlay === "none";
    supplyPanel();
    $("legendBox").querySelector(".lg-close")?.remove();
    if (overlay !== "none") $("legendBox").insertAdjacentHTML("afterbegin", `<button class="lg-close" title="Back to the town">✕</button>`);
    if (overlay.startsWith("site:")) { industry = overlay.slice(5) as IndustryId; ($<HTMLSelectElement>("industry")).value = industry; ($<HTMLSelectElement>("siteInd")).value = industry; ($<HTMLInputElement>("siteRadio")).value = overlay; ($<HTMLInputElement>("siteRadio")).checked = true; industryNote(); }
    siteReport();
    requestRender();
  };
  $("layerBtn").addEventListener("click", (e) => { e.stopPropagation(); $("layerMenu").hidden = !$("layerMenu").hidden; });
  // a layer chip clicked again turns that layer off: back to the town
  $("overlays").addEventListener("click", (e) => {
    const input = (e.target as HTMLElement).closest("label.chip")?.querySelector<HTMLInputElement>("input[name=overlay]");
    if (!input || input.value === "none" || input.value !== overlay) return;
    e.preventDefault();
    setOverlay("none");
  });
  $("legendBox").addEventListener("click", (e) => { if ((e.target as HTMLElement).closest(".lg-close")) setOverlay("none"); });
  document.addEventListener("click", (e) => { if (!(e.target as HTMLElement).closest("#mapTools")) $("layerMenu").hidden = true; });
  // the headline strip opens the paper; the paper has a ledger tab (the log)
  $("headline").addEventListener("click", () => openPaper(true));
  $("paper").addEventListener("click", (e) => {
    const t = e.target as HTMLElement;
    if (t.closest(".pp-close")) { openPaper(false); return; }
    const tb = t.closest<HTMLButtonElement>("button[data-pp]");
    if (tb) { paperTab = tb.dataset.pp as typeof paperTab; renderPaper(); }
  });
  $("trendsBtn").addEventListener("click", () => toggleTrends());
  const sel = $<HTMLSelectElement>("industry");
  sel.innerHTML = industriesIn(1850).map((k) => `<option value="${k}">${INDUSTRIES[k].name}</option>`).join("");
  sel.addEventListener("change", () => { industry = sel.value as IndustryId; industryNote(); siteReport(); rivalsPanel(); requestRender(); });
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
      if ((e.target as HTMLElement).closest("button, select, .riv-menu")) return;
      const row = (e.target as HTMLElement).closest<HTMLElement>(".sc-row");
      if (!row || !row.dataset[attr]) return;
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
  $<HTMLInputElement>("placing").addEventListener("change", (e) => { placing = (e.target as HTMLInputElement).checked; requestRender(); });
  for (const id of ["labels", "grid", "animate", "tod"]) $(id).addEventListener("change", () => requestRender());
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
  $("soundTop").addEventListener("click", (e) => { e.stopPropagation(); toggleSound(); });
  const wake = (e: Event) => {
    if (e instanceof KeyboardEvent && e.key.toLowerCase() === "m") return; // the M key toggles instead
    if (soundWanted && !sound.running) sound.start().then(() => { soundUI(); updateSound(); });
  };
  for (const ev of ["pointerdown", "click", "keydown"]) window.addEventListener(ev, wake, true);
  window.addEventListener("keydown", (e) => {
    if (inFormControl(e)) return;
    if (e.key.toLowerCase() === "m" && $("menu").hidden) toggleSound();
  });
  sound.onState = soundUI;
  soundUI();
  const vols = () => sound.setVolumes(Number(($<HTMLInputElement>("musicVol")).value), Number(($<HTMLInputElement>("ambVol")).value));
  $("musicVol").addEventListener("input", vols); $("ambVol").addEventListener("input", vols);
  setInterval(updateSound, 500);
  $("found").addEventListener("click", () => {
    if (!selected) return;
    const name = ($<HTMLInputElement>("companyName")).value.trim() || suggestName(industry, game.seed);
    const first = ($<HTMLInputElement>("founderFirst")).value.trim() || FOUNDER_NAMES[game.seed % FOUNDER_NAMES.length];
    const last = ($<HTMLInputElement>("founderLast")).value.trim() || SURNAMES[(game.seed * 7) % SURNAMES.length];
    const r = foundCompany(game, industry, selected.x, selected.y, name, { first, surname: last });
    if (!r.ok) game.log.push({ turn: game.turn, text: r.reason! });
    placing = false; ($<HTMLInputElement>("placing")).checked = false;
    if (r.ok) { selected = null; hover = null; setTab("overview"); }
    renderer.updateHeights();
    afterChange();
  });
  $("next").addEventListener("click", (e) => { if (e.shiftKey) nextYear(); else nextSeason(); });
  $("paperBtn").addEventListener("click", () => openPaper($("paper").hidden === true));
  $("struggleBtn").addEventListener("click", () => toggleStruggle());
  window.addEventListener("keydown", (e) => { if (!inFormControl(e) && !e.ctrlKey && !e.metaKey && e.key.toLowerCase() === "s" && $("menu").hidden) toggleStruggle(); });
  $("paperNav").addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>("button[data-p]");
    if (!b) return;
    e.stopPropagation();
    paperIdx = Math.max(0, Math.min(game.news.length - 1, paperIdx + Number(b.dataset.p)));
    renderPaper();
  });
  $("playBtn").addEventListener("click", () => { if (speed > 0) stopPlay(); else startPlay(); });
  $("speedBtn").addEventListener("click", () => {
    const k = (speed || lastSpeed) % 4 + 1;
    if (speed > 0) setSpeed(k); else { lastSpeed = k; speedUI(); }
  });
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
  $("loadBtn").addEventListener("click", () => { $("gameDrop").hidden = true; stopPlay(); openMenu(false, false, "load"); });
  $("gameDrop").addEventListener("click", (e) => {
    const f = (e.target as HTMLElement).closest<HTMLButtonElement>("button.fold");
    if (!f) return;
    e.stopPropagation();
    const body = $(f.dataset.fold!);
    body.hidden = !body.hidden;
    f.querySelector("i")!.textContent = body.hidden ? "▸" : "▾";
  });
  $("saveBtn").addEventListener("click", () => { $("gameDrop").hidden = true; saveNamed(); });
  $("exitBtn").addEventListener("click", () => saveAndExit());
  // Ctrl/Cmd+S saves, anywhere (not the browser's "save page")
  window.addEventListener("keydown", (e) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") { e.preventDefault(); if ($("menu").hidden) saveNamed(); } });
  // leaving the page (or hiding it) saves the game
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") autosave(); });
  window.addEventListener("pagehide", autosave);
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
      siteReport();
      // before founding a click picks a site; otherwise it opens the card for the tile
      if (selected && (game.company || !placing)) showQuery(selected.x, selected.y, e.offsetX, e.offsetY);
      else $("query").hidden = true;
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
  $("query").addEventListener("click", (e) => { if ((e.target as HTMLElement).classList.contains("q-close")) $("query").hidden = true; });
  $("zoomIn").addEventListener("click", () => setZoom(canvas.width / 2, canvas.height / 2, zoomIndex() + 1));
  $("zoomOut").addEventListener("click", () => setZoom(canvas.width / 2, canvas.height / 2, zoomIndex() - 1));

  window.addEventListener("keydown", (e) => {
    if (inFormControl(e)) return;
    if (!$("menu").hidden && e.key !== "Escape") return; // the menu is up: no game keys
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
    else if (k === "escape") {
      // Esc closes whatever is on top; only with nothing open does it save and go to the menu
      if (!$("menu").hidden) { if ($("menu").querySelector("[data-a=back]")) closeMenu(); }
      else if (!$("gameDrop").hidden) $("gameDrop").hidden = true;
      else if (!$("layerMenu").hidden) $("layerMenu").hidden = true;
      else if (!$("dialog").hidden) openDialog(false);
      else if (!$("query").hidden) $("query").hidden = true;
      else if (!$("paper").hidden) openPaper(false);
      else if (!$("struggle").hidden) toggleStruggle(false);
      else if (!$("trends").hidden) toggleTrends(false);
      else if (proposal || roadPreview) stopPlacing();
      else if (overlay !== "none") setOverlay("none");
      else if (selected) { selected = null; siteReport(); requestRender(); }
      else if (game.pendingDecision || game.family?.succession) return;
      else saveAndExit();
    }
    else if (k === "n") { openPaper($("paper").hidden === true); return; }
    else if (k === "t") { toggleTrends(); return; }
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

/** open the query card for a tile, beside the click point but kept inside the map view */
function showQuery(x: number, y: number, px: number, py: number) {
  const el = $("query");
  el.innerHTML = queryCard({ game, map, renderer }, x, y);
  // what each community in the neighbourhood has built, and builds next (folded)
  const dist = document.createElement("div");
  if (districtPanel(game, dist, zoneAt(game, x, y))) el.insertAdjacentHTML("beforeend", `<details class="q-dist"><summary>What each community has built</summary><div id="district">${dist.innerHTML}</div></details>`);
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
  top.innerHTML = `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2 6h3l4-3v10l-4-3H2z" fill="currentColor"/>${soundWanted && !on ? "" : waves}</svg>`;
  top.title = on ? "Sound is on — click or press M to mute" : soundWanted ? "Browsers start audio on your first click or key press" : "Sound is off — click or press M to turn it on";
  if (!on) $("nowPlaying").textContent = soundWanted ? "Sound starts on your first click." : "Sound is off (M).";
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
  $("industryNote").textContent = `${ind.startsAs} · from $${fmt(ind.startCost)} · flat ${fp}×${fp} site${ind.site.riverWithinM ? " by a river" : ""}`;
  $("industryNote").title = `Plus land and grading. Needs ${fp}×${fp} tiles (${feet(fp * map.metersPerTile)} square) with under ${feet(ind.site.maxReliefM)} of relief${ind.site.riverWithinM ? `, within ${feet(ind.site.riverWithinM)} of a river` : ""}.`;
}

// ---------------------------------------------------------------- building projects
/** the game suggests a spot and shows it; the player clicks to move it, then confirms */
function startPlacing(kind: ProjectKind, ind?: IndustryId) {
  const p = suggestProject(game, kind, ind);
  placing = false; ($<HTMLInputElement>("placing")).checked = false;
  proposal = p ?? { kind, x: game.company!.x, y: game.company!.y, size: 1, ok: false, reason: "No suitable spot found nearby — click the map to try one", cost: 0, industry: ind, displaced: 0 };
  if (p) centerOn(Math.round(p.x + p.size / 2), Math.round(p.y + p.size / 2), Math.max(cam.zoom, 0.75));
  placeBar();
  requestRender();
}

function stopPlacing() { proposal = null; roadPreview = null; placeBar(); requestRender(); }

/** fly to a tile and open its card */
function goTo(x: number, y: number) {
  x = Math.round(x); y = Math.round(y);
  centerOn(x, y, Math.max(cam.zoom, 1));
  selected = { x, y };
  const [sx, sy] = tileScreen(x, y);
  showQuery(x, y, sx, sy);
  requestRender();
}

/** show a road on the map, with what it costs and does; pay, lobby or cancel */
function startRoad(p: RoadPlan) {
  proposal = null;
  roadPreview = p;
  const mid = p.path[Math.floor(p.path.length / 2)];
  const span = Math.max(...p.path.map((i) => Math.hypot((i % map.width) - (mid % map.width), ((i / map.width) | 0) - ((mid / map.width) | 0))));
  centerOn(mid % map.width, (mid / map.width) | 0, span > 60 ? 0.25 : span > 30 ? 0.5 : 0.75);
  placeBar();
  requestRender();
}

/** your businesses on the map: a small flag in the company colours, named when you're close */
function drawHoldings() {
  const h = game.company?.holdings;
  if (!h?.biz.length || cam.zoom < 0.25) return;
  ctx.save();
  ctx.font = "bold 11px ui-monospace, monospace"; ctx.textBaseline = "bottom";
  for (const b of h.biz) {
    const [x, y] = tileScreen(b.x, b.y);
    if (x < -50 || y < -50 || x > canvas.width + 50 || y > canvas.height + 50) continue;
    const pole = 18 * Math.max(0.6, Math.min(1.5, cam.zoom));
    ctx.strokeStyle = "#1a1a1a"; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y - pole); ctx.stroke();
    ctx.fillStyle = "#e0b050"; ctx.fillRect(x, y - pole, 10, 7); ctx.fillStyle = "#8e3f2e"; ctx.fillRect(x, y - pole + 7, 10, 2);
    if (cam.zoom >= 0.75) {
      const name = bizDef(b.id).name;
      const w = ctx.measureText(name).width + 8;
      ctx.fillStyle = "rgba(20,20,24,0.85)"; ctx.fillRect(x + 12, y - pole - 2, w, 15);
      ctx.fillStyle = "#ffd34a"; ctx.fillText(name, x + 16, y - pole + 12);
    }
  }
  ctx.restore();
}

/** the planned road drawn over the map: dashed, with the new bridge in a warmer colour */
function drawRoadPreview() {
  const p = roadPreview;
  if (!p) return;
  const pt = (i: number) => tileScreen(i % map.width, (i / map.width) | 0);
  ctx.save();
  ctx.lineWidth = Math.max(2, 5 * cam.zoom); ctx.lineCap = "round"; ctx.lineJoin = "round";
  ctx.setLineDash([Math.max(4, 10 * cam.zoom), Math.max(3, 6 * cam.zoom)]);
  ctx.lineDashOffset = -performance.now() / 60;
  let water = map.terrain[p.path[0]] === 0;
  ctx.beginPath(); ctx.moveTo(...pt(p.path[0]));
  for (let k = 1; k < p.path.length; k++) {
    const w = map.terrain[p.path[k]] === 0;
    ctx.lineTo(...pt(p.path[k]));
    if (w !== water || k === p.path.length - 1) {
      ctx.strokeStyle = water ? "#ff8a4a" : "#ffd34a"; ctx.stroke();
      ctx.beginPath(); ctx.moveTo(...pt(p.path[k]));
      water = w;
    }
  }
  ctx.restore();
}

function placeBar() {
  const el = $("placeBar");
  if (roadPreview) { roadBar(el, roadPreview); return; }
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

function roadBar(el: HTMLElement, p: RoadPlan) {
  const pay = roadBlocked(game, p, "pay"), lobby = roadBlocked(game, p, "lobby");
  el.innerHTML = `<span><b>${p.bridge ? "Bridge" : "Road"} to ${esc(p.to)}</b> — ${distance(p.path.length * map.metersPerTile)}${p.bridgeTiles ? `, new bridge ${feet(p.bridgeTiles * map.metersPerTile)}` : ""}${p.displaced ? ` · ${fmt(p.displaced)} people moved` : ""}<br><span class="hint">${Math.round(p.before)} → ${Math.round(p.after)} min to the works · about ${fmt(p.gain)} more people in reach</span></span>
    <button id="roadPay" class="primary" ${pay ? `disabled title="${esc(pay)}"` : ""}>Pay ${short(p.cost)}</button><button id="roadLobby" ${lobby ? `disabled title="${esc(lobby)}"` : `title="Spend influence; the city builds it in ${lobbySeasons(p)} seasons"`}>Lobby (Inf ${lobbyInfluence(p)})</button><button id="placeCancel">Cancel</button>`;
  el.hidden = false;
  for (const [id, how] of [["roadPay", "pay"], ["roadLobby", "lobby"]] as const) $(id).addEventListener("click", () => {
    const r = orderRoad(game, p, how);
    worksStatus(r.text);
    if (r.ok) { roadPreview = null; renderer.invalidateAll(); }
    afterChange();
    placeBar();
  });
  $("placeCancel").addEventListener("click", stopPlacing);
}

function nextSeason() {
  if (game.over) return;
  // a historical moment is waiting for your answer
  if (game.pendingDecision) { decisionCard(game, $("decision"), () => afterChange()); return; }
  if (game.family?.succession) { successionCard(game, $("succession"), () => afterChange()); return; }
  resetBusinessUi(); resetWorksUi(); resetTownUi(); resetHoldingsUi(); resetStruggleUi();
  if (proposal || roadPreview) stopPlacing();
  advanceTurn(game);
  afterTurn();
}

function nextYear() {
  if (game.over) return;
  // play out the rest of this year and stop at next Spring; show every headline on the way in the log
  if (game.pendingDecision) { decisionCard(game, $("decision"), () => afterChange()); return; }
  if (game.family?.succession) { successionCard(game, $("succession"), () => afterChange()); return; }
  resetBusinessUi(); resetWorksUi(); resetTownUi(); resetHoldingsUi(); resetStruggleUi();
  if (proposal || roadPreview) stopPlacing();
  do advanceTurn(game); while (!game.over && !game.pendingDecision && !game.family?.succession && cal(game).season !== "Spring");
  afterTurn();
}

/** the industries a company can be founded in (the modern ones open as the years go by) */
function industryOptions() {
  const sel = $<HTMLSelectElement>("industry"), list = industriesIn(game ? cal(game).year : 1850);
  if (sel.options.length === list.length) return;
  sel.innerHTML = list.map((k) => `<option value="${k}"${k === industry ? " selected" : ""}>${INDUSTRIES[k].name}</option>`).join("");
}
function afterTurn() {
  if (!game.company) industryOptions();
  afterChange();
  if (cal(game).season === "Spring" || game.over) autosave();
  if (!$("trends").hidden) trendsView(game, $("trends"), setTab);
  if (selected && !$("query").hidden) { const el = $("query"); el.innerHTML = queryCard({ game, map, renderer }, selected.x, selected.y); }
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
      // held, not paused: a decision card or a building being placed waits for you, then play goes on at
      // your speed (the season's full time starts again once you're done)
      const why = holdReason();
      showHold(why);
      if (why) { due = now + SPEED_MS[speed]; return; }
      if (now < due || renderer.pending > 40) return;
      // at the fastest speed, hold a moment on seasons with news so the headline can be read
      if (speed === 4 && game.news[game.news.length - 1]?.turn === game.turn && now - newsAt < 2500) return;
      due = now + SPEED_MS[speed];
      nextSeason();
    }, 100);
  }
  speedUI();
  holdShown = "-"; showHold("");
}

function toggleStruggle(force?: boolean) {
  const el = $("struggle");
  const open = force ?? el.hidden;
  el.hidden = !open;
  $("struggleBtn").classList.toggle("on", !!open);
  if (open) { if (!$("trends").hidden) toggleTrends(false); struggleView(game, el, () => afterChange(), () => toggleStruggle(false)); }
}

function toggleTrends(force?: boolean) {
  const el = $("trends");
  const open = force ?? el.hidden;
  if (!open) { el.hidden = true; $("trendsBtn").classList.remove("on"); return; }
  trendsView(game, el, setTab);
  $("trendsBtn").classList.add("on");
}

/** why the clock is waiting for you, if it is */
function holdReason(): string {
  if (!$("menu").hidden) return "Main menu open";
  if (game.pendingDecision) { if ($("decision").hidden) decisionCard(game, $("decision"), () => afterChange()); return "Waiting for your decision"; }
  if (game.family?.succession) { if ($("succession").hidden) successionCard(game, $("succession"), () => afterChange()); return "Waiting for the succession"; }
  if (proposal) return "Waiting while you place the building";
  if (roadPreview) return "Waiting while you look at the road";
  return "";
}
let holdShown = "";
function showHold(why: string) {
  if (why === holdShown) return;
  holdShown = why;
  const b = $<HTMLButtonElement>("playBtn");
  b.classList.toggle("held", speed > 0 && !!why);
  b.title = speed > 0 && why ? `${why} — play resumes after` : "Play / pause (P)";
}
const SPEED_WORD = ["", "1×", "2×", "4×", "8×"];
/** the play button and the speed it plays at */
function speedUI() {
  const play = $<HTMLButtonElement>("playBtn");
  play.textContent = speed > 0 ? "❚❚" : "▶";
  play.classList.toggle("on", speed > 0);
  $("speedBtn").textContent = SPEED_WORD[speed || lastSpeed];
}

function startPlay() { if (!game.over) setSpeed(lastSpeed); }
function stopPlay() { setSpeed(0); }

function updateTimeControls() {
  const over = !!game.over;
  for (const id of ["next", "playBtn", "speedBtn"]) ($<HTMLButtonElement>(id)).disabled = over;
  $("next").textContent = over ? "The end" : "Next season ▶";
}

/** jump to the best affordable site for the chosen industry (press again for the next one) */
function showBestSite() {
  const pSat = popSAT(map, game.world);
  const fp = footprintTiles(map, industry);
  const cands: { x: number; y: number; score: number }[] = [];
  for (let y = 4; y < map.height - fp - 4; y += 5) for (let x = 4; x < map.width - fp - 4; x += 5) {
    const r = evaluateSite(map, game.world, game.fields, industry, x, y, pSat);
    if (r.ok && r.cost <= foundingCapital(industry, cal(game).year)) cands.push({ x, y, score: r.score });
  }
  cands.sort((a, b) => b.score - a.score);
  const pick = cands.find((c) => siteTried.every((t) => Math.hypot(t.x - c.x, t.y - c.y) > 30));
  if (!pick) { siteTried = []; return; }
  siteTried.push(pick);
  selected = { x: pick.x, y: pick.y };
  centerOn(pick.x + fp / 2, pick.y + fp / 2, 1);
  siteReport();
  requestRender();
}

function showFinal() {
  const g = game, st = g.stats, c = g.company;
  const pop = totalPopulation(g);
  const rows: [string, string][] = [
    ["Valley population, peak", `${fmt(st.peakPop)} (${st.peakPopYear})`],
    [`Valley population, ${cal(g).year}`, fmt(pop)],
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
      [`Cash, ${cal(g).year}`, money(c.cash)],
      ["Strikes", fmt(st.strikes)],
      ["Reputation · labour · influence", `${Math.round(c.biz.meters.reputation)} · ${Math.round(c.biz.meters.labour)} · ${Math.round(c.biz.meters.influence)}`],
    );
    if (c.others.length) rows.splice(1, 0, ["Works owned", allWorks(c).map((w) => w.name).join(", ")]);
    verdict = c.bankrupt ? `${c.name} went into receivership in ${cal(g).year}. The bank sold the works to whoever would have them.` : c.cash > 0
      ? `${c.name} is still standing when the valley's great mills go quiet. Whether the town around it survives is another question.`
      : `${c.name} did not outlast the collapse. The works stand cold beside the river.`;
  } else verdict = "You never founded a company. The valley's story went on without you.";
  const epi = c ? epilogue() : [];
  const lg = legacy(g), f = g.family;
  const legacyHtml = c ? `<div class="legacy"><div><small>Fortune</small><b>${lg.fortune}</b></div><div><small>The Valley</small><b>${lg.valley}</b></div><div><small>History's verdict</small><b>${lg.verdict}</b></div><div><small>Legacy</small><b>${lg.total}</b></div></div>
    <p><b>${esc(lg.title)}.</b> ${lg.lines.map(esc).join(" ")}</p>
    ${f ? `<ol class="tree">${f.heads.map((h) => `<li><b>${esc(fullName(g, h))}</b> (${h.from}–${h.to ?? cal(g).year}) · ${esc(PATHS[h.path].name.toLowerCase())}${h.offices?.length ? ` · ${esc(h.offices.join(", "))}` : ""}${h.verdict ? ` — ${esc(h.verdict)}` : ""}</li>`).join("")}</ol>` : ""}
    <p style="font-size:12px">${topMarks(g, 4).map((m) => `${m.year}: ${esc(whoDid(g, m))} ${esc(m.text)}`).join(" · ")}</p>
    <table class="dyn">${[...DYNASTIES.map(([n, a, b, cc, note]) => ({ n, t: Math.round((a + b + cc) / 3), note, you: false })), { n: `The ${f?.surname ?? ""} family`, t: lg.total, note: lg.title.toLowerCase(), you: true }].sort((a, b) => b.t - a.t).map((d) => `<tr class="${d.you ? "you" : ""}"><td>${esc(d.n)}</td><td>${d.t}</td><td>${esc(d.note)}</td></tr>`).join("")}</table>` : "";
  $("final").innerHTML = `<div class="paper">
    <div class="mast"><span>Pittsburgh Post-Gazette</span><span>${c?.bankrupt ? `${cal(g).season} ${cal(g).year}` : "Winter 1985"}</span></div>
    <h3>${c?.bankrupt ? "Receivers Sell the Works" : "The Mills Go Quiet"}</h3>
    <p>${verdict}</p>
    ${epi.length ? `<p class="epilogue">${epi.join(" ")}</p>` : ""}
    ${legacyHtml}
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
    select: (x: number, y: number) => { selected = { x, y }; siteReport(); requestRender(); },
    overlay: (id: OverlayId) => setOverlay(id),
    chain: () => currentChain(),
    industry: (id: IndustryId) => { industry = id; ($<HTMLSelectElement>("industry")).value = id; industryNote(); siteReport(); requestRender(); },
    next: (n = 1) => { for (let k = 0; k < n; k++) advanceTurn(game); afterTurn(); },
    found: (x: number, y: number, id: IndustryId = industry) => { const r = foundCompany(game, id, x, y); renderer.updateHeights(); afterChange(); return r; },
    library: () => { const r = fundLibrary(game); afterChange(); return r; },
    steps: () => { const r = buildSteps(game); afterChange(); return r; },
    incline: () => { const r = buildIncline(game); afterChange(); return r; },
    tech: (ids: string[]) => { if (game.company) { game.company.techs = ids; game.world.version++; afterChange(); } },
    tod: (v: string) => { ($<HTMLSelectElement>("tod")).value = v; requestRender(); },
    get pending() { return renderer.pending; },
    query: (x: number, y: number) => { selected = { x, y }; const [sx, sy] = tileScreen(x, y); showQuery(x, y, sx, sy); requestRender(); },
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
