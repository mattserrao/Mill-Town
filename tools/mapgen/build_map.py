#!/usr/bin/env python3
"""
Mill Town map builder (format milltown-map/2).

Real USGS data -> 30 m tile grid of Pittsburgh and the Monongahela Valley:
  - 3DEP 1/3 arc-second DEM (~10 m)        -> vertex heights (smooth terrain), slope, terrain class
  - NHD hydrography                         -> rivers (named), lakes, creeks, water surface level
  - National Transportation Dataset (TNM)   -> today's street network (towns grow along it),
                                              rail lines (opening years), bridges, river crossings
  - Approximate Pittsburgh coal seam model  -> coal outcrop / underground coal
  - Hand-placed historic landmarks          -> blockhouse, courthouse, arsenal, wharves, mill sites

Usage:
  python3 tools/mapgen/build_map.py --data ../geodata --out public/maps/mon-valley --preview preview.png
Writes <out>.json (metadata) and <out>.bin (gzip'd binary layers).
"""
import argparse
import gzip
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
from scipy.ndimage import binary_dilation, distance_transform_edt, median_filter, uniform_filter
from shapely import force_2d, wkb

MAP = {
    "id": "mon-valley",
    "name": "Pittsburgh & the Monongahela Valley",
    "center": (40.380, -79.955),
    "tiles": 720,
    "metersPerTile": 30,
}

T_WATER, T_FLOOD, T_FLAT, T_SLOPE, T_STEEP, T_UPLAND, T_CLIFF = 0, 1, 2, 3, 4, 5, 6
AREA_FTYPES = {460}
WATERBODY_FTYPES = {390, 436}

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
    # 1850 structures (approximate positions)
    ("Fort Pitt Blockhouse", 40.4411, -80.0099, "structure:blockhouse"),
    ("Allegheny County Courthouse", 40.4387, -79.9962, "structure:courthouse"),
    ("Allegheny Arsenal", 40.4658, -79.9617, "structure:arsenal"),
    ("Western Penitentiary", 40.4505, -80.0150, "structure:penitentiary"),
]

# Wharves: river-edge land within these boxes (lat/lon) becomes stone wharf.
WHARVES = [
    ("Monongahela Wharf", (40.4385, -80.0110, 40.4420, -79.9990), "Monongahela River"),
    ("Allegheny Wharf", (40.4430, -80.0090, 40.4475, -79.9950), "Allegheny River"),
]

# Rail: (owner code, subdivision prefix) -> (line name, year opened). Approximate.
RAIL_LINES = [
    (("NS", "FORT WAYNE"), ("Ohio & Pennsylvania RR (Fort Wayne line)", 1851)),
    (("NS", "PITTSBURGH LINE"), ("Pennsylvania Railroad main line", 1852)),
    (("NS", "CONEMAUGH"), ("Western Pennsylvania RR", 1865)),
    (("AVR", "ALLEGHENY"), ("Allegheny Valley RR", 1856)),
    (("AVR", "VALLEY"), ("Allegheny Valley RR", 1856)),
    (("AVR", None), ("Allegheny Valley RR", 1856)),
    (("CSXT", "PITTSBURGH"), ("Pittsburgh & Connellsville RR", 1857)),
    (("CSXT", "KEYSTONE"), ("Pittsburgh & Connellsville RR", 1857)),
    (("NS", "MON LINE"), ("Pittsburgh, Virginia & Charleston RR", 1873)),
    (("CSXT", "MON"), ("Pittsburgh & Lake Erie RR", 1879)),
    (("NS", "PORT PERRY"), ("PRR Port Perry branch", 1880)),
    (("AVR", "W&P"), ("Pittsburgh & Western RR", 1882)),
    (("AVR", "P&W"), ("Pittsburgh & Western RR", 1882)),
    (("CSXT", "P AND W"), ("Pittsburgh & Western RR", 1882)),
    (("CSXT", "P & W"), ("Pittsburgh & Western RR", 1882)),
    (("URR", None), ("Union Railroad", 1896)),
    (("POHC", None), ("Pittsburgh & Ohio Valley RR", 1900)),
    (("NS", "ISLAND"), ("Island connector", 1903)),
    (("WE", None), ("Wabash Pittsburgh Terminal", 1904)),
]

