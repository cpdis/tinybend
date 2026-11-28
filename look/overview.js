// Shrinks every sheet and lays them out as one overview picture of the whole map.
//
//   node look/overview.js <sheets-folder> <out.webp> [px-per-sheet] [drawings-folder]
//
// drawings-folder holds other versions of the sheets' drawings, such as the water repaint.
//
// Each sheet loses its margin, shrinks to px-per-sheet (default 128) and is laid where index.json
// puts it. Past the map's edge the overview is dark grey, so missing ground stands out.
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const sharp = createRequire(new URL("../render/", import.meta.url))("sharp");
const BIG = { limitInputPixels: false };
const [folder, out, size = "128", drawings = folder] = process.argv.slice(2);
const px = Number(size);
const index = JSON.parse(readFileSync(join(folder, "index.json"), "utf8"));
const inner = { left: index.margin, top: index.margin, width: index.sheet, height: index.sheet };

const tiles = [];
for (const [col, row] of index.sheets) {
  const name = join(folder, `${col}_${row}`);
  // Use the mask as transparency, so ground past the map's edge shows the background.
  const mask = await sharp(`${name}.mask.png`, BIG).extractChannel(0).extract(inner).resize(px, px).raw().toBuffer();
  const pixels = await sharp(join(drawings, `${col}_${row}.png`), BIG).removeAlpha().extract(inner).resize(px, px).raw().toBuffer();
  const raw = { width: px, height: px };
  const input = await sharp(pixels, { raw: { ...raw, channels: 3 } }).joinChannel(mask, { raw: { ...raw, channels: 1 } }).png().toBuffer();
  tiles.push({ input, left: col * px, top: row * px });
}
await sharp({ create: { width: index.cols * px, height: index.rows * px, channels: 4, background: "#2a2a2a" } })
  .composite(tiles)
  .webp({ quality: 82 })
  .toFile(out);
console.log(`${tiles.length} sheets laid out at ${px} px each: ${index.cols * px} x ${index.rows * px}`);
