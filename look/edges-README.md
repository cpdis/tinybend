# The chart around the map

`site/edge/edge.js` draws a relief chart under the tiles and a dissolving rim over them, and keeps
the view inside the chart. The layers are baked offline:

1. `look/edges_geo.py` — heights and depths for every chart pixel, seen through the map's camera.
   Needs `dems.tif` (GA SRTM 1-second DEM-S) and `bathy.tif` (GA AusBathyTopo 250 m 2023) cut to
   lon 114.7–116.8, lat −33.0 to −30.9, from the public bucket `dea-public-data`
   (`projects/elevation/ga_srtm_dem1sv1_0/dems1sv1_0.tif`,
   `projects/ga_ausbathytopo250m_2023/Australian_Bathymetry_and_Topography_2023_250m_MSL_cog.tif`).
   Both CC BY 4.0. Writes `geo/z.npy`, `geo/bathy.npy`, `geo/latlon.npy`.
2. `look/edges.py <out> relief` — reads the level-3 tiles (1 px = 64 map px) from `./tiles` and
   `geo/*.npy`, writes `under-relief-<theme>.png`, `over-relief-<theme>.png` and `edges.json`.
   Convert to lossless WebP for the site. Phones load `*-half.webp` copies, made from those with a
   nearest-neighbour halving (PIL `resize(..., Image.NEAREST)`, lossless): a full layer unpacks to
   about 163 MB of memory, which can crash a phone tab, and a half one to about 41 MB. Other modes (`ocean`, `diorama`, `clouds`, `chart`,
   `survey`, `ink`) are the options that were tried; see writeup/journal.md, 2026-11-19.

    uv run --with numpy --with scipy --with pillow --with rasterio python look/edges.py site/edge relief
