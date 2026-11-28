// Trims the general frames: a look group whose picks are all featureless (open water, or the
// flat colour Google shows far out to sea) keeps one frame, not five. The teacher learns
// nothing from five drawings of a flat blue square.
//
//   node places/trim.js render/out/perth places/general-frames.json
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { cropWindow } from "../render/crop.js";

const sharp = createRequire(new URL("../render/", import.meta.url))("sharp");
const PLAIN = 6; // Brightness spread (standard deviation, 0 to 255) below which a frame counts as featureless.

const [renders, file] = process.argv.slice(2);
const frames = JSON.parse(readFileSync(file, "utf8"));
for (const frame of frames) {
  const { channels } = await sharp(await cropWindow(renders, frame)).greyscale().stats();
  frame.spread = +channels[0].stdev.toFixed(1);
}
const groups = Map.groupBy(frames, (f) => f.group);
const kept = [];
let plainGroups = 0;
for (const members of groups.values()) {
  const plain = members.every((f) => f.spread < PLAIN);
  if (plain) plainGroups++;
  kept.push(...(plain ? members.slice(0, 1) : members));
}
writeFileSync(file, `${JSON.stringify(kept)}\n`);
console.log(`${groups.size} groups, ${plainGroups} featureless; kept ${kept.length} of ${frames.length} frames`);
