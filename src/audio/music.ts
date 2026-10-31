// Procedural music: a style per era and per community, played by a small synth band.
// Melodies are generated from the style's scale and chords, phrased AABA, and change every 16 bars.

import { Rng } from "../core/rng";
import { drum, type Drum, type Inst, note } from "./synth";

type CompStyle = "oompah" | "waltz" | "arp" | "stab" | "pad" | "stride" | "triplets" | "drone" | "harp" | "none";
type BassStyle = "rootfifth" | "walking" | "funk" | "eighths" | "one" | "none";

export interface Style {
  id: string;
  label: string;
  bpm: number;
  meter: number;      // beats per bar
  sub: number;        // steps per beat
  swing?: number;     // 0..0.6 delay of off-steps (sub = 2)
  scale: number[];
  key: number;        // MIDI tonic
  prog: number[];     // chord scale-degree per bar
  sevenths?: boolean;
  lead: Inst;
  lead2?: Inst;       // harmony a third below
  comp: Inst;
  compStyle: CompStyle;
  bass: Inst;
  bassStyle: BassStyle;
  drums?: Partial<Record<Drum, string>>; // one char per step: x = hit, o = soft
  density: number;    // melody note density 0..1
  gain?: number;      // level trim
  range: [number, number]; // melody range in scale steps around the tonic
  /** a mood piece rather than a song: drifts, few notes, long tones */
  atmospheric?: boolean;
  /** instruments that can take the lead in a variant of this style */
  leads?: Inst[];
}

const MAJ = [0, 2, 4, 5, 7, 9, 11], MIN = [0, 2, 3, 5, 7, 8, 10], HMIN = [0, 2, 3, 5, 7, 8, 11];
const MIX = [0, 2, 4, 5, 7, 9, 10], DOR = [0, 2, 3, 5, 7, 9, 10], HUN = [0, 2, 3, 6, 7, 8, 11], FREY = [0, 1, 4, 5, 7, 8, 10];

