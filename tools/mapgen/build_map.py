#!/usr/bin/env python3
"""
Mill Town map builder.

Turns real USGS geodata into the game's tile grid:
  - 3DEP 1 arc-second DEM (elevation)          -> per-tile mean elevation, height levels, slope
  - NHD hydrography (river/lake polygons, lines) -> water tiles, named creeks
  - Approximate Pittsburgh coal seam model      -> coal outcrop / underground coal

Usage:
  python3 tools/mapgen/build_map.py --data /path/to/geodata --out public/maps/mon-valley.json

The data dir must contain:
  USGS_1_n41w080.tif, USGS_1_n41w081.tif
  nhd_0501/Shape/*.shp, nhd_0502/Shape/*.shp, nhd_0503/Shape/*.shp
(see tools/mapgen/README.md for download URLs)
"""
import argparse
import base64
import json
import math
import os

import numpy as np
import pyogrio
import rasterio
from rasterio.features import rasterize
from rasterio.merge import merge
from rasterio.transform import from_origin
from rasterio.warp import Resampling, reproject, transform_geom

# ---------------------------------------------------------------- map config
MAP = {
    "id": "mon-valley",
    "name": "Pittsburgh & the Monongahela Valley",
    "center": (40.380, -79.955),  # lat, lon
    "tiles": 256,                 # grid is tiles x tiles
    "metersPerTile": 85,
    "levelMeters": 10,            # meters per iso height step
}

# Terrain codes (must match src/core/terrain.ts)
T_WATER, T_FLOOD, T_FLAT, T_SLOPE, T_STEEP, T_UPLAND = 0, 1, 2, 3, 4, 5

# NHD feature types we treat as open water
AREA_FTYPES = {460}            # StreamRiver
WATERBODY_FTYPES = {390, 436}  # LakePond, Reservoir

# Real places, for orientation and later game hooks. Coordinates approximate (+/- ~100 m).
LANDMARKS = [
    # name, lat, lon, kind
    ("The Point (Pittsburgh)", 40.4417, -80.0128, "town"),
    ("Allegheny City", 40.4530, -80.0100, "town"),
    ("Lawrenceville", 40.4670, -79.9600, "town"),
    ("East Liberty", 40.4610, -79.9250, "town"),
    ("Birmingham (South Side)", 40.4280, -79.9800, "town"),
    ("Coal Hill (Mt. Washington)", 40.4320, -80.0080, "hill"),
    ("Hazelwood", 40.4060, -79.9400, "town"),
    ("Homestead", 40.4060, -79.9120, "town"),
    ("Munhall", 40.3920, -79.9000, "town"),
    ("Rankin", 40.4120, -79.8790, "town"),
    ("Braddock", 40.4030, -79.8680, "town"),
    ("Duquesne", 40.3820, -79.8580, "town"),
    ("McKeesport", 40.3480, -79.8640, "town"),
    ("Clairton", 40.2920, -79.8820, "town"),
    ("Homestead Works site", 40.4110, -79.9150, "historic_site"),
    ("Edgar Thomson Works site", 40.3930, -79.8580, "historic_site"),
    ("Eliza Furnaces site (J&L)", 40.4250, -79.9600, "historic_site"),
    ("Duquesne Works site", 40.3760, -79.8480, "historic_site"),
]

# Approximate Pittsburgh coal seam: ~305 m ASL under Coal Hill, dipping toward the
# south-southeast (near river level by Elizabeth). Linear model, good enough for gameplay.
COAL = {"refLat": 40.432, "refLon": -80.008, "refElev": 305.0,
        "dipMetersPerKm": 4.2, "dipBearingDeg": 160.0, "seamThickness": 2.0}


