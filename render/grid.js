// Lays the shot grid over the whole map area and writes it as a frames file for shoot.js.
// Every shot is a whole number of shots from pixel (0, 0), so neighbours meet with no gap or overlap.
//
//   node render/grid.js [--size 2048] [--out render/frames/perth.json] [--svg writeup/images/full-render/grid.svg]
//   node render/grid.js --area greater --skip render/frames/perth.json --out render/frames/greater.json
//
// --area names one of AREAS. --skip names a frames file whose shots are left out, so a larger
// map adds only the shots it does not have yet.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { project, unproject, depthAtHeight } from "./camera.js";

// The map's edges, in degrees: Fremantle in the south to Scarborough in the north, a strip of
// ocean in the west to Burswood in the east. About 20 km by 17 km. See PLAN.md, "Area".
export const AREA = { south: -32.07, north: -31.885, west: 115.735, east: 115.91 };
const box = (a) => [[a.north, a.west], [a.north, a.east], [a.south, a.east], [a.south, a.west]];
// Each area is a list of outlines, and each outline is a list of [lat, lon] corners.
// "greater" runs from Mindarie in the north to Henderson in the south, and east past John
// Forrest National Park. Its west side follows the coast about 1.4 km out to sea, so the
// sea is not rendered for nothing. Rottnest Island is a second outline.
const AREAS = {
  perth: [box(AREA)],
  greater: [
    [
      [-31.675, 115.68], [-31.675, 116.13], [-32.19, 116.13], [-32.19, 115.75], [-32.15, 115.747], [-32.1, 115.742],
      [-32.055, 115.725], [-32.0, 115.735], [-31.95, 115.738], [-31.89, 115.737], [-31.82, 115.72], [-31.75, 115.71],
    ],
    box({ south: -32.04, north: -31.98, west: 115.44, east: 115.57 }),
  ],
};
// Typical ground height above the WGS84 ellipsoid, in metres. Sea level here is about -31,
// and most of the area sits 0 to 40 m above the sea. It only centres each shot's depth range.
export const GROUND = -15;

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

const size = Number(arg("--size", 2048));
const out = arg("--out", "render/frames/perth.json");
const svgPath = arg("--svg", null);
const outlines = AREAS[arg("--area", "perth")];
const skipPath = arg("--skip", null);
const skip = new Set(skipPath ? JSON.parse(readFileSync(skipPath, "utf8")).map((f) => f.id) : []);

/** True when the point is inside the outline: a ray from it crosses the edge an odd number of times. */
function inOutline(lat, lon, outline) {
  let inside = false;
  for (let i = 0, j = outline.length - 1; i < outline.length; j = i++) {
    const [[latA, lonA], [latB, lonB]] = [outline[i], outline[j]];
    if (latA > lat !== latB > lat && lon < ((lonB - lonA) * (lat - latA)) / (latB - latA) + lonA) inside = !inside;
  }
  return inside;
}

/** True when a pixel's ground point lies inside the area. */
function inArea(x, y) {
  const p = unproject(x, y, depthAtHeight(x, y, GROUND));
  return outlines.some((outline) => inOutline(p.lat, p.lon, outline));
}

// The outlines' corners in pixel space. The camera is turned 15 degrees, so a box is tilted there.
const shapes = outlines.map((outline) => outline.map(([lat, lon]) => project(lat, lon, GROUND)));
const corners = shapes.flat();
const cols = corners.map((c) => Math.floor(c.x / size));
const rows = corners.map((c) => Math.floor(c.y / size));

// Keep a shot when any point of a 5 x 5 lattice across it is inside the area.
const frames = [];
for (let row = Math.min(...rows); row <= Math.max(...rows); row++) {
  for (let col = Math.min(...cols); col <= Math.max(...cols); col++) {
    let inside = false;
    for (let j = 0; j <= 4 && !inside; j++) {
      for (let i = 0; i <= 4 && !inside; i++) inside = inArea((col + i / 4) * size, (row + j / 4) * size);
    }
    if (inside && !skip.has(`c${col}_r${row}`)) frames.push({ id: `c${col}_r${row}`, x: col * size, y: row * size, size, height: GROUND });
  }
}

mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, `${JSON.stringify(frames)}\n`);
const span = (v) => Math.max(...v) - Math.min(...v) + 1;
console.log(`${frames.length} shots of ${size} px in a ${span(cols)} x ${span(rows)} grid, ${((frames.length * size * size) / 1e9).toFixed(2)} billion pixels`);

if (svgPath) {
  // A small picture of the grid for the write-up: one square per shot, with the area's outline.
  const k = 6 / size; // 6 SVG units per shot.
  const [minX, minY] = [Math.min(...cols) * size, Math.min(...rows) * size];
  const at = (x, y) => [(x - minX) * k + 10, (y - minY) * k + 10];
  const squares = frames.map((f) => { const [x, y] = at(f.x, f.y); return `<rect x="${x}" y="${y}" width="5.4" height="5.4"/>`; }).join("");
  const outline = shapes.map((shape) => `<polygon points="${shape.map((c) => at(c.x, c.y).map((v) => v.toFixed(1)).join(",")).join(" ")}" fill="none" stroke="#b4452c" stroke-width="1.2"/>`).join("");
  const [w, h] = [span(cols) * 6 + 20, span(rows) * 6 + 20];
  mkdirSync(dirname(svgPath), { recursive: true });
  writeFileSync(
    svgPath,
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h + 22}" font-family="Helvetica, Arial, sans-serif" font-size="9"><rect width="100%" height="100%" fill="#ffffff"/><g fill="#9fd3d6">${squares}</g>${outline}<text x="10" y="${h + 14}" fill="#17211f">${frames.length} shots of ${size} px. Red: the map area. Each square is ${(size * 0.293).toFixed(0)} m wide on screen.</text></svg>\n`,
  );
}