# Road bridges by the street name that crosses the river today: (name, [(year, type), ...]).
# Each stage replaces the previous bridge on the same site. Types: covered, suspension, lenticular,
# truss, arch. Years and types approximate.
BRIDGES = {
    "6th Street Brg": ("Sixth Street Bridge", [(1819, "covered"), (1859, "suspension"), (1892, "truss"), (1928, "suspension")]),
    "9th Street Brg": ("Ninth Street Bridge", [(1840, "covered"), (1890, "truss"), (1928, "suspension")]),
    "16th Street Brg": ("Sixteenth Street Bridge", [(1836, "covered"), (1865, "suspension"), (1923, "arch")]),
    "Smithfield Street Brg": ("Smithfield Street Bridge", [(1846, "suspension"), (1883, "lenticular")]),
    "7th Street Brg": ("Seventh Street Bridge", [(1884, "suspension"), (1928, "suspension")]),
    "Hot Metal St Brg": ("Hot Metal Bridge", [(1887, "truss")]),
    "Mc Keesport Duquesne Brg": ("McKeesport-Duquesne Bridge", [(1891, "truss")]),
    "15th Street Brg": ("Fifteenth Street Bridge (McKeesport)", [(1890, "truss")]),
    "Glenwood Brg": ("Glenwood Bridge", [(1895, "truss")]),
    "5th Ave Brg": ("Fifth Avenue Bridge (McKeesport)", [(1908, "truss")]),
    "40th St": ("Fortieth Street Bridge", [(1924, "arch")]),
    "Glassport Brg": ("Clairton-Glassport Bridge", [(1927, "truss")]),
    "Liberty Brg": ("Liberty Bridge", [(1928, "truss")]),
    "31st Street Brg": ("Thirty-First Street Bridge", [(1928, "arch")]),
    "Mc Kees Rocks Brg": ("McKees Rocks Bridge", [(1931, "arch")]),
    "Boston Brg": ("Boston Bridge", [(1931, "truss")]),
    "W End Brg": ("West End Bridge", [(1932, "arch")]),
    "Westend Brg": ("West End Bridge", [(1932, "arch")]),
    "S 10th St": ("South Tenth Street Bridge", [(1933, "suspension")]),
    "Homestead Brg": ("Homestead High Level Bridge", [(1937, "truss")]),
    "Pgh Homestead Brg": ("Homestead High Level Bridge", [(1937, "truss")]),
    "Mansfield Brg": ("Mansfield Bridge", [(1951, "truss")]),
    "Fort Pitt Brg": ("Fort Pitt Bridge", [(1959, "arch")]),
    "Fort Duquesne Brg": ("Fort Duquesne Bridge", [(1969, "arch")]),
    "Ft Duquesne Brg": ("Fort Duquesne Bridge", [(1969, "arch")]),
    "Birmingham Brg": ("Birmingham Bridge", [(1976, "truss")]),
}

COAL = {"refLat": 40.432, "refLon": -80.008, "refElev": 305.0,
        "dipMetersPerKm": 4.2, "dipBearingDeg": 160.0}


