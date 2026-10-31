// The song book: five tunes for every style (each its own key, tempo, chords, lead instrument and melody),
// with names, and the rotation that moves from tune to tune — with quiet mood pieces in between.

import type { Inst } from "./synth";
import { STYLES, type Style } from "./music";

const PLACES = ["Monongahela", "Allegheny", "Hazelwood", "Homestead", "Braddock", "Duquesne", "McKeesport", "Lawrenceville", "Bloomfield",
  "Troy Hill", "Polish Hill", "Carson Street", "Coal Hill", "Sawmill Run", "Turtle Creek", "Nine Mile Run", "Smithfield Street",
  "Penn Avenue", "Rankin", "Clairton", "East Liberty", "Spring Hill", "Mt. Washington", "Thompson Run", "Becks Run", "Arlington", "Strip District"];

const NOUNS: Record<string, string[]> = {
  parlor: ["Waltz", "Parlor Waltz", "Serenade", "Reverie", "Valse"], irish: ["Jig", "Reel", "Slide", "Jig", "Hornpipe"],
  oldtime: ["Reel", "Breakdown", "Hoedown", "Reel", "Quickstep"], german: ["Ländler", "Marsch", "Polka", "Schottische", "Marsch"],
  polka: ["Polka", "Oberek", "Polka", "Mazurka", "Polka"], csardas: ["Csárdás", "Friss", "Verbunkos", "Csárdás", "Lassú"],
  slavic: ["Song", "Kolomyjka", "Lament", "Dance", "Wedding Song"], tamburitza: ["Kolo", "Drmeš", "Kolo", "Serenade", "Kolo"],
  italian: ["Tarantella", "Saltarello", "Tarantella", "Serenata", "Mazurka"], klezmer: ["Freylekhs", "Hora", "Bulgar", "Doina", "Sher"],
  ragtime: ["Rag", "Two-Step", "Cakewalk", "Rag", "Stomp"], swing: ["Stomp", "Shuffle", "Jump", "Swing", "Riff"],
  bebop: ["Blues", "Bounce", "Bop", "Ballad", "Changes"], doowop: ["Serenade", "Moon", "Corner Song", "Lullaby", "Dream"],
  soul: ["Groove", "Shuffle", "Soul", "Walk", "Testimony"], funk: ["Strut", "Thing", "Bump", "Groove", "Hustle"],
  synthpop: ["Signal", "Transmission", "Station", "Lights", "Static"], elegy: ["Elegy", "Lament", "Requiem", "Farewell", "Hymn"],
  march: ["March", "Quickstep", "Parade", "Two-Step", "March"],
  rivermist: ["Mist", "Morning", "Landing", "Current", "Shallows"], furnacenight: ["Nocturne", "Glow", "Embers", "Night", "Casting"],
  hillsnow: ["Snowfall", "Winter", "Thaw", "First Snow", "Frost"], sundaybells: ["Bells", "Sunday", "Vespers", "Chimes", "Sabbath"],
  smokehaze: ["Haze", "Smoke", "Dusk", "Overcast", "Ash"], nightshift: ["Night Shift", "Graveyard Shift", "Midnight", "Lamplight", "Turn"],
  riverfog: ["Fog", "Towboat", "Locks", "Slack Water", "Barges"], countryside: ["Fields", "Pasture", "Orchard", "Hayfield", "Farm"],
  lastlight: ["Last Light", "Sundown", "Afterglow", "Late Shift", "Evening"], emptymill: ["Empty Mill", "Rust", "Gates", "Quiet", "Remains"],
};

const ALT_LEADS: Record<string, Inst[]> = {
  folk: ["fiddle", "accordion", "clarinet", "mandolin", "flute"], brass: ["brass", "clarinet", "flute", "sax", "piano"],
  jazz: ["sax", "brass", "piano", "clarinet", "organ"], modern: ["synth", "eguitar", "organ", "sax", "brass"],
};
const familyOf = (st: Style) => (st.leads ? "" : ["ragtime", "swing", "bebop", "doowop", "soul"].includes(st.id) ? "jazz" : ["funk", "synthpop"].includes(st.id) ? "modern" : ["german", "march"].includes(st.id) ? "brass" : "folk");

export interface Song { id: string; title: string; family: string; style: Style }

const KEY = [0, 2, -2, 3, 5], TEMPO = [1, 0.94, 1.06, 0.9, 1.08], DENS = [0, 0.08, -0.07, 0.05, -0.04];

function variant(base: Style, k: number): Song {
  const place = PLACES[(base.id.length * 7 + k * 5 + base.bpm) % PLACES.length];
  const noun = (NOUNS[base.id] ?? ["Tune"])[k % 5];
  const title = base.atmospheric ? `${place} ${noun}` : `${place} ${noun}`;
  const leads = base.leads ?? ALT_LEADS[familyOf(base)] ?? [base.lead];
  const prog = k === 1 || k === 3 ? [...base.prog.slice(2), ...base.prog.slice(0, 2)] : k === 4 ? [...base.prog.slice(base.prog.length >> 1), ...base.prog.slice(0, base.prog.length >> 1)] : base.prog;
  const style: Style = {
    ...base, id: `${base.id}#${k}`, label: `“${title}” (${base.label.toLowerCase()})`,
    key: base.key + KEY[k], bpm: Math.round(base.bpm * TEMPO[k]), density: Math.max(0.1, Math.min(0.95, base.density + DENS[k])), prog,
    lead: k === 0 ? base.lead : leads[(k + base.id.length) % leads.length],
  };
  return { id: style.id, title, family: base.id, style };
}

export const SONGS: Song[] = Object.values(STYLES).flatMap((st) => [0, 1, 2, 3, 4].map((k) => variant(st, k)));
export const SONGS_BY_FAMILY: Record<string, Song[]> = {};
for (const s of SONGS) (SONGS_BY_FAMILY[s.family] ??= []).push(s);

/** the mood piece that fits the scene */
export function atmosphereFor(v: { year: number; season: string; night: number; water: number; industry: number; country: number; churches: number; zoom: number }, pick: number): string {
  const opts: string[] = [];
  if (v.year >= 1975) opts.push("emptymill", "lastlight");
  if (v.night > 0.5) opts.push(v.industry > 0.1 ? "furnacenight" : "nightshift", "nightshift");
  if (v.season === "Winter") opts.push("hillsnow");
  if (v.water > 0.25) opts.push(v.season === "Autumn" ? "riverfog" : "rivermist", "riverfog");
  if (v.country > 0.5 && v.year < 1940) opts.push("countryside");
  if (v.churches > 0) opts.push("sundaybells");
  if (v.industry > 0.15) opts.push("smokehaze", "furnacenight");
  if (v.year >= 1955) opts.push("lastlight");
  if (!opts.length) opts.push("smokehaze", "rivermist", "nightshift");
  return opts[pick % opts.length];
}
