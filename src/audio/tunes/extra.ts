// More of the songs everyone in the valley knew: Foster's minstrel-show songs, Scottish and Ukrainian folk songs,
// and the New Orleans hymn the brass bands marched to. All traditional or published before 1931. No lyrics.

import type { Tune } from "./types";

export const EXTRA: Tune[] = [
  { id: "auld-lang-syne", title: "Auld Lang Syne", family: "parlor", credit: "Traditional (Scottish)", bpm: 84, abc: `
T:Auld Lang Syne
M:4/4
L:1/8
K:F
C2|"F"F3 F F2 A2|"C"G3 F G2 A2|"F"F3 F A2 c2|"Bb"d6 d2|"F"c3 A A2 F2|"C"G3 F G2 A2|"Dm"F3 D "Bb"D2 C2|"F"F6 d2|
"F"c3 A A2 F2|"C"G3 F G2 d2|"F"c3 A A2 c2|"Bb"d6 f2|"F"c3 A A2 F2|"C"G3 F G2 A2|"Dm"F3 D "Bb"D2 "C"C2|"F"F6|]` },
  { id: "camptown-races", title: "Camptown Races", family: "oldtime", credit: "Stephen Foster, 1850", year: 1850, bpm: 112, abc: `
T:Camptown Races
M:4/4
L:1/8
K:C
|:"C"G2 G2 E2 G2|A2 G2 E4|E2 D6|E2 D6|"C"G2 G2 E2 G2|A2 G2 E4|"G"D4 E2 D2|"C"C8:|
"C"C3 C E2 G2|c8|"F"A3 A c2 A2|"C"G8|G2 G2 E2 E2|G2 G2 A2 G2|E4 "G"D2 E2|D2 "C"C6|]` },
  { id: "oh-susanna", title: "Oh! Susanna", family: "oldtime", credit: "Stephen Foster, 1848", year: 1848, bpm: 108, abc: `
T:Oh! Susanna
M:4/4
L:1/8
K:C
CD|"C"E2 G2 G3 A|G2 E2 C3 D|E2 E2 D2 C2|"G"D6 CD|"C"E2 G2 G3 A|G2 E2 C3 D|E2 E2 "G"D2 D2|"C"C6 CD|
"C"E2 G2 G3 A|G2 E2 C3 D|E2 E2 D2 C2|"G"D6 CD|"C"E2 G2 G3 A|G2 E2 C3 D|E2 E2 "G"D2 D2|"C"C6 z2|
"F"F4 F2 A2|"F"A4 A2 G2|"C"G2 G2 E2 C2|"G"D6 CD|"C"E2 G2 G3 A|G2 E2 C3 D|E2 E2 "G"D2 D2|"C"C6|]` },
  { id: "saints", title: "When the Saints Go Marching In", family: "march", credit: "Traditional (African American spiritual)", bpm: 116, abc: `
T:When the Saints Go Marching In
M:4/4
L:1/8
K:C
|:"C"z2 C2 E2 F2|G8|z2 C2 E2 F2|G8|z2 C2 E2 F2|G4 E4|C4 E4|"G"D8|
"G"z2 E2 E2 D2|"C"C6 C2|"C7"E4 G4|"F"G2 F6|"F"z2 E2 F2 G2|"C"E4 C4|"G"D4 D4|"C"C8:|` },
  { id: "saints-swing", title: "When the Saints Go Marching In", family: "swing", credit: "Traditional (African American spiritual)", bpm: 150, abc: `
T:When the Saints Go Marching In
M:4/4
L:1/8
K:F
|:"F"z2 F2 A2 B2|c8|z2 F2 A2 B2|c8|z2 F2 A2 B2|c4 A4|F4 A4|"C7"G8|
"C7"z2 A2 A2 G2|"F"F6 F2|"F7"A4 c4|"Bb"c2 B6|"Bb"z2 A2 B2 c2|"F"A4 F4|"C7"G4 G4|"F"F8:|` },
  { id: "shchedryk", title: "Shchedryk", family: "slavic", credit: "Traditional (Ukrainian), arr. Mykola Leontovych 1916", year: 1916, bpm: 150, abc: `
T:Shchedryk
M:3/4
L:1/8
K:Gm
|:"Gm"B2 AB G2|B2 AB G2|B2 AB G2|B2 AB G2:|
|:"Gm"d2 cd B2|d2 cd B2|"Cm"e2 de c2|e2 de c2|"Gm"g2 fg d2|g2 fg d2|"Cm"g3 f e2|"D"d3 c "Gm"B2:|
"Gm"B2 AB G2|B2 AB G2|"D"A2 GA F2|"Gm"G6|]` },
];
