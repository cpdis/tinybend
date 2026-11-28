// Builds site/places.json: the names the site can search and the pins it shows.
//
//   node look/site-places.js <tiles.json> <out.json>
//
// Three sources, each projected through the map's camera to map pixels:
//   suburbs and towns from OpenStreetMap (place=suburb, town, village, island), fetched once
//   and kept in look/out/osm-places.json; the landmarks in places/perth.json; and the places
//   on world.cpd.dev, which become pins that open their then-and-now page.
// Points are projected at a typical ground height. A hill suburb lands a few metres off,
// which does not matter for zooming to it.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { project } from "../render/camera.js";

const GROUND = -25; // Metres above the ellipsoid: Perth's coastal plain, about 6 m above sea level.
const CACHE = new URL("./out/osm-places.json", import.meta.url);
const BBOX = "-32.33,115.36,-31.50,116.35"; // The larger map's box, as WATER_BBOX.
const [tilesPath, outPath] = process.argv.slice(2);
const layout = JSON.parse(readFileSync(tilesPath, "utf8"));

async function osmPlaces() {
  if (existsSync(CACHE)) return JSON.parse(readFileSync(CACHE, "utf8"));
  const query = `[out:json][timeout:120];node["place"~"^(suburb|town|village|island|quarter)$"]["name"](${BBOX});out;`;
  for (const server of ["https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter"]) {
    const reply = await fetch(server, { method: "POST", body: new URLSearchParams({ data: query }), headers: { "User-Agent": "tinybend/0.1" } });
    if (!reply.ok) continue;
    const data = await reply.json();
    writeFileSync(CACHE, JSON.stringify(data));
    return data;
  }
  throw new Error("both OpenStreetMap servers refused the query");
}

/** A point in map pixels, or null when it falls outside the pyramid. */
function at(lat, lon, height = GROUND) {
  const p = project(lat, lon, height);
  // Kept in map pixels, as the camera gives them. The viewer takes away the pyramid's own
  // corner, so the same file works for any version of the tiles.
  const [x, y] = [Math.round(p.x), Math.round(p.y)];
  const inside = x >= layout.x && y >= layout.y && x < layout.x + layout.width && y < layout.y + layout.height;
  // Latitude and longitude ride along (5 places, about a metre) for readers that don't know map pixels.
  return inside ? { x, y, lat: +lat.toFixed(5), lon: +lon.toFixed(5) } : null;
}

const places = [];
for (const el of (await osmPlaces()).elements) {
  const point = at(el.lat, el.lon);
  if (point) places.push({ name: el.tags.name, kind: el.tags.place === "island" ? "island" : "suburb", ...point });
}
// Islands are mapped as outlines, not points, so the query above misses them.
for (const [name, lat, lon] of [["Rottnest Island", -32.0, 115.51]]) {
  const point = at(lat, lon);
  if (point) places.push({ name, kind: "island", ...point });
}
for (const p of JSON.parse(readFileSync(new URL("../places/perth.json", import.meta.url), "utf8"))) {
  if (p.kind !== "landmark") continue;
  const point = at(p.lat, p.lon);
  if (point) places.push({ name: p.name, kind: "landmark", ...point });
}
const world = await (await fetch("https://world.cpd.dev/locations.json")).json();
for (const loc of world) {
  const view = loc.frames.find((f) => f.view?.frame)?.view.frame;
  if (!view) continue;
  const point = at(view.lat0, view.lon0, view.groundEllipsoidHeight);
  if (point) places.push({ name: loc.name, kind: "world", url: `https://world.cpd.dev/perth?place=${loc.id}`, ...point });
}
// One entry per name, suburbs after landmarks, in alphabetical order for the list.
const seen = new Set();
const unique = places.filter((p) => !seen.has(`${p.kind}:${p.name}`) && seen.add(`${p.kind}:${p.name}`));
unique.sort((a, b) => a.name.localeCompare(b.name));
writeFileSync(outPath, JSON.stringify(unique));
const count = (k) => unique.filter((p) => p.kind === k).length;
console.log(`${unique.length} places: ${count("suburb")} suburbs, ${count("island")} islands, ${count("landmark")} landmarks, ${count("world")} world.cpd.dev pins`);
