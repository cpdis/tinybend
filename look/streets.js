// Builds site/search/streets.json: the street names the search box can find.
//
//   node look/streets.js [--in <file>] [--suburbs <file>] [--out <file>]
//
//   --in       OpenStreetMap's answer to look/streets.overpassql: every way with a highway tag and
//              a name in the larger map's box, with its middle point. Default
//              look/out/smallsf-data/streets.json, fetched there once if it isn't there.
//   --suburbs  Optional: OpenStreetMap's suburb outlines, the answer to look/suburbs.overpassql.
//              Default look/out/smallsf-data/suburbs.json, used if it is there (never fetched).
//   --out      Default site/search/streets.json.
//
// Overpass can't be reached from the cloud machines, so this runs on the Mac.
//
// One street is many ways in OpenStreetMap: a new way starts wherever the road changes (a bridge,
// a lane count, a speed limit), so Hay Street is dozens of them. Here they become one entry per
// name per suburb. Each way is given the suburb it lies in: by the suburb outlines where they are
// on hand, else the nearest suburb point (the suburbs in site/places.json, and the city and towns
// in site/labels/labels.json, since the CBD is "Perth" there), nearest on the ground: the map
// looks 45 degrees down, so a pixel up the screen is 1.41 pixels of ground. Then the ways of one
// name in one suburb that lie within 2 km of each other join up. So "Hay Street, Perth" and "Hay
// Street, Subiaco" are two entries, and two far-apart roads of the same name in one big rural
// suburb are two as well. Footpaths, cycle paths, tracks, driveways, steps, platforms and roads
// not yet built are left out, and so are freeway ramps ("Kwinana Freeway On Ramp") and house
// numbers mapped as names ("12 Loder Way").
//
// The file is small, because the page fetches it whole the first time someone looks for a street.
// Most of Perth's 27,000 street names are in one suburb only, so the size is mostly one entry per
// stretch, and its position is the dearest part. So: { v: 2, unit, types, suburbs, streets }.
//   suburbs  [name, x, y] in map pixels, A to Z.
//   streets  one row per suburb, in the same order: name, class, dx, dy, name, class, dx, dy, ...
//            The stretches in a suburb go in the order of a curve that wanders through the suburb
//            without jumping (a Hilbert curve), and dx, dy is the step from the one before (the
//            first from the suburb's point), in units of `unit` map pixels. So most steps are a
//            couple of digits. Positions are kept to 16 px (under 5 m), or 32 or 64 if that is
//            what fits the budget (the whole map takes 32 px, about 9 m).
//   class    0 freeway or highway, 1 primary, 2 secondary, 3 tertiary, left out for 4 (anything
//            else, nine names in ten). It orders results and sets how close a result zooms.
//   types    the commonest last words ("Street", "Way", "Road"). A name ending in one is written
//            with its number instead: "Abbott~2" is "Abbott Road" when types[2] is "Road".
// A stretch sits on the middle of one of its ways (the one nearest the middle of them all), so a
// result lands on the road. The page reads the file with decodeStreets in site/search/search.js.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { brotliCompressSync, constants as zc, gzipSync } from "node:zlib";
import { CAMERA, project } from "../render/camera.js";

export const GROUND = -25; // As look/site-places.js: Perth's coastal plain on the ellipsoid.
export const UNIT = 16;
export const LINK = Math.round(2000 / CAMERA.metresPerPixel); // 2 km in map pixels.
// Map pixels to ground: across the screen a pixel is a pixel, up it a pixel is 1 / sin(tilt).
export const SQUASH = 1 / Math.sin((CAMERA.tiltDeg * Math.PI) / 180);
const ground = (dx, dy) => Math.hypot(dx, dy * SQUASH);
export const BUDGET = 250 * 1024; // Bytes, gzipped: what a first street search may cost.
export const EXCLUDE = new Set([
  "footway", "path", "cycleway", "steps", "service", "track", "bridleway", "corridor", "proposed", "construction", "platform",
  // Not streets either: race circuits, lifts, stops, roadhouses and the lifecycle tags.
  "raceway", "elevator", "bus_stop", "rest_area", "services", "emergency_bay", "escape", "abandoned", "disused", "razed",
]);
// A ramp named for where it leads ("Anketell Road Exit"), on a *_link way only, and a house number.
const RAMP = /\b(Exit|Entry|On[- ]?Ramp|Off[- ]?Ramp|Interchange)$/i;
const HOUSE = /^\d+[-\d/]*[a-z]? /i;
const CLASS = { motorway: 0, motorway_link: 0, trunk: 0, trunk_link: 0, primary: 1, primary_link: 1, secondary: 2, secondary_link: 2, tertiary: 3, tertiary_link: 3 };
export const classOf = (highway) => CLASS[highway] ?? 4;

