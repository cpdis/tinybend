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
- **Accounts.** Modal Volume `tinybend` made. Google Cloud project `tinybend-maps` made with the Map Tiles API, a localhost-only key, Perth's cap of 150 root-tileset requests a day and a $25 monthly budget. Linking billing first failed: Google allows 5 projects on a billing account, and Colin freed one by turning billing off on an idle project. Checking keys showed that Tiny Perth's first renders (5 to 8 November) were billed to another project's key, about 220,000 tile requests, before Perth had its own project; so `render/shoot.js` now looks up which project its key belongs to and stops unless it is `tinybend-maps`. R2 waits for a Cloudflare token with R2 rights. Vercel project `tinybend` made, not yet linked to the repo.
- **Cost.** $0. The DEM is free (two 1° tiles, 78 MB). The Gemini review used Colin's sign-in quota.
- **Images.** `writeup/images/setup/bachelor-depth-range.webp` (the probe's Bachelor depth with the old clamped pixels in red, beside the new range), `writeup/images/setup/grid.svg` (the 526 shots, shaded by ground height). Account screenshots come with the account steps.

**In plain words.** Every shot of the map also records how far away each pixel is, and that distance has to fit between a near and a far limit set for the shot. In Perth the ground is flat and near sea level, so one setting worked everywhere. Bend's ground climbs from about 1,000 m in town to 2,760 m on Bachelor's summit, so on the mountain a third of the picture fell outside the limits and lost its distance. Now each shot looks up the real ground under its own pixels in a free height map of the Earth and sets its own limits. The same lookup decides which shots belong to the map.
