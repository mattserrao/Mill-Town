// Sampled instruments (FluidR3_GM, CC BY 3.0 — see public/audio/CREDITS.md): a handful of recorded notes per
// instrument, pitch-shifted to the nearest, looped while a held note sounds. Loaded on demand, one instrument at a
// time; until an instrument has arrived the synth voice plays in its place.

import type { Inst } from "./synth";

/** recorded root notes (MIDI) per instrument; files are public/audio/inst/<inst>/<midi>.mp3 */
const ROOTS: Partial<Record<Inst, number[]>> = {
  fiddle: [57, 62, 67, 72, 77, 82, 87, 92], accordion: [50, 55, 60, 65, 70, 75, 80], clarinet: [52, 57, 62, 67, 72, 77, 82, 87],
  brass: [57, 62, 67, 72, 77, 82], tuba: [31, 37, 43, 49, 55], flute: [62, 67, 72, 77, 82, 87, 92],
  piano: [36, 42, 48, 54, 60, 66, 72, 78, 84, 90], mandolin: [51, 57, 63, 69, 75, 81, 87], cimbalom: [51, 57, 63, 69, 75, 81, 87],
  bass: [31, 37, 43, 49], upright: [31, 37, 43, 49], organ: [39, 45, 51, 57, 63, 69, 75, 81], harmonium: [39, 45, 51, 57, 63, 69, 75, 81],
  sax: [51, 56, 61, 66, 71, 76, 81], eguitar: [43, 49, 55, 61, 67, 73, 79], banjo: [51, 57, 63, 69, 75, 81],
  harp: [39, 45, 51, 57, 63, 69, 75, 81, 87, 93], bell: [58, 64, 70, 76, 82], strings: [39, 45, 51, 57, 63, 69, 75, 81, 87],
};
/** instruments that share another's samples */
const ALIAS: Partial<Record<Inst, Inst>> = { tamburica: "mandolin" };
/** bowed, blown and pumped: loop the middle of the sample while the note is held */
const SUSTAIN = new Set<Inst>(["fiddle", "accordion", "clarinet", "brass", "tuba", "flute", "organ", "harmonium", "sax", "strings"]);
/** level of each instrument, matched (by RMS) to the synth voice it replaces, so the band's balance holds */
export const SAMPLE_GAIN: Partial<Record<Inst, number>> = {
  fiddle: 0.6, accordion: 0.64, clarinet: 0.47, brass: 0.61, tuba: 0.92, flute: 0.61, piano: 0.5, mandolin: 0.3, cimbalom: 0.7,
  bass: 1.97, upright: 1.7, organ: 0.27, harmonium: 0.43, sax: 0.31, eguitar: 0.53, banjo: 0.24, harp: 0.44, bell: 0.44, strings: 0.47,
};
/** attack and release (s) */
const ENV: Partial<Record<Inst, [number, number]>> = {
  fiddle: [0.03, 0.12], accordion: [0.02, 0.08], clarinet: [0.02, 0.1], brass: [0.015, 0.1], tuba: [0.02, 0.1], flute: [0.03, 0.12],
  organ: [0.01, 0.08], harmonium: [0.03, 0.12], sax: [0.02, 0.1], strings: [0.12, 0.5], piano: [0.002, 0.2], bass: [0.003, 0.08],
  upright: [0.003, 0.1], eguitar: [0.002, 0.1], harp: [0.002, 0.6], bell: [0.002, 1.2], mandolin: [0.002, 0.15], banjo: [0.002, 0.12],
  cimbalom: [0.002, 0.4],
};

interface Loaded { roots: number[]; bufs: AudioBuffer[]; loops: [number, number][] }
const loaded = new Map<Inst, Loaded>();
const loading = new Map<Inst, Promise<void>>();
let base = "/";
try { base = (import.meta as unknown as { env?: { BASE_URL?: string } }).env?.BASE_URL ?? "/"; } catch { /* not under vite */ }

const src = (inst: Inst): Inst => ALIAS[inst] ?? inst;
export const hasSamples = (inst: Inst) => !!ROOTS[src(inst)];
export const samplesReady = (inst: Inst) => loaded.has(src(inst));

