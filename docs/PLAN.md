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
   - Animation: smoke and steam, furnace glow and flame, day/night with lit windows and lamps; strikes, floods, idle
2. Logistics: barges/rail/roads as real transport capacity; input sourcing (ore, coke, sand) from off-map ports
3. Town simulation: housing tiers, services, wages and unrest, company town buildings, land value feedback
4. Tech tree UI and research; era transitions and market prices
5. Rival AI behaviour (bid for land, price wars, buyouts, labor policy)
6. Second industry purchase (Era II) and cross-industry supply (power → mills, steel → shipyards)
7. Historical events (1877 rail strike, 1892 Homestead, 1936 flood, wars, 1950s peak, 1980s collapse) and legacy choices
8. Art pass (smooth slopes, more building sprites, animation), sound, saves, balancing

## Known gaps in the current build
- A screen of new chunks takes ~0.5–1 s to draw after a big jump or a turn (progressive); dirty-chunk tracking would cut that
- Economy numbers are first-pass placeholders
- Rail bridges on diagonal alignments look dashed; paddlewheels and boats don't move yet
- Streets use today's alignments; some modern-only roads appear where towns grow
- Coal seam is a simplified linear model of the Pittsburgh coal
- Modern river pools (post lock-and-dam); 1850 shorelines were a little different
- 1850 populations and landmark coordinates are approximate
