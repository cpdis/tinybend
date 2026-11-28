# What is still Perth's

The pipeline was copied from cpdis/tinyperth at `b372ebf` (2026-11-28). The parts every phase
needs were moved to Bend in the setup PR: the camera, the grid with per-shot ground height,
the DEM, the shot upload, the Modal and R2 names, the places validator and the training-set
caption. What is left is Perth-specific and gets moved in the phase that first runs it. Each
row says what to change. Delete a row when its PR lands.

| File | Still Perth | Change it to | Phase |
| --- | --- | --- | --- |
| `look/prompts.js` | Perth's six look variants and notes (Cottesloe, Kings Park), and `TEACHER_VARIANT` "k" | Bend's summer variants from the Phase 1 sheet; winter variants as a second table | 1 (summer), winter step 1 |
| `modal_app/common.py` | `TEACHER_VARIANT = "k"` | Bend's pick, in step with `look/prompts.js` | 1 |
| `look/check.js` | Green check assumes lawns (60% of the render's clear green) | Recalibrate on Bend frames: high desert is grey-green and sparse. Add the summer snow and lava checks (PLAN.md, "Checks for summer") | 1 to 2 |
| `look/edges_geo.py`, `look/edges.py` | `GEOID = -31.0`, GA DEM-S and AusBathyTopo, a coastline, stops capped at 400 m, 1:64 scale | Copernicus GLO-30 (plus the W123 tiles) and `ground.geoidOffset`; no coast; stops to 2,800 m; the gap chart with a snowline tint | site |
| `look/labels.js`, `look/site-places.js`, `look/streets.js`, `look/landmark-cards.js` | `GROUND = -25` (Perth's coastal plain) | `groundProjector()` from `render/dem.js` | site |
| `look/osm-water.js` | Perth's water query | Deschutes, Mirror Pond, canals, ponds; frozen-pond list for winter | 1 |
| `render/even.js` | Sentinel-2 pass over Perth, `GROUND = -15`, Perth render folders | A Bend pass if the render needs evening out; per-shot ground from the frames | 2 (only if needed) |
| `places/lookup.js` | Perth's places and Overpass areas | Bend's 17 landmarks, hard places and 5 test places from OSM, run on the Mac (`places/bend.json` is empty until then) | before Phase 1 |
| `look/charts.js`, `look/sheets.js`, `look/sheet.template.html`, `look/sheet.js` | Perth titles and examples | Bend's | when first run |
| `scripts/og/og.html` | tinyperth.com and its tile host | Bend's domain (open) | site |
| `docs/agent-native.md` | Perth's agent API notes | Rewrite for Bend's site | site |
| `modal_app/train.py` | One caption | A second, own-token caption for the winter LoRA | winter step 3 |
| `modal_app/plan.py` | `ORIGIN = (-5335, -1041)`, rings from Perth's corner | A ring origin per box on the 2,048 px grid (PLAN.md, open question 10) | 2 |
| `modal_app/map_run.py` | `AREA_COST` charged whole for edge areas; `SEED` now empty | Prorate by shot coverage, or raise Modal limits (PLAN.md, Cost) | 2 |
| `modal_app/sample.py` | Summer `CAPTION` and `/vol/train/v1` hard-coded; pinned fill from the render | Caption and training folder per LoRA; winter fill from pinned neighbours (open question 2) | winter step 4 |
| `places/hard.js` | Perth `BBOX` and `KINDS` (pools, beaches) | Both boxes from `cities/bend.json`; Bend's hard kinds (PLAN.md, Hard places) | 2 |
| `look/trainset.js` | Seen-landmark samples `optus-stadium`, `narrows`; `set-v1.json` | Two Bend landmark ids; Bend's set files | 2 |
| `look/water.js`, `look/flatten-water.js` | One `WATER_LEVEL = -31` for every pixel | Water height per pixel from the depth pass or the DEM (the Deschutes drops about 110 m across town) | 1 |
| `look/osm-water.js` | Treats land west of Perth's coastline as sea; Bend has no coastline, so every pixel reads as water | Drop the coast test; water from OSM polygons only | 1 |
| `look/flatten-water.js` | No winter colour table; skips water within 3 cells of shore | A winter table (open river, frozen ponds) and a narrower shore band for canals | winter step 5 |
| `look/check.js` | Summer checks only | A winter check (open question 3) | winter step 2 |

Not copied, and brought over when the site phase starts: `site/`, `life/`, `presence/`,
`ships/` (no ferries in Bend), and the site tests. Perth's frames, place lists, style reference
and landmark overrides were left out on purpose.
