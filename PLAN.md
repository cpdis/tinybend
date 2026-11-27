# Tiny Bend plan (draft, 2026-11-27)

An isometric pixel-art map of Bend, Oregon, plus a separate Mt. Bachelor patch, drawn twice: once in summer and once in winter, with a toggle in the viewer. Built on the Tiny Perth pipeline (cpdis/tinyperth), copied into a new repo, cpdis/tinybend, with a city config added.

The project ships two things, as Perth did: the map and a write-up of how it was made, built from `writeup/journal.md`.

- **Area:** two boxes on one camera and one pixel grid. City about 132 km², Bachelor about 64 km². Not decided yet; see "Area".
- **Camera:** Perth's, with a new origin: tilt 45°, yaw 15° (looking north), 0.293 m per pixel. Origin downtown Bend, 44.0582, -121.3153, 1,085 m above the WGS84 ellipsoid, so map pixel (0, 0) sits on the ground downtown.
- **Seasons:** summer is drawn from Google's render. Winter is drawn from the finished summer map by a second LoRA, so both seasons share every pixel position. See "Winter".
- **Source data:** Google Photorealistic 3D Tiles on a new Google Cloud project (Phase 0).
- **Compute:** Modal for everything after rendering, as Perth.
- **Expected cost:** about $115 to $150 for summer and $95 to $130 for winter, so about $210 to $280 for both. A lean version (smaller teacher sets) is about $175 to $190. Hosting $0.

## Where each step runs

Unchanged from Perth: render on Colin's Mac (WebGL needs a real GPU), teacher calls and checks on Modal CPU, training and drawing on Modal H100s, tiles to R2, site on Vercel. Long runs on the Mac go through Remote Control.

## Phase 0: repo and accounts ($0, each with Colin's yes)

- [ ] Repo `cpdis/tinybend` (Colin creates it on GitHub; the Claude GitHub App installed on it). Copy the pipeline, keep `render/LICENSE-isometric-nyc`, add `cities/bend.json`, pstack and a `tinybend-mode` skill.
- [ ] Fix `scripts/put-shots.py` so it uploads depth PNGs and camera sidecars, not colour only.
- [ ] Google Cloud project for Bend's renderer (not `tinyperth-maps`), key restricted to the Map Tiles API and localhost referrers, daily root-request cap, budget alert.
- [ ] Modal Volume `tinybend`, reusing the `huggingface` and `gemini` secrets; `r2` for the new bucket.
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
| Lava flow by Lava Butte | Basalt, outside the city box: decides whether a lava patch is worth adding |
| Forest in the gap, Cascade Lakes Highway | What the 25 km between the boxes looks like, for the gap decision |
| Bachelor, West Village | Lodges, car parks, lift bases |
| Bachelor, summit | Steep ground, the summit lift and whatever snow Google photographed |

What to record per spot: mesh quality (true 3D, 2.5D or mush), coarse tiles, and the photo's season (snow on Bachelor? green or brown ground?). If Bachelor is mush the patch shrinks to the lodges and lower runs, or is dropped.

## Area

Two boxes on one grid. Bachelor is about 30 km west-southwest of downtown, and almost everything between is unbroken forest.

| Box | Edges (degrees) | Ground | Shots (about) | Draw cost per season |
| --- | --- | --- | --- | --- |
| City | 44.00 to 44.11 N, 121.385 to 121.25 W | 132 km² | 260 | $37 to $40 |
| City, widened west to take in Phil's trails | 44.00 to 44.11 N, 121.42 to 121.25 W | 166 km² | 330 | $47 to $50 |
| Bachelor | 43.949 to 44.021 N, 121.73 to 121.63 W | 64 km² | 130 | $18 to $20 |
| Optional: Lava Butte and the lava flow | 43.895 to 43.935 N, 121.385 to 121.32 W | 23 km² | 45 | $7 |

The city box runs from about Baker Road in the south to Cooley Road in the north, and from Shevlin Park to past the eastside subdivisions. It keeps the river from Farewell Bend to First Street Rapids, Pilot Butte, Awbrey Butte and the airport road. Edges get fixed after the probe, from city limits in OpenStreetMap.

Draw cost is about $0.28 to $0.30 per km² of map on H100s, from Perth's ledger. Rendering is under $1 for all of it.

