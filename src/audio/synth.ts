// Small Web Audio instrument set, all synthesized: no samples. Works on AudioContext and OfflineAudioContext.

export type Inst =
  | "fiddle" | "accordion" | "clarinet" | "brass" | "tuba" | "flute" | "piano" | "mandolin" | "tamburica"
  | "cimbalom" | "bass" | "upright" | "organ" | "sax" | "eguitar" | "synth" | "synthbass" | "harmonium" | "banjo";

export type Drum = "kick" | "snare" | "hat" | "ohat" | "brush" | "bodhran" | "tamb" | "clap";

let noiseBuf: AudioBuffer | null = null;
function noise(ctx: BaseAudioContext): AudioBuffer {
  if (noiseBuf && noiseBuf.sampleRate === ctx.sampleRate) return noiseBuf;
  const b = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
  const d = b.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  noiseBuf = b;
  return b;
}
export function noiseSource(ctx: BaseAudioContext, loop = true): AudioBufferSourceNode {
  const s = ctx.createBufferSource();
  s.buffer = noise(ctx);
  s.loop = loop;
  return s;
}

export const mtof = (m: number) => 440 * Math.pow(2, (m - 69) / 12);

function env(g: GainNode, t: number, a: number, d: number, s: number, dur: number, r: number, peak: number) {
  const p = g.gain;
  p.setValueAtTime(0.0001, t);
  p.linearRampToValueAtTime(peak, t + a);
  p.linearRampToValueAtTime(peak * s, t + a + d);
  p.setValueAtTime(peak * s, t + Math.max(a + d, dur));
  p.exponentialRampToValueAtTime(0.0001, t + Math.max(a + d, dur) + r);
}

