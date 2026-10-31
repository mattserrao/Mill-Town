// Ambient sound: continuous beds (wind, river, mill rumble, town murmur, traffic) mixed by what's on screen
// and how close the camera is, plus one-shot sounds (whistles, bells, hooves, horns, hammers, birds).

import { mtof, noiseSource } from "./synth";

export interface Scene {
  zoom: number;
  year: number;
  season: string;
  night: number;
  water: number;     // share of the view that's river
  industry: number;  // running works in view (0..1)
  town: number;      // houses/streets in view (0..1)
  country: number;   // farms and woods (0..1)
  churches: number;  // churches in view
  trains: number;    // trains on screen
  boats: number;     // boats on screen
  traffic: number;   // street vehicles on screen
}

interface Bed { src: AudioScheduledSourceNode; gain: GainNode; filt: BiquadFilterNode; lfo?: OscillatorNode }

export class Soundscape {
  readonly out: GainNode;
  private beds: Record<string, Bed> = {};
  private nextEvent: Record<string, number> = {};

  constructor(private ctx: BaseAudioContext, dest: AudioNode) {
    this.out = ctx.createGain();
    this.out.connect(dest);
    const t = ctx.currentTime;
    this.beds.wind = this.bed("lowpass", 500, 0.5, 0.08, 0.6);
    this.beds.river = this.bed("bandpass", 650, 0.7, 0.35, 0.35);
    this.beds.mill = this.bed("lowpass", 140, 1.2, 0.5, 0.15);
    this.beds.murmur = this.bed("bandpass", 900, 0.6, 2.2, 0.5);
    this.beds.hum = this.bed("lowpass", 260, 0.7, 0.2, 0.2);
    this.beds.furnace = this.bed("bandpass", 320, 0.5, 6, 0.35);
    void t;
  }

  private bed(type: BiquadFilterType, freq: number, q: number, lfoRate: number, lfoDepth: number): Bed {
    const ctx = this.ctx;
    const src = noiseSource(ctx);
    const filt = ctx.createBiquadFilter(); filt.type = type; filt.frequency.value = freq; filt.Q.value = q;
    const gain = ctx.createGain(); gain.gain.value = 0;
    const am = ctx.createGain(); am.gain.value = 1;
    const lfo = ctx.createOscillator(); lfo.frequency.value = lfoRate;
    const lg = ctx.createGain(); lg.gain.value = lfoDepth;
    lfo.connect(lg); lg.connect(am.gain);
    src.connect(filt); filt.connect(am); am.connect(gain); gain.connect(this.out);
    src.start(); lfo.start();
    return { src, gain, filt, lfo };
  }

