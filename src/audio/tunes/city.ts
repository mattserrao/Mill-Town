// The city's music of the day before 1930: parlor waltzes and songs, brass-band marches, ragtime, early swing,
// and the Sunday hymns. Real tunes are traditional or published before 1931 (public domain in the US). No lyrics.

import type { Tune } from "./types";

const OWN = "Original for Mill Town";

export const CITY: Tune[] = [
  // ---------------------------------------------------------------- parlor
  { id: "blue-danube", title: "The Blue Danube", family: "parlor", credit: "Johann Strauss II, 1867", year: 1867, bpm: 150, lead: "strings", abc: `
T:The Blue Danube
M:3/4
L:1/4
K:D
|"D"DDF|A2a|a2f|f2D|DDF|A2a|"A7"a2g|g2C|CCE|B2b|b2g|g2C|CCE|B2b|"D"b2f|f2D|
"D"DDF|Ad2-|d2A|A2D|DDF|Ad2-|"G"d2B|B2E|"Em"EEG|B3-|"A7"B2c|"D"d3|"A7"e3|e2A|"D"d3-|d2z|]` },
  { id: "silent-night", title: "Silent Night", family: "sundaybells", lead: "organ", credit: "Franz Gruber, 1818", year: 1818, bpm: 50, abc: `
T:Silent Night
M:6/8
L:1/8
K:C
|:"C"G3/2A/G E3|G3/2A/G E3|"G7"d2d B3|"C"c2c G3|"F"A2A c3/2B/A|"C"G3/2A/G E3|"F"A2A c3/2B/A|"C"G3/2A/G E3|"G7"d2d f3/2d/B|"C"c3 e3|"C"c3/2G/E "G7"G3/2F/D|"C"C6:|` },
  { id: "fur-elise", title: "Für Elise", family: "parlor", credit: "Ludwig van Beethoven (pub. 1867)", year: 1867, bpm: 130, lead: "piano", abc: `
T:Für Elise
M:3/8
L:1/16
K:Am
e^d|:"Am"e^de B=dc|A2z CEA|"E"B2z E^GB|"Am"c2z Ee^d|"Am"e^de B=dc|A2z CEA|"E"B2z EcB|1"Am"A2z2 e^d:|2"Am"A2z Bcd||
"C"e3 Gfe|"G"d3 Fed|"Am"c3 Edc|"E"B2z Ee^d|"Am"e^de B=dc|A2z CEA|"E"B2z EcB|"Am"A4 z2|]` },
  { id: "greensleeves", title: "Greensleeves", family: "parlor", credit: "Traditional (English)", bpm: 56, abc: `
T:Greensleeves
M:6/8
L:1/8
K:Am
A|:"Am"c2d e>fe|"G"d2B G>AB|"Am"c2A A>^GA|"E"B2^G E2A|"Am"c2d e>fe|"G"d2B G>AB|"Am"c>BA "E"^G>^FG|1"Am"A3 A2A:|2"Am"A3 A2g||
|:"C"g3 g>fe|"G"d2B G>AB|"Am"c2A A>^GA|"E"B2^G E2g|"C"g3 g>fe|"G"d2B G>AB|"Am"c>BA "E"^G>^FG|1"Am"A3 A2g:|2"Am"A3- A2z|]` },
  { id: "ball-game", title: "Take Me Out to the Ball Game", family: "parlor", credit: "Albert Von Tilzer, 1908", year: 1908, bpm: 160, abc: `
T:Take Me Out to the Ball Game
M:3/4
L:1/4
K:C
|"C"C2c|AGE|"G7"G3|D3|"C"C2c|AGE|"G7"G3-|G2z|"A7"A^GA|EFG|"Dm"A2F|D3|"D7"A2A|ABc|dBA|"G7"GED|
"C"C2c|AGE|"G7"G3|D2D|"C"CDE|"F"FGA|A3-|"D7"ABc|"C"c3|c3|cBA|"G7"G^FG|"Am"A3|"G7"B3|"C"c3-|c2z|]` },

  // ---------------------------------------------------------------- civic brass march
  { id: "yankee-doodle-band", title: "Yankee Doodle (band)", family: "march", credit: "Traditional (American)", abc: `
T:Yankee Doodle
M:2/4
L:1/8
K:G
|:"G"GGAB|GB "D"AD|"G"GGAB|"G"G2 "D"F2|"G"GGAB|"C"cBAG|"D"FDEF|"G"G2 G2:|
|:"C"EFED|EF G2|"G"DEDC|B,2 G,2|"C"EFED|EFGE|"D"DGFA|"G"G2 G2:|` },
  { id: "arsenal-march", title: "Allegheny Arsenal March", family: "march", credit: OWN, abc: `
T:Allegheny Arsenal March
M:2/4
L:1/16
K:Bb
|:"Bb"B,2D2 F2B2|d4 B4|"F7"A2c2 e2c2|A4 F4|"Bb"B2d2 f2d2|"Eb"e2g2 b2g2|"F7"f2e2 d2c2|"Bb"B4 z4|
"Bb"B,2D2 F2B2|d4 B4|"F7"A2c2 e2c2|A4 F4|"G7"G2=B2 d2f2|"Cm"e2d2 c2B2|"F7"A2B2 c2A2|"Bb"B4 z4:|
|:"Eb"e4 g4|"Eb"f2e2 d2e2|"Bb"f4 d4|B4 F4|"F7"c2d2 e2f2|g2f2 e2c2|"Bb"d2c2 B2A2|B4 z4|
"Eb"e4 g4|f2e2 d2e2|"Bb"f4 b4|f4 d4|"F7"c2d2 e2f2|g2f2 e2c2|"Bb"B2d2 f2a2|b4 z4:|` },
  { id: "fourth-of-july-quickstep", title: "Fourth of July Quickstep", family: "march", credit: OWN, abc: `
T:Fourth of July Quickstep
M:6/8
L:1/8
K:C
|:"C"G2c c2e|g2e c2G|"F"A2c f2a|g3 e3|"G7"d2f f2d|"C"e2g g2e|"G7"d2c B2d|"C"c3 z3:|
|:"F"A2c f2c|A2c f3|"C"G2c e2c|G2c e3|"D7"^F2A d2c|"G7"B2d g2f|"G7"e2d d2B|"C"c3 c3:|` },

  // ---------------------------------------------------------------- ragtime
  { id: "the-entertainer", title: "The Entertainer", family: "ragtime", credit: "Scott Joplin, 1902", year: 1902, abc: `
T:The Entertainer
M:2/4
L:1/16
K:C
D^D|:"C"Ec2E c2Ec-|c6cd|"C"^dec=d e2B=d-|"G7"d2c4D^D|"C"Ec2E c2Ec-|c6AG|"D7"^FAce2dcA|"G7"d6D^D|
"C"Ec2E c2Ec-|c6cd|"C"^dec=d e2B=d-|"G7"d2c4cd|"C"ecde2cde|"C"ecde2cde|"G7"ecde2B2d|1"C"c6D^D:|2"C"c6z2|]` },
  { id: "smithfield-street-rag", title: "Smithfield Street Rag", family: "ragtime", credit: OWN, abc: `
T:Smithfield Street Rag
M:2/4
L:1/16
K:C
|:"C"ze2c G2e2-|e2dc d2e2|"G7"zd2B G2d2-|d2cB c2d2|"C"ze2c G2c'2-|"A7"c'2ba g2e2|"D7"^f2ed c2A2|"G7"B4 G4|
"C"ze2c G2e2-|e2dc d2e2|"F"zf2c A2f2-|"Fm"f2_ed c2_A2|"C"G2ce g2e2|"A7"^c2ed ^c2e2|"D7"d2^fa "G7"g2=f2|"C"e4 c4:|
|:"F"A2cf a2f2|g2fe f4|"C"G2ce g2e2|f2ed e4|"D7"^F2Ad ^f2d2|e2dc d4|"G7"B2dg b2g2|a2gf g4|
"F"A2cf a2f2|g2fe f4|"C"G2ce g2c'2|"A7"b2ag e4|"D7"d2^fa c'2a2|"G7"g2fd B2G2|"C"c2eg c'2g2|c'4 z4:|` },
  { id: "strip-district-two-step", title: "Strip District Two-Step", family: "ragtime", credit: OWN, abc: `
T:Strip District Two-Step
M:2/4
L:1/16
K:F
|:"F"c2A2 F2A2|c2d2 c4|"C7"B2G2 E2G2|B2c2 B4|"C7"zc2e g2e2|"F"f2e2 d2c2|"D7"^c2d2 ^f2a2|"G7"g4 =f4|
"F"c2A2 F2A2|c2d2 c4|"Bb"zd2f b2a2|"Bbm"g2f2 _d2B2|"F"A2c2 "D7"^c2d2|"G7"zd2g =f2d2|"C7"e2g2 b2g2|"F"f4 z4:|
|:"Bb"zd2f d2B2|F4 B4|"F"zc2f c2A2|F4 A4|"G7"z=B2d f2d2|"C7"e2g2 c'4|"F"a2g2 f2c2|"C7"d2e2 f2g2|
"Bb"zd2f d2B2|F4 B4|"F"zc2f c2A2|"D7"F4 ^F4|"G7"G2=B2 d2f2|"C7"e2g2 b2g2|"F"f4 a4|f4 z4:|` },

  // ---------------------------------------------------------------- swing (originals in the 1930s idiom)
  { id: "crawford-grill-stomp", title: "Crawford Grill Stomp", family: "swing", credit: OWN, abc: `
T:Crawford Grill Stomp
M:4/4
L:1/8
K:F
|:"F6"zc2A c2A2|"F6"zcdc- c4|"Bb7"zd2B d2B2|"F6"zcdc- c4|"Gm7"zBdf "C7"edcB|"F6"A2c2 "D7"^F2A2|"Gm7"G2Bd "C7"cBGE|"F6"F4 z4:|
|:"A7"ze2^c e2^c2|"Dm7"zdfa- a4|"G7"zd2=B d2=B2|"C7"zceg- g4|"F6"zc2A c2A2|"D7"z^FAd- d4|"Gm7"zGBd "C7"cBGE|"F6"F4 z4:|` },
  { id: "mon-valley-jump", title: "Mon Valley Jump", family: "swing", credit: OWN, abc: `
T:Mon Valley Jump
M:4/4
L:1/8
K:Bb
|:"Bb6"F2B2 d2B2|"Bb6"zFBd- d4|"Eb7"G2B2 _d2B2|"Bb6"zFBd- d4|"Cm7"c2e2 "F7"g2fe|"Bb6"d2B2 "G7"=B2d2|"Cm7"cdec "F7"AcFA|"Bb6"B4 z4:|
|:"Eb"e2ge "Ebm"_g2e2|"Bb"d2fd- d4|"C7"c2ec "F7"=e2c2|"Bb"B2dB- B4|"Eb"e2ge "Ebm"_g2e2|"Bb"d2fd "G7"=B2d2|"Cm7"c2eg "F7"fecA|"Bb6"B4 z4:|` },
  { id: "liberty-avenue-shuffle", title: "Liberty Avenue Shuffle", family: "swing", credit: OWN, bpm: 112, abc: `
T:Liberty Avenue Shuffle
M:4/4
L:1/8
K:C
|:"C6"e3d e2g2|"Am7"c'4 a2g2|"Dm7"f3e f2a2|"G7"g6 z2|"C6"e3d e2g2|"A7"^c'4 a2g2|"Dm7"f2ed "G7"cBAG|"C6"c6 z2:|
|:"E7"^g3^f g2b2|"Am7"a4 e2c2|"D7"^f3e f2a2|"G7"g4 d2B2|"C6"e3d e2g2|"A7"^c'2ba "D7"^f2a2|"Dm7"g2fe "G7"dcBG|"C6"c6 z2:|` },

  // ---------------------------------------------------------------- Sunday: hymns and a chorale
  { id: "old-hundredth", title: "Old Hundredth", family: "sundaybells", credit: "Genevan Psalter, 1551", bpm: 88, lead: "organ", abc: `
T:Old Hundredth
M:4/4
L:1/4
K:G
|:"G"G2GF|"Em"ED"G"GA|"G"B2B2|"G"BB"D"AG|"C"cB"D"A2|"G"G2AB|"D"AG"Em"EF|"G"G2D2|"G"GAB"D"A|"G"G"C"c"G"B2|"D"A2"G"G2|z4:|` },
  { id: "amazing-grace", title: "Amazing Grace (New Britain)", family: "sundaybells", credit: "Traditional (American), 1829", bpm: 80, lead: "organ", abc: `
T:Amazing Grace
M:3/4
L:1/4
K:G
D|:"G"G2B/G/|B2A|"C"G2E|"G"D2D|"G"G2B/G/|B2A/B/|"D"d3-|d2B|"G"d2B/G/|B2A|"C"G2E|"G"D2D|"G"G2B/G/|"D"B2A|1"G"G3-|G2D:|2"G"G3-|G3|]` },
  { id: "hymn-to-joy", title: "Hymn to Joy", family: "sundaybells", credit: "Ludwig van Beethoven, 1824", bpm: 100, lead: "organ", abc: `
T:Hymn to Joy
M:4/4
L:1/4
K:C
|"C"EEFG|"G"GFED|"C"CCDE|"G"E3/2D/D2|"C"EEFG|"G"GFED|"C"CCDE|"G"D3/2C/"C"C2|
"G"DDEC|"G"DE/F/EC|"G"DE/F/ED|"C"CD"G"G,2|"C"EEFG|"G"GFED|"C"CCDE|"G"D3/2C/"C"C2|]` },
  { id: "monongahela-chorale", title: "Monongahela Chorale", family: "sundaybells", credit: OWN, bpm: 84, lead: "organ", abc: `
T:Monongahela Chorale
M:4/4
L:1/4
K:F
|"F"A2AG|"Dm"FA"F"c2|"Bb"BA"C"GG|"F"A4|"F"A2Ac|"Bb"dc"Gm"BA|"C"GA"C7"BG|"F"F4|
"F"c2cA|"Bb"Bc"Bb"d2|"F"cA"C"GA|"Dm"FE"A"D2|"F"CFAc|"Bb"BA"C"G2|"F"FA"C"GE|"F"F4|]` },
];
