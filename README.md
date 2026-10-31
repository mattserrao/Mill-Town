# Mill-Town
Choose an Industrial Revolution industry. Grow your company and the town alongside it. Make choices that reverberate across generations.

Turn-based (one turn = one season), 1850–1985, on a real-geography map of Pittsburgh and the Monongahela Valley in 2:1 isometric pixel art. Desktop browsers only.

## Run

```
npm install
npm run dev        # http://localhost:5173  (add ?seed=1234 for a specific town)
npm test           # core model tests
```

## Controls
- Time: Space = next season, Shift+Space = next year, P = play/pause; the game ends after Winter 1985

- Drag / WASD / arrows: pan · scroll, +/- keys or the on-screen ± buttons: zoom (trackpad-friendly) · click: inspect a tile · Space: next season
- Overlays (left panel): elevation, terrain class, coal seam, rail & roads by year, population, land value, pollution, site scores per industry, ancestry
- Sound: on by default — browsers start audio on your first click or key press; 🔊 button in the top bar or M to mute (remembered); music and ambience volumes in the left panel
- Found a company: pick an industry, click a tile, check the site report, press **Found company here**
- Browser console: `mt` exposes the game for quick iteration (`mt.next(40)`, `mt.center(x, y, 2)`, `mt.select(x, y)`, `mt.overlay("coal")`)

## Layout

```
public/maps/mon-valley.*      generated map: 720x720 tiles at 30 m (JSON metadata + gzip'd binary layers)
tools/mapgen/                 Python builder: USGS 10 m DEM + NHD hydrography + transportation -> map
src/core/                     game model (no DOM): map, rng, terrain, town gen, site scoring,
                              industries + tech trees, rivals, eras/seasons, turn loop
src/render/                   iso projection, procedural pixel-art sprites, chunked software rasterizer
src/ui/                       overlays
src/main.ts                   app wiring, camera, panels, minimap
docs/PLAN.md                  design plan and milestones
```

## Data

Terrain, rivers, streets and rail come from USGS 3DEP elevation, the National Hydrography Dataset and the National Transportation Dataset (public domain). See `tools/mapgen/README.md`.
