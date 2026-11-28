// Cuts the whole map into sheets. The whole map is too large for one picture, so every later
// step (water repaint, tile pyramid) works sheet by sheet.
//
//   node look/sheets.js <areas-folder> <order.json> <out-folder> [col,row ...]
//   SHOTS=render/out/perth,render/out/greater-even node look/sheets.js ...
//
// SHOTS lists the folders of shots, first match wins. The default is the first map's render.
// SKIP lists shots to leave out, such as c-5_r33, for a shot Google filled with no-data colour.
//
// The areas folder holds each area's <name>.png, <name>.json and, for a pinned area,
// <name>.own.png, as the sampler wrote them. order.json lists the areas in the order they were
// drawn. Each area is laid over the ones before it, and a pinned area lays down only the
// pixels it drew itself. That is the same rule as look/assemble.js.
//
// A sheet is SHEET px wide, plus MARGIN px of its neighbours on every side. The water repaint
// needs the margin, so that its blurs see across the sheet's edge. Each sheet gets:
//   <col>_<row>.png         the drawing
//   <col>_<row>.render.png  the render, joined from the shots
//   <col>_<row>.mask.png    white where the map has a render, black past the map's edge
// index.json records the layout. With col,row arguments, only those sheets are cut.
import { createRequire } from "node:module";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const sharp = createRequire(new URL("../render/", import.meta.url))("sharp");

const SHEET = 8192;
const MARGIN = 256;
const SHOT = 2048; // Shot c{col}_r{row} covers map x from col * SHOT. Same as modal_app/plan.py.
const SHOTS = process.env.SHOTS ? process.env.SHOTS.split(",") : [fileURLToPath(new URL("../render/out/perth/", import.meta.url))];
const SKIP = new Set((process.env.SKIP || "").split(",").filter(Boolean));
/** The file of shot c{c}_r{r}, from the first folder that has it, or null. */
const shotFile = (c, r) => (SKIP.has(`c${c}_r${r}`) ? null : SHOTS.map((folder) => join(folder, `c${c}_r${r}.png`)).find(existsSync) ?? null);
const BIG = { limitInputPixels: false };

const [areasFolder, orderPath, outFolder, ...only] = process.argv.slice(2);
const areas = JSON.parse(readFileSync(orderPath, "utf8")).map((name) => ({ name, ...JSON.parse(readFileSync(join(areasFolder, `${name}.json`), "utf8")) }));
mkdirSync(outFolder, { recursive: true });

// The sheet grid starts at the map's top-left corner.
const x0 = Math.min(...areas.map((a) => a.x));
const y0 = Math.min(...areas.map((a) => a.y));
const cols = Math.ceil((Math.max(...areas.map((a) => a.x + a.size)) - x0) / SHEET);
const rows = Math.ceil((Math.max(...areas.map((a) => a.y + a.size)) - y0) / SHEET);

/** The part of the square at (x, y) that falls in the box, or null. In map pixels. */
function overlap(box, x, y, size) {
  const [left, top, right, bottom] = [Math.max(box.x, x), Math.max(box.y, y), Math.min(box.x + box.size, x + size), Math.min(box.y + box.size, y + size)];
  return left < right && top < bottom ? { left, top, width: right - left, height: bottom - top } : null;
}

const sheets = [];
for (let row = 0; row < rows; row++) {
  for (let col = 0; col < cols; col++) {
    const box = { x: x0 + col * SHEET - MARGIN, y: y0 + row * SHEET - MARGIN, size: SHEET + 2 * MARGIN };
    const blank = (channels) => sharp({ create: { width: box.size, height: box.size, channels, background: "#000" }, ...BIG });

    // The render and the mask come from the shots, so they stop exactly at the map's edge.
    const renders = [];
    const marks = [];
    for (let r = Math.floor(box.y / SHOT); r * SHOT < box.y + box.size; r++) {
      for (let c = Math.floor(box.x / SHOT); c * SHOT < box.x + box.size; c++) {
        const shot = shotFile(c, r);
        const part = overlap(box, c * SHOT, r * SHOT, SHOT);
        if (!part || !shot) continue;
        const at = { left: part.left - box.x, top: part.top - box.y };
        const cut = { left: part.left - c * SHOT, top: part.top - r * SHOT, width: part.width, height: part.height };
        renders.push({ input: await sharp(shot).removeAlpha().extract(cut).png({ compressionLevel: 1 }).toBuffer(), ...at });
        marks.push({ input: { create: { width: part.width, height: part.height, channels: 3, background: "#fff" } }, ...at });
      }
    }
    if (!renders.length) continue; // Past the map's edge: no sheet.
    sheets.push([col, row]);
    if (only.length && !only.includes(`${col},${row}`)) continue;

    const drawings = [];
    for (const area of areas) {
      const part = overlap(box, area.x, area.y, area.size);
      if (!part) continue;
      const cut = { left: part.left - area.x, top: part.top - area.y, width: part.width, height: part.height };
      const own = join(areasFolder, `${area.name}.own.png`);
      let drawing = sharp(join(areasFolder, `${area.name}.png`), BIG).removeAlpha().extract(cut);
      // The own mask becomes the drawing's transparency, so only its own pixels land.
      if (existsSync(own)) drawing = drawing.joinChannel(await sharp(own, BIG).extractChannel(0).extract(cut).toBuffer());
      drawings.push({ input: await drawing.png({ compressionLevel: 1 }).toBuffer(), left: part.left - box.x, top: part.top - box.y });
    }

    const name = join(outFolder, `${col}_${row}`);
    await blank(3).composite(drawings).png({ compressionLevel: 3 }).toFile(`${name}.png`);
    await blank(3).composite(renders).png({ compressionLevel: 3 }).toFile(`${name}.render.png`);
    await blank(3).composite(marks).extractChannel(0).png().toFile(`${name}.mask.png`);
    console.log(`${col}_${row}: ${drawings.length} areas, ${renders.length} shots`);
  }
}

writeFileSync(join(outFolder, "index.json"), JSON.stringify({ x: x0, y: y0, sheet: SHEET, margin: MARGIN, cols, rows, sheets }));
console.log(`${sheets.length} sheets of ${SHEET} px in a ${cols} x ${rows} grid from ${x0}, ${y0}`);
