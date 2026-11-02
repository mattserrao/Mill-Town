// Mood pieces between songs: short, slow airs with a clear motif, all originals written for Mill Town.

import type { Tune } from "./types";

const OWN = "Original for Mill Town";
const air = (id: string, title: string, family: string, abc: string): Tune => ({ id, title, family, credit: OWN, abc: `\nT:${title}\n${abc}` });

export const MOODS: Tune[] = [
  air("river-mist-morning", "Morning on the River", "rivermist", `M:4/4
L:1/8
K:D
|:"D"F4 A4|"G"B6 A2|"D"A4 F2E2|"Bm"D8|"G"G4 B4|"D"A4 d4|"Em"B4 A2G2|"A"A8:|`),
  air("river-mist-landing", "The Landing", "rivermist", `M:4/4
L:1/8
K:D
|"Bm"d4 c2B2|"G"B8|"D"A4 F2A2|"A"E8|"Bm"d4 c2B2|"G"g4 f2e2|"A"e4 c4|"D"d8|]`),
  air("furnace-night-glow", "Glow over Homestead", "furnacenight", `M:4/4
L:1/8
K:Am
|:"Am"A4 E4|"F"F6 E2|"Dm"D4 F4|"E"E8|"Am"A4 c4|"F"B6 A2|"E"^G4 B4|"Am"A8:|`),
  air("furnace-night-casting", "Casting at Midnight", "furnacenight", `M:4/4
L:1/8
K:Am
|"Am"e8|"F"c4 d4|"G"B8|"Am"A4 E4|"F"F4 A4|"Dm"d6 c2|"E"B8|"Am"A8|]`),
  air("hill-snow-first", "First Snow on the Slopes", "hillsnow", `M:3/4
L:1/8
K:G
|:"G"B4 d2|"Em"g6|"C"e4 d2|"G"B6|"Am"c4 B2|"D"A4 G2|"C"G4 E2|"D"D6|"G"B4 d2|"Em"g4 a2|"C"g4 e2|"G"d6|"C"e4 d2|"Am"c4 A2|"D"B4 A2|"G"G6:|`),
  air("hill-snow-frost", "Frost on the Steps", "hillsnow", `M:3/4
L:1/8
K:Em
|"Em"e4 B2|"C"c6|"G"B4 G2|"D"A6|"Em"G4 E2|"Am"A4 c2|"B7"B6-|B6|]`),
  air("smoke-haze-dusk", "Smoke over the Valley", "smokehaze", `M:4/4
L:1/8
K:Ddor
|:"Dm"D4 F4|"C"E4 G4|"Dm"F6 E2|"Am"D8|"Dm"A4 G4|"C"E6 C2|"G"D4 B,4|"Dm"D8:|`),
  air("smoke-haze-overcast", "Overcast", "smokehaze", `M:4/4
L:1/8
K:Ddor
|"Dm"A8|"G"B4 A4|"C"G4 E4|"Dm"F8|"Am"E4 C4|"G"D4 B,4|"C"C4 E4|"Dm"D8|]`),
  air("night-shift-turn", "The Turn", "nightshift", `M:4/4
L:1/8
K:Gm
|:"Gm"D4 G4|"Eb"B6 A2|"Cm"G4 E4|"D"^F8|"Gm"D4 G4|"Eb"B4 d4|"D7"c4 A4|"Gm"G8:|`),
  air("night-shift-lamplight", "Lamplight", "nightshift", `M:4/4
L:1/8
K:Gm
|"Eb"G4 B4|"Bb"d8|"Cm"e4 d4|"D7"c8|"Gm"B4 A4|"Cm"G4 E4|"D7"^F4 A4|"Gm"G8|]`),
  air("river-fog-towboat", "Towboat in the Fog", "riverfog", `M:4/4
L:1/8
K:Em
|:"Em"E8|"C"G4 E4|"Am"A6 G2|"B7"F8|"Em"G4 B4|"C"c6 B2|"B7"A4 F4|"Em"E8:|`),
  air("river-fog-locks", "At the Locks", "riverfog", `M:4/4
L:1/8
K:Em
|"Am"c8|"Em"B4 G4|"D"A8|"Em"E8|"C"E4 G4|"Am"c4 e4|"B7"^d8|"Em"e8|]`),
  air("countryside-fields", "Fields above the River", "countryside", `M:3/4
L:1/8
K:F
|:"F"C2F2 A2|"F"c6|"Bb"B2A2 G2|"F"A6|"Dm"A2F2 D2|"Gm"G4 A2|"C7"G4 E2|"F"F6:|`),
  air("countryside-orchard", "The Orchard", "countryside", `M:3/4
L:1/8
K:F
|"F"A4 c2|"Bb"d4 B2|"F"c4 A2|"C"G6|"Dm"F4 A2|"Bb"d4 f2|"C7"e4 c2|"F"f6|]`),
  air("last-light-sundown", "Sundown", "lastlight", `M:4/4
L:1/8
K:Am
|:"Am"a4 e4|"F"f4 c4|"C"e4 g4|"G"d8|"Am"a4 e4|"F"f4 a4|"G"g4 b4|"Am"a8:|`),
  air("last-light-afterglow", "Afterglow", "lastlight", `M:4/4
L:1/8
K:Am
|"F"c'6 a2|"C"g8|"G"d6 b2|"Am"a8|"F"f6 a2|"C"e8|"G"d4 B4|"Am"A8|]`),
  air("empty-mill-gates", "The Gates", "emptymill", `M:4/4
L:1/8
K:Dm
|:"Dm"D8|"Bb"F6 D2|"Gm"G8|"A"E8|"Dm"A8|"Bb"F6 G2|"A7"E4 ^C4|"Dm"D8:|`),
  air("empty-mill-remains", "What Remains", "emptymill", `M:4/4
L:1/8
K:Dm
|"Dm"d8|"C"c4 A4|"Bb"B8|"A"A8|"Gm"G4 B4|"Dm"A4 F4|"A"E8|"Dm"D8|]`),
];
