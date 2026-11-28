// Builds site/labels/labels.json: the place names drawn over the map, ranked for zooming.
//
//   node look/labels.js <tiles.json> <out.json>
//
// Each label is [name, x, y, kind, rank], with x, y in map pixels from the render camera, so a
// name sits on the place the drawing shows. The page (site/labels/labels.js) shows rank 0 at
// every zoom and adds the lower ranks as you zoom in, dropping any name that would touch one
// already placed.
//
//   rank 0  the city, the ocean, the river and Rottnest: the whole-map view
//   rank 1  regional centres, big waters and big parks
//   rank 2  every other suburb (OpenStreetMap place=suburb, town, village)
//   rank 3  landmarks, lakes and beaches: close in
//   rank 4  gardens, squares, small sights, mid-sized parks and lakes, small hospitals
//   rank 5  schools, clinics, ovals and pocket parks: closest in
//
// Features (parks, ovals, lakes, schools, golf courses, airports, stations, hospitals) also come
// from OpenStreetMap, ranked by kind and size.
//
// The suburbs come from the OpenStreetMap cache that look/site-places.js keeps
// (look/out/osm-places.json). Everything else is listed here by hand, with short names a
// local would use, because a label has to be read at a glance.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { project } from "../render/camera.js";

const GROUND = -25; // As look/site-places.js: Perth's coastal plain on the ellipsoid.
const [tilesPath, outPath] = process.argv.slice(2);
const layout = JSON.parse(readFileSync(tilesPath, "utf8"));
const osm = JSON.parse(readFileSync(new URL("./out/osm-places.json", import.meta.url), "utf8")).elements;
const FEATURES = new URL("./out/osm-features.json", import.meta.url);
const BBOX = "-32.33,115.36,-31.50,116.35"; // The larger map's box, as look/site-places.js.

// Regional centres (WA's strategic and secondary metropolitan centres), plus a few names
// everyone knows, so the zoomed-out map reads as Perth and not as a list of suburbs.
const CENTRES = new Set([
  "Fremantle", "Joondalup", "Midland", "Armadale", "Cannington", "Morley", "Stirling", "Rockingham",
  "Scarborough", "Cottesloe", "Subiaco", "Northbridge", "Victoria Park", "South Perth", "Claremont",
  "Wanneroo", "Ellenbrook", "Kalamunda", "Mundaring", "Booragoon", "Cockburn Central", "Mirrabooka",
  "Clarkson", "Yanchep", "Gosnells", "Kwinana Town Centre", "Guildford", "Hillarys", "Perth Airport",
]);