/** Play one note. Returns end time. */
export function note(ctx: BaseAudioContext, out: AudioNode, inst: Inst, t: number, midi: number, dur: number, vel = 0.7): number {
  const f = mtof(midi);
  const g = ctx.createGain();
  g.connect(out);
  const osc = (type: OscillatorType, freq: number, detune = 0) => {
    const o = ctx.createOscillator();
    o.type = type; o.frequency.value = freq; o.detune.value = detune;
    return o;
  };
  const vib = (o: OscillatorNode, rate: number, depth: number, delay = 0.12) => {
    const l = ctx.createOscillator(), lg = ctx.createGain();
    l.frequency.value = rate; lg.gain.setValueAtTime(0, t); lg.gain.linearRampToValueAtTime(depth, t + delay + 0.1);
    l.connect(lg); lg.connect(o.frequency); l.start(t); l.stop(t + dur + 0.6);
  };
  const filt = (type: BiquadFilterType, freq: number, q = 0.8) => { const b = ctx.createBiquadFilter(); b.type = type; b.frequency.value = freq; b.Q.value = q; return b; };
  const start = (nodes: OscillatorNode[], end: number) => nodes.forEach((o) => { o.start(t); o.stop(end); });
  let end = t + dur + 0.4;
  switch (inst) {
    case "fiddle": {
      const o = osc("sawtooth", f); vib(o, 5.8, f * 0.012);
      const b = filt("bandpass", Math.min(4000, f * 3), 0.9), l = filt("lowpass", 3800);
      o.connect(b); b.connect(l); l.connect(g);
      env(g, t, 0.04, 0.08, 0.8, dur, 0.12, vel * 0.32); start([o], end);
      break;
    }
    case "accordion": case "harmonium": {
      const o1 = osc("square", f, -7), o2 = osc("sawtooth", f, 8), o3 = osc("square", f * 2, 3);
      const l = filt("lowpass", inst === "accordion" ? 2200 : 1400);
      const m = ctx.createGain(); m.gain.value = 0.5;
      [o1, o2].forEach((o) => o.connect(l)); o3.connect(m); m.connect(l); l.connect(g);
      env(g, t, 0.03, 0.05, 0.85, dur, 0.08, vel * 0.13); start([o1, o2, o3], end);
      break;
    }
    case "clarinet": case "sax": {
      const o = osc(inst === "clarinet" ? "square" : "sawtooth", f); vib(o, 5, f * 0.008, 0.2);
      const l = filt("lowpass", inst === "clarinet" ? f * 4 : f * 5, inst === "sax" ? 3 : 1);
      o.connect(l); l.connect(g);
      env(g, t, 0.05, 0.1, 0.8, dur, 0.1, vel * (inst === "sax" ? 0.18 : 0.2)); start([o], end);
      break;
    }
    case "brass": case "tuba": {
      const o = osc("sawtooth", f), o2 = osc("sawtooth", f, 6);
      const l = filt("lowpass", 400, 1.5);
      l.frequency.setValueAtTime(inst === "tuba" ? 200 : 500, t);
      l.frequency.linearRampToValueAtTime(inst === "tuba" ? 600 : f * 5, t + 0.06);
      l.frequency.linearRampToValueAtTime(inst === "tuba" ? 350 : f * 3, t + 0.25);
      o.connect(l); o2.connect(l); l.connect(g);
      env(g, t, 0.04, 0.1, 0.75, dur, 0.1, vel * (inst === "tuba" ? 0.35 : 0.17)); start([o, o2], end);
      break;
    }
    case "flute": {
      const o = osc("sine", f); vib(o, 5, f * 0.006, 0.2);
      const n = noiseSource(ctx, false), nb = filt("bandpass", f * 2, 4), ng = ctx.createGain(); ng.gain.value = 0.04;
      n.connect(nb); nb.connect(ng); ng.connect(g); n.start(t); n.stop(end);
      o.connect(g); env(g, t, 0.06, 0.1, 0.8, dur, 0.12, vel * 0.25); start([o], end);
      break;
    }
    case "piano": case "banjo": case "mandolin": case "tamburica": case "cimbalom": {
      const plucky = inst !== "piano";
      const o1 = osc(inst === "banjo" ? "sawtooth" : "triangle", f), o2 = osc("sine", f * 2, plucky ? 4 : 1);
      const l = filt("lowpass", inst === "piano" ? 3000 : inst === "banjo" ? 4500 : 3500);
      const m2 = ctx.createGain(); m2.gain.value = plucky ? 0.35 : 0.25;
      o1.connect(l); o2.connect(m2); m2.connect(l); l.connect(g);
      const decay = inst === "piano" ? 1.2 : inst === "cimbalom" ? 0.9 : 0.35;
      g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(vel * (plucky ? 0.28 : 0.3), t + 0.005);
      g.gain.exponentialRampToValueAtTime(0.0001, t + Math.min(decay, dur + decay * 0.5));
      end = t + decay + 0.05;
      start([o1, o2], end);
      if (inst === "mandolin" || inst === "tamburica") {
        // tremolo picking on long notes
        for (let k = 0.12; k < dur - 0.05; k += 0.12) {
          const og = ctx.createGain(); og.connect(out);
          const ox = osc("triangle", f); ox.connect(og);
          og.gain.setValueAtTime(0.0001, t + k); og.gain.linearRampToValueAtTime(vel * 0.16, t + k + 0.005); og.gain.exponentialRampToValueAtTime(0.0001, t + k + 0.15);
          ox.start(t + k); ox.stop(t + k + 0.2);
        }
        end = t + dur + 0.2;
      }
      break;
    }
    case "bass": case "upright": case "synthbass": {
      const o = osc(inst === "synthbass" ? "sawtooth" : "triangle", f), s = osc("sine", f);
      const l = filt("lowpass", inst === "synthbass" ? 900 : 600, inst === "synthbass" ? 6 : 1);
      if (inst === "synthbass") { l.frequency.setValueAtTime(1800, t); l.frequency.exponentialRampToValueAtTime(300, t + 0.2); }
      o.connect(l); s.connect(l); l.connect(g);
      g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(vel * 0.45, t + 0.01);
      g.gain.exponentialRampToValueAtTime(Math.max(1e-4, vel * 0.2), t + Math.min(dur, 0.3));
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.08);
      end = t + dur + 0.1; start([o, s], end);
      break;
    }
    case "organ": {
      const os = [osc("sine", f), osc("sine", f * 2), osc("sine", f * 3, 2), osc("sine", f / 2)];
      const gs = [0.5, 0.3, 0.15, 0.25].map((v) => { const x = ctx.createGain(); x.gain.value = v; return x; });
      os.forEach((o, k) => { o.connect(gs[k]); gs[k].connect(g); });
      env(g, t, 0.02, 0.05, 0.9, dur, 0.06, vel * 0.18); start(os, end);
      break;
    }
    case "eguitar": {
      const o = osc("sawtooth", f), o2 = osc("square", f, 7);
      const sh = ctx.createWaveShaper(); const c = new Float32Array(256); for (let i = 0; i < 256; i++) { const x = i / 128 - 1; c[i] = Math.tanh(x * 3); } sh.curve = c;
      const l = filt("lowpass", 2500, 1.5);
      o.connect(sh); o2.connect(sh); sh.connect(l); l.connect(g);
      g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(vel * 0.12, t + 0.008); g.gain.exponentialRampToValueAtTime(Math.max(1e-4, vel * 0.05), t + dur); g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.15);
      start([o, o2], end);
      break;
    }
    case "synth": {
      const o1 = osc("sawtooth", f, -10), o2 = osc("sawtooth", f, 10), o3 = osc("square", f / 2);
      const l = filt("lowpass", 1800, 2);
      l.frequency.setValueAtTime(3500, t); l.frequency.exponentialRampToValueAtTime(900, t + 0.4);
      [o1, o2, o3].forEach((o) => o.connect(l)); l.connect(g);
      env(g, t, 0.01, 0.2, 0.6, dur, 0.2, vel * 0.09); start([o1, o2, o3], end);
      break;
    }
  }
  return end;
}

