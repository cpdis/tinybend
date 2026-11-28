// Checks places/perth.json, and that no training frame touches a test place.
//
//   node places/validate.js [frames.json ...]
//
// A frames file is a list of { id, x, y, size } windows in map pixels. Exits 1 on any fault.
import { readFileSync } from "node:fs";
import { places, testPlacesTouched } from "./test-places.js";

const KINDS = ["landmark", "hard", "test"];
const faults = [];
const seen = new Set();
for (const p of places) {
  if (seen.has(p.id)) faults.push(`${p.id}: id used twice`);
  seen.add(p.id);
  if (!KINDS.includes(p.kind)) faults.push(`${p.id}: kind "${p.kind}" is not one of ${KINDS.join(", ")}`);
  if (!(p.lat < -31.8 && p.lat > -32.1 && p.lon > 115.7 && p.lon < 115.95)) faults.push(`${p.id}: position is outside Perth`);
  if (p.kind === "test" && !(p.radius > 0)) faults.push(`${p.id}: a test place needs a radius in metres`);
}

let checked = 0;
for (const file of process.argv.slice(2)) {
  for (const frame of JSON.parse(readFileSync(file, "utf8"))) {
    checked++;
    for (const t of testPlacesTouched(frame)) {
      faults.push(`${file}: frame ${frame.id} is ${Math.round(t.metres)} m from test place ${t.id} (radius ${t.radius} m)`);
    }
  }
}

console.log(`${places.length} places, ${places.filter((p) => p.kind === "test").length} test places, ${checked} frames checked, ${faults.length} faults`);
for (const fault of faults.slice(0, 20)) console.log(`  ${fault}`);
process.exit(faults.length ? 1 : 0);