export const STYLES: Record<string, Style> = {
  parlor: { id: "parlor", label: "Parlor waltz", gain: 1.3, bpm: 100, meter: 3, sub: 2, scale: MAJ, key: 65, prog: [0, 0, 3, 4, 0, 3, 4, 0], lead: "flute", comp: "piano", compStyle: "waltz", bass: "upright", bassStyle: "one", density: 0.55, range: [0, 9] },
  irish: { id: "irish", label: "Irish jig", bpm: 112, meter: 2, sub: 3, scale: MIX, key: 62, prog: [0, 0, 6, 6, 0, 0, 4, 0], lead: "fiddle", comp: "accordion", compStyle: "triplets", bass: "upright", bassStyle: "one", drums: { bodhran: "x..x.." }, density: 0.9, range: [0, 10] },
  oldtime: { id: "oldtime", label: "Old-time fiddle reel", bpm: 118, meter: 2, sub: 2, scale: MAJ, key: 69, prog: [0, 0, 3, 0, 0, 0, 4, 0], lead: "fiddle", comp: "banjo", compStyle: "oompah", bass: "upright", bassStyle: "rootfifth", density: 0.9, range: [0, 9] },
  german: { id: "german", label: "German brass band", bpm: 108, meter: 2, sub: 2, scale: MAJ, key: 58, prog: [0, 0, 4, 4, 4, 4, 0, 0], lead: "brass", lead2: "brass", comp: "brass", compStyle: "oompah", bass: "tuba", bassStyle: "rootfifth", drums: { kick: "x...", snare: "..o." }, density: 0.6, range: [0, 8] },
  polka: { id: "polka", label: "Slovak/Polish polka", bpm: 126, meter: 2, sub: 2, scale: MAJ, key: 65, prog: [0, 0, 4, 4, 4, 4, 0, 0], lead: "clarinet", lead2: "accordion", comp: "accordion", compStyle: "oompah", bass: "tuba", bassStyle: "rootfifth", drums: { kick: "x.x.", snare: ".x.x" }, density: 0.85, range: [0, 9] },
  csardas: { id: "csardas", label: "Hungarian csárdás", bpm: 132, meter: 2, sub: 2, scale: HUN, key: 57, prog: [0, 0, 3, 3, 4, 4, 0, 0], lead: "fiddle", comp: "cimbalom", compStyle: "arp", bass: "upright", bassStyle: "rootfifth", density: 0.9, range: [0, 10] },
  slavic: { id: "slavic", label: "Rusyn folk song", bpm: 100, meter: 2, sub: 2, scale: HMIN, key: 62, prog: [0, 0, 3, 3, 4, 4, 0, 0], lead: "fiddle", lead2: "accordion", comp: "accordion", compStyle: "oompah", bass: "upright", bassStyle: "rootfifth", density: 0.7, range: [0, 8] },
  tamburitza: { id: "tamburitza", label: "Croatian tamburitza", bpm: 116, meter: 2, sub: 2, scale: MAJ, key: 67, prog: [0, 0, 4, 4, 3, 4, 0, 0], lead: "tamburica", lead2: "tamburica", comp: "tamburica", compStyle: "oompah", bass: "upright", bassStyle: "rootfifth", density: 0.8, range: [0, 9] },
  italian: { id: "italian", label: "Tarantella", bpm: 132, meter: 2, sub: 3, scale: HMIN, key: 64, prog: [0, 0, 4, 4, 4, 4, 0, 0], lead: "mandolin", comp: "accordion", compStyle: "triplets", bass: "upright", bassStyle: "one", drums: { tamb: "x.xx.x" }, density: 0.9, range: [0, 9] },
  klezmer: { id: "klezmer", label: "Klezmer freylekhs", bpm: 104, meter: 2, sub: 2, scale: FREY, key: 62, prog: [0, 0, 0, 6, 0, 0, 6, 0], lead: "clarinet", comp: "accordion", compStyle: "oompah", bass: "upright", bassStyle: "rootfifth", drums: { kick: "x.x.", snare: ".o.o" }, density: 0.8, range: [0, 10] },
  ragtime: { id: "ragtime", label: "Ragtime", gain: 2.2, bpm: 92, meter: 2, sub: 4, scale: MAJ, key: 60, prog: [0, 0, 3, 3, 0, 4, 1, 4], sevenths: true, lead: "piano", comp: "piano", compStyle: "stride", bass: "piano", bassStyle: "none", density: 0.75, range: [7, 16] },
  swing: { id: "swing", label: "Swing band", bpm: 138, meter: 4, sub: 2, swing: 0.33, scale: MIX, key: 65, prog: [0, 0, 3, 3, 0, 4, 1, 4], sevenths: true, lead: "brass", lead2: "sax", comp: "piano", compStyle: "stab", bass: "upright", bassStyle: "walking", drums: { hat: "x.x.x.x.", brush: "..x...x.", kick: "o...o..." }, density: 0.55, range: [0, 9] },
  bebop: { id: "bebop", label: "Hill District jazz (Crawford Grill)", bpm: 160, meter: 4, sub: 2, swing: 0.33, scale: MIX, key: 65, prog: [0, 3, 0, 0, 3, 3, 0, 0, 4, 3, 0, 4], sevenths: true, lead: "sax", comp: "piano", compStyle: "stab", bass: "upright", bassStyle: "walking", drums: { hat: "x.xx.xx.", brush: "..x...x." }, density: 0.8, range: [0, 11] },
  doowop: { id: "doowop", label: "Doo-wop", bpm: 72, meter: 4, sub: 3, scale: MAJ, key: 63, prog: [0, 5, 3, 4], lead: "sax", comp: "piano", compStyle: "triplets", bass: "bass", bassStyle: "rootfifth", drums: { kick: "x.....x.....", snare: "...x.....x..", hat: "xxxxxxxxxxxx" }, density: 0.35, range: [0, 8] },
  soul: { id: "soul", label: "Soul", bpm: 104, meter: 4, sub: 2, scale: MIX, key: 62, prog: [0, 0, 3, 3, 0, 0, 4, 3], sevenths: true, lead: "brass", lead2: "sax", comp: "organ", compStyle: "stab", bass: "bass", bassStyle: "eighths", drums: { kick: "x..x..x.", snare: "..x...x.", hat: "xxxxxxxx" }, density: 0.45, range: [0, 8] },
  funk: { id: "funk", label: "Funk & disco", gain: 0.5, bpm: 112, meter: 4, sub: 4, scale: DOR, key: 57, prog: [0, 0, 3, 3], sevenths: true, lead: "synth", comp: "eguitar", compStyle: "stab", bass: "synthbass", bassStyle: "funk", drums: { kick: "x...x...x...x...", snare: "....x.......x...", hat: "..x...x...x...x.", clap: "....x.......x..." }, density: 0.35, range: [0, 8] },
  synthpop: { id: "synthpop", label: "Synth-pop", bpm: 116, meter: 4, sub: 2, scale: MIN, key: 57, prog: [0, 5, 2, 6], lead: "synth", comp: "synth", compStyle: "arp", bass: "synthbass", bassStyle: "eighths", drums: { kick: "x...x...", snare: "..x...x.", hat: "xxxxxxxx" }, density: 0.4, range: [0, 9] },
  elegy: { id: "elegy", label: "Mill-town elegy", gain: 1.6, bpm: 62, meter: 4, sub: 2, scale: MIN, key: 57, prog: [0, 5, 3, 4, 0, 5, 6, 4], lead: "piano", comp: "harmonium", compStyle: "pad", bass: "upright", bassStyle: "one", density: 0.3, range: [0, 8] },
  // ---- atmosphere: quiet pieces between songs, at night, in the country, over the river, in the end years
  rivermist: { id: "rivermist", label: "River mist", atmospheric: true, gain: 1.4, bpm: 56, meter: 4, sub: 2, scale: MAJ, key: 62, prog: [0, 3, 0, 4, 5, 3, 0, 0], lead: "harp", leads: ["harp", "flute", "piano"], comp: "pad", compStyle: "pad", bass: "upright", bassStyle: "none", density: 0.22, range: [0, 11] },
  furnacenight: { id: "furnacenight", label: "Furnaces at night", atmospheric: true, gain: 1.5, bpm: 50, meter: 4, sub: 2, scale: MIN, key: 57, prog: [0, 0, 5, 5, 3, 3, 4, 4], lead: "bell", leads: ["bell", "piano", "clarinet"], comp: "drone", compStyle: "drone", bass: "upright", bassStyle: "none", density: 0.14, range: [0, 9] },
  hillsnow: { id: "hillsnow", label: "Snow on the hillsides", atmospheric: true, gain: 1.6, bpm: 60, meter: 3, sub: 2, scale: MAJ, key: 67, prog: [0, 5, 3, 4, 0, 5, 1, 4], lead: "piano", leads: ["piano", "harp", "bell"], comp: "pad", compStyle: "pad", bass: "upright", bassStyle: "none", density: 0.25, range: [2, 12] },
  sundaybells: { id: "sundaybells", label: "Sunday morning", atmospheric: true, gain: 1.3, bpm: 66, meter: 4, sub: 2, scale: MAJ, key: 64, prog: [0, 3, 4, 0, 5, 3, 4, 0], lead: "bell", leads: ["bell", "flute"], comp: "organ", compStyle: "pad", bass: "upright", bassStyle: "one", density: 0.2, range: [0, 9] },
  smokehaze: { id: "smokehaze", label: "Smoke over the valley", atmospheric: true, gain: 1.5, bpm: 54, meter: 4, sub: 2, scale: DOR, key: 59, prog: [0, 0, 3, 3, 0, 0, 6, 4], lead: "flute", leads: ["flute", "clarinet", "strings"], comp: "drone", compStyle: "drone", bass: "upright", bassStyle: "none", density: 0.18, range: [0, 9] },
  nightshift: { id: "nightshift", label: "Night shift", atmospheric: true, gain: 1.5, bpm: 58, meter: 4, sub: 2, scale: MIN, key: 55, prog: [0, 5, 3, 6, 0, 5, 4, 4], lead: "piano", leads: ["piano", "sax", "harp"], comp: "harmonium", compStyle: "pad", bass: "upright", bassStyle: "one", density: 0.24, range: [0, 10] },
  riverfog: { id: "riverfog", label: "Fog on the Monongahela", atmospheric: true, gain: 1.5, bpm: 52, meter: 4, sub: 2, scale: MIN, key: 52, prog: [0, 6, 5, 6, 0, 3, 4, 0], lead: "clarinet", leads: ["clarinet", "strings", "harp"], comp: "pad", compStyle: "harp", bass: "upright", bassStyle: "none", density: 0.17, range: [2, 10] },
  countryside: { id: "countryside", label: "Fields above the river", atmospheric: true, gain: 1.3, bpm: 70, meter: 3, sub: 2, scale: MAJ, key: 65, prog: [0, 3, 0, 4, 0, 3, 4, 0], lead: "flute", leads: ["flute", "harp", "fiddle"], comp: "harp", compStyle: "harp", bass: "upright", bassStyle: "one", density: 0.3, range: [0, 10] },
  lastlight: { id: "lastlight", label: "Last light", atmospheric: true, gain: 1.0, bpm: 60, meter: 4, sub: 2, scale: MIN, key: 57, prog: [0, 5, 2, 6, 0, 5, 3, 4], lead: "synth", leads: ["synth", "bell", "piano"], comp: "pad", compStyle: "pad", bass: "synthbass", bassStyle: "one", density: 0.18, range: [0, 9] },
  emptymill: { id: "emptymill", label: "The empty mill", atmospheric: true, gain: 1.6, bpm: 48, meter: 4, sub: 2, scale: MIN, key: 50, prog: [0, 0, 5, 5, 3, 3, 4, 4], lead: "piano", leads: ["piano", "strings", "bell"], comp: "drone", compStyle: "drone", bass: "upright", bassStyle: "none", density: 0.13, range: [0, 8] },
  march: { id: "march", label: "Civic brass march", bpm: 112, meter: 2, sub: 2, scale: MAJ, key: 58, prog: [0, 0, 4, 4, 0, 3, 4, 0], lead: "brass", lead2: "brass", comp: "brass", compStyle: "oompah", bass: "tuba", bassStyle: "rootfifth", drums: { kick: "x...", snare: "x.xx" }, density: 0.6, range: [0, 9] },
};

