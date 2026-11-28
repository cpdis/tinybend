# Tiny Bend plan (draft, 2026-11-27; Colin's decisions of 2026-11-27 folded in)

An isometric pixel-art map of Bend, Oregon, plus a separate Mt. Bachelor patch, drawn twice: once in summer and once in winter, with a toggle in the viewer. Built on the Tiny Perth pipeline (cpdis/tinyperth), copied into a new repo, cpdis/tinybend, with a city config added.

The project ships two things, as Perth did: the map and a write-up of how it was made, built from `writeup/journal.md`.

- **Area:** two boxes on one camera and one pixel grid. City about 166 km² (widened west to take in Phil's trails), Bachelor about 64 km², and a relief chart between them. Decided 2026-11-27.
- **Camera:** Perth's, with a new origin: tilt 45°, yaw 15° (looking north), 0.293 m per pixel. Origin downtown Bend, 44.0582, -121.3153, 1,085 m above the WGS84 ellipsoid, so map pixel (0, 0) sits on the ground downtown.
- **Seasons:** summer is drawn from Google's render. Winter is drawn from the finished summer map by a second LoRA, so both seasons share every pixel position. Decided 2026-11-27. See "Winter".
- **Source data:** Google Photorealistic 3D Tiles on a new Google Cloud project (Phase 0).
- **Compute:** Modal for everything after rendering, as Perth.
- **Expected cost:** about $125 to $160 for summer and $100 to $140 for winter, so about $225 to $300 for both. A lean version (smaller teacher sets) is about $200 to $210. Hosting $0.

## Where each step runs

Unchanged from Perth: render on Colin's Mac (WebGL needs a real GPU), teacher calls and checks on Modal CPU, training and drawing on Modal H100s, tiles to R2, site on Vercel. Long runs on the Mac go through Remote Control.

## Phase 0: repo and accounts ($0, each with Colin's yes)

- [x] Repo `cpdis/tinybend` (Colin made it 2026-11-27). Pipeline copied from tinyperth `b372ebf` (code only, no Perth data), `render/LICENSE-isometric-nyc` kept, `cities/bend.json`, pstack settings and the `tinybend-mode` skill added (2026-11-28). `docs/porting.md` lists what is still Perth's, by phase.
- [x] `scripts/put-shots.py` now uploads every shot whole (colour, depth PNG and sidecar) by default, and refuses to start if any shot is missing a part; `--colour-only` for drawing-only folders (2026-11-28).
- [x] Ground height per shot (2026-11-28). `render/dem.js` reads the Copernicus DEM (GLO-30, two 1° tiles) and adds the geoid offset, -20.1 m, measured on the probe's depth pass. `render/grid.js` finds where each of 17 × 17 view rays per shot meets the DEM: those ground points decide the area test, and the depth range runs from 150 m above to 60 m below them, at least 1 km wide. `render/shoot.js` uses each frame's `near` and `far`. On the probe's Bachelor window, which had a third of its depth clamped, every unclamped depth falls inside the new 1.5 km range; town shots keep a 1 km range. The grid: 368 city shots (ground 1,013 to 1,286 m) and 158 Bachelor shots (1,584 to 2,634 m), 526 in all; 70 have a range wider than 1 km.
- [x] Camera origin in `cities/bend.json`: 44.0582, -121.3153, 1,085 m, mirrored in `render/camera.js` and checked by `tests/test_city.mjs`.
- [ ] Google Cloud project for Bend's renderer (not `tinyperth-maps`), key restricted to the Map Tiles API and localhost referrers, daily root-request cap, budget alert.
- [ ] Modal Volume `tinybend`, reusing the `huggingface` and `gemini` secrets; `r2` for the new bucket. The code now names `tinybend` with `create_if_missing=False`, so the Volume is made once, on purpose (`modal volume create tinybend`).
- [ ] R2 bucket `tinybend-tiles`, token scoped to it, public custom domain, CORS GET.
- [ ] Vercel project from the repo (Root Directory `site`), Web Analytics on.
- [ ] Domain: Colin registers it on Cloudflare.
- [ ] Keys into 1Password before any are copied (Colin's to-do).
- [ ] First journal entry with setup screenshots, accounts covered.

## Phase 0b: coverage probe ($0, Mac)

Seven spots, 2 × 2 shots of 2,048 px each (28 shots, about 6 minutes), on the real Bend grid: `probe/bend-probe.json`, shot with Perth's renderer and camera.js moved to the Bend origin (`probe/camera.bend.js`). Run `render/check-shots.js` on them and look by eye.

| Spot | Why |
| --- | --- |
| Downtown and the Old Mill | Buildings, river, smokestacks: the town at its densest |
| Pilot Butte | A cinder cone with a road spiralling up |
| Ponderosa forest west of town (Phil's trails) | Canopy and singletrack, where the mountain bikers would go |
| Lava flow by Lava Butte | Basalt, outside the map (no lava patch, decided 2026-11-27): a reference for the lava look only |
| Forest in the gap, Cascade Lakes Highway | What the 25 km between the boxes looks like, for the gap decision |
| Bachelor, West Village | Lodges, car parks, lift bases |
| Bachelor, summit | Steep ground, the summit lift and whatever snow Google photographed |

**Done 2026-11-27** (`probe/RESULTS.md`, `probe/spots/`, under $0.10). 28 of 28 shots clean, 0 coarse or failed tiles.

- Town, Pilot Butte, the forest by Phil's trails and Lava Butte: true 3D, as good as inner Perth. Dry summer photos.
- The forest in the gap: 2.5D, close to mush, with haze from the source photos. Confirms the relief chart over the gap.
- Bachelor: smooth 3D terrain with lodges, roads and lift huts, photographed in a late-spring melt: patchy snow over dark cinder. The summer map's Bachelor will show these snowfields; the winter repaint fills them in.
- The two Bachelor spots fell in the same 2 × 2 window (they are only about 1.2 km apart), which shows the summit and Pine Marten but not West Village. West Village gets checked in the full render.
- Depth was clamped on the mountain: the renderer's ±500 m depth range is centred on one height per frame. Fixed in Phase 0 below.

## Area

Two boxes on one grid. Bachelor is about 30 km west-southwest of downtown, and almost everything between is unbroken forest.

| Box | Edges (degrees) | Ground | Shots (about) | Draw cost per season |
| --- | --- | --- | --- | --- |
| City (widened west to take in Phil's trails, chosen 2026-11-27) | 44.00 to 44.11 N, 121.42 to 121.25 W | 166 km² | 368 (grid, 2026-11-28) | $47 to $50 |
| Bachelor | 43.949 to 44.021 N, 121.73 to 121.63 W | 64 km² | 158 (grid, 2026-11-28) | $18 to $20 |

The city box runs from about Baker Road in the south to Cooley Road in the north, and from the Phil's trail network west of Shevlin Park to past the eastside subdivisions. No Lava Butte patch (decided 2026-11-27). It keeps the river from Farewell Bend to First Street Rapids, Pilot Butte, Awbrey Butte and the airport road. Edges get fixed after the probe, from city limits in OpenStreetMap.

Draw cost is about $0.28 to $0.30 per km² of map on H100s, from Perth's ledger. Rendering is under $1 for all of it. The grid (2026-11-28) has more shots than the first estimate because a shot is kept when any of its 17 × 17 ground points is inside a box, against Perth's 5 × 5: the extra shots are part-filled edges. The joint sampler draws areas over shots, so the 14% more shots (526 against about 460) could add up to that much to the draw cost unless the edge areas are trimmed in `modal_app/plan.py`; that gets measured before the draw is asked for.

**Gap.** Decided 2026-11-27: one viewer, one grid, and the gap filled with a relief chart drawn in code from the DEM (Perth's `look/edges.py`), in a summer and a winter tint, with a "Fly to Bachelor" button. $0.

## Phase 1: the summer look ($10 to $15, a day)

As Perth's Phase 1, with the prompt rules unchanged. Four test frames: downtown and the river, ponderosa forest, lava or rimrock, Bachelor. Five or six variants on one contact sheet; Colin picks. 2x quarters, no reference image, no named ground colours, one measured water sentence per frame.

What the Bend variants have to get right: ponderosa canopy and its shadows, juniper and sagebrush high desert (grey-green, sparse), black basalt and red-brown cinder, the Deschutes with its whitewater park and Mirror Pond, canals, golf courses, roundabouts, ski runs and summer snowfields.

## Winter

Google's tiles are photographed in one season, almost certainly summer, so winter can't be rendered. It has to be painted. Four ways were weighed:

| Way | How | Alignment with summer | Look | Cost |
| --- | --- | --- | --- | --- |
| **A. Winter LoRA from the render** | Second teacher set: Gemini draws each render in the winter look. Second LoRA, same joint sampler, same render. | Same grid, but two independent drawings: trees, cars and roof details differ, so the toggle shimmers | Good | Full second teacher set and draw |
| **B. Winter LoRA from the summer map (recommended)** | Gemini repaints the summer teacher drawings as winter. A second LoRA learns summer drawing to winter drawing. The joint sampler then runs over the finished summer map, cut into the same 2,048 px shots, instead of over the render. | Pixel-for-pixel by construction: the input is the summer drawing itself, and an edit model keeps its outlines | Good, and consistent with summer by design | Smaller teacher set; same draw cost |
| C. img2img over the summer map with no LoRA | Partial noise plus a "winter" prompt on the base model | Loose | Breaks the trained look | Cheap but poor |
| D. Snow in code | Snow on up-facing surfaces from the depth pass's normals, masked by OpenStreetMap | Exact | Reads as a filter; pines and roofs look wrong | $0 |

**Chosen: B** (Colin, 2026-11-27). It is the only way that is both on the trained look and aligned for a toggle. It needs no new render, no Sentinel-2 pass and no new depth: winter reuses summer's render, depth, sidecars, labels and life-layer geometry. Its cost is that winter waits for summer, and any later summer patch needs a matching winter patch.

### How B runs

1. **Winter look ($5 to $8).** The four Phase 1 test frames' summer drawings, repainted in five variants of a winter look. Colin picks. Same rules: how to draw, never what; no place names.
2. **Winter teacher pairs ($25 to $45).** Inputs are summer teacher drawings that already exist and passed their checks, so nothing new is rendered. About 150 to 250 frames, weighted to what snow changes most: roofs, roads and car parks, pine canopy, lawns and golf courses, lava and cinder, water, ski runs and lifts.
3. **Winter pilot LoRA ($2 to $5).** FLUX.2 klein 4B, rank 32, about 2,000 steps, control image = summer drawing, target = winter drawing, a fixed caption with its own token. One extra run with the snow mask tinted onto the control image (as Perth's "marked water" test), to see if coverage follows the rules better.
4. **Draw winter ($55 to $60, or $65 to $70 with the trails strip).** The summer map's sheets cut back into the shot grid as `/renders/bend-summer-map`, and `map_run.py --renders bend-summer-map --lora winter-v1`. Same areas, same pins, same waves.
5. **Winter water repaint, tiles, check.** `look/flatten-water.js` with a winter colour table (open river dark and cold, frozen ponds white), tiles as `winter-v1/` with a `tiles.json` identical to summer's.

### Where snow goes

Chosen (Colin, 2026-11-27): the day after a good storm, so the two seasons look as different as possible. Snow on everything in both boxes, except:

- **Open water.** The Deschutes keeps flowing, so it stays open, dark water. Still ponds and small lakes freeze white (a hand list in `cities/bend.json`, because OSM can't tell them apart).
- **Cleared roads and car parks.** Arterials and collectors from OSM are ploughed to wet asphalt with banks at the kerb. Residential streets get packed snow with tyre tracks. Ski area car parks are ploughed.
- **Steep rock.** Cliffs and canyon walls steeper than about 45°, from the DEM, stay dark.
- **Pine canopy** stays dark green with snow on top, not white.

Depth by height, from the 30 m Copernicus DEM: the town (about 1,100 m) gets a few inches, with fences, kerbs and shrubs still showing; Bachelor (1,900 to 2,760 m) gets deep, rounded snow, with groomed runs in corduroy and the summit wind-scoured.

How the rules reach the picture: in the teacher prompt, one generated sentence per frame on where ground stays clear, built from OSM and the DEM, exactly as the water sentence is (no place names). In the LoRA, the control image already shows water and road class, so the rules are learned; the tinted-mask run tests whether it needs help. After drawing, the winter water repaint and a code check (below) hold the rest.

A typical patchy January was considered and not chosen: the drawn winter is the fresh storm. Patchy snow comes back in the viewer as a live state, below.

### Live snow and weather

The map has two drawn states, bare summer and fresh-storm winter. With the season on Live, the viewer shows what Bend has right now:

- **Snow on the ground, per box.** Snow depth from Open-Meteo (free, keyless, read-only) for one point downtown and one at West Village, through `site/api/weather.js` beside the METAR, cached for an hour. Each box picks its own state: Bachelor is snowy from about November to June while town is often bare, so the town and Bachelor tile layers are clipped to their own boxes and switch separately.
- **In-between snow** (a dusting, or a melt days after a storm). A third state built in code, $0: a "melt order" tile set baked once from the depth pass, the DEM and OSM, 8-bit like Perth's depth tiles, saying how early each pixel loses its snow. Roads, south-facing roofs and slopes, and sun-warmed open ground go first; north faces, shade under pines and snowbanks last. The viewer shows the winter tiles where the melt order is above a threshold set by snow depth, and summer below it, with a soft edge. Both tile sets are pixel-aligned, so the blend has no ghosting. About 0.3 GB more hosting. A later phase: the two drawn seasons ship first.
- **Falling snow and rain** when Bend Municipal's METAR reports SN or RA (Redmond as fallback), drawn as particles over the map, with fog and low cloud from the METAR as Perth does.
- **Real cloud** by day from GOES-West's visible band via NASA GIBS, as Perth's Himawari cloud: shadows and soft tops, METAR drawing at night or when the picture is stale.
- **Night.** Lit windows, street lights and ski-area lights reflect off snow: the winter tiles get a brighter night glow than summer's.
- Manual override stays: the toggle picks Summer, Winter or Live, and `?season=` links to one.

### Checks for winter

- **Outline agreement with summer.** `look/check.js`'s outline check, run summer tile against winter tile: fails on 5 or more of 64 cells differing. This is the toggle's proof of alignment.
- **Coverage in code.** Inside each tile, the share of non-water, non-cleared-road ground that is bright and unsaturated stays above a threshold set on the pilot; open-river pixels (OSM) stay dark; cleared arterials stay dark.
- **Snow drawn wrong.** Snow drawn as water or cloud, and grey-blue water drawn as snow: a Jev question in `judge/questions.py`, flagged tiles to a person.

## Checks for summer (new beside Perth's)

- **Green.** `look/check.js`'s "keeps 60% of the render's clear green" assumes lawns. Recalibrate on Bend frames: high desert is grey-green and sparse.
- **Snow (summer).** Snowfields drawn as water, cloud or sand; snow invented on bare grey cinder.
- **Lava.** Basalt drawn as water or asphalt.
- **Water.** As Perth, plus large lakes at Bachelor may show textured rectangles where Google's photo ends.

## Bend places in training

All in `places/bend.json` with `id`, `name`, `lat`, `lon`, `kind`. Coordinates are fixed from OSM in the repo setup thread. Landmarks need Colin's approval on a contact sheet before training, for each season's pairs.

### Landmarks (picked 2026-11-27; Colin still approves each landmark's pairs on the contact sheet before training)

Colin asked for distinctive places only. Seventeen:

**Town**

1. Mirror Pond, Drake Park and its footbridge
2. Downtown: Wall and Bond Streets and the Tower Theatre
3. The Old Mill District's three smokestacks, mill buildings and river footbridges
4. The amphitheater in the Old Mill
5. Bend Whitewater Park at McKay Park, under the Colorado Avenue bridge
6. Riverbend and Farewell Bend Parks, where the summer float puts in
7. Pilot Butte and its spiral summit road
8. Awbrey Butte and Central Oregon Community College
9. OSU-Cascades and its old pumice-mine site
10. Pine Nursery Park
11. Phil's Trailhead and the start of the trail network
12. One roundabout with its public art (picked from OSM `artwork` nodes on roundabouts after the probe)

**Bachelor**

13. West Village lodge and base area
14. Sunrise lodge and the tubing hill
15. Pine Marten Lodge
16. The summit and the Summit Express lift
17. The Northwest Express lift

### Hard places (from OSM, about ten each)

Ponderosa canopy with singletrack; juniper and sagebrush; lava and rimrock; cinder cones; irrigation canals; golf courses; roundabouts; ski runs and lift lines; quarries and pumice pits; river rapids. For winter's set add: roofs of every size, ploughed against unploughed roads, car parks, frozen against open water, lawns and fairways under snow.

### Test places (never trained, for both seasons)

- **Shevlin Park**: pine forest and Tumalo Creek in a canyon.
- **An eastside subdivision** away from any landmark: houses, lawns, juniper lots.
- **Rimrock along the Deschutes** north of downtown: basalt.
- **A golf course**: one of River's Edge, Awbrey Glen or Widgi Creek.
- **The cinder cone beside Bachelor's West Village**: bare cinder in summer (snow must not be invented), snow cover in winter.

If First Street Rapids or the canyon becomes a landmark, the basalt test place moves elsewhere on the rimrock.

## Life layers

Shared by both seasons: cars on OSM roads, roundabouts and lights (Perth's junction code), planes (adsb.lol), weather from Bend Municipal's METAR (Redmond as fallback), the sun's height, real cloud from GOES-West instead of Himawari, Cascades East Transit buses from its GTFS, ride along, labels, search and landmark cards. No passenger trains (BNSF freight only) and no ferries.

The season toggle switches both the tiles and the life:

| Summer | Winter |
| --- | --- |
| Floaters on tubes from Riverbend Park through the whitewater park's passage channel to Drake Park | Skiers and snowboarders down Bachelor's runs (OSM `piste:type=downhill`) |
| Kayaks and paddleboards on Mirror Pond and the river | Chairlifts with moving chairs (OSM `aerialway`) |
| Surfers on the whitewater park's wave | Nordic skiers on West Village's trails (`piste:type=nordic`) |
| Runners on the Deschutes River Trail and Pilot Butte | Sledders and tubers on sled hills (`piste:type=sled`, plus the Sunrise tubing hill) |
| Mountain bikers on singletrack (OSM `mtb:scale`), and Bachelor's bike park on its lifts | Snowploughs on the arterials; cars slower and in tyre tracks |
| Golfers; hikers on Bachelor's summit trail | Falling snow when the METAR reports snow |
| Fourth of July fireworks over Pilot Butte | New Year's Eve; any winter event Colin names |

The season toggle offers Summer, Winter and Live (the default, from real snow depth; see "Live snow and weather"), with `?season=summer|winter|live`. Switching crossfades the two tile sets without moving the view. US holidays replace Australian event days.

## Cost

| Step | Summer | Winter |
| --- | --- | --- |
| Coverage probe and all renders | under $1 | $0 (reuses summer's) |
| Look choice (Gemini) | $10 to $15 | $5 to $8 |
| Teacher pairs | $40 to $60 (250 to 350 frames) | $25 to $45 (150 to 250 frames) |
| Pilot LoRA | $2 to $5 | $2 to $5 |
| Draw city box (166 km²) | $47 to $50 | $47 to $50 |
| Draw Bachelor (64 km²) | $18 to $20 | $18 to $20 |
| Tile check and patch redraws | $5 to $10 | $5 to $10 |
| **Total** | **about $125 to $160** | **about $100 to $140** |

Both seasons: about $225 to $300. With 200 summer pairs and 150 winter pairs: about $200 to $210. Live snow, melt order, cloud and weather are code and free data: $0. Each paid run is still asked for on its own, with its estimate. Modal's two limits need room for each drawing phase: about $70 per season, so the December limits should be checked before the summer draw.

Hosting stays at $0: two seasons of about 230 km² come to about 1.4 GiB, plus about 0.3 GB of melt-order tiles, of tiles, well inside R2's free 10 GB.

## Order

1. Phase 0b probe ($0). 2. Colin's decisions below. 3. Phase 0 repo and accounts. 4. Summer: look, render, set, teacher, pilot, draw, sheets, water, tiles, check. 5. Winter: look, teacher, pilot, draw over the summer map, water, tiles, check. 6. Site with the toggle, life layers per season, write-up. Summer can ship alone first.

## Risks

- **Google's season.** The probe found Bachelor photographed in a late-spring melt, with patchy snow. Summer Bachelor keeps those snowfields; the summer snow check (snow drawn as water, cloud or sand) matters most there, and the teacher may need one measured sentence per frame on where snow lies, as for water.
- **Google's terms**, as Perth: the separate GCP project keeps Perth and world.cpd.dev out of any suspension.
- **Snow consistency across areas.** Pinning keeps joins matched, but snow brightness may drift between waves; the join guard (8 levels) applies to winter too.
- **Bachelor mesh.** Lifts and towers may be mush in Google's mesh; check each lift landmark's render before training.
- **Licences.** FLUX.2 klein 4B (Apache 2.0) for both LoRAs; the 9B is non-commercial.
