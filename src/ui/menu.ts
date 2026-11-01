// The main menu: shown when the game starts and from ☰. Resume the last game (the autosave), start a new
// one (a fresh town, or a seed to replay one), or load a saved game.

import { AUTOSAVE, deleteSave, listSaves, type SaveMeta } from "../core/save";
import { esc } from "../core/text";
import { money } from "./fx";

export interface MenuHandlers {
  /** opened from inside a game: offer "Back to the game" */
  inGame: boolean;
  onResume: () => void;
  onNew: (seed?: number) => void;
  onLoad: (id: string) => Promise<void>;
}

const ago = (t: number) => {
  const s = (Date.now() - t) / 1000;
  return s < 90 ? "just now" : s < 3600 ? `${Math.round(s / 60)} min ago` : s < 86400 ? `${Math.round(s / 3600)} h ago` : new Date(t).toLocaleDateString();
};
const line = (m: SaveMeta) => `${m.company ? esc(m.company) : "No company"} · ${m.season} ${m.year}${m.cash !== undefined ? ` · ${money(m.cash)}` : ""}`;

export async function mainMenu(el: HTMLElement, h: MenuHandlers, view: "main" | "load" | "new" = "main", error = "") {
  const saves = await listSaves();
  const auto = saves.find((m) => m.id === AUTOSAVE);
  const named = saves.filter((m) => m.id !== AUTOSAVE);
  let body = "";
  if (view === "main") {
    body = `
      ${h.inGame ? `<button class="mm-big primary" data-a="back">Back to the game</button>` : ""}
      <button class="mm-big ${h.inGame ? "" : "primary"}" data-a="resume" ${auto ? "" : "disabled"}>
        <b>Resume last game</b><span>${auto ? `${line(auto)} · saved ${ago(auto.savedAt)}` : "No game saved yet"}</span></button>
      <button class="mm-big" data-a="new"><b>New game</b><span>A new valley in 1850</span></button>
      <button class="mm-big" data-a="load" ${saves.length ? "" : "disabled"}><b>Load game</b><span>${saves.length ? `${saves.length} saved game${saves.length > 1 ? "s" : ""}` : "No saved games"}</span></button>`;
  } else if (view === "new") {
    body = `
      <p class="mm-p">Each town is grown from a seed. Leave it blank for a fresh one, or type a seed to replay a town.</p>
      <label class="mm-seed">Seed <input id="mmSeed" type="text" inputmode="numeric" placeholder="random" /></label>
      ${auto && !h.inGame ? `<p class="mm-p mm-warn">Your last game stays saved: resume or load it any time.</p>` : ""}
      <div class="mm-row"><button data-a="main">Back</button><button class="primary" data-a="start">Start</button></div>`;
  } else {
    body = `
      <div class="mm-list">${[...(auto ? [auto] : []), ...named].map((m) => `
        <div class="mm-save">
          <div><b>${m.id === AUTOSAVE ? "Autosave" : esc(m.name)}</b><span>${line(m)}</span><span>Saved ${ago(m.savedAt)} · ${(m.bytes / 1e6).toFixed(1)} MB${m.version ? ` · v${esc(m.version)}` : ""}</span></div>
          <button class="primary" data-load="${esc(m.id)}">Load</button><button data-del="${esc(m.id)}" title="Delete this save">✕</button>
        </div>`).join("")}</div>
      <div class="mm-row"><button data-a="main">Back</button></div>`;
  }
  el.innerHTML = `<div class="mm-card">
    <div class="mm-title">MILL TOWN</div>
    <div class="mm-sub">${view === "load" ? "Load a game" : view === "new" ? "New game" : "Pittsburgh &amp; the Mon Valley, 1850–1985"}</div>
    ${error ? `<p class="mm-err">${esc(error)}</p>` : ""}
    ${body}
    <div class="mm-foot">Games are saved in this browser: every new year, when you leave, and from ☰ → Save game.</div>
  </div>`;
  el.hidden = false;

  const go = (v: typeof view, err = "") => mainMenu(el, h, v, err);
  el.querySelectorAll<HTMLButtonElement>("button[data-a]").forEach((b) => b.addEventListener("click", async () => {
    const a = b.dataset.a!;
    if (a === "back") h.onResume();
    else if (a === "resume") await load(AUTOSAVE, b);
    else if (a === "new" || a === "main" || a === "load") go(a);
    else if (a === "start") {
      const v = el.querySelector<HTMLInputElement>("#mmSeed")!.value.trim();
      h.onNew(v && !isNaN(Number(v)) ? Math.floor(Number(v)) : undefined);
    }
  }));
  el.querySelector<HTMLInputElement>("#mmSeed")?.addEventListener("keydown", (e) => { if (e.key === "Enter") el.querySelector<HTMLButtonElement>("[data-a=start]")!.click(); });
  el.querySelectorAll<HTMLButtonElement>("button[data-load]").forEach((b) => b.addEventListener("click", () => load(b.dataset.load!, b)));
  el.querySelectorAll<HTMLButtonElement>("button[data-del]").forEach((b) => b.addEventListener("click", async () => {
    if (b.dataset.sure !== "1") { b.dataset.sure = "1"; b.textContent = "Delete?"; return; }
    await deleteSave(b.dataset.del!);
    const left = await listSaves();
    go(left.length ? "load" : "main");
  }));

  async function load(id: string, b: HTMLButtonElement) {
    el.querySelectorAll<HTMLButtonElement>("button").forEach((x) => (x.disabled = true));
    b.innerHTML = "<b>Loading…</b>";
    try { await h.onLoad(id); }
    catch (e) { go(view, `Couldn't load that game: ${(e as Error).message}`); }
  }
}
