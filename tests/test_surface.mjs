// Checks that look/surface.js reads a 16-bit depth PNG as written by render/shoot.js and puts
// pixels on the ground where the DEM does: node tests/test_surface.mjs
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { CAMERA } from "../render/camera.js";
import { loadDem } from "../render/dem.js";
import { groundUnder } from "../render/grid.js";
import { shotSurface } from "../look/surface.js";

const sharp = createRequire(new URL("../render/", import.meta.url))("sharp");
const frame = JSON.parse(readFileSync(new URL("../render/frames/phase1.json", import.meta.url), "utf8"))[0];
const dem = await loadDem();
const N = 64; // A small window: the encoding is what's under test, not the size.
const [x0, y0] = [frame.x, frame.y];
const { near, far } = frame;

// Encode the DEM's own depth at every pixel exactly as shoot.js and page.js do.
const values = new Uint16Array(N * N);
for (let j = 0; j < N; j++) {
  for (let i = 0; i < N; i++) {
    const g = groundUnder(x0 + i + 0.5, y0 + j + 0.5, dem);
    values[j * N + i] = Math.round(Math.min(1, Math.max(0, (g.depth - near) / (far - near))) * 65534) + 1;
  }
}
const dir = mkdtempSync(join(tmpdir(), "surface-"));
const id = "test__x0_y0";
await sharp(new Uint16Array(values.buffer), { raw: { width: N, height: N, channels: 1 } })
  .toColourspace("grey16")
  .png()
  .toFile(join(dir, `${id}.depth.png`));

const meta = { id, camera: CAMERA, window: { x: x0, y: y0, size: N }, depth: { near, far } };
const surface = await shotSurface(dir, meta);
assert.equal(surface.source, "depth");
let worst = 0;
for (const [i, j] of [[0, 0], [31, 17], [63, 63], [10, 50]]) {
  const p = surface.at(x0 + i + 0.5, y0 + j + 0.5);
  const g = groundUnder(x0 + i + 0.5, y0 + j + 0.5, dem);
  const metres = Math.hypot((p.lat - g.lat) * 111_132, (p.lon - g.lon) * 111_132 * Math.cos((g.lat * Math.PI) / 180), p.height - g.height);
  worst = Math.max(worst, metres);
}
// One 16-bit step is (far - near) / 65534, about 1.5 cm on a 1 km range.
assert.ok(worst < 0.5, `depth-pass ground is ${worst.toFixed(2)} m from the DEM's`);
console.log(`surface: ok (worst ${worst.toFixed(3)} m)`);