/** Popular music of the day (the city theme when zoomed out). */
export function cityStyle(year: number): string {
  return year < 1870 ? "parlor" : year < 1898 ? "march" : year < 1918 ? "ragtime" : year < 1946 ? "swing" : year < 1958 ? "doowop" : year < 1969 ? "soul" : year < 1980 ? "funk" : "synthpop";
}

/** Music of a community in a given year. */
export function communityStyle(key: string, year: number, variety: number): string {
  if (key === "jazz") return year < 1919 ? "ragtime" : year < 1946 ? "swing" : year < 1960 ? "bebop" : year < 1970 ? "soul" : "funk";
  if (key === "parlor") return year < 1890 ? "parlor" : cityStyle(year);
  // folk traditions persist (polka Sundays on the radio); the young drift to the day's music after WWII
  if (year >= 1946 && variety > 0.6) return cityStyle(year);
  return STYLES[key] ? key : cityStyle(year);
}

// ---------------------------------------------------------------- sequencer

function chordTones(st: Style, deg: number): number[] {
  const s = st.scale, n = s.length;
  const pick = (k: number) => s[(deg + k) % n] + 12 * Math.floor((deg + k) / n);
  const t = [pick(0), pick(2), pick(4)];
  if (st.sevenths) t.push(pick(6));
  return t;
}

