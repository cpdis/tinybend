// Checks drawings against their renders: how much green (lawn and foliage) each kept,
// whether it shows the same scene, and whether its outlines sit where the render's do. Also writes a measured green sentence for prompts.
//
//   node look/check.js sentence render/out/phase1      writes <frame>.ground.json, a measured sentence for the prompt
//   node look/check.js check render/out/phase1 look/out/i-run1 [more folders]   prints one row per drawing
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createRequire } from "node:module";

// sharp is installed once, with the renderer.
const sharp = createRequire(new URL("../render/", import.meta.url))("sharp");

const GRID = 256; // Both images are compared on this grid, so a shape that moved a few pixels still matches.
const KEPT_FLOOR = 0.6; // A drawing that keeps less than this share of the render's green fails the check.
const GAINED_LIMIT = 0.12; // A drawing that turns more than this share of the frame from dry ground to green fails.
const MIN_GREEN = 0.02; // Below this share of green in the render, the kept share is noise and isn't judged.
const MATCH_GRID = 64; // Layout is compared on a coarse grid, so restyling doesn't count against a drawing.
const FLAT_SPREAD = 5; // Brightness spread (0 to 255) below which a render has no layout to match.
const MATCH_FLOOR = 0.3; // Below this the drawing shows a different scene. A heavy recolour scores 0.4 to 0.6, and a partial paste can pass.

/** True when a colour reads as green: hue between yellow-green and mid green, which leaves out teal water, and not grey or near black. */
export function isGreen(r, g, b) {
  const hue = hueOf(r, g, b);
  return hue !== null && hue >= 62 && hue <= 140;
}

/** True when a colour reads as dry ground: tan, sand, ochre or brown. */
function isDry(r, g, b) {
  const hue = hueOf(r, g, b);
  return hue !== null && hue >= 15 && hue < 55;
}

/** Hue in degrees, or null for a colour too grey or too dark to have one. */
function hueOf(r, g, b) {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max < 40 || max - min < 0.15 * max) return null;
  let hue;
  if (max === r) hue = ((g - b) / (max - min)) % 6;
  else if (max === g) hue = (b - r) / (max - min) + 2;
  else hue = (r - g) / (max - min) + 4;
  return (hue * 60 + 360) % 360;
}

async function pixels(path) {
  // A box filter averages each cell, which also removes JPEG noise.
  return sharp(path).removeAlpha().resize(GRID, GRID, { kernel: "linear" }).raw().toBuffer();
}

const dryMask = (data) => Array.from({ length: GRID * GRID }, (_, i) => isDry(data[i * 3], data[i * 3 + 1], data[i * 3 + 2]));
const greenMask = (data) => Array.from({ length: GRID * GRID }, (_, i) => isGreen(data[i * 3], data[i * 3 + 1], data[i * 3 + 2]));
const hex = (rgb) => `#${rgb.map((v) => Math.round(v).toString(16).padStart(2, "0")).join("")}`;

/** The median colour of the lighter and darker halves of the render's green. */
function greenTones(data, mask) {
  const greens = [];
  mask.forEach((on, i) => on && greens.push([data[i * 3], data[i * 3 + 1], data[i * 3 + 2]]));
  greens.sort((a, b) => a[1] - b[1]);
  return [greens[Math.floor(greens.length * 0.25)], greens[Math.floor(greens.length * 0.75)]];
}

/** Correlation of coarse brightness between two images: near 1 for a redraw, near 0 for other content. */
async function layoutMatch(a, b) {
  const grey = (path) => sharp(path).removeAlpha().greyscale().resize(MATCH_GRID, MATCH_GRID, { kernel: "linear" }).raw().toBuffer();
  const [x, y] = [await grey(a), await grey(b)];
  const mean = (v) => v.reduce((sum, n) => sum + n, 0) / v.length;
  const [mx, my] = [mean(x), mean(y)];
  // A flat frame, such as open water, has no layout to compare: any tiny difference would decide
  // the score. The first full run rejected about ten sound water drawings this way.
  const spread = Math.sqrt(x.reduce((sum, n) => sum + (n - mx) ** 2, 0) / x.length);
  if (spread < FLAT_SPREAD) return 1;
  let xy = 0;
  let xx = 0;
  let yy = 0;
  for (let i = 0; i < x.length; i++) {
    xy += (x[i] - mx) * (y[i] - my);
    xx += (x[i] - mx) ** 2;
    yy += (y[i] - my) ** 2;
  }
  return xy / Math.sqrt(xx * yy);
}

const CELL = 32; // The outline test splits the 256 grid into 8 x 8 cells of this size.
const QUIET = 3; // Mean edge strength below which a cell of the render counts as plain, such as open water.
const BUSY = 10; // Mean edge strength above which a cell of the drawing counts as detailed.
const CELL_MATCH = 0.1; // Edge-map correlation below which a detailed cell shows other shapes than the render.
const CELL_LIMIT = 5; // Faulty cells allowed, of 64. On 32 judged quarters, bad drawings had 7 to 33 and good ones 0 to 3.

