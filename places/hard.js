// Picks the hard places: about ten of each kind of place the model is most likely to get wrong
// (PLAN.md, "Hard places"). Each becomes the 512 px quarter that holds the feature's centre.
//
//   node places/hard.js places/quarter-candidates.json places/hard-frames.json
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { project } from "../render/camera.js";
import { GROUND } from "./test-places.js";

const here = dirname(fileURLToPath(import.meta.url));
const CACHE = join(here, "hard-cache.json");
const BBOX = "-32.07,115.735,-31.885,115.91"; // The map area: south, west, north, east.
const PER_KIND = 10;
const APART = 1500; // Map pixels between two picks of one kind (about 440 m), so they spread out.
const QUARTER = 512;

// One OpenStreetMap filter per kind. "nwr" means nodes, ways and relations.
const KINDS = {
  oval: 'way["leisure"="pitch"]["sport"~"australian_football|cricket"]',
  pools: 'way["leisure"="swimming_pool"]["access"!="public"]',
  wetland: 'nwr["natural"="wetland"]',
  jetty: 'nwr["man_made"="pier"]',
  beach: 'nwr["natural"="beach"]',
  freeway: 'way["highway"="motorway"]',
  bush: 'nwr["natural"~"wood|scrub"]',
  golf: 'nwr["leisure"="golf_course"]',
  industrial: 'nwr["landuse"~"industrial|railway"]',
};

// Public Overpass servers are often busy, so try each in turn, a few times.
const SERVERS = ["https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter"];

async function fetchKind(filter) {
  const query = `[out:json][timeout:120];${filter}(${BBOX});out center tags;`;
  for (let attempt = 0; attempt < 6; attempt++) {
    const response = await fetch(SERVERS[attempt % SERVERS.length], {
      method: "POST",
      body: new URLSearchParams({ data: query }),
      headers: { "User-Agent": "tinyperth/0.1" },
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
  // Count features per quarter. A quarter with many pools is a better pools example than one with one.
  const counts = new Map();
  for (const p of cache[kind]) {
    const c = project(p.lat, p.lon, GROUND);
    const key = `${Math.floor(c.x / QUARTER) * QUARTER},${Math.floor(c.y / QUARTER) * QUARTER}`;
    if (candidates.has(key)) counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const random = seeded(kind.length * 7919);
  const ranked = [...counts.entries()]
    .map(([key, count]) => ({ key, score: (kind === "pools" ? count : 1) + random() }))
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