def read_layer(path, layer, bbox, fields):
    meta, _, geoms, f = pyogrio.raw.read(path, layer=layer, bbox=bbox, return_fids=False)
    cols = meta["fields"].tolist()
    return geoms, {k: f[cols.index(k)] for k in fields}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--preview")
    args = ap.parse_args()
    D = lambda *p: os.path.join(args.data, *p)

    n = MAP["tiles"]
    mpt = MAP["metersPerTile"]
    lat0, lon0 = MAP["center"]
    half = n * mpt / 2
    crs = f"+proj=aeqd +lat_0={lat0} +lon_0={lon0} +datum=NAD83 +units=m +no_defs"
    tile_tf = from_origin(-half, half, mpt, mpt)
    SUB = 5
    fine_tf = from_origin(-half, half, mpt / SUB, mpt / SUB)
    bbox = (lon0 - 0.2, lat0 - 0.15, lon0 + 0.2, lat0 + 0.15)
    to_local = lambda geom: transform_geom("EPSG:4269", crs, geom)

    def tile_of(lat, lon):
        p = to_local({"type": "Point", "coordinates": (lon, lat)})["coordinates"]
        return int((p[0] + half) // mpt), int((half - p[1]) // mpt)

    # ---------------------------------------------------------------- elevation (10 m DEM)
    print("elevation...")
    srcs = [rasterio.open(D(f)) for f in ("USGS_13_n41w080.tif", "USGS_13_n41w081.tif")]
    mosaic, mosaic_tf = merge(srcs, bounds=(bbox[0], bbox[1], bbox[2], bbox[3]))
    nodata = srcs[0].nodata
    # vertex grid: (n+1)^2 points at tile corners; average over a 30 m cell around each vertex
    vert = np.full((n + 1, n + 1), np.nan, dtype=np.float32)
    reproject(mosaic[0], vert, src_transform=mosaic_tf, src_crs=srcs[0].crs, src_nodata=nodata,
              dst_transform=from_origin(-half - mpt / 2, half + mpt / 2, mpt, mpt), dst_crs=crs,
              dst_nodata=np.nan, resampling=Resampling.average)
    tile_elev_raw = np.full((n, n), np.nan, dtype=np.float32)
    reproject(mosaic[0], tile_elev_raw, src_transform=mosaic_tf, src_crs=srcs[0].crs, src_nodata=nodata,
              dst_transform=tile_tf, dst_crs=crs, dst_nodata=np.nan, resampling=Resampling.average)

    # ---------------------------------------------------------------- water
    print("water...")
    shapes, named = [], {}
    for huc in ("0501", "0502", "0503"):
        for layer, ftypes in (("NHDArea", AREA_FTYPES), ("NHDWaterbody", WATERBODY_FTYPES)):
            geoms, f = read_layer(D(f"nhd_{huc}", "Shape", layer + ".shp"), None, bbox, ["ftype", "gnis_name"])
            for g, t, nm in zip(geoms, f["ftype"], f["gnis_name"]):
                if g is None or int(t) not in ftypes:
                    continue
                geom = to_local(force_2d(wkb.loads(bytes(g))).__geo_interface__)
                shapes.append((geom, 1))
                if nm:
                    named.setdefault(nm, []).append(geom)
    fine_water = rasterize(shapes, out_shape=(n * SUB, n * SUB), transform=fine_tf, fill=0, dtype="uint8")
    water_frac = fine_water.reshape(n, SUB, n, SUB).mean(axis=(1, 3))
    water = water_frac >= 0.5

    name_ids = {}
    water_name = np.zeros((n, n), np.uint8)
    for nm, geoms in named.items():
        r = rasterize([(g, 1) for g in geoms], out_shape=(n, n), transform=tile_tf, fill=0, dtype="uint8")
        idx = name_ids.setdefault(nm, len(name_ids) + 1)
        water_name[(r > 0) & water & (water_name == 0)] = idx

    creek_shapes, creek_names, river_lines = [], {}, []
    for huc in ("0501", "0502", "0503"):
        geoms, f = read_layer(D(f"nhd_{huc}", "Shape", "NHDFlowline.shp"), None, bbox, ["ftype", "gnis_name"])
        for g, t, nm in zip(geoms, f["ftype"], f["gnis_name"]):
            t = int(t)
            if g is None or not nm or t not in (460, 558):
                continue
            geom = to_local(force_2d(wkb.loads(bytes(g))).__geo_interface__)
            if nm.endswith("River"):
                river_lines.append((geom, name_ids.setdefault(nm, len(name_ids) + 1)))
            elif t == 460:
                creek_shapes.append((geom, creek_names.setdefault(nm, len(creek_names) + 1)))
    if river_lines:
        rl = rasterize(river_lines, out_shape=(n, n), transform=tile_tf, fill=0, dtype="uint8", all_touched=True)
        _, (ry, rx) = distance_transform_edt(rl == 0, return_indices=True)
        fill = water & (water_name == 0)
        water_name[fill] = rl[ry, rx][fill]
    creek = rasterize(creek_shapes, out_shape=(n, n), transform=tile_tf, fill=0, dtype="uint8", all_touched=True)
    creek[water] = 0

    # water surface: hydro-flattened DEM over water, median-smoothed, propagated to land for HAND
    surf = np.where(water, tile_elev_raw, np.nan)
    _, (iy, ix) = distance_transform_edt(~water, return_indices=True)
    surf_full = surf[iy, ix]  # nearest water level everywhere
    surf_full = median_filter(np.nan_to_num(surf_full, nan=np.nanmedian(surf)), size=15)
    water_level = surf_full

    # ---------------------------------------------------------------- vertex heights + shoreline
    vert = np.where(np.isnan(vert), np.nanmedian(vert), vert)
    # vertex touches water if any of its (up to 4) tiles is water
    wpad = np.pad(water, 1)
    vwater = wpad[:-1, :-1] | wpad[1:, :-1] | wpad[:-1, 1:] | wpad[1:, 1:]
    lpad = np.pad(water_level, 1, mode="edge")
    vlevel = (lpad[:-1, :-1] + lpad[1:, :-1] + lpad[:-1, 1:] + lpad[1:, 1:]) / 4
    vland = ~(wpad[:-1, :-1] & wpad[1:, :-1] & wpad[:-1, 1:] & wpad[1:, 1:])
    # pure water vertices sit at surface; shoreline vertices (water + land) at surface + a bank lip
    vert = np.where(vwater & ~vland, vlevel, vert)
    vert = np.where(vwater & vland, vlevel + 0.0, vert)
    vert = np.where(~vwater, np.maximum(vert, vlevel + 0.8), vert)

    # tile metrics from vertices
    c00, c10, c01, c11 = vert[:-1, :-1], vert[:-1, 1:], vert[1:, :-1], vert[1:, 1:]
    elev = (c00 + c10 + c01 + c11) / 4
    gx = ((c10 + c11) - (c00 + c01)) / 2 / mpt
    gy = ((c01 + c11) - (c00 + c10)) / 2 / mpt
    slope_deg = np.degrees(np.arctan(np.hypot(gx, gy)))
    hand = elev - water_level

    terrain = np.full((n, n), T_SLOPE, np.uint8)
    terrain[slope_deg < 5] = T_FLAT
    terrain[(slope_deg >= 5) & (slope_deg < 15)] = T_SLOPE
    terrain[(slope_deg >= 15) & (slope_deg < 30)] = T_STEEP
    terrain[slope_deg >= 30] = T_CLIFF
    terrain[(slope_deg < 5) & (hand < 10)] = T_FLOOD
    terrain[(slope_deg < 7) & (elev > 330)] = T_UPLAND
    terrain[water] = T_WATER

    # ---------------------------------------------------------------- coal seam
    ys, xs = np.mgrid[0:n, 0:n]
    east = -half + (xs + 0.5) * mpt
    north = half - (ys + 0.5) * mpt
    rx_, ry_ = to_local({"type": "Point", "coordinates": (COAL["refLon"], COAL["refLat"])})["coordinates"]
    b = math.radians(COAL["dipBearingDeg"])
    along = ((east - rx_) * math.sin(b) + (north - ry_) * math.cos(b)) / 1000.0
    seam = COAL["refElev"] - COAL["dipMetersPerKm"] * along
    vmin = np.minimum(np.minimum(c00, c10), np.minimum(c01, c11))
    vmax = np.maximum(np.maximum(c00, c10), np.maximum(c01, c11))
    coal = np.zeros((n, n), np.uint8)
    coal[elev > seam + 12] = 1
    coal[(vmin <= seam + 1.5) & (vmax >= seam - 1.5)] = 2
    coal[water] = 0

    # ---------------------------------------------------------------- roads (today's network = where streets can grow)
    print("roads...")
    tran = D("tran", "TRAN_Pennsylvania_State_GDB.gdb")
    geoms, f = read_layer(tran, "Trans_RoadSegment", bbox, ["mtfcc_code", "name"])
    local_s, art_s, bridge_s = [], [], []
    bridge_meta, bridge_ids, bridge_geoms = {}, {}, {}
    for g, code, nm in zip(geoms, f["mtfcc_code"], f["name"]):
        if g is None or code not in ("S1100", "S1200", "S1400"):
            continue
        if code == "S1100" and nm not in BRIDGES:
            continue
        geom = to_local(force_2d(wkb.loads(bytes(g))).__geo_interface__)
        if code != "S1100":
            (art_s if code == "S1200" else local_s).append((geom, 2 if code == "S1200" else 1))
        if nm in BRIDGES:
            bname = BRIDGES[nm][0]
            bid = bridge_ids.setdefault(bname, len(bridge_ids) + 1)
            bridge_s.append((geom, bid))
            bridge_geoms.setdefault(bid, []).append(geom)
            bridge_meta[bid] = {"id": bid, "street": nm, "name": bname, "year": BRIDGES[nm][1][0][0],
                                "stages": [{"year": y, "type": t} for y, t in BRIDGES[nm][1]]}
    road = rasterize(local_s, out_shape=(n, n), transform=tile_tf, fill=0, dtype="uint8")
    art = rasterize(art_s, out_shape=(n, n), transform=tile_tf, fill=0, dtype="uint8")
    road = np.maximum(road, art)
    bridge = rasterize(bridge_s, out_shape=(n, n), transform=tile_tf, fill=0, dtype="uint8", all_touched=True)
    # bridge tiles: only where crossing water (and the approach tile on each bank)
    near_water = binary_dilation(water, iterations=1)
    bridge[~near_water] = 0
    road[water & (bridge == 0)] = 0  # modern bridges come later; only listed crossings kept
    road[(bridge > 0)] = np.maximum(road[(bridge > 0)], 2)

    # ---------------------------------------------------------------- rail
    print("rail...")
    geoms, f = read_layer(tran, "Trans_RailFeature", bbox, ["railusage", "railownercode", "railsubdivision"])
    line_ids, rail_shapes = {}, {}
    for g, usage, owner, sub in zip(geoms, f["railusage"], f["railownercode"], f["railsubdivision"]):
        if g is None or usage != "M":
            continue
        hit = None
        for (o, prefix), line in RAIL_LINES:
            if owner == o and (prefix is None or (sub or "").startswith(prefix)):
                hit = line
                break
        if not hit:
            continue
        lid = line_ids.setdefault(hit, len(line_ids) + 1)
        rail_shapes.setdefault(lid, []).append(to_local(force_2d(wkb.loads(bytes(g))).__geo_interface__))
    rail = np.zeros((n, n), np.uint8)
    # earliest line wins where lines overlap
    for (name, year), lid in sorted(line_ids.items(), key=lambda kv: -kv[0][1]):
        r = rasterize([(g, 1) for g in rail_shapes[lid]], out_shape=(n, n), transform=tile_tf, fill=0,
                      dtype="uint8", all_touched=False)
        rail[r > 0] = lid
    rail_bridge = (rail > 0) & water

    # ---------------------------------------------------------------- bridge spans (smooth, straight)
    from shapely.geometry import shape as _shape, LineString, MultiLineString
    from shapely.ops import unary_union
    water_geom = unary_union([_shape(g) for g, _ in shapes]).buffer(0)
    to_tile = lambda e, nn: ((e + half) / mpt, (half - nn) / mpt)

    def span_from_points(pts):
        best, pair = -1, None
        for i in range(len(pts)):
            for j in range(i + 1, len(pts)):
                d = (pts[i][0] - pts[j][0]) ** 2 + (pts[i][1] - pts[j][1]) ** 2
                if d > best:
                    best, pair = d, (pts[i], pts[j])
        return pair

    spans = []
    near_water = water_geom.buffer(40)
    for bid, geoms in bridge_geoms.items():
        pts = []
        for g in geoms:
            line = _shape(g)
            lines = line.geoms if hasattr(line, "geoms") else [line]
            for ln in lines:
                # clip the line itself to the bank buffer: long straight segments have
                # no vertices mid-river, so vertex sampling cut spans short
                cut = ln.intersection(near_water)
                parts = [cut] if cut.geom_type == "LineString" else list(getattr(cut, "geoms", []))
                for pc in parts:
                    if pc.geom_type == "LineString" and not pc.is_empty:
                        pts.extend((c[0], c[1]) for c in pc.coords)
        if len(pts) < 2:
            continue
        a, b = span_from_points(pts)
        meta = bridge_meta[bid]
        spans.append({"id": bid, "kind": "road", "name": meta["name"], "stages": meta["stages"],
                      "a": to_tile(*a), "b": to_tile(*b)})

    # rail: where each main line crosses a river, extended to the banks
    rid = 1000
    for (lname, lyear), lid in line_ids.items():
        for g in rail_shapes[lid]:
            ln = _shape(g)
            cross = ln.intersection(water_geom)
            pieces = [cross] if cross.geom_type == "LineString" else list(getattr(cross, "geoms", []))
            for pc in pieces:
                if pc.geom_type != "LineString" or pc.length < 160:  # real river crossings, not bank clips
                    continue
                (x0, y0), (x1, y1) = pc.coords[0], pc.coords[-1]
                L = math.hypot(x1 - x0, y1 - y0)
                if L < 60:
                    continue
                ux, uy = (x1 - x0) / L, (y1 - y0) / L
                # a true crossing has river upstream and downstream of its midpoint (perpendicular);
                # a line running along the bank has land on one side
                from shapely.geometry import Point as _P
                mx, my = (x0 + x1) / 2, (y0 + y1) / 2
                if not (water_geom.contains(_P(mx - uy * 120, my + ux * 120)) and water_geom.contains(_P(mx + uy * 120, my - ux * 120))):
                    continue
                a = (x0 - ux * 45, y0 - uy * 45); b = (x1 + ux * 45, y1 + uy * 45)
                mid = ((a[0] + b[0]) / 2, (a[1] + b[1]) / 2)
                if any(sp["kind"] == "rail" and math.hypot(sp["_mid"][0] - mid[0], sp["_mid"][1] - mid[1]) < 60 for sp in spans):
                    continue
                if any(sp["kind"] == "road" and math.hypot((sp["a"][0] + sp["b"][0]) / 2 * mpt - half - mid[0], half - (sp["a"][1] + sp["b"][1]) / 2 * mpt - mid[1]) < 40 for sp in spans):
                    continue
                spans.append({"id": rid, "kind": "rail", "name": f"{lname} bridge", "stages": [{"year": lyear, "type": "truss"}],
                              "a": to_tile(*a), "b": to_tile(*b), "_mid": mid})
                rid += 1
    # ---------------------------------------------------------------- vector lines (drawn smooth by the renderer)
    def tile_lines(geom, tol=0.12):
        g = _shape(geom).simplify(tol * mpt)
        out = []
        for ln in (g.geoms if hasattr(g, "geoms") else [g]):
            if ln.geom_type != "LineString" or ln.length < mpt * 0.5:
                continue
            pts = []
            for e, nn in ln.coords:
                tx, ty = to_tile(e, nn)
                pts += [round(tx, 2), round(ty, 2)]
            out.append(pts)
        return out
    vec_lines = {"creek": [], "rail": []}
    for geom, _ in creek_shapes:
        vec_lines["creek"] += tile_lines(geom)
    for lid, geoms in rail_shapes.items():
        for geom in geoms:
            for pts in tile_lines(geom, 0.08):
                vec_lines["rail"].append({"line": lid, "pts": pts})

    for sp in spans:
        sp.pop("_mid", None)
        sp["a"] = [round(sp["a"][0], 2), round(sp["a"][1], 2)]
        sp["b"] = [round(sp["b"][0], 2), round(sp["b"][1], 2)]

    # ---------------------------------------------------------------- landmarks, wharves
    lms = []
    for nm, la, lo, kind in LANDMARKS:
        tx, ty = tile_of(la, lo)
        if 0 <= tx < n and 0 <= ty < n:
            lms.append({"name": nm, "x": tx, "y": ty, "kind": kind, "lat": la, "lon": lo})
    special = np.zeros((n, n), np.uint8)  # 1 = wharf
    river_id = {v: k for k, v in name_ids.items()}
    for nm, (s, w_, nn, e), river in WHARVES:
        x0, y0 = tile_of(nn, w_)
        x1, y1 = tile_of(s, e)
        rid = name_ids.get(river)
        rv = water_name == rid
        edge = binary_dilation(rv, iterations=2) & ~water
        box = np.zeros_like(edge)
        box[max(0, y0):y1 + 1, max(0, x0):x1 + 1] = True
        special[edge & box] = 1

    # ---------------------------------------------------------------- write
    def corner(e_, n_):
        return transform_geom(crs, "EPSG:4269", {"type": "Point", "coordinates": (e_, n_)})["coordinates"]
    nw, se = corner(-half, half), corner(half, -half)

    layers = [
        ("vert", "int16", "dm", np.round(vert * 10).astype("<i2"), [n + 1, n + 1]),
        ("waterLevel", "int16", "dm", np.round(water_level * 10).astype("<i2"), [n, n]),
        ("terrain", "uint8", None, terrain, [n, n]),
        ("slope", "uint8", "deg", np.clip(slope_deg, 0, 90).astype(np.uint8), [n, n]),
        ("water", "uint8", None, water_name, [n, n]),
        ("creek", "uint8", None, creek, [n, n]),
        ("coal", "uint8", None, coal, [n, n]),
        ("road", "uint8", None, road, [n, n]),
        ("bridge", "uint8", None, bridge, [n, n]),
        ("rail", "uint8", None, rail, [n, n]),
        ("special", "uint8", None, special, [n, n]),
    ]
    blob = bytearray()
    lmeta = {}
    for name, typ, unit, arr, shape in layers:
        raw = np.ascontiguousarray(arr).tobytes()
        lmeta[name] = {"type": typ, "unit": unit, "offset": len(blob), "length": len(raw), "shape": shape}
        blob += raw
        while len(blob) % 4:
            blob += b"\0"
    meta = {
        "format": "milltown-map/2",
        "id": MAP["id"],
        "name": MAP["name"],
        "width": n,
        "height": n,
        "metersPerTile": mpt,
        "projection": crs,
        "orientation": "x=east, y=south, (0,0)=north-west corner; vertices (n+1)^2 at tile corners",
        "bounds": {"north": nw[1], "west": nw[0], "south": se[1], "east": se[0]},
        "binary": os.path.basename(args.out) + ".bin",
        "layers": lmeta,
        "waterNames": {str(v): k for k, v in name_ids.items()},
        "creekNames": {str(v): k for k, v in creek_names.items()},
        "railLines": {str(lid): {"name": nm, "year": yr} for (nm, yr), lid in line_ids.items()},
        "bridges": {str(k): v for k, v in bridge_meta.items()},
        "spans": spans,
        "lines": vec_lines,
        "landmarks": lms,
        "wharves": [w[0] for w in WHARVES],
        "coalModel": COAL,
        "sources": [
            "USGS 3D Elevation Program (3DEP) 1/3 arc-second DEM, tiles n41w080, n41w081",
            "USGS National Hydrography Dataset (NHD) HU4 0501, 0502, 0503",
            "USGS National Transportation Dataset (roads: Census TIGER; rail: FRA), Pennsylvania",
            "Rail opening years, 1850 structures and bridge years: approximate, hand-assigned",
            "Coal seam: simplified linear model of the Pittsburgh coal (approximate)",
        ],
    }
    os.makedirs(os.path.dirname(args.out) or ".", exist_ok=True)
    with open(args.out + ".json", "w") as fh:
        json.dump(meta, fh, indent=1)
    with gzip.open(args.out + ".bin", "wb", compresslevel=9) as fh:
        fh.write(bytes(blob))
    print(f"wrote {args.out}.json/.bin: {n}x{n} @ {mpt} m; water {int(water.sum())}, "
          f"road {int((road > 0).sum())}, rail {int((rail > 0).sum())} ({len(line_ids)} lines), "
          f"bridges {len(bridge_meta)}, spans {len(spans)} ({sum(1 for x in spans if x['kind'] == 'rail')} rail), wharf {int((special == 1).sum())}, rail bridges {int(rail_bridge.sum())}, "
          f"bin {os.path.getsize(args.out + '.bin') / 1e6:.1f} MB")

    if args.preview:
        from PIL import Image
        pal = {T_WATER: (40, 80, 140), T_FLOOD: (120, 150, 80), T_FLAT: (100, 140, 70), T_SLOPE: (90, 115, 60),
               T_STEEP: (110, 95, 60), T_UPLAND: (130, 150, 90), T_CLIFF: (120, 100, 80)}
        img = np.zeros((n, n, 3), np.uint8)
        for k, c in pal.items():
            img[terrain == k] = c
        img = np.clip(img * np.clip(1 + (gx - gy) * 2, 0.6, 1.4)[..., None], 0, 255).astype(np.uint8)
        img[creek > 0] = (70, 120, 190)
        img[road == 1] = (150, 140, 120)
        img[road == 2] = (200, 180, 120)
        img[rail > 0] = (30, 30, 30)
        img[bridge > 0] = (255, 255, 0)
        img[special == 1] = (255, 0, 255)
        for lm in lms:
            img[max(lm["y"] - 2, 0):lm["y"] + 3, max(lm["x"] - 2, 0):lm["x"] + 3] = (230, 30, 30)
        Image.fromarray(img).save(args.preview)


if __name__ == "__main__":
    main()
