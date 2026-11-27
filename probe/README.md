# Coverage probe (Phase 0b)

28 shots of 2,048 px, 2 × 2 at seven spots, on the Bend grid (origin 44.0582, -121.3153, 1,085 m ellipsoid). Shot ids are `<spot>__c<col>_r<row>`.

Run on the Mac from a scratch copy of the tinyperth checkout, never committed there:

```bash
cp probe/camera.bend.js <tinyperth-copy>/render/camera.js
cp probe/bend-probe.json <tinyperth-copy>/render/frames/bend-probe.json
cd <tinyperth-copy>
node render/shoot.js render/frames/bend-probe.json --out render/out/bend-probe
node render/check-shots.js render/frames/bend-probe.json render/out/bend-probe probe-sheet.webp
```

`camera.bend.js` is tinyperth's `render/camera.js` (MIT-derived, see tinyperth's `render/LICENSE-isometric-nyc`) with only the origin changed.
