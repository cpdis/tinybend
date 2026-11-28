// Cuts each render into four quarters and enlarges each 2x, ready for the teacher.
// A quarter keeps its own sidecar and its own cut of the depth pass (not enlarged: one value per
// map pixel), so the water sentence and the checks work on it as on a frame.
//
//   node look/quarters.js render/out/phase1 look/out/quarters-in
//   node look/water.js look/out/quarters-in
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createRequire } from "node:module";

// sharp is installed once, with the renderer.
const sharp = createRequire(new URL("../render/", import.meta.url))("sharp");

const ENLARGE = 2; // The teacher redraws at this zoom and copies the photo less. See the 2026-11-10 journal entry.

const [renders, out] = process.argv.slice(2);
mkdirSync(out, { recursive: true });

const shots = readdirSync(renders).filter((f) => f.endsWith(".json") && !/\.(water|ground)\.json$/.test(f));
for (const file of shots) {
  const meta = JSON.parse(readFileSync(join(renders, file), "utf8"));
  const half = meta.window.size / 2;
  for (let q = 0; q < 4; q++) {
    const [left, top] = [(q % 2) * half, Math.floor(q / 2) * half];
    const id = `${meta.id}-q${q}`;
    await sharp(join(renders, `${meta.id}.png`))
      .extract({ left, top, width: half, height: half })
      .resize(half * ENLARGE, half * ENLARGE, { kernel: "lanczos3" })
      .png()
      .toFile(join(out, `${id}.png`));
    const depth = join(renders, `${meta.id}.depth.png`);
    if (existsSync(depth)) {
      await sharp(depth).extract({ left, top, width: half, height: half }).toColourspace("grey16").png().toFile(join(out, `${id}.depth.png`));
    }
    // The window stays in map pixels: the image is larger than the window by ENLARGE.
    const window = { x: meta.window.x + left, y: meta.window.y + top, size: half };
    writeFileSync(join(out, `${id}.json`), JSON.stringify({ ...meta, id, window, enlarged: ENLARGE, parent: meta.id }, null, 2));
  }
  console.log(`${meta.id}: 4 quarters`);
}
