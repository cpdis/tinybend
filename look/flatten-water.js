// Repaints open water in a drawn area in flat tones. The model invents streaks and patches
// on plain water, because plain water gives it nothing to follow. Where the map data says
// "water" and the render shows it plain, this replaces the drawing with flat bands of the
// model's own water colours, placed by the render's brightness. Shores, boats, jetties and
// water that varies sharply are left as drawn.
//
//   node look/flatten-water.js <render.png> <drawing.png> <x> <y> <out.png>
//   node look/flatten-water.js <render.png> <drawing.png> <x> <y> --learn <tones.json>
//   node look/flatten-water.js <render.png> <drawing.png> <x> <y> <out.png> --tones <tones.json>
//
// x and y are the picture's top-left corner in map pixels. The first form learns the water's
// colours from the picture and repaints it. The whole map is repainted sheet by sheet, and
// every sheet must use the same colours, or the water steps at each sheet's edge. So --learn
// only adds the picture's water colours to tones.json, and --tones repaints with that file.
// --mask <mask.png> names a picture that is black past the map's edge. Nothing there is water.
import { createRequire } from "node:module";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { depthAtHeight, unproject } from "../render/camera.js";
import { WATER_LEVEL, waterLookup } from "./osm-water.js";

const sharp = createRequire(new URL("../render/", import.meta.url))("sharp");

const CELL = 8; // The mask is worked out on a grid this many pixels wide.
const SHORE = 3; // Cells of water next to land that stay as drawn: 24 px, about 7 m.
const BLOCK = 64; // Cells per side of the block whose median counts as "the water colour here".
const PLAIN = 30; // Brightness levels a cell may differ from that median and still be plain water.
const KEEP = 2; // Cells around a boat or jetty that stay as drawn, so its outline survives.
const FEATHER = 12; // Pixels over which the flat tone fades into the drawing.
const SMOOTH = 40; // Blur on the render, in pixels, before its brightness sets the water's tone.
const STEP = 8; // Brightness levels per tone: smaller gives more, narrower bands of colour.
// Far offshore the render has no photo of the sea. It shows near-black, or Google's flat
// blue-violet filler. The model copies both as hard-edged slabs, so both count as "deep sea"
// and take the tone of the darkest photographed water.
const DEEP = 40; // Render brightness below this is deep sea.
const FILLER = [78, 98, 157]; // The render's filler colour.
const NEAR = 12; // Levels per channel a cell may differ from FILLER and still be filler.
const MIN_CELLS = 40; // A tone needs this many cells of evidence before it is used.

const args = process.argv.slice(2);
/** The value after a flag, taken out of the arguments. */
const flag = (name) => (args.includes(name) ? args.splice(args.indexOf(name), 2)[1] : null);
const [learnPath, tonesPath, maskPath] = [flag("--learn"), flag("--tones"), flag("--mask")];
const [renderPath, drawingPath, xArg, yArg, outPath] = args;
const [x0, y0] = [Number(xArg), Number(yArg)];
const { data: render, info } = await sharp(renderPath).removeAlpha().greyscale().raw().toBuffer({ resolveWithObject: true });
const { data: drawing } = await sharp(drawingPath).removeAlpha().raw().toBuffer({ resolveWithObject: true });
const [width, height] = [info.width, info.height];
const [cols, rows] = [Math.floor(width / CELL), Math.floor(height / CELL)];
const at = (c, r) => r * cols + c;

// 1. Which cells are water, from the map data, through the camera.
const isWater = await waterLookup();
const inMap = maskPath ? await sharp(maskPath).extractChannel(0).resize(cols, rows, { kernel: "nearest" }).raw().toBuffer() : null;
const water = new Uint8Array(cols * rows);
for (let r = 0; r < rows; r++) {
  for (let c = 0; c < cols; c++) {
    const [px, py] = [x0 + (c + 0.5) * CELL, y0 + (r + 0.5) * CELL];
    const point = unproject(px, py, depthAtHeight(px, py, WATER_LEVEL));
    water[at(c, r)] = isWater(point.lat, point.lon) && (!inMap || inMap[at(c, r)]) ? 1 : 0;
  }
}

/** A copy of the mask with every cell set that has a set cell within `reach` cells. */
function grow(mask, reach) {
  const out = new Uint8Array(mask.length);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      let hit = 0;
      for (let dr = -reach; dr <= reach && !hit; dr++) {
        for (let dc = -reach; dc <= reach && !hit; dc++) {
          const [rr, cc] = [r + dr, c + dc];
          if (rr >= 0 && rr < rows && cc >= 0 && cc < cols && mask[at(cc, rr)]) hit = 1;
        }
      }
      out[at(c, r)] = hit;
    }
  }
  return out;
}

// 2. Keep the shore: water within SHORE cells of land is not touched.
const land = water.map((w) => 1 - w);
const nearLand = grow(land, SHORE);
const open = water.map((w, i) => (w && !nearLand[i] ? 1 : 0));

// 3. Each cell's brightest and darkest render pixel, to find what stands out from the water.
const low = new Uint8Array(cols * rows).fill(255);
const high = new Uint8Array(cols * rows);
for (let r = 0; r < rows; r++) {
  for (let c = 0; c < cols; c++) {
    for (let dy = 0; dy < CELL; dy++) {
      for (let dx = 0; dx < CELL; dx++) {
        const v = render[(r * CELL + dy) * width + c * CELL + dx];
        if (v < low[at(c, r)]) low[at(c, r)] = v;
        if (v > high[at(c, r)]) high[at(c, r)] = v;
      }
    }
  }
}

