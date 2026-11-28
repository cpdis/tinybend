// Cuts every landmark out of the finished map, next to the render it was drawn from, as
// contact sheets to check by eye: did the model keep each landmark's shape?
//
//   node look/landmarks.js <sheets-folder> <drawn-folder> <out-folder>
//
// The sheets folder is what look/sheets.js wrote: it has index.json and each sheet's render.
// The drawn folder holds the finished drawing of each sheet under the same name (the sheets
// folder itself, or the water repaint's output). Writes landmarks-1.webp, landmarks-2.webp...
// with PER_SHEET landmarks each: render on the left, drawing on the right.
import { createRequire } from "node:module";
import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const sharp = createRequire(new URL("../render/", import.meta.url))("sharp");

const PER_SHEET = 7;
const SIDE = 720; // Each picture's width on the contact sheet.
const GAP = 8;
const LABEL = 44;
const BIG = { limitInputPixels: false };

const [sheetsFolder, drawnFolder, outFolder] = process.argv.slice(2);
const index = JSON.parse(readFileSync(join(sheetsFolder, "index.json"), "utf8"));
const frames = JSON.parse(readFileSync(fileURLToPath(new URL("../places/landmark-frames.json", import.meta.url)), "utf8"));
mkdirSync(outFolder, { recursive: true });

/** A square of the map, cut from the one sheet whose margin-padded picture holds all of it. */
async function cut(folder, suffix, frame) {
  const [col, row] = [Math.floor((frame.x - index.x) / index.sheet), Math.floor((frame.y - index.y) / index.sheet)];
  const left = frame.x - (index.x + col * index.sheet - index.margin);
  const top = frame.y - (index.y + row * index.sheet - index.margin);
  const full = index.sheet + 2 * index.margin;
  // A frame that crosses further into the next sheet than the margin is clipped to this one.
  const box = { left, top, width: Math.min(frame.size, full - left), height: Math.min(frame.size, full - top) };
  return sharp(join(folder, `${col}_${row}${suffix}`), BIG).extract(box).resize(SIDE, SIDE, { fit: "contain", position: "left top", background: "#14181c" }).toBuffer();
}

const label = (text) =>
  Buffer.from(`<svg width="${2 * SIDE + GAP}" height="${LABEL}" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="#14181c"/><text x="10" y="30" font-family="Helvetica" font-size="24" fill="#fff">${text}</text></svg>`);

for (let first = 0; first < frames.length; first += PER_SHEET) {
  const group = frames.slice(first, first + PER_SHEET);
  const layers = [];
  for (const [i, frame] of group.entries()) {
    const top = i * (LABEL + SIDE + GAP);
    layers.push({ input: label(`${frame.id}: render, then drawing`), left: 0, top });
    layers.push({ input: await cut(sheetsFolder, ".render.png", frame), left: 0, top: top + LABEL });
    layers.push({ input: await cut(drawnFolder, ".png", frame), left: SIDE + GAP, top: top + LABEL });
  }
  const file = join(outFolder, `landmarks-${first / PER_SHEET + 1}.webp`);
  await sharp({ create: { width: 2 * SIDE + GAP, height: group.length * (LABEL + SIDE + GAP), channels: 3, background: "#14181c" } }).composite(layers).webp({ quality: 85 }).toFile(file);
  console.log(`${file}: ${group.map((f) => f.id).join(", ")}`);
}
