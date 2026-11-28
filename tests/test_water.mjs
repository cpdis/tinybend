// Checks the OSM water lookup on hand-made data: node tests/test_water.mjs
import assert from "node:assert/strict";
import { waterLookup } from "../look/osm-water.js";

const square = (lat, lon, d, id) => ({
  type: "way",
  id,
  tags: { natural: "water" },
  geometry: [[lat, lon], [lat + d, lon], [lat + d, lon + d], [lat, lon + d], [lat, lon]].map(([a, b]) => ({ lat: a, lon: b })),
});
const line = (lat, id, tags) => ({ type: "way", id, tags, geometry: [{ lat, lon: -121.3 }, { lat, lon: -121.29 }] });

const isWater = await waterLookup({
  elements: [
    // The same pond drawn twice must stay water: each outline is tested on its own.
    square(44.05, -121.32, 0.002, 1),
    square(44.05, -121.32, 0.002, 2),
    // A canal line with no width tag counts 4 m either side (default 8 m wide).
    line(44.07, 3, { waterway: "canal" }),
    // A canal with a width tag uses it: 20 m wide, so 10 m either side.
    line(44.075, 4, { waterway: "canal", width: "20" }),
    // A culverted canal is not open water.
    line(44.08, 5, { waterway: "canal", tunnel: "culvert" }),
  ],
});

const metres = (m) => m / 111_132;
assert.equal(isWater(44.051, -121.319), true, "inside a pond drawn twice");
assert.equal(isWater(44.053, -121.319), false, "beside the pond");
assert.equal(isWater(44.07 + metres(3), -121.295), true, "3 m from a canal line");
assert.equal(isWater(44.07 + metres(6), -121.295), false, "6 m from a canal line");
assert.equal(isWater(44.075 + metres(8), -121.295), true, "8 m from a 20 m canal");
assert.equal(isWater(44.08, -121.295), false, "on a culverted canal");
console.log("water: ok");
