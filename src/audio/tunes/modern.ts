// After 1930 there is no public-domain catalogue to draw on: every tune here is an original written for
// Mill Town in the idiom of its day (bebop heads, doo-wop ballads, soul, funk vamps, synth-pop, the elegy).

import type { Tune } from "./types";

const OWN = "Original for Mill Town";

export const MODERN: Tune[] = [
  // ---------------------------------------------------------------- bebop (Hill District jazz)
  { id: "wylie-avenue-blues", title: "Wylie Avenue Blues", family: "bebop", credit: OWN, abc: `
T:Wylie Avenue Blues
M:4/4
L:1/8
K:F
|:"F7"zAc_e- _edcA|"Bb7"_AFDF- F4|"F7"zcdf agfd|"F7"_ecAc- c4|"Bb7"zdf_a gfdB|"Bb7"_AcdF- F4|"F7"zcAF "D7"^FAc_e|"Gm7"d4 "C7"zBGE|"Gm7"FGBd "C7"cBGE|"C7"=EGBd- dcBG|"F7"AFcF "D7"^FAdc|"Gm7"BG"C7"EC "F7"F4:|` },
  { id: "homestead-high-hat", title: "Homestead High Hat", family: "bebop", credit: OWN, abc: `
T:Homestead High Hat
M:4/4
L:1/8
K:Bb
|:"Bb"zdfd "G7"=Bdfd|"Cm7"ecAF "F7"Aceg|"Dm7"fdBF "G7"=Bdgf|"Cm7"ec"F7"AF B4|"Bb"zdfd "Bb7"_afdB|"Eb"geBG "Ebm"_geBG|"Bb"FBdf "F7"ecAF|"Bb"B4 z4|
"D7"z^FAc ^f=edc|"D7"A^FD^F A4|"G7"z=Bdf =bagf|"G7"d=BG=B d4|"C7"z=EGB =edcB|"C7"G=EC=E G4|"F7"zAce fecA|"F7"F2A2 c2e2|
"Bb"zdfd "G7"=Bdfd|"Cm7"ecAF "F7"Aceg|"Dm7"fdBF "G7"=Bdgf|"Cm7"ec"F7"AF B4|"Bb"zdfd "Bb7"_afdB|"Eb"geBG "Ebm"_geBG|"Bb"FBdf "F7"ecAF|"Bb"B4 z4:|` },
  { id: "late-set-at-the-loendi", title: "Late Set at the Loendi", family: "bebop", credit: OWN, bpm: 132, abc: `
T:Late Set at the Loendi
M:4/4
L:1/8
K:Cm
|:"Cm7"zGce gfec|"Cm7"dcBG c4|"Fm7"zFAc fecA|"Cm7"G4 zedc|"Fm7"zAce "Bb7"dcBA|"Cm7"GFEC G4|"Ab7"z_GAc "G7"=Bdfa|"Cm7"g4 z4|
"Fm7"zcfa c'baf|"Bb7"gfdB d4|"Ebmaj7"zBeg bage|"Ab7"fecA _G4|"Dm7b5"zFAd "G7"fed=B|"Cm7"cGEC "Ab7"_GAce|"G7"d=BGF ED=B,D|"Cm"C4 z4:|` },

  // ---------------------------------------------------------------- doo-wop
  { id: "corner-of-fifth-and-penn", title: "Corner of Fifth and Penn", family: "doowop", credit: OWN, abc: `
T:Corner of Fifth and Penn
M:12/8
L:1/8
K:C
|:"C"e3 e2d c3 G3|"Am"a3 a2g e6|"F"f3 f2e d3 c3|"G7"d6 z3 G3|"C"e3 e2d c3 G3|"Am"a3 a2g c'6|"F"a3 g2f "G7"e3 d3|"C"c6 z6:|
|:"F"f3 a3 c'3 a3|"C"g3 e3 c6|"F"f3 a3 c'3 a3|"G7"g9 z3|"Am"e3 e2d c3 A3|"F"c3 d2e f6|"G7"g3 f2e d3 =B3|"C"c9 z3:|` },
  { id: "kennywood-moon", title: "Kennywood Moon", family: "doowop", credit: OWN, abc: `
T:Kennywood Moon
M:12/8
L:1/8
K:G
|:"G"B6 d3 B3|"Em"G6 E6|"C"c3 c2c e3 c3|"D7"A9 z3|"G"B6 d3 g3|"Em"g3 f2e d6|"C"e3 d2c "D7"B3 A3|"G"G9 z3:|
|:"C"e3 e2e g3 e3|"G"d3 d2d B6|"C"c3 c2c e3 c3|"D7"A3 B2c d6|"G"B6 d3 g3|"Em"g3 a2g e6|"Am"c3 e2d "D7"c3 A3|"G"G9 z3:|` },
  { id: "streetlight-serenade", title: "Streetlight Serenade", family: "doowop", credit: OWN, abc: `
T:Streetlight Serenade
M:12/8
L:1/8
K:F
|:"F"A3 A2G F3 C3|"Dm"D3 F2A d6|"Bb"d3 c2B "C7"c3 G3|"F"A9 z3|"F"A3 A2G F3 C3|"Dm"D3 F2A f6|"Bb"f3 e2d "C7"c3 B3|"F"A9 z3:|` },

  // ---------------------------------------------------------------- soul
  { id: "homestead-testimony", title: "Homestead Testimony", family: "soul", credit: OWN, abc: `
T:Homestead Testimony
M:4/4
L:1/8
K:D
|:"D7"zAde f2ed|"D7"A4 z4|"G7"zBde =f2ed|"G7"B4 z4|"D7"zAde f2a2|"D7"a2fe d2A2|"A7"ze2e "G7"d2B2|"D7"d4 z4:|
|:"G"g2g2 f2ed|"D"f2d2- d4|"G"g2g2 a2gf|"A7"e4 z4|"G"g2b2 a2gf|"D"e2de- e2dc|"Em7"B2de "A7"f2ec|"D"d4 z4:|` },
  { id: "steelworkers-walk", title: "Steelworkers' Walk", family: "soul", credit: OWN, abc: `
T:Steelworkers' Walk
M:4/4
L:1/8
K:Am
|:"Am7"z2eg a2ge|"D7"z2^fa d'2c'a|"Am7"z2eg a2ge|"D7"d2cA- A4|"F"z2ac' a2gf|"E7"e2^gb- b4|"Dm7"a2gf "E7"e2d=B|"Am7"A4 z4:|` },
  { id: "sunday-at-bethel", title: "Sunday at Bethel", family: "soul", credit: OWN, bpm: 76, abc: `
T:Sunday at Bethel
M:4/4
L:1/8
K:Bb
|:"Bb"F2B2 d3c|"Eb"B2G2 B4|"Bb"F2B2 d3f|"F7"e2c2 c4|"Gm"d2f2 g3f|"Eb"e2d2 c2B2|"Cm7"c2de "F7"d2c2|"Bb"B6 z2:|
|:"Eb"g2g2 b3g|"Bb"f2d2 B4|"Eb"g2g2 b3a|"F7"g2f2 f4|"Gm"d2f2 g3b|"Eb"a2gf e2d2|"Cm7"c2e2 "F7"d2c2|"Bb"B6 z2:|` },

  // ---------------------------------------------------------------- funk & disco
  { id: "rust-belt-strut", title: "Rust Belt Strut", family: "funk", credit: OWN, abc: `
T:Rust Belt Strut
M:4/4
L:1/16
K:Ador
|:"Am7"A2zA c2d2 ze2d c2A2|"Am7"z4 g2a2 zc'3 a4|"Am7"A2zA c2d2 ze2d c2A2|"D7"z2^f2 a2c'2 z2a2 g4|
"Am7"A2zA c2d2 ze2d c2A2|"Am7"z4 g2a2 zc'3 a4|"G"g2zg =f2e2 d2c2 B2G2|"Am7"A4 z4 z8:|` },
  { id: "disco-at-the-edgewater", title: "Disco at the Edgewater", family: "funk", credit: OWN, abc: `
T:Disco at the Edgewater
M:4/4
L:1/16
K:Edor
|:"Em7"e2e2 z2d2 e2g2 z2e2|"Em7"z2B2 d2e2- e4 z4|"A7"a2a2 z2g2 a2c'2 z2a2|"A7"z2e2 g2a2- a4 z4|
"Em7"e2e2 z2d2 e2g2 z2b2|"Em7"a2g2 e2d2 B4 z4|"C"z2=c2 e2g2 "B7"^f2^d2 B2A2|"Em7"B4 e4 z8:|` },
  { id: "mon-wharf-groove", title: "Mon Wharf Groove", family: "funk", credit: OWN, abc: `
T:Mon Wharf Groove
M:4/4
L:1/16
K:Gmix
|:"G7"G2zB d2zf g2f2 d2B2|"G7"z4 f2g2 b2g2 f2d2|"C7"c2ze g2z_b c'2_b2 g2e2|"G7"z4 d2f2 g4 z4|
"G7"G2zB d2zf g2f2 d2B2|"G7"z4 f2g2 b2g2 f2d2|"D7"a2^f2 d2c2 "C7"g2e2 c2_B2|"G7"G4 z4 z8:|` },

  // ---------------------------------------------------------------- synth-pop
  { id: "signal-from-neville-island", title: "Signal from Neville Island", family: "synthpop", credit: OWN, abc: `
T:Signal from Neville Island
M:4/4
L:1/8
K:Am
|:"Am"e2ed e2a2|"F"g2fe c4|"C"e2ed e2g2|"G"d6 z2|"Am"e2ed e2a2|"F"c'2ba g2f2|"C"e2ge "G"d2B2|"Am"A6 z2:|
|:"F"a2ag a2c'2|"C"g6 e2|"G"d2de g2b2|"Am"a6 z2|"F"a2ag a2c'2|"C"g2eg c'2e'2|"G"d'2bg "E7"^g2b2|"Am"a6 z2:|` },
  { id: "steel-valley-lights", title: "Steel Valley Lights", family: "synthpop", credit: OWN, abc: `
T:Steel Valley Lights
M:4/4
L:1/8
K:Dm
|:"Dm"d2fa- a2gf|"Bb"g2fd- d4|"F"c2fa- a2gf|"C"e6 z2|"Dm"d2fa- a2gf|"Bb"_b2af- f2d2|"C"e2fg "A"^c2e2|"Dm"d6 z2:|` },
  { id: "last-train-to-braddock", title: "Last Train to Braddock", family: "synthpop", credit: OWN, abc: `
T:Last Train to Braddock
M:4/4
L:1/8
K:Em
|:"Em"B2e2 g2fe|"C"g2fe c4|"G"B2d2 g2ab|"D"a6 z2|"Em"B2e2 g2fe|"C"g2ab c'2ba|"G"b2gd "D"a2f2|"Em"e6 z2:|` },

  // ---------------------------------------------------------------- the mill-town elegy
  { id: "gates-on-second-avenue", title: "Gates on Second Avenue", family: "elegy", credit: OWN, abc: `
T:Gates on Second Avenue
M:4/4
L:1/8
K:Am
|:"Am"e4 c2A2|"F"c4 A2F2|"Dm"A3B c2d2|"E7"B6 z2|"Am"e4 c2A2|"F"f4 e2d2|"Dm"c2B2 A2"E7"^G2|"Am"A6 z2:|
|:"C"g4 e2c2|"G"d4 B2G2|"Am"c3d e2a2|"E7"^g6 z2|"F"a4 f2d2|"C"g4 e2c2|"Dm"f2e2 d2"E7"B2|"Am"A6 z2:|` },
  { id: "the-last-heat", title: "The Last Heat", family: "elegy", credit: OWN, abc: `
T:The Last Heat
M:4/4
L:1/8
K:Dm
|:"Dm"A4 F2D2|"Bb"F4 D2B,2|"Gm"D3E F2G2|"A7"E6 z2|"Dm"A4 F2D2|"Bb"d4 c2B2|"Gm"A2G2 F2"A7"E2|"Dm"D6 z2:|
|:"F"c4 A2F2|"C"G4 E2C2|"Dm"F3G A2d2|"A7"^c6 z2|"Bb"d4 B2G2|"F"c4 A2F2|"Gm"B2A2 G2"A7"E2|"Dm"D6 z2:|` },
  { id: "hymn-for-the-valley", title: "Hymn for the Valley", family: "elegy", credit: OWN, abc: `
T:Hymn for the Valley
M:4/4
L:1/8
K:C
|:"C"G4 E2C2|"Am"E4 C2A,2|"F"C3D E2F2|"G"D6 z2|"C"G4 E2C2|"Am"c4 B2A2|"Dm"G2F2 E2"G7"D2|"C"C6 z2:|
|:"Am"A4 c2e2|"Em"d4 B2G2|"F"A3G F2A2|"C"G6 z2|"Fm"_A4 F2C2|"C"G4 E2C2|"Dm"F2E2 D2"G7"=B,2|"C"C6 z2:|` },
];
