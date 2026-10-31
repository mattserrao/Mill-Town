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

- Drag / WASD / arrows: pan · wheel or +/-: zoom · click: inspect a tile · Space: next season
- Overlays (left panel): elevation, terrain class, coal seam, population, land value, pollution, site scores per industry
- Found a company: pick an industry, click a tile, check the site report, press **Found company here**
- Browser console: `mt` exposes the game for quick iteration (`mt.next(40)`, `mt.center(x, y, 2)`, `mt.select(x, y)`, `mt.overlay("coal")`)

## Layout

```
public/maps/mon-valley.json   generated map (256x256 tiles, 85 m each)
tools/mapgen/                 Python builder: USGS DEM + NHD hydrography -> map JSON
src/core/                     game model (no DOM): map, rng, terrain, town gen, site scoring,
                              industries + tech trees, rivals, eras/seasons, turn loop
src/render/                   iso projection, procedural pixel-art sprites, renderer
src/ui/                       overlays
src/main.ts                   app wiring, camera, panels, minimap
docs/PLAN.md                  design plan and milestones
```

## Data

Terrain and rivers come from USGS 3DEP elevation and the National Hydrography Dataset (public domain). See `tools/mapgen/README.md`.
