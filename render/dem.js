// Ground heights for Bend from the Copernicus DEM GLO-30 (ESA, free with credit).
//
//   node render/dem.js fetch            download the city's DEM tiles into render/dem/ (ignored)
//   node render/dem.js at 44.0582 -121.3153
//
// GLO-30 is a 30 m grid of surface heights (roofs and treetops included) above the EGM2008
// geoid. The render works in heights above the WGS84 ellipsoid, so every height read here has
// the city's geoidOffset added (cities/bend.json, ground.geoidOffset, measured on the probe).
//
// Node only: the browser renderer never needs it.
import { existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { fromFile } from "geotiff";

const here = dirname(fileURLToPath(import.meta.url));
export const CITY = JSON.parse(readFileSync(join(here, "..", "cities", "bend.json"), "utf8"));
export const DEM_FOLDER = join(here, "dem");

/** Download any of the city's DEM tiles that are not on disk yet. */
export async function fetchDem(folder = DEM_FOLDER) {
  mkdirSync(folder, { recursive: true });
  for (const name of CITY.ground.demTiles) {
    const path = join(folder, `${name}.tif`);
    if (existsSync(path)) continue;
    const url = CITY.ground.demUrl.replaceAll("{name}", name);
    const reply = await fetch(url);
    if (!reply.ok) throw new Error(`${name}: HTTP ${reply.status}`);
    await writeFile(path, Buffer.from(await reply.arrayBuffer()));
    console.log(`fetched ${name}`);
  }
}

/**
 * Loads every DEM tile in the folder and returns a sampler. Heights come back above the WGS84
 * ellipsoid, bilinear between the 30 m posts, or null outside every tile.
 */
export async function loadDem(folder = DEM_FOLDER, geoidOffset = CITY.ground.geoidOffset) {
  const names = existsSync(folder) ? readdirSync(folder).filter((f) => f.endsWith(".tif")) : [];
  // Every tile the city needs must be there: a missing one would silently drop the shots over it.
  const missing = CITY.ground.demTiles.filter((name) => !names.includes(`${name}.tif`));
  if (missing.length) throw new Error(`DEM tiles missing from ${folder}: ${missing.join(", ")}. Run node render/dem.js fetch`);
  const tiles = [];
  for (const name of names) {
    const image = await (await fromFile(join(folder, name))).getImage();
    const [west, south, east, north] = image.getBoundingBox();
    const [data] = await image.readRasters();
    tiles.push({ west, south, east, north, width: image.getWidth(), height: image.getHeight(), data });
  }
  /** Raw DEM height (above the geoid), or null outside every tile. */
  function raw(lat, lon) {
    const t = tiles.find((t) => lat >= t.south && lat < t.north && lon >= t.west && lon < t.east);
    if (!t) return null;
    // Pixel-is-area: post centres sit half a pixel in from the edges.
    const fx = ((lon - t.west) / (t.east - t.west)) * t.width - 0.5;
    const fy = ((t.north - lat) / (t.north - t.south)) * t.height - 0.5;
    const x0 = Math.max(0, Math.min(t.width - 2, Math.floor(fx)));
    const y0 = Math.max(0, Math.min(t.height - 2, Math.floor(fy)));
    const ax = Math.min(1, Math.max(0, fx - x0));
    const ay = Math.min(1, Math.max(0, fy - y0));
    const at = (x, y) => t.data[y * t.width + x];
    const top = at(x0, y0) * (1 - ax) + at(x0 + 1, y0) * ax;
    const bottom = at(x0, y0 + 1) * (1 - ax) + at(x0 + 1, y0 + 1) * ax;
    return top * (1 - ay) + bottom * ay;
  }
  const height = (lat, lon) => {
    const h = raw(lat, lon);
    return h === null ? null : h + geoidOffset;
  };
  return { height, raw, tiles: tiles.length };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [command, lat, lon] = process.argv.slice(2);
  if (command === "fetch") await fetchDem();
  else if (command === "at") {
    const dem = await loadDem();
    const h = dem.height(Number(lat), Number(lon));
    console.log(h === null ? "outside the DEM" : `${h.toFixed(1)} m above the ellipsoid (${dem.raw(Number(lat), Number(lon)).toFixed(1)} m above the geoid)`);
  } else console.log("usage: node render/dem.js fetch | at <lat> <lon>");
}

let shared = null;
/**
 * A geodetic point to map pixels on its own ground, for scripts that place things by
 * latitude and longitude (places, training sets). Perth used one ground height for all of them.
 */
export async function groundProjector(folder = DEM_FOLDER) {
  shared ??= loadDem(folder);
  const dem = await shared;
  const { project } = await import("./camera.js");
  return (lat, lon) => {
    const h = dem.height(lat, lon);
    if (h === null) throw new Error(`${lat}, ${lon} is outside the DEM tiles in ${folder}`);
    return project(lat, lon, h);
  };
}