// 4. In each block, the median brightness of open water. A cell far from it is a boat, a
// jetty, weed or shallows, and stays as drawn.
const object = new Uint8Array(cols * rows);
for (let br = 0; br < rows; br += BLOCK) {
  for (let bc = 0; bc < cols; bc += BLOCK) {
    const cells = [];
    for (let r = br; r < Math.min(rows, br + BLOCK); r++) for (let c = bc; c < Math.min(cols, bc + BLOCK); c++) if (open[at(c, r)]) cells.push(at(c, r));
    if (!cells.length) continue;
    const mids = cells.map((i) => (low[i] + high[i]) / 2).sort((a, b) => a - b);
    const median = mids[mids.length >> 1];
    for (const i of cells) if (high[i] - median > PLAIN || median - low[i] > PLAIN) object[i] = 1;
  }
}
const nearObject = grow(object, KEEP);

// Deep-sea cells, from each cell's mean render colour. All of a deep cell is repainted: the
// slab edges would otherwise count as objects and stay.
const colour = await sharp(renderPath).removeAlpha().resize(cols, rows, { kernel: "linear", fit: "fill" }).raw().toBuffer();
const deep = open.map((o, i) => {
  const [red, green, blue] = [colour[i * 3], colour[i * 3 + 1], colour[i * 3 + 2]];
  const filler = Math.abs(red - FILLER[0]) < NEAR && Math.abs(green - FILLER[1]) < NEAR && Math.abs(blue - FILLER[2]) < NEAR;
  return o && (filler || (red + green + blue) / 3 < DEEP) ? 1 : 0;
});
const flat = open.map((o, i) => (o && (deep[i] || !nearObject[i]) ? 1 : 0));

// 5. The water's tone follows the render, not the model. The render's water changes smoothly
// with depth and never in window-sized patches. So blur the render, round its brightness to
// steps, and learn from this area's own drawing which colour the model gives each brightness.
const { data: smooth, info: smoothInfo } = await sharp(render, { raw: { width, height, channels: 1 } }).blur(SMOOTH).raw().toBuffer({ resolveWithObject: true });
const cellOf = (i) => at(Math.min(cols - 1, Math.floor((i % width) / CELL)), Math.min(rows - 1, Math.floor(i / width / CELL)));
const level = (i) => (deep[cellOf(i)] ? DEEP : Math.max(DEEP, Math.round(smooth[i * smoothInfo.channels] / STEP) * STEP));
// Rounded render brightness to the drawing's summed colour there, and the count of cells.
const saved = [learnPath, tonesPath].find((path) => path && existsSync(path));
const sums = new Map(saved ? JSON.parse(readFileSync(saved, "utf8")) : []);
const learns = !tonesPath; // With --tones the colours are fixed: this picture adds nothing.
for (let r = 0; r < rows; r++) {
  for (let c = 0; c < cols; c++) {
    if (!learns || !flat[at(c, r)] || deep[at(c, r)]) continue;
    const i = (r * CELL + 4) * width + c * CELL + 4;
    const entry = sums.get(level(i)) ?? [0, 0, 0, 0];
    for (let k = 0; k < 3; k++) entry[k] += drawing[i * 3 + k];
    entry[3]++;
    sums.set(level(i), entry);
  }
}
const share = flat.reduce((sum, v) => sum + v, 0) / flat.length;
if (learnPath) {
  writeFileSync(learnPath, JSON.stringify([...sums]));
  console.log(`learned from ${(share * 100).toFixed(0)}% of the picture: ${sums.size} tones so far`);
  process.exit(0);
}
if (!sums.size || !share) {
  await sharp(drawingPath).png().toFile(outPath);
  console.log("no plain open water in this area: drawing copied unchanged");
  process.exit(0);
}
// A brightness seen in too few cells borrows the colour of the nearest well-seen one.
const known = [...sums.entries()].filter(([, e]) => e[3] >= MIN_CELLS).map(([lum, e]) => [lum, e.slice(0, 3).map((v) => v / e[3])]);
const fallback = [...sums.entries()].sort((p, q) => q[1][3] - p[1][3])[0];
if (!known.length) known.push([fallback[0], fallback[1].slice(0, 3).map((v) => v / fallback[1][3])]);
const tones = new Map();
const toneFor = (lum) => {
  if (!tones.has(lum)) tones.set(lum, known.reduce((best, entry) => (Math.abs(entry[0] - lum) < Math.abs(best[0] - lum) ? entry : best))[1]);
  return tones.get(lum);
};

// 6. Fade the tone in over the flattened cells.
const { data: alpha, info: alphaInfo } = await sharp(Buffer.from(flat.map((v) => v * 255)), { raw: { width: cols, height: rows, channels: 1 } })
  .resize(width, height, { kernel: "nearest" })
  .blur(FEATHER / 2)
  .raw()
  .toBuffer({ resolveWithObject: true });
const out = Buffer.alloc(width * height * 3);
for (let i = 0; i < width * height; i++) {
  // sharp may hand a one-channel image back with three, so step by its real channel count.
  const a = alpha[i * alphaInfo.channels] / 255;
  const tone = a > 0 ? toneFor(level(i)) : null;
  for (let k = 0; k < 3; k++) out[i * 3 + k] = a > 0 ? Math.round(drawing[i * 3 + k] * (1 - a) + tone[k] * a) : drawing[i * 3 + k];
}
await sharp(out, { raw: { width, height, channels: 3 } }).png().toFile(outPath);
console.log(`water ${((water.reduce((s, v) => s + v, 0) / water.length) * 100).toFixed(0)}% of the area, flattened ${(share * 100).toFixed(0)}% into ${known.length} tones`);
