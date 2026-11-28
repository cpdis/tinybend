"""Height and depth for every pixel of the edge raster, seen through the map's camera.

Each raster pixel (1 px = 64 map px) is a ray from the isometric camera. We find where it meets
the ground: start at sea level, look the height up, move along the ray to that height, repeat.
Land heights: GA 1-second SRTM DEM-S. Sea depths: GA AusBathyTopo 250 m 2023. Both CC BY 4.0.
Writes z.npy (metres above MSL, negative = depth) on the edge raster's grid.
"""
import json, sys
import numpy as np
import rasterio
from scipy import ndimage as ndi

meta = json.load(open(sys.argv[1]))  # edges.json
layout = json.load(open(sys.argv[2]))  # tiles.json
S, PX, PY, W, H = meta["scale"], meta["padX"], meta["padY"], meta["width"], meta["height"]

# ---- the camera (render/camera.js) ----
A, E2 = 6378137.0, 6.69437999014e-3
lat0, lon0 = np.radians(-31.9523), np.radians(115.8613)
tilt, yaw, mpp, standoff = np.radians(45), np.radians(15), 0.293, 20000.0
GEOID = -31.0  # Perth: MSL is about 31 m below the WGS84 ellipsoid (GROUND = -25 is 6 m above MSL)

def ecef(lat, lon, h):
    n = A / np.sqrt(1 - E2 * np.sin(lat) ** 2)
    return np.stack([(n + h) * np.cos(lat) * np.cos(lon), (n + h) * np.cos(lat) * np.sin(lon), (n * (1 - E2) + h) * np.sin(lat)], -1)

def geodetic(p):
    x, y, z = p[..., 0], p[..., 1], p[..., 2]
    b = A * np.sqrt(1 - E2); ep2 = (A * A - b * b) / (b * b)
    pp = np.hypot(x, y); th = np.arctan2(z * A, pp * b)
    phi = np.arctan2(z + ep2 * b * np.sin(th) ** 3, pp - E2 * A * np.cos(th) ** 3)
    n = A / np.sqrt(1 - E2 * np.sin(phi) ** 2)
    return phi, np.arctan2(y, x), pp / np.cos(phi) - n

east = np.array([-np.sin(lon0), np.cos(lon0), 0])
north = np.array([-np.sin(lat0) * np.cos(lon0), -np.sin(lat0) * np.sin(lon0), np.cos(lat0)])
up = np.array([np.cos(lat0) * np.cos(lon0), np.cos(lat0) * np.sin(lon0), np.sin(lat0)])
heading = east * np.sin(yaw) + north * np.cos(yaw)
right = east * np.cos(yaw) - north * np.sin(yaw)
forward = heading * np.cos(tilt) - up * np.sin(tilt)
image_up = heading * np.sin(tilt) + up * np.cos(tilt)
position = ecef(lat0, lon0, 0.0) - forward * standoff

# ---- the data ----
def sampler(path):
    src = rasterio.open(path)
    a = src.read(1).astype(np.float32)
    nod = src.nodata
    bad = ~np.isfinite(a) | (a < -1e30) | ((a == nod) if nod is not None else False)
    a[bad] = np.nan
    inv = ~src.transform
    def at(lat, lon):
        c, r = inv * (np.degrees(lon), np.degrees(lat))
        return ndi.map_coordinates(a, [r - 0.5, c - 0.5], order=1, mode="nearest", cval=np.nan)
    return at

dem = sampler("dems.tif")
bathy = sampler("bathy.tif")

def height(lat, lon):
    z = dem(lat, lon)
    b = bathy(lat, lon)
    return np.where(np.isnan(z), b, z), b


Z = np.zeros((H, W), np.float32); BB = np.zeros((H, W), np.float32); LL = np.zeros((2, H, W), np.float32)
for r0 in range(0, H, 256):
    r1 = min(r0 + 256, H)
    jj, ii = np.mgrid[r0:r1, 0:W].astype(np.float64)
    mx = (ii - PX + 0.5) * S + layout["x"]
    my = (jj - PY + 0.5) * S + layout["y"]
    base = position + right * (mx[..., None] * mpp) - image_up * (my[..., None] * mpp)
    ray = lambda depth: geodetic(base + forward * depth[..., None])
    def depth_at(h, depth):
        for _ in range(5):
            _, _, hh = ray(depth)
            depth = depth + (hh - h) / np.sin(tilt)
        return depth
    shape = (r1 - r0, W)
    depth = depth_at(np.full(shape, GEOID), np.full(shape, standoff))
    for it in range(3):
        lat, lon, _ = ray(depth)
        z, b = height(lat, lon)
        # The sea floor is drawn as a flat chart at sea level; only land is lifted.
        depth = depth_at(GEOID + np.maximum(np.nan_to_num(z), 0), depth)
    lat, lon, _ = ray(depth)
    z, b = height(lat, lon)
    Z[r0:r1] = z; BB[r0:r1] = b; LL[0, r0:r1] = np.degrees(lat); LL[1, r0:r1] = np.degrees(lon)
    print(r0, file=sys.stderr)
np.save("z.npy", Z); np.save("bathy.npy", BB); np.save("latlon.npy", LL)
