// Joins drawn areas into one picture, and their renders into one render.
//
//   node look/assemble.js <folder> <out-name> <area> <area> ...
//
// The folder holds each area's <name>.png, <name>.render.png and <name>.json, as the sampler
// wrote them. Name the areas in the order they were drawn. Each area is laid over the ones
// before it. A pinned area also has <name>.own.png, which marks the pixels it drew itself:
// only those are laid down, so the pixels it copied from a neighbour stay the neighbour's.
// Writes <out-name>.png, <out-name>.render.png and <out-name>.json to the folder.
import { createRequire } from "node:module";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const sharp = createRequire(new URL("../render/", import.meta.url))("sharp");

const [folder, outName, ...names] = process.argv.slice(2);
const areas = names.map((name) => ({ name, ...JSON.parse(readFileSync(join(folder, `${name}.json`), "utf8")) }));

// The block is the smallest rectangle that holds every area.
const x = Math.min(...areas.map((a) => a.x));
const y = Math.min(...areas.map((a) => a.y));
const width = Math.max(...areas.map((a) => a.x + a.size)) - x;
const height = Math.max(...areas.map((a) => a.y + a.size)) - y;
const blank = () => sharp({ create: { width, height, channels: 3, background: "#000" }, limitInputPixels: false });

const drawings = [];
const renders = [];
for (const area of areas) {
  const at = { left: area.x - x, top: area.y - y };
  const own = join(folder, `${area.name}.own.png`);
  let drawing = sharp(join(folder, `${area.name}.png`)).removeAlpha();
  // The own mask becomes the drawing's transparency, so only its own pixels land.
  if (existsSync(own)) drawing = drawing.joinChannel(await sharp(own).extractChannel(0).toBuffer());
  drawings.push({ input: await drawing.png().toBuffer(), ...at });
  renders.push({ input: join(folder, `${area.name}.render.png`), ...at });
}

await blank().composite(drawings).png().toFile(join(folder, `${outName}.png`));
await blank().composite(renders).png().toFile(join(folder, `${outName}.render.png`));
writeFileSync(join(folder, `${outName}.json`), JSON.stringify({ x, y, width, height, areas: names }));
console.log(`${outName}: ${width} x ${height} px at ${x}, ${y}, from ${names.length} areas`);
