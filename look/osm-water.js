// Where open water is, from OpenStreetMap: one lookup shared by the teacher's water sentence
// and the water mask. The map data downloads once and is kept in look/out/osm-water.json.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
// The first map's box: Fremantle to Burswood, Cottesloe to Scarborough, with margin. The larger
// map sets WATER_BBOX (south,west,north,east) to its own box, and gets its own cache file.
const BBOX = process.env.WATER_BBOX || "-32.08,115.70,-31.86,115.95";
const CACHE = join(here, "out", process.env.WATER_BBOX ? `osm-water-${BBOX.replaceAll(",", "_")}.json` : "osm-water.json");
export const WATER_LEVEL = -31; // Metres above the ellipsoid: measured off the river in the depth pass.
const BANDS = 400; // Segments are filed by latitude band, so a lookup tests a few hundred, not all of them.

async function fetchWater() {
  if (existsSync(CACHE)) return JSON.parse(readFileSync(CACHE, "utf8"));
  const query = `[out:json][timeout:240];(
    relation["natural"="water"](${BBOX});way["natural"="water"](${BBOX});
    relation["waterway"="riverbank"](${BBOX});way["natural"="coastline"](${BBOX});
  );out geom;`;
  const response = await fetch("https://overpass-api.de/api/interpreter", {
    method: "POST",
    body: new URLSearchParams({ data: query }),
    headers: { "User-Agent": "tinybend/0.1" },
  });
  if (!response.ok) throw new Error(`Overpass returned ${response.status}`);
  const data = await response.json();
  mkdirSync(dirname(CACHE), { recursive: true });
  writeFileSync(CACHE, JSON.stringify(data));
  return data;
}

/** Split OSM elements into line segments: water outlines (even-odd) and the coast. */
function toSegments(osm) {
  const water = [];
  const coast = [];
  const push = (list, geometry) => {
    for (let i = 1; i < geometry.length; i++) list.push([geometry[i - 1], geometry[i]]);
  };
  for (const el of osm.elements) {
    if (el.tags?.natural === "coastline") push(coast, el.geometry);
    else if (el.type === "way") push(water, el.geometry);
    else for (const m of el.members ?? []) if (m.geometry) push(water, m.geometry);
  }
  return { water, coast };
}

/** File each segment under every latitude band it crosses. */
function byBand(segments, south, north) {
  const bands = Array.from({ length: BANDS }, () => []);
  const band = (lat) => Math.min(BANDS - 1, Math.max(0, Math.floor(((lat - south) / (north - south)) * BANDS)));
  for (const segment of segments) {
    const [low, high] = [Math.min(segment[0].lat, segment[1].lat), Math.max(segment[0].lat, segment[1].lat)];
    for (let i = band(low); i <= band(high); i++) bands[i].push(segment);
  }
  return (lat) => bands[band(lat)];
}

/** How many segments a ray running due west from the point crosses. */
function crossingsWest(segments, lat, lon) {
  let count = 0;
  for (const [a, b] of segments) {
    if (a.lat > lat === b.lat > lat) continue;
    const x = a.lon + ((lat - a.lat) / (b.lat - a.lat)) * (b.lon - a.lon);
    if (x < lon) count++;
  }
  return count;
}

/** Returns isWater(lat, lon) for any point in the map area. */
export async function waterLookup() {
  const { water, coast } = toSegments(await fetchWater());
  const [south, west, north] = BBOX.split(",").map(Number);
  const [waterAt, coastAt] = [byBand(water, south, north), byBand(coast, south, north)];
  return (lat, lon) => {
    // Perth's ocean is to the west. Looking west from the sea, the coast is crossed an even
    // number of times: never, or in and out of an island such as Rottnest or Garden Island.
    // From land it is crossed an odd number of times. Testing only for zero once made the
    // sea behind those islands into land.
    if (lon < west || crossingsWest(coastAt(lat), lat, lon) % 2 === 0) return true;
    return crossingsWest(waterAt(lat), lat, lon) % 2 === 1;
  };
}

/** The ocean coast as OSM line segments ({lat, lon} pairs), for the life layers' beaches. */
export async function coastSegments() {
  return toSegments(await fetchWater()).coast;
}
