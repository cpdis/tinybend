# Tiny Bend

An isometric pixel-art map of Bend, Oregon, and Mt. Bachelor, in summer and winter. Renders of Google's Photorealistic 3D Tiles are redrawn by an image model trained on Bend; winter is a second model that repaints the summer map.

- `PLAN.md`: the plan of record. `CLAUDE.md`: rules for agents. `writeup/journal.md`: notes for the write-up.
- `cities/bend.json`: the camera, the two map areas, the DEM and the account names.
- `render/`: the renderer and the shot grid (`node render/dem.js fetch`, then `node render/grid.js`).
- `look/`, `places/`, `modal_app/`, `scripts/`: drawing, training, places and upload tools, from [Tiny Perth](https://github.com/cpdis/tinyperth). `docs/porting.md` lists what is still Perth's.

Tests: `node tests/test_city.mjs`, `python3 tests/test_put_shots.py`, `python3 tests/test_plan.py`, `python3 tests/test_joint.py`.

## Credits

- `render/page.js` is adapted from [isometric-nyc](https://github.com/cannoneyed/isometric-nyc) by Andy Coenen, under the MIT licence (`render/LICENSE-isometric-nyc`).
- Agents work here with [pstack](https://github.com/cursor/plugins/tree/main/pstack), starting with `/tinybend-mode`; see `docs/pstack.md`.
- Ground heights: Copernicus DEM GLO-30, © DLR e.V. 2010-2014 and © Airbus Defence and Space GmbH 2014-2018, provided under COPERNICUS by the European Union and ESA.
- Map data: Google Photorealistic 3D Tiles; OpenStreetMap contributors (ODbL).
