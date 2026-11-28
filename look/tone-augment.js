// Makes a training set that teaches the model to ignore tone patches in the render.
//
//   node look/tone-augment.js look/out/train/v1 look/out/train/v1-tone
//
// Google's photos were taken on different days. Far from the city the render is a patchwork:
// one region dark and blue, the next pale and hazy, with a straight edge between. The model
// follows the render, so the drawing showed the patches too.
//
// The new set holds every pair of the old set twice: once as it is, and once with a made-up
// tone patch laid over part of the render. The drawing side is never changed. So the model
// sees the same drawing for a clean render and a patched one, and learns that the patch
// means nothing. No new teacher drawings are needed.
import { createRequire } from "node:module";
import { copyFileSync, mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";

const sharp = createRequire(new URL("../render/", import.meta.url))("sharp");

const [from, to] = process.argv.slice(2);
for (const folder of ["control", "target", "samples"]) mkdirSync(join(to, folder), { recursive: true });

/** A repeatable random number source, so the set can be made again exactly. */
function random(seed) {
  let state = [...seed].reduce((sum, ch) => (sum * 31 + ch.charCodeAt(0)) >>> 0, 7) || 1;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return state / 2 ** 32;
  };
}

// The kinds of patch seen in the real render. Each gives a pixel's new colour from its old one.
const TONES = [
  // Dark and blue, as over the forest east of the city.
  (r, g, b, k) => [r * (0.45 + 0.2 * k), g * (0.5 + 0.2 * k), b * (0.7 + 0.2 * k) + 8],
  // Pale haze: colours pulled toward a light grey-green, contrast lost.
  (r, g, b, k) => { const a = 0.3 + 0.3 * k; return [r + (176 - r) * a, g + (184 - g) * a, b + (170 - b) * a]; },
  // Warm and dry.
  (r, g, b, k) => [r * (1.08 + 0.12 * k) + 6, g * (1.0 + 0.05 * k), b * (0.8 - 0.1 * k)],
  // Plain darker or lighter.
  (r, g, b, k) => { const f = k < 0.5 ? 0.6 + 0.3 * k : 1.05 + 0.3 * (k - 0.5); return [r * f, g * f, b * f]; },
];

async function patched(file) {
  const next = random(file);
  const { data, info } = await sharp(join(from, "control", file)).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width, height } = info;
  // The patch is one side of a straight line, like the edges between Google's photo runs.
  // One time in five it covers the whole picture: an area deep inside a patch has no edge.
  const whole = next() < 0.2;
  const angle = next() * Math.PI * 2;
  const [nx, ny] = [Math.cos(angle), Math.sin(angle)];
  const offset = (next() - 0.5) * 0.5 * width;
  const soft = next() < 0.5 ? 0.5 : 1 + next() * 5; // Pixels over which the edge fades.
  const tone = TONES[Math.floor(next() * TONES.length)];
  const strength = next();
  const out = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 3;
      const side = (x - width / 2) * nx + (y - height / 2) * ny - offset;
      const share = whole ? 1 : Math.min(1, Math.max(0, side / soft + 0.5));
      const changed = tone(data[i], data[i + 1], data[i + 2], strength);
      for (let c = 0; c < 3; c++) out[i + c] = Math.min(255, Math.max(0, Math.round(data[i + c] * (1 - share) + changed[c] * share)));
    }
  }
  return sharp(out, { raw: { width, height, channels: 3 } }).png();
}

const files = readdirSync(join(from, "control")).filter((f) => f.endsWith(".png"));
for (const file of files) {
  const [name, caption] = [file.replace(/\.png$/, ""), file.replace(/\.png$/, ".txt")];
  // The pair as it is.
  for (const [folder, f] of [["control", file], ["target", file], ["target", caption]]) copyFileSync(join(from, folder, f), join(to, folder, f));
  // The pair again, with a tone patch on the render side only.
  await (await patched(file)).toFile(join(to, "control", `${name}-tone.png`));
  copyFileSync(join(from, "target", file), join(to, "target", `${name}-tone.png`));
  copyFileSync(join(from, "target", caption), join(to, "target", `${name}-tone.txt`));
}
for (const file of readdirSync(join(from, "samples"))) copyFileSync(join(from, "samples", file), join(to, "samples", file));
console.log(`${files.length} pairs in, ${files.length * 2} pairs out: ${to}`);