// [name, lat, lon, kind, rank]. Water names sit on open water, away from the shore.
const HAND = [
  ["Perth", -31.9535, 115.8590, "city", 0],
  ["Indian Ocean", -31.86, 115.60, "water", 0],
  ["Swan River", -31.9945, 115.8250, "water", 0],
  ["Rottnest Island", -32.0005, 115.5150, "island", 0],
  ["Canning River", -32.0210, 115.8870, "water", 1],
  ["Perth Water", -31.9655, 115.8690, "water", 1],
  ["Gage Roads", -32.0300, 115.6900, "water", 1],
  ["Cockburn Sound", -32.1650, 115.7150, "water", 1],
  ["Owen Anchorage", -32.0900, 115.7420, "water", 2],
  ["Kings Park", -31.9600, 115.8310, "park", 1],
  ["Bold Park", -31.9455, 115.7710, "park", 2],
  ["Herdsman Lake", -31.9225, 115.8045, "water", 2],
  ["Lake Joondalup", -31.7550, 115.7840, "water", 2],
  ["Bibra Lake", -32.0960, 115.8230, "water", 3],
  ["Lake Monger", -31.9318, 115.8290, "water", 3],
  ["Elizabeth Quay", -31.95815, 115.85627, "landmark", 3],
  ["Perth station", -31.95095, 115.85998, "landmark", 3],
  ["RAC Arena", -31.94823, 115.85207, "landmark", 3],
  ["The WACA", -31.95979, 115.87950, "landmark", 3],
  ["Heirisson Island", -31.96532, 115.88330, "landmark", 3],
  ["Claisebrook Cove", -31.95216, 115.87907, "landmark", 3],
  ["Narrows Bridge", -31.96350, 115.84691, "landmark", 3],
  ["Optus Stadium", -31.95104, 115.88908, "landmark", 3],
  ["Crown Perth", -31.95922, 115.89436, "landmark", 3],
  ["Perth Zoo", -31.97460, 115.85350, "landmark", 3],
  ["UWA", -31.97695, 115.81787, "landmark", 3],
  ["Karrakatta Cemetery", -31.96951, 115.80057, "landmark", 3],
  ["Claremont Showground", -31.97485, 115.78558, "landmark", 3],
  ["Cottesloe Beach", -31.99549, 115.75146, "landmark", 3],
  ["Scarborough Beach", -31.89574, 115.75601, "landmark", 3],
  ["Victoria Quay", -32.04976, 115.74520, "landmark", 3],
  ["Round House", -32.05612, 115.74127, "landmark", 3],
  ["Fremantle Prison", -32.05534, 115.75346, "landmark", 3],
  ["Matilda Bay", -31.98050, 115.82100, "landmark", 3],
  // Rank 4: the smallest places, for the closest views of the city. Each was checked against
  // the drawing at full zoom, and moved onto what the picture shows where they missed.
  ["Langley Park", -31.9605, 115.8668, "park", 4],
  ["Stirling Gardens", -31.95629, 115.86003, "park", 4],
  ["Supreme Court Gardens", -31.95849, 115.85992, "park", 4],
  ["Botanic Garden", -31.96500, 115.83898, "park", 4],
  ["Burswood Park", -31.9600, 115.8920, "park", 4],
  ["Forrest Place", -31.9518, 115.8590, "landmark", 4],
  ["Hay Street Mall", -31.9536, 115.8590, "landmark", 4],
  ["Yagan Square", -31.95044, 115.85878, "landmark", 4],
  ["Cultural Centre", -31.95019, 115.86100, "landmark", 4],
  ["St Mary's Cathedral", -31.95522, 115.86666, "landmark", 4],
  ["Perth Mint", -31.9567, 115.8693, "landmark", 4],
  ["Gloucester Park", -31.95676, 115.88202, "landmark", 4],
  ["Matagarup Bridge", -31.95450, 115.88493, "landmark", 4],
  ["State War Memorial", -31.96084, 115.84466, "landmark", 4],
  ["Old Swan Brewery", -31.96516, 115.84054, "landmark", 4],
  ["Mends Street Jetty", -31.97091, 115.85380, "landmark", 4],
];

function at(lat, lon) {
  const p = project(lat, lon, GROUND);
  const [x, y] = [Math.round(p.x), Math.round(p.y)];
  const inside = x >= layout.x && y >= layout.y && x < layout.x + layout.width && y < layout.y + layout.height;
  return inside ? [x, y] : null;
}

const labels = [];
const names = new Set();
for (const [name, lat, lon, kind, rank] of HAND) {
  const p = at(lat, lon);
  if (p) { labels.push([name, ...p, kind, rank]); names.add(name); }
}
for (const el of osm) {
  const name = el.tags.name;
  // "Perth Airport" is a suburb in OpenStreetMap; it reads as the airport, so it stays.
  if (names.has(name) || el.tags.place === "island") continue;
  const p = at(el.lat, el.lon);
  if (!p) continue;
  labels.push([name, ...p, el.tags.place === "town" ? "town" : "suburb", CENTRES.has(name) || el.tags.place === "town" ? 1 : 2]);
  names.add(name);
}
// ---- Features: parks, ovals, lakes, schools, golf courses, airports, stations, hospitals ----
// From one Overpass query, kept in look/out/osm-features.json (fetched once; Overpass is not
// reachable from the cloud machines, so run this on the Mac the first time). Each feature's
// rank comes from its kind and its size, so a regional park shows before a pocket park.
const FEATURE_QUERY = `[out:json][timeout:240];
(
 nwr["leisure"~"^(park|nature_reserve|golf_course|pitch|sports_centre|stadium|garden|recreation_ground)$"]["name"](${BBOX});
 nwr["natural"~"^(water|wetland)$"]["name"](${BBOX});
 nwr["amenity"~"^(school|college|university|hospital|clinic)$"]["name"](${BBOX});
 nwr["healthcare"~"^(hospital|clinic)$"]["name"](${BBOX});
 nwr["aeroway"="aerodrome"]["name"](${BBOX});
 nwr["railway"~"^(station|halt)$"]["name"](${BBOX});
 nwr["public_transport"="station"]["name"](${BBOX});
);
out tags center bb;`;