  /** Set bed levels and fire one-shots for the scene. Call a few times a second. */
  update(s: Scene) {
    const t = this.ctx.currentTime;
    const near = Math.min(1, Math.max(0, (s.zoom - 0.2) / 1.0)); // 0 far … 1 close
    const far = 1 - near;
    const set = (k: string, v: number, time = 1.5) => { const g = this.beds[k].gain.gain; g.cancelScheduledValues(t); g.setTargetAtTime(Math.max(0, v), t, time / 3); };
    const winter = s.season === "Winter";
    set("wind", 0.05 + far * 0.18 + s.country * 0.06 + (winter ? 0.08 : 0));
    set("river", s.water * (0.08 + near * 0.25));
    set("mill", s.industry * (0.18 + near * 0.6));
    set("furnace", s.industry * near * 0.25);
    set("murmur", s.town * near * (s.night > 0.5 ? 0.04 : 0.14));
    set("hum", s.year >= 1925 ? s.town * (0.04 + near * 0.08) * Math.min(1, (s.year - 1925) / 25 + 0.3) : 0);

    const every = (k: string, mean: number, fire: () => void) => {
      if (mean <= 0 || !isFinite(mean)) return;
      if (this.nextEvent[k] === undefined) this.nextEvent[k] = t + Math.random() * mean;
      if (t >= this.nextEvent[k]) { fire(); this.nextEvent[k] = t + mean * (0.5 + Math.random()); }
    };
    const vol = (x: number) => Math.min(1, x);
    if (s.industry > 0.05) every("clank", 2.5 / (s.industry * (0.3 + near)), () => this.clank(vol(s.industry * (0.3 + near * 0.7))));
    if (s.industry > 0.05 && near > 0.3) every("hiss", 9, () => this.hiss(vol(s.industry * near)));
    if (s.industry > 0.05) every("mill_whistle", 45, () => this.whistle(s.year < 1900 ? 480 : 380, 2.2, vol(0.5 * s.industry + 0.1), s.year >= 1900));
    if (s.boats > 0) every("boat", 30 / s.boats, () => (s.year < 1935 ? this.whistle(330, 1.6, vol(0.25 + near * 0.3), false, 415) : this.horn(110, 2.2, vol(0.25 + near * 0.3))));
    if (s.trains > 0) every("train", 25 / s.trains, () => (s.year < 1950 ? this.whistle(523, 2.5, vol(0.2 + near * 0.3), true, 659) : this.horn(233, 1.8, vol(0.25 + near * 0.3), 277)));
    if (s.town > 0.1 && near > 0.35) {
      if (s.year < 1920) every("hooves", 3 / (s.town * near), () => this.hooves(vol(near * 0.5)));
      if (s.year >= 1890 && s.year < 1955) every("streetcar", 14 / s.town, () => this.bell(1568, 0.18, vol(near * 0.3), 2));
      if (s.year >= 1915 && s.traffic > 0) every("carhorn", 18 / (s.traffic / 20 + 0.2), () => this.horn(s.year < 1940 ? 415 : 350, 0.35, vol(near * 0.25), s.year < 1940 ? undefined : 440));
      if (s.night < 0.5) every("voices", 6 / s.town, () => this.voice(vol(near * 0.12)));
    }
    if (s.churches > 0) every("bells", 40 / s.churches, () => this.churchBells(vol(0.2 + near * 0.3)));
    if (s.country > 0.2 && s.night < 0.5 && !winter) every("bird", 3 / s.country, () => this.bird(vol(0.1 + near * 0.15)));
    if (s.night > 0.5 && s.season === "Summer" && s.country + s.town > 0.2) every("cricket", 0.8, () => this.cricket(vol(0.08 + near * 0.08)));
  }

  // ------------------------------------------------------------ one-shots
  private g(v: number, t: number) { const g = this.ctx.createGain(); g.gain.value = v; g.connect(this.out); void t; return g; }

  private clank(v: number) {
    const ctx = this.ctx, t = ctx.currentTime + 0.01;
    const out = this.g(1, t);
    for (const f of [180, 393, 717, 1140]) {
      const o = ctx.createOscillator(); o.frequency.value = f * (0.9 + Math.random() * 0.2); o.type = "square";
      const g = ctx.createGain(); g.gain.setValueAtTime(v * 0.05, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.35 + Math.random() * 0.3);
      o.connect(g); g.connect(out); o.start(t); o.stop(t + 0.7);
    }
  }

  private hiss(v: number) {
    const ctx = this.ctx, t = ctx.currentTime + 0.01;
    const n = noiseSource(ctx, false), f = ctx.createBiquadFilter(); f.type = "highpass"; f.frequency.value = 3000;
    const g = this.g(0, t); g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(v * 0.12, t + 0.2); g.gain.exponentialRampToValueAtTime(0.0001, t + 2.2);
    n.connect(f); f.connect(g); n.start(t); n.stop(t + 2.4);
  }

