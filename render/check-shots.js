// Checks a finished render before anything is drawn from it. The renderer can save a blurry
// shot as good when Google's tiles fail to load, so the shots are checked from what they
// recorded about themselves, not from the fact that their files exist.
//
//   node render/check-shots.js render/frames/greater.json render/out/greater [sheet.webp]
//
// A shot is bad when:
//   - it is missing;
//   - it showed coarse tiles: tiles blurrier than the target that had finer ones to show;
//   - it has no coarse-tile count (it is from before that count existed) and it showed very
//     few tiles. A full-detail shot of land shows over 400 tiles. A shot of 1 to 20 tiles is
//     one big blurry tile, or it is open sea far from shore, where Google has no more to show.
//     Numbers cannot tell those two apart, so such a shot stays bad until a person has looked
//     at it and its id is in <frames file minus .json>.reviewed.json.
// Prints the count, writes a contact sheet of up to 30 bad shots, and exits 1 if any is bad.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";

const FEW_TILES = 100;
const THUMB = 256;

const [framesPath, dir, sheetPath] = process.argv.slice(2);
const frames = JSON.parse(readFileSync(framesPath, "utf8"));
const reviewedPath = framesPath.replace(/\.json$/, ".reviewed.json");
const reviewed = new Set(existsSync(reviewedPath) ? JSON.parse(readFileSync(reviewedPath, "utf8")) : []);
const bad = [];
let unmeasured = 0;
for (const { id } of frames) {
  const sidecar = join(dir, `${id}.json`);
  if (!existsSync(sidecar) || !existsSync(join(dir, `${id}.png`))) {
    bad.push({ id, why: "missing" });
    continue;
  }
  const meta = JSON.parse(readFileSync(sidecar, "utf8"));
  if (meta.coarseTiles > 0) bad.push({ id, why: `${meta.coarseTiles} coarse tiles` });
  if (meta.coarseTiles === undefined) {
    unmeasured++;
    if (meta.tilesShown < FEW_TILES && !reviewed.has(id)) bad.push({ id, why: `${meta.tilesShown} tiles shown, no coarse-tile count, not reviewed` });
  }
}

console.log(`${frames.length} shots checked, ${bad.length} bad${unmeasured ? `; ${unmeasured} have no coarse-tile count and were judged by tiles shown only` : ""}`);
for (const { id, why } of bad.slice(0, 40)) console.log(`  ${id}: ${why}`);

const shown = bad.filter((b) => b.why !== "missing").slice(0, 30);
if (sheetPath && shown.length) {
  const across = Math.min(6, shown.length);
  const layers = await Promise.all(shown.map(async ({ id }, i) => ({ input: await sharp(join(dir, `${id}.png`)).resize(THUMB, THUMB).toBuffer(), left: (i % across) * THUMB, top: Math.floor(i / across) * THUMB })));
  await sharp({ create: { width: across * THUMB, height: Math.ceil(shown.length / across) * THUMB, channels: 3, background: "#000" } }).composite(layers).webp({ quality: 80 }).toFile(sheetPath);
  console.log(`contact sheet of ${shown.length} bad shots: ${sheetPath}`);
}
process.exit(bad.length ? 1 : 0);
