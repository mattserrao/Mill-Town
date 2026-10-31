# Map builder

Builds `public/maps/mon-valley.json` from real USGS data.

## Data (public domain, USGS)

Put these in one folder (e.g. `../geodata`):

```
B=https://prd-tnm.s3.amazonaws.com/StagedProducts
curl -O $B/Elevation/1/TIFF/current/n41w080/USGS_1_n41w080.tif
curl -O $B/Elevation/1/TIFF/current/n41w081/USGS_1_n41w081.tif
for h in 0501 0502 0503; do
  curl -o NHD_$h.zip $B/Hydrography/NHD/HU4/Shape/NHD_H_${h}_HU4_Shape.zip
  mkdir -p nhd_$h && unzip -oq NHD_$h.zip -d nhd_$h
done
```

- 3DEP 1 arc-second DEM (~30 m) — elevation
- NHD HU4 0501 (Allegheny), 0502 (Monongahela), 0503 (Upper Ohio) — rivers, lakes, creeks

## Run

```
pip install rasterio pyogrio shapely pyproj scipy numpy pillow
python3 tools/mapgen/build_map.py --data ../geodata --out public/maps/mon-valley.json --preview preview.png
```

## Output format (`milltown-map/1`)

- Grid 256 x 256 tiles, 85 m per tile, local azimuthal-equidistant projection centred on 40.380 N, 79.955 W.
  Covers the Point (downtown Pittsburgh) south-east to Clairton.
- `x` = east, `y` = south, tile (0,0) = north-west corner.
- Layers are base64 little-endian typed arrays, row-major (`index = y * width + x`):

| layer | type | meaning |
|---|---|---|
| elevation | int16 | mean elevation, metres ASL |
| level | uint8 | iso height step (10 m each) above river pool |
| terrain | uint8 | 0 water, 1 floodplain, 2 flat, 3 slope, 4 steep, 5 upland |
| slope | uint8 | degrees |
| water | uint8 | water body id → `waterNames` |
| waterFraction | uint8 | 0–255 share of tile covered by water |
| creek | uint8 | creek id → `creekNames` |
| coal | uint8 | 0 none, 1 seam underground, 2 seam outcrops in this tile |

Coal uses a simplified linear model of the Pittsburgh coal seam (see `COAL` in the script); it is
approximate and meant for gameplay.

Modern hydrography is used for rivers (today's lock-and-dam pool levels).