  /** steam whistle: one or two tones with a breathy attack */
  private whistle(f: number, dur: number, v: number, chord: boolean, f2?: number) {
    const ctx = this.ctx, t = ctx.currentTime + 0.02;
    const g = this.g(0, t);
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(v * 0.12, t + 0.15); g.gain.setValueAtTime(v * 0.12, t + dur); g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.6);
    for (const fr of chord ? [f, f * 1.26, f * 1.5] : [f, f2 ?? f]) {
      const o = ctx.createOscillator(); o.type = "triangle"; o.frequency.setValueAtTime(fr * 0.94, t); o.frequency.linearRampToValueAtTime(fr, t + 0.2);
      o.connect(g); o.start(t); o.stop(t + dur + 0.7);
    }
    const n = noiseSource(ctx, false), bf = ctx.createBiquadFilter(); bf.type = "bandpass"; bf.frequency.value = f * 2; bf.Q.value = 2;
    const ng = ctx.createGain(); ng.gain.value = 0.4; n.connect(bf); bf.connect(ng); ng.connect(g); n.start(t); n.stop(t + dur + 0.7);
  }

  private horn(f: number, dur: number, v: number, f2?: number) {
    const ctx = this.ctx, t = ctx.currentTime + 0.02;
    const g = this.g(0, t);
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(v * 0.1, t + 0.05); g.gain.setValueAtTime(v * 0.1, t + dur); g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.2);
    const lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 1400; lp.connect(g);
    for (const fr of f2 ? [f, f2] : [f]) { const o = ctx.createOscillator(); o.type = "sawtooth"; o.frequency.value = fr; o.connect(lp); o.start(t); o.stop(t + dur + 0.3); }
  }

  private bell(f: number, dur: number, v: number, times = 1) {
    const ctx = this.ctx;
    for (let k = 0; k < times; k++) {
      const t = ctx.currentTime + 0.02 + k * 0.28;
      const g = this.g(0, t); g.gain.setValueAtTime(v * 0.12, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.6);
      for (const m of [1, 2.76, 5.4]) { const o = ctx.createOscillator(); o.frequency.value = f * m; o.connect(g); o.start(t); o.stop(t + dur + 0.7); }
    }
  }

  private churchBells(v: number) {
    const ctx = this.ctx, notes = [64, 62, 60, 55];
    notes.forEach((m, k) => {
      const t = ctx.currentTime + 0.05 + k * 0.9;
      const g = this.g(0, t); g.gain.setValueAtTime(v * 0.1, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 3.5);
      for (const r of [0.5, 1, 1.19, 1.5, 2, 2.52]) { const o = ctx.createOscillator(); o.frequency.value = mtof(m) * r; const og = ctx.createGain(); og.gain.value = r === 1 ? 0.6 : 0.25; o.connect(og); og.connect(g); o.start(t); o.stop(t + 3.6); }
    });
  }

  private hooves(v: number) {
    const ctx = this.ctx;
    for (let k = 0; k < 8; k++) {
      const t = ctx.currentTime + 0.02 + k * 0.19 + (k % 2) * 0.05;
      const n = noiseSource(ctx, false), f = ctx.createBiquadFilter(); f.type = "bandpass"; f.frequency.value = 1100 + (k % 2) * 400; f.Q.value = 6;
      const g = this.g(0, t); g.gain.setValueAtTime(v * 0.25, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
      n.connect(f); f.connect(g); n.start(t); n.stop(t + 0.07);
    }
  }

  private voice(v: number) {
    const ctx = this.ctx, t = ctx.currentTime + 0.02;
    // a snatch of speech: a few formant-filtered syllables
    for (let k = 0; k < 3 + Math.floor(Math.random() * 4); k++) {
      const tt = t + k * 0.16;
      const o = ctx.createOscillator(); o.type = "sawtooth"; o.frequency.value = 120 + Math.random() * 120;
      const f = ctx.createBiquadFilter(); f.type = "bandpass"; f.frequency.value = 500 + Math.random() * 1500; f.Q.value = 5;
      const g = this.g(0, tt); g.gain.setValueAtTime(0.0001, tt); g.gain.linearRampToValueAtTime(v * 0.3, tt + 0.03); g.gain.exponentialRampToValueAtTime(0.0001, tt + 0.14);
      o.connect(f); f.connect(g); o.start(tt); o.stop(tt + 0.16);
    }
  }

  private bird(v: number) {
    const ctx = this.ctx, t = ctx.currentTime + 0.02, f0 = 2500 + Math.random() * 2000;
    for (let k = 0; k < 2 + Math.floor(Math.random() * 3); k++) {
      const tt = t + k * 0.13;
      const o = ctx.createOscillator(); o.frequency.setValueAtTime(f0, tt); o.frequency.exponentialRampToValueAtTime(f0 * (Math.random() < 0.5 ? 1.4 : 0.7), tt + 0.09);
      const g = this.g(0, tt); g.gain.setValueAtTime(0.0001, tt); g.gain.linearRampToValueAtTime(v * 0.1, tt + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, tt + 0.1);
      o.connect(g); o.start(tt); o.stop(tt + 0.12);
    }
  }

  private cricket(v: number) {
    const ctx = this.ctx, t = ctx.currentTime + 0.02;
    for (let k = 0; k < 3; k++) {
      const tt = t + k * 0.06;
      const o = ctx.createOscillator(); o.frequency.value = 4400;
      const g = this.g(0, tt); g.gain.setValueAtTime(v * 0.05, tt); g.gain.exponentialRampToValueAtTime(0.0001, tt + 0.04);
      o.connect(g); o.start(tt); o.stop(tt + 0.05);
    }
  }
}
