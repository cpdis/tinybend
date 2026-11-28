// Builds site/landmarks/landmarks.json: what the map says when a notable building or place is
// tapped, and where on the drawing a tap finds it.
//
//   node look/landmark-cards.js [--data <folder>] [--depth <folder>] [--dem <folder>] [--out <file>] [--check]
//
//   --data   holds landmarks.json and wikidata.json, pulled on the Mac (look/out/smallsf-data;
//            its manifest.json has each query). landmarks.json is OpenStreetMap (ODbL):
//            buildings with a wikidata tag, named buildings in the inner box, sights and
//            historic places, with their outlines. wikidata.json is Wikidata (CC0): every item
//            in the map's box with a height, a year, an architect, a floor count or an English
//            Wikipedia article.
//   --depth  the render's depth shots (render/out/depth-all), for the ground under each building
//   --dem    Copernicus DEM tiles (life/out/dem), for the ground where the depth pass is gone
//   --check  measure the tap shapes against the depth pass over the city centre: of the pixels where the render shows
//            a building, how many a tap there would find it, and of the pixels a tap finds a
//            building at, how many show it
//
// Also reads site/labels/labels.json, so every landmark name on the map opens a card, and
// look/landmark-overrides.json, the small list of facts fixed by hand, each with its source.
//
// What is kept. Wikidata items and OpenStreetMap buildings that have an English Wikipedia
// article, a height, a floor count, an architect or a heritage listing, and every landmark
// name in labels.json. Mundane things (weather stations, suburbs, streets, electorates) are
// left out, and so are the kinds the place names already cover (schools, parks, lakes,
// stations), unless they have a building outline and an article.
//
// Each card's shape, in map pixels. A building is its OpenStreetMap outline, projected with the
// render's camera at the height of the ground around it, simplified, then swept up the screen
// by its height, so a tap anywhere on the drawn walls or roof finds it (site/landmarks/hit.js).
// A place without an outline is a circle on the drawing.
import { existsSync, readFileSync, readdirSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { CAMERA, project, unproject } from "../render/camera.js";
import { slug } from "../site/agent.js";
import { prepare, pickAt, inRing } from "../site/landmarks/hit.js";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const args = process.argv.slice(2);
const flag = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const DATA = flag("--data", join(ROOT, "look/out/smallsf-data"));
const DEPTH = flag("--depth", join(ROOT, "render/out/depth-all"));
const DEM = flag("--dem", join(ROOT, "life/out/dem"));
const OUT = flag("--out", join(ROOT, "site/landmarks/landmarks.json"));
const CHECK = args.includes("--check");

const GROUND = -25; // As look/labels.js: Perth's coastal plain on the ellipsoid, where no better is known.
const STOREY = 3.5; // Metres a floor, where only floors are known.
// The map's extent in map pixels, as site/index.html's LAYOUT.
const LAYOUT = { x: -132055, y: -93969, width: 253952, height: 172032 };
const inMap = (x, y) => x >= LAYOUT.x && y >= LAYOUT.y && x < LAYOUT.x + LAYOUT.width && y < LAYOUT.y + LAYOUT.height;
// Screen pixels up per metre of height: the camera's tilt over its scale.
const UP = Math.cos((CAMERA.tiltDeg * Math.PI) / 180) / CAMERA.metresPerPixel;
const M = 111320; // Metres in a degree of latitude.

const read = (path) => JSON.parse(readFileSync(path, "utf8"));
const wikidata = read(join(DATA, "wikidata.json")).results.bindings;
const osm = read(join(DATA, "landmarks.json")).elements;
const labels = read(join(ROOT, "site/labels/labels.json"));
const overrides = read(join(ROOT, "look/landmark-overrides.json"));

// ---- Kinds -----------------------------------------------------------------------------------
// Wikidata's "instance of" in plain English. The first one an item has in this list names it;
// the list runs from the particular to the general, so a "heritage site | prison" is a prison.
const KINDS = [
  ["Catholic cathedral", "Catholic cathedral"], ["Anglican cathedral", "Anglican cathedral"], ["cathedral", "Cathedral"],
  ["Catholic church building", "Catholic church"], ["Anglican church building", "Anglican church"], ["Uniting church building", "Uniting church"], ["church building", "Church"], ["chapel", "Chapel"],
  ["synagogue", "Synagogue"], ["mosque", "Mosque"], ["Buddhist temple", "Buddhist temple"], ["Hindu temple", "Hindu temple"], ["temple", "Temple"],
  ["capitol building", "Parliament house"], ["legislative building", "Parliament house"], ["Rathaus", "Town hall"], ["city hall", "Town hall"], ["town hall", "Town hall"],
  ["mint", "Mint"], ["bell tower", "Bell tower"], ["lighthouse", "Lighthouse"], ["windmill", "Windmill"], ["water tower", "Water tower"],
  ["skyscraper", "Skyscraper"], ["tower block", "Tower"], ["high-rise building", "Tower"], ["office building", "Office building"], ["apartment building", "Apartment building"],
  ["prison", "Prison"], ["courthouse", "Courthouse"], ["court", "Courthouse"], ["police station", "Police station"], ["fire station", "Fire station"],
  ["post office", "Post office"], ["bank building", "Bank"], ["customs house", "Customs house"], ["barracks", "Barracks"], ["naval base", "Naval base"], ["submarine base", "Submarine base"], ["artillery battery", "Gun battery"],
  ["state library", "State library"], ["public library", "Library"], ["library", "Library"],
  ["art museum", "Art gallery"], ["museum", "Museum"], ["zoo", "Zoo"], ["aquarium", "Aquarium"], ["planetarium", "Planetarium"],
  ["theatre building", "Theatre"], ["concert hall", "Concert hall"], ["opera house", "Opera house"], ["movie theater", "Cinema"], ["music venue", "Music venue"], ["nightclub", "Nightclub"],
  ["casino", "Casino"], ["convention center", "Convention centre"], ["multi-purpose hall", "Hall"],
  ["stadium", "Stadium"], ["arena", "Indoor arena"], ["cricket field", "Cricket ground"], ["Australian rules football playing field", "Football ground"], ["harness racing venue", "Harness racing track"], ["racecourse", "Racecourse"], ["motorsport racing track", "Speedway"], ["grandstand", "Grandstand"], ["scoreboard", "Scoreboard"], ["sports venue", "Sports ground"], ["yacht club", "Yacht club"],
  ["steel roller coaster", "Roller coaster"], ["amusement park", "Amusement park"],
  ["hotel", "Hotel"], ["pub", "Pub"], ["restaurant", "Restaurant"], ["bar", "Bar"], ["cafe", "Cafe"],
  ["shopping center", "Shopping centre"], ["department store", "Department store"], ["arcade", "Arcade"], ["market", "Market"],
  ["warehouse", "Warehouse"], ["brewery", "Brewery"], ["winery", "Winery"], ["factory", "Factory"], ["power station", "Power station"], ["combined cycle power station", "Power station"], ["pumping station", "Pumping station"],
  ["railway workshop", "Railway workshops"], ["tram depot", "Tram depot"], ["motive power depot", "Engine shed"],
  ["mansion", "Mansion"], ["homestead", "Homestead"], ["cottage", "Cottage"], ["double house", "Houses"], ["house", "House"],
  ["war memorial", "War memorial"], ["memorial", "Memorial"], ["monument", "Monument"], ["statue", "Statue"], ["bust", "Bust"], ["sculpture", "Sculpture"], ["fountain", "Fountain"],
  ["arch bridge", "Bridge"], ["cable-stayed bridge", "Bridge"], ["footbridge", "Footbridge"], ["bicycle bridge", "Footbridge"], ["railway bridge", "Railway bridge"], ["road bridge", "Road bridge"], ["bridge", "Bridge"],
  ["waterfront development", "Waterfront"], ["jetty", "Jetty"], ["pier", "Pier"], ["wharf", "Wharf"], ["harbor", "Harbour"], ["canal", "Canal"], ["dam", "Dam"], ["reservoir", "Reservoir"],
  ["railway station", "Railway station"], ["bus station", "Bus station"], ["airport", "Airport"],
  ["university", "University"], ["public university", "University"], ["school", "School"], ["high school", "School"], ["hospital", "Hospital"], ["public hospital", "Hospital"],
  ["cemetery", "Cemetery"], ["square", "Square"], ["pedestrian zone", "Pedestrian mall"], ["botanical garden", "Botanic garden"], ["urban park", "Park"], ["park", "Park"],
  ["artificial island", "Island"], ["island", "Island"], ["bay", "Bay"], ["beach", "Beach"], ["hill", "Hill"], ["remarkable tree", "Tree"], ["stairs", "Stairs"],
  ["region", "Precinct"], ["ruins", "Ruins"],
];
const KIND = new Map(KINDS);
// Types that say nothing about what a thing is.
const GENERIC = new Set(["heritage site", "historical cultural heritage site", "building", "built structure", "structure", "building complex", "historic building", "facility", "venue", "destroyed building or structure", "tourist attraction", "architectural structure", "public building", "organization", "business", ""]);
// Things that are not something to tap on a drawing.
const MUNDANE = new Set(["weather station", "suburb of Perth", "suburb", "locality", "town", "road", "street", "controlled-access highway", "highway", "electoral district of Western Australia", "electoral region of Western Australia", "local government area of Western Australia", "division of the Australian House of Representatives", "tennis tournament edition", "Hopman Cup", "sports season", "radio station", "train service", "pipe organ", "brand", "government agency", "organization", "nonprofit organization", "business", "association", "land council", "Important Bird Area", "drainage ditch", "stream", "river", "trail", "shipwreck", "ship", "preserved watercraft", "protest", "campsite", "Regions of Western Australia", "art exhibition", "exhibit", "geographic location", "street circuit", "medical organization", "academic institution", "company", "sports club", "Australian rules football club", "football club", "cricket team", "rugby union team", "basketball team", "netball team", "sports team", "event", "festival", "newspaper", "magazine", "television station", "record label", "band", "musical group", "political party", "trade union", "charity", "foundation", "project", "food", "dish", "beer", "brewery company", "film", "song", "album", "human", "family", "species", "taxon", "train", "electric multiple unit", "locomotive", "bus route", "ferry route", "railway line", "rail line"]);
// Kinds the place names already cover: kept only with a building outline and an article.
const LABELLED = new Set(["School", "University", "Hospital", "Park", "Botanic garden", "Island", "Bay", "Beach", "Railway station", "Bus station", "Airport", "Cemetery", "Sports ground", "Cricket ground", "Football ground", "Hill", "Reservoir", "Dam"]);
for (const w of ["primary school", "secondary school", "girls' school", "private school", "independent school", "community college", "higher education institution", "college", "nature reserve", "protected area", "conservation park of Australia", "national park of Australia", "national park", "marine park", "Australian marine park", "regional park", "public reserve", "conservation area", "lake", "salt lake", "wetland", "point", "golf club", "golf course", "station located on surface", "railway station in a highway median", "elevated station", "underground station", "station located in a cut", "former hospital"]) KIND.set(w, KIND.get(w) ?? "LABELLED");

/** A plain-English kind from Wikidata's types, or null. `listed` only takes kinds in the list above. */
function kindOf(types, listed = false) {
  let best = null, at = Infinity;
  for (const t of types) {
    const i = KINDS.findIndex(([w]) => w === t);
    if (i >= 0 && i < at) { at = i; best = KINDS[i][1]; }
  }
  if (best || listed) return best;
  const named = types.find((t) => !GENERIC.has(t) && !MUNDANE.has(t));
  return named ? named[0].toUpperCase() + named.slice(1) : null;
}

/** Whether Wikidata's types make an item one to leave out: every type mundane or saying nothing. */
const mundane = (types) => types.length > 0 && types.every((t) => MUNDANE.has(t) || GENERIC.has(t)) && types.some((t) => MUNDANE.has(t));
/** Whether the types are ones the place names already show (schools, parks, lakes, stations). */
const labelled = (types, kind) => LABELLED.has(kind) || types.some((t) => KIND.get(t) === "LABELLED");

/** A kind from OpenStreetMap's tags, where Wikidata has none. */
function osmKind(t) {
  const b = t.building;
  if (t.amenity === "place_of_worship") return /cathedral/.test(b ?? "") ? "Cathedral" : b === "chapel" ? "Chapel" : t.religion === "christian" || b === "church" ? "Church" : "Place of worship";
  if (t.historic === "memorial" || t.memorial) return t.memorial === "war_memorial" ? "War memorial" : "Memorial";
  if (t.historic === "monument") return "Monument";
  if (t.tourism === "museum") return "Museum";
  if (t.tourism === "gallery") return "Art gallery";
  if (t.amenity === "theatre") return "Theatre";
  if (t.amenity === "townhall") return "Town hall";
  if (t.amenity === "library") return "Library";
  if (t.amenity === "casino") return "Casino";
  if (t.amenity === "pub") return "Pub";
  if (t.tourism === "hotel") return "Hotel";
  if (t.leisure === "stadium" || b === "stadium") return "Stadium";
  if (t.man_made === "tower" || b === "tower") return "Tower";
  if (t.historic === "prison") return "Prison";
  if (t.historic === "building" || t.historic === "yes") return "Historic building";
  const OF = { office: "Office building", commercial: "Commercial building", retail: "Shops", apartments: "Apartment building", residential: "Apartment building", hotel: "Hotel", church: "Church", cathedral: "Cathedral", civic: "Civic building", public: "Public building", government: "Government building", train_station: "Railway station", house: "House", warehouse: "Warehouse", industrial: "Industrial building", university: "University building", school: "School building", hospital: "Hospital building", theatre: "Theatre", stadium: "Stadium", parking: "Car park" };
  if (OF[b]) return OF[b];
  if (t.tourism === "attraction") return "Sight";
  if (t.tourism === "viewpoint") return "Lookout";
  if (t.historic) return "Historic site";
  return b ? "Building" : null;
}

// A tall building is notable on a skyline map even with no article.
const TALL = { metres: 50, floors: 15 };
// How big a place without an outline is on the drawing, in metres, by kind.
const RADIUS = { Stadium: 120, "Indoor arena": 70, Island: 250, Waterfront: 110, "Inlet and waterfront": 110, Precinct: 90, "Arts precinct": 90, "Pedestrian mall": 70, Square: 45, Bay: 300, Beach: 160, Zoo: 200, University: 250, Cemetery: 300, Wharf: 120, Harbour: 200, Racecourse: 200, "Harness racing track": 120, "Cricket ground": 110, "Football ground": 110, "Sports ground": 110, Bridge: 70, "Road bridge": 70, "Road and rail bridge": 70, "Railway bridge": 60, Footbridge: 60, Jetty: 30, Pier: 30, Casino: 100, "Casino and resort": 100, "Convention centre": 80, Park: 120, "Botanic garden": 150, "Railway station": 60, Landmark: 60 };
const POINT = 22; // Anything else without an outline: a building-sized circle.
// How tall a building is drawn where nothing says and the depth pass can't tell, in metres: two
// or three storeys. Open places (a quay, a showground) are swept a little for their walls and sheds.
const LOW = 9;
const FLAT = new Set(["Park", "Square", "Pedestrian mall", "Wharf", "Waterfront", "Beach", "Cemetery", "Sports ground", "Cricket ground", "Football ground", "Island", "Bay", "Precinct", "Arts precinct", "Inlet and waterfront", "Sight", "Historic site", "Botanic garden"]);
const FLAT_UP = 3;

// ---- Reading the two sources -------------------------------------------------------------------
const num = (v) => { const n = parseFloat(String(v ?? "").replace(",", ".")); return Number.isFinite(n) ? n : null; };
const metres = (v) => (/^\s*[\d.]+\s*(m|metres)?\s*$/.test(String(v ?? "")) ? num(v) : null); // OSM height: metres only, no feet.
const year = (v) => { const m = /^(\d{4})/.exec(String(v ?? "")); return m ? +m[1] : null; };
const list = (v) => (v ? String(v).split("|").map((s) => s.trim()).filter(Boolean) : []);
const https = (u) => (/^https?:\/\/[^\s"<>]+$/i.test(u ?? "") ? u : null);

const items = new Map(); // QID -> Wikidata item
for (const r of wikidata) {
  const g = (k) => r[k]?.value ?? "";
  const q = g("item").split("/").pop();
  const m = /Point\(([-\d.]+) ([-\d.]+)\)/.exec(g("coord"));
  if (!m || items.has(q)) continue;
  items.set(q, {
    q, label: g("itemLabel"), lat: +m[2], lon: +m[1], types: list(g("instanceOf")),
    height: num(g("heightM")), floors: num(g("floorsAbove")), built: year(g("inceptionDate")),
    architects: list(g("architects")), heritage: list(g("heritage")),
    website: https(g("officialWebsite")), wiki: (/^https:\/\/en\.wikipedia\.org\/wiki\/(.+)$/.exec(g("enwiki")) ?? [])[1] ?? null,
  });
}

/** An OpenStreetMap element's outline as a closed ring of [lat, lon], or null. */
function outline(el) {
  if (el.type === "way" && el.geometry?.length >= 4) {
    const ring = el.geometry.map((p) => [p.lat, p.lon]);
    const [a, b] = [ring[0], ring.at(-1)];
    return a[0] === b[0] && a[1] === b[1] ? ring.slice(0, -1) : null;
  }
  if (el.type === "relation") {
    // Outer members' rings when the query asked for them; the box otherwise (the pull of
    // 2026-11-23 has boxes only, so these outlines are rough).
    const outer = (el.members ?? []).filter((m) => m.role === "outer" && m.geometry?.length >= 4);
    if (outer.length) return outer.sort((a, b) => b.geometry.length - a.geometry.length)[0].geometry.map((p) => [p.lat, p.lon]).slice(0, -1);
    const b = el.bounds;
    if (b) return [[b.maxlat, b.minlon], [b.maxlat, b.maxlon], [b.minlat, b.maxlon], [b.minlat, b.minlon]];
  }
  return null;
}
const centreOf = (ring) => [ring.reduce((s, p) => s + p[0], 0) / ring.length, ring.reduce((s, p) => s + p[1], 0) / ring.length];
const metresApart = ([a, b], [c, d]) => Math.hypot((c - a) * M, (d - b) * M * Math.cos((a * Math.PI) / 180));

const features = [];
for (const el of osm) {
  const t = el.tags ?? {};
  if (!t.name && !t.wikidata) continue;
  const ring = outline(el);
  const centre = ring ? centreOf(ring) : el.lat !== undefined ? [el.lat, el.lon] : el.bounds ? [(el.bounds.minlat + el.bounds.maxlat) / 2, (el.bounds.minlon + el.bounds.maxlon) / 2] : null;
  if (!centre) continue;
  const wiki = /^en:(.+)$/.exec(t.wikipedia ?? "")?.[1];
  features.push({
    id: `${el.type}/${el.id}`, tags: t, name: t.name ?? null, ring, centre, rough: el.type === "relation" && !(el.members ?? []).length,
    building: !!t.building && t.building !== "no" || t.man_made === "tower", q: /^Q\d+$/.test(t.wikidata ?? "") ? t.wikidata : null,
    height: metres(t.height), floors: num(t["building:levels"]), built: year(t.start_date), architects: list(t.architect?.replace(/;/g, "|")),
    heritage: t.heritage && t.heritage !== "no" ? t.heritage : null,
    website: https(t.website ?? t["contact:website"] ?? t.url), wiki: wiki ? encodeURI(wiki.replace(/ /g, "_")) : null,
  });
}

// ---- Joining them ------------------------------------------------------------------------------
const norm = (s) => String(s ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\bsaint\b/g, "st").replace(/[’']/g, "").replace(/\(.*?\)/g, " ").replace(/, (perth|western australia|fremantle)$/, "").replace(/[^a-z0-9]+/g, " ").trim();
const words = (s) => norm(s).split(" ").filter((w) => w && w !== "the");
// Extra words that make a name another thing: "Scarborough Beach Road" is not Scarborough Beach.
const OTHER = new Set(["road", "street", "avenue", "drive", "highway", "bus", "railway", "station", "school", "primary", "college", "hotel", "post", "office", "stand", "car", "parking", "jetty", "bridge", "oval", "reserve", "camp", "tower", "plaza"]);
/** How well two names match: 3 the same, under 2 when one's words are all in the other's, 0 not at all. */
function nameScore(a, b) {
  const wa = words(a), wb = words(b);
  if (!wa.length || !wb.length) return 0;
  if (wa.join(" ") === wb.join(" ")) return 3;
  const inB = wa.every((w) => wb.includes(w)), inA = wb.every((w) => wa.includes(w));
  if (!inB && !inA) return 0;
  const extra = (inB ? wb : wa).filter((w) => !(inB ? wa : wb).includes(w));
  if (extra.some((w) => OTHER.has(w))) return 0;
  return 2 - extra.length * 0.25;
}

// First by the OSM wikidata tag. Where several elements carry one QID, the one nearest Wikidata's
// own point is that item; the others are something else wrongly tagged (Fremantle's Maritime
// Museum carries the WA Museum's QID), so they lose the tag and stand on their own facts.
const byQ = new Map();
for (const f of features) if (f.q && items.has(f.q)) (byQ.get(f.q) ?? byQ.set(f.q, []).get(f.q)).push(f);
for (const [q, fs] of byQ) {
  const it = items.get(q);
  fs.sort((a, b) => metresApart(a.centre, [it.lat, it.lon]) - metresApart(b.centre, [it.lat, it.lon]) || (b.building - a.building));
  for (const f of fs.slice(1)) if (metresApart(f.centre, [it.lat, it.lon]) > 400) { f.q = null; f.wrongQ = q; }
  // Prefer a building outline over a non-building one (a museum's grounds) when both are close.
  const near = fs.filter((f) => f.q === q);
  it.feature = near.find((f) => f.building && f.ring) ?? near.find((f) => f.ring) ?? near[0];
  for (const f of near) if (f !== it.feature) f.q = null, f.duplicate = true;
}
// Then, for Wikidata items still without an outline, by name: an OpenStreetMap outline of the
// same name within 150 m that carries no QID of its own (Brookfield Place, the Round House).
const untagged = features.filter((f) => f.ring && f.name && !f.q);
for (const it of items.values()) {
  if (it.feature) continue;
  let best = null, score = 1.7;
  for (const f of untagged) {
    if (f.claimed || metresApart(f.centre, [it.lat, it.lon]) > 150) continue;
    const s = nameScore(it.label, f.name) + (f.building ? 0.1 : 0);
    if (s > score) { best = f; score = s; }
  }
  if (best) { it.feature = best; best.q = it.q; best.claimed = true; }
}

// ---- The ground under each building ------------------------------------------------------------
let groundApi = null, hasDem = false;
if (existsSync(DEPTH) || existsSync(DEM)) {
  try {
    const { makeGround } = await import("../life/ground.js");
    hasDem = existsSync(DEM) && readdirSync(DEM).some((f) => f.endsWith(".tif"));
    groundApi = await makeGround(DEPTH, DEM);
  } catch (error) {
    console.warn(`No depth or DEM (${error.message.split("\n")[0]}): every building stands at ${GROUND} m`);
  }
}
let fromDepth = 0, fromDem = 0, fromNothing = 0;
/**
 * The ground's height round a building outline: the depth pass a few metres outside each
 * corner (the street, not the roof), the lower quarter of those, so a neighbour's roof or an
 * awning doesn't lift it. The DEM where the depth pass is gone, and the coastal plain if neither.
 */
async function groundUnder(ring, centre) {
  if (groundApi) {
    const heights = [];
    for (const [lat, lon] of ring) {
      const dn = (lat - centre[0]) * M, de = (lon - centre[1]) * M * Math.cos((lat * Math.PI) / 180), d = Math.hypot(dn, de) || 1;
      const out = [lat + (dn / d) * 6 / M, lon + (de / d) * 6 / (M * Math.cos((lat * Math.PI) / 180))];
      const h = await groundApi.depthGround(out[0], out[1], hasDem ? groundApi.demGround(...out) : GROUND);
      if (h !== null) heights.push(h);
    }
    if (heights.length >= Math.min(3, ring.length)) {
      heights.sort((a, b) => a - b);
      fromDepth++;
      return heights[Math.floor((heights.length - 1) / 4)];
    }
    if (hasDem) { fromDem++; return groundApi.demGround(...centre); }
  }
  fromNothing++;
  return GROUND;
}
let measured = 0;
/**
 * How tall the render has a building, from the depth pass: the surface height at points across
 * its footprint (each found where the camera sees that spot from above), the highest tenth of
 * them less the ground. Null where the depth pass doesn't reach, or sees too little of the roof.
 */
async function measuredHeight(ring, g) {
  if (!groundApi) return null;
  const lats = ring.map((p) => p[0]), lons = ring.map((p) => p[1]);
  const [s, n, w, e] = [Math.min(...lats), Math.max(...lats), Math.min(...lons), Math.max(...lons)];
  const k = Math.cos((s * Math.PI) / 180), step = Math.max(2, Math.sqrt(((n - s) * M * (e - w) * M * k) / 150));
  const local = ring.map(([lat, lon]) => [(lon - w) * M * k, (lat - s) * M]);
  const flat = new Float64Array(local.flat());
  const heights = [];
  for (let y = step / 2; y < (n - s) * M; y += step) for (let x = step / 2; x < (e - w) * M * k; x += step) {
    if (!inRing(flat, x, y)) continue;
    const h = await groundApi.depthSurface(s + y / M, w + x / (M * k), g + 20);
    if (h !== null && h > g - 3 && h < g + 400) heights.push(h);
  }
  if (heights.length < 6) return null;
  heights.sort((a, b) => a - b);
  measured++;
  return Math.max(3, heights[Math.floor(heights.length * 0.9)] - g);
}

async function groundAt(lat, lon) {
  if (groundApi) {
    const g = await groundApi.ground(lat, lon);
    if (g.depth) { fromDepth++; return g.height; }
    if (hasDem) { fromDem++; return g.height; }
  }
  fromNothing++;
  return GROUND;
}

// ---- Shapes ------------------------------------------------------------------------------------
/** Douglas-Peucker for a closed ring: keep the corner furthest from the first, then halve each side. */
function simplifyRing(points, tolerance) {
  const n = points.length;
  if (n <= 4) return points;
  const keep = new Uint8Array(n);
  let far = 0, best = -1;
  points.forEach((p, i) => { const d = Math.hypot(p[0] - points[0][0], p[1] - points[0][1]); if (d > best) { best = d; far = i; } });
  keep[0] = keep[far] = 1;
  const stack = [[0, far], [far, n]];
  while (stack.length) {
    const [a, b] = stack.pop();
    const [ax, ay] = points[a], [bx, by] = points[b % n];
    const len = Math.hypot(bx - ax, by - ay) || 1;
    let worst = tolerance, at = -1;
    for (let i = a + 1; i < b; i++) {
      const d = Math.abs((bx - ax) * (ay - points[i][1]) - (ax - points[i][0]) * (by - ay)) / len;
      if (d > worst) { worst = d; at = i; }
    }
    if (at >= 0) { keep[at] = 1; stack.push([a, at], [at, b]); }
  }
  return points.filter((_, i) => keep[i]);
}
/** A ring of map pixels to [x0, y0, dx1, dy1, ...] in whole pixels, simplified to at most `most` corners. */
function pack(points) {
  let tol = 3, ring = simplifyRing(points, tol);
  while (ring.length > 24) ring = simplifyRing(points, (tol *= 1.6));
  const out = [];
  let px = 0, py = 0;
  for (const [x, y] of ring) {
    const rx = Math.round(x), ry = Math.round(y);
    if (out.length && rx === px && ry === py) continue;
    out.push(rx - px, ry - py);
    px = rx; py = ry;
  }
  return out;
}

// ---- Place-name labels -------------------------------------------------------------------------
const landmarkLabels = labels.filter((l) => l[3] === "landmark").map(([name, x, y]) => ({ name, x, y }));

// ---- Building each card ------------------------------------------------------------------------
const tidyLabel = (s) => s.replace(/, (Perth|Western Australia)$/, "").replace(/ \((Perth|Western Australia|skyscraper)\)$/, "");
const HERITAGE = { "State Registered Place": "State Register of Heritage Places", "listed on the Australian National Heritage List": "National Heritage List", "part of UNESCO World Heritage Site": "World Heritage Site", "Commonwealth Heritage List": "Commonwealth Heritage List", "Register of the National Estate": "Register of the National Estate" };
const OSM_HERITAGE = { 1: "World Heritage Site", 2: "National Heritage List", 4: "State Register of Heritage Places" };
const OPENS = new Set(["Stadium", "Indoor arena", "Bridge", "Footbridge", "Road bridge", "Railway bridge", "Road and rail bridge", "Railway station", "Museum", "Art gallery", "Library", "State library", "Theatre", "Zoo", "Waterfront", "Casino", "Casino and resort"]);

const cards = [];
const seenQ = new Set(), seenF = new Set();

async function card({ item, feature, label, why }) {
  const over = { ...(label && overrides.items[`label:${label.name}`]), ...(item && overrides.items[item.q]), ...(feature && overrides.items[feature.id]) };
  const has = (k) => Object.hasOwn(over, k);
  const pick = (k, ...values) => (has(k) ? over[k] : values.find((v) => v !== null && v !== undefined && !(Array.isArray(v) && !v.length)) ?? null);
  let kind = pick("kind", item && kindOf(item.types), feature && osmKind(feature.tags), label ? "Landmark" : null) ?? "Building";
  // A tower says more with what it holds; a plain building with its listing.
  const use = feature?.tags.building;
  if (!has("kind") && (kind === "Tower" || kind === "Skyscraper") && ["office", "commercial"].includes(use)) kind = "Office tower";
  if (!has("kind") && (kind === "Tower" || kind === "Skyscraper") && ["apartments", "residential"].includes(use)) kind = "Apartment tower";
  if (!has("kind") && kind === "Building" && (item?.heritage.length || feature?.heritage)) kind = "Historic building";
  const name = pick("name", label?.name, feature?.name, item && tidyLabel(item.label));
  const height = pick("height", item?.height, feature?.height);
  const floors = pick("floors", item?.floors, feature?.floors && Number.isInteger(feature.floors) ? feature.floors : null);
  const opened = pick("opened");
  const built = opened ? null : pick("built", item?.built, feature?.built);
  const architect = pick("architect", item?.architects.join(", "), feature?.architects.join(", ")) || null;
  const heritage = pick("heritage", item?.heritage.map((h) => HERITAGE[h] ?? h).join(", "), feature?.heritage ? OSM_HERITAGE[feature.heritage] ?? "Heritage listed" : null) || null;
  const wiki = pick("wikipedia", item?.wiki, feature?.wiki);
  const website = pick("website", item?.website, feature?.website);
  const qid = item?.q ?? feature?.q ?? feature?.tags.wikidata ?? null;

  // The drawn height, for the sweep: measured first, then counted floors, whatever the card shows.
  const rawHeight = over.sweepM ?? item?.height ?? feature?.height ?? ((item?.floors ?? feature?.floors) ? (item?.floors ?? feature.floors) * STOREY : null);
  const c = { name, kind };
  if (height) c.height = Math.round(height * 10) / 10;
  if (floors) c.floors = floors;
  if (opened) c.opened = opened; else if (built) c[OPENS.has(kind) ? "opened" : "built"] = built;
  if (architect) c.architect = architect;
  if (heritage) c.heritage = heritage;
  if (wiki) c.wikipedia = wiki;
  if (website) c.website = website;
  if (feature) c.osm = feature.id;
  if (qid) c.wikidata = qid;
  if (label) c.label = label.name;

  if (feature?.ring) {
    const g = (c.ground = await groundUnder(feature.ring, feature.centre));
    const pts = feature.ring.map(([lat, lon]) => { const p = project(lat, lon, g); return [p.x, p.y]; });
    c.shape = pack(pts);
    // With no height or floors known, the render's own height where the depth pass has it.
    let metresUp = rawHeight;
    if (metresUp === null && !FLAT.has(kind)) metresUp = await measuredHeight(feature.ring, g);
    c.up = Math.round((metresUp ?? (FLAT.has(kind) ? FLAT_UP : LOW)) * UP);
    if (feature.building) c.building = 1;
    if (feature.rough) c.rough = 1;
  } else {
    // A circle on the drawing: at the label where there is one (those were checked by eye
    // against the drawing), else at the item's own point on the ground.
    let x, y;
    if (label) ({ x, y } = label);
    else {
      const [lat, lon] = item ? [item.lat, item.lon] : feature.centre;
      const p = project(lat, lon, await groundAt(lat, lon));
      x = p.x; y = p.y;
    }
    c.at = [Math.round(x), Math.round(y)];
    c.r = Math.round(((over.radiusM ?? RADIUS[kind] ?? POINT)) / CAMERA.metresPerPixel);
    if (rawHeight && !RADIUS[kind]) c.up = Math.round(rawHeight * UP);
  }
  const [cx, cy] = c.at ?? [c.shape[0], c.shape[1]];
  if (!inMap(cx, cy)) return null;
  c.why = why;
  return c;
}

// 1. Every landmark name on the map: its item, by the overrides' match or by name and nearness.
const near = (a, b, d) => Math.hypot(a.x - b.x, a.y - b.y) < d;
const atGround = (lat, lon) => { const p = project(lat, lon, GROUND); return { x: p.x, y: p.y }; };
for (const label of landmarkLabels) {
  let item = null, feature = null;
  const forced = overrides.match[label.name];
  if (forced?.startsWith("Q")) item = items.get(forced) ?? null;
  else if (forced) feature = features.find((f) => f.id === forced) ?? null;
  if (!item && !feature) {
    let best = null, score = 0;
    for (const it of items.values()) {
      const s = nameScore(label.name, it.label);
      if (s > 0 && near(atGround(it.lat, it.lon), label, s >= 3 ? 3000 : 1500) && s > score) { best = it; score = s; }
    }
    item = best;
  }
  if (!item && !feature) {
    let best = null, score = 0;
    for (const f of features) {
      const s = nameScore(label.name, f.name);
      if (s > 0 && near(atGround(...f.centre), label, 1500) && s > score) { best = f; score = s; }
    }
    feature = best;
  }
  if (item) feature ??= item.feature ?? null;
  const c = await card({ item, feature, label, why: "label" });
  if (!c) continue;
  cards.push(c);
  if (item) seenQ.add(item.q);
  if (feature) seenF.add(feature.id);
}

// 2. Wikidata items that are notable, with their OpenStreetMap outline where there is one.
let skipped = { mundane: 0, labelled: 0, plain: 0, vague: 0 };
for (const it of items.values()) {
  if (seenQ.has(it.q)) continue;
  const f = it.feature ?? null;
  const notable = it.wiki || it.height || it.floors || it.architects.length || it.heritage.length || overrides.items[it.q];
  if (!notable) { skipped.plain++; continue; }
  if (mundane(it.types) && !f?.ring) { skipped.mundane++; continue; }
  const kind = kindOf(it.types);
  if (labelled(it.types, kind) && !(f?.ring && f.building && (it.wiki || f.wiki))) { skipped.labelled++; continue; }
  // Without an outline, only a thing of a kind in the list above: Wikidata's box also holds
  // ships, events, companies and crimes, which are not something to find on a drawing.
  if (!f?.ring && !kindOf(it.types, true)) { skipped.vague++; continue; }
  const c = await card({ item: it, feature: f, why: "wikidata" });
  if (!c) continue;
  cards.push(c);
  seenQ.add(it.q);
  if (f) seenF.add(f.id);
}

// 3. OpenStreetMap buildings that Wikidata didn't bring (or brought with nothing to say): with
// an article, a heritage listing, or tall enough to stand out on the skyline.
for (const f of features) {
  if (seenF.has(f.id) || f.duplicate || !f.ring || !f.building || !f.name) continue;
  if (f.q && seenQ.has(f.q)) continue;
  const tall = (f.height ?? 0) >= TALL.metres || (f.floors ?? 0) >= TALL.floors;
  if (!(f.wiki || f.heritage || tall)) continue;
  if (["parking", "garage", "school", "hospital", "university", "train_station", "transportation"].includes(f.tags.building) && !f.wiki) continue;
  const c = await card({ item: null, feature: f, why: "osm" });
  if (!c) continue;
  cards.push(c);
  seenF.add(f.id);
}

// ---- Slugs, order and writing ------------------------------------------------------------------
// Labelled landmarks first, then by size on the drawing, so the file reads from the famous down.
const size = (c) => (c.shape ? (c.up ?? 0) : (c.r ?? 0) * 2);
cards.sort((a, b) => (a.why === "label" ? 0 : 1) - (b.why === "label" ? 0 : 1) || size(b) - size(a) || a.name.localeCompare(b.name));
const slugs = new Set();
for (const c of cards) {
  let s = slug(c.name) || "landmark";
  if (slugs.has(s)) s = `${s}-${(c.wikidata ?? c.osm ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
  slugs.add(s);
  c.slug = s;
}
const KEYS = ["slug", "name", "kind", "height", "floors", "built", "opened", "architect", "heritage", "wikipedia", "website", "osm", "wikidata", "label", "building", "rough", "shape", "at", "r", "up"];
const out = cards.map((c) => Object.fromEntries(KEYS.filter((k) => c[k] !== undefined).map((k) => [k, c[k]])));
const file = {
  note: "Baked by look/landmark-cards.js from Wikidata (CC0) and OpenStreetMap (© OpenStreetMap contributors, ODbL), with look/landmark-overrides.json. Shapes in map pixels: shape is a footprint ([x0, y0, dx1, dy1, ...]) swept up the screen by up; at and r are a circle. Links: wikipedia is an en.wikipedia.org/wiki/ title, osm a way or node, wikidata a QID.",
  items: out,
};
const text = JSON.stringify(file).replace(/\},\{"slug"/g, '},\n{"slug"');
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, text + "\n");
const counts = {};
for (const c of cards) counts[c.why] = (counts[c.why] ?? 0) + 1;
console.log(`${cards.length} cards (${Object.entries(counts).map(([k, v]) => `${v} from ${k}`).join(", ")}): ${cards.filter((c) => c.shape).length} outlines, ${cards.filter((c) => c.at).length} circles. Left out of Wikidata's: ${skipped.mundane} mundane, ${skipped.labelled} already labelled, ${skipped.plain} with nothing to say, ${skipped.vague} with no outline and no kind of place.`);
console.log(`Ground: ${fromDepth} from the depth pass, ${fromDem} from the DEM, ${fromNothing} at ${GROUND} m. Heights measured from the depth pass for ${measured} buildings with none in the data.`);
console.log(`${OUT}: ${(Buffer.byteLength(text) / 1024).toFixed(1)} KB, ${(gzipSync(text, { level: 9 }).length / 1024).toFixed(1)} KB gzipped`);
const missing = landmarkLabels.filter((l) => !cards.some((c) => c.label === l.name));
if (missing.length) console.log(`Labels without a card: ${missing.map((l) => l.name).join(", ")}`);

// ---- Check against the depth pass --------------------------------------------------------------
// For each depth shot over the city centre, every 3rd pixel: which building the render shows
// there (its surface point falls inside a card's footprint, above the ground), and which a tap
// there finds. The centre is where the towers crowd each other, so it is the hard case; the whole
// map would take hours for little more.
const CBD = { x0: -4096, y0: -2048, x1: 4096, y1: 4096 };
if (CHECK && groundApi) {
  const prepared = out.map(prepare);
  const shots = readdirSync(DEPTH).filter((f) => f.endsWith(".json")).map((f) => read(join(DEPTH, f)))
    .filter(({ window: w }) => w && w.x >= CBD.x0 && w.x < CBD.x1 && w.y >= CBD.y0 && w.y < CBD.y1);
  let shown = 0, found = 0, tapped = 0, right = 0;
  const per = new Map();
  const footprints = prepared.filter((p) => p.ring && p.building);
  for (const shot of shots) {
    const { x: sx, y: sy, size: n } = shot.window;
    const here = footprints.filter((p) => p.x1 > sx && p.x0 < sx + n && p.y1 > sy && p.y0 < sy + n);
    if (!here.length) continue;
    for (let y = sy; y < sy + n; y += 3) for (let x = sx; x < sx + n; x += 3) {
      const d = await groundApi.depthAt(x, y);
      if (d === null) continue;
      const s = unproject(x, y, d);
      // The surface point back on the ground, in map pixels, at the ground of each candidate.
      let truth = null;
      for (const p of here) {
        if (x < p.x0 || x > p.x1 || y < p.y0 || y > p.y1) continue;
        const g = (p.ground ??= groundOf(p));
        if (s.height < g + 2) continue;
        const q = project(s.lat, s.lon, g);
        if (inRing(p.ring, q.x, q.y)) { truth = p; break; }
      }
      const hit = pickAt(prepared, x, y, 0)?.p ?? null;
      const tapBuilding = hit && hit.building && hit.ring ? hit : null;
      if (truth) {
        shown++;
        const r = per.get(truth.item.slug) ?? per.set(truth.item.slug, { shown: 0, found: 0 }).get(truth.item.slug);
        r.shown++;
        if (tapBuilding === truth) { found++; r.found++; }
      }
      if (tapBuilding) { tapped++; if (tapBuilding === truth) right++; }
    }
  }
  console.log(`Check against the depth pass (${shots.length} shots, every 3rd pixel): of ${shown} pixels showing a card's building, a tap finds it at ${(100 * found / Math.max(1, shown)).toFixed(1)}%. Of ${tapped} pixels where a tap finds a building, ${(100 * right / Math.max(1, tapped)).toFixed(1)}% show that building.`);
  const worst = [...per].filter(([, r]) => r.shown > 200).sort((a, b) => a[1].found / a[1].shown - b[1].found / b[1].shown).slice(0, 12);
  console.log(`Least covered: ${worst.map(([s, r]) => `${s} ${(100 * r.found / r.shown).toFixed(0)}%`).join(", ")}`);
}
/** The ground height a footprint was projected at. */
function groundOf(p) {
  return cards.find((c) => c.slug === p.item.slug)?.ground ?? GROUND;
}
