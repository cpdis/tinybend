"""Bake the edge-treatment layers for the preview.

Reads the map's level-3 tiles (1 px = 64 map px), works out where the drawing stops and
whether each stretch of edge is sea or land, and writes, per option and theme:
  under-<mode>-<theme>.png  drawn beneath the tiles, fills the empty area
  over-<mode>-<theme>.png   drawn on top of the tiles, softens the inside of the edge
Both cover a padded box: half the map's width and height on every side.
"""
import json, sys
import numpy as np
from PIL import Image
from scipy import ndimage as ndi
from edges_asm import region

OUT = sys.argv[1] if len(sys.argv) > 1 else "build"
S = 64  # map px per raster px
mw, mh = 3968, 2688
PX, PY = mw // 2, mh // 2  # padding
W, H = mw + 2 * PX, mh + 2 * PY

rgba = np.asarray(region(3, 0, 0, mw, mh)).astype(np.int16)
src = np.zeros((H, W, 4), np.int16)
src[PY:PY + mh, PX:PX + mw] = rgba
r, g, b, a = src[..., 0], src[..., 1], src[..., 2], src[..., 3]
M = a > 128
water = M & (b > r + 20) & (b >= g - 15)

rng = np.random.default_rng(7)
yy, xx = np.mgrid[0:H, 0:W]
BAYER = np.array([[0, 32, 8, 40, 2, 34, 10, 42], [48, 16, 56, 24, 50, 18, 58, 26], [12, 44, 4, 36, 14, 46, 6, 38],
                  [60, 28, 52, 20, 62, 30, 54, 22], [3, 35, 11, 43, 1, 33, 9, 41], [51, 19, 59, 27, 49, 17, 57, 25],
                  [15, 47, 7, 39, 13, 45, 5, 37], [63, 31, 55, 23, 61, 29, 53, 21]]) / 64 + 1 / 128
bayer = BAYER[yy % 8, xx % 8]

def dith(alpha):
    """Ordered dither: True where a pixel is on for a 0..1 coverage."""
    return alpha > bayer

# Trim the stepped tile edge to a smooth outline: blur the drawn area and keep its solid middle.
M_raw = M
F = ndi.gaussian_filter(M.astype(float), 30)
M = M_raw & (F > 0.68)
M = ndi.binary_opening(M, iterations=2)
trimmed = ndi.binary_dilation(a > 0, iterations=1) & ~M

# The coast as a line x(y) down the mainland, carried on straight past the map's top and bottom.
main = M & (xx >= PX + 800)
land_main = main & ~water
first = np.argmax(land_main, axis=1).astype(float)
lead = np.argmax(main, axis=1)
# Only rows whose drawing starts in the sea on the west: there the first land pixel is the coast.
rows = np.nonzero(land_main.any(1) & water[np.arange(H), lead] & (first - lead > 3))[0]
cx = np.full(H, np.nan); cx[rows] = first[rows]
cx[rows] = ndi.median_filter(cx[rows], 41)
top, bot = rows[0], rows[-1]
ys = np.arange(H)
inner = (ys >= top) & (ys <= bot)
cx[inner] = np.interp(ys[inner], rows, cx[rows])
cx[inner] = ndi.gaussian_filter1d(cx[inner], 12)
# Past the ends, run on along the coast's overall line from each end point.
slope = np.polyfit(rows, cx[rows], 1)[0]
cx[:top] = cx[top] + (ys[:top] - top) * slope
cx[bot + 1:] = cx[bot] + (ys[bot + 1:] - bot) * slope
seaness = np.clip((cx[:, None] - xx) / 16 + 0.5, 0, 1)  # 1 west of the coast, 0 east

din = ndi.distance_transform_edt(M)
dout = ndi.distance_transform_edt(~M)
sea_out = seaness
sea_in = seaness
ocean_px = src[water & (din < 6)][:, :3]
OCEAN = tuple(int(v) for v in np.median(ocean_px, axis=0))
print("ocean", OCEAN, file=sys.stderr)

