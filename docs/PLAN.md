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
| Historical event actions | See `docs/EVENTS-PLAN.md` §6: no trust buy-out (1901 card instead); separate rivals; Frick stays at Homestead; add Mesta, National Tube, U.S. Steel Duquesne, Carrie Furnaces, Duquesne Light (Westinghouse → East Pittsburgh equipment maker); off-map places get stand-in sites on the map; streetcars still end 1955; coke = coal price for steel; build sell-a-works, layoffs, strike contagion, a morale meter and sports teams |

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
   - Running the business (v0.9, `src/core/business.ts`, `src/ui/business.ts`): three visible meters (reputation,
     labour relations, influence); 3 actions a season; standing policies (wages, hours, union, safety, boys under 14,
     company store, slag and waste) that change output, wages, strikes, pollution and fines and set where the meters
     drift; actions — labour (negotiate, Pinkertons, strikebreakers, lockout, blacklist, recruiting agents by
     community, picnic), public (endow a hospital or church, buy the papers), politics (lobby, bribe, river locks
     +35% barge capacity, tariff); historical decisions when your works is in them (Homestead 1892, 1919, 1937,
     1959) with "what the owners did" marked and auto-chosen if you skip
   - Works, technology and rivals (v0.10, `src/core/market.ts`, `projects.ts`, `rivalai.ts`, `src/ui/works.ts`):
     - Technology race: commission processes (cost up front, seasons to build, milestones); every process the
       industry has had for four years that you lack costs 10% on price (Westinghouse sets the standard early);
       bigger plant needs fewer men per ton
     - Building on the map, suggested then confirmed (click to move): expand the works (+30% capacity, up to 3),
       company housing, a private dock (no wagon haul, first call on the barges), a new works in any industry (1890+)
     - Rivals move by personality each season: Carnegie price wars and poaching, Frick corners coke, Mellon lends
       and finances the others, Westinghouse sues; everyone expands; a caught saboteur's victim takes revenge
     - Against the rivals: undercut, poach, rumours, buy their drawings, sabotage (often traced: ruinous), buy their
       works outright (runs as a second works with its own panel; Carnegie and Frick won't sell); Mellon loans
     - Upkeep on capacity; eight seasons overdrawn and the receivers take the company (game over)
     - One route model: the supply-chain map shows the lanes the freight simulation actually used
   - Interface and views (v0.11):
     - Game speeds: pause, 1× (a season every 13 s: a whole game in about two hours), 2×, 4×, 8×; keys P and 1–4
     - Markets view: prices by industry (index and $), what your works actually got, wages, coal and ore at the
       mine and delivered, and your revenue, costs and profit, season by season since 1850 (hover to read)
     - Cities & neighbourhoods overlay: borough limits that change with incorporations and annexations
       (Pittsburgh takes in Lawrenceville, East Liberty, Hazelwood 1868, Birmingham 1872, Allegheny City 1907),
       named neighbourhoods with their population and leading community; a Neighbourhood panel lists each
       community, what it has built and what it builds next. Communities now build per neighbourhood: boarding
       houses, then shops (300 people), a church (700), a social hall, a parish school (1,200), more as they grow
     - Music: 145 tunes — five of every style (own key, tempo, chords, lead and title) plus ten quiet mood pieces
       (river mist, furnaces at night, snow, Sunday bells, the empty mill…) played between songs and at night
     - English units throughout (feet and miles)
     - Every panel heading folds its section (remembered); the newspaper (with its back issues) and the log sit
       permanently at the bottom left
   - Historical events (v0.11.1): every row of `EVENTS.csv` is now handled — 301 of 405 events change the game (v0.11.2), the rest
     are headlines. One effects engine (`src/core/effects.ts`) with data in four era files
     (`src/core/eventdata/era1–4.ts`): scoped modifiers (by industry, good or freight gateway), floods and epidemics
     at named places, migration waves, rules that open or close actions (unions, company police, the sliding
     scale, the lab, bribes), political eras (machine, reform, New Deal, Renaissance), rival moves (expand, strike,
     close, rename), 64 dated landmarks plus 10 housing projects drawn on the map (libraries, hospitals, universities, ballparks, plants)
     that can close or fall to ruin, and 45 decision cards (Morgan's trust in 1901, Mother Jones, the Clairton
     consent decree, Dorothy Six…), queued when several arrive in one season
   - New rivals: National Tube (McKeesport), Carrie Furnaces (Rankin), Duquesne Works, Mesta (West Homestead),
     Duquesne Light; Westinghouse is an East Pittsburgh equipment maker. Rivals close on their historical dates
   - Town morale (0–100) and sports teams (Pirates, Steelers, Penguins, Pitt, Grays, Crawfords) that are founded,
     move grounds and win titles; strikes spread to works nearby; lay off men, call them back, fund relief, sell a works
   - Rest of the events plan (v0.11.2): public housing (the Housing Authority's projects go up on their dates
     from 1940 and keep their people); a redevelopment action (URA, 1946+: clear the cheapest housing beside your
     works); retraining the jobless (Community College 1966, cheaper after Bidwell); endowing the university
     (1894+: processes built a tenth faster); a Symphony subscription and Gulf Oil both cheapen Mellon loans;
     selling a works to its workers (from Weirton) or to the Steel Valley Authority (1985); American Bridge
     (Ambridge) and the Clairton Works as rivals; parks for Highland, Riverview, South Park and Point State Park;
     the 1882 courthouse fire and its rebuilding; Prohibition shutters the taverns until Repeal; Donora leaves four
     years of pressure on smoky works' reputation; the patent truce steadies power prices; the Ripper Act makes
     locks dearer; new processes: the 69 kV ring (power, 1915) and automation in every industry (1982)
   - Polish pass (v0.12): one-row top bar (Seed and New town under a Game menu, drawn sound icon); right panel in
     tabs (Company · Business · Town · Rivals); name your company at founding (a period name is suggested); the
     site report goes once you've founded; the log keeps headlines short (the paper has the stories); the paper
     says when an issue has more stories; rival plants named in full ("Carnegie Steel — Duquesne Works"); the
     Mellons shown as the bank; only the next inventions listed; Markets charts with round axes and yearly
     averages; districts drawn as smooth dashed lines; supply-chain and place labels kept clear of each other and
     the edges; crisp 2× zoom; barges with decks and cargo; a warning when your works falls behind; an end-of-game
     epilogue from your choices
   - Animation pass (v0.13, `docs/ANIMATION-PLAN.md`): smoke by era and waste policy, glow by output, seasonal wind,
     haze by area from the smoke model, spills that drift as a stain and shrink with abatement and ALCOSAN, slag
     pours to 1972, the 1984 benzene slick; commuters walking to the works, shift change and quiet nights, pickets
     at works on strike, thinner streets in closed mill towns and floods; trains on the freight routes that reverse
     at line ends, standing cuts at your sidings, boats along the river and fewer in winter; new period figures,
     horses, streetcars, cars by decade, steam and diesel trains with varied cars, steamboats and towboats with wakes,
     lamps and headlights at night
   - Interface pass (v0.14, `docs/UI-PLAN.md`): one sidebar; top bar with cash, last season's profit and four
     meter bars; tabs Overview · Works · Policy · Rivals with one-row actions and effect chips (full text on hover);
     policies as switches; the Map button holds the layers and view options; headline strip and a paper with the
     ledger; a click opens the tile card; **Trends** replaces Markets (cash, profit, price vs cost, capacity and
     men with process marks, market share by rival, risks; prices; the town). Rivals' output now follows their own
     processes, expansions, damage and cutbacks; each season records capacity, output, men, cost per unit, rival
     output, population, morale, the jobless, health and unrest
   - Roads, bridges and great works (v0.14, `src/core/roads.ts`, `src/core/patronage.ts`): the game suggests roads
     from the works to the large neighbourhoods (1,200+ people) that would bring the most men within reach for the
     money, and bridges across the river where the trip goes round by an old bridge or a ferry; you see the route on
     the map, then pay or lobby the city (influence; it builds it in 4–8 seasons). Roads are pikes (horsecars and
     streetcars run on them, houses settle along them); new bridges are drawn as real spans and carry traffic.
     The Town tab lists the great works (universities, colleges, schools, libraries, hospitals, museums, the
     conservatory, the zoo, parks…): each can be founded up to 15 years before history builds it, for cash and an
     action, opening at once with your name on it (reputation, influence, labour or morale); every landmark
     standing is listed and a click flies to it
   - Main menu and saving (v0.14.1, `src/core/save.ts`, `src/ui/menu.ts`): Resume last game · New game · Load game
     at start and from ☰; games saved in IndexedDB as one gzip blob (JSON header + typed-array bytes, ~3–4 MB);
     the map's graded ground is saved, site fields rebuilt; a decision waiting for you is saved by its event and
     asked again. Autosave every new year, on leaving the page and on opening the menu; named saves from ☰ (12
     kept). A loaded game plays on exactly as the original would (the town's community-building cursor moved into
     the world state for this)
2. Logistics: ~~barges/rail as transport capacity; input sourcing from off-map gateways~~ (v0.8); ~~player-built docks; one route model for inputs~~ (v0.10); next: finished-goods shipping out
3. Town simulation: housing tiers, services, wages and unrest, company town buildings, land value feedback
4. ~~Tech tree UI and research; market prices~~ (v0.10); next: era transitions in the UI
5. Rival AI behaviour: ~~price wars, cornering supply, lending, revenge (v0.10)~~; next: rivals bidding for land and
   buying each other (U.S. Steel 1901), rival strikes and lockouts shown at their works
6. ~~Second industry: buy or found (Era II)~~ (v0.10); next: cross-industry supply (power → mills, steel → shipyards)
7. Historical events (1877 rail strike, 1892 Homestead, 1936 flood, wars, 1950s peak, 1980s collapse) and legacy choices
8. Art pass (smooth slopes, more building sprites, animation), sound, ~~saves~~ (v0.14.1), balancing

## Mechanics review
See `docs/MECHANICS.md` — comparison with SimCity (Micropolis) and the recommended next steps for ticks,
routing, environment, growth and neighbourhood style.

## Known gaps in the current build
- Economy balance (v0.10 pass): a company that never invests goes under by the late 1870s; one that keeps up
  ends rich (cash still piles up from the 1940s unless spent on works, rivals or the town)
- Rivals' output is estimated from the technology of their day; they don't yet react to congestion or unrest
- A screen of new chunks takes ~0.5–1 s to draw after a big jump; after a turn only the chunks whose contents changed redraw
- Season loop cost (~200–300 ms a season late in the game): the biggest costs are town growth (`growByDesire`,
  three full-map passes a season), the per-tile labour-pool scan around each works, repeated population totals,
  and freight's site-access scans; all could be done per block or cached
- Finished goods: the markets on the supply-chain map are still a display model (inputs follow the freight simulation)
- Event effects are first-pass; dates for some events are approximate. The Steel Valley Authority (founded Jan 1986)
  is kept in Autumn 1985 so it appears
- Left out by design: highways, busways and the Liberty Tubes as travel links (X2; the Tubes act as South Hills
  growth), per-line transit (X1), outbound freight and taxes; Frick Park's land isn't held from growth before 1927
- The map canvas ignores the screen's pixel ratio: on HiDPI displays it is scaled up by the browser (sharp but uneven pixels)
- Moving figures and boats draw over buildings that stand in front of them (no per-tile depth yet)
- Music is generated, not composed: melodies are stylistically right but simple
- Streets use today's alignments; some modern-only roads appear where towns grow
- Coal seam is a simplified linear model of the Pittsburgh coal
- Modern river pools (post lock-and-dam); 1850 shorelines were a little different
- 1850 populations and landmark coordinates are approximate