/** a rising zero crossing near sample index i */
function zeroNear(d: Float32Array, i: number): number {
  for (let k = 0; k < 2000; k++) for (const j of [i + k, i - k]) if (j > 0 && j < d.length && d[j - 1] <= 0 && d[j] > 0) return j;
  return i;
}

/** fetch and decode one instrument's notes (idempotent) */
export function loadInstrument(ctx: BaseAudioContext, inst: Inst): Promise<void> {
  const s = src(inst);
  const roots = ROOTS[s];
  if (!roots) return Promise.resolve();
  let p = loading.get(s);
  if (p) return p;
  p = Promise.all(roots.map(async (m) => {
    const r = await fetch(`${base}audio/inst/${s}/${m}.mp3`);
    if (!r.ok) throw new Error(`${s}/${m}: ${r.status}`);
    return ctx.decodeAudioData(await r.arrayBuffer());
  })).then((bufs) => {
    const loops = bufs.map((b): [number, number] => {
      const d = b.getChannelData(0), sr = b.sampleRate;
      const a = zeroNear(d, Math.floor(Math.min(0.7, b.duration * 0.3) * sr)), e = zeroNear(d, Math.floor(Math.max(b.duration * 0.5, b.duration - 0.45) * sr));
      return [a / sr, e / sr];
    });
    loaded.set(s, { roots, bufs, loops });
  }).catch((e) => { console.warn("samples", e); loading.delete(s); });
  loading.set(s, p);
  return p;
}

/**
 * Play a sampled note. Returns the end time, or 0 when the instrument isn't sampled or hasn't loaded yet
 * (the caller then uses the synth voice).
 */
export function playSample(ctx: BaseAudioContext, out: AudioNode, inst: Inst, t: number, midi: number, dur: number, vel: number): number {
  const s = src(inst);
  const L = loaded.get(s);
  if (!L) return 0;
  let k = 0;
  for (let j = 1; j < L.roots.length; j++) if (Math.abs(L.roots[j] - midi) < Math.abs(L.roots[k] - midi)) k = j;
  const buf = L.bufs[k];
  const node = ctx.createBufferSource();
  node.buffer = buf;
  node.playbackRate.value = 2 ** ((midi - L.roots[k]) / 12);
  const [att, rel] = ENV[s] ?? [0.005, 0.15];
  const sustain = SUSTAIN.has(s);
  const rate = node.playbackRate.value;
  if (sustain && dur > (L.loops[k][1] - 0.05) / rate) { node.loop = true; node.loopStart = L.loops[k][0]; node.loopEnd = L.loops[k][1]; }
  const g = ctx.createGain();
  const peak = vel * (SAMPLE_GAIN[s] ?? 0.3) * (inst === "tamburica" ? 0.9 : 1);
  const p = g.gain;
  p.setValueAtTime(0.0001, t);
  p.linearRampToValueAtTime(peak, t + att);
  // bowed and blown notes swell a little on long notes; plucked and struck ones ring until damped
  if (sustain && dur > 0.6) p.linearRampToValueAtTime(peak * 1.08, t + dur * 0.6);
  const off = t + Math.max(att, dur);
  p.setValueAtTime(sustain && dur > 0.6 ? peak * 1.08 : peak, off);
  p.setTargetAtTime(0.0001, off, rel / 3);
  const natural = buf.duration / rate;
  const end = sustain ? off + rel * 1.5 : Math.min(t + natural, off + rel * 1.5);
  node.connect(g); g.connect(out);
  node.start(t); node.stop(end + 0.02);
  // tremolo picking on long mandolin / tamburica notes
  if ((inst === "mandolin" || inst === "tamburica") && dur > 0.35) {
    for (let q = 0.11; q < dur - 0.05; q += 0.11) {
      const n2 = ctx.createBufferSource(); n2.buffer = buf; n2.playbackRate.value = rate;
      const g2 = ctx.createGain(); g2.gain.setValueAtTime(peak * (0.55 + 0.1 * Math.sin(q * 20)), t + q); g2.gain.setTargetAtTime(0.0001, t + q + 0.08, 0.04);
      n2.connect(g2); g2.connect(out); n2.start(t + q); n2.stop(t + q + 0.3);
    }
  }
  return end;
}