async function osmFeatures() {
  if (existsSync(FEATURES)) return JSON.parse(readFileSync(FEATURES, "utf8")).elements;
  const reply = await fetch("https://overpass-api.de/api/interpreter", { method: "POST", body: new URLSearchParams({ data: FEATURE_QUERY }), headers: { "User-Agent": "tinyperth/0.1" } });
  if (!reply.ok) throw new Error(`Overpass said ${reply.status}`);
  const data = await reply.json();
  writeFileSync(FEATURES, JSON.stringify(data));
  return data.elements;
}

/** Hectares covered by a feature's bounding box (a rough size, enough to rank by). */
function hectares(el) {
  const b = el.bounds;
  if (!b) return 0;
  const k = Math.cos(((b.minlat + b.maxlat) / 2) * Math.PI / 180);
  return ((b.maxlat - b.minlat) * 111320 * (b.maxlon - b.minlon) * 111320 * k) / 1e4;
}

const SPORT = /football|cricket|soccer|rugby|hockey|baseball|athletics|multi/;
/** [kind, rank] for a feature, or null to leave it out. */
function classify(t, ha) {
  const name = t.name;
  if (t.aeroway === "aerodrome") return /RAAF|HMAS|Airstrip|National Park/.test(name) ? null : ["airport", ha > 500 ? 1 : 4];
  if (t.railway === "station" || t.railway === "halt") return t.station === "miniature" || t.railway === "miniature_station" ? null : ["station", 3];
  if (t.public_transport === "station") return null; // bus stations and ferry terminals
  if (t.amenity === "hospital" || t.healthcare === "hospital") return /Former/.test(name) ? null : ["hospital", ha > 10 ? 3 : 4];
  if (t.amenity === "clinic" || t.healthcare === "clinic") return ["clinic", 5];
  if (t.amenity === "university") return ha < 5 ? null : ["school", ha > 50 ? 3 : 4];
  if (t.amenity === "school" || t.amenity === "college") return ["school", 5];
  if (t.leisure === "golf_course") return ["golf", ha > 80 ? 3 : 4];
  if (t.natural === "water" || t.natural === "wetland") {
    if (t.water === "river" || /River|Estuary|Water$/.test(name)) return null; // the river is labelled by hand
    if (["basin", "pool", "spring"].includes(t.water)) return null;
    return ["lake", ha > 300 ? 1 : ha > 10 ? 2 : ha > 2 ? 3 : 4];
  }
  if (t.leisure === "stadium") return ["oval", 4];
  if (t.leisure === "pitch" || t.leisure === "sports_centre") {
    if (/^(Court|Nets|Cricket nets|cricket pitch)/i.test(name) || (!SPORT.test(t.sport ?? "") && !/Oval|Reserve|Park|Field/.test(name))) return null;
    return ["oval", 5];
  }
  // Parks, reserves and gardens. Perth's ovals are mostly mapped as parks named "... Oval" or
  // "... Reserve". Regional parks are left out: they are scattered pieces, so their middle can
  // land anywhere. So are management zones and unnamed conservation parcels.
  if (/Regional Park|Management Area|Marine Park|Habitat|Unnamed|NTWA|Covenant| POS$| Other$| Zone$/.test(name)) return null;
  const oval = ha < 15 && (/Oval/.test(name) || (/Reserve$/.test(name) && !/Nature|Conservation|Bushland/.test(name)));
  return [oval ? "oval" : "park", ha > 1000 ? 1 : ha > 200 ? 2 : ha > 25 ? 3 : ha > 3 ? 4 : 5];
}

