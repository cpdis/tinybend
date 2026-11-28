// Turns checked teacher pairs into the folders a LoRA trainer reads: the render to redraw
// ("control"), the drawing to learn ("target"), and one caption, with matching file names.
// Also cuts the held-out frames that every training run is sampled on.
//
//   node look/trainset.js look/out/sets/v1 look/out/pairs/v1 look/out/train/v1
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { groundProjector } from "../render/dem.js";
import { cropWindow } from "../render/crop.js";
import { TEACHER_VARIANT } from "./prompts.js";

const sharp = createRequire(new URL("../render/", import.meta.url))("sharp");
const here = dirname(fileURLToPath(import.meta.url));
const places = (name) => JSON.parse(readFileSync(join(here, "..", "places", name), "utf8"));

// One fixed caption for every pair. The made-up token is what the LoRA attaches the style to.
export const CAPTION = "redraw the image as <isometric bend pixel art>";
const BORDER = 2; // Pixels of red around each render, so the model can tell input from output.
const groundAt = await groundProjector();
const SAMPLE = 1024; // Size of a held-out sample frame, in map pixels.

/** The render at map scale, with its red border painted over its outermost pixels. */
async function control(png, size) {
  const edge = Buffer.from(
    `<svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg"><rect x="${BORDER / 2}" y="${BORDER / 2}" width="${size - BORDER}" height="${size - BORDER}" fill="none" stroke="#ff0000" stroke-width="${BORDER}"/></svg>`,
  );
  return sharp(await sharp(png).resize(size, size, { kernel: "lanczos3" }).png().toBuffer()).composite([{ input: edge }]).png();
}

const [renders, pairs, out] = process.argv.slice(2);
for (const folder of ["target", "control", "samples"]) mkdirSync(join(out, folder), { recursive: true });

// Training pairs: every frame of the set that passed the checks, at map scale.
// A quarter was drawn at 2x, so its drawing is shrunk back to 512 px here.
const rejected = new Set(places("set-v1-rejected.json").rejected);
let count = 0;
for (const frame of places("set-v1.json")) {
  if (rejected.has(frame.id)) continue;
  await (await control(join(renders, `${frame.id}.png`), frame.size)).toFile(join(out, "control", `${frame.id}.png`));
  await sharp(join(pairs, `${frame.id}.${TEACHER_VARIANT}.jpeg`)).resize(frame.size, frame.size, { kernel: "lanczos3" }).png().toFile(join(out, "target", `${frame.id}.png`));
  writeFileSync(join(out, "target", `${frame.id}.txt`), CAPTION);
  count++;
}

// Held-out samples: the five test places, which no training frame touches, and two landmarks
// for comparison with ground the model has seen. Each run draws these at every checkpoint.
const all = places("bend.json");
const samples = [...all.filter((p) => p.kind === "test"), ...all.filter((p) => ["mirror-pond", "west-village"].includes(p.id))];
for (const p of samples) {
  const c = groundAt(p.lat, p.lon);
  const png = await cropWindow("render/out/bend", { x: Math.round(c.x - SAMPLE / 2), y: Math.round(c.y - SAMPLE / 2), size: SAMPLE });
  await (await control(png, SAMPLE)).toFile(join(out, "samples", `${p.kind}-${p.id}.png`));
}
console.log(`${count} training pairs, ${samples.length} sample frames`);