/** Suburb points: places.json's suburbs and islands, then labels.json's city, towns and suburbs. */
export function suburbPoints(places, labels) {
  const out = new Map();
  for (const p of places) if ((p.kind === "suburb" || p.kind === "island") && !out.has(p.name)) out.set(p.name, { name: p.name, x: p.x, y: p.y });
  for (const [name, x, y, kind] of labels) if (["city", "town", "suburb", "island"].includes(kind) && !out.has(name)) out.set(name, { name, x, y });
  return [...out.values()];
}

/** Suburb outlines from Overpass relations with `out geom`: every edge of every outer and inner ring, in lat/lon. */
export function outlines(elements) {
  const out = [];
  for (const el of elements ?? []) {
    if (el.type !== "relation" || !el.tags?.name) continue;
    const edges = [];
    const box = [Infinity, Infinity, -Infinity, -Infinity];
    for (const m of el.members ?? []) {
      if (m.type !== "way" || !Array.isArray(m.geometry) || !["outer", "inner", "", undefined].includes(m.role)) continue;
      for (let i = 0; i < m.geometry.length; i++) {
        const { lat, lon } = m.geometry[i];
        box[0] = Math.min(box[0], lat); box[1] = Math.min(box[1], lon); box[2] = Math.max(box[2], lat); box[3] = Math.max(box[3], lon);
        if (i) edges.push(m.geometry[i - 1].lat, m.geometry[i - 1].lon, lat, lon);
      }
    }
    if (edges.length) out.push({ name: el.tags.name, edges: Float64Array.from(edges), box });
  }
  return out;
}

/** Whether a point is inside an outline: an odd number of its edges cross a line due east of it. */
export function inside(o, lat, lon) {
  if (lat < o.box[0] || lat > o.box[2] || lon < o.box[1] || lon > o.box[3]) return false;
  const e = o.edges;
  let odd = false;
  for (let i = 0; i < e.length; i += 4) {
    if (e[i] > lat !== e[i + 2] > lat && lon < e[i + 1] + ((lat - e[i]) / (e[i + 2] - e[i])) * (e[i + 3] - e[i + 1])) odd = !odd;
  }
  return odd;
}

function nearest(points, x, y) {
  let best = null, d = Infinity;
  for (const p of points) {
    const dd = ground(p.x - x, p.y - y);
    if (dd < d) { d = dd; best = p; }
  }
  return best;
}

/**
 * The street rows for a list of Overpass elements. `points` are the suburb points, `shapes` the
 * suburb outlines (may be empty), `at(lat, lon)` map pixels as [x, y] or null off the map, and
 * `corner` the map's top-left corner in map pixels (site/agent/map.json).
 */