def b64(arr):
    return base64.b64encode(np.ascontiguousarray(arr).tobytes()).decode("ascii")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--preview", help="optional PNG overview path")
    args = ap.parse_args()

    n = MAP["tiles"]
    mpt = MAP["metersPerTile"]
    lat0, lon0 = MAP["center"]
    half = n * mpt / 2
    crs = f"+proj=aeqd +lat_0={lat0} +lon_0={lon0} +datum=NAD83 +units=m +no_defs"
    # Grid: x -> east, y -> south. Tile (0,0) is the north-west corner.
    tile_tf = from_origin(-half, half, mpt, mpt)
    SUB = 5  # sub-samples per tile edge for coverage fractions
    fine_tf = from_origin(-half, half, mpt / SUB, mpt / SUB)

    # ---------------------------------------------------------- elevation
    srcs = [rasterio.open(os.path.join(args.data, f)) for f in
            ("USGS_1_n41w080.tif", "USGS_1_n41w081.tif")]
    mosaic, mosaic_tf = merge(srcs)
    src_crs = srcs[0].crs
    nodata = srcs[0].nodata
    fine_elev = np.full((n * SUB, n * SUB), np.nan, dtype=np.float32)
    reproject(mosaic[0], fine_elev, src_transform=mosaic_tf, src_crs=src_crs,
              src_nodata=nodata, dst_transform=fine_tf, dst_crs=crs, dst_nodata=np.nan,
              resampling=Resampling.bilinear)
    blocks = fine_elev.reshape(n, SUB, n, SUB)
    elev = np.nanmean(blocks, axis=(1, 3))
    elev_min = np.nanmin(blocks, axis=(1, 3))
    elev_max = np.nanmax(blocks, axis=(1, 3))

    # ---------------------------------------------------------- water
    shapes = []
    river_names = {}
    for huc in ("0501", "0502", "0503"):
        base = os.path.join(args.data, f"nhd_{huc}", "Shape")
        bbox = (lon0 - 0.2, lat0 - 0.15, lon0 + 0.2, lat0 + 0.15)
        for layer, ftypes in (("NHDArea", AREA_FTYPES), ("NHDWaterbody", WATERBODY_FTYPES)):
            meta, _, geoms, fields = pyogrio.raw.read(os.path.join(base, layer + ".shp"),
                                                      bbox=bbox, return_fids=False)
            cols = meta["fields"].tolist()
            ft = fields[cols.index("ftype")]
            nm = fields[cols.index("gnis_name")]
            from shapely import wkb
            for g, t, name in zip(geoms, ft, nm):
                if int(t) not in ftypes or g is None:
                    continue
                geom = transform_geom("EPSG:4269", crs, wkb.loads(bytes(g)).__geo_interface__)
                shapes.append((geom, 1))
                if name:
                    river_names.setdefault(name, []).append(geom)

    fine_water = rasterize(shapes, out_shape=(n * SUB, n * SUB), transform=fine_tf,
                           fill=0, dtype="uint8")
    water_frac = fine_water.reshape(n, SUB, n, SUB).mean(axis=(1, 3))
    water = water_frac >= 0.5

    # name each water tile by the river polygon covering it
    name_ids = {}
    water_name = np.zeros((n, n), dtype=np.uint8)
    for name, geoms in river_names.items():
        r = rasterize([(g, 1) for g in geoms], out_shape=(n, n), transform=tile_tf,
                      fill=0, dtype="uint8")
        idx = name_ids.setdefault(name, len(name_ids) + 1)
        water_name[(r > 0) & water & (water_name == 0)] = idx

    # ---------------------------------------------------------- creeks (named flowlines)
    creek_shapes = []
    creek_names = {}
    river_lines = []
    for huc in ("0501", "0502", "0503"):
        base = os.path.join(args.data, f"nhd_{huc}", "Shape")
        bbox = (lon0 - 0.2, lat0 - 0.15, lon0 + 0.2, lat0 + 0.15)
        meta, _, geoms, fields = pyogrio.raw.read(os.path.join(base, "NHDFlowline.shp"),
                                                  bbox=bbox, return_fids=False)
        cols = meta["fields"].tolist()
        nm = fields[cols.index("gnis_name")]
        ft = fields[cols.index("ftype")]
        from shapely import wkb, force_2d
        for g, name, t in zip(geoms, nm, ft):
            if g is None or not name or int(t) not in (460, 558):
                continue
            if int(t) == 558 and not name.endswith("River"):
                continue
            geom = transform_geom("EPSG:4269", crs, force_2d(wkb.loads(bytes(g))).__geo_interface__)
            if name.endswith("River"):
                ridx = name_ids.setdefault(name, len(name_ids) + 1)
                river_lines.append((geom, ridx))
                continue
            idx = creek_names.setdefault(name, len(creek_names) + 1)
            creek_shapes.append((geom, idx))
    creek = rasterize(creek_shapes, out_shape=(n, n), transform=tile_tf, fill=0,
                      dtype="uint8", all_touched=True) if creek_shapes else np.zeros((n, n), np.uint8)
    creek[water] = 0

    # unnamed river polygons take the name of the nearest named river centerline
    if river_lines:
        from scipy.ndimage import distance_transform_edt as _edt
        rl = rasterize(river_lines, out_shape=(n, n), transform=tile_tf, fill=0,
                       dtype="uint8", all_touched=True)
        _, (ry_, rx_) = _edt(rl == 0, return_indices=True)
        fill = water & (water_name == 0)
        water_name[fill] = rl[ry_, rx_][fill]

    # ---------------------------------------------------------- fill DEM over water
    river_level = np.nanpercentile(elev[water], 20) if water.any() else np.nanmin(elev)
    elev = np.where(np.isnan(elev), river_level, elev)
    # river surface: flatten water tiles to local pool level (min of tile)
    elev[water] = np.where(np.isnan(elev_min[water]), river_level, elev_min[water])

    # ---------------------------------------------------------- slope + terrain class
    gy, gx = np.gradient(elev, mpt)
    slope_deg = np.degrees(np.arctan(np.hypot(gx, gy)))
    local_relief = np.nan_to_num(elev_max - elev_min)

    # height above nearest water (cheap: distance-weighted via iterative dilation)
    from scipy.ndimage import distance_transform_edt
    dist, (iy, ix) = distance_transform_edt(~water, return_indices=True)
    hand = elev - elev[iy, ix]  # height above nearest drainage (rivers only)
    dist_m = dist * mpt

    terrain = np.full((n, n), T_SLOPE, dtype=np.uint8)
    terrain[slope_deg < 6] = T_FLAT
    terrain[(slope_deg >= 6) & (slope_deg < 16)] = T_SLOPE
    terrain[slope_deg >= 16] = T_STEEP
    terrain[(slope_deg < 6) & (hand < 12) & (dist_m < 1500)] = T_FLOOD
    terrain[(slope_deg < 8) & (elev > 330)] = T_UPLAND
    terrain[water] = T_WATER

    base_level = math.floor(river_level / MAP["levelMeters"])
    level = np.clip(np.floor(elev / MAP["levelMeters"]) - base_level, 0, 63).astype(np.uint8)
    level[water] = 0

    # ---------------------------------------------------------- coal seam
    ys, xs = np.mgrid[0:n, 0:n]
    east = -half + (xs + 0.5) * mpt
    north = half - (ys + 0.5) * mpt
    # reference point in local coords
    ref = transform_geom("EPSG:4269", crs, {"type": "Point",
                                             "coordinates": (COAL["refLon"], COAL["refLat"])})
    rx, ry = ref["coordinates"]
    b = math.radians(COAL["dipBearingDeg"])
    along = ((east - rx) * math.sin(b) + (north - ry) * math.cos(b)) / 1000.0
    seam = COAL["refElev"] - COAL["dipMetersPerKm"] * along
    emin = np.nan_to_num(elev_min, nan=river_level)
    emax = np.nan_to_num(elev_max, nan=river_level)
    coal = np.zeros((n, n), dtype=np.uint8)  # 0 none, 1 underground (minable by shaft), 2 outcrop (drift mine)
    coal[elev > seam + 15] = 1
    coal[(emin <= seam + 2) & (emax >= seam - 2)] = 2
    coal[water] = 0

    # ---------------------------------------------------------- landmarks
    lms = []
    for name, la, lo, kind in LANDMARKS:
        p = transform_geom("EPSG:4269", crs, {"type": "Point", "coordinates": (lo, la)})
        px, py = p["coordinates"]
        tx, ty = int((px + half) // mpt), int((half - py) // mpt)
        if 0 <= tx < n and 0 <= ty < n:
            lms.append({"name": name, "x": tx, "y": ty, "kind": kind, "lat": la, "lon": lo})

    # ---------------------------------------------------------- bounds (lat/lon of corners)
    def corner(e, nn):
        return transform_geom(crs, "EPSG:4269", {"type": "Point", "coordinates": (e, nn)})["coordinates"]
    nw, se = corner(-half, half), corner(half, -half)

    out = {
        "format": "milltown-map/1",
        "id": MAP["id"],
        "name": MAP["name"],
        "width": n,
        "height": n,
        "metersPerTile": mpt,
        "levelMeters": MAP["levelMeters"],
        "baseElevation": base_level * MAP["levelMeters"],
        "projection": crs,
        "orientation": "x=east, y=south, (0,0)=north-west corner",
        "bounds": {"north": nw[1], "west": nw[0], "south": se[1], "east": se[0]},
        "layers": {
            "elevation": {"type": "int16", "unit": "m", "data": b64(np.round(elev).astype("<i2"))},
            "level": {"type": "uint8", "data": b64(level)},
            "terrain": {"type": "uint8", "data": b64(terrain)},
            "slope": {"type": "uint8", "unit": "deg", "data": b64(np.clip(slope_deg, 0, 90).astype(np.uint8))},
            "water": {"type": "uint8", "data": b64(water_name)},
            "waterFraction": {"type": "uint8", "unit": "1/255", "data": b64((water_frac * 255).astype(np.uint8))},
            "creek": {"type": "uint8", "data": b64(creek)},
            "coal": {"type": "uint8", "data": b64(coal)},
        },
        "waterNames": {str(v): k for k, v in name_ids.items()},
        "creekNames": {str(v): k for k, v in creek_names.items()},
        "landmarks": lms,
        "coalModel": COAL,
        "sources": [
            "USGS 3D Elevation Program (3DEP) 1 arc-second DEM, tiles n41w080, n41w081",
            "USGS National Hydrography Dataset (NHD) HU4 0501, 0502, 0503",
            "Coal seam: simplified linear model of the Pittsburgh coal (approximate)",
        ],
    }
    os.makedirs(os.path.dirname(args.out), exist_ok=True)
    with open(args.out, "w") as f:
        json.dump(out, f, separators=(",", ":"))
    print(f"wrote {args.out}: {n}x{n} tiles @ {mpt} m, river level ~{river_level:.0f} m, "
          f"water tiles {int(water.sum())}, levels 0..{int(level.max())}, "
          f"rivers {list(name_ids)}, creeks {len(creek_names)}")

    if args.preview:
        from PIL import Image
        pal = {T_WATER: (40, 80, 140), T_FLOOD: (120, 150, 80), T_FLAT: (100, 140, 70),
               T_SLOPE: (90, 115, 60), T_STEEP: (110, 90, 60), T_UPLAND: (130, 150, 90)}
        img = np.zeros((n, n, 3), np.uint8)
        for k, c in pal.items():
            img[terrain == k] = c
        shade = np.clip(1 + (gx - gy) * 1.5, 0.6, 1.3)[..., None]
        img = np.clip(img * shade, 0, 255).astype(np.uint8)
        img[creek > 0] = (70, 120, 190)
        for lm in lms:
            img[max(lm["y"] - 1, 0):lm["y"] + 2, max(lm["x"] - 1, 0):lm["x"] + 2] = (220, 40, 40)
        Image.fromarray(img).resize((n * 3, n * 3), Image.NEAREST).save(args.preview)


if __name__ == "__main__":
    main()