**Gap.** Recommended: one viewer, one grid, and the gap filled with a relief chart drawn in code from the DEM (Perth's `look/edges.py`), in a summer and a winter tint, with a "Fly to Bachelor" button. The other choice is two maps in one viewer with a switch between them. Both are $0.

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

**Recommendation: B.** It is the only way that is both on the trained look and aligned for a toggle. It needs no new render, no Sentinel-2 pass and no new depth: winter reuses summer's render, depth, sidecars, labels and life-layer geometry. Its cost is that winter waits for summer, and any later summer patch needs a matching winter patch.

### How B runs

1. **Winter look ($5 to $8).** The four Phase 1 test frames' summer drawings, repainted in five variants of a winter look. Colin picks. Same rules: how to draw, never what; no place names.
2. **Winter teacher pairs ($25 to $45).** Inputs are summer teacher drawings that already exist and passed their checks, so nothing new is rendered. About 150 to 250 frames, weighted to what snow changes most: roofs, roads and car parks, pine canopy, lawns and golf courses, lava and cinder, water, ski runs and lifts.
3. **Winter pilot LoRA ($2 to $5).** FLUX.2 klein 4B, rank 32, about 2,000 steps, control image = summer drawing, target = winter drawing, a fixed caption with its own token. One extra run with the snow mask tinted onto the control image (as Perth's "marked water" test), to see if coverage follows the rules better.
4. **Draw winter ($55 to $60, or $65 to $70 with the trails strip).** The summer map's sheets cut back into the shot grid as `/renders/bend-summer-map`, and `map_run.py --renders bend-summer-map --lora winter-v1`. Same areas, same pins, same waves.
5. **Winter water repaint, tiles, check.** `look/flatten-water.js` with a winter colour table (open river dark and cold, frozen ponds white), tiles as `winter-v1/` with a `tiles.json` identical to summer's.

### Where snow goes

Recommended: the day after a good storm, so the two seasons look as different as possible. Snow on everything in both boxes, except:

- **Open water.** The Deschutes keeps flowing, so it stays open, dark water. Still ponds and small lakes freeze white (a hand list in `cities/bend.json`, because OSM can't tell them apart).
- **Cleared roads and car parks.** Arterials and collectors from OSM are ploughed to wet asphalt with banks at the kerb. Residential streets get packed snow with tyre tracks. Ski area car parks are ploughed.
- **Steep rock.** Cliffs and canyon walls steeper than about 45°, from the DEM, stay dark.
- **Pine canopy** stays dark green with snow on top, not white.

Depth by height, from the 30 m Copernicus DEM: the town (about 1,100 m) gets a few inches, with fences, kerbs and shrubs still showing; Bachelor (1,900 to 2,760 m) gets deep, rounded snow, with groomed runs in corduroy and the summit wind-scoured.

How the rules reach the picture: in the teacher prompt, one generated sentence per frame on where ground stays clear, built from OSM and the DEM, exactly as the water sentence is (no place names). In the LoRA, the control image already shows water and road class, so the rules are learned; the tinted-mask run tests whether it needs help. After drawing, the winter water repaint and a code check (below) hold the rest.

The other choice is a typical January day in town: patchy snow in shade and on north faces, bare south-facing yards, full snow only at Bachelor. More realistic, much less distinct, and the patches are hard to keep consistent across areas.

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

### Landmark candidates (Colin picks about 20)

**Downtown and the river**

- Mirror Pond, Drake Park and the footbridge
- Downtown: Wall and Bond Streets, the Tower Theatre
- The Old Mill District: the three smokestacks, the old mill buildings and the footbridges
- The amphitheater in the Old Mill
- Bend Whitewater Park at McKay Park, under the Colorado Avenue bridge
- Riverbend Park and Farewell Bend Park (the summer float's put-in)
- First Street Rapids and the river canyon north of downtown

**Buttes and campuses**

- Pilot Butte and its summit road
- Awbrey Butte and Central Oregon Community College
- OSU-Cascades campus and its pumice-mine site
- St. Charles hospital

**Parks and other**

- Pine Nursery Park
- Juniper Park and the swim centre
- A roundabout with its public art (Bend has dozens; pick one or two)
- Deschutes Brewery's public house or the Simpson Avenue brewery (if Colin wants one)

**Bachelor**

- West Village lodge and base
- Sunrise lodge and the tubing hill
- Pine Marten Lodge (mid-mountain)
- The Summit Express lift and the summit
- The Northwest Express and Outback lifts

**Only if the Lava Butte patch is added:** Lava Butte, its road, and the Lava Lands visitor centre.

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

Default season follows the date (winter from December to March, say), with `?season=summer|winter` and a toggle in the Life panel that crossfades the two tile sets without moving the view. US holidays replace Australian event days.

## Cost

| Step | Summer | Winter |
| --- | --- | --- |
| Coverage probe and all renders | under $1 | $0 (reuses summer's) |
| Look choice (Gemini) | $10 to $15 | $5 to $8 |
| Teacher pairs | $40 to $60 (250 to 350 frames) | $25 to $45 (150 to 250 frames) |
| Pilot LoRA | $2 to $5 | $2 to $5 |
| Draw city box (132 km²) | $37 to $40 | $37 to $40 |
| Draw Bachelor (64 km²) | $18 to $20 | $18 to $20 |
| Tile check and patch redraws | $5 to $10 | $5 to $10 |
| **Total** | **about $115 to $150** | **about $95 to $130** |

Both seasons: about $210 to $280. With 200 summer pairs and 150 winter pairs: about $175 to $190. Add about $10 a season for the trails strip and $7 a season for the Lava Butte patch. Each paid run is still asked for on its own, with its estimate. Modal's two limits need room for each drawing phase: about $60 per season, so the December limits should be checked before the summer draw.

Hosting stays at $0: two seasons of about 200 km² come to about 1.2 GiB of tiles, well inside R2's free 10 GB.

## Order

1. Phase 0b probe ($0). 2. Colin's decisions below. 3. Phase 0 repo and accounts. 4. Summer: look, render, set, teacher, pilot, draw, sheets, water, tiles, check. 5. Winter: look, teacher, pilot, draw over the summer map, water, tiles, check. 6. Site with the toggle, life layers per season, write-up. Summer can ship alone first.

## Risks

- **Google's season.** If the Bachelor photo shows heavy snow, summer Bachelor will show it too; the summer teacher sentence may need to say where snow lies, measured from the render like water.
- **Google's terms**, as Perth: the separate GCP project keeps Perth and world.cpd.dev out of any suspension.
- **Snow consistency across areas.** Pinning keeps joins matched, but snow brightness may drift between waves; the join guard (8 levels) applies to winter too.
- **Bachelor mesh.** Lifts and towers may be mush in Google's mesh; check each lift landmark's render before training.
- **Licences.** FLUX.2 klein 4B (Apache 2.0) for both LoRAs; the 9B is non-commercial.
