// Checks the city config against the code that uses it: node tests/test_city.mjs
// The DEM checks run only when render/dem/ has the tiles (node render/dem.js fetch).
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { CAMERA, project } from "../render/camera.js";

const city = JSON.parse(readFileSync(new URL("../cities/bend.json", import.meta.url), "utf8"));

// One camera: render/camera.js (which the browser imports) matches cities/bend.json.
assert.deepEqual(CAMERA, city.camera);
// Map pixel (0, 0) is the ground downtown.
const o = project(city.camera.origin.lat, city.camera.origin.lon, city.camera.origin.height);
assert.ok(Math.abs(o.x) < 1e-6 && Math.abs(o.y) < 1e-6);

// The boxes: the city widened west for Phil's trails, and Bachelor apart from it.
const { city: c, bachelor: b } = city.areas;
assert.ok(c.box.west <= -121.42 && b.box.east < c.box.west);
for (const { box } of Object.values(city.areas)) assert.ok(box.south < box.north && box.west < box.east);

const { inOutline, shotGround, layGrid } = await import("../render/grid.js");
const square = [[1, 0], [1, 1], [0, 1], [0, 0]];
assert.ok(inOutline(0.5, 0.5, square));
assert.ok(!inOutline(1.5, 0.5, square));

if (existsSync(new URL("../render/dem/", import.meta.url))) {
  const { loadDem } = await import("../render/dem.js");
  const dem = await loadDem();
  // Downtown: flat, about 1,085 m, and the plain 1 km depth range.
  const down = shotGround(0, 0, 2048, dem);
  assert.ok(down.height > 1070 && down.height < 1110, `downtown ground ${down.height}`);
  assert.ok(Math.abs(down.far - down.near - city.ground.minDepthSpanMetres) < 0.02);
  // The probe's Bachelor window, whose depth was clamped on a third of its pixels: high ground,
  // a lot of relief, and a range wider than 1 km. See writeup/journal.md, 2026-11-28.
  const summit = shotGround(-92160, 32768, 2048, dem);
  assert.ok(summit.height > 2000 && summit.relief > 300 && summit.far - summit.near > 1200, JSON.stringify({ ...summit, points: undefined }));
  // The grid: shots in both areas, none twice, all on the 2,048 px grid.
  const frames = layGrid(["city", "bachelor"], dem);
  const ids = new Set(frames.map((f) => f.id));
  assert.equal(ids.size, frames.length);
  assert.ok(frames.every((f) => f.x % 2048 === 0 && f.y % 2048 === 0 && f.near < f.far));
  assert.ok(frames.some((f) => f.area === "city") && frames.some((f) => f.area === "bachelor"));
  console.log(`city: ok (${frames.length} shots on the DEM)`);
} else console.log("city: ok (no DEM in render/dem/, DEM checks skipped)");
