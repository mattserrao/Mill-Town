// Sound controller: reads what's on screen, picks the music (era, community, zoom), mixes the ambience.

import { GROUPS } from "../core/ancestry";
import type { GameState } from "../core/game";
import type { GameMap } from "../core/map";
import { Terrain } from "../core/terrain";
import { Use } from "../core/town";
import { type Camera, BASE_M, HH, HW, ZPX } from "../render/iso";
import { cityStyle, communityStyle, MusicPlayer, STYLES } from "./music";
import { type Scene, Soundscape } from "./soundscape";
import { atmosphereFor, SONGS_BY_FAMILY } from "./songs";

export interface ViewSummary extends Scene { group: number; groupShare: number; idleMills: number; place: string }

/** Sample the visible map. */
export function summarizeView(g: GameState, m: GameMap, cam: Camera, cw: number, ch: number, extra: { trains: number; boats: number; traffic: number; night: number; place: string }): ViewSummary {
  const w = g.world;
  let n = 0, water = 0, ind = 0, town = 0, country = 0, churches = 0;
  const pop = new Float64Array(GROUPS.length);
  for (let sy = 0; sy < 16; sy++) for (let sx = 0; sx < 16; sx++) {
    const wx = cam.x + ((sx + 0.5) / 16) * (cw / cam.zoom), wy = cam.y + ((sy + 0.5) / 16) * (ch / cam.zoom) + (260 - BASE_M) * ZPX;
    const a = wx / HW, b = wy / HH;
    const x = Math.floor((a + b) / 2), y = Math.floor((b - a) / 2);
    if (x < 0 || y < 0 || x >= m.width || y >= m.height) continue;
    for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) {
      const i = Math.min(m.height - 1, y + dy) * m.width + Math.min(m.width - 1, x + dx);
      n++;
      const u = w.use[i];
      if (m.terrain[i] === Terrain.Water) water++;
      else if (u === Use.Industry || u === Use.Rival) ind++;
      else if ((u >= Use.Cottage && u <= Use.Civic) || u === Use.Commerce || w.street[i]) town++;
      else if (u === Use.Farm || u === Use.Forest || u === Use.Empty) country++;
      if (u === Use.Civic && w.sub[i] !== 2 && w.sub[i] !== 3 && w.sub[i] !== 4 && w.sub[i] !== 8) churches++;
      const dc = Math.hypot(sx - 7.5, sy - 7.5) / 10.6; // 0 at the centre … 1 at the corners
      if (w.pop[i] && w.eth[i]) pop[w.eth[i]] += w.pop[i] * (1 - dc) ** 2;
    }
  }
  n = Math.max(1, n);
  let best = 0, tot = 0;
  for (let k = 1; k < pop.length; k++) { tot += pop[k]; if (pop[k] > pop[best]) best = k; }
  const running = g.company?.status === "running" || g.rivals.length > 0;
  const c = g.company;
  return {
    zoom: cam.zoom, year: w.year, season: ["Spring", "Summer", "Autumn", "Winter"][g.turn % 4], night: extra.night,
    water: water / n, industry: running ? Math.min(1, (ind / n) * 4) : 0, town: Math.min(1, (town / n) * 1.6), country: country / n,
    churches: Math.min(3, churches), trains: extra.trains, boats: extra.boats, traffic: extra.traffic,
    group: best, groupShare: tot ? pop[best] / tot : 0, idleMills: c && c.status !== "running" ? 1 : 0, place: extra.place,
  };
}

/** Which music fits the view. */
export function chooseMusic(v: ViewSummary): string {
  // deep night away from the busy streets: only mood pieces
  if (v.night > 0.7 && v.town < 0.35 && v.zoom >= 0.375) return "atmos";
  if (v.year >= 1979 && v.industry > 0.1 && v.zoom >= 0.375) return "elegy";
  if (v.zoom < 0.375 || v.town < 0.15) {
    if (v.country > 0.6 && v.year < 1930 && v.zoom >= 0.375) return "oldtime";
    return cityStyle(v.year);
  }
  if (v.group && v.groupShare > 0.3) {
    const variety = ((Math.floor(Date.now() / 120000) * 7919) % 100) / 100; // changes every couple of minutes
    return communityStyle(GROUPS[v.group].music, v.year, variety);
  }
  return cityStyle(v.year);
}

