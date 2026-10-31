# Map builder

Builds `public/maps/mon-valley.json` + `mon-valley.bin` from real USGS data.

## Data (public domain, USGS)

```
B=https://prd-tnm.s3.amazonaws.com/StagedProducts
curl -O $B/Elevation/13/TIFF/current/n41w080/USGS_13_n41w080.tif     # 1/3 arc-second (~10 m)
curl -O $B/Elevation/13/TIFF/current/n41w081/USGS_13_n41w081.tif
for h in 0501 0502 0503; do
  curl -o NHD_$h.zip $B/Hydrography/NHD/HU4/Shape/NHD_H_${h}_HU4_Shape.zip
  mkdir -p nhd_$h && unzip -oq NHD_$h.zip -d nhd_$h
done
curl -o TRAN_PA_GDB.zip $B/Tran/GDB/TRAN_Pennsylvania_State_GDB.zip && mkdir -p tran && unzip -oq TRAN_PA_GDB.zip -d tran
```

## Run

```
pip install rasterio pyogrio shapely pyproj scipy numpy pillow
python3 tools/mapgen/build_map.py --data ../geodata --out public/maps/mon-valley --preview preview.png
```

## Format (`milltown-map/2`)

- 720 x 720 tiles, 30 m each, local azimuthal-equidistant projection centred on 40.380 N, 79.955 W
  (the Point to Clairton). `x` = east, `y` = south, tile (0,0) = north-west corner.
- `mon-valley.json` holds metadata, names, rail lines (with opening years), bridges, landmarks and
  the byte offset of each layer in `mon-valley.bin` (gzip'd, little-endian, row-major).

| layer | type | size | meaning |
|---|---|---|---|
| vert | int16 dm | 721 x 721 | terrain height at tile corners (smooth terrain) |
| waterLevel | int16 dm | 720 x 720 | river pool surface nearest each tile |
| terrain | uint8 | | 0 water, 1 floodplain, 2 flat, 3 hillside, 4 steep, 5 upland, 6 bluff |
| slope | uint8 | | degrees |
| water | uint8 | | water body id → `waterNames` |
| creek | uint8 | | creek id → `creekNames` |
| coal | uint8 | | 0 none, 1 seam underground, 2 seam outcrop |
| road | uint8 | | today's street network: 1 local, 2 arterial (where 1850+ streets can appear) |
| bridge | uint8 | | bridge id → `bridges` (historic river crossings, with first-bridge year) |
| rail | uint8 | | rail line id → `railLines` (main lines only, with approximate opening year) |
| special | uint8 | | 1 = wharf |

Approximate / hand-assigned: rail opening years, bridge years, 1850 structures, wharf extents, the coal seam model.
Rivers use today's lock-and-dam pool levels.
