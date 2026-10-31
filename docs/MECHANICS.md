# Mill Town vs. SimCity (Micropolis) — simulation mechanics

Micropolis is the open-source release of the original SimCity (1989). Everything below about it is read
from its engine source (`MicropolisCore/src/MicropolisEngine/src`: `simulate.cpp`, `scan.cpp`, `traffic.cpp`,
`zone.cpp`, `micropolis.h`). Mill Town references are to this repo.

## 1. How Micropolis works

**The tick.** The simulation never touches the whole map at once. `simulate()` runs one of 16 phases per
call and cycles through them:

| Phase | Work |
|---|---|
| 0 | advance the clock; every other cycle recompute the R/C/I demand "valves"; clear the census |
| 1–8 | `mapScan` one eighth of the map (a vertical strip each): every zone tile runs its own growth step |
| 9 | census (every 10 and 120 ticks), taxes and city evaluation |
| 10 | decay the traffic map; every 5th cycle decay the rate-of-growth map |
| 11 | power-grid flood fill (every 2–5 cycles, by speed) |
| 12 | pollution + terrain + land value scan (every 2–17 cycles) |
| 13 | crime scan (every 1–18 cycles) |
| 14 | population density scan |
| 15 | fire coverage, disasters |

Work is spread over time, and the slow city-wide fields refresh less often than the tile-by-tile growth.

**Coarse maps.** The derived fields are stored at lower resolution than the tile map:
- 2×2 tiles: population density, traffic, pollution, land value, crime
- 4×4 tiles: terrain density
- 8×8 tiles: rate of growth, police and fire coverage, commercial rate

Pollution is also smoothed twice. Lower resolution is cheaper, smoother and closer to how people perceive a district.

**Growth is local and demand-driven.**
- **City-wide demand ("valves").** `setValves()` turns employment, migration (`res × (employment − 1)`),
  births (2%), the internal market and an external market into a velocity for each of three valves:
  residential, commercial and industrial. Tax rates push the valves down.
- **Each zone decides for itself during the map scan.** In `doResidential`:
  - Its score is `valve + local value`, where the local value is land value minus pollution, scaled.
  - A good score lets the zone grow a step (`doResIn`); a bad one shrinks it (`doResOut`).
  - An unpowered zone scores −500.

So the city as a whole sets *how much* growth there is, and each zone's own conditions set *where* it happens.

**Route planning (traffic).** It's a random walk on the road network, not a shortest path.
- A zone first needs a road on its edge (`findPerimeterRoad`).
- From there, `tryDrive` takes up to `MAX_TRAFFIC_DISTANCE = 30` steps along roads, never turning straight back.
- The walk succeeds if it reaches a destination zone: residential→commercial, commercial→residential,
  industrial→residential.
- On success, every road tile on the path gets +50 traffic (capped at 240).
- On failure ("can't get to work"):
  - −3000 to the residential score if the zone has no road at all;
  - zones that can't reach a destination stop growing.

Traffic then decays every tick. The result is cheap, local and good enough to make road layout matter.

**Environmental impact.** Pollution starts from tile types:
- light traffic 50, heavy traffic 75
- industrial 50
- ports, airports and power plants 100
- fire 90, radiation 255

It's summed per 2×2 block, smoothed twice, and then:
- **lowers land value:** `land value = (34 − distance from centre / 2) × 4 + terrain bonus − pollution`, −20 if crime > 190;
- **lowers residential desirability:** `local value = land value − pollution`;
- **feeds crime:** `crime = 128 − land value + population density − police coverage`.

Everything is one loop: pollution lowers land value, which lowers growth and raises crime.

## 2. How Mill Town works today

