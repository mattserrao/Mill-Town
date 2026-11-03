#!/usr/bin/env python3
"""Renders PNGs of the resampled hex map (needs the dump from tests/hexdump.test.ts):
   HEXDUMP=1 npx vitest run tests/hexdump.test.ts && python3 tools/hexmap_preview.py OUT_DIR"""
import json, math, sys, os
import numpy as np
from PIL import Image, ImageDraw, ImageFont

out = sys.argv[1] if len(sys.argv) > 1 else "/tmp"
os.makedirs(out, exist_ok=True)
J = json.load(open("/tmp/hexmap.json"))
W, H = J["width"], J["height"]
raw = np.fromfile("/tmp/hexmap.bin", dtype=np.uint8)
L = {name: raw[k * W * H:(k + 1) * W * H].reshape(H, W) for k, name in enumerate(J["layers"])}
CWp, RHp = 42.0, 28 * math.sqrt(3) / 2   # screen px per column / row at zoom 1
S = 28.0
try:
    F = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", 14)
    FB = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 16)
    FT = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 26)
except Exception:
    F = FB = FT = ImageFont.load_default()

TERR = {0: (51, 102, 142), 1: (150, 190, 110), 2: (118, 160, 76), 3: (150, 148, 84), 4: (104, 96, 68), 5: (134, 170, 90), 6: (140, 112, 84)}

def cell_color(y, x):
    t = int(L["terrain"][y, x]); c = np.array(TERR.get(t, (60, 60, 60)), float)
    if t != 0:
        k = 0.72 + 0.5 * L["height"][y, x] / 255.0
        c = c * k
    if L["creek"][y, x] and t != 0: c = np.array((70, 130, 175), float)
    if L["road"][y, x] and t != 0: c = c * 0.55 + np.array((190, 180, 160)) * 0.45
    if L["rail"][y, x]: c = np.array((50, 44, 40), float)
    if L["special"][y, x]: c = np.array((200, 140, 60), float)
    if L["bridge"][y, x]: c = np.array((200, 60, 50), float)
    return tuple(int(max(0, min(255, v))) for v in c)

def center(x, y):
    return x * CWp, (y + x / 2.0) * RHp

def hexpoly(cx, cy, k):
    pts = []
    for a in range(6):
        ang = math.radians(60 * a)
        pts.append((cx + k * S * math.cos(ang), cy + k * S * math.sin(ang) * (math.sqrt(3) / 2 * 1.0) / (math.sqrt(3) / 2) * 0.5 * 1.0))
    return pts

def hexpoly_scaled(cx, cy, sx, sy):
    # flat-top, screen squash 0.5 applied to the ground y: radius S wide, S*sqrt3/2*... tall
    pts = []
    for a in range(6):
        ang = math.radians(60 * a)
        pts.append((cx + S * math.cos(ang) * sx, cy + S * math.sin(ang) * 0.5 * sy))
    return pts

# ---------------------------------------------------------------- 1. overview
valid = L["valid"].astype(bool)
ys, xs = np.nonzero(valid)
sc = 0.085
px = (xs * CWp * sc); py = ((ys + xs / 2.0) * RHp * sc)
minx, miny = px.min() - 30, py.min() - 70
Wimg, Himg = int(px.max() - minx + 30), int(py.max() - miny + 60)
img = Image.new("RGB", (Wimg, Himg), (27, 29, 34))
d = ImageDraw.Draw(img)
cols = np.zeros((len(xs), 3), np.uint8)
for k in range(len(xs)):
    cols[k] = cell_color(ys[k], xs[k])
r = S * 0.62 * sc * 1.0
for k in range(len(xs)):
    cx, cy = px[k] - minx, py[k] - miny
    d.polygon([(cx + S * sc * math.cos(math.radians(60 * a)), cy + S * sc * 0.5 * math.sin(math.radians(60 * a))) for a in range(6)], fill=tuple(int(v) for v in cols[k]))
d.text((20, 14), "Mill Town — hex map (flat-top, 2:1 squashed): the Mon Valley resampled onto %d valid hexagons" % int(valid.sum()), fill=(240, 236, 224), font=FT)
for lm in J["landmarks"]:
    if lm["kind"] != "town": continue
    cx, cy = center(lm["x"], lm["y"])
    cx = cx * sc - minx; cy = cy * sc - miny
    d.ellipse([cx - 4, cy - 4, cx + 4, cy + 4], fill=(255, 220, 90), outline=(20, 20, 20))
    d.text((cx + 7, cy - 8), lm["name"], fill=(255, 255, 240), font=F, stroke_width=2, stroke_fill=(20, 20, 24))
leg = [("water", TERR[0]), ("floodplain", TERR[1]), ("flat", TERR[2]), ("hillside", TERR[3]), ("steep", TERR[4]), ("upland", TERR[5]), ("rail", (50, 44, 40)), ("bridge", (200, 60, 50)), ("wharf", (200, 140, 60)), ("creek", (70, 130, 175))]
x0, y0 = 20, Himg - 30 - 22 * len(leg)
for k, (n, c) in enumerate(leg):
    d.rectangle([x0, y0 + k * 22, x0 + 16, y0 + k * 22 + 14], fill=c, outline=(230, 230, 230)); d.text((x0 + 24, y0 + k * 22 - 1), n, fill=(240, 240, 232), font=F)
