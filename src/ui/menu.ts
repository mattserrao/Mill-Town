// The main menu: shown when the game starts and from ☰. Resume the last game (the autosave), start a new
// one (a fresh town, or a seed to replay one), or load a saved game.

import { AUTOSAVE, deleteSave, listSaves, type SaveMeta } from "../core/save";
import { esc } from "../core/text";
import { money } from "./fx";
import { INDUSTRIES, industriesIn, type IndustryId } from "../core/industries";

let typed = { seed: "", first: "", last: "" };

/** a progress card while the years before a later start are simulated */
export function simCard(el: HTMLElement, year: number, now: number, text: string) {
  const f = Math.max(0, Math.min(1, (now - 1850) / Math.max(1, year - 1850)));
  el.innerHTML = `<div class="mm-card"><div class="mm-title">MILL TOWN</div><div class="mm-sub">Playing the valley from 1850 to ${year}</div>
    <div class="mm-prog"><b style="width:${Math.round(f * 100)}%"></b></div><p class="mm-p">${esc(text)}</p></div>`;
  el.hidden = false;
}

export interface MenuHandlers {
  /** opened from inside a game: offer "Back to the game" */
  inGame: boolean;
  /** the game was just saved on the way here */
  saved?: boolean;
  onSave?: () => Promise<boolean>;
  onResume: () => void;
  onNew: (seed?: number, later?: NewGameOptions) => void;
  onLoad: (id: string) => Promise<void>;
}

/** a later start: the era, the faction, the family's industry and name */
export interface NewGameOptions { year: number; faction: "industrialist" | "politician"; industry: IndustryId; first: string; surname: string }

const START = [[1850, "1850 · Iron and the Founders", "Found the company yourself"], [1893, "1893 · Steel and the Trusts", "After Homestead"], [1920, "1920 · Depression, New Deal and War", "After the Great Steel Strike"], [1947, "1947 · Renaissance and Collapse", "After the 1946 strikes"]] as const;
let pick: { year: number; faction: NewGameOptions["faction"]; industry: IndustryId } = { year: 1850, faction: "industrialist", industry: "steel" };

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
      ${h.inGame ? `${h.saved ? `<p class="mm-ok">✓ Game saved. You can close this tab, or pick up where you left off.</p>` : ""}<button class="mm-big primary" data-a="back"><b>Back to the game</b><span>Esc</span></button>
      <button class="mm-big" data-a="save"><b>Save as a new game</b><span>Keeps this point to load later</span></button>` : ""}
      <button class="mm-big ${h.inGame || !auto ? "" : "primary"}" data-a="resume" ${auto ? "" : "disabled"}>
        <b>Resume last game</b><span>${auto ? `${line(auto)} · saved ${ago(auto.savedAt)}` : "No game saved yet"}</span></button>
      <button class="mm-big ${!h.inGame && !auto ? "primary" : ""}" data-a="new"><b>New game</b><span>A new valley in 1850</span></button>
      <button class="mm-big" data-a="load" ${saves.length ? "" : "disabled"}><b>Load game</b><span>${saves.length ? `${saves.length} saved game${saves.length > 1 ? "s" : ""}` : "No saved games"}</span></button>`;
  } else if (view === "new") {
    body = `
      <p class="mm-p">Each town is grown from a seed. Leave it blank for a fresh one, or type a seed to replay a town.</p>
      <label class="mm-seed">Seed <input id="mmSeed" type="text" inputmode="numeric" placeholder="random" /></label>
      <div class="mm-h">Start in</div>
      <div class="mm-opts">${START.map(([y, name, sub]) => `<label class="${pick.year === y ? "on" : ""}"><input type="radio" name="mmYear" value="${y}" ${pick.year === y ? "checked" : ""}/><b>${name}</b><span>${sub}</span></label>`).join("")}</div>
      ${pick.year > 1850 ? `
      <p class="mm-p">The valley and your family have been played from 1850 by a careful owner making the choices of the day. You arrive at the succession and take over, with everything the family did before you. (A later start is one valley; the seed above is for 1850.)</p>
      <div class="mm-h">Your faction</div>
      <div class="mm-opts mm-two">
        <label class="${pick.faction === "industrialist" ? "on" : ""}"><input type="radio" name="mmFaction" value="industrialist" ${pick.faction === "industrialist" ? "checked" : ""}/><b>Industrialist</b><span>Run the family company</span></label>
        <label class="${pick.faction === "politician" ? "on" : ""}"><input type="radio" name="mmFaction" value="politician" ${pick.faction === "politician" ? "checked" : ""}/><b>Politician</b><span>A manager runs the works; you run for office</span></label>
      </div>
      <label class="mm-seed">Family business <select id="mmInd">${industriesIn(1850).map((i) => `<option value="${i}" ${pick.industry === i ? "selected" : ""}>${INDUSTRIES[i].name}</option>`).join("")}</select></label>
      <label class="mm-seed">Family <input id="mmFirst" type="text" maxlength="20" placeholder="founder" /> <input id="mmLast" type="text" maxlength="24" placeholder="surname" /></label>` : ""}
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
    <div class="mm-foot">Games save in this browser every new year and when you leave.</div>
  </div>`;
  el.hidden = false;

  const go = (v: typeof view, err = "") => mainMenu(el, h, v, err);
  el.querySelectorAll<HTMLButtonElement>("button[data-a]").forEach((b) => b.addEventListener("click", async () => {
    const a = b.dataset.a!;
    if (a === "back") h.onResume();
    else if (a === "save") { b.disabled = true; b.innerHTML = "<b>Saving…</b>"; await h.onSave?.(); go("main"); }
    else if (a === "resume") await load(AUTOSAVE, b);
    else if (a === "new" || a === "main" || a === "load") go(a);
    else if (a === "start") {
      const v = el.querySelector<HTMLInputElement>("#mmSeed")!.value.trim();
      const seed = v && !isNaN(Number(v)) ? Math.floor(Number(v)) : undefined;
      if (pick.year === 1850) h.onNew(seed);
      else h.onNew(seed, { year: pick.year, faction: pick.faction, industry: pick.industry, first: el.querySelector<HTMLInputElement>("#mmFirst")!.value.trim(), surname: el.querySelector<HTMLInputElement>("#mmLast")!.value.trim() });
    }
  }));
  el.querySelectorAll<HTMLInputElement>("input[name=mmYear]").forEach((i) => i.addEventListener("change", () => { pick.year = Number(i.value); keepSeed(); go("new"); }));
  el.querySelectorAll<HTMLInputElement>("input[name=mmFaction]").forEach((i) => i.addEventListener("change", () => { pick.faction = i.value as NewGameOptions["faction"]; keepSeed(); go("new"); }));
  el.querySelector<HTMLSelectElement>("#mmInd")?.addEventListener("change", (e) => { pick.industry = (e.target as HTMLSelectElement).value as IndustryId; });
  // re-rendering the card keeps what was typed
  function keepSeed() { typed = { seed: el.querySelector<HTMLInputElement>("#mmSeed")?.value ?? "", first: el.querySelector<HTMLInputElement>("#mmFirst")?.value ?? typed.first, last: el.querySelector<HTMLInputElement>("#mmLast")?.value ?? typed.last }; }
  if (view === "new") {
    el.querySelector<HTMLInputElement>("#mmSeed")!.value = typed.seed;
    const f = el.querySelector<HTMLInputElement>("#mmFirst"), l = el.querySelector<HTMLInputElement>("#mmLast");
    if (f) f.value = typed.first; if (l) l.value = typed.last;
  }
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
