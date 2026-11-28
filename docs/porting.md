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
| `look/edges_geo.py`, `look/edges.py` | `GEOID = -31.0`, GA DEM-S and AusBathyTopo | Copernicus GLO-30 and `cities/bend.json` `ground.geoidOffset`; the gap relief chart, two tints | site |
| `look/labels.js`, `look/site-places.js`, `look/streets.js`, `look/landmark-cards.js` | `GROUND = -25` (Perth's coastal plain) | `groundProjector()` from `render/dem.js` | site |
| `look/osm-water.js` | Perth's water query | Deschutes, Mirror Pond, canals, Bachelor's lakes; frozen-pond list for winter | 1 |
| `render/even.js` | Sentinel-2 pass over Perth, `GROUND = -15`, Perth render folders | A Bend pass if the render needs evening out; per-shot ground from the frames | 2 (only if needed) |
| `places/lookup.js` | Perth's places and Overpass areas | Bend's 17 landmarks, hard places and 5 test places from OSM (`places/bend.json` is empty until then) | 2 |
| `look/charts.js`, `look/sheets.js`, `look/sheet.template.html`, `look/sheet.js` | Perth titles and examples | Bend's | when first run |
| `scripts/og/og.html` | tinyperth.com and its tile host | Bend's domain (open) | site |
| `docs/agent-native.md` | Perth's agent API notes | Rewrite for Bend's site | site |
| `modal_app/train.py` | One caption | A second, own-token caption for the winter LoRA | winter step 3 |

Not copied, and brought over when the site phase starts: `site/`, `life/`, `presence/`,
`ships/` (no ferries in Bend), and the site tests. Perth's frames, place lists, style reference
and landmark overrides were left out on purpose.
