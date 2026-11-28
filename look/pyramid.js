// Cuts the finished map into the tile pyramid a web map viewer loads.
//
//   node look/pyramid.js <sheets-folder> <drawn-folder> <out-folder>
//
// The sheets folder is what look/sheets.js wrote. The drawn folder holds the finished drawing
// of each sheet under the same name. A viewer never loads the whole map. It loads small
// square tiles: a few at low detail when zoomed out, and only the ones on screen at full
// detail when zoomed in. Zoom MAX_ZOOM is the map at full size, cut into TILE px tiles. Each
// zoom below it is half the size, so one tile there covers four tiles of the zoom above.
// Zoom 0 is the whole map in one tile.
//
// Tiles go to <out>/<zoom>/<col>/<row>.webp, counted from the map's top-left corner. A tile
// past the map's edge is not written, and a tile on the edge is transparent there.
// <out>/tiles.json records the layout for the viewer.
import { createRequire } from "node:module";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const sharp = createRequire(new URL("../render/", import.meta.url))("sharp");

const TILE = 512;
const QUALITY = 90;
const BIG = { limitInputPixels: false };

const [sheetsFolder, drawnFolder, outFolder] = process.argv.slice(2);
const index = JSON.parse(readFileSync(join(sheetsFolder, "index.json"), "utf8"));
const perSheet = index.sheet / TILE; // Tiles along one side of a sheet.
// The pyramid is a square of TILE * 2^MAX_ZOOM px that holds the whole map, so every zoom
// halves exactly and no tile is ever a part-tile.
const MAX_ZOOM = Math.ceil(Math.log2((Math.max(index.cols, index.rows) * index.sheet) / TILE));
const path = (zoom, col, row) => join(outFolder, String(zoom), String(col), `${row}.webp`);

// 1. Full size: cut each sheet, without its margin, into tiles.
let written = new Set(); // "col,row" of the tiles written at the zoom just finished.
for (const [sheetCol, sheetRow] of index.sheets) {
  let last = null;
  let lastOpaque = false;
  const inner = { left: index.margin, top: index.margin, width: index.sheet, height: index.sheet };
  const name = `${sheetCol}_${sheetRow}`;
  const mask = await sharp(join(sheetsFolder, `${name}.mask.png`), BIG).extractChannel(0).extract(inner).raw().toBuffer();
  // The mask becomes the drawing's transparency: clear past the map's edge.
  const drawing = await sharp(join(drawnFolder, `${name}.png`), BIG).removeAlpha().extract(inner).raw().toBuffer();
  const size = { width: index.sheet, height: index.sheet };
  // sharp joins channels after it crops, whatever the order of the calls. So the sheet with
  // its transparency is made whole first, and the tiles are cropped from that.
  const joined = await sharp(drawing, { raw: { ...size, channels: 3 }, ...BIG }).joinChannel(mask, { raw: { ...size, channels: 1 } }).raw().toBuffer();
  const whole = sharp(joined, { raw: { ...size, channels: 4 }, ...BIG });
  for (let r = 0; r < perSheet; r++) {
    for (let c = 0; c < perSheet; c++) {
      // Skip a tile that is wholly past the edge. The mask is in whole shots, so its corners
      // and centre are enough to tell.
      const seen = [0, TILE / 2, TILE - 1].some((dy) => [0, TILE / 2, TILE - 1].some((dx) => mask[(r * TILE + dy) * index.sheet + c * TILE + dx]));
      if (!seen) continue;
      const [col, row] = [sheetCol * perSheet + c, sheetRow * perSheet + r];
      mkdirSync(join(outFolder, String(MAX_ZOOM), String(col)), { recursive: true });
      await whole.clone().extract({ left: c * TILE, top: r * TILE, width: TILE, height: TILE }).webp({ quality: QUALITY }).toFile(path(MAX_ZOOM, col, row));
      written.add(`${col},${row}`);
      last = path(MAX_ZOOM, col, row);
      // WebP leaves out the transparency of a tile that has none to show.
      lastOpaque = true;
      for (let y = 0; y < TILE && lastOpaque; y++) for (let x = 0; x < TILE; x++) if (mask[(r * TILE + y) * index.sheet + c * TILE + x] < 255) { lastOpaque = false; break; }
    }
  }
  // Check one tile of every sheet as it is cut. A first version wrote each "tile" as a whole
  // sheet, and nothing noticed until a file's size was looked at by hand.
  if (last) {
    const made = await sharp(last).metadata();
    if (made.width !== TILE || made.height !== TILE || made.channels !== (lastOpaque ? 3 : 4)) throw new Error(`${last} is ${made.width} x ${made.height} with ${made.channels} channels, not a ${TILE} px tile${lastOpaque ? "" : " with transparency"}`);
  }
  console.log(`zoom ${MAX_ZOOM}: sheet ${name} cut, ${written.size} tiles so far`);
}
const counts = { [MAX_ZOOM]: written.size };

// 2. Each lower zoom: join the four tiles above into one and halve it.
for (let zoom = MAX_ZOOM - 1; zoom >= 0; zoom--) {
  const parents = new Set([...written].map((key) => key.split(",").map((v) => Number(v) >> 1).join(",")));
  for (const key of parents) {
    const [col, row] = key.split(",").map(Number);
    const children = [];
    for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
      const child = path(zoom + 1, col * 2 + dx, row * 2 + dy);
      if (existsSync(child)) children.push({ input: child, left: dx * TILE, top: dy * TILE });
    }
    const joined = await sharp({ create: { width: 2 * TILE, height: 2 * TILE, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).composite(children).png({ compressionLevel: 1 }).toBuffer();
    mkdirSync(join(outFolder, String(zoom), String(col)), { recursive: true });
    await sharp(joined).resize(TILE, TILE, { kernel: "lanczos3" }).webp({ quality: QUALITY }).toFile(path(zoom, col, row));
  }
  written = parents;
  counts[zoom] = written.size;
  console.log(`zoom ${zoom}: ${written.size} tiles`);
}

// The viewer needs the layout. x and y tie tile pixels back to map pixels, for search and pins.
writeFileSync(
  join(outFolder, "tiles.json"),
  JSON.stringify({ tile: TILE, maxZoom: MAX_ZOOM, format: "webp", x: index.x, y: index.y, width: index.cols * index.sheet, height: index.rows * index.sheet, counts }),
);
console.log(`${Object.values(counts).reduce((a, b) => a + b, 0)} tiles in ${MAX_ZOOM + 1} zooms`);
