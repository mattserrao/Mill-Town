# v0.32 — Seasons off, smooth hill ways

Branch: `test/hill-ways`. Comparison PNGs (v0.31 left, v0.32 right): `docs/v032/`.

## Seasons vaulted
- The autumn and winter map looks are off by default. They're kept behind ☰ menu → **Seasons** (remembered), or `?seasons=1` in the address.
- House chimney smoke in autumn and winter stays on; it's a live layer, not a map recolour.

## Roads and city steps drawn across tiles (`render/roads.ts`)
- The street tiles are traced into polylines between junctions and dead ends, using orthogonal links plus diagonals only where no orthogonal step exists, like the old masks.
- Each polyline is smoothed with three rounds of Chaikin corner cutting, its ends pinned to the junction centres:
  - a tile staircase becomes a straight diagonal
  - a switchback becomes a rounded hairpin
  - straight runs and junctions don't move
- The ground shader draws streets (roadway, kerb, sidewalk, paving, ruts) and city steps (treads, landings, rails) from these lines. Where a smoothed road cuts a corner, its roadway carries onto the neighbouring tile. Alleys and bridges keep their old drawing.
- Street traffic snaps onto the drawn line and heads along it, so wagons and people follow the curves instead of the tile centres.
- The index is cached and rebuilt only when the street layer changes.

## Inclines (`drawInclines`)
- One smooth profile per incline instead of a step per tile:
  - the ground under the line is sampled bilinearly and eased over about 1.5 tiles
  - the deck is that or the straight station-to-station grade, whichever is higher (trestles over a dip, never buried)
  - it's eased again and made to climb monotonically
- The cleared right-of-way on the ground is a straight strip from foot to head, instead of a tile-mask zig-zag.

## Verification
- Typecheck and build clean; 164 tests pass. No sim or save change.