export function drum(ctx: BaseAudioContext, out: AudioNode, kind: Drum, t: number, vel = 0.7) {
  const g = ctx.createGain(); g.connect(out);
  if (kind === "kick" || kind === "bodhran") {
    const o = ctx.createOscillator(); o.type = "sine";
    const f0 = kind === "kick" ? 120 : 160;
    o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(kind === "kick" ? 45 : 70, t + 0.12);
    o.connect(g);
    g.gain.setValueAtTime(vel * (kind === "kick" ? 0.8 : 0.5), t); g.gain.exponentialRampToValueAtTime(0.0001, t + (kind === "kick" ? 0.25 : 0.18));
    o.start(t); o.stop(t + 0.3);
    return;
  }
  const n = noiseSource(ctx, false);
  const b = ctx.createBiquadFilter();
  const cfg: Record<string, [BiquadFilterType, number, number, number]> = {
    snare: ["bandpass", 1800, 0.18, 0.45], hat: ["highpass", 7000, 0.05, 0.18], ohat: ["highpass", 6500, 0.25, 0.15],
    brush: ["bandpass", 3500, 0.12, 0.12], tamb: ["highpass", 8000, 0.12, 0.2], clap: ["bandpass", 1200, 0.12, 0.4],
  };
  const [type, freq, len, amp] = cfg[kind];
  b.type = type; b.frequency.value = freq;
  n.connect(b); b.connect(g);
  g.gain.setValueAtTime(vel * amp, t); g.gain.exponentialRampToValueAtTime(0.0001, t + len);
  n.start(t); n.stop(t + len + 0.02);
  if (kind === "snare") { const o = ctx.createOscillator(); o.frequency.value = 190; const og = ctx.createGain(); o.connect(og); og.connect(out); og.gain.setValueAtTime(vel * 0.25, t); og.gain.exponentialRampToValueAtTime(0.0001, t + 0.1); o.start(t); o.stop(t + 0.12); }
}
