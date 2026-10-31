# Mill Town — Plan

## Decisions
| Topic | Decision |
|---|---|
| Platform | Browser game (TypeScript + Vite + Canvas 2D), desktop only |
| View | 2:1 isometric pixel art, SimCity 2000 style |
| Map | Highly accurate: USGS elevation + hydrography → 256×256 tiles at 85 m (the Point to Clairton) |
| Art | Generated in code (procedural pixel sprites) |
| Turns | Turn-based, 1 turn = 1 season |
| Eras | Three: I Iron, Coal & Steam (1850–89) · II The Age of Steel (1890–1944) · III Peak & Collapse (1945–85) |
| End | Collapse is the final test |
| Industries | Steel, Power, Glass, Metalworking/Shipbuilding. Start with one; buy into others from Era II |
| Generations | A span of eras (no dynasty) |
| Rivals | AI rivals, real figures (Carnegie, Frick, Jones & Laughlin, Westinghouse, PPG, Mellon, Dravo) |
| Town | Grows on its own in response to the mill; the player doesn't zone |
| History | Real figures and events |

## Core loop
Pick a site → found the works → each season: hire from the local labor pool, buy inputs, ship by river, sell output →
profits fund tech (money + time + milestones) → the works pollutes and draws migrants → the town spreads toward the jobs →
rivals enter at historical dates → eras shift markets → Era III collapse.

## Milestones
1. **Map + core model + inspector** ← *current build*
   - Real terrain/rivers/creeks/coal seam pipeline
   - Seeded 1850 town (settlements, farms, woods, roads)
   - Iso renderer, overlays, tile inspector, site scoring, minimap
   - Minimal season loop: found company, production, wages, pollution, migration, rival entry
2. Logistics: barges/rail/roads as real transport capacity; input sourcing (ore, coke, sand) from off-map ports
3. Town simulation: housing tiers, services, wages and unrest, company town buildings, land value feedback
4. Tech tree UI and research; era transitions and market prices
5. Rival AI behaviour (bid for land, price wars, buyouts, labor policy)
6. Second industry purchase (Era II) and cross-industry supply (power → mills, steel → shipyards)
7. Historical events (1877 rail strike, 1892 Homestead, 1936 flood, wars, 1950s peak, 1980s collapse) and legacy choices
8. Art pass (smooth slopes, more building sprites, animation), sound, saves, balancing

## Known gaps in the current build
- Terrain renders as 10 m terraces; smooth SimCity-style slope tiles come in the art pass
- Zoom 0.5× redraws every tile (sluggish panning); needs chunk caching
- Economy numbers are first-pass placeholders
- Coal seam is a simplified linear model of the Pittsburgh coal
- Modern river pools (post lock-and-dam); 1850 shorelines were a little different
- 1850 populations and landmark coordinates are approximate
