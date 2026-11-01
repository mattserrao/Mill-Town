# Mill-Town
Choose an Industrial Revolution industry. Grow your company and the town alongside it. Make choices that reverberate across generations.

Turn-based (one turn = one season), 1850–1985, on a real-geography map of Pittsburgh and the Monongahela Valley in 2:1 isometric pixel art. Desktop browsers only.

## Run

```
npm install
npm run dev        # http://localhost:5173  (add ?seed=1234 for a specific town)
npm test           # core model tests (about 3 minutes)
npm run typecheck  # TypeScript only
npm run build      # typecheck + production build into dist/
npm run preview    # serve the production build
```

The version (from package.json and the git commit) is shown next to the title, printed in the browser console and
in the terminal running `npm run dev`.

## Play

- Found a company: pick an industry, click a tile (or "Show me a good site"), check the site report, press **Found company here**
- Time: Space = next season, Shift+Space = next year; speeds pause / 1× / 2× / 4× / 8× in the top bar (P pauses,
  keys 1–4 pick a speed; at 1× a game takes about two hours). The game ends after Winter 1985
- Top bar: date, the head of the family, cash, last season's profit, valley population, and four meters
  (Opinion, Union, Capital and town Morale; hover for the word)
- **The Struggle** (S): the union at your works (members, militancy, strike fund, demands; a strike's four fronts —
  money, men, force, opinion — and what you can do about each), who holds office at City Hall, Harrisburg and
  Washington, the balance behind them, the next elections (fund either side) and the laws in play (back or block
  them; their dates move with the balance); each rival owner's stance toward your family, what it's preparing and
  how it last answered you; and the family ledger — what the valley remembers, and who did it
- The family: name the founder when you found the company. At the first spring of 1893, 1920 and 1947 the head
  steps down; choose the heir (their traits grew from what the family did) and the family's course: stay in the
  business, buy into a new industry (the new works becomes the company's main works), go into politics (a manager
  runs the works; run for council, mayor, the legislature, governor, Congress), give the works to the men, or sell
  up and invest. Estate tax from 1916, or endow a family foundation
- **Holdings** tab: every works, small businesses to buy (coal mine, coke ovens, ore boats, quarry, sand pit, barge
  line, short-line railroad, trucking, gas, water and electric companies, company stores, machine shop, brickworks:
  income plus cheaper inputs, freight or upkeep), 10% stakes in the rival and supplier works (dividends; at 20% they
  leave you alone; at 50% buy the rest) and shares in Heinz, Westinghouse, Alcoa, PPG, Gulf, U.S. Steel and Mellon
- Right panel tabs: **Overview** (cash, profit, output, market share, price and cost per unit, a Watch list of
  risks, last season's accounts) · **Works** (processes, commissioning, building on the map, projects for the town,
  roads and bridges, supply chain) · **Policy** (standing policies, three actions a season) · **Town** (morale,
  teams, great works to found ahead of history, every landmark standing — click one to go there) · **Rivals**
  (output against yours, suppliers and customers). Historical decisions appear as cards (the owners' choice is marked and taken if
  you skip)
- **Trends** (T): cash, profit, price against cost, capacity and men, market share by rival and the risk list ·
  prices, wages and raw materials · population, morale, the jobless and your workforce's health
- Map: drag / WASD / arrows to pan; scroll, +/- or the on-screen buttons to zoom; click a tile for its card
  (before founding, a click picks a site); the **Map** button holds the layers (land, town, business, best sites)
  and view options (click a layer again, or ✕ on its legend, to go back to the town); the headline strip at the bottom opens the paper, with the ledger (log) beside it; Esc closes
- Sound: starts on your first click or key press; M or the top-bar button mutes (remembered); volumes in ☰
- Saving: Ctrl+S saves; Esc (with nothing open) or ☰ → **Save & exit** saves and goes to the main menu
- Main menu (at start, and ☰ → Save & exit): **Resume last game**, **New game** (blank seed for a fresh town, or a
  seed to replay one) and **Load game**. Games are saved in the browser (IndexedDB): the autosave every new year,
  when you leave the page and when you open the menu; ☰ → **Save game** keeps a named save (the newest 12 are
  kept). A `?seed=` in the address skips the menu and starts that town
- Browser console: `mt` exposes the game (`mt.next(40)`, `mt.center(x, y, 2)`, `mt.select(x, y)`, `mt.overlay("coal")`, `mt.fire("Event Name")`)

## Layout

```
public/maps/mon-valley.*      generated map: 720x720 tiles at 30 m (JSON metadata + gzip'd binary layers)
tools/mapgen/                 Python builder: USGS 10 m DEM + NHD hydrography + transportation -> map
src/core/                     game model (no DOM): map, town growth, industries and technology, business,
                              rivals, freight, environment, events engine (effects.ts) and event data
                              (eventdata/era1-4.ts), landmarks, sports, the season loop (game.ts)
src/render/                   iso projection, procedural pixel-art sprites, chunked renderer, traffic, flows
src/ui/                       panels: overlays, business (policy), works, trends, risks, query, district
src/audio/                    procedural music and ambience
src/main.ts                   app wiring, camera, panels, minimap
docs/EVENTS.csv               the historical timeline the game reads (edit it to change history; see docs/EVENTS.md)
docs/PLAN.md                  design plan and milestones · docs/EVENTS-PLAN.md, MECHANICS.md: design notes
```

## Data

Terrain, rivers, streets and rail come from USGS 3DEP elevation, the National Hydrography Dataset and the National Transportation Dataset (public domain). See `tools/mapgen/README.md`.