export class SoundController {
  ctx: AudioContext | null = null;
  private master!: GainNode;
  private musicBus!: GainNode;
  private ambBus!: GainNode;
  private scape!: Soundscape;
  private player: MusicPlayer | null = null;
  private timer = 0;
  private lastSwitch = -Infinity; // so the first style starts at once
  /** the music the view asks for (a style family, or "atmos"), the current track's start and length */
  private family = "";
  private trackStart = 0;
  private trackLen = 0;
  private counter = Math.floor(Math.random() * 1000);
  private interlude = false;
  nowPlaying = "";
  musicVol = 0.6;
  ambVol = 0.7;

  get running() { return !!this.ctx && this.ctx.state === "running"; }
  /** called when the context's state changes (Safari can suspend or interrupt it on its own) */
  onState: (() => void) | null = null;

  /**
   * Must be called from inside a user gesture (click / key). Everything up to resume() runs synchronously
   * so Safari still counts it as part of the gesture.
   */
  start(): Promise<void> {
    if (!this.ctx) {
      const Ctor: typeof AudioContext = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new Ctor();
      this.ctx.onstatechange = () => this.onState?.();
      this.master = this.ctx.createGain(); this.master.gain.value = 0.8;
      const comp = this.ctx.createDynamicsCompressor(); comp.threshold.value = -16; comp.ratio.value = 3;
      this.master.connect(comp); comp.connect(this.ctx.destination);
      this.musicBus = this.ctx.createGain(); this.musicBus.gain.value = this.musicVol * 0.6; this.musicBus.connect(this.master);
      this.ambBus = this.ctx.createGain(); this.ambBus.gain.value = this.ambVol; this.ambBus.connect(this.master);
      this.scape = new Soundscape(this.ctx, this.ambBus);
      this.timer = window.setInterval(() => { try { this.player?.schedule(this.ctx!.currentTime + 0.6); } catch (e) { console.warn("music", e); } }, 150);
    }
    // Safari unlock: play one silent sample inside the gesture
    try {
      const b = this.ctx.createBuffer(1, 1, this.ctx.sampleRate), src = this.ctx.createBufferSource();
      src.buffer = b; src.connect(this.ctx.destination); src.start(0);
    } catch { /* ignore */ }
    return this.ctx.resume().catch((e) => console.warn("audio resume", e));
  }

  stop(): Promise<void> { return this.ctx?.suspend() ?? Promise.resolve(); }

  setVolumes(music: number, amb: number) {
    this.musicVol = music; this.ambVol = amb;
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.musicBus.gain.setTargetAtTime(music * 0.6, t, 0.2);
    this.ambBus.gain.setTargetAtTime(amb, t, 0.2);
  }

  /** Call ~2×/s with the current view. */
  update(v: ViewSummary) {
    if (!this.running) return;
    try { this.updateInner(v); } catch (e) { console.warn("sound update", e); }
  }