/** Edge strength per pixel, lightly blurred so an outline that moved a pixel or two still lines up. */
async function edgeMap(path) {
  const grey = await sharp(path).removeAlpha().greyscale().resize(GRID, GRID, { kernel: "linear" }).raw().toBuffer();
  const sharpEdges = new Float32Array(GRID * GRID);
  for (let y = 1; y < GRID - 1; y++) {
    for (let x = 1; x < GRID - 1; x++) {
      const i = y * GRID + x;
      sharpEdges[i] = Math.abs(grey[i + 1] - grey[i - 1]) + Math.abs(grey[i + GRID] - grey[i - GRID]);
    }
  }
  const blurred = new Float32Array(GRID * GRID);
  for (let y = 2; y < GRID - 2; y++) {
    for (let x = 2; x < GRID - 2; x++) {
      let sum = 0;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) sum += sharpEdges[(y + dy) * GRID + x + dx];
      blurred[y * GRID + x] = sum / 25;
    }
  }
  return blurred;
}

/**
 * Counts cells where the drawing's outlines disagree with the render's. Edges, not brightness,
 * so a lawn drawn darker than the road beside it doesn't count.
 * - invented: the render is plain there and the drawing is detailed, such as houses on water.
 * - erased: the render is detailed there and the drawing is plain.
 * - mismatch: both are detailed, with different shapes.
 */
async function outlineFaults(renderPath, drawingPath) {
  const [a, b] = [await edgeMap(renderPath), await edgeMap(drawingPath)];
  const faults = { invented: 0, erased: 0, mismatch: 0 };
  for (let cy = 0; cy < GRID; cy += CELL) {
    for (let cx = 0; cx < GRID; cx += CELL) {
      let [sa, sb, saa, sbb, sab] = [0, 0, 0, 0, 0];
      for (let y = cy; y < cy + CELL; y++) {
        for (let x = cx; x < cx + CELL; x++) {
          const i = y * GRID + x;
          sa += a[i];
          sb += b[i];
          saa += a[i] ** 2;
          sbb += b[i] ** 2;
          sab += a[i] * b[i];
        }
      }
      const n = CELL * CELL;
      const [ma, mb] = [sa / n, sb / n];
      const [va, vb] = [saa / n - ma * ma, sbb / n - mb * mb];
      if (ma < QUIET && mb > BUSY) faults.invented++;
      else if (ma > BUSY && mb < QUIET) faults.erased++;
      else if (ma >= QUIET && va > 0.5 && vb > 0.5 && (sab / n - ma * mb) / Math.sqrt(va * vb) < CELL_MATCH) faults.mismatch++;
    }
  }
  return faults;
}

const frames = (dir) =>
  readdirSync(dir)
    .filter((f) => f.endsWith(".water.json"))
    .map((f) => f.replace(".water.json", ""));

const [mode, renders, ...folders] = process.argv.slice(2);

if (mode === "sentence") {
  for (const frame of frames(renders)) {
    const data = await pixels(join(renders, `${frame}.png`));
    const mask = greenMask(data);
    const share = mask.filter(Boolean).length / mask.length;
    const [dark, light] = greenTones(data, mask);
    const sentence =
      share < MIN_GREEN
        ? "Green: almost none in this image, so use almost none."
        : `Green: about ${Math.round(share * 100)}% of the image is green, from ${hex(dark)} to ${hex(light)}. Every surface that is green in the image is green in the drawing, at the same size and in the same place.`;
    writeFileSync(join(renders, `${frame}.ground.json`), JSON.stringify({ share, sentence }, null, 2));
    console.log(`${frame}: ${sentence}`);
  }
}

if (mode === "check") {
  console.log("drawing\trender green\tdrawing green\tkept\tgained\tlayout\tinvented\terased\tmismatch\tverdict");
  for (const folder of folders) {
    for (const file of readdirSync(folder).filter((f) => /\.(jpeg|png)$/.test(f) && !f.includes("2k."))) {
      const frame = file.split(".")[0];
      const renderPixels = await pixels(join(renders, `${frame}.png`));
      const render = greenMask(renderPixels);
      const dry = dryMask(renderPixels);
      const drawing = greenMask(await pixels(join(folder, file)));
      const renderGreen = render.filter(Boolean).length;
      const kept = render.filter((on, i) => on && drawing[i]).length / Math.max(renderGreen, 1);
      // Dry ground painted as lawn: the share of the frame that is tan or brown in the render and
      // green in the drawing. Grey-green bush drawn as green is fine, and doesn't count.
      const gained = drawing.filter((on, i) => on && dry[i]).length / render.length;
      const share = (n) => (n / render.length).toFixed(2);
      const match = await layoutMatch(join(renders, `${frame}.png`), join(folder, file));
      const faults = [];
      if (renderGreen / render.length >= MIN_GREEN && kept < KEPT_FLOOR) faults.push("lost green");
      if (gained > GAINED_LIMIT) faults.push("gained green");
      if (match < MATCH_FLOOR) faults.push("different scene");
      const outline = await outlineFaults(join(renders, `${frame}.png`), join(folder, file));
      if (outline.invented + outline.erased + outline.mismatch >= CELL_LIMIT) faults.push("outlines differ");
      console.log(`${join(folder, file)}\t${share(renderGreen)}\t${share(drawing.filter(Boolean).length)}\t${kept.toFixed(2)}\t${gained.toFixed(2)}\t${match.toFixed(2)}\t${outline.invented}\t${outline.erased}\t${outline.mismatch}\t${faults.join(", ") || "ok"}`);
    }
  }
}
