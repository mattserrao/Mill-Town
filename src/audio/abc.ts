// A small ABC-notation reader for the tune book: notes, lengths, accidentals, keys and modes, chord symbols,
// ties, triplets, broken rhythm, repeats with first and second endings. Grace notes, decorations and slurs are skipped.
// Output is in beats (a beat is a quarter in 2/4, 3/4, 4/4; a dotted quarter in 6/8, 9/8, 12/8; a half in 2/2).

export interface TuneNote { t: number; dur: number; midi: number }
export interface TuneChord { t: number; root: number; tones: number[] } // root: MIDI pitch class 0–11; tones: semitones above the root
export interface ParsedTune {
  title: string;
  beatsPerBar: number;
  /** steps per beat a band should feel: 2 (simple), 3 (compound) */
  sub: number;
  tonic: number; // MIDI pitch class
  minor: boolean;
  bars: { t: number; len: number }[];
  notes: TuneNote[];
  chords: TuneChord[];
  length: number;
}

const LETTER: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const ORDER = "FCGDAEB"; // order of sharps
const MODE_OFFSET: Record<string, number> = { "": 0, maj: 0, ion: 0, m: -3, min: -3, aeo: -3, mix: -1, dor: -2, phr: -4, lyd: 1, loc: -5 };

/** sharps (+) / flats (−) for a key like "G", "Am", "Dmix", "Bb", "F#m", "E dor" */
function keySignature(k: string): { acc: Record<string, number>; tonic: number; minor: boolean } {
  const m = /^\s*([A-G])([#b]?)\s*([A-Za-z]*)/.exec(k) ?? [, "C", "", ""];
  const letter = m[1]!, accTxt = m[2] ?? "", modeTxt = (m[3] ?? "").toLowerCase().slice(0, 3);
  const mode = modeTxt === "m" || modeTxt.startsWith("mi") && modeTxt !== "mix" ? "min" : modeTxt;
  // sharps of the major key with this tonic
  const majorSharps: Record<string, number> = { C: 0, G: 1, D: 2, A: 3, E: 4, B: 5, "F#": 6, "C#": 7, F: -1, Bb: -2, Eb: -3, Ab: -4, Db: -5, Gb: -6, Cb: -7 };
  const name = letter + accTxt;
  let n = majorSharps[name];
  if (n === undefined) n = accTxt === "#" ? (majorSharps[letter] ?? 0) + 7 : (majorSharps[letter] ?? 0) - 7;
  n += MODE_OFFSET[mode] ?? 0;
  const acc: Record<string, number> = {};
  if (n > 0) for (let i = 0; i < Math.min(7, n); i++) acc[ORDER[i]] = 1;
  if (n < 0) for (let i = 0; i < Math.min(7, -n); i++) acc[ORDER[6 - i]] = -1;
  const tonic = (LETTER[letter] + (accTxt === "#" ? 1 : accTxt === "b" ? -1 : 0) + 12) % 12;
  return { acc, tonic, minor: ["min", "aeo", "dor", "phr", "loc"].includes(mode) };
}

const QUAL: [RegExp, number[]][] = [
  [/^(maj7|M7|Δ)/, [0, 4, 7, 11]], [/^(m7b5|ø)/, [0, 3, 6, 10]], [/^(m7|min7|-7)/, [0, 3, 7, 10]], [/^(m6|min6)/, [0, 3, 7, 9]],
  [/^(dim7|o7)/, [0, 3, 6, 9]], [/^(dim|o)/, [0, 3, 6]], [/^(aug|\+)/, [0, 4, 8]], [/^(m|min|-)/, [0, 3, 7]],
  [/^(9)/, [0, 4, 7, 10, 14]], [/^(7)/, [0, 4, 7, 10]], [/^(6)/, [0, 4, 7, 9]], [/^(sus4|sus)/, [0, 5, 7]], [/^/, [0, 4, 7]],
];
export function parseChord(s: string): { root: number; tones: number[] } | null {
  const m = /^([A-G])([#b]?)(.*)$/.exec(s.trim());
  if (!m) return null;
  const root = (LETTER[m[1]] + (m[2] === "#" ? 1 : m[2] === "b" ? -1 : 0) + 12) % 12;
  const rest = m[3].split("/")[0];
  for (const [re, tones] of QUAL) if (re.test(rest)) return { root, tones };
  return { root, tones: [0, 4, 7] };
}

interface RawBar { notes: TuneNote[]; chords: TuneChord[]; len: number; startRepeat: boolean; endRepeat: boolean; ending: number }

export function parseAbc(src: string): ParsedTune {
  let meter = [4, 4], unit = 0, key = "C", title = "";
  const body: string[] = [];
  for (const raw of src.split("\n")) {
    const line = raw.replace(/%.*$/, "").trim();
    if (!line) continue;
    const h = /^([A-Za-z]):\s*(.*)$/.exec(line);
    if (h && h[1] !== "|") {
      const [, f, v] = h;
      if (f === "M") meter = v === "C" ? [4, 4] : v === "C|" ? [2, 2] : v.split("/").map(Number);
      else if (f === "L") { const [a, b] = v.split("/").map(Number); unit = a / b; }
      else if (f === "K") key = v;
      else if (f === "T" && !title) title = v;
      continue;
    }
    body.push(line);
  }
  if (!unit) unit = meter[0] / meter[1] < 0.75 ? 1 / 16 : 1 / 8;
  const compound = meter[1] === 8 && meter[0] % 3 === 0 && meter[0] > 3;
  const beatWhole = compound ? 3 / 8 : 1 / meter[1];
  const beatsPerBar = (meter[0] / meter[1]) / beatWhole;
  const ks = keySignature(key);

  const bars: RawBar[] = [];
  let cur: RawBar = { notes: [], chords: [], len: 0, startRepeat: false, endRepeat: false, ending: 0 };
  let barAcc: Record<string, number> = {};
  let t = 0; // beats within the bar
  let tuplet = 0, tupletMul = 1;
  let broken = 0; // pending multiplier for the next note from > or <
  let tieNext = false;
  let ending = 0;
  const text = body.join(" ");
  const closeBar = (kind: string) => {
    cur.len = t;
    if (cur.notes.length || cur.chords.length || t > 0) bars.push(cur);
    else if (bars.length && kind.includes(":") && kind.startsWith(":")) bars[bars.length - 1].endRepeat = true;
    const endR = /^:/.test(kind) || kind === "::";
    if (endR && bars.length) bars[bars.length - 1].endRepeat = true;
    if (kind === "||" || kind === "|]" || endR) ending = 0;
    cur = { notes: [], chords: [], len: 0, startRepeat: /:$/.test(kind) || kind === "::", endRepeat: false, ending };
    t = 0; barAcc = {};
  };
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (c === " " || c === "\t" || c === "`") { i++; continue; }
    if (c === '"') { // chord symbol
      const j = text.indexOf('"', i + 1);
      const ch = parseChord(text.slice(i + 1, j));
      if (ch) cur.chords.push({ t, ...ch });
      i = j + 1; continue;
    }
    if (c === "!" || c === "+") { const j = text.indexOf(c, i + 1); i = j < 0 ? i + 1 : j + 1; continue; }
    if (c === "{") { i = text.indexOf("}", i) + 1; continue; }
    if (c === "~" || c === "." || c === "H" || c === "T" || c === "u" || c === "v" || c === ")") { i++; continue; }
    if (c === "(") {
      const m = /^\((\d)/.exec(text.slice(i));
      if (m) { const p = +m[1]; tuplet = p; tupletMul = p === 3 ? 2 / 3 : p === 2 ? 3 / 2 : p === 4 ? 3 / 4 : (compound ? 3 : 2) / p; i += 2; }
      else i++;
      continue;
    }
    // bar lines and repeats
    const bl = /^(:\|\]|::|:\|\||:\|[12]?|\|:|\|\||\|\]|\[\||\|[12]?)/.exec(text.slice(i));
    if (bl && !(c === "[" && /^\[[1-9]/.test(text.slice(i)))) {
      let kind = bl[1];
      const endNum = /([12])$/.exec(kind);
      kind = kind.replace(/[12]$/, "");
      if (kind === "[|") kind = "||";
      closeBar(kind === ":||" ? ":|" : kind === ":|]" ? ":|" : kind);
      if (endNum) { ending = +endNum[1]; cur.ending = ending; }
      i += bl[1].length; continue;
    }
    if (c === "[" && /^\[[1-9]/.test(text.slice(i))) { ending = +text[i + 1]; cur.ending = ending; i += 2; continue; }
    if (c === "-") { tieNext = true; i++; continue; }
    if (c === ">" || c === "<") {
      const prev = cur.notes[cur.notes.length - 1];
      if (prev) { const f = c === ">" ? 1.5 : 0.5; const d = prev.dur; prev.dur = d * f; t += d * (f - 1); broken = c === ">" ? 0.5 : 1.5; }
      i++; continue;
    }
    // a note, a rest or a [chord]
    const nm = /^(\[([^\]]*)\]|(\^\^|\^|__|_|=)?([A-Ga-gzx])([',]*))(\d*)(\/*)(\d*)/.exec(text.slice(i));
    if (!nm) { i++; continue; }
    i += nm[0].length;
    const num = nm[6] ? +nm[6] : 1;
    const slashes = nm[7].length;
    const den = nm[8] ? +nm[8] : slashes ? 2 ** slashes : 1;
    let dur = (num / den) * unit / beatWhole;
    if (tuplet > 0) { dur *= tupletMul; tuplet--; }
    if (broken) { dur *= broken; broken = 0; }
    let midi = -1;
    const pitchOf = (acc: string | undefined, letter: string, oct: string): number => {
      const up = letter.toUpperCase();
      let p = 60 + LETTER[up] + (letter === up ? 0 : 12);
      for (const o of oct) p += o === "'" ? 12 : -12;
      const keyAcc = `${letter}${oct}`;
      let a: number;
      if (acc) { a = acc === "^" ? 1 : acc === "^^" ? 2 : acc === "_" ? -1 : acc === "__" ? -2 : 0; barAcc[keyAcc] = a; }
      else a = barAcc[keyAcc] ?? ks.acc[up] ?? 0;
      return p + a;
    };
    if (nm[2] !== undefined) {
      // a chord in the melody: keep the top note
      const inner = [...nm[2].matchAll(/(\^\^|\^|__|_|=)?([A-Ga-g])([',]*)/g)].map((q) => pitchOf(q[1], q[2], q[3]));
      midi = inner.length ? Math.max(...inner) : -1;
    } else if (nm[4] !== "z" && nm[4] !== "x") midi = pitchOf(nm[3], nm[4], nm[5]);
    const prev = cur.notes[cur.notes.length - 1];
    if (tieNext && midi >= 0) {
      // a tie: lengthen the previous note (it may be in the previous bar)
      const p = prev ?? bars[bars.length - 1]?.notes.slice(-1)[0];
      if (p && p.midi === midi) p.dur += dur; else cur.notes.push({ t, dur, midi });
    } else if (midi >= 0) cur.notes.push({ t, dur, midi });
    tieNext = false;
    t += dur;
  }
  closeBar("|]");

  // expand repeats and endings
  const out: RawBar[] = [];
  let start = 0, pass = 1, prev = -1;
  for (let k = 0; k < bars.length && out.length < 4000;) {
    const b = bars[k];
    if (pass === 2 && !b.ending && prev === k - 1 && k > 0 && bars[k - 1].ending === 2) { pass = 1; start = k; }
    prev = k;
    if (b.startRepeat && k !== start && pass === 1) start = k;
    if (b.ending && b.ending !== pass) { k++; continue; }
    out.push(b);
    if (b.endRepeat && pass === 1) { pass = 2; k = start; continue; }
    if (b.endRepeat && pass === 2) { pass = 1; start = k + 1; }
    k++;
  }

  const res: ParsedTune = { title, beatsPerBar, sub: compound ? 3 : 2, tonic: ks.tonic, minor: ks.minor, bars: [], notes: [], chords: [], length: 0 };
  const q = (x: number) => Math.round(x * 48) / 48;
  for (const b of out) b.len = q(b.len);
  let T = 0;
  let lastChord: TuneChord | null = null;
  for (const b of out) {
    res.bars.push({ t: T, len: b.len });
    for (const n of b.notes) res.notes.push({ t: q(T + n.t), dur: q(n.dur), midi: n.midi });
    if (!b.chords.length && lastChord && b.len > 0) res.chords.push({ ...lastChord, t: T });
    for (const ch of b.chords) { lastChord = { t: q(T + ch.t), root: ch.root, tones: ch.tones }; res.chords.push(lastChord); }
    T += b.len;
  }
  res.length = T;
  return res;
}

/** the chord sounding at beat t */
export function chordAt(p: ParsedTune, t: number): TuneChord | null {
  let lo = 0, hi = p.chords.length - 1, best: TuneChord | null = null;
  while (lo <= hi) { const mid = (lo + hi) >> 1; if (p.chords[mid].t <= t + 1e-6) { best = p.chords[mid]; lo = mid + 1; } else hi = mid - 1; }
  return best ?? p.chords[0] ?? null;
}
