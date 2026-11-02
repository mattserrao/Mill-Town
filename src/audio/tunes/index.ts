// The tune book: every written tune, by style family.

import { CITY } from "./city";
import { EXTRA } from "./extra";
import { FOLK } from "./folk";
import { MODERN } from "./modern";
import { MOODS } from "./moods";
import type { Tune } from "./types";

export type { Tune } from "./types";

export const TUNES: Tune[] = [...FOLK, ...EXTRA, ...CITY, ...MODERN, ...MOODS];

export const TUNES_BY_FAMILY: Record<string, Tune[]> = {};
for (const t of TUNES) (TUNES_BY_FAMILY[t.family] ??= []).push(t);