export function bakeStreets(elements, { points, shapes = [], at, unit = UNIT, link = LINK, corner = { x: -132055, y: -93969 } }) {
  const stats = { elements: elements.length, ways: 0, kept: 0, unnamed: 0, excluded: {}, lowercase: 0, ramps: 0, noCentre: 0, outside: 0, byOutline: 0, byPoint: 0 };
  const byName = new Map(points.map((p) => [p.name.toLowerCase(), p]));
  const extra = new Map();
  /** The suburb a way's middle is in. An outline with no point on the map is placed at its box's middle. */
  const suburbOf = (lat, lon, x, y) => {
    let best = null, area = Infinity;
    for (const o of shapes) {
      if (!inside(o, lat, lon)) continue;
      const a = (o.box[2] - o.box[0]) * (o.box[3] - o.box[1]);
      if (a < area) { area = a; best = o; }
    }
    if (!best) { stats.byPoint++; return nearest(points, x, y); }
    stats.byOutline++;
    const known = byName.get(best.name.toLowerCase());
    if (known) return known;
    if (!extra.has(best.name)) {
      const c = at((best.box[0] + best.box[2]) / 2, (best.box[1] + best.box[3]) / 2) ?? [x, y];
      extra.set(best.name, { name: best.name, x: c[0], y: c[1] });
    }
    return extra.get(best.name);
  };

  const groups = new Map();
  for (const el of elements) {
    if (el.type !== "way") continue;
    stats.ways++;
    const t = el.tags ?? {};
    const name = String(t.name ?? "").replace(/~/g, " ").trim().replace(/\s+/g, " ");
    if (!t.highway || !name) { stats.unnamed++; continue; }
    if (EXCLUDE.has(t.highway)) { stats.excluded[t.highway] = (stats.excluded[t.highway] ?? 0) + 1; continue; }
    // A name with no capital is a tagging slip ("service road"), not a street's name. A ramp's
    // name says where it leads, and a leading house number makes it an address.
    if (name === name.toLowerCase()) { stats.lowercase++; continue; }
    if ((/_link$/.test(t.highway) && RAMP.test(name)) || HOUSE.test(name)) { stats.ramps++; continue; }
    const c = el.center;
    if (!c || !Number.isFinite(c.lat) || !Number.isFinite(c.lon)) { stats.noCentre++; continue; }
    const p = at(c.lat, c.lon);
    if (!p) { stats.outside++; continue; }
    const sub = suburbOf(c.lat, c.lon, p[0], p[1]);
    const key = `${name}\n${sub.name}`;
    if (!groups.has(key)) groups.set(key, { name, sub, ways: [] });
    groups.get(key).ways.push({ x: p[0], y: p[1], cls: classOf(t.highway) });
    stats.kept++;
  }

  // Ways of one name in one suburb join up when a chain of them, each within `link` of the
  // next, connects them.
  const stretches = new Map();
  for (const { name, sub, ways } of groups.values()) {
    const parent = ways.map((_, i) => i);
    const root = (i) => (parent[i] === i ? i : (parent[i] = root(parent[i])));
    for (let i = 0; i < ways.length; i++) {
      for (let j = i + 1; j < ways.length; j++) {
        if (ground(ways[i].x - ways[j].x, ways[i].y - ways[j].y) <= link) parent[root(i)] = root(j);
      }
    }
    const sets = new Map();
    ways.forEach((w, i) => { const r = root(i); if (!sets.has(r)) sets.set(r, []); sets.get(r).push(w); });
    for (const set of sets.values()) {
      const mx = set.reduce((s, w) => s + w.x, 0) / set.length, my = set.reduce((s, w) => s + w.y, 0) / set.length;
      const mid = set.reduce((b, w) => (ground(w.x - mx, w.y - my) < ground(b.x - mx, b.y - my) ? w : b));
      if (!stretches.has(name)) stretches.set(name, []);
      stretches.get(name).push({ sub, x: mid.x, y: mid.y, cls: Math.min(...set.map((w) => w.cls)), ways: set.length });
    }
  }

  // The commonest last words, as numbers.
  const words = new Map();
  for (const [name, list] of stretches) { const w = name.split(" "); if (w.length > 1) words.set(w.at(-1), (words.get(w.at(-1)) ?? 0) + list.length); }
  const types = [...words].filter(([, n]) => n >= 20).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).map(([w]) => w);
  const code = new Map(types.map((w, i) => [w, i]));
  const short = (name) => { const w = name.split(" "), t = w.length > 1 ? code.get(w.at(-1)) : undefined; return t === undefined ? name : `${w.slice(0, -1).join(" ")}~${t}`; };

  const bySuburb = new Map();
  for (const [name, list] of stretches) for (const s of list) { if (!bySuburb.has(s.sub)) bySuburb.set(s.sub, []); bySuburb.get(s.sub).push({ ...s, name }); }
  const subs = [...bySuburb.keys()].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  // Positions in steps of `unit`, and along the curve from the map's top-left corner.
  const q = (v) => Math.round(v / unit);
  const streets = subs.map((sub) => {
    const list = bySuburb.get(sub).map((s) => ({ ...s, qx: q(s.x), qy: q(s.y) }));
    for (const s of list) s.h = hilbert(s.qx - q(corner.x), s.qy - q(corner.y));
    list.sort((a, b) => a.h - b.h || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    const row = [];
    let px = q(sub.x), py = q(sub.y);
    for (const s of list) {
      row.push(short(s.name));
      if (s.cls < 4) row.push(s.cls);
      row.push(s.qx - px, s.qy - py);
      px = s.qx; py = s.qy;
    }
    return row;
  });
  stats.names = stretches.size;
  stats.stretches = [...stretches.values()].reduce((n, list) => n + list.length, 0);
  return { data: { v: 2, unit, types, suburbs: subs.map((s) => [s.name, Math.round(s.x), Math.round(s.y)]), streets }, stats };
}

