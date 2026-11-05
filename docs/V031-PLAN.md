# v0.31 — Visual realism (plan + test-branch results)

Branch: `test/visual-realism`. Comparison PNGs (v0.30 left, v0.31 right): `docs/v031/`.

Decisions taken while Matt was away (all easy to change):
- Slag dumps take land (they're a sim feature, not scenery).
- **Detail** defaults to **High**.
- The 2×-density close-zoom sprite set is left for later.

## What's built

### Detail setting
- ☰ menu → **Detail**: Low / Med / High (remembered; `?detail=0|1|2` overrides). `render/light.ts` holds it. Chunks are keyed by it.
- **Low**: the v0.30 look (no shadows, clutter, new trees or reflections).
- **Med**: hill shadows and occlusion, trees by site, clutter on the busy streets.
- **High**: everything, including object shadows, the daytime reflections, and wires on all streets.

### 1. Cast shadows and ambient occlusion (`render/light.ts`, `renderChunk`)
- **Hill shadows:** one O(n) sweep per diagonal of the vertex grid, from a low afternoon sun in the south-west (the shading's azimuth, about 30° up). It's worked at drawn relief, so 2.5× hills throw 2.5× shadows. Shadow edges are soft over 6 m.
- **Occlusion:** a vertex below the mean of a 3-tile ring darkens (hollows, ravines, the foot of bluffs).
- Both are per-vertex factors interpolated across each ground triangle. Water takes them at half strength. Buildings and trees standing in a hill's shadow are shaded with it.
- **Object shadows (High):**
  - The chunk is now drawn in three passes: all ground, then shadows, then sprites. A per-pixel "which diagonal drew this ground" buffer keeps sprites hidden behind nearer hills, as before.
  - A building's shadow is each sprite column thrown screen-right by its height, plus a dark contact line at its foot. A tree's shadow is a soft ellipse under its crown.
  - Cemeteries, gob piles and similar are low. Bushes, boats, bridges, lamps, wires and slag throw none.
- Shadows only fall on ground and stop at chunk edges.

### 2. Lots, streets and paving (`groundShader`, `houses.ts`)
- **City streets** (next to rows or shops):
  - roadway narrowed to about a third of the tile
  - a stone kerb, a flagstone sidewalk, then trodden areaways up to the house fronts
  - a fire hydrant here and there from 1875
- **Paving by era:**
  - dirt
  - Belgian block (city from 1865)
  - brick (pikes 1885, city 1890, lanes 1905)
  - asphalt with a centre line (pikes 1915, city 1925, lanes 1935)
  - country lanes go to macadam where people live
- City alleys are brick after 1900.
- Open lots in the thick of the city are worn bare, not lawn.
- **Frame-house lots:** a tile now holds one wide house, a pair, or three front-gabled worker's houses on narrow lots (the mill towns' 25-ft plat). Each house has its own setback.
- Rows already ran continuous across tiles and stepped down hills (unchanged).

### 3. Trees, clutter, yards, hillsides
- **Trees by site** (Med+):
  - sycamore and silver maple next to water and on floodplain
  - hemlock on shaded north-facing slopes
  - oak and hickory on the uplands
  - sumac on weedy and scrub lots
  - trees near the works thin out and yellow with the soot ("sick" trees)
  - woods grow in clumps and glades instead of evenly
- New sprites: sycamore, hemlock, sumac and smoke-sick trees (`sprites.ts`).
- **Wires** along straight streets (`render/clutter.ts`), from 0.75× zoom:
  - telegraph on the pikes from 1850
  - electric with a crossarm in town from 1890, everywhere settled from 1915
  - trolley poles, span wires and the trolley wire on city pikes 1890–1960
- **Billboards** along the pikes from 1905.
- **Yards:** the wash on the line comes out grey in sooty years. Retaining walls darken with soot.
- **Hillside ledges:** steep slopes (≥ 20) show level sandstone and shale ledges, each with a dark overhang.
- **Chimney smoke:** thin wisps from house chimneys in autumn and winter turns, leaning downwind (live layer, Med+, from 0.5× zoom).

### 4. Industrial landforms
- **Slag dumps** (`core/slag.ts`, the one sim change):
  - Each steel works (yours or a rival's) makes a step of slag per 550 units of output. It goes to a dump that starts on the lowest open ground within 24 tiles: a riverbank first, then a hollow. The dump stays on the works' own side of the river and keeps a tile clear of houses, streets and public land.
  - The dump grows from its edge. Each tile rises 1.5 m a step to 24 m. Its interior corners rise no steeper than 7 m per tile in from the edge, so small dumps are low mounds and big ones stand tall. The edge tiles are the tipped face. Nothing beside a dump is tilted.
  - Slag tiles are `Use.Rock`, so nothing builds on them. `world.slag` holds the steps. The height goes into the graded ground, which is already saved.
  - Save format 5. The 1947 start has about 800 dump tiles along the Mon.
  - Drawn as grey-tan cinders with pale fresh runs. Face tiles show tipped runs; top tiles show the dump track and a ladle car.
- **Molten pours:** a glowing run down a dump's face near a running steel works, every 40 s or so. It's faint by day and bright at night.
- **Coke ovens:** beehive banks (domes, mouths, larry car, quenched coke) on open lots next to drift mines, up to 1930.
- **Mines:** gob piles beside drift mines, some with burnt red shale. Strip-mine benches on open country hilltops from 1942.
- **Barge fleets:** rafts of six coal barges tied up at the wharves and mill docks from 1880.
- **Rail and ore:** strings of hoppers, gondolas and boxcars on the works' sidings. Ore piles under an ore bridge beside steel docks.

### 5. Night, water, air
- **Furnace light:**
  - one broad orange sky-glow per works, scaled by how hard it ran
  - Bessemer blows that flare for a few seconds every ~20 s, each on its own beat
  - lights go out with the works (emitters stop when a works is idle)
- **River reflections at night:** under every bright light the river carries a broken, flickering streak.
- **Day reflections (High, ≥ 0.5×):** the far bank and what stands on it are mirrored below the shoreline, rippled and fading over about 56 px.
- **Current:** faint streaks drawn along the river's run on open water (Med+).
- **Era grade:**
  - darkest 1900–1941
  - clearing from the 1941 smoke ordinance to 1947
  - bright and clear after (the Renaissance)
  - the 1884–91 natural-gas clearing is kept

## Follow-up: the "not done" items, now done

### Seasons (`render/seasons.ts`)
- The map shows the turn's season. Spring and summer stay green.
- **Autumn:** each tree species turns its own colour:
  - oak russet
  - maple red and orange
  - sycamore yellow-brown
  - sumac crimson

  Each tree turns on its own beat. Grass goes tawny with fallen leaves, and yard trees in the house and works sprites turn too.
- **Winter:**
  - deciduous trees go bare (a tracery of twigs); pines and hemlocks keep their green under snow
  - snow lies on the ground, greyed by the soot near the works
  - paving is slushy; rock shows on the cliffs
  - snow on the roofs and along every top edge
  - shore ice along the river banks and frozen creeks
- On at Med and High. Chunks are keyed by the look, so a turn re-draws them when the season changes.

### Shadows at night and across chunk edges
- **Night:** shade (hill shadows, occlusion, cast shadows, a sprite in a hill's shadow) is now its own layer per chunk, drawn over the chunk at `1 − night`. Shadows fade out at dusk and are gone at night.
- **Chunk edges:** each chunk also casts the shadows of the tiles just off its screen-left edges, so a tall building's shadow carries into the next chunk.

### Brown's Dump (Nine Mile Run, 1922–72) (`core/slag.ts`)
- From spring 1922 a third of the slag of every steel works within ~7 km goes to the Nine Mile Run valley. It's tipped along the run's course (never in the creek bed) and spreads up the valley sides. A new bank starts where the valley side is open when the old one is hemmed in.
- A headline marks the start. It stops in 1972.
- The tiles are kept in `slag.nmr`. The 1947 start has it well grown.
- Dumps now have a talus: open ground next to a heap takes spilled slag part way up, so the foot is a slope, not a saw-tooth.

### Roundhouses and turntables
- The big yards are found where the rails lie thickest, eight on the map.
- From 1865 each yard has a roundhouse on open ground beside it:
  - a turntable pit with its girder bridge
  - an arc of seven brick stalls, each with a door and a smoke jack
  - tracks fanning out from the pit

### Sub-tile lots (`houses.ts` `lotsFor`)
- Frame-house tiles are platted properly. One, two, three or four lots of uneven widths, with the lot lines falling differently on each tile.
- Each house takes most of its lot with a side yard on one side or the other, and is set back its own distance.
- A fence runs down each lot line through the back yards. Now and then a narrow lot is a kitchen garden.

### Haze by elevation
- Already in the game (`paintHaze` weights the valley floors over the hilltops). Only the era grade was added.

### Still open
- The 2×-density close-zoom sprite set (deferred by decision).
- Summerset, the reclamation of Brown's Dump, is after the game's end.

## Verification
- Typecheck and build clean. 164 tests pass, including `tests/slag.test.ts` (works' dumps, and Brown's Dump along Nine Mile Run by 1947).
- Starts re-baked. Determinism hashes re-pinned for the 1893 and 1947 starts. The 1850 hashes are unchanged: no steel runs in the first ten seasons.
- **Raster time** (headless Chrome, 1920 town):

  | Detail | Average chunk at 1× |
  |---|---|
  | Low | ~55–95 ms |
  | High | ~70–100 ms |

  That's +10–25% on High at 1×, about the same at 0.5×. The cost is mostly the shadow pass and the reflections.
- Checked on screen: 1893, 1920 and 1947 starts at 0.25–2×, day and night.

## Files
- **New:** `src/render/light.ts`, `src/render/clutter.ts`, `src/render/seasons.ts`, `src/core/slag.ts`, `tests/slag.test.ts`.
- **Changed:** `renderer.ts` (three-pass chunks, shadows, reflections, paving, trees, clutter, night glow, pours, chimneys), `houses.ts`, `sprites.ts`, `pollution.ts` (era grade), `game.ts` / `town.ts` / `save.ts` (slag, format 5), `main.ts` and `index.html` (Detail setting, `mt.later` dev hook).
