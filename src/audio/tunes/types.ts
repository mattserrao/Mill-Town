import type { Inst } from "../synth";

/** A tune in the song book: a real public-domain tune, or an original written for Mill Town. */
export interface Tune {
  id: string;          // kebab-case, unique
  title: string;       // real title (PD tunes) or an original title
  family: string;      // a key of STYLES in src/audio/music.ts
  credit: string;      // e.g. "Traditional (Irish)", "Scott Joplin, 1902", "Original for Mill Town"
  year?: number;       // first published, if known
  bpm?: number;        // override the style's tempo if this tune needs it
  lead?: Inst;         // override the style's lead instrument if it suits the tune better
  abc: string;         // ABC with headers T:, M:, L:, K: and chord symbols
}
