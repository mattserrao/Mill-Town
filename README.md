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
- Run the business from the right panel: standing policies, three actions a season, building projects, technology,
  rivals; historical decisions appear as cards (the owners' historical choice is marked and taken if you skip)
- Markets (top bar): prices, wages and your accounts since 1850 · the newspaper and the log sit at the bottom left
- Overlays (left panel): land, town (cities & neighbourhoods, population, ancestry, smoke, health, unrest, traffic…)
  and business (supply chain, freight, competitors, site scores)
- Map: drag / WASD / arrows to pan; scroll, +/- or the on-screen buttons to zoom; click a tile to inspect it;
  ? or Q for the query tool; Esc closes views
- Sound: starts on your first click or key press; M or the top-bar button mutes (remembered); volumes in the left panel
- Game menu (top bar): type a seed and press New town to replay a town, or leave it for a fresh one
- Right panel tabs: Company (tile, site report, company, supply chain) · Business (works, technology, policies,
  actions) · Town (morale, teams, neighbourhood) · Rivals
- Browser console: `mt` exposes the game (`mt.next(40)`, `mt.center(x, y, 2)`, `mt.select(x, y)`, `mt.overlay("coal")`, `mt.fire("Event Name")`)

## Layout

```
public/maps/mon-valley.*      generated map: 720x720 tiles at 30 m (JSON metadata + gzip'd binary layers)
tools/mapgen/                 Python builder: USGS 10 m DEM + NHD hydrography + transportation -> map
src/core/                     game model (no DOM): map, town growth, industries and technology, business,
                              rivals, freight, environment, events engine (effects.ts) and event data
                              (eventdata/era1-4.ts), landmarks, sports, the season loop (game.ts)
src/render/                   iso projection, procedural pixel-art sprites, chunked renderer, traffic, flows
src/ui/                       panels: overlays, business, works, markets, query, district
src/audio/                    procedural music and ambience
src/main.ts                   app wiring, camera, panels, minimap
docs/EVENTS.csv               the historical timeline the game reads (edit it to change history; see docs/EVENTS.md)
docs/PLAN.md                  design plan and milestones · docs/EVENTS-PLAN.md, MECHANICS.md: design notes
```

## Data

Terrain, rivers, streets and rail come from USGS 3DEP elevation, the National Hydrography Dataset and the National Transportation Dataset (public domain). See `tools/mapgen/README.md`.
