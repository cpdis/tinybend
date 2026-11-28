// Cuts every landmark and test place out of the full render, as contact sheets to check by eye:
// is each landmark in its frame, and does each test place's circle cover the right ground?
//
//   node places/sheet.js render/out/perth writeup/images/training-set
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { CAMERA, project } from "../render/camera.js";
import { cropWindow } from "../render/crop.js";

const sharp = createRequire(new URL("../render/", import.meta.url))("sharp");
const here = dirname(fileURLToPath(import.meta.url));
const GROUND = -15;
const FRAME = 1024; // A landmark frame, in map pixels: 300 m across.
const TILE = 400;
const LABEL = 30;

const [renders, out] = process.argv.slice(2);
const places = JSON.parse(readFileSync(join(here, "perth.json"), "utf8"));
const label = (text) =>
  Buffer.from(`<svg width="${TILE}" height="${LABEL}" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="#14181c"/><text x="8" y="21" font-family="Helvetica" font-size="16" fill="#fff">${text.replace(/&/g, "and")}</text></svg>`);

async function sheet(items, cols, file) {
  const rows = Math.ceil(items.length / cols);
  const parts = [];
  items.forEach(({ text, image, overlay }, i) => {
    const [left, top] = [(i % cols) * TILE, Math.floor(i / cols) * (TILE + LABEL)];
    parts.push({ input: label(text), left, top }, { input: image, left, top: top + LABEL });
    if (overlay) parts.push({ input: overlay, left, top: top + LABEL });
  });
  await sharp({ create: { width: cols * TILE, height: rows * (TILE + LABEL), channels: 3, background: "#14181c" } })
    .composite(parts)
    .webp({ quality: 74 })
    .toFile(join(out, file));
}

const frames = [];
const landmarks = [];
for (const p of places.filter((q) => q.kind === "landmark")) {
  const c = project(p.lat, p.lon, GROUND);
  const window = { x: Math.round(c.x - FRAME / 2), y: Math.round(c.y - FRAME / 2), size: FRAME };
  const png = await cropWindow(renders, window);
  if (!png) {
    console.log(`${p.id}: outside the rendered area`);
    continue;
  }
  frames.push({ id: p.id, ...window });
  landmarks.push({ text: p.id, image: await sharp(png).resize(TILE, TILE).png().toBuffer() });
}
await sheet(landmarks.slice(0, 14), 7, "landmarks-1.webp");
await sheet(landmarks.slice(14), 7, "landmarks-2.webp");
writeFileSync(join(out, "..", "..", "..", "places", "landmark-frames.json"), `${JSON.stringify(frames)}\n`);

// Test places: a view 2.4 radii wide, with the no-training circle drawn as the ellipse the camera sees.
const tests = [];
const squash = Math.sin((CAMERA.tiltDeg * Math.PI) / 180);
for (const p of places.filter((q) => q.kind === "test")) {
  const c = project(p.lat, p.lon, GROUND);
  const size = Math.round((2.4 * p.radius) / CAMERA.metresPerPixel);
  const png = await cropWindow(renders, { x: Math.round(c.x - size / 2), y: Math.round(c.y - size / 2), size }, { allowGaps: true });
  const rx = (p.radius / CAMERA.metresPerPixel) * (TILE / size);
  const overlay = Buffer.from(`<svg width="${TILE}" height="${TILE}" xmlns="http://www.w3.org/2000/svg"><ellipse cx="${TILE / 2}" cy="${TILE / 2}" rx="${rx}" ry="${rx * squash}" fill="none" stroke="#ff3b6b" stroke-width="3"/></svg>`);
  tests.push({ text: `${p.id}, ${p.radius} m`, image: await sharp(png).resize(TILE, TILE).png().toBuffer(), overlay });
}
await sheet(tests, 4, "test-places.webp");
console.log(`${landmarks.length} landmarks, ${tests.length} test places`);
