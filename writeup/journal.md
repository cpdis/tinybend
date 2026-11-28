# Tiny Bend journal

Notes for the write-up (`writeup/how.md`). Add one entry per finished plan step, in the PR that finishes it. Newest entry last.

Each entry covers the date, the plan step, what was tried, what failed and why, the numbers, the cost (from `runs/ledger.tsv`), and the images, saved under `writeup/images/<step>/`. Each entry also has an "In plain words" part for a reader who has never done this work.

## Terms so far

- **3D tiles.** Google's model of the world, cut into many pieces at different levels of detail. The renderer downloads only the pieces it needs for a view.
- **Render.** A picture that a computer draws from a 3D model.
- **Orthographic camera.** A camera whose rays are all parallel. Far things stay the same size as near ones, which is what makes a map isometric.
- **Shot.** One square picture of 2,048 × 2,048 pixels, cut from the one big picture the camera would take of the whole map. Shots sit side by side on a grid with no gaps or overlaps.
- **Depth pass.** A second image from the same shot. Each pixel stores a distance from the camera instead of a colour. It is how the map later knows what is in front of what, and how high things are.
- **Depth range.** The depth image stores 65,535 steps between a near distance and a far distance chosen for each shot. Anything nearer than near, or farther than far, is **clamped**: stored as the end value, so its real distance is lost.
- **DEM (digital elevation model).** A grid of ground heights. We use Copernicus GLO-30 from the European Space Agency: one height every 30 m, free with credit.
- **Ellipsoid and geoid.** Two ways to say "height". GPS and Google's tiles measure from an ellipsoid, a smooth mathematical Earth. Maps and the DEM measure from the geoid, roughly sea level. In Bend the geoid sits about 20 m below the ellipsoid, so a DEM height needs 20 m taken off to match the render.
- **Modal Volume.** A disk in the cloud that our GPU jobs on Modal read and write.

## 2026-11-27: plan and coverage probe

- **Step.** Before Phase 0, and Phase 0b.
- **What.** Wrote `PLAN.md` from Tiny Perth's pipeline: Bend and a Mt. Bachelor patch on one camera, drawn in summer and in winter. Colin picked the winter method (a second LoRA that repaints the finished summer map, so the two seasons line up pixel for pixel), a fresh-storm winter, a city box widened west for Phil's trails, and a relief chart over the 25 km of forest between town and mountain.
- **Probe.** 28 shots at seven spots, rendered on the Mac with Perth's renderer moved to a Bend origin (`probe/`). All 28 clean, no coarse tiles. Town, buttes and near forest are true 3D. The far forest is 2.5D mush with haze, which settled the relief chart. Bachelor was photographed in a late-spring melt, with patchy snow.
- **What failed.** Depth was clamped on the mountain: on up to the whole of a Bachelor shot. The renderer set each shot's depth range to 1 km around one ground height, and Bachelor's ground runs 1,000 m higher than town's. Both Bachelor spots also rendered the same window, because a frame given as x and y used its height only for the depth range.
- **Cost.** Under $0.10 of Google tiles (`runs/ledger.tsv`).
- **Images.** `probe/bend-probe-sheet.webp`, `probe/spots/*.jpg`.

## 2026-11-28: repo, city config and ground height per shot

