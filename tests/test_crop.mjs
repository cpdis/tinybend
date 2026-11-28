// Checks that render/crop.js emptyShare counts only pixels with no geometry (depth 0), across
// shot edges and past the rendered area, so dark forest is never mistaken for a gap:
// node tests/test_crop.mjs
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { emptyShare } from "../render/crop.js";

const sharp = createRequire(new URL("../render/", import.meta.url))("sharp");
const dir = mkdtempSync(join(tmpdir(), "crop-"));
// One shot whose top 100 rows have no geometry; the rest is near depth, which looks dark.
const gap = await sharp({ create: { width: 2048, height: 100, channels: 3, background: "#000" } }).png().toBuffer();
await sharp({ create: { width: 2048, height: 2048, channels: 3, background: "#020202" } })
  .composite([{ input: gap, left: 0, top: 0 }])
  .toColourspace("grey16")
  .png()
  .toFile(join(dir, "c0_r0.depth.png"));

assert.equal(await emptyShare(dir, { x: 0, y: 0, size: 512 }), 100 / 512);
assert.equal(await emptyShare(dir, { x: 0, y: 200, size: 512 }), 0);
assert.equal(await emptyShare(dir, { x: 1792, y: 200, size: 512 }), 0.5); // Half runs into a shot that doesn't exist.
console.log("crop ok");