/** Where (x, y) falls along a Hilbert curve filling a 65,536 square: nearby points get nearby numbers. */
export function hilbert(x, y) {
  let d = 0;
  x = Math.max(0, Math.min(65535, x | 0)); y = Math.max(0, Math.min(65535, y | 0));
  for (let s = 32768; s > 0; s >>= 1) {
    const rx = x & s ? 1 : 0, ry = y & s ? 1 : 0;
    d += s * s * ((3 * rx) ^ ry);
    if (!ry) { if (rx) { x = s - 1 - x; y = s - 1 - y; } [x, y] = [y, x]; }
  }
  return d;
}

/** The file's text: one row a line, so a re-bake reads as a diff. */
export const encode = (data) => `${JSON.stringify(data).replace(/\],\[/g, "],\n[")}\n`;

/** Bytes as the page would fetch them. */
export function sizes(text) {
  const raw = Buffer.from(text);
  return { raw: raw.length, gzip: gzipSync(raw, { level: 9 }).length, brotli: brotliCompressSync(raw, { params: { [zc.BROTLI_PARAM_QUALITY]: 11 } }).length };
}

async function main() {
  const args = process.argv.slice(2);
  const flag = (name, fallback) => (args.includes(name) ? resolve(args[args.indexOf(name) + 1]) : fallback);
  const here = (path) => fileURLToPath(new URL(path, import.meta.url));
  const input = flag("--in", here("./out/smallsf-data/streets.json"));
  const suburbs = flag("--suburbs", here("./out/smallsf-data/suburbs.json"));
  const out = flag("--out", here("../site/search/streets.json"));
  if (!existsSync(input)) {
    console.log(`No ${input}: asking Overpass (this takes a few minutes).`);
    const query = readFileSync(here("./streets.overpassql"), "utf8");
    const reply = await fetch("https://overpass-api.de/api/interpreter", { method: "POST", body: new URLSearchParams({ data: query }), headers: { "User-Agent": "tinybend/0.1" } });
    if (!reply.ok) throw new Error(`Overpass said ${reply.status}`);
    mkdirSync(dirname(input), { recursive: true });
    writeFileSync(input, await reply.text());
  }
  const read = (path) => JSON.parse(readFileSync(path, "utf8"));
  const box = read(here("../site/agent/map.json")).map;
  const at = (lat, lon) => {
    const p = project(lat, lon, GROUND);
    const x = Math.round(p.x), y = Math.round(p.y);
    return x >= box.x && y >= box.y && x < box.x + box.width && y < box.y + box.height ? [x, y] : null;
  };
  const points = suburbPoints(read(here("../site/places.json")), read(here("../site/labels/labels.json")));
  const shapes = existsSync(suburbs) ? outlines(read(suburbs).elements) : [];
  console.log(shapes.length ? `${shapes.length} suburb outlines from ${suburbs}` : `No suburb outlines (${suburbs}): each way gets the nearest suburb point.`);
  const elements = read(input).elements ?? [];
  // Positions are kept to 16 px (under 5 m). If that is over budget, coarser steps of 32 and
  // 64 px (under 10 and 20 m) still land a search on its street, and save about 5% each.
  let baked, text, size;
  for (const unit of [UNIT, UNIT * 2, UNIT * 4]) {
    baked = bakeStreets(elements, { points, shapes, at, unit, corner: box });
    text = encode(baked.data);
    size = sizes(text);
    if (size.gzip <= BUDGET) break;
  }
  const { data, stats } = baked;
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, text);
  console.log(`${stats.ways} ways: ${stats.kept} kept, ${stats.outside} off the map, ${stats.unnamed + stats.lowercase + stats.noCentre} without a usable name or middle, ${stats.ramps} ramps and house numbers, left out by type ${JSON.stringify(stats.excluded)}`);
  console.log(`Suburb by outline ${stats.byOutline}, by nearest point ${stats.byPoint}`);
  console.log(`${stats.names} names, ${stats.stretches} stretches in ${data.suburbs.length} suburbs, ${data.types.length} street types -> ${out}`);
  console.log(`${(size.raw / 1024).toFixed(0)} KB, ${(size.gzip / 1024).toFixed(0)} KB gzipped, ${(size.brotli / 1024).toFixed(0)} KB brotli, positions to ${data.unit} px`);
  if (size.gzip > BUDGET) console.warn(`Over the ${BUDGET / 1024} KB budget even at ${data.unit} px. Leave out the least important names before committing.`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
