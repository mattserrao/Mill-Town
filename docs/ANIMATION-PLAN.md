# Animation plan

Every moving thing on the map is decoration that reads the simulation: nothing is simulated off screen. This
plan makes the animations match what the game says is happening: who is going where and when, which works
run, what they ship and how dirty they are. It comes from the animation review of v0.12.0 (31 Oct 2026).

Files: `src/render/traffic.ts` (people, vehicles, trains, boats, haze, spills), `src/render/renderer.ts`
(smoke, glow, flame, moored boats, lights), `src/render/plants.ts` (emitters), `src/main.ts` (draw order).

## Phase 1 — Bugs (small)

| # | Fix | Where | Done when |
|---|---|---|---|
| 1.1 | Spills and slag only from works that are running: skip closed rivals, rivals not yet open, rivals on strike | `drawSpills` | Carrie Furnaces show no plume or pour after 1978 |
| 1.2 | Take each rival's industry from `RIVALS` instead of guessing from its id | `drawSpills` | Duquesne Light shows a power plume and no slag; Mesta and American Bridge show metalworks |
| 1.3 | Moored barges at a rival's dock only while it runs | `renderer.ts` tile sprites | A closed works' dock is empty |
| 1.4 | Docked paddle steamers only before ~1930; afterwards towboats (and a few excursion boats) | `renderer.ts` tile sprites | No white paddle steamers at the Point in 1958 |

## Phase 2 — Pollution follows the simulation (medium)

| # | Change | Where |
|---|---|---|
| 2.1 | Smoke darkness and plume size scale with the year (lighter in the gas boom 1884–91, after smoke control 1946) and with each works' waste policy (abate: lighter, dump: darker) | `drawAnimated`, emitter data |
| 2.2 | Glow and flame brightness follow last season's output share (dim when laid off or far behind) | `drawAnimated` |
| 2.3 | Wind direction by season (from a seeded table), shared by smoke and haze | `drawAnimated`, `drawHaze` |
| 2.4 | Haze drawn per area from the "smoke this season" field (`env.air`), so valley inversions and mill towns look worse than the hilltops; keep a light era tint on top | `drawHaze` |
| 2.5 | Spill plumes shrink with abatement and after ALCOSAN (1959); slag pours stop from "Slag Dumping Ends" (1972) | `drawSpills`, read `g.flags` / policy |
| 2.6 | One-off dark plume below Clairton for "Benzene in the Mon" (1984), a few seasons long | effect flag in `era4.ts` + `drawSpills` |

## Phase 3 — People with somewhere to go (medium–large)

| # | Change | Where |
|---|---|---|
| 3.1 | About a third of street figures are commuters with a destination (nearest works or downtown, from the commute centres); they head there along the travel-time field and vanish at the gate | `traffic.ts` spawn/choose |
| 3.2 | Time of day: shift change at dawn and dusk doubles commuters toward or away from the works; at night street figures drop to ~15% (a few cars and streetcars, lit) | `traffic.update` reads the day/night value |
| 3.3 | Strikes: a picket crowd (walkers standing, a few banners) at the gate of any works on strike, yours or a rival's; no commuters into it | new `drawPickets`, `g.strikeAt` |
| 3.4 | Towns with a closed mill or many jobless thin out: fewer vehicles, more people on foot standing about | spawn weights from `g.jobless`, closed rivals |
| 3.5 | Floods: no street traffic on flooded floodplain tiles that season | spawn check against flood |

## Phase 4 — Trains and boats with a job (medium)

| # | Change | Where |
|---|---|---|
| 4.1 | Trains follow the freight lanes the simulation used (`ship.lanes`) and turn back at line ends instead of stalling in sidings | `spawnTrain`, `choose` |
| 4.2 | A freight train stands at a works siding when that works ships by rail (yours included) | new parked-train agent |
| 4.3 | Boats start heading along the river (upstream or downstream from the flow field) instead of a random direction; tows hold course | `spawnBoat` |
| 4.4 | Ice and low water (from the freight model's seasonal capacity) thin out river traffic in winter | spawn weight |

## Order and size

| Order | Phase | Size | Why first |
|---|---|---|---|
| 1 | Phase 1 | S (an hour or two) | Visible bugs |
| 2 | Phase 2 | M | Pollution is the game's theme; its visuals should answer to policy and history |
| 3 | Phase 3 | M–L | Biggest change to how the town feels; 3.2 and 3.3 are the most noticeable |
| 4 | Phase 4 | M | Polish |

## Checks

- Browser runs at 1856, 1905 (day, night, strike), 1958 and 1981, at zooms 0.25×, 1× and 2×, with screenshots.
- Frame time stays under ~16 ms at 1× in a busy view (the agent cap of 420 street figures stays).
- No new unit tests; this is render-side only.