| | Micropolis | Mill Town |
|---|---|---|
| Tick | 16 phases, map scanned in 8 strips, slow fields every N cycles | one season = one call; every system runs over the whole 720×720 map |
| Resolution of derived fields | 2×2 / 4×4 / 8×8 blocks | per tile (30 m); ancestry history in 8×8 cells |
| How much growth | R/C/I valves from employment, migration, taxes | census curve for the valley (`REGION_POP`), plus migrants hired by the player's works |
| Where growth goes | each zone: valve + land value − pollution, needs road access | weighted shares to historical hillsides, 1850 settlements and plants; lots nearest the share centre on real streets |
| Routing | random-walk trips ≤ 30 tiles; failures block growth; traffic map | walking-time field (Dijkstra) from the works, used only to weight the labour pool; animated traffic is visual only |
| Pollution sources | industry, traffic, ports, power plants, fire | only the player's works (radius, drifts east); rivals and homes emit nothing |
| Pollution effects | land value, residential growth, crime | land value (up to −60%), soot on buildings, estates downgrade; no health or growth effect |
| Land value | distance to centre, terrain, pollution, crime | terrain base + nearby population + street + own pop, × (1 − pollution) |
| People | aggregate counts per zone | per tile, with ancestry (12 groups), chain migration and succession |

## 3. Feedback

### Tick updating: grid vs whole map
- **Cost is fine for now, but it grows with every system added.**
  - A turn takes about 130 ms; about 0.3 s at the slowest 5%.
  - Most of that is whole-map passes:
    - seasonal growth;
    - yearly land value over 518k tiles (with a summed-area table);
    - turnover over every tile;
    - pollution decay over every tile;
    - the yearly ancestry census.
  - Play mode at 1.5 s per season hides the cost, but every new system (traffic, health, crime) adds another full pass.
- **Recommendation: Micropolis's two ideas, adapted to seasons.**
  1. **Block fields.** Hold pollution, land value, crime/unrest, health and traffic at 4×4 tiles (120 m;
     a 180×180 grid, 16× fewer cells). Look values up per tile with bilinear sampling so edges stay smooth. Keep
     population, use and ancestry per tile, because the renderer and the neighbourhood view need them.
  2. **Phased scans.**
     - Run the expensive fields on a schedule: pollution every season, land value every other season, health
       and unrest once a year.
     - Spread the per-tile growth step over the four seasons by strips, like `mapScan` with 1/4 of the map
       per season.
     - Turn length then stays flat as systems are added.
- **Dirty regions.** The renderer now redraws only changed chunks. The simulation can do the same: keep a
  changed flag per 16×16 chunk so land value and steps re-evaluate only where something changed.
- **Keep it deterministic.** Seed each phase from (seed, turn, phase) as now, so saves and replays match.

### Route planning
- **Today labour is the only network effect**: walking time from the works.
  - Inclines and steps change it, which is good and historically right.
  - But nothing *travels*: ore, coal, coke, sand and finished goods have no route, and the animated traffic
    is decoration.