THEMES = {
    "light": dict(paper=(239, 230, 210), ink=(42, 32, 24), sky=(190, 216, 232), chart=(214, 230, 228), cloud=(255, 252, 246),
                  cloud2=(196, 208, 220), shadow=(42, 32, 24), ochre=(207, 95, 40)),
    "dark": dict(paper=(21, 24, 29), ink=(242, 233, 216), sky=(24, 34, 48), chart=(26, 38, 46), cloud=(132, 144, 164),
                 cloud2=(84, 96, 118), shadow=(0, 0, 0), ochre=(224, 116, 58)),
}

def blank():
    return np.zeros((H, W, 4), np.uint8)

def put(img, sel, col, alpha=255):
    img[sel, :3] = col
    img[sel, 3] = alpha

def mix(c1, c2, t):
    return tuple(int(round(c1[i] + (c2[i] - c1[i]) * t)) for i in range(3))

def save(img, name):
    Image.fromarray(img, "RGBA").save(f"{OUT}/{name}.png", optimize=True)

outside = ~M
# Fraction 0..1 across a band inside the edge: 1 at the edge, 0 at `width` px in.
def band(width):
    return np.clip(1 - (din - 0.5) / width, 0, 1) * M

# ---------- 1. Endless ocean: the sea carries on west, land dissolves into the paper ----------
def sea_fill(u, t, sea):
    deep = mix(OCEAN, (20, 50, 82), 0.7)
    put(u, sea, OCEAN)
    put(u, sea & dith(np.clip((dout - 60) / 160, 0, 1) * 0.7), mix(OCEAN, deep, 0.45))
    put(u, sea & dith(np.clip((dout - 260) / 300, 0, 1)), mix(OCEAN, deep, 0.8))
    # Pale swell lines parallel to the coast.
    swell = sea & (np.abs(((dout + (xx // 9 % 2)) % 22) - 11) < 0.5) & (dout > 6) & (((xx + yy) // 3) % 5 != 0)
    put(u, swell & dith(np.clip(1 - (dout - 6) / 120, 0, 1)), mix(OCEAN, (255, 255, 255), 0.18))

def ocean(t):
    u = blank()
    put(u, outside, t["paper"])
    sea = outside & dith(sea_out)
    sea_fill(u, t, sea)
    # Where the coast runs on past the drawing: a strip of beach and a line of surf.
    off = cx[:, None] - xx
    put(u, outside & (off > -2.5) & (off <= 0.5), (226, 206, 160))
    put(u, outside & (off > 0.5) & (off <= 1.5), (214, 232, 236))
    put(u, outside & (off > 1.5) & (off <= 3.5) & (((yy // 2) % 3) != 0), mix(OCEAN, (255, 255, 255), 0.35))
    o = blank()
    seaedge = dith(sea_in)
    put(o, M & seaedge & dith(band(30) ** 1.6), OCEAN)
    put(o, M & ~seaedge & dith(band(10) ** 1.2), t["paper"])
    return u, o

# ---------- 2. Diorama: the map is a slab of ground with a cut face and a shadow ----------
T = 30
def diorama(t):
    u = blank()
    put(u, outside, t["paper"])
    k = np.full((H, W), 999)
    above_water = np.zeros((H, W), bool)
    surf = M & ~(water | (sea_in > 0.5))
    for d in range(T, 0, -1):
        sh = np.zeros_like(M); sh[d:] = M[:-d]
        shl = np.zeros_like(M); shl[d:] = surf[:-d]
        hit = sh & outside
        k[hit] = d
        above_water[hit] = ~shl[hit]
    face = k <= T
    foot = M | face
    shf = np.zeros(foot.shape, float); shf[22:, 14:] = foot[:-22, :-14]
    shf = ndi.gaussian_filter(shf, 9)
    shadow_a = 0.28 if t is THEMES["light"] else 0.7
    put(u, outside & ~face & dith(shf * 0.6), mix(t["paper"], t["shadow"], shadow_a))
    wob = ndi.gaussian_filter1d(rng.normal(0, 1, W), 22) * 10
    kk = k + wob[None, :] * (k / T) + (bayer - 0.5) * 1.5
    strata = [(0, (88, 118, 58)), (1.5, (150, 98, 58)), (4, (196, 128, 74)), (9, (226, 196, 140)), (12, (238, 220, 180)),
              (17, (200, 126, 76)), (22, (168, 98, 60)), (27, (128, 76, 50))]
    land = face & ~above_water
    for depth, col in strata:
        put(u, land & (kk >= depth), col)
    wcol = face & above_water
    put(u, wcol, mix(OCEAN, (255, 255, 255), 0.12))
    put(u, wcol & dith(np.clip((k - 2) / 16, 0, 1)), mix(OCEAN, (6, 24, 46), 0.5))
    put(u, wcol & (kk >= T - 6), (222, 198, 150))
    put(u, wcol & (kk >= T - 2.5), (190, 160, 112))
    put(u, face & (k == T), (60, 44, 34) if t is THEMES["light"] else (6, 7, 9))
    o = blank()
    lip = M & (din <= 1.0)
    below = np.zeros_like(M); below[:-1] = outside[1:]
    put(o, lip & below, (255, 248, 230), 120)
    return u, o

# ---------- 3. Cloud bank: the map seen through a gap in the clouds ----------
def clouds(t):
    u = blank()
    put(u, outside, t["sky"])
    put(u, outside & dith(np.clip((dout - 30) / 200, 0, 1) * 0.7), mix(t["sky"], (255, 255, 255) if t is THEMES["light"] else (40, 52, 70), 0.45))
    dist2, (iy, ix) = ndi.distance_transform_edt(~M, return_indices=True)
    edge = (dout > 0) & (dout <= 1.5)
    ey, ex = np.nonzero(edge)
    pick = rng.choice(len(ey), size=len(ey) // 9, replace=False)
    cloud = np.zeros((H, W), bool)
    def puff(cy, cx, rr):
        y0, y1, x0, x1 = max(cy - rr, 0), min(cy + rr + 1, H), max(cx - int(rr * 1.7), 0), min(cx + int(rr * 1.7) + 1, W)
        if y0 >= y1 or x0 >= x1: return
        py, px = np.mgrid[y0:y1, x0:x1]
        cloud[y0:y1, x0:x1] |= ((px - cx) / 1.6) ** 2 + (py - cy) ** 2 <= rr * rr
    for i in pick:
        cy, cx = ey[i], ex[i]
        ny, nx = iy[cy, cx], ix[cy, cx]
        vy, vx = cy - ny, cx - nx
        n = max((vy * vy + vx * vx) ** 0.5, 1)
        off = rng.uniform(-4, 16)
        cy2, cx2 = int(cy + vy / n * off), int(cx + vx / n * off)
        for _ in range(rng.integers(2, 5)):
            puff(cy2 + int(rng.normal(0, 5)), cx2 + int(rng.normal(0, 12)), int(rng.uniform(7, 20)))
    far = np.nonzero(outside & (dout > 70) & (dout < 1200))
    for i in rng.choice(len(far[0]), size=150, replace=False):
        cy, cx = far[0][i], far[1][i]
        for _ in range(rng.integers(3, 7)):
            puff(cy + int(rng.normal(0, 4)), cx + int(rng.normal(0, 16)), int(rng.uniform(6, 18)))
    cloud = ndi.binary_closing(cloud, iterations=2)
    lit = np.zeros_like(cloud); lit[:-4, :-3] = cloud[4:, 3:]
    rim = cloud & ~lit
    lit2 = np.zeros_like(cloud); lit2[:-8, :-5] = cloud[8:, 5:]
    mid = cloud & ~lit2 & ~rim
    cs = np.zeros(cloud.shape, bool); cs[16:, 10:] = cloud[:-16, :-10]
    o = blank()
    put(o, M & dith(band(14) ** 1.5 * 0.8), t["cloud"])
    put(o, M & cs & ~cloud, (20, 24, 40), 70)
    put(u, outside & cs & ~cloud, mix(t["sky"], (0, 0, 0), 0.1))
    put(o, cloud, t["cloud"])
    put(o, mid & dith(np.full((H, W), 0.5)), mix(t["cloud"], t["cloud2"], 0.5))
    put(o, rim, t["cloud2"])
    return u, o

# ---------- 4. Nautical chart: paper, depth lines and soundings ----------
DIG = {"0": "111101101101111", "1": "010110010010111", "2": "111001111100111", "3": "111001111001111", "4": "101101111001001",
       "5": "111100111001111", "6": "111100111101111", "7": "111001010010010", "8": "111101111101111", "9": "111101111001111"}
def chart(t):
    light = t is THEMES["light"]
    u = blank()
    put(u, outside, t["paper"])
    grid = outside & ((xx % 160 == 0) | (yy % 160 == 0)) & ((xx + yy) % 4 < 3)
    put(u, grid, mix(t["paper"], t["ink"], 0.15))
    sea = outside & dith(sea_out)
    tint = (200, 224, 228) if light else (28, 46, 58)
    put(u, sea & dith(np.clip(1 - (dout - 4) / 60, 0, 1) ** 0.7), tint)
    blue = (42, 115, 163) if light else (111, 178, 222)
    for d in (4, 10, 20, 34, 54, 80):
        line = sea & (np.abs(dout - d) < 0.55)
        put(u, line & (((xx + yy) // 2) % 4 != 0 if d > 10 else line), blue)
    digc = mix(t["ink"], t["paper"], 0.25)
    sy, sx = np.nonzero(sea & (dout > 6) & ((xx % 83) == 0) & ((yy % 61) == 0) & (dout < 500) & (yy > 20) & (yy < H - 20) & (xx > 20) & (xx < W - 30))
    for y, x in zip(sy, sx):
        if rng.random() > 0.6: continue
        y += int(rng.integers(-8, 8)); x += int(rng.integers(-10, 10))
        depth = int(min(3 + dout[y, x] * 0.45 + rng.normal(0, 2), 99))
        for n, ch in enumerate(str(max(depth, 2))):
            for p, bit in enumerate(DIG[ch]):
                if bit == "1": u[y + p // 3, x + n * 4 + p % 3] = (*digc, 255)
    ry, rx = PY + 1150, PX + 650
    rr = np.hypot(yy - ry, xx - rx)
    put(u, (np.abs(rr - 80) < 0.6) & (((xx + yy)) % 3 != 0), mix(t["ink"], t["paper"], 0.3))
    put(u, (np.abs(rr - 86) < 0.6), mix(t["ink"], t["paper"], 0.3))
    for ang in range(0, 360, 45):
        L = 110 if ang % 90 == 0 else 62
        th = np.radians(ang)
        for s_ in range(L):
            y, x = int(round(ry - np.cos(th) * s_)), int(round(rx + np.sin(th) * s_))
            w = int((L - s_) / 12)
            col = (t["ochre"] if ang == 0 else t["ink"]) if ang % 90 == 0 else mix(t["ink"], t["paper"], 0.45)
            u[y - w:y + w + 1, x - w:x + w + 1] = (*col, 255)
    for gy, row in enumerate(["10001", "11001", "10101", "10011", "10001"]):
        for gx, c in enumerate(row):
            if c == "1": u[ry - 128 + gy * 3:ry - 125 + gy * 3, rx - 7 + gx * 3:rx - 4 + gx * 3] = (*t["ink"], 255)
    # The coast inked on where the drawing stops.
    off = cx[:, None] - xx
    put(u, outside & (off > -1.0) & (off <= 0.6), mix(t["ink"], t["paper"], 0.1))
    o = blank()
    seaedge = dith(sea_in)
    put(o, M & seaedge & dith(band(10) ** 1.3), tint)
    put(o, M & ~seaedge & dith(band(10) ** 1.2), t["paper"])
    return u, o


# ---------- 5–7. Charts from real heights and depths (GA DEM-S and AusBathyTopo, CC BY 4.0) ----------
import os
if os.path.exists("geo/z.npy"):
    Z = np.load("geo/z.npy").astype(np.float64)
    BATHY = np.load("geo/bathy.npy").astype(np.float64)
    # DEM-S reads 0 over the sea: there, take the depth from AusBathyTopo.
    Z = np.where(np.nan_to_num(Z) <= 0.0, np.minimum(np.nan_to_num(BATHY), -0.5), Z)
    LL = np.load("geo/latlon.npy")
    Zs = ndi.gaussian_filter(np.nan_to_num(Z), 1.2)
    SEA = Zs <= 0.0
    SEAs = ndi.gaussian_filter(np.where(SEA, Zs, 0), 2.5)  # smoother depths for the sea's lines

def iso(field, lv):
    s = field > lv
    e = np.zeros_like(s)
    e[:, 1:] |= s[:, 1:] & ~s[:, :-1]; e[:, :-1] |= s[:, :-1] & ~s[:, 1:]
    e[1:] |= s[1:] & ~s[:-1]; e[:-1] |= s[:-1] & ~s[1:]
    return e

def glyphs():
    g = dict(DIG)
    g["°"] = "010101010000000"; g["'"] = "010010000000000"; g["S"] = "111100111001111"; g["E"] = "111100111100111"
    g["m"] = "000000111111101"
    return g
GL = None
def text(u, y, x, s, col):
    global GL
    GL = GL or glyphs()
    for n, ch in enumerate(s):
        if ch == " ": continue
        for p, bit in enumerate(GL[ch]):
            yy0, xx0 = y + p // 3, x + n * 4 + p % 3
            if bit == "1" and 0 <= yy0 < H and 0 <= xx0 < W: u[yy0, xx0] = (*col, 255)

def graticule(u, t, step_deg, col):
    lat, lon = LL[0], LL[1]
    lines = iso(lat / step_deg, 0) if False else (iso(np.floor(lat / step_deg), -1e9) & False)
    a = np.floor(lat / step_deg); b = np.floor(lon / step_deg)
    e = np.zeros((H, W), bool)
    e[:, 1:] |= a[:, 1:] != a[:, :-1]; e[1:] |= a[1:] != a[:-1]
    e[:, 1:] |= b[:, 1:] != b[:, :-1]; e[1:] |= b[1:] != b[:-1]
    put(u, e & ((xx + yy) % 4 < 3), col)
    # Labels where each line crosses the middle of the box's top and left sides.
    for j in range(40, H - 40, 1):
        i = 30
        if a[j, i] != a[j - 1, i]:
            v = -max(a[j, i], a[j - 1, i]) * step_deg
            d, m = int(v), int(round((v - int(v)) * 60))
            if m == 60: d, m = d + 1, 0
            text(u, j + 3, i, f"{d}°{m:02d}'S", col)
    for i in range(40, W - 60):
        j = 30
        if b[j, i] != b[j, i - 1]:
            v = max(b[j, i], b[j, i - 1]) * step_deg
            d, m = int(v), int(round((v - int(v)) * 60))
            if m == 60: d, m = d + 1, 0
            text(u, j, i + 3, f"{d}°{m:02d}'E", col)

def rose(u, t, ry, rx, size=1.0):
    rr = np.hypot(yy - ry, xx - rx)
    put(u, (np.abs(rr - 80 * size) < 0.6) & ((xx + yy) % 3 != 0), mix(t["ink"], t["paper"], 0.3))
    put(u, (np.abs(rr - 86 * size) < 0.6), mix(t["ink"], t["paper"], 0.3))
    for ang in range(0, 360, 45):
        L = int((110 if ang % 90 == 0 else 62) * size)
        th = np.radians(ang)
        for s_ in range(L):
            y, x = int(round(ry - np.cos(th) * s_)), int(round(rx + np.sin(th) * s_))
            w = int((L - s_) / 12)
            col = (t["ochre"] if ang == 0 else t["ink"]) if ang % 90 == 0 else mix(t["ink"], t["paper"], 0.45)
            u[y - w:y + w + 1, x - w:x + w + 1] = (*col, 255)
    for gy, row in enumerate(["10001", "11001", "10101", "10011", "10001"]):
        for gx, c in enumerate(row):
            if c == "1": u[ry - int(128 * size) + gy * 3:ry - int(128 * size) + 3 + gy * 3, rx - 7 + gx * 3:rx - 4 + gx * 3] = (*t["ink"], 255)

def soundings(u, t, spacing, col, near=None):
    r = np.random.default_rng(11)
    for y in range(20, H - 20, spacing[1]):
        for x in range(20, W - 40, spacing[0]):
            y2, x2 = y + int(r.integers(-spacing[1] // 3, spacing[1] // 3)), x + int(r.integers(-spacing[0] // 3, spacing[0] // 3))
            if not (0 <= y2 < H and 0 <= x2 < W) or not SEA[y2, x2] or M[y2, x2]: continue
            d = -SEAs[y2, x2]
            if d < 1.5 or (near is not None and dout[y2, x2] > near): continue
            if not SEA[max(y2 - 6, 0):y2 + 8, max(x2 - 4, 0):x2 + 14].all(): continue
            text(u, y2, x2, str(int(round(d))), col)

def edge_fade(u, width=12, sea_width=26):
    """The drawing dissolves into the chart under it, more slowly at sea where the colours differ most."""
    o = blank()
    on = M & np.where(SEA, dith(band(sea_width) ** 1.5), dith(band(width) ** 1.3))
    o[on] = u[on]
    return o

def spot_heights(u, t, col, win=150, min_prom=25, min_h=25):
    """Hilltops: the highest point in a wide window that stands well above its surroundings."""
    land = np.where(SEA, -1e3, Zs)
    mx = ndi.maximum_filter(land, size=win)
    mn = ndi.minimum_filter(np.where(SEA, 1e4, Zs), size=win)
    peaks = (land == mx) & (land >= min_h) & (mx - mn >= min_prom) & ~M & (dout > 6)
    ys, xs = np.nonzero(peaks)
    taken = []
    for y, x in sorted(zip(ys, xs), key=lambda p: -land[p]):
        if any((y - a) ** 2 + (x - b) ** 2 < (win * 0.6) ** 2 for a, b in taken): continue
        if not (10 < y < H - 12 and 10 < x < W - 40): continue
        taken.append((y, x))
        u[y - 1:y + 2, x - 1:x + 2] = (*col, 255)  # the spot
        text(u, y - 2, x + 4, str(int(round(land[y, x]))), col)
    return len(taken)

def chart_real(t, style):
    light = t is THEMES["light"]
    u = blank()
    land_c = t["paper"]
    sep = (160, 108, 66) if light else (176, 132, 96)
    blue = (42, 115, 163) if light else (111, 178, 222)
    ink = mix(t["ink"], t["paper"], 0.1)
    put(u, np.ones((H, W), bool), land_c)
    if style == "survey":
        # Shoal water tinted in two steps, as on a printed chart.
        put(u, SEA & (SEAs > -10), (196, 222, 228) if light else (30, 52, 64))
        put(u, SEA & (SEAs <= -10) & (SEAs > -20), (216, 232, 232) if light else (25, 40, 50))
        put(u, SEA & (SEAs <= -20), mix(t["paper"], (230, 240, 240), 0.5) if light else (21, 30, 38))
        for lv in range(10, 600, 10):
            put(u, ~SEA & iso(Zs, lv) & ((((xx + yy) // 2) % 3 != 0) if lv % 50 else True), sep if lv % 50 == 0 else mix(sep, t["paper"], 0.45))
        for lv in (5, 10, 20, 30, 50, 100, 200, 500, 1000):
            put(u, SEA & iso(SEAs, -lv) & (((xx + yy) // 2) % 4 != 0 if lv > 10 else True), blue)
        soundings(u, t, (70, 52), mix(t["ink"], t["paper"], 0.25), near=900)
    elif style == "relief":
        # Height tints on land, shaded from the north-west, and depth tints at sea.
        stops_l = [(0, (232, 222, 190)), (15, (226, 214, 176)), (30, (220, 202, 158)), (50, (212, 186, 138)), (80, (204, 168, 118)),
                   (150, (192, 146, 98)), (250, (176, 124, 82)), (400, (150, 100, 66))] if light else \
                  [(0, (34, 34, 30)), (15, (40, 38, 32)), (30, (46, 42, 34)), (50, (54, 46, 36)), (80, (62, 50, 38)), (150, (72, 56, 40)),
                   (250, (84, 62, 44)), (400, (96, 70, 48))]
        stops_s = [(0, (184, 220, 226)), (5, (164, 206, 218)), (10, (142, 192, 210)), (20, (120, 174, 200)), (50, (96, 150, 186)),
                   (200, (72, 122, 166)), (1000, (52, 96, 140))] if light else \
                  [(0, (34, 60, 74)), (5, (30, 54, 70)), (10, (27, 48, 64)), (20, (24, 42, 58)), (50, (21, 36, 52)), (200, (18, 30, 46)),
                   (1000, (14, 24, 38))]
        for lv, col in stops_l:
            put(u, ~SEA & (Zs + (bayer - 0.5) * 6 >= lv), col)
        for lv, col in stops_s:
            put(u, SEA & (-SEAs + (bayer - 0.5) * (2 + lv * 0.15) >= lv), col)
        gy, gx = np.gradient(ndi.gaussian_filter(np.where(SEA, 0, Zs), 1.5))
        shade = (gx * 0.7 + gy * 0.7) / 18.75 * 4  # light from up-left
        dark = mix(stops_l[-1][1], (40, 28, 20), 0.5)
        put(u, ~SEA & dith(np.clip(shade, 0, 1) * 0.55), mix(dark, t["paper"], 0.35 if light else 0.0))
        put(u, ~SEA & dith(np.clip(-shade, 0, 1) * 0.5), mix((255, 250, 236), t["paper"], 0.2) if light else (110, 100, 86))
        for lv in range(50, 600, 50):
            put(u, ~SEA & iso(Zs, lv), mix(sep, (60, 40, 30), 0.25))
        for lv in (10, 20, 50, 200, 1000):
            put(u, SEA & iso(SEAs, -lv) & (((xx + yy) // 2) % 3 != 0), mix(blue, (255, 255, 255), 0.35) if light else mix(blue, (0, 0, 0), 0.2))
        # Sparse soundings at sea (metres) and spot heights on the hills.
        soundings(u, t, (150, 110), (28, 62, 96) if light else (176, 206, 226))
        n = spot_heights(u, t, (84, 50, 30) if light else (232, 206, 176), win=300, min_prom=45)
        print("spot heights", n, file=sys.stderr)
    elif style == "ink":
        put(u, SEA & dith(np.clip((SEAs + 12) / 10, 0, 1)), (190, 218, 226) if light else (32, 56, 70))
        for lv in (20, 50, 200, 1000):
            put(u, SEA & iso(SEAs, -lv) & (((xx + yy) // 2) % 3 != 0), blue)
        for lv in range(50, 600, 50):
            put(u, ~SEA & iso(Zs, lv) & ((xx + yy) % 3 != 0), mix(sep, t["paper"], 0.3))
        soundings(u, t, (110, 84), mix(t["ink"], t["paper"], 0.3), near=600)
    # Coastline, graticule (every 5 minutes), compass rose.
    put(u, iso(np.where(SEA, -1.0, 1.0), 0), ink)
    graticule(u, t, 1 / 12, mix(t["ink"], t["paper"], 0.45))
    rose(u, t, PY + 1150, PX + 520)
    return u, edge_fade(u)

def chart_survey(t): return chart_real(t, "survey")
def chart_relief(t): return chart_real(t, "relief")
def chart_ink(t): return chart_real(t, "ink")

modes = {"ocean": ocean, "diorama": diorama, "clouds": clouds, "chart": chart, "survey": chart_survey, "relief": chart_relief, "ink": chart_ink}
want = sys.argv[2:] or list(modes)
for name in want:
    for tn, t in THEMES.items():
        u, o = modes[name](t)
        cover = trimmed & (o[..., 3] == 0)
        o[cover] = u[cover]
        save(u, f"under-{name}-{tn}"); save(o, f"over-{name}-{tn}")
        print(name, tn, file=sys.stderr)
# Where the sea is (for the glints), at the same scale.
Image.fromarray(((outside & (sea_out > 0.5) & (dout > 3)) * 255).astype(np.uint8)).save(f"{OUT}/sea.png", optimize=True)
json.dump({"coast": [[float(cx[top]), int(top)], [float(cx[bot]), int(bot)]], "slope": float(slope), "deep": mix(OCEAN, mix(OCEAN, (20, 50, 82), 0.7), 0.8), "scale": S, "padX": PX, "padY": PY, "width": W, "height": H, "ocean": OCEAN}, open(f"{OUT}/edges.json", "w"))
