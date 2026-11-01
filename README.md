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
- Top bar: date, cash, last season's profit, valley population, and four meters (reputation, labour relations,
  influence, town morale; hover for the word)
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
  and view options; the headline strip at the bottom opens the paper, with the ledger (log) beside it; Esc closes
- Sound: starts on your first click or key press; M or the top-bar button mutes (remembered); volumes in ☰
- Main menu (at start, and ☰ → Main menu): **Resume last game**, **New game** (blank seed for a fresh town, or a
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
