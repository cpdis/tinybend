// Looks up each place's position in OpenStreetMap (Nominatim) and writes places/perth.json.
// Positions are then checked by eye on the landmark sheet: a lookup can land on the wrong thing.
//
//   node places/lookup.js
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const CACHE = join(here, "lookup-cache.json");
const VIEWBOX = "115.70,-31.86,115.95,-32.08"; // The map area with margin, so a search can't leave Perth.

// kind is a closed set: landmark, hard or test. world marks places that are also on world.cpd.dev.
// radius is in metres and only test places have one: no training frame may touch that circle.
// at overrides the lookup, where the lookup landed on the wrong spot: mid-lake, or a suburb's centre.
const PLACES = [
  ["elizabeth-quay", "Elizabeth Quay and the Bell Tower", "The Bell Tower, Perth", "landmark"],
  ["st-georges-terrace", "St Georges Terrace towers", "Central Park, St Georges Terrace, Perth", "landmark"],
  ["perth-station", "Perth station, Yagan Square and City Link", "Yagan Square, Perth", "landmark", { world: true }],
  ["cultural-centre", "Perth Cultural Centre", "WA Museum Boola Bardip, Perth", "landmark"],
  ["government-house", "Government House, Stirling Gardens and Council House", "Council House, Perth", "landmark"],
  ["rac-arena", "RAC Arena", "RAC Arena, Perth", "landmark"],
  ["waca", "WACA Ground", "WACA Ground, East Perth", "landmark"],
  ["heirisson-island", "Langley Park, Point Fraser, Heirisson Island and the Causeway", "Heirisson Island, Perth", "landmark"],
  ["claisebrook-cove", "Claisebrook Cove", "Claisebrook Cove, East Perth", "landmark", { world: true }],
  ["narrows", "Narrows Bridge and the Kwinana Freeway interchange", "Narrows Bridge, Perth", "landmark"],
  ["swan-brewery", "Old Swan Brewery and Mounts Bay Road", "Old Swan Brewery, Perth", "landmark"],
  ["south-perth", "South Perth foreshore, Mends Street Jetty and Perth Zoo", "Mends Street Jetty, South Perth", "landmark", { world: true }],
  ["optus-stadium", "Optus Stadium, Matagarup Bridge and Chevron Parkland", "Optus Stadium, Burswood", "landmark", { world: true }],
  ["crown-perth", "Crown Perth and Burswood Park", "Crown Perth, Burswood", "landmark"],
  ["war-memorial", "State War Memorial and Fraser Avenue", "State War Memorial, Kings Park", "landmark", { world: true }],
  ["botanic-garden", "Botanic Garden, Federation Walkway and DNA Tower", "Lotterywest Federation Walkway, Kings Park", "landmark"],
  ["uwa", "UWA, Winthrop Hall, Matilda Bay and the Royal Perth Yacht Club", "Winthrop Hall, Crawley", "landmark"],
  ["lake-monger", "Lake Monger", "Lake Monger, Wembley", "landmark", { world: true, at: [-31.9318, 115.8318] }],
  ["subiaco", "Subiaco: Rokeby Road and the old Subiaco Oval site", "Subiaco Oval, Subiaco", "landmark", { world: true }],
  ["karrakatta", "Karrakatta Cemetery", "Karrakatta Cemetery", "landmark"],
  ["claremont-showground", "Claremont Showground and Lake Claremont", "Claremont Showgrounds, Claremont", "landmark"],
  ["cottesloe", "Cottesloe: Indiana Tea House, the groyne and the beachfront", "Indiana, Marine Parade, Cottesloe", "landmark", { world: true }],
  ["scarborough", "Scarborough beachfront and Scarborough Beach Pool", "Scarborough Beach Pool, Scarborough", "landmark", { world: true }],
  ["city-beach", "City Beach and the Bold Park dunes", "City Beach, Western Australia", "landmark", { at: [-31.9387, 115.7562] }],
  ["fremantle-port", "Fremantle Port: Victoria Quay and North Quay", "Victoria Quay, Fremantle", "landmark", { world: true }],
  ["round-house", "Round House, Bathers Beach and the Fishing Boat Harbour", "Round House, Fremantle", "landmark"],
  ["fremantle-prison", "Fremantle Prison and Fremantle Markets", "Fremantle Prison", "landmark"],
  ["fremantle-bridges", "Stirling Bridge and the Fremantle Traffic Bridge", "Fremantle Traffic Bridge", "landmark"],
  ["herdsman-lake", "Herdsman Lake", "Herdsman Lake", "test", { radius: 1300 }],
  ["point-walter", "Point Walter spit", "Point Walter, Bicton", "test", { radius: 700 }],
  ["floreat", "Floreat", "Floreat, Western Australia", "test", { radius: 1400 }],
  ["osborne-park", "Osborne Park", "Osborne Park, Western Australia", "test", { radius: 1600 }],
];

const cache = existsSync(CACHE) ? JSON.parse(readFileSync(CACHE, "utf8")) : {};
const places = [];
for (const [id, name, query, kind, extra = {}] of PLACES) {
  if (!cache[query]) {
    const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&bounded=1&viewbox=${VIEWBOX}&q=${encodeURIComponent(query)}`;
    const found = await (await fetch(url, { headers: { "User-Agent": "tinyperth/0.1" } })).json();
    cache[query] = found[0] ? { lat: +found[0].lat, lon: +found[0].lon, osm: found[0].display_name } : null;
    writeFileSync(CACHE, JSON.stringify(cache, null, 2));
    await new Promise((r) => setTimeout(r, 1100)); // Nominatim allows one request a second.
  }
  const { at, ...rest } = extra;
  const hit = at ? { lat: at[0], lon: at[1], osm: "set by hand" } : cache[query];
  if (!hit) {
    console.log(`NOT FOUND: ${id} (${query})`);
    continue;
  }
  places.push({ id, name, lat: +hit.lat.toFixed(5), lon: +hit.lon.toFixed(5), kind, ...rest });
  console.log(`${id}: ${hit.lat.toFixed(4)}, ${hit.lon.toFixed(4)}  ${hit.osm.slice(0, 70)}`);
}
writeFileSync(join(here, "perth.json"), `${JSON.stringify(places, null, 2)}\n`);
console.log(`${places.length} of ${PLACES.length} places written`);