img.save(os.path.join(out, "hex-map-overview.png"))
print("overview", img.size)

# ---------------------------------------------------------------- 2. close-up insets: real hex cells
def inset(name, cx_cell, cy_cell, rad, fn, scale=1.0, label=None, land_names=True):
    Sx = scale
    cells = []
    for y in range(max(0, cy_cell - rad), min(H, cy_cell + rad + 1)):
        for x in range(max(0, cx_cell - rad), min(W, cx_cell + rad + 1)):
            if not valid[y, x]: continue
            px_, py_ = center(x, y)
            cells.append((x, y, px_, py_))
    ccx, ccy = center(cx_cell, cy_cell)
    wpx, hpx = 1500, 900
    im = Image.new("RGB", (wpx, hpx), (27, 29, 34)); dd = ImageDraw.Draw(im)
    sy_off = lambda x, y: (y + x / 2.0) * RHp
    for (x, y, px_, py_) in sorted(cells, key=lambda c: (c[3], c[2])):
        sx = (px_ - ccx) * Sx + wpx / 2; sy = (py_ - ccy) * Sx + hpx / 2
        if sx < -60 or sx > wpx + 60 or sy < -40 or sy > hpx + 40: continue
        col = cell_color(y, x)
        pts = [(sx + S * Sx * math.cos(math.radians(60 * a)), sy + S * Sx * 0.5 * math.sin(math.radians(60 * a)) * 0.9999) for a in range(6)]
        # flat-top hex: width 2S, height sqrt3*S/2*... = 2*RH
        pts = [(sx + S * Sx * math.cos(math.radians(60 * a)), sy + (RHp * Sx) * math.sin(math.radians(60 * a)) / math.sin(math.radians(60))) for a in range(6)]
        dd.polygon(pts, fill=col, outline=(18, 20, 24))
    for lm in J["landmarks"]:
        px_, py_ = center(lm["x"], lm["y"])
        sx = (px_ - ccx) * Sx + wpx / 2; sy = (py_ - ccy) * Sx + hpx / 2
        if 0 < sx < wpx and 0 < sy < hpx:
            dd.ellipse([sx - 7, sy - 7, sx + 7, sy + 7], fill=(255, 220, 90), outline=(20, 20, 20), width=2)
            if land_names: dd.text((sx + 10, sy - 10), lm["name"], fill=(255, 255, 240), font=FB, stroke_width=2, stroke_fill=(20, 20, 24))
    dd.text((16, 12), label or name, fill=(240, 236, 224), font=FT, stroke_width=2, stroke_fill=(20, 20, 24))
    im.save(os.path.join(out, fn)); print(fn)

lm = {l["name"]: l for l in J["landmarks"]}
pt = lm["The Point (Pittsburgh)"]
inset("point", pt["x"], pt["y"], 28, "hex-closeup-point.png", 1.0, "Hex cells at the Point: rivers, bridges and rail (each hexagon ≈ the area of a 30 m tile)")
hs = lm.get("Homestead Works site")
if hs: inset("homestead", hs["x"], hs["y"], 28, "hex-closeup-homestead.png", 1.0, "Hex cells at Homestead: the Monongahela bend, rail lines and the Works site")

# ---------------------------------------------------------------- 3. the six neighbours + axial axes
im = Image.new("RGB", (1000, 640), (27, 29, 34)); dd = ImageDraw.Draw(im)
dd.text((20, 14), "Hex addressing: axial (x, y), six neighbours", fill=(240, 236, 224), font=FT)
cx0, cy0 = 330, 330; sc2 = 3.0
def hp(cx, cy, fill, outline=(18, 20, 24)):
    pts = [(cx + S * sc2 * math.cos(math.radians(60 * a)) * 0.62, cy + (RHp * sc2 * 0.62) * math.sin(math.radians(60 * a)) / math.sin(math.radians(60))) for a in range(6)]
    dd.polygon(pts, fill=fill, outline=outline)
names = ["(+1, 0) SE", "(+1,-1) NE", "(0,-1) N", "(-1, 0) NW", "(-1,+1) SW", "(0,+1) S"]
for q in range(-2, 3):
    for r in range(-3, 4):
        if max(abs(q), abs(r), abs(q + r)) > 2: continue
        sx = cx0 + q * CWp * sc2 * 0.62; sy = cy0 + (r + q / 2.0) * RHp * sc2 * 0.62
        col = (200, 90, 70) if (q, r) == (0, 0) else (110, 160, 200) if max(abs(q), abs(r), abs(q + r)) == 1 else (70, 80, 92)
        hp(sx, sy, col)
        dd.text((sx - 30, sy - 8), f"{q},{r}", fill=(255, 255, 255), font=F)
for k, n in enumerate(names):
    dd.text((650, 120 + k * 30), "neighbour %d: %s" % (k, n), fill=(240, 236, 224), font=FB)
dd.text((650, 340), "column pitch 42 px, row pitch 24.2 px", fill=(200, 200, 190), font=F)
dd.text((650, 366), "hexagon 56 px wide x 24.2 px tall (2:1 squash)", fill=(200, 200, 190), font=F)
dd.text((650, 392), "array index = y * width + x (axial)", fill=(200, 200, 190), font=F)
im.save(os.path.join(out, "hex-addressing.png")); print("addressing")
