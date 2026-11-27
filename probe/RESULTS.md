# Coverage probe results (2026-11-27)

28 shots of 2,048 px, rendered on the Mac (Apple M3 Max GPU) from a scratch copy of tinyperth's renderer with `camera.bend.js`. About 11 minutes in all.

## check-shots output

```
28 shots checked, 0 bad
```

No shot was missing, and no shot showed coarse tiles (`coarseTiles` is 0 on all 28). Tiles shown per shot: 568 to 1,082. check-shots draws a sheet of bad shots only, so `bend-probe-sheet.webp` is a separate sheet of all 28 shots: one row per spot, in the table's order.

## Per spot

`spots/<spot>.jpg` is each spot's 2 x 2 shots joined and scaled to 1,536 px. "Clamped" is the number of depth pixels outside the depth range the renderer set from the frame's `height` (4,194,304 = the full window).

| Spot | Coarse / failed | Clamped depth | Mesh | Season |
|---|---|---|---|---|
| downtown-oldmill | 0 / 0 | 0 | True 3D. Buildings have walls and roofs, trees stand up, and the river and bridges are clean. As good as inner Perth. | Summer. Green lawns and trees, dry tan lots, no snow. |
| pilot-butte | 0 / 0 | 0 | True 3D. The cone has clear relief, with the spiral road and the summit lookout. Houses and the school are clean. | Summer. Dry tan grass on the butte, green irrigated fields. |
| forest-west | 0 / 0 | 0 | True 3D. Single pines with their own shadows, and logged patches stand out. | Summer. Dry tan ground, green pines. |
| lava-butte | 0 / 0 | 0 | True 3D. Cinder cone, crater rim, the road up and the lava flow all read well. | Summer. Green pines, no snow. |
| gap-forest | 0 / 0 | 21 to 32% of each shot | 2.5D, close to mush. Trees are smeared blobs with streaks, and a haze from the source photos sits over the top half. | Late summer or autumn. Dark green and brown, no snow. |
| bachelor-west-village | 0 / 0 | 53 to 100% | Terrain 3D, smooth. Few trees. This window shows the upper mountain, not the village (see below). | Late spring melt. Patchy snow over dark rock. |
| bachelor-summit | 0 / 0 | 0 to 46% | Same window as bachelor-west-village, so the same picture. | Same. |

## Findings

1. **Coverage is full detail everywhere.** Google has fine tiles at all seven spots, up to the high mountain. No coarse tiles, no failed tiles.
2. **The town, the buttes and the near forest are true 3D** and look as good as Tiny Perth's source.
3. **The far forest (gap-forest) is the weak spot.** The mesh is 2.5D and there is haze baked into the photos. Expect the image model to have to invent most of the tree detail there.
4. **The photos are summer, except the mountain.** Town and forest are dry summer. The mountain is late-spring patchy snow. A winter map needs the snow painted in (the plan's "repaint winter" decision holds).
5. **Probe bug: both Bachelor spots shoot the same window.** For `{ x, y }` frames, `shoot.js` uses `height` only for the depth range, not to place the window. Both Bachelor spots have the same x/y, so they render the same picture with different depth ranges. The x/y windows sit on the 1,085 m origin plane. Ground 800 to 1,500 m higher shows up shifted in the isometric view, so this window shows the upper mountain and not West Village. To aim at high ground, write those frames as `{ lat, lon, height }` so `shotAt` places them, or shift x/y for the height.
6. **Depth range needs work for the mountain.** The renderer sets near/far to ±500 m around the frame's height. Where the ground is not at that height, depth is clamped (up to the whole window). Bend's ground runs from about 1,000 m to 2,760 m, so the full map needs the ground height per frame (from the terrain) or a wider range.

## Cost

Under $0.10 of Google 3D tiles on the existing Tiny Perth key. See `runs/ledger.tsv`.
