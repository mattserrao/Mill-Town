# Mill Town — Plan

## Decisions
| Topic | Decision |
|---|---|
| Platform | Browser game (TypeScript + Vite + Canvas 2D), desktop only |
| View | 2:1 isometric pixel art, SimCity 2000 style |
| Map | Highly accurate: USGS 10 m elevation, hydrography and transportation → 720×720 tiles at 30 m (the Point to Clairton) |
| Art | Generated in code (procedural pixel sprites) |
| Turns | Turn-based, 1 turn = 1 season |
| Eras | Three: I Iron, Coal & Steam (1850–89) · II The Age of Steel (1890–1944) · III Peak & Collapse (1945–85) |
| End | Collapse is the final test |
| Industries | Steel, Power, Glass, Metalworking/Shipbuilding. Start with one; buy into others from Era II |
| Generations | A span of eras (no dynasty) |
| Rivals | AI rivals, real figures (Carnegie, Frick, Jones & Laughlin, Westinghouse, PPG, Mellon, Dravo) |
| Town | Grows on its own in response to the mill; the player doesn't zone |
| History | Real figures and events |
| Business tone | Everything goes: Pinkertons, violent strike-breaking, child labour, deliberate pollution are available, with heavy reputation/unrest/legal costs |
| Sabotage | Legal-but-ruthless tactics plus literal sabotage (rare, risky; scandal and legal ruin if caught) |
| Action pace | 2–3 actions per season plus standing policies (wages, hours, union stance) that persist until changed |
| Meters | Visible: reputation, labour relations, political influence beside cash |
| Building placement | The game suggests a spot; the player confirms or moves it |
| Public works | Private infrastructure only (sidings, docks, private rail, company housing); lobby the city for roads, bridges, locks |
| Acquisitions | An acquired works runs as a second site with its own panel (capacity, tech, labour, freight); a company view sums them |
| Second industry (1890+) | Buy an existing rival works or found a new one |
| Trust buy-out | Not available: always play to 1985 |
| Historical moments | Decisions when they touch your works (e.g. Homestead 1892 at your mill); elsewhere history plays out as written |
| Rival AI | Rivals take the same actions, by personality (Carnegie integrates and cuts prices, Frick corners coke and breaks strikes, Mellon finances and buys) |
| Collapse | Hard but possible to survive: modernise, diversify, keep labour peace |

## Core loop
Pick a site → found the works → each season: hire from the local labor pool, buy inputs, ship by river, sell output →
profits fund tech (money + time + milestones) → the works pollutes and draws migrants → the town spreads toward the jobs →
rivals enter at historical dates → eras shift markets → Era III collapse.

