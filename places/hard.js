// Picks the hard places: about ten of each kind of place the model is most likely to get wrong
// (PLAN.md, "Hard places"). Each becomes the 512 px frame that holds the feature's centre.
// Test places can't be picked: places/candidates.js leaves out every frame that touches one.
//
//   node places/hard.js places/quarter-candidates.json places/hard-frames.json
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { groundAt } from "./test-places.js";

const here = dirname(fileURLToPath(import.meta.url));
const CACHE = join(here, "hard-cache.json");
// Both areas in cities/bend.json, as one Overpass box (south, west, north, east). Features
// between the boxes find no candidate quarter and drop out.
const city = JSON.parse(readFileSync(join(here, "..", "cities", "bend.json"), "utf8"));
const boxes = Object.values(city.areas).map((a) => a.box);
const BBOX = [
  Math.min(...boxes.map((b) => b.south)),
  Math.min(...boxes.map((b) => b.west)),
  Math.max(...boxes.map((b) => b.north)),
  Math.max(...boxes.map((b) => b.east)),
].join(",");
const PER_KIND = 10;
const APART = 1500; // Map pixels between two picks of one kind (about 440 m), so they spread out.
const QUARTER = 512; // Map pixels, a sixteenth of a 2,048 px shot, enlarged 2x for the teacher as in Perth.

// One OpenStreetMap filter per kind. "nwr" means nodes, ways and relations.
// Bend's kinds (PLAN.md, "Hard places"). Pine canopy itself is everywhere and the general
// frames cover it, so its hard kind is the singletrack through it.
const KINDS = {
  singletrack: 'way["highway"="path"]["mtb:scale"]',
  sagebrush: 'nwr["natural"~"scrub|heath|grassland"]',
  rimrock: 'nwr["natural"~"cliff|bare_rock|scree"]',
  cinder: 'node["natural"~"volcano|peak"]',
  canal: 'way["waterway"="canal"]',
  golf: 'nwr["leisure"="golf_course"]',
  roundabout: 'way["junction"~"roundabout|circular"]',
  skirun: 'way["piste:type"="downhill"]',
  lift: 'way["aerialway"~"chair_lift|gondola|mixed_lift|t-bar|platter|drag_lift|magic_carpet"]',
  quarry: 'nwr["landuse"="quarry"]',
  rapids: 'nwr["waterway"~"rapids|waterfall|weir|dam"]',
};

// Public Overpass servers are often busy, so try each in turn, a few times.
const SERVERS = ["https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter"];

async function fetchKind(filter) {
  const query = `[out:json][timeout:120];${filter}(${BBOX});out center tags;`;
  for (let attempt = 0; attempt < 6; attempt++) {
    const response = await fetch(SERVERS[attempt % SERVERS.length], {
      method: "POST",
      body: new URLSearchParams({ data: query }),
      headers: { "User-Agent": "tinybend/0.1" },
    }).catch(() => null);
    if (response?.ok) {
      const { elements } = await response.json();
      return elements.map((e) => ({ lat: e.center?.lat ?? e.lat, lon: e.center?.lon ?? e.lon })).filter((p) => p.lat);
    }
    console.log(`  Overpass answered ${response?.status ?? "nothing"}, trying again`);
    await new Promise((r) => setTimeout(r, 8000));
  }
  throw new Error("Overpass did not answer after 6 tries");
}

/** A small repeatable random number source, so a rerun picks the same places. */
function seeded(seed) {
  let state = seed;
  return () => (state = (state * 1103515245 + 12345) % 2147483648) / 2147483648;
}

const [candidatesFile, out] = process.argv.slice(2);
const candidates = new Map(JSON.parse(readFileSync(candidatesFile, "utf8")).map((c) => [`${c.x},${c.y}`, c]));
const cache = existsSync(CACHE) ? JSON.parse(readFileSync(CACHE, "utf8")) : {};
const frames = [];
const used = new Set();

for (const [kind, filter] of Object.entries(KINDS)) {
  if (!cache[kind]) {
    cache[kind] = await fetchKind(filter);
    writeFileSync(CACHE, JSON.stringify(cache));
    await new Promise((r) => setTimeout(r, 2000));
  }
  // Count features per frame. A frame with several roundabouts or canal reaches is a better
  // example than one with one, up to a point.
  const counts = new Map();
  for (const p of cache[kind]) {
    const c = groundAt(p.lat, p.lon);
    const key = `${Math.floor(c.x / QUARTER) * QUARTER},${Math.floor(c.y / QUARTER) * QUARTER}`;
    if (candidates.has(key)) counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const random = seeded(kind.length * 7919);
  const ranked = [...counts.entries()]
    .map(([key, count]) => ({ key, score: (kind === "roundabout" || kind === "canal" ? Math.min(count, 3) : 1) + random() }))
    .sort((a, b) => b.score - a.score);
  const picked = [];
  for (const { key } of ranked) {
    if (picked.length >= PER_KIND) break;
    const c = candidates.get(key);
    if (used.has(key) || picked.some((p) => Math.hypot(p.x - c.x, p.y - c.y) < APART)) continue;
    picked.push(c);
    used.add(key);
  }
  for (const c of picked) frames.push({ id: `hard-${kind}-${c.id}`, x: c.x, y: c.y, size: c.size, kind });
  console.log(`${kind}: ${cache[kind].length} features in ${counts.size} quarters, picked ${picked.length}`);
}

writeFileSync(out, `${JSON.stringify(frames)}\n`);
console.log(`${frames.length} hard frames written`);
