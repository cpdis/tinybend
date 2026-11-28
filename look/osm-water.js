// Where open water is, from OpenStreetMap: one lookup shared by the teacher's water sentence
// and the water mask. The map data downloads once (on the Mac: the cloud can't reach Overpass)
// and is kept in look/out/osm-water.json.
//
// Bend has no coast. Water is the polygons OSM draws (the Deschutes, Mirror Pond, ponds and
// reservoirs) plus the irrigation canals, which OSM mostly draws as centre lines: a canal
// counts as water within half its width of its line, from its width tag or a default.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const city = JSON.parse(readFileSync(join(here, "..", "cities", "bend.json"), "utf8"));
const MARGIN = 0.01; // Degrees around the boxes, about 1 km: frames at a box's edge see past it.
const boxes = Object.values(city.areas).map((a) => a.box);
const BBOX = [
  Math.min(...boxes.map((b) => b.south)) - MARGIN,
  Math.min(...boxes.map((b) => b.west)) - MARGIN,
  Math.max(...boxes.map((b) => b.north)) + MARGIN,
  Math.max(...boxes.map((b) => b.east)) + MARGIN,
].map((v) => v.toFixed(3)).join(",");
const CACHE = join(here, "out", "osm-water.json");
const BANDS = 400; // Segments are filed by latitude band, so a lookup tests a few hundred, not all of them.
// Default widths in metres for water lines with no width tag. Central Oregon's main canals run
// about 6 to 15 m wide in summer; laterals and ditches are narrower.
const LINE_WIDTH = { canal: 8, ditch: 3 };
const M_PER_DEG_LAT = 111_132;

async function fetchWater() {
  if (existsSync(CACHE)) return JSON.parse(readFileSync(CACHE, "utf8"));
  const query = `[out:json][timeout:240];(
    relation["natural"="water"](${BBOX});way["natural"="water"](${BBOX});
    relation["waterway"="riverbank"](${BBOX});way["waterway"="riverbank"](${BBOX});
    way["waterway"~"^(canal|ditch)$"](${BBOX});
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

/** A water line's width in metres: its width tag, or the default for its kind. */
function lineWidth(tags) {
  const tagged = Number.parseFloat(tags?.width);
  return Number.isFinite(tagged) && tagged > 0 ? tagged : LINE_WIDTH[tags?.waterway] ?? 3;
}

/**
 * Split OSM elements into polygon outline segments and water lines. Each outline segment
 * carries the index of its element, because each element is tested even-odd on its own: the
 * same river drawn twice (natural=water and an old riverbank) would cancel out if all the
 * outlines were tested together. Each line segment carries the half width that counts as water.
 */
export function toSegments(osm) {
  const outlines = [];
  const lines = [];
  const push = (list, geometry, extra) => {
    for (let i = 1; i < geometry.length; i++) list.push([geometry[i - 1], geometry[i], extra]);
  };
  for (const [index, el] of osm.elements.entries()) {
    const t = el.tags ?? {};
    if (el.type === "way" && (t.waterway === "canal" || t.waterway === "ditch") && t.natural !== "water") {
      // A canal under a road or in a pipe isn't open water.
      if (t.tunnel || t.covered === "yes" || t.location === "underground") continue;
      push(lines, el.geometry, lineWidth(t) / 2);
    } else if (el.type === "way") push(outlines, el.geometry, index);
    else for (const m of el.members ?? []) if (m.geometry) push(outlines, m.geometry, index);
  }
  return { outlines, lines };
}

/** File each segment under every latitude band it reaches, widened by pad degrees. */
function byBand(segments, south, north, pad = () => 0) {
  const bands = Array.from({ length: BANDS }, () => []);
  const band = (lat) => Math.min(BANDS - 1, Math.max(0, Math.floor(((lat - south) / (north - south)) * BANDS)));
  for (const segment of segments) {
    const p = pad(segment);
    const [low, high] = [Math.min(segment[0].lat, segment[1].lat) - p, Math.max(segment[0].lat, segment[1].lat) + p];
    for (let i = band(low); i <= band(high); i++) bands[i].push(segment);
  }
  return (lat) => bands[band(lat)];
}

/** True when a ray running due west from the point crosses some one element's outline an odd number of times. */
function insideAny(segments, lat, lon) {
  const odd = new Set();
  for (const [a, b, element] of segments) {
    if (a.lat > lat === b.lat > lat) continue;
    const x = a.lon + ((lat - a.lat) / (b.lat - a.lat)) * (b.lon - a.lon);
    if (x < lon) odd.has(element) ? odd.delete(element) : odd.add(element);
  }
  return odd.size > 0;
}

/** True when the point is within some segment's half width of it, measured in metres. */
function nearLine(segments, lat, lon) {
  const k = Math.cos((lat * Math.PI) / 180) * M_PER_DEG_LAT; // Metres per degree of longitude here.
  for (const [a, b, half] of segments) {
    const [ax, ay] = [(a.lon - lon) * k, (a.lat - lat) * M_PER_DEG_LAT];
    const [bx, by] = [(b.lon - lon) * k, (b.lat - lat) * M_PER_DEG_LAT];
    const [dx, dy] = [bx - ax, by - ay];
    const t = Math.max(0, Math.min(1, -(ax * dx + ay * dy) / (dx * dx + dy * dy || 1)));
    if ((ax + t * dx) ** 2 + (ay + t * dy) ** 2 <= half * half) return true;
  }
  return false;
}

/** Returns isWater(lat, lon) for any point in the map's boxes, from the cached OSM data. */
export async function waterLookup(osm) {
  const { outlines, lines } = toSegments(osm ?? (await fetchWater()));
  const [south, , north] = BBOX.split(",").map(Number);
  const outlinesAt = byBand(outlines, south, north);
  const linesAt = byBand(lines, south, north, ([, , half]) => half / M_PER_DEG_LAT);
  return (lat, lon) => insideAny(outlinesAt(lat), lat, lon) || nearLine(linesAt(lat), lat, lon);
}