- **Step.** Phase 0: repo, city config, per-shot ground height, shot upload, and the accounts (Colin said yes to all four on 2026-11-28).
- **Repo.** Copied Tiny Perth's pipeline at commit `b372ebf`: the renderer, the look and training scripts, the Modal jobs, the place tools and four tests. Perth's data stayed behind (its frames, place lists, style reference and the website's baked life layers). `docs/porting.md` lists each file that still holds something of Perth's and the phase that changes it.
- **City config.** `cities/bend.json` holds the camera (origin downtown, 44.0582, -121.3153, 1,085 m; tilt 45°, yaw 15°, 0.293 m per pixel), the two boxes, the DEM tiles, the geoid offset, the seasons and the account names. `render/camera.js` keeps a copy for the browser, and `tests/test_city.mjs` fails if they differ.
- **Geoid offset.** Measured, not looked up: for 16,384 points in four probe shots (downtown, Pilot Butte, Phil's forest, Lava Butte) the render's height minus the DEM's height has a median of -20.1 m. The four shots' medians run from -18.2 to -20.8 m; the spread is trees and roofs, which both models see slightly differently.
- **Ground per shot.** `render/grid.js` now asks, for 17 × 17 pixels across each shot, where that pixel's view ray meets the DEM. Those ground points (found by walking each ray down to the DEM, see Outside review) decide whether the shot is in the map, and set its depth range: from 150 m above the highest point to 60 m below the lowest, at least 1 km. This also fixes the probe's second bug, since a shot is placed by where its pixels really land.
- **Proof.** On the probe's Bachelor window, the old range clamped 33% of the pixels. The new range is 1,501 m, and every one of the 2.8 million depths the probe did record falls inside it; the DEM's ground falls inside it at every pixel. On the four town and forest shots, 100% of the recorded depths fall inside the new range, which stays 1 km wide.
- **Grid.** 368 city shots (ground 1,013 to 1,286 m) and 158 Bachelor shots (1,584 to 2,634 m): 526 shots, 2.2 billion pixels. 70 shots need a range wider than 1 km, 50 of them on Bachelor. The plan guessed about 460: the new area test keeps part-filled edge shots that Perth's coarser test dropped.
- **Shot upload.** Perth uploaded colour only, and later lost the depth pass for all but 731 of its 4,640 shots when the Mac's copy was cleaned up. `scripts/put-shots.py` now uploads colour, depth and sidecar together, and refuses to start if any shot is missing one.
- **Outside review.** Gemini 4 Neon (through agy on the Mac) reviewed the setup and the plan. It found a weakness in the first ground search: it guessed a height and refined it, which can settle on ground hidden behind a cliff steeper than 45°, and converges slowly on slopes facing away from the camera. `groundUnder` now walks each ray down from above Bachelor's summit in 15 m steps and bisects at the first crossing, which always finds the surface the camera sees. On Bend's DEM the two gave the same 526 shots, with no shot's ground or range moving more than 0.8 m, so the old search hadn't failed here yet; the walk is about 4 times slower (28 s for the whole grid). It also caught Perth's seed areas left in `modal_app/map_run.py`, a partial DEM download that would have silently dropped Bachelor shots, and several Perth-only water and place scripts, now in `docs/porting.md`. Its design questions are in `PLAN.md`.
- **Accounts.** Modal Volume `tinybend` made. Google Cloud project `tinybend-maps` made with the Map Tiles API, a localhost-only key, Perth's cap of 150 root-tileset requests a day and a $25 monthly budget. Linking billing first failed: Google allows 5 projects on a billing account, and Colin freed one by turning billing off on an idle project. Checking keys showed that Tiny Perth's first renders (5 to 8 November) were billed to another project's key, about 220,000 tile requests, before Perth had its own project; so `render/shoot.js` now looks up which project its key belongs to and stops unless it is `tinybend-maps`. R2: Colin made the bucket `tinybend-tiles` and a token for that bucket only in the dashboard, since the agents' Cloudflare token is kept to DNS; the token lists the empty bucket and is refused on every other bucket. Vercel project `tinybend` made, not yet linked to the repo.
- **Cost.** $0. The DEM is free (two 1° tiles, 78 MB). The Gemini review used Colin's sign-in quota.
- **Images.** `writeup/images/setup/bachelor-depth-range.webp` (the probe's Bachelor depth with the old clamped pixels in red, beside the new range), `writeup/images/setup/grid.svg` (the 526 shots, shaded by ground height). Account screenshots come with the account steps.

**In plain words.** Every shot of the map also records how far away each pixel is, and that distance has to fit between a near and a far limit set for the shot. In Perth the ground is flat and near sea level, so one setting worked everywhere. Bend's ground climbs from about 1,000 m in town to 2,760 m on Bachelor's summit, so on the mountain a third of the picture fell outside the limits and lost its distance. Now each shot looks up the real ground under its own pixels in a free height map of the Earth and sets its own limits. The same lookup decides which shots belong to the map.

## 2026-11-28: places and a second Bachelor probe

- **Step.** Phase 0: places in `places/bend.json`, and the second probe (plan step 3b).
- **Places.** 17 landmarks and 5 test places, each at an OpenStreetMap feature with its id, fetched on the Mac (the cloud container can't reach Overpass). All 22 fall inside a box: Sunrise Lodge is at -121.661, inside Bachelor's east edge. The roundabout landmark is Phoenix Rising on NW Galveston Avenue, picked from 25 artworks on roundabouts as the tallest and brightest from above and away from the other town landmarks. Test places sit 1.8 to 4.4 km from the nearest landmark, except Egan Cone, the cinder cone beside West Village, 0.86 km from the lodge: its circle is 300 m instead of 500 m so West Village's own frames stay clear of it.
- **Probe.** 16 shots, 2 x 2 at West Village, Sunrise Lodge, the Northwest Express and Egan Cone, chosen from the real grid by `render/probe-frames.js` and rendered on the Mac with Tiny Bend's own key. 0 failed, 0 bad in check-shots, 0 clamped depth pixels and 0 coarse tiles on every shot: the per-shot depth range holds on the mountain. 13,311 tiles shown. All 48 files (colour, depth, sidecar) are on the Volume in `/renders/probe2`.
- **What it showed.** Bachelor's mesh is true 3D, not mush: West Village's lodge and outbuildings have walls and roofs and the cars in the car park read as cars; Sunrise's lodge is small but clean; the Northwest Express runs are clear cuts through 3D tree crowns, though the lift line and towers can't be made out at this scale. Egan Cone is bare red-brown cinder with one snow patch on its north rim, as the test place needs. The season is late spring: bare ground at the base, patchy snow higher up.
- **Cost.** Under $0.05 of Google tiles (`runs/ledger.tsv`).
- **Images.** `writeup/images/probe2/probe2-sheet.webp` and one picture per place in `writeup/images/probe2/`.

**In plain words.** The first test render missed the bottom of the mountain, so this one aimed straight at the ski lodges, a lift and the small volcanic cone next to the main lodge. They all came out as proper 3D, and the new depth limits held everywhere. The list of places is now pinned to real map features, including the five places the model must never see in training, so they can be used later to check it honestly.

## 2026-11-28: the summer look

- **Step.** Phase 1: the summer look.
- **Terms.**
  - **Teacher.** A large image model (Google's Gemini 3 Pro Image) that redraws a render as pixel art from a written prompt. Its drawings become the training pairs for our own, much cheaper model later.
  - **Variant.** One version of the teacher prompt. Each variant is the same base prompt with one paragraph changed or added, so a contact sheet shows what that paragraph does.
  - **Quarter.** A shot cut into four 1,024-pixel squares, each enlarged 2x before the teacher draws it. Perth found that at this zoom the teacher redraws instead of copying the photo.
  - **Water sentence.** One generated sentence per quarter saying how much of it is open water, where, and in what colours, measured from OpenStreetMap and the render. It's the only thing in a prompt that differs between frames.
  - **Flat share.** The share of pixels whose 3 × 3 neighbourhood is one flat tone. Photos score low, pixel art high.
- **Frames.** Four windows centred on downtown and Mirror Pond, pine forest by Phil's trails, the basalt canyon of the Deschutes north of downtown, and Bachelor's summit (`render/frames/phase1.json`). None touches a test place. Rendered on the Mac: 0 clamped depth, 0 coarse tiles, 3,777 tiles.
- **Water in Bend.** Perth's water sentence projected every pixel onto one water height (-31 m) and treated everything west of the coast as sea. Bend has no coast, and the Deschutes drops about 110 m across town, so each pixel's ground point now comes from the shot's own depth pass (`look/surface.js`), and water comes from 362 OpenStreetMap features: 200 water areas, 41 canals and 121 ditches, a canal counting as water within half its width of its line.
- **What failed.** The first water sentences said downtown had no water at all, with Mirror Pond in plain view. The depth pass is a 16-bit greyscale PNG, and the image library read it as 8-bit colour unless told otherwise, so every pixel decoded to the near end of its depth range and landed about 500 m in the air and 570 m south of where it was. One line fixed it (`toColourspace("grey16")`), and `tests/test_surface.mjs` now fails without it. With the fix, downtown's two upper quarters read 18% and 28% water and the other 14 quarters none, which matches the renders.
- **Variants.** A is Tiny Perth's chosen prompt, unchanged: every colour taken from the render, no ground colour named. B adds hard high-desert light with every cast shadow one flat blue-violet; C adds separate tree crowns over open ground; D adds rock ledges as stepped faces and snow kept exactly where the render has it; E a thin coloured line; F is B, C and D together. No image other than the render goes into any call.
- **Numbers.** 96 drawings (4 frames × 4 quarters × 6 variants), 0 failed. Every variant roughly doubles to triples the render's flat share (downtown 0.16 to 0.33–0.37, forest 0.01 to 0.24–0.26, rimrock 0.09 to 0.38–0.40, Bachelor 0.36 to 0.73–0.77), and the six differ by at most 0.043 in any frame, so the score can't choose: the pick was by eye.
- **Pick.** Colin chose B on all four frames: its blue-violet shadows read as mountain light on the snow, and it keeps the river, fairways and roofs closest to the render. D left one forest quarter almost photographic; F put white blobs in the forest and stray contour lines on the rimrock; E washed downtown's trees to lime.
- **G.** B is dark and dense in the forest, so a seventh variant, G (B plus C's canopy), was tried on the forest and rimrock: more open ground and more separate crowns, closer to real pine stands, but more drift between quarters (below). B stays.
- **Drift between quarters.** Each quarter is a separate call, and the teacher's tone wanders from one to the next. Measured as the mean colour jump across the four joins between quarters (RGB distance over a 30-pixel strip each side), with the render's own jump as the floor:

  | Frame | Render | B | C | G |
  | --- | --- | --- | --- | --- |
  | Downtown | 17.2 | 19.2 | | |
  | Forest | 7.5 | 15.2 | 16.6 | 20.8 |
  | Rimrock | 5.4 | 14.9 | 23.7 | 24.8 |
  | Bachelor | 31.4 | 40.8 | | |

  The seams themselves never reach the map: teacher pairs are trained one quarter at a time, and the map is drawn in overlapping windows. But the drift is what the trained model learns, so it is checked again in Phase 2 on the teacher set, where a drawing whose tone strays far from its render's can be rejected and redrawn.
- **Cost.** $13.07 for the 96 drawings and $1.09 for G's 8 (from token counts; `runs/ledger.tsv`), plus under $0.05 of tiles. The first attempt at the draw was refused with "prepayment credits are depleted" at $0: Bend's new Gemini key sits in its own Google project, which needed its own credits in AI Studio.
- **Images.** `writeup/images/phase1-look/<frame>.webp` (render and A to F, four to a row), `writeup/images/phase1-look/b-c-g.webp` (render, B, C and G on the forest and rimrock).

**In plain words.** Before training anything, we asked Google's best image model to redraw four test pictures of Bend in six slightly different ways, and Colin picked the one he liked. The model got the same instructions each time except for one paragraph, so the differences show what each paragraph does. The winner, B, uses strong sunlight with cool blue-violet shadows. The surprise was not in the styles but in the joins: each picture is drawn in four pieces, and the pieces don't quite agree on colour, most of all in the forest. That doesn't break the map, but it is something to watch when we make the hundreds of example drawings the real model learns from.
