// Community music: the dance tunes, songs and airs each community brought, and originals written in their idioms.
// Real tunes are traditional or published before 1931 (public domain in the US). No lyrics.

import type { Tune } from "./types";

const OWN = "Original for Mill Town";

export const FOLK: Tune[] = [
  // ---------------------------------------------------------------- Irish
  { id: "irish-washerwoman", title: "The Irish Washerwoman", family: "irish", credit: "Traditional (Irish)", abc: `
T:The Irish Washerwoman
M:6/8
L:1/8
K:G
dc|:"G"BGG DGG|BGB dcB|"D"cAA EAA|cAc edc|"G"BGG DGG|BGB dcB|"C"cBc "D"Adc|1"G"BGG G dc:|2"G"BGG Gba||
|:"G"gdd gdd|gdB dcB|"D"cAA EAA|cAc efg|"G"gdd gdd|gdB dcB|"C"cBc "D"Adc|1"G"BGG Gba:|2"G"BGG G3|]` },
  { id: "the-kesh", title: "The Kesh", family: "irish", credit: "Traditional (Irish)", abc: `
T:The Kesh
M:6/8
L:1/8
K:G
|:"G"G3 GAB|"D"A3 ABd|"G"edd gdd|"C"edB "D"dBA|"G"G3 GAB|"D"A3 ABd|"C"edd gdB|"D"AGF "G"G3:|
|:"G"BAB dBd|"C"ege "G"dBA|"G"BAB dBG|"D"ABA AGA|"G"BAB dBd|"C"ege "G"dBd|"C"gfg "D"aga|"G"bgf g3:|` },
  { id: "swallowtail-jig", title: "The Swallowtail Jig", family: "irish", credit: "Traditional (Irish)", abc: `
T:The Swallowtail Jig
M:6/8
L:1/8
K:Em
|:"Em"GEE BEE|GEE BAG|"D"FDD ADD|dcd AGF|"Em"GEE BEE|GEE B2c|"D"dcd AGF|"Em"GEE E3:|
|:"Em"Bcd e2f|e2f edB|Bcd e2f|edB "D"d3|"Em"Bcd e2f|e2f edB|"D"dcB AGF|"Em"GEE E3:|` },
  { id: "drowsy-maggie", title: "Drowsy Maggie", family: "irish", credit: "Traditional (Irish reel)", abc: `
T:Drowsy Maggie
M:4/4
L:1/8
K:Edor
|:"Em"E2BE dEBE|E2BE "D"AFDF|"Em"E2BE dEBE|"D"BABc dAFD:|
|:"D"d2fd c2ec|defg afge|d2fd c2ec|"Em"BABc "D"dAFA|"D"d2fd c2ec|defg afge|afge fdec|"Em"BABc "D"dAFD:|` },
  { id: "rakes-of-mallow", title: "The Rakes of Mallow", family: "irish", credit: "Traditional (Irish polka)", bpm: 118, abc: `
T:The Rakes of Mallow
M:2/4
L:1/8
K:G
|:"G"BG BG|BG Bd|"D"cA cA|cA ce|"G"BG BG|BG Bd|"C"ec "D"AF|"G"G2 G2:|
|:"G"d>e dB|d>e dB|"D"c>d cA|c>d cA|"G"d>e dB|d>e dg|"C"ec "D"AF|"G"G2 G2:|` },

  // ---------------------------------------------------------------- old-time (country fiddle)
  { id: "yankee-doodle", title: "Yankee Doodle", family: "oldtime", credit: "Traditional (American)", abc: `
T:Yankee Doodle
M:2/4
L:1/8
K:G
|:"G"GGAB|GB "D"AD|"G"GGAB|"G"G2 "D"F2|"G"GGAB|"C"cBAG|"D"FDEF|"G"G2 G2:|
|:"C"EFED|EF G2|"G"DEDC|B,2 G,2|"C"EFED|EFGE|"D"DGFA|"G"G2 G2:|` },
  { id: "coal-hill-breakdown", title: "Coal Hill Breakdown", family: "oldtime", credit: OWN, abc: `
T:Coal Hill Breakdown
M:2/4
L:1/16
K:A
|:"A"e2c2 A2c2|e2a2 e2c2|"D"d2f2 a2f2|"A"e2c2 A4|"A"e2c2 A2c2|e2a2 e2c2|"E"B2c2 d2B2|"A"A4 A4:|
|:"A"a2a2 e2c2|a2a2 e2c2|"D"f2f2 d2B2|"A"c2e2 a4|"A"a2a2 e2c2|"D"d2f2 a2f2|"E"e2d2 c2B2|"A"A4 A4:|` },
  { id: "sawmill-run-reel", title: "Sawmill Run Reel", family: "oldtime", credit: OWN, abc: `
T:Sawmill Run Reel
M:4/4
L:1/8
K:D
|:"D"A2 FA dAFA|"G"B2 GB dBGB|"D"A2 FA dfed|"A"cdec A2 G2|"D"A2 FA dAFA|"G"B2 GB d2 g2|"A"fedc BAGE|"D"D2 F2 D4:|
|:"D"d2 fd adfd|"G"g2 bg dgbg|"D"a2 fa d2 fe|"A"edce A4|"D"d2 fd adfd|"G"g2 bg d2 B2|"A"ABcd efge|"D"d2 f2 d4:|` },

  // ---------------------------------------------------------------- German
  { id: "lieber-augustin", title: "O du lieber Augustin", family: "german", credit: "Traditional (Austrian/German)", bpm: 138, abc: `
T:O du lieber Augustin
M:3/4
L:1/8
K:C
|:"C"G3 AGF|E2 C2 C2|"G"D2 G,2 G,2|"C"E2 C2 C2|G3 AGF|E2 C2 C2|"G"D2 G,2 G,2|"C"C6:|
|:"G"D2 G,2 G,2|"C"E2 C2 C2|"G"D2 G,2 G,2|"C"E2 C2 C2|G3 AGF|E2 C2 C2|"G"D2 G,2 G,2|"C"C6:|` },
  { id: "o-tannenbaum", title: "O Tannenbaum", family: "german", credit: "Traditional (German)", bpm: 96, abc: `
T:O Tannenbaum
M:3/4
L:1/8
K:G
D2|:"G"G3/2G/ G3 A|B3/2B/ B3 B|"D7"A2 B2 c2|"D"F2 A2 "G"G2|"G"d B e3 d|"C"d c c3 c|"D7"c A d3 c|"G"c B B2 z D|"G"G3/2G/ G3 A|B3/2B/ B3 B|"D7"A2 B2 c2|"D"F2 A2 "G"G2:|` },
  { id: "turnverein-marsch", title: "Turnverein-Marsch", family: "german", credit: OWN, abc: `
T:Turnverein-Marsch
M:2/4
L:1/16
K:Bb
|:"Bb"F2B2 d2B2|f4 d4|"F7"c2e2 c2A2|F4 F4|"F7"E2F2 G2A2|B2c2 d2e2|"Bb"f2d2 B2d2|f4 B4|
"Bb"F2B2 d2B2|f4 d4|"Eb"g2e2 B2e2|g4 e4|"F7"f2e2 d2c2|A2c2 f2e2|"Bb"d2c2 B2A2|B4 z4:|
|:"Eb"G2B2 e2g2|f4 e4|"Bb"d2B2 F2B2|d4 B4|"F7"c2A2 F2A2|c2e2 f2e2|"Bb"d2B2 F2D2|B,4 z4|
"Eb"G2B2 e2g2|f4 e4|"Bb"d2f2 b2f2|d4 B4|"F7"c2d2 e2f2|g2f2 e2c2|"Bb"B2d2 f2d2|B4 z4:|` },

  // ---------------------------------------------------------------- Slovak / Polish / Lithuanian polkas
  { id: "monongahela-polka", title: "Monongahela Polka", family: "polka", credit: OWN, abc: `
T:Monongahela Polka
M:2/4
L:1/16
K:F
|:"F"c2A2 F2A2|c4 A4|"C7"G2^F2 G2A2|B4 G4|"C7"E2G2 B2d2|c2B2 A2G2|"F"A2c2 f2c2|A4 F4|
"F"c2A2 F2A2|c4 A4|"Bb"d2c2 B2d2|f4 d4|"C7"c2B2 A2G2|E2G2 B2G2|"F"F2A2 c2A2|F4 z4:|
|:"Bb"f2d2 B2d2|f4 d4|"F"c2A2 F2A2|c4 A4|"C7"Bc d2 c2B2|A2G2 F2E2|"F"F2A2 c2f2|a4 f4|
"Bb"f2d2 B2d2|f4 d4|"F"c2A2 F2A2|c4 A4|"C7"G2B2 e2g2|f2e2 d2c2|"F"f2c2 A2c2|f4 z4:|` },
  { id: "sokol-hall-polka", title: "Sokol Hall Polka", family: "polka", credit: OWN, abc: `
T:Sokol Hall Polka
M:2/4
L:1/16
K:C
|:"C"e2g2 e2c2|G4 c4|"G7"d2f2 d2B2|G4 B4|"G7"d2f2 a2g2|f2e2 d2c2|"C"e2g2 c'2g2|e4 c4|
"C"e2g2 e2c2|G4 c4|"F"f2a2 f2c2|A4 c4|"G7"B2d2 g2f2|e2d2 c2B2|"C"c2e2 G2E2|C4 z4:|
|:"F"a3g f2c2|A2c2 f4|"C"g3f e2c2|G2c2 e4|"G7"f2e2 d2c2|B2d2 g2f2|"C"e2g2 c'2b2|c'4 z4|
"F"a3g f2c2|A2c2 f4|"C"g3f e2c2|G2c2 e4|"G7"f2a2 g2f2|e2d2 c2B2|"C"c2G2 E2G2|C4 z4:|` },
  { id: "polish-hill-polka", title: "Polish Hill Polka", family: "polka", credit: OWN, abc: `
T:Polish Hill Polka
M:2/4
L:1/16
K:G
|:"G"dcBA G2B2|d4 g4|"D7"fedc A2c2|f4 a4|"D7"agfe d2c2|A2c2 f2a2|"G"gfed B2d2|g4 z4|
"G"dcBA G2B2|d4 g4|"C"edcB c2e2|g4 e4|"D7"d2^c2 d2e2|f2a2 c2A2|"G"G2B2 d2B2|G4 z4:|
|:"C"e2e2 efge|c4 G4|"G"d2d2 defd|B4 G4|"D7"A2c2 f2a2|g2f2 e2d2|"G"B2d2 g2d2|B4 G4|
"C"e2e2 efge|c4 G4|"G"d2d2 defd|B4 G4|"D7"A2c2 f2e2|d2c2 A2F2|"G"G2B2 d2B2|G4 z4:|` },
  { id: "citizens-club-polka", title: "Citizens Club Polka", family: "polka", credit: OWN, abc: `
T:Citizens Club Polka
M:2/4
L:1/16
K:D
|:"D"A2d2 f2d2|A2d2 f4|"A7"G2c2 e2c2|G2c2 e4|"A7"e2g2 e2c2|A2c2 e2g2|"D"f2d2 A2F2|D4 z4:|
|:"G"B2d2 g2d2|B4 G4|"D"A2d2 f2d2|A4 F4|"E7"E2^G2 B2d2|c2B2 A2G2|"A7"F2A2 c2e2|"D"d4 z4:|` },

  // ---------------------------------------------------------------- Hungarian
  { id: "lassu", title: "Lassú (slow csárdás)", family: "csardas", credit: OWN, bpm: 76, abc: `
T:Lassú
M:4/4
L:1/8
K:Dm
|:"Dm"A3B A2^G2|A4 d4|"A7"^c2B2 A2G2|F4 E4|"Dm"D2F2 A2d2|"Gm"_B4 G4|"A7"A2G2 F2E2|"Dm"D8:|
|:"Dm"d3e f2e2|d4 A4|"Gm"_B2A2 G2F2|E4 D4|"A7"^c2d2 e2f2|e2d2 ^c2B2|"A7"A2^G2 A2^c2|"Dm"d8:|` },
  { id: "friss", title: "Friss (fast csárdás)", family: "csardas", credit: OWN, abc: `
T:Friss
M:2/4
L:1/16
K:Dm
|:"Dm"d2f2 e2d2|^c2d2 A4|"Dm"d2f2 e2d2|^c2d2 A4|"Gm"G2_B2 A2G2|F2E2 D2F2|"A7"E2F2 G2^G2|A4 z4|
"Dm"d2f2 e2d2|^c2d2 A4|"Gm"g2_b2 a2g2|f2e2 d4|"A7"^c2d2 e2f2|e2d2 ^c2B2|"Dm"d2A2 F2A2|d4 z4:|
|:"F"c2f2 a2f2|c2f2 a4|"C7"_B2e2 g2e2|_B2e2 g4|"Dm"A2d2 f2d2|"A7"^c2e2 a2g2|"Dm"f2e2 d2^c2|d4 z4:|` },
  { id: "verbunkos", title: "Verbunkos", family: "csardas", credit: OWN, bpm: 72, abc: `
T:Verbunkos
M:4/4
L:1/8
K:Am
|:"Am"E3/2A/ c3/2B/ A2E2|"E7"^G3/2B/ d3/2c/ B4|"Am"c3/2e/ a3/2^g/ a2e2|"Dm"f3/2e/ d3/2c/ "E7"B4|
"Am"E3/2A/ c3/2B/ A2E2|"E7"^G3/2B/ d3/2c/ B2^G2|"Am"A2c2 "E7"B2^G2|"Am"A6 z2:|
|:"Dm"F3/2A/ d3/2f/ e2d2|"Am"c3/2e/ a3/2e/ c4|"E7"B3/2^d/ e3/2^g/ b2^g2|"Am"a3/2e/ c3/2A/ E4|
"Dm"F3/2A/ d3/2f/ e2d2|"Am"c3/2e/ a3/2e/ c2A2|"E7"B2e2 ^G2B2|"Am"A6 z2:|` },

  // ---------------------------------------------------------------- Rusyn / Ukrainian / Slavic
  { id: "kolomyjka", title: "Kolomyjka", family: "slavic", credit: OWN, abc: `
T:Kolomyjka
M:2/4
L:1/16
K:Gm
|:"Gm"G2B2 d2B2|G2B2 d4|"D7"A2c2 ^f2c2|A2c2 d4|"Gm"G2B2 d2g2|"Cm"g2f2 e2d2|"D7"c2B2 A2^F2|"Gm"G4 z4:|
|:"Bb"f2d2 f2d2|f2g2 f4|"F7"e2c2 e2c2|e2f2 e4|"Gm"d2B2 G2B2|"Cm"c2e2 g2e2|"D7"d2c2 A2^F2|"Gm"G4 z4:|` },
  { id: "lament-from-the-slopes", title: "Song from the Slopes", family: "slavic", credit: OWN, bpm: 72, abc: `
T:Song from the Slopes
M:3/4
L:1/8
K:Dm
|:"Dm"A4 A2|d3c BA|"Gm"G4 B2|"A7"A6|"Dm"F2A2 d2|"Gm"d3c BG|"A7"E2F2 G2|"Dm"F4 D2:|
|:"F"c4 c2|f3e dc|"Gm"d4 B2|"Dm"A6|"Bb"B2d2 f2|"A7"e3d ^c2|"Dm"d2A2 F2|D6:|` },

  // ---------------------------------------------------------------- Croatian / Serbian tamburitza
  { id: "duquesne-kolo", title: "Duquesne Kolo", family: "tamburitza", credit: OWN, abc: `
T:Duquesne Kolo
M:2/4
L:1/16
K:G
|:"G"B2d2 B2d2|B2A2 G4|"D7"A2c2 A2c2|A2G2 F4|"G"G2B2 d2g2|"C"e2d2 c2B2|"D7"A2B2 c2A2|"G"G4 z4:|
|:"C"e2g2 e2g2|e2d2 c4|"G"d2g2 d2g2|d2c2 B4|"D7"c2B2 A2G2|F2A2 d2c2|"G"B2A2 G2D2|G4 z4:|` },
  { id: "fraternal-kolo", title: "Fraternal Union Kolo", family: "tamburitza", credit: OWN, abc: `
T:Fraternal Union Kolo
M:2/4
L:1/16
K:D
|:"D"f2f2 e2d2|"A7"e2e2 d2c2|"D"d2f2 a2f2|"A7"e4 c4|"D"f2f2 e2d2|"A7"e2e2 d2c2|"A7"B2c2 d2e2|"D"d4 z4:|
|:"G"g2g2 f2e2|d2B2 G4|"D"f2f2 e2d2|c2A2 F4|"Em"E2G2 B2e2|"A7"c2e2 a2g2|"A7"f2e2 d2c2|"D"d4 z4:|` },
  { id: "tamburica-serenade", title: "Serenade on the Monongahela", family: "tamburitza", credit: OWN, bpm: 96, abc: `
T:Serenade on the Monongahela
M:3/4
L:1/8
K:F
|:"F"A3c c2|"F"f3e dc|"C7"B3d d2|g3f ed|"C7"c2e2 g2|"F"f3e dc|"C7"B2G2 E2|"F"F6:|
|:"Bb"d3f f2|b3a gf|"F"c3f f2|a3g fe|"Gm"d2g2 b2|"C7"a3g fe|"C7"g2e2 c2|"F"f6:|` },

  // ---------------------------------------------------------------- Italian
  { id: "bloomfield-tarantella", title: "Bloomfield Tarantella", family: "italian", credit: OWN, abc: `
T:Bloomfield Tarantella
M:6/8
L:1/8
K:Am
|:"E7"E^GB e2e|"Am"edc A2A|"Dm"dfa f2d|"E7"edc B2^G|"E7"E^GB e2e|"Am"edc A2c|"E7"Bcd edB|"Am"c2B A3:|
|:"C"gfe g2e|"G7"fed f2d|"C"edc e2c|"G7"dcB d2G|"Am"cBA c2e|"Dm"dcB d2f|"E7"e^de b2^g|"Am"a3 a3:|` },
  { id: "saltarello", title: "Saltarello di Larimer", family: "italian", credit: OWN, abc: `
T:Saltarello di Larimer
M:6/8
L:1/8
K:Dm
|:"Dm"A2d d^cd|f2d d^cd|"Gm"g2f e2d|"A7"^c2A A3|"Dm"A2d d^cd|f2a agf|"A7"e2d ^c2B|"Dm"d3 d3:|
|:"F"c2f fef|a2f fef|"C7"g2e ede|"F"f2c c3|"Bb"d2f fef|"Gm"g2b bag|"A7"f2e d2^c|"Dm"d3 d3:|` },
  { id: "serenata", title: "Serenata", family: "italian", credit: OWN, bpm: 90, lead: "mandolin", abc: `
T:Serenata
M:3/4
L:1/8
K:F
|:"F"c4 A2|c3d cA|"C7"G4 B2|B3c BG|"C7"A4 G2|"F"F3G Ac|"Gm"B3A GF|"C7"G6|
"F"c4 A2|c3d cA|"Bb"d4 f2|f3e dc|"F"c3A FA|"C7"G2c2 E2|"F"F6-|F6:|` },

  // ---------------------------------------------------------------- Jewish (klezmer, freygish mode on D)
  { id: "hill-district-freylekhs", title: "Hill District Freylekhs", family: "klezmer", credit: OWN, abc: `
T:Hill District Freylekhs
M:2/4
L:1/16
K:Dphr
|:"D"A2^FG A2^FG|A2Bc d4|"Cm"c2BA G2^FG|"D"A4 A4|"D"A2^FG A2^FG|A2Bc d2c2|"Cm"B2AG ^F2E2|"D"D4 z4:|
|:"Gm"d2dc B2d2|c2BA G4|"Cm"c2cB A2c2|"D"B2A^F G4|"Gm"G2Bd g2f2|e2dc B2A2|"D"G2^F2 E2^F2|D4 z4:|` },
  { id: "workmens-circle-hora", title: "Workmen's Circle Hora", family: "klezmer", credit: OWN, bpm: 150, abc: `
T:Workmen's Circle Hora
M:3/8
L:1/16
K:Dphr
|:"D"A4 ^F2|A2B2A2|"Gm"G4 B2|"D"A6|"Cm"c4 B2|A2G2c2|"D"B2A2^F2|A6|
"D"d4 c2|B2A2G2|"Cm"A4 G2|^F2E2D2|"D"^F2A2d2|"Cm"c2B2A2|"D"G2^F2E2|D6:|` },
  { id: "bulgar", title: "Bulgar from Fifth Avenue", family: "klezmer", credit: OWN, abc: `
T:Bulgar from Fifth Avenue
M:4/4
L:1/8
K:Dphr
|:"D"D^FA^F D^FA2|"D"dedc B2A2|"Cm"cBAG ^FGA2|"D"^FED2 D4|"D"D^FA^F D^FA2|"D"d^fed c2B2|"Cm"AG^FE ^FGAB|"D"A8:|
|:"Gm"dBGB dBG2|"Gm"gfed c2B2|"Cm"cAEA cAE2|"D"BAG^F E2D2|"Gm"dBGB d2g2|"Cm"fedc B2A2|"D"GA^FE D^FA2|D8:|` },
];