function scaleNote(st: Style, step: number): number {
  const n = st.scale.length;
  return st.key + st.scale[((step % n) + n) % n] + 12 * Math.floor(step / n);
}

interface Phrase { notes: { step: number; len: number; deg: number }[] } // deg = scale step (rel. to tonic)

function makePhrase(st: Style, rng: Rng, bars: number, startBar: number): Phrase {
  const spb = st.meter * st.sub;
  const notes: Phrase["notes"] = [];
  let cur = Math.round((st.range[0] + st.range[1]) / 2);
  for (let b = 0; b < bars; b++) {
    const chord = chordTones(st, st.prog[(startBar + b) % st.prog.length]).map((c) => c);
    for (let s = 0; s < spb;) {
      const strong = s % st.sub === 0;
      if (rng.next() > st.density * (strong ? 1.15 : 0.8)) { s++; continue; }
      const len = st.atmospheric ? Math.min(spb - s, st.sub * rng.pick([1, 2, 2, 3, 4])) : rng.chance(0.25) ? Math.min(spb - s, st.sub * (rng.chance(0.5) ? 2 : 1)) : 1;
      if (strong && rng.chance(0.65)) {
        // land on a chord tone near the current note
        const n = st.scale.length;
        let best = cur, bd = 99;
        for (let d = -4; d <= 4; d++) {
          const sc = cur + d, pc = st.scale[((sc % n) + n) % n];
          if (chord.some((c) => ((c % 12) + 12) % 12 === pc % 12) && Math.abs(d) < bd) { bd = Math.abs(d); best = sc; }
        }
        cur = best;
      } else cur += rng.pick([-2, -1, -1, 1, 1, 2, 0, 3, -3]);
      cur = Math.max(st.range[0], Math.min(st.range[1], cur));
      notes.push({ step: b * spb + s, len, deg: cur });
      s += len;
    }
  }
  return { notes };
}