## Milestones
1. **Map + core model + inspector** ← *current build*
   - Real terrain/rivers/creeks/coal seam pipeline; real street network, rail lines with opening years, historic bridges, wharves, 1850 landmarks
   - Seeded 1850 town grown along real street alignments (rowhouse blocks, frame houses, farms in fields, woods)
   - Smooth-terrain iso renderer (corner heights, lighting), detailed procedural sprites, overlays, tile inspector, site scoring, minimap
   - Minimal season loop: found company (grades its site flat), production, wages, pollution, migration, rival entry, rail/bridge openings
   - Building variety: era styles by build year, continuous terraces with corner shops, kit-of-parts houses,
     hillside foundations and city steps, wealth tiers (shanties, company doubles, boarding houses, mansions),
     shops/taverns/hotels/banks/market house, churches incl. onion domes, schools, firehouses, funded library,
     yard life (privies, laundry, gardens), soot and abandonment
   - Plants: process-flow layouts facing the river, multi-tile segmented buildings, technology stages per industry,
     coke ovens, ore bridges, docks and moored barges, rail spur cars, drift mines, inclines, rival palettes/signatures
   - Hillsides: real neighbourhoods (South Side Slopes, Mt. Washington, Troy Hill, Polish Hill, Hill District,
     Greenfield, the mill-town hilltops) fill in on their historical timing as the region grows; rowhouses step
     down the slope, lots are cut into terraces with stone retaining walls, public steps link streets, seven real
     inclines open on their dates; labor is weighted by walking time; players can build steps and inclines
   - Town texture: brick rowhouse blocks only in the city cores and along main streets, frame houses elsewhere;
     gardens and vacant lots; varied rows (3–5 units, side alleys, painted ads); downtown warehouses and commercial
     blocks, with a skyline that grows by era (Romanesque → early skyscrapers → Art Deco → postwar glass);
     parks (Allegheny Commons 1867, Schenley 1889, Frick 1927); inclines drawn as trestles with moving cars
   - Animation: smoke and steam, furnace glow and flame, day/night with lit windows and lamps; strikes, floods, idle
   - Bridges: real spans drawn as smooth single structures (covered, suspension, lenticular, truss, arch) that
     change type on their historical rebuild dates; rail river crossings drawn as trusses
   - Street life: walkers, wagons, carriages, streetcars (1890–1955), autos (1915+), trucks, trains with cars on open
     lines, steamboats and towboats with barges; spawned only where you're looking; haze by era (gas boom, smoke control);
     outfall spills downstream of plants and slag pours
   - Historical events: `docs/EVENTS.csv` (Year, Season, Event Name, Description, Category; ~400 events, sourced in
     `docs/EVENTS-RESEARCH.md`) drives newspaper headlines and
     timed effects (prices, strikes, wages, migration, pollution, floods, epidemics) — edit the CSV to change the timeline
   - Ancestry: 12 groups with real immigration wave timing, chain migration, anchor neighbourhoods, succession;
     churches, synagogues and social halls appear where communities grow; Ancestry overlay
   - Sound: procedural music by era and by the community in view (parlor, Irish, polka, csárdás, tamburitza,
     tarantella, klezmer, ragtime, swing, bebop, doo-wop, soul, funk, synth-pop, mill-closing elegy); ambient beds and
     one-shots mixed by zoom and what's on screen (mill, river, trains, whistles, bells, crowds, birds)
   - Time: Next season / Next year / Play (auto-advance, holds on headlines); the town grows every season; the game ends
     after Winter 1985 with a final newspaper summary (company record, peak and final valley population)
   - Start: "Found your company" steps at the top of the panel, footprint shown under the cursor, "Show me a good site"
   - Query tool (? / Q): click a tile for its building, everything on it, the land, and its neighbourhood —
     composition, which communities seeded it and when, and a growth chart by community (5-yearly history)
   - Zoomed out (< 0.375×) only trains, river craft and smoke animate; version shown in the top bar, console and terminal
   - Valley systems (v0.8, see `docs/MECHANICS.md` §5): smoke from every works, home and locomotive in block
     fields with valley inversions; river water and health; unrest drives strikes; desirability-driven settling
     (newcomers on cheap smoky lots, the settled move uphill); commute model with streetcars and cars whose trips
     drive the street animation; freight by river and rail with seasonal capacities shared with the rivals (rail
     siding action); community style kits, shops and institutions with succession
   - Smooth lines: creeks and rail lines drawn from the source vectors; tile staircases chamfered on streets and
     shorelines; bluffs blend into the woods
   - Economic connections (`src/core/economy.ts`, `src/render/flows.ts`):
     - **Supply chain** overlay: raw materials in (orange), utilities in or out (water blue, gas lime, electricity
       yellow), finished goods out (pink). Routes follow the rivers and the rail lines open that year to real
       gateways at the map edge (down the Ohio, up the Allegheny/Mon/Yough, PRR east, Fort Wayne line west,
       Connellsville by the P&C, Murrysville gas). Line width = share; moving dots show direction; off-screen partners
       are labelled at the edge they lie towards. Before founding it previews the selected site.
     - Sources and markets change by era and tech (Juniata ore → Lake Superior ore; drift-mine coal → Connellsville
       coke from Frick; natural gas 1884+; electricity from Westinghouse/Duquesne Light; Heinz bottles; LSTs in WWII);
       rival works appear as suppliers and customers. A power company's customers are towns and plants in reach.
     - **Supply chain** panel (right): every link with quantity, share bar, partner, carrier and value; hover
       highlights it on the map, click flies there.
     - **Competitors** overlay and panel: every rival works (open or still to come), coloured competitor / supplier /
       customer / other, with product, estimated output, distance and people; your share of capacity on the map.
   - Overlay review: grouped Land / Town / Business with a palette chip each; every overlay has its own palette
     (hypsometric elevation, viridis population, navy→gold land value, soot pollution, stepped walk-time bands,
     red→green site scores) shown in steps with a legend bar; the ground under an overlay is washed to grey
2. Logistics: ~~barges/rail as transport capacity; input sourcing from off-map gateways~~ (v0.8); next: finished-goods shipping out, player-built docks, and one gateway/route model shared by the supply-chain map (`economy.ts`) and the freight simulation (`freight.ts`)
3. Town simulation: housing tiers, services, wages and unrest, company town buildings, land value feedback
4. Tech tree UI and research; era transitions and market prices
5. Rival AI behaviour (bid for land, price wars, buyouts, labor policy)
6. Second industry purchase (Era II) and cross-industry supply (power → mills, steel → shipyards)
7. Historical events (1877 rail strike, 1892 Homestead, 1936 flood, wars, 1950s peak, 1980s collapse) and legacy choices
8. Art pass (smooth slopes, more building sprites, animation), sound, saves, balancing

## Mechanics review
See `docs/MECHANICS.md` — comparison with SimCity (Micropolis) and the recommended next steps for ticks,
routing, environment, growth and neighbourhood style.

## Known gaps in the current build
- Economy balance: profits pile up; input prices and the freight premium need tuning against wages and prices
- Rivals' output is estimated from the technology of their day; they don't yet react to congestion or unrest
- A screen of new chunks takes ~0.5–1 s to draw after a big jump; after a turn only the chunks whose contents changed redraw
- Economy numbers are first-pass placeholders. The supply-chain map (`economy.ts`) is still a display model;
  capacities and congestion now live in the freight simulation (`freight.ts`, v0.8), and the two should share one route model
- Event effects are first-pass; dates for some events are approximate
- Music is generated, not composed: melodies are stylistically right but simple
- Streets use today's alignments; some modern-only roads appear where towns grow
- Coal seam is a simplified linear model of the Pittsburgh coal
- Modern river pools (post lock-and-dam); 1850 shorelines were a little different
- 1850 populations and landmark coordinates are approximate