  private updateInner(v: ViewSummary) {
    const ctx = this.ctx!, t = ctx.currentTime;
    this.scape.update(v);
    // music sits under the mills when you're close to the works
    const duck = 1 - Math.min(0.6, v.industry * Math.min(1, v.zoom));
    this.musicBus.gain.setTargetAtTime(this.musicVol * 0.6 * duck, t, 0.5);
    const want = chooseMusic(v);
    const fresh = want !== this.family;
    const due = t - this.trackStart > this.trackLen;
    if ((fresh || due) && t - this.lastSwitch > 6) {
      // after a song, often a quiet mood piece; then the next tune in the style the view calls for
      const atmosChance = Math.min(0.7, 0.3 + 0.25 * v.night + (v.zoom < 0.375 ? 0.15 : 0) + 0.2 * v.country);
      const k = this.counter++;
      let fam: string;
      if (want === "atmos") fam = atmosphereFor(v, k);
      else if (!fresh && !this.interlude && ((k * 2654435761) % 1000) / 1000 < atmosChance) fam = atmosphereFor(v, k);
      else fam = want;
      const book = SONGS_BY_FAMILY[fam] ?? SONGS_BY_FAMILY[cityStyle(v.year)];
      const song = book[k % book.length];
      this.interlude = fam !== want;
      this.family = want;
      this.player?.stop(t);
      this.player = new MusicPlayer(ctx, this.musicBus, song.style, `${v.year}:${v.place}:${k}`);
      this.player.start(t + 0.1, song.style.atmospheric ? 4 : 2);
      this.lastSwitch = t; this.trackStart = t;
      this.trackLen = song.style.atmospheric ? 70 + (k % 4) * 12 : 120 + (k % 5) * 15;
    }
    const playing = this.player?.style ?? STYLES[cityStyle(v.year)];
    this.nowPlaying = `${playing.label}${v.place ? ` — ${v.place}` : ""}, ${v.year}`;
  }

  dispose() { clearInterval(this.timer); this.ctx?.close(); }
}

/** Render a style (and optional ambience) offline to a WAV, for previews and tests. */
export async function renderPreview(styleId: string, seconds: number, scene?: Partial<Scene>): Promise<Blob> {
  const rate = 32000;
  const ctx = new OfflineAudioContext(2, rate * seconds, rate);
  const master = ctx.createGain(); master.gain.value = 0.8; master.connect(ctx.destination);
  const bus = ctx.createGain(); bus.gain.value = 0.55; bus.connect(master);
  if (styleId) { const p = new MusicPlayer(ctx, bus, STYLES[styleId], 7); p.start(0, 0.5); p.schedule(seconds); }
  if (scene) {
    const amb = ctx.createGain(); amb.gain.value = 0.9; amb.connect(master);
    const sc = new Soundscape(ctx, amb);
    // offline: step the scene by suspending the rendering clock every half second
    const full: Scene = { zoom: 1, year: 1900, season: "Summer", night: 0, water: 0, industry: 0, town: 0, country: 0, churches: 0, trains: 0, boats: 0, traffic: 0, ...scene };
    for (let k = 0; k < seconds * 2; k++) ctx.suspend(k / 2).then(() => { sc.update(full); ctx.resume(); });
  }
  const buf = await ctx.startRendering();
  return wav(buf);
}

function wav(buf: AudioBuffer): Blob {
  const ch = buf.numberOfChannels, len = buf.length, rate = buf.sampleRate;
  const data = new DataView(new ArrayBuffer(44 + len * ch * 2));
  const str = (o: number, s: string) => { for (let i = 0; i < s.length; i++) data.setUint8(o + i, s.charCodeAt(i)); };
  str(0, "RIFF"); data.setUint32(4, 36 + len * ch * 2, true); str(8, "WAVE"); str(12, "fmt ");
  data.setUint32(16, 16, true); data.setUint16(20, 1, true); data.setUint16(22, ch, true); data.setUint32(24, rate, true);
  data.setUint32(28, rate * ch * 2, true); data.setUint16(32, ch * 2, true); data.setUint16(34, 16, true); str(36, "data"); data.setUint32(40, len * ch * 2, true);
  const chans = Array.from({ length: ch }, (_, k) => buf.getChannelData(k));
  let o = 44;
  for (let i = 0; i < len; i++) for (let k = 0; k < ch; k++) { const s = Math.max(-1, Math.min(1, chans[k][i])); data.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true); o += 2; }
  return new Blob([data.buffer], { type: "audio/wav" });
}
