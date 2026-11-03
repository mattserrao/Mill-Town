# v0.30 — Hills, bridges and tunnels (plan + test-branch results)

Branch: `test/hills-bridges-shoreline`. Relief, shorelines, bridge paint and tunnel portals (scenery) are built; the rest of the infrastructure work is a plan.

## Built on the branch

### 1. Hill relief (exaggerated heights)
- `render/iso.ts`: `ZPX` (screen px per metre) is now `ZPX_BASE × RELIEF`, a live binding. Default **2.5×** (decided); options 1×, 1.5×, 2×, 2.5×, 3×.
- ☰ menu → **Hill relief** (remembered); `?relief=3` in the address overrides. Changing it keeps the tile at screen centre where it was.
- Terrain shading uses the drawn slopes (eased by √relief) so hillsides read as hillsides, not just taller.
- Everything that projects heights (houses' cut-and-fill terraces, bridges, traffic, smoke, picking) already went through `ZPX`, so it follows automatically. Chunks are keyed by relief so a change re-rasterizes.
- Gameplay untouched: heights in metres, slope classes and costs are unchanged.

### 2. Smooth shorelines (a line across many tiles)
- `core/shore.ts`: the river raster is blurred (σ ≈ 1.15 tiles) into a wetness field, then **pinned at every tile centre** (water centres stay wet, land stays dry) so the sim and the drawing never disagree about a tile. The shoreline is the field's 0.5 contour, interpolated Catmull-Rom so there are no kinks at tile seams.
- The renderer draws natural banks along that curve per pixel: water tiles can show a strip of mud/sand bank, open-ground land tiles (woods, fields, empty, rock, parks) can give a corner to the river. Water on a bank tile is lit like the river (no dark wedges). Trees on the water side are dropped.
- Wharves, quays, streets, rail, owned and built tiles keep their straight stone edges (which is what real quays look like).
- `shoreLines()` traces the same contour into polylines: the longest river line crosses 400+ tiles. That's the "pre-drawn line" — it can later be replaced by baked NHD/OSM shoreline vectors in `map.lines` (format already holds creek and rail vectors) without touching the renderer.
- `?shore=0` shows the old tile-edge banks for comparison. Tests: `tests/shore.test.ts`.

## Plan — Pittsburgh's bridges and tunnels

The map already has 23 road and 9 rail bridges with rebuild stages (Smithfield 1846/1883, Sixth/Seventh/Ninth 1928, Liberty 1928, West End 1932, Fort Pitt 1959, Fort Duquesne 1969…). What's missing is the look of the modern ones and the tunnels.

### A. Bridge paint by date, not by build year
Today any bridge built ≥1955 is drawn gold. Replace with a paint history per span (`stages[].paint`):
- Pre-1975: grey/black iron; the Sisters in their 1928 scheme (green deck girders, silver superstructure).
- **Aztec Gold from 1975** on the Sisters, and on the West End, Fort Pitt and Fort Duquesne bridges as they're repainted 1978–81. Tenth Street gold too.
- Era IV hook: a "Paint the bridges gold" event (city adopts black and gold) — cheap civic-pride morale bump, fits the final era's last good years before the collapse.

### B. Bridge silhouettes worth recognizing
- **Three Sisters**: self-anchored suspension (cables tied into the deck ends, no anchorages ashore), identical trio in a row — the most iconic shape, needs its own `type: "selfanchored"`.
- **Fort Pitt Bridge**: double-deck tied arch that lands straight into the tunnel portal.
- **West End / Fort Duquesne**: tied through-arches; **Smithfield**: lenticular trusses (exists); **Hot Metal**: truss with the ladle track.
- Night lights on the Sisters and Fort Pitt (deck lamps; later eras).

### C. Tunnels through Mount Washington (west/south side of the Point)
New map entity `tunnels: { id, name, kind: road|rail|trolley, a, b, year, closed? }` with two portals and a buried route:

| Tunnel | Opened | Notes |
|---|---|---|
| Wabash Tunnel | 1903 (rail) | Gould's Wabash line into the Wabash Terminal; freight ends 1946; car lane only in 2004 (after the game) |
| Mount Washington Transit (trolley) Tunnel | 1904 | South Hills streetcars |
| Liberty Tunnels ("Liberty Tubes") | 1924 | twin road bores, paired with the Liberty Bridge (1928) |
| Fort Pitt Tunnel | 1960 | last link of the Parkway West, a year after the Fort Pitt Bridge; city "bursts into view" at the north portal |

- **Drawing**: stone/concrete portal sprites set into the hillside at each end (the Fort Pitt portal with its staggered upper/lower decks); the bore isn't drawn. Traffic enters a portal and re-emerges at the other after a delay. Ventilation building on the hilltop for the Liberty Tubes.
- **Simulation**: a tunnel is a road link with travel cost ≈ its length on the flat. Opening one lets the town's growth reach the South Hills (Dormont, Mt. Lebanon, Beechview seeds become active from 1924), shortens commutes and freight to the west, and drops land value pressure on the slopes. Tunnel openings become headlines (Liberty Tubes 1924; Fort Pitt 1960 already in era-4 events).
- **Player**: in later eras the company or the county can fund a tunnel (big cost, like the existing bridges/roads projects); a funded tunnel opens early and earns opinion.

### D. Modernizing the hillsides
- Inclines already exist as a player build; add the real Duquesne (1877) and Monongahela (1870) inclines as fixed landmarks on Mt Washington's face — they read much better with 2–3× relief.
- Grandview Avenue overlooks and the hilltop billboard as a late-era landmark.

### Order of work
1. Paint history + Aztec Gold (small, data + renderer colours).
2. Self-anchored Sisters and tied-arch silhouettes.
3. Tunnel data (coordinates from the four portals), portal sprites, traffic through.
4. Tunnel sim effects + growth seeds + headlines; player-funded tunnels.
5. Bake real shoreline vectors into the map if the derived ones fall short anywhere.

### Decisions (Nov 2026)
- Default relief 2.5×.
- Aztec Gold repaint is automatic: Sisters and South Tenth Street 1975, West End 1978, Fort Pitt 1979, Fort Duquesne 1981 (dates within the documented 1978–81 repaint are approximate). Built: `bridgePaint()` in the renderer; before then the Sisters are silver over green girders, the eyebar chains carry the paint.
- Tunnels are scenery first. Built (reworked): `core/tunnels.ts` holds the four tunnels (Wabash 1903, boarded up after 1946 with its track lifted; trolley tunnel 1904; Liberty Tunnels 1924; Fort Pitt Tunnel 1960). Each portal is seated by the terrain: the city portal slides along the bore to the foot of the steepest rise, the far portal is found where the bore comes out in the next valley, and each faces downhill, squared to the grid.
  - Portals facing the camera are pixel-art sprites (`render/portals.ts`): a cutting with its floor level with the ground at the open end, wing walls stepping down the slope, and a headwall in stone, brick or concrete with voussoirs and keystone (or a flat frame and name band for the 1960 concrete), dark bores with lining, lamps along the crown, road or track running in. They are drawn over the terrain like the bridges, since a one-tile cutting would otherwise be buried by the hill beside it.
  - Portals facing away (the city side of Mount Washington looks north, away from the camera) are hidden by their own hill, as they would be: the road or track runs up the cutting to a stone coping and disappears.
  - The cutting's road or track is painted on the next few tiles, and trees are cleared from the slope round each portal. No traffic, growth or commute effects yet.
