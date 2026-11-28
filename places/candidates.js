// Lists every 512 px quarter of the full render that a general training frame may come from:
// all of them, less any that touch a test place.
//
//   node places/candidates.js render/frames/perth.json places/quarter-candidates.json
import { readFileSync, writeFileSync } from "node:fs";
import { testPlacesTouched } from "./test-places.js";

const QUARTER = 512; // Map pixels. Each is enlarged 2x for the teacher. See the 2026-11-10 journal entry.

const [framesFile, out] = process.argv.slice(2);
const candidates = [];
let dropped = 0;
for (const shot of JSON.parse(readFileSync(framesFile, "utf8"))) {
  for (let y = shot.y; y < shot.y + shot.size; y += QUARTER) {
    for (let x = shot.x; x < shot.x + shot.size; x += QUARTER) {
      const frame = { id: `q_${x / QUARTER}_${y / QUARTER}`, shot: shot.id, x, y, size: QUARTER };
      if (testPlacesTouched(frame).length) dropped++;
      else candidates.push(frame);
    }
  }
}
writeFileSync(out, `${JSON.stringify(candidates)}\n`);
console.log(`${candidates.length} candidate quarters, ${dropped} dropped for touching a test place`);
