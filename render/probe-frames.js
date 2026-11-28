// Picks shots from the map grid around named places, for a small probe render.
//
//   node render/probe-frames.js [--block 1|2] [--out render/frames/probe2.json] <place> ...
//
// A place is an id from places/bend.json, or "lat,lon". Each place gets the shot its ground
// point falls in (--block 1), or the 2 x 2 shots whose shared corner is nearest it (--block 2,
// the default). Shots come from render/frames/bend.json with their depth range; a place off
// the map grid still gets its shots, with a range from the DEM, and a warning. Ids are
// "<place>__c<col>_r<row>", as in the first probe.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { CITY, groundProjector, loadDem } from "./dem.js";
import { shotGround } from "./grid.js";

const here = dirname(fileURLToPath(import.meta.url));
const arg = (name, fallback) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : fallback;
};
const block = Number(arg("--block", 2));
const out = arg("--out", join(here, "frames", "probe2.json"));
const names = process.argv.slice(2).filter((a, i, all) => !a.startsWith("--") && !["--block", "--out"].includes(all[i - 1]));
if (!names.length) throw new Error("name at least one place: an id from places/bend.json or lat,lon");

const size = CITY.shotSize;
const places = JSON.parse(readFileSync(join(here, "..", "places", "bend.json"), "utf8"));
const grid = new Map(JSON.parse(readFileSync(join(here, "frames", "bend.json"), "utf8")).map((f) => [f.id, f]));
const groundAt = await groundProjector();
const dem = await loadDem();

const frames = [];
for (const name of names) {
  const place = places.find((p) => p.id === name);
  const [lat, lon] = place ? [place.lat, place.lon] : name.split(",").map(Number);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) throw new Error(`"${name}" is not a place id or lat,lon`);
  const label = place ? place.id : `p${lat.toFixed(4)}_${lon.toFixed(4)}`.replaceAll(".", "-");
  const c = groundAt(lat, lon);
  const cols = block === 1 ? [Math.floor(c.x / size)] : [Math.round(c.x / size) - 1, Math.round(c.x / size)];
  const rows = block === 1 ? [Math.floor(c.y / size)] : [Math.round(c.y / size) - 1, Math.round(c.y / size)];
  for (const col of cols) for (const row of rows) {
    const id = `c${col}_r${row}`;
    let f = grid.get(id);
    if (!f) {
      const g = shotGround(col * size, row * size, size, dem);
      console.log(`${label}: ${id} is not on the map grid; depth range from the DEM`);
      f = { id, area: null, x: col * size, y: row * size, size, height: g.height, relief: g.relief, near: g.near, far: g.far };
    }
    frames.push({ ...f, id: `${label}__${id}` });
  }
}
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, `${JSON.stringify(frames, null, 1)}\n`);
console.log(`${frames.length} shots for ${names.length} places in ${out}`);
