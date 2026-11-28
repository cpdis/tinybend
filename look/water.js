// Writes the one generated sentence per frame on where open water is and isn't,
// from OpenStreetMap, through the map's camera. Nothing here names a place.
//
//   node look/water.js render/out/phase1
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createRequire } from "node:module";
import { depthAtHeight, unproject } from "../render/camera.js";
import { WATER_LEVEL, waterLookup } from "./osm-water.js";

// sharp is installed once, with the renderer.
const sharp = createRequire(new URL("../render/", import.meta.url))("sharp");

const GRID = 48; // Sample points per side of a frame.
const EVEN_SPREAD = 12; // Luminance between the quartiles below which water counts as even. Quartiles ignore jetties and shore.

const REGIONS = [
  ["upper left", "top", "upper right"],
  ["left", "middle", "right"],
  ["lower left", "bottom", "lower right"],
];

const hex = ([r, g, b]) => `#${[r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("")}`;

/** Turn the render's colours on water into a sentence: one tone if even, its real range if not. */
function colourSentence(samples) {
  const byLight = samples
    .map((rgb) => ({ rgb, light: 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2] }))
    .sort((a, b) => a.light - b.light);
  const at = (q) => byLight[Math.floor(q * (byLight.length - 1))];
  const [low, mid, high] = [at(0.1), at(0.5), at(0.9)];
  const spread = Math.round(at(0.75).light - at(0.25).light);
  const sentence =
    spread < EVEN_SPREAD
      ? `Its colour is even, close to ${hex(mid.rgb)}: paint all of it in that one flat tone, with nothing on it.`
      : `Its colour really does vary, from ${hex(low.rgb)} through ${hex(mid.rgb)} to ${hex(high.rgb)}: keep those colours, as flat stepped shapes, exactly where the image has them.`;
  return { spread, sentence };
}

/** Sample the frame at water level and describe what fraction is water, where, and its colour. */
async function describe(isWater, window, camera, renderPath) {
  const { data, info } = await sharp(renderPath).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const samples = [];
  const cells = Array.from({ length: 3 }, () => [0, 0, 0]);
  let total = 0;
  for (let j = 0; j < GRID; j++) {
    for (let i = 0; i < GRID; i++) {
      const x = window.x + ((i + 0.5) / GRID) * window.size;
      const y = window.y + ((j + 0.5) / GRID) * window.size;
      const point = unproject(x, y, depthAtHeight(x, y, WATER_LEVEL, camera), camera);
      if (isWater(point.lat, point.lon)) {
        total++;
        cells[Math.floor((j * 3) / GRID)][Math.floor((i * 3) / GRID)]++;
        // An enlarged quarter has more image pixels than map pixels, so scale the sample point.
        const scale = info.width / window.size;
        const offset = (Math.floor((y - window.y) * scale) * info.width + Math.floor((x - window.x) * scale)) * info.channels;
        samples.push([data[offset], data[offset + 1], data[offset + 2]]);
      }
    }
  }
  const share = total / GRID ** 2;
  if (share < 0.005) {
    return {
      share,
      sentence: "Open water: none. No surface in this frame is a river, lake or sea, so give nothing the open-water colours.",
    };
  }
  const full = (GRID / 3) ** 2;
  const wet = [];
  const dry = [];
  cells.forEach((row, j) => row.forEach((c, i) => (c / full > 0.5 ? wet : dry).push(REGIONS[j][i])));
  const where = wet.length ? `mainly the ${wet.join(", ")}` : "only small parts of the frame";
  const rest = dry.length ? `The ${dry.join(", ")} ${dry.length > 1 ? "are" : "is"} mostly land.` : "";
  const colour = colourSentence(samples);
  return {
    share,
    colourSpread: colour.spread,
    sentence: `Open water: about ${Math.round(share * 100)}% of this frame, ${where}. ${rest} Use the open-water colours only where the render shows water. ${colour.sentence}`.replace(/\s+/g, " "),
  };
}

const dir = process.argv[2];
const isWater = await waterLookup();
for (const file of readdirSync(dir).filter((f) => f.endsWith(".json") && !f.endsWith(".water.json"))) {
  const meta = JSON.parse(readFileSync(join(dir, file), "utf8"));
  const result = await describe(isWater, meta.window, meta.camera, join(dir, `${meta.id}.png`));
  writeFileSync(join(dir, `${meta.id}.water.json`), JSON.stringify(result, null, 2));
  console.log(`${meta.id}: ${result.sentence}`);
}
