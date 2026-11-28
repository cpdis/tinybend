// Builds the Phase 1 contact sheet from the renders and drawings: flat-pixel scores,
// a montage per frame, and one self-contained HTML page with a switcher.
//
//   node look/sheet.js render/out/phase1 look/out/phase1 review/phase1-look.html writeup/images/phase1-look
//
// The frames are render/frames/phase1.json's. Their drawings are whole frames, joined from
// quarters by look/join-quarters.js.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { VARIANTS } from "./prompts.js";

// sharp is installed once, with the renderer.
const sharp = createRequire(new URL("../render/", import.meta.url))("sharp");

const here = dirname(fileURLToPath(import.meta.url));
// Names for the sheet only: they never reach a teacher prompt.
const NAMES = {
  "downtown-river": "Downtown and the river",
  "ponderosa-forest": "Pine forest by the trails",
  "rimrock-canyon": "Rimrock canyon on the river",
  "bachelor-summit": "Bachelor's summit",
};
const FRAMES = JSON.parse(readFileSync(join(here, "..", "render", "frames", "phase1.json"), "utf8")).map((f) => ({
  id: f.id,
  name: NAMES[f.id.split("__")[0]] ?? f.id,
}));
const THUMB = 512;

const [renders, drawings, page, imagesDir] = process.argv.slice(2);
mkdirSync(imagesDir, { recursive: true });
mkdirSync(join(here, "out", "montage"), { recursive: true });

const renderPath = (frame) => join(renders, `${frame}.png`);
const drawingPath = (frame, variant) => join(drawings, `${frame}.${variant}.jpeg`);
// A folder may hold only some variants, so show the ones drawn for every frame.
const variants = VARIANTS.filter((v) => FRAMES.every((f) => existsSync(drawingPath(f.id, v.id))));

/** The share of pixels whose 3 x 3 neighbourhood is flat. Photo copies score low. */
async function flatShare(path) {
  const { data, info } = await sharp(path).removeAlpha().greyscale().raw().toBuffer({ resolveWithObject: true });
  const w = info.width;
  const TOLERANCE = 6; // Levels. Allows for JPEG noise in the model's output.
  let flat = 0;
  let total = 0;
  for (let y = 1; y < info.height - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const c = data[y * w + x];
      let same = true;
      for (let dy = -1; dy <= 1 && same; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (Math.abs(data[(y + dy) * w + x + dx] - c) > TOLERANCE) {
            same = false;
            break;
          }
        }
      }
      total++;
      if (same) flat++;
    }
  }
  return flat / total;
}

const webp = async (path, width, quality = 82) =>
  (await sharp(path).resize({ width, kernel: "nearest" }).webp({ quality }).toBuffer()).toString("base64");

const data = { frames: FRAMES, variants: variants.map(({ id, name, note }) => ({ id, name, note })), images: {}, scores: {} };
let costTotal = 0;

for (const frame of FRAMES) {
  data.images[`${frame.id}.render`] = await webp(renderPath(frame.id), 1024);
  data.scores[`${frame.id}.render`] = await flatShare(renderPath(frame.id));
  for (const variant of variants) {
    const path = drawingPath(frame.id, variant.id);
    data.images[`${frame.id}.${variant.id}`] = await webp(path, 1024);
    data.scores[`${frame.id}.${variant.id}`] = await flatShare(path);
    costTotal += JSON.parse(readFileSync(join(drawings, `${frame.id}.${variant.id}.json`), "utf8")).cost;
  }

  // One montage per frame: the render, then each variant, in rows of four.
  const cells = [renderPath(frame.id), ...variants.map((v) => drawingPath(frame.id, v.id))];
  const rows = Math.ceil(cells.length / 4);
  const composites = await Promise.all(
    cells.map(async (path, i) => ({
      input: await sharp(path).resize(THUMB).toBuffer(),
      left: (i % 4) * THUMB,
      top: Math.floor(i / 4) * THUMB,
    })),
  );
  const canvas = sharp({ create: { width: THUMB * 4, height: THUMB * rows, channels: 3, background: "#000" } }).composite(composites);
  await canvas.clone().png().toFile(join(here, "out", "montage", `${frame.id}.png`));
  await canvas.clone().resize(1500).webp({ quality: 74 }).toFile(join(imagesDir, `${frame.id}.webp`));
}

const template = readFileSync(join(here, "sheet.template.html"), "utf8");
mkdirSync(dirname(page), { recursive: true });
writeFileSync(page, template.replace("/*DATA*/null", () => JSON.stringify(data)));

for (const key of Object.keys(data.scores)) console.log(`${key}: flat share ${data.scores[key].toFixed(3)}`);
console.log(`drawings cost about $${costTotal.toFixed(2)}; page ${(readFileSync(page).length / 1024 / 1024).toFixed(1)} MB`);
