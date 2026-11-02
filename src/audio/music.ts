// Music: a style per era and per community, played by a small band of sampled instruments.
// A song is a real tune from the tune book (src/audio/tunes, written in ABC) played through the style's band:
// an intro, the tune twice (the second time with a harmony line or another lead), and an ending.
// Styles with no tunes fall back to melodies generated from the style's scale and chords.

import { Rng } from "../core/rng";
import { chordAt, type ParsedTune } from "./abc";
import { drum, type Drum, type Inst, note } from "./synth";

/** the space a style is heard in (sets the reverb) */
export type Room = "hall" | "church" | "parlor" | "club" | "street" | "open";

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
  /** where it's heard (reverb); default from the family */
  room?: Room;
}

const ROOMS: Record<string, Room> = {
  parlor: "parlor", ragtime: "parlor", irish: "hall", oldtime: "hall", german: "hall", polka: "hall", csardas: "hall", slavic: "hall",
  tamburitza: "hall", italian: "hall", klezmer: "hall", swing: "hall", bebop: "club", doowop: "club", soul: "club", funk: "club",
  synthpop: "club", elegy: "church", march: "street", sundaybells: "church", emptymill: "church", furnacenight: "open", nightshift: "parlor",
};
export const roomOf = (st: Style): Room => st.room ?? ROOMS[st.id.split(/[#:]/)[0]] ?? (st.atmospheric ? "open" : "hall");

const MAJ = [0, 2, 4, 5, 7, 9, 11], MIN = [0, 2, 3, 5, 7, 8, 10], HMIN = [0, 2, 3, 5, 7, 8, 11];
const MIX = [0, 2, 4, 5, 7, 9, 10], DOR = [0, 2, 3, 5, 7, 9, 10], HUN = [0, 2, 3, 6, 7, 8, 11], FREY = [0, 1, 4, 5, 7, 8, 10];

export const STYLES: Record<string, Style> = {
  parlor: { id: "parlor", label: "Parlor waltz", gain: 1.3, bpm: 100, meter: 3, sub: 2, scale: MAJ, key: 65, prog: [0, 0, 3, 4, 0, 3, 4, 0], lead: "flute", comp: "piano", compStyle: "waltz", bass: "upright", bassStyle: "one", density: 0.55, range: [0, 9] },
  irish: { id: "irish", label: "Irish jig", bpm: 112, meter: 2, sub: 3, scale: MIX, key: 62, prog: [0, 0, 6, 6, 0, 0, 4, 0], lead: "fiddle", comp: "accordion", compStyle: "triplets", bass: "upright", bassStyle: "one", drums: { bodhran: "x..x.." }, density: 0.9, range: [0, 10] },
  oldtime: { id: "oldtime", label: "Old-time fiddle reel", bpm: 118, meter: 2, sub: 2, scale: MAJ, key: 69, prog: [0, 0, 3, 0, 0, 0, 4, 0], lead: "fiddle", comp: "banjo", compStyle: "oompah", bass: "upright", bassStyle: "rootfifth", density: 0.9, range: [0, 9] },
  german: { id: "german", label: "German brass band", gain: 1.5, bpm: 108, meter: 2, sub: 2, scale: MAJ, key: 58, prog: [0, 0, 4, 4, 4, 4, 0, 0], lead: "brass", lead2: "brass", comp: "brass", compStyle: "oompah", bass: "tuba", bassStyle: "rootfifth", drums: { kick: "x...", snare: "..o." }, density: 0.6, range: [0, 8] },
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
  funk: { id: "funk", label: "Funk & disco", gain: 1.1, bpm: 112, meter: 4, sub: 4, scale: DOR, key: 57, prog: [0, 0, 3, 3], sevenths: true, lead: "synth", comp: "eguitar", compStyle: "stab", bass: "synthbass", bassStyle: "funk", drums: { kick: "x...x...x...x...", snare: "....x.......x...", hat: "..x...x...x...x.", clap: "....x.......x..." }, density: 0.35, range: [0, 8] },
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
  march: { id: "march", label: "Civic brass march", gain: 1.4, bpm: 112, meter: 2, sub: 2, scale: MAJ, key: 58, prog: [0, 0, 4, 4, 0, 3, 4, 0], lead: "brass", lead2: "brass", comp: "brass", compStyle: "oompah", bass: "tuba", bassStyle: "rootfifth", drums: { kick: "x...", snare: "x.xx" }, density: 0.6, range: [0, 9] },
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

/** chord tones (semitones above the style's key) for a scale degree */
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

/** the generated melody (styles with no tunes): seeded motifs, phrased AABA */
function makePhrase(st: Style, rng: Rng, bars: number, startBar: number): Phrase {
  const spb = st.meter * st.sub;
  const notes: Phrase["notes"] = [];
  let cur = Math.round((st.range[0] + st.range[1]) / 2);
  for (let b = 0; b < bars; b++) {
    const chord = chordTones(st, st.prog[(startBar + b) % st.prog.length]);
    for (let s = 0; s < spb;) {
      const strong = s % st.sub === 0;
      if (rng.next() > st.density * (strong ? 1.15 : 0.8)) { s++; continue; }
      const len = st.atmospheric ? Math.min(spb - s, st.sub * rng.pick([1, 2, 2, 3, 4])) : rng.chance(0.25) ? Math.min(spb - s, st.sub * (rng.chance(0.5) ? 2 : 1)) : 1;
      if (strong && rng.chance(0.65)) {
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

/** what the band plays over at a moment: comp chord (absolute MIDI), bass root and fifth */
interface Harm { tones: number[]; root: number; fifth: number; third: number }

/** one bar of the arrangement */
interface Bar {
  len: number;        // beats
  t: number;          // tune beat at the bar's start (tune mode)
  pass: number;       // 0 intro, 1 first time through, 2 second, 3 ending
  stretch: number;    // ritardando
  band: boolean;      // comp, bass and drums play (not in a pickup)
}

export interface PlayerOpts { tune?: ParsedTune; lead2nd?: Inst; seed?: number | string; send?: AudioNode; wet?: number }

export class MusicPlayer {
  private bar = 0;
  private nextBarTime = 0;
  private phrases: Phrase[] = [];
  private rng: Rng;
  private human: Rng;
  readonly out: GainNode;
  private lead: AudioNode;
  private comp: AudioNode;
  private bass: AudioNode;
  private harmony: AudioNode;
  private drums: AudioNode;
  private wet: GainNode | null = null;
  private form: Bar[] | null = null;
  readonly tune?: ParsedTune;
  private lead2nd?: Inst;
  /** length of the arrangement in seconds (tunes); Infinity for generated music */
  readonly duration: number;

  constructor(private ctx: BaseAudioContext, dest: AudioNode, public style: Style, opts: PlayerOpts | number | string = {}) {
    const o: PlayerOpts = typeof opts === "object" ? opts : { seed: opts };
    this.out = ctx.createGain();
    this.out.gain.value = 0;
    this.out.connect(dest);
    if (o.send) { this.wet = ctx.createGain(); this.wet.gain.value = o.wet ?? 0.3; this.out.connect(this.wet); this.wet.connect(o.send); }
    this.rng = new Rng(`${o.seed ?? 1}:${style.id}`);
    this.human = new Rng(`${o.seed ?? 1}:h`);
    // the band spread across the stereo field: lead a little left, harmony and comp right, bass and drums centre
    const pan = (v: number): AudioNode => {
      if (typeof ctx.createStereoPanner !== "function") return this.out;
      const p = ctx.createStereoPanner(); p.pan.value = v; p.connect(this.out); return p;
    };
    this.lead = pan(-0.18); this.harmony = pan(0.3); this.comp = pan(0.26); this.bass = pan(0); this.drums = pan(0.06);
    this.tune = o.tune;
    this.lead2nd = o.lead2nd;
    if (o.tune) {
      this.form = this.arrange(o.tune);
      const beat = 60 / style.bpm;
      this.duration = this.form.reduce((a, b) => a + b.len * b.stretch * beat, 0);
    } else this.duration = Infinity;
  }

  /** intro (two bars on the home chord), the tune twice, a held ending; the last bars slow down */
  private arrange(p: ParsedTune): Bar[] {
    const bpb = p.beatsPerBar;
    const out: Bar[] = [];
    const pickup = p.bars.length > 1 && p.bars[0].len < bpb - 1e-6;
    for (let k = 0; k < 2; k++) out.push({ len: bpb, t: -1, pass: 0, stretch: 1, band: true });
    for (const pass of [1, 2]) p.bars.forEach((b, k) => {
      if (pass === 2 && k === 0 && pickup) return; // the pickup leads in once; the second time the last bar's tail covers it
      out.push({ len: b.len, t: b.t, pass, stretch: 1, band: !(k === 0 && pickup) });
    });
    out.push({ len: bpb, t: Infinity, pass: 3, stretch: 1.3, band: true });
    const n = out.length;
    if (n > 4) { out[n - 3].stretch = 1.06; out[n - 2].stretch = 1.14; }
    return out;
  }

  get barLen() { return (60 / this.style.bpm) * this.style.meter; }

  /** when the current phrase ends (a good place to change tracks) */
  nextPhraseTime(): number {
    const beat = 60 / this.style.bpm;
    let t = this.nextBarTime, b = this.bar;
    for (let k = 0; k < 8 && b % 4 !== 0; k++, b++) t += this.barDur(b, beat);
    return t;
  }

  private barDur(b: number, beat = 60 / this.style.bpm): number {
    if (this.form) { const x = this.form[Math.min(b, this.form.length - 1)]; return x.len * x.stretch * beat; }
    return beat * this.style.meter;
  }

  start(t: number, fade = 2) {
    this.nextBarTime = t;
    this.out.gain.cancelScheduledValues(t);
    this.out.gain.setValueAtTime(0.0001, t);
    this.out.gain.linearRampToValueAtTime(this.style.gain ?? 1, t + fade);
  }

  stop(t: number, fade = 2.5) {
    this.out.gain.cancelScheduledValues(t);
    this.out.gain.setValueAtTime(Math.max(0.0001, this.out.gain.value || 1), t);
    this.out.gain.linearRampToValueAtTime(0.0001, t + fade);
    this.stopAt = t + fade;
    const ms = Math.max(0, (t - this.ctx.currentTime + fade + 4) * 1000);
    setTimeout(() => { try { this.out.disconnect(); this.wet?.disconnect(); } catch { /* already gone */ } }, ms);
  }
  private stopAt = Infinity;
  /** nothing more to play (faded out, or the song is over and its last notes have rung) */
  done(now: number) { return now > this.stopAt + 1 || (!!this.form && this.bar >= this.form.length && now > this.nextBarTime + 4); }

  /** Schedule every bar that starts before `until`. */
  schedule(until: number) {
    while (this.nextBarTime < until && this.nextBarTime < this.stopAt) {
      if (this.form && this.bar >= this.form.length) return; // the song is over
      const d = this.barDur(this.bar);
      if (this.form) this.playTuneBar(this.form[this.bar], this.nextBarTime);
      else this.playBar(this.bar, this.nextBarTime);
      this.nextBarTime += d;
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

  // ------------------------------------------------------------ the band

  /** a played note: a hair off the grid, louder on the strong beats */
  private play(dest: AudioNode, inst: Inst, t: number, midi: number, dur: number, vel: number, strong = false) {
    const h = this.human;
    const jitter = (h.next() - 0.5) * 0.016;
    const v = Math.max(0.05, Math.min(1, vel * (strong ? 1.12 : 0.94) * (0.92 + h.next() * 0.16)));
    note(this.ctx, dest, inst, Math.max(this.ctx.currentTime, t + jitter), midi, dur, v);
  }

  /** comp, bass and drums for one bar; `harmAt(beat)` gives the harmony at a beat of the bar */
  private band(t0: number, beats: number, stretch: number, harmAt: (beat: number) => Harm, bar: number, opts: { ending?: boolean } = {}) {
    const st = this.style;
    const beat = (60 / st.bpm) * stretch, sub = st.sub, stepLen = beat / sub, spb = Math.round(beats * sub);
    const stepTime = (s: number) => t0 + s * stepLen + (st.swing && sub === 2 && s % 2 === 1 ? stepLen * st.swing : 0);
    const cv = 0.5, nb = Math.max(1, Math.round(beats));
    const chordAtStep = (s: number) => harmAt(s / sub);
    const playChord = (s: number, dur: number, vel: number, octave = 0) => { const hm = chordAtStep(s); hm.tones.slice(0, 4).forEach((m) => this.play(this.comp, st.comp, stepTime(s), m + octave, dur, vel, s % (sub * 2) === 0)); };
    if (opts.ending) {
      const hm = harmAt(0);
      hm.tones.forEach((m) => this.play(this.comp, st.comp, t0, m, beat * beats, cv * 0.8));
      if (st.bassStyle !== "none") this.play(this.bass, st.bass, t0, hm.root, beat * beats * 0.9, 0.85, true);
      if (st.drums) for (const k of Object.keys(st.drums) as Drum[]) if (k === "kick" || k === "bodhran") drum(this.ctx, this.drums, k, t0, 0.6);
      return;
    }
    switch (st.compStyle) {
      case "oompah": for (let b = 0; b < nb; b++) playChord(b * sub + Math.floor(sub / 2), stepLen * 0.8, cv); break;
      case "waltz": for (let b = 1; b < nb; b++) playChord(b * sub, beat * 0.7, cv * 0.8); break;
      case "triplets": for (let s = 0; s < spb; s++) if (s % sub !== 0 || sub === 3) playChord(s, stepLen * 0.7, cv * (s % sub === 0 ? 0.6 : 0.45)); break;
      case "arp": for (let s = 0; s < spb; s++) { const hm = chordAtStep(s); this.play(this.comp, st.comp, stepTime(s), hm.tones[s % hm.tones.length] + (s % 6 >= 3 ? 12 : 0), stepLen * 0.9, cv * 0.7, s % sub === 0); } break;
      case "stab": for (const s of nb === 4 ? [sub * 1, sub * 3 + Math.floor(sub / 2)] : [sub]) if (s < spb) playChord(s, stepLen * 1.2, cv * 0.7); break;
      case "pad": { const half = nb >= 4 ? 2 : nb; for (let b = 0; b < nb; b += half) playChord(b * sub, beat * half * 0.95, cv * 0.6, -12); break; }
      case "drone": if (bar % 2 === 0) { const hm = harmAt(0); this.play(this.comp, st.comp, t0, hm.root, beat * nb * 2, cv); this.play(this.comp, st.comp, t0, hm.fifth, beat * nb * 2, cv * 0.6); } break;
      case "harp": { const hm = harmAt(0); [hm.root + 12, hm.third + 12, hm.fifth + 12, hm.root + 24].forEach((m, k) => this.play(this.comp, st.comp, t0 + k * (beat * nb) / 4, m, beat * 1.5, cv * 0.6)); break; }
      case "stride": for (let b = 0; b < nb; b++) { const hm = harmAt(b); this.play(this.comp, st.comp, stepTime(b * sub), b % 2 ? hm.fifth : hm.root, stepLen * 1.5, 0.7, true); playChord(b * sub + sub / 2, stepLen * 1.4, 0.45); } break;
      case "none": break;
    }
    const bassNote = (s: number, m: number, len: number, v = 0.8) => this.play(this.bass, st.bass, stepTime(s), m, len, v, s === 0);
    switch (st.bassStyle) {
      case "rootfifth": for (let b = 0; b < nb; b++) { const hm = harmAt(b); bassNote(b * sub, b % 2 ? hm.fifth : hm.root, beat * 0.6); } break;
      case "one": bassNote(0, harmAt(0).root, beat * 0.9); break;
      case "walking": {
        for (let b = 0; b < nb; b++) {
          const hm = harmAt(b), next = harmAt(b + 1);
          const tones = [hm.root, hm.third, hm.fifth, hm.root + (this.rng.chance(0.5) ? 9 : 10)];
          // the last beat leans into the next chord by a half step
          const m = b === nb - 1 ? next.root + (this.rng.chance(0.5) ? -1 : 1) : tones[b % 4];
          bassNote(b * sub, m, beat * 0.85);
        }
        break;
      }
      case "eighths": for (let s = 0; s < spb; s++) { const hm = chordAtStep(s); bassNote(s, s % 4 === 3 ? hm.fifth : hm.root, stepLen * 0.8, 0.7); } break;
      case "funk": { const pat = [0, -1, -1, 3, -1, -1, 0, -1, 12, -1, 0, -1, -1, 10, 7, -1]; pat.forEach((o, s) => { if (o >= 0 && s < spb) bassNote(s, chordAtStep(s).root + o, stepLen * 0.8, s % 4 ? 0.6 : 0.9); }); break; }
      case "none": break;
    }
    if (st.drums) for (const [k, pat] of Object.entries(st.drums) as [Drum, string][]) {
      for (let s = 0; s < spb; s++) {
        const c = pat[s % pat.length];
        if (c === "x" || c === "o") drum(this.ctx, this.drums, k, Math.max(0, stepTime(s) + (this.human.next() - 0.5) * 0.006), (c === "x" ? 0.7 : 0.35) * (0.9 + this.human.next() * 0.2));
      }
      // a fill into the next section every eighth bar
      if (bar % 8 === 7 && k === "snare") for (let s = spb - sub; s < spb; s++) drum(this.ctx, this.drums, "snare", stepTime(s), 0.3 + 0.1 * (s - spb + sub));
    }
  }

  /** a style's own harmony (generated mode) */
  private styleHarm(deg: number): Harm {
    const st = this.style, chord = chordTones(st, deg);
    const root = st.key - 12 + chord[0];
    return { tones: chord.map((c) => st.key + c), root, fifth: st.key - 12 + chord[2] - (chord[2] > 12 ? 12 : 0), third: st.key - 12 + chord[1] };
  }

  /** a tune's harmony at a tune beat: comp voiced around the style's key, bass in the low register */
  private tuneHarm(t: number): Harm {
    const tune = this.tune!;
    const ch = chordAt(tune, t) ?? { root: tune.tonic, tones: tune.minor ? [0, 3, 7] : [0, 4, 7], t: 0 };
    const st = this.style;
    const lo = st.key - 7; // comp root within a fifth below the key centre
    const root = lo + ((ch.root - lo) % 12 + 12) % 12;
    const bassRoot = 36 + ((ch.root - 36) % 12 + 12) % 12;
    return { tones: ch.tones.map((x) => root + x), root: bassRoot, fifth: bassRoot + (ch.tones[2] ?? 7) - (bassRoot + (ch.tones[2] ?? 7) > 50 ? 12 : 0), third: bassRoot + (ch.tones[1] ?? 4) };
  }

  private playTuneBar(b: Bar, t0: number) {
    const st = this.style, tune = this.tune!;
    const beat = (60 / st.bpm) * b.stretch;
    const home = (): Harm => this.tuneHarm(tune.chords.length ? tune.chords[tune.chords.length - 1].t : 0);
    if (b.pass === 0) { const h = this.tuneHarm(0); this.band(t0, b.len, b.stretch, () => h, this.bar); return; }
    if (b.pass === 3) {
      const h = home();
      this.band(t0, b.len, b.stretch, () => h, this.bar, { ending: true });
      // the melody's last note again, held
      const last = tune.notes[tune.notes.length - 1];
      if (last) this.play(this.lead, st.lead, t0, last.midi + (st.lead === "tuba" ? -12 : 0), beat * b.len * 0.9, 0.7, true);
      return;
    }
    if (b.band) this.band(t0, b.len, b.stretch, (x) => this.tuneHarm(b.t + Math.min(x, b.len - 0.01)), this.bar);
    // the melody: the second time through, another lead or a harmony line a third below
    const lead = b.pass === 2 && this.lead2nd ? this.lead2nd : st.lead;
    const harmonize = b.pass === 2 && !!st.lead2;
    const swing = st.swing && st.sub === 2 ? st.swing : 0;
    for (const n of notesIn(tune, b.t, b.t + b.len)) {
      const rel = n.t - b.t;
      const off = swing && Math.abs((rel * 2) % 2 - 1) < 0.01 ? swing * 0.5 : 0; // swung eighths
      const t = t0 + (rel + off) * beat, dur = Math.max(0.06, n.dur * beat * 0.93);
      const strong = Math.abs(rel - Math.round(rel)) < 0.01;
      const m = n.midi + (lead === "tuba" ? -12 : 0);
      this.play(this.lead, lead, t, m, dur, 0.74, strong);
      if (harmonize && n.dur >= 0.4) {
        const hm = this.tuneHarm(n.t);
        const below = hm.tones.map((x) => { let y = x; while (y > m - 3) y -= 12; while (y < m - 12) y += 12; return y; }).filter((y) => y <= m - 3);
        if (below.length) this.play(this.harmony, st.lead2!, t, Math.max(...below), dur, 0.45);
      }
    }
  }

  private playBar(bar: number, t0: number) {
    const st = this.style;
    const beat = 60 / st.bpm, stepLen = beat / st.sub, spb = st.meter * st.sub;
    const stepTime = (s: number) => t0 + s * stepLen + (st.swing && st.sub === 2 && s % 2 === 1 ? stepLen * st.swing : 0);
    const h = this.styleHarm(st.prog[bar % st.prog.length]);
    this.band(t0, st.meter, 1, () => h, bar);
    const { ph, offset } = this.phraseFor(bar);
    for (const n of ph.notes) {
      if (Math.floor(n.step / spb) !== offset) continue;
      const s = n.step % spb;
      const t = stepTime(s), len = n.len * stepLen * 0.92;
      this.play(this.lead, st.lead, t, scaleNote(st, n.deg) + 12 * (st.lead === "tuba" ? -1 : 0), len, 0.75, s % st.sub === 0);
      if (st.lead2 && n.len >= 1 && (bar % 8) >= 4) this.play(this.harmony, st.lead2, t, scaleNote(st, n.deg - 2), len, 0.5);
    }
  }
}

/** a tune's notes starting in [a, b) */
function notesIn(p: ParsedTune, a: number, b: number) {
  const out = [];
  let lo = 0, hi = p.notes.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (p.notes[mid].t < a - 1e-6) lo = mid + 1; else hi = mid; }
  for (let k = lo; k < p.notes.length && p.notes[k].t < b - 1e-6; k++) out.push(p.notes[k]);
  return out;
}
