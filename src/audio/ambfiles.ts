// Recorded ambience (public/audio/amb/, credits in public/audio/CREDITS.md).
// Beds are seamless loops padded with 0.25 s guards of wrapped audio on each side: loop between loopStart and
// loopEnd (AudioBufferSourceNode.loopStart/loopEnd, start at loopStart) and any MP3 decoder delay stays inside the guards.
// One-shots play from the start; they are trimmed, faded and peak-normalised to −3 dBFS. Beds are at about −23 LUFS.

export interface AmbFile { url: string; loop: boolean; loopStart?: number; loopEnd?: number }

const base = `${import.meta.env.BASE_URL}audio/amb/`;
const bed = (name: string, seconds: number): AmbFile => ({ url: `${base}bed-${name}.mp3`, loop: true, loopStart: 0.25, loopEnd: 0.25 + seconds });
const os = (name: string): AmbFile => ({ url: `${base}os-${name}.mp3`, loop: false });

export const AMB_FILES: Record<string, AmbFile> = {
  // beds
  river: bed("river", 24),
  wind: bed("wind", 32),
  birds: bed("birds", 38),
  crickets: bed("crickets", 32),
  crowd: bed("crowd", 38),
  traffic: bed("traffic", 34),
  mill: bed("mill", 40),          // foundry machine hall
  furnace: bed("furnace", 7.5),   // a gas burner's roar, pitched down
  // one-shots
  "steam-train": os("steam-train"),           // whistle, then the engine pulling away (16 s)
  "steam-train-pass": os("steam-train-pass"), // a locomotive with coaches passing (30 s)
  "train-horn": os("train-horn"),             // distant diesel horn
  "boat-horn": os("boat-horn"),               // deep ship's horn
  "steam-whistle": os("steam-whistle"),       // old steam whistle, two blasts
  hooves: os("hooves"),                       // horse-drawn coach passing
  "church-bells": os("church-bells"),
  "voices-1": os("voices-1"),
  "voices-2": os("voices-2"),
  "voices-3": os("voices-3"),
  klaxon: os("klaxon"),                       // early car horn
  "car-horn": os("car-horn"),                 // modern car horn
  "clank-1": os("clank-1"),
  "clank-2": os("clank-2"),
  "clank-3": os("clank-3"),                   // three clangs
  hammer: os("hammer"),                       // pile driver / steam hammer pounding
  "trolley-bell": os("trolley-bell"),
};