const waters = [];
const seen = new Map(labels.map((l) => [l[0].toLowerCase(), [l]]));
for (const l of labels) if (["island", "water", "park", "landmark"].includes(l[3])) waters.push(l[0]);
const features = [];
for (const el of await osmFeatures()) {
  const t = el.tags;
  const ha = hectares(el);
  const got = classify(t, ha);
  if (!got) continue;
  // Short names a local would use: no campus or department in brackets, no planning-scheme
  // codes, and nothing that is plumbing or only a tag ("Drainage sump", "cricket practice nets").
  let name = t.name.trim().replace(/\s*\([^)]*\)$/, "").replace(/ \d\(\d\)\([a-z]\) Reserve$/, "").replace(/ \d\(\d\)\([a-z]\)/, "");
  if (name === name.toLowerCase() || /[Bb]asin|[Bb]ioren|[Ss]ump|[Dd]rainage|Reclaimed|Field Station|Evacuation/.test(t.name)) continue;
  if (got[0] === "station") name = name.replace(/\b[a-z]/g, (c) => c.toUpperCase()).replace(/ station$/i, "") + " Station";
  const b = el.bounds;
  const c = el.center ?? (el.lat !== undefined ? { lat: el.lat, lon: el.lon } : b ? { lat: (b.minlat + b.maxlat) / 2, lon: (b.minlon + b.maxlon) / 2 } : null);
  if (!c) continue;
  const p = at(c.lat, c.lon);
  if (p) features.push({ name, p, kind: got[0], rank: got[1], ha });
}
// Biggest first, so where one name is mapped several times (a park in pieces), the largest piece
// is the one kept. A name already on the map within 12 km is a duplicate.
// Parks go after everything else, so a reserve named for a lake or island already labelled
// ("Forrestdale Lake Nature Reserve") can be dropped as the same place twice.
const parkish = (f) => f.kind === "park" || f.kind === "oval";
features.sort((a, b) => parkish(a) - parkish(b) || b.ha - a.ha);
for (const f of features) {
  const same = seen.get(f.name.toLowerCase()) || [];
  if (same.some((r) => Math.hypot(r[1] - f.p[0], r[2] - f.p[1]) < 40000)) continue;
  if (parkish(f) && waters.some((w) => f.name.startsWith(w))) continue;
  if (f.kind === "lake") waters.push(f.name);
  const row = [f.name, ...f.p, f.kind, f.rank];
  row.ha = f.ha;
  labels.push(row);
  seen.set(f.name.toLowerCase(), [...same, row]);
}

// The order is the page's priority: rank first, then places before features (a suburb's name
// beats a park's), then bigger features first, then nearer the CBD first.
const ORDER = { city: 0, water: 0, island: 0, town: 1, suburb: 1, airport: 2, landmark: 3, station: 3, lake: 4, park: 5, golf: 5, hospital: 6, school: 7, oval: 8, clinic: 9 };
labels.sort((a, b) => a[4] - b[4] || ORDER[a[3]] - ORDER[b[3]] || (b.ha ?? 0) - (a.ha ?? 0) || Math.hypot(a[1], a[2]) - Math.hypot(b[1], b[2]));
writeFileSync(outPath, JSON.stringify(labels).replace(/\],\[/g, "],\n["));
const count = (r) => labels.filter((l) => l[4] === r).length;
console.log(`${labels.length} labels: ${[0, 1, 2, 3, 4, 5].map((r) => `${count(r)} at rank ${r}`).join(", ")}`);