export class MusicPlayer {
  private bar = 0;
  private nextBarTime = 0;
  private phrases: Phrase[] = [];
  private rng: Rng;
  readonly out: GainNode;

  constructor(private ctx: BaseAudioContext, dest: AudioNode, public style: Style, seed: number | string = 1) {
    this.out = ctx.createGain();
    this.out.gain.value = 0;
    this.out.connect(dest);
    this.rng = new Rng(`${seed}:${style.id}`);
  }

  get barLen() { return (60 / this.style.bpm) * this.style.meter; }

  start(t: number, fade = 2) {
    this.nextBarTime = t;
    this.out.gain.cancelScheduledValues(t);
    this.out.gain.setValueAtTime(0.0001, t);
    this.out.gain.linearRampToValueAtTime(this.style.gain ?? 1, t + fade);
  }

  stop(t: number, fade = 2.5) {
    this.out.gain.cancelScheduledValues(t);
    this.out.gain.setValueAtTime(this.out.gain.value || 1, t);
    this.out.gain.linearRampToValueAtTime(0.0001, t + fade);
    setTimeout(() => { try { this.out.disconnect(); } catch { /* already gone */ } }, (fade + 4) * 1000);
  }

  /** Schedule every bar that starts before `until`. */
  schedule(until: number) {
    while (this.nextBarTime < until) {
      this.playBar(this.bar, this.nextBarTime);
      this.nextBarTime += this.barLen;
      this.bar++;
    }
  }

  private phraseFor(bar: number): { ph: Phrase; offset: number } {
    // 16-bar form: A A' B A over 4-bar phrases; new material every 16 bars
    const block = Math.floor(bar / 16);
    if (!this.phrases[block * 3]) {
      const a = makePhrase(this.style, this.rng, 4, 0), b = makePhrase(this.style, this.rng, 4, 8);
      const a2: Phrase = { notes: a.notes.map((n, k) => (k > a.notes.length - 4 ? { ...n, deg: n.deg + this.rng.pick([0, 1, -1]) } : n)) };
      this.phrases[block * 3] = a; this.phrases[block * 3 + 1] = a2; this.phrases[block * 3 + 2] = b;
    }
    const part = Math.floor((bar % 16) / 4);
    const ph = this.phrases[block * 3 + [0, 1, 2, 0][part]];
    return { ph, offset: (bar % 4) };
  }