- **Recommendation: three layers, cheapest first.**
  1. **Commute trips by era** (closest to Micropolis's trip test).
     - Each season, sample a few hundred households and route them to a job on the real street graph.
     - Mode by year: walk (1850+), streetcar on pike lines (1890–1955), car (1920s+).
     - Where trips fail or are slow, the labour pool shrinks and growth stalls.
     - Streetcars then stretch the labour shed along their lines. Historically this is how East Liberty,
       Wilkinsburg and the Mon Valley boroughs filled in.
  2. **Freight on the networks the map already has.**
     - Rivers: barge links, with low water in summer, ice in winter, and locks and dams as capacity.
     - Rail: lines open on their real years.
     - Inputs come from off-map gateways: Connellsville coke from upriver, Lake Superior ore via the Ohio / Lake Erie railroads.
     - Each link has capacity per season; congestion raises cost.
     - This gives the player real choices (spurs, docks, a bridge) and makes the river matter.
  3. **Traffic density from those flows.** Like Micropolis's +50 per tile per trip:
     - It feeds pollution (wagons, then trucks).
     - It drives how many animated agents spawn on each street, so what you see is the simulation.
- Use shortest paths (A* on the street graph, cached per origin cell), not random walks. The map is real,
  so straight-line-plausible routes matter.

### Environmental impact
- **Today only the player pollutes.** Rival works, coke ovens, rail yards and home coal stoves emit nothing.
  - Historically, home heating was a large share of Pittsburgh's smoke, which is why the 1946 ordinance
    targeted homes too.
  - Pollution also has no consequence beyond land value and looks.
- **Recommendations:**
  - **Emitters:**
    - every plant (rivals included);
    - coke ovens (very high);
    - rail yards and steamboats;
    - homes, scaled by population density and coal era;
    - the gas boom (1884–91) and smoke control (1946) as multipliers.
    - Already easy: `spreadPollution` exists. Call it for rivals and add a home term at block resolution.
  - **Topography:**
    - Valleys trap smoke under inversions (Donora 1948).
    - Model it cheaply: pollution decays more slowly in low-lying blocks during autumn and winter; ridge-top blocks clear faster.
    - This makes the hills worth more, which is why the wealthy moved uphill and upwind (the East End).
  - **Water:**
    - Plant outfalls and sewage add a river-pollution value that flows downstream (the visual spill plumes already do this).
    - It raises typhoid and cholera risk in riverside wards until filtration (1908 event) and sewers.
  - **Health:**
    - A yearly health field from air + water + crowding (people per tile).
    - It feeds mortality (slower growth), worker productivity and unrest.
  - **The feedback loop that made the mill towns:**
    - Pollution lowers land value, so housing is cheaper.
    - Cheap housing is where the newest immigrants can afford to live; those who prosper move uphill.
    - Mill Town already has the pieces (land value, pollution, chain migration, succession). The missing link is
      letting land value and pollution weight *which group* settles a lot: newest waves weighted toward cheap and
      smoky lots, older groups toward clean and expensive ones.

### Growth model
- **The census curve is a good guardrail.** The valley's real population is the right target.
- **But `growRegion` decides *where* top-down**, from fixed historical shares, so the player's choices only
  matter through migrants their own works hire.
- **Recommendation: the Micropolis split.**
  - The census curve (plus jobs offered by all works) sets how many arrive each season, like the valves.
  - Each lot's desirability sets where they go:
    - walking or streetcar time to jobs;
    - land value;
    - pollution (negative, but less so for the newest arrivals);
    - steepness;
    - same-group neighbours (chain migration, already present);
    - churches and halls of the group within reach.
  - Historical hillsides become a desirability bonus on their dates rather than a fixed share.

### Neighbourhood composition (built in this pass)
- **How to see it today:**
  - The **Ancestry** overlay shows the map coloured by community.
  - The **? query tool** (button under the zoom buttons, or Q) shows, for any tile:
    - the building, what's on the tile, and the land;
    - the **neighbourhood**: a named one (Polish Hill, the Hill District, Homestead…) or a 300 m circle around the tile.
  - For the neighbourhood the card gives:
    - population and housing mix;
    - churches and halls;
    - current composition as a bar;
    - **"Seeded by"**: each community and the year it first gained a foothold, for those that became at least 4% of the area;
    - a **growth chart**: population by community every five years since 1850.
  - The history behind the card: the game records every 8×8-tile cell's population by community every five
    years, plus the first year each community reached 25 people there (`src/core/neighbourhood.ts`).
- **Proposal: "a community seeds a neighbourhood, then it grows into that style."**
  - Chain migration already makes the seed spread.
  - What's missing is the *look and the institutions*. Each group would carry a **style kit**, applied to
    lots where that group is the majority within about 150 m:
    - **Houses:**
      - paint palette and trim (e.g. Slovak/Rusyn: pastel and white trim);
      - roof form;
      - yard use: kitchen gardens and grape arbours (Italian, Slovak), chicken coops, fences.
    - **Street life:** which shops appear (bakery, butcher, kosher butcher, saloon, social club, barber) and festival decorations in season.
    - **Institutions in order:**
      1. boarding houses first (single men);
      2. then a church: the first service in a hall, a real church after N families;
      3. then a parish school;
      4. then a social hall or Sokol.
      - Each gives a small local pull to the same group (stronger chain migration) and a happiness/unrest effect.
    - **Succession:** when another group becomes the majority, the buildings remain. The old church stays and
      changes congregation, or closes, which is very Pittsburgh. The kit for *new* building switches.
  - The query card would then report the neighbourhood's **character**: for example, "Slovak since 1888,
    second-generation; Italian arriving since 1912".

## 4. Suggested order
1. Rivals and homes emit pollution; block-resolution pollution with valley inversions.
2. Desirability-driven siting (census curve sets the count, lot desirability sets the place); land value and
   pollution steer which groups settle where.
3. Phased scans and block fields, before adding more systems.
4. Commute trips with streetcars; traffic density drives the animation.
5. Freight routing on river and rail with capacities.
6. Health (air, water, crowding) and unrest.
7. Group style kits and institutions.
