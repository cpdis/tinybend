// Builds a training set's render frames from the three frame lists: general, hard and landmark.
// Every 512 px frame is enlarged 2x for the teacher. Each frame gets a sidecar, so the water
// sentence and the checks work on it as they did in Phase 1.
//
//   node places/build-set.js render/out/perth look/out/sets/v1
//   node look/water.js look/out/sets/v1
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { CAMERA } from "../render/camera.js";
import { cropWindow } from "../render/crop.js";
import { testPlacesTouched } from "./test-places.js";

const sharp = createRequire(new URL("../render/", import.meta.url))("sharp");
const here = dirname(fileURLToPath(import.meta.url));
const TEACHER = 1024; // The size the teacher draws at.
const DARK = 40; // Mean brightness (0 to 255) below which a frame is deep ocean.
const read = (name) => JSON.parse(readFileSync(join(here, name), "utf8"));

const [renders, out] = process.argv.slice(2);
mkdirSync(out, { recursive: true });

// Hard frames first, so a quarter that is both hard and general keeps its hard label.
const frames = new Map();
const add = (id, window, source, kind) => {
  const key = `${window.x},${window.y},${window.size}`;
  if (!frames.has(key)) frames.set(key, { id, window, source, kind });
};
for (const f of read("hard-frames.json")) add(f.id, { x: f.x, y: f.y, size: f.size }, "hard", f.kind);
for (const f of read("general-frames.json")) add(`gen-g${f.group}-${f.id}`, { x: f.x, y: f.y, size: f.size }, "general", `group ${f.group}`);
// A landmark is one whole frame plus its four quarters: on the whole frame the teacher keeps the
// landmark's shape, and on a quarter it redraws the detail.
for (const f of read("landmark-frames.json")) {
  add(`lm-${f.id}`, { x: f.x, y: f.y, size: f.size }, "landmark", f.id);
  const half = f.size / 2;
  for (let q = 0; q < 4; q++) add(`lm-${f.id}-q${q}`, { x: f.x + (q % 2) * half, y: f.y + Math.floor(q / 2) * half, size: half }, "landmark", f.id);
}

const counts = {};
let dark = 0;
const manifest = [];
for (const { id, window, source, kind } of frames.values()) {
  if (testPlacesTouched(window).length) throw new Error(`${id} touches a test place`);
  const png = await cropWindow(renders, window);
  if (!png) {
    console.log(`${id}: outside the rendered area, skipped`);
    continue;
  }
  // Deep ocean renders almost black. The teacher invents stripes on it, so it stays out of training.
  if ((await sharp(png).greyscale().stats()).channels[0].mean < DARK) {
    dark++;
    continue;
  }
  await sharp(png).resize(TEACHER, TEACHER, { kernel: "lanczos3" }).png().toFile(join(out, `${id}.png`));
  writeFileSync(join(out, `${id}.json`), JSON.stringify({ id, window, camera: CAMERA, enlarged: TEACHER / window.size, source, kind }, null, 2));
  manifest.push({ id, ...window, source, kind });
  counts[source] = (counts[source] ?? 0) + 1;
}
writeFileSync(join(here, "set-v1.json"), `${JSON.stringify(manifest)}\n`);
console.log(`${manifest.length} frames:`, JSON.stringify(counts), `(${dark} deep-ocean frames left out)`);