  private playBar(bar: number, t0: number) {
    const st = this.style, ctx = this.ctx, out = this.out;
    const beat = 60 / st.bpm, stepLen = beat / st.sub, spb = st.meter * st.sub;
    const stepTime = (s: number) => t0 + s * stepLen + (st.swing && st.sub === 2 && s % 2 === 1 ? stepLen * st.swing : 0);
    const deg = st.prog[bar % st.prog.length];
    const chord = chordTones(st, deg);
    const root = st.key - 12 + chord[0];
    const fifth = st.key - 12 + chord[2] - (chord[2] > 12 ? 12 : 0);
    const cv = 0.5;
    // ---- comp
    const playChord = (t: number, dur: number, vel: number, octave = 0) => chord.slice(0, 4).forEach((c) => note(ctx, out, st.comp, t, st.key + c + octave, dur, vel));
    switch (st.compStyle) {
      case "oompah": for (let b = 0; b < st.meter; b++) playChord(stepTime(b * st.sub + Math.floor(st.sub / 2)), stepLen * 0.8, cv); break;
      case "waltz": for (let b = 1; b < st.meter; b++) playChord(stepTime(b * st.sub), beat * 0.7, cv * 0.8); break;
      case "triplets": for (let s = 0; s < spb; s++) if (s % st.sub !== 0 || st.sub === 3) playChord(stepTime(s), stepLen * 0.7, cv * (s % st.sub === 0 ? 0.6 : 0.45)); break;
      case "arp": for (let s = 0; s < spb; s++) note(ctx, out, st.comp, stepTime(s), st.key + chord[s % chord.length] + (s % 6 >= 3 ? 12 : 0), stepLen * 0.9, cv * 0.7); break;
      case "stab": for (const s of st.meter === 4 ? [st.sub * 1, st.sub * 3 + Math.floor(st.sub / 2)] : [st.sub]) playChord(stepTime(s), stepLen * 1.2, cv * 0.7); break;
      case "pad": playChord(t0, beat * st.meter * 0.95, cv * 0.6, -12); break;
      case "drone": if (bar % 2 === 0) { note(ctx, out, st.comp, t0, st.key - 12 + chord[0], beat * st.meter * 2, cv); note(ctx, out, st.comp, t0, st.key - 12 + chord[2], beat * st.meter * 2, cv * 0.6); } break;
      case "harp": chord.slice(0, 3).concat(chord[0] + 12).forEach((c, k) => note(ctx, out, st.comp, t0 + k * (beat * st.meter) / 4, st.key + c - 12, beat * 1.5, cv * 0.6)); break;
      case "stride": for (let b = 0; b < st.meter; b++) { note(ctx, out, st.comp, stepTime(b * st.sub), (b % 2 ? fifth : root), stepLen * 1.5, 0.7); playChord(stepTime(b * st.sub + st.sub / 2), stepLen * 1.4, 0.45); } break;
      case "none": break;
    }
    // ---- bass
    const bassNote = (s: number, m: number, len: number, v = 0.8) => note(ctx, out, st.bass, stepTime(s), m, len, v);
    switch (st.bassStyle) {
      case "rootfifth": for (let b = 0; b < st.meter; b++) bassNote(b * st.sub, b % 2 ? fifth : root, beat * 0.6); break;
      case "one": bassNote(0, root, beat * 0.9); break;
      case "walking": {
        const tones = [root, root + chord[1] - chord[0], fifth, root + (this.rng.chance(0.5) ? 9 : 10)];
        for (let b = 0; b < st.meter; b++) bassNote(b * st.sub, tones[b % 4] + (b === st.meter - 1 ? this.rng.pick([-1, 1, 0]) : 0), beat * 0.85);
        break;
      }
      case "eighths": for (let s = 0; s < spb; s++) bassNote(s, s % 4 === 3 ? fifth : root, stepLen * 0.8, 0.7); break;
      case "funk": { const pat = [0, -1, -1, 3, -1, -1, 0, -1, 12, -1, 0, -1, -1, 10, 7, -1]; pat.forEach((o, s) => { if (o >= 0 && s < spb) bassNote(s, root + o, stepLen * 0.8, s % 4 ? 0.6 : 0.9); }); break; }
      case "none": break;
    }
    // ---- drums
    if (st.drums) for (const [k, pat] of Object.entries(st.drums) as [Drum, string][]) {
      for (let s = 0; s < spb; s++) { const c = pat[s % pat.length]; if (c === "x" || c === "o") drum(ctx, out, k, stepTime(s), c === "x" ? 0.7 : 0.35); }
    }
    // ---- melody (with an occasional harmony line a third below)
    const { ph, offset } = this.phraseFor(bar);
    for (const n of ph.notes) {
      if (Math.floor(n.step / spb) !== offset) continue;
      const s = n.step % spb;
      const t = stepTime(s), len = n.len * stepLen * 0.92;
      note(ctx, out, st.lead, t, scaleNote(st, n.deg) + 12 * (st.lead === "tuba" ? -1 : 0), len, 0.75);
      if (st.lead2 && n.len >= 1 && (bar % 8) >= 4) note(ctx, out, st.lead2, t, scaleNote(st, n.deg - 2), len, 0.5);
    }
  }
}
