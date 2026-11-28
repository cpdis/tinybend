// Shared by the validator and the candidate list: how far a frame is from each test place.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { CAMERA, project } from "../render/camera.js";

const here = dirname(fileURLToPath(import.meta.url));
export const GROUND = -15; // Typical ground height above the ellipsoid. See render/grid.js.
export const places = JSON.parse(readFileSync(join(here, "perth.json"), "utf8"));

// A test place is a circle on the ground. On screen it becomes an ellipse, squashed in y by the
// camera's tilt, so screen distances are stretched back to ground metres before comparing.
const tests = places.filter((p) => p.kind === "test").map((p) => ({ ...p, centre: project(p.lat, p.lon, GROUND) }));
const squash = Math.sin((CAMERA.tiltDeg * Math.PI) / 180);

/** The test places a frame { x, y, size } touches, each with its distance in metres. */
export function testPlacesTouched(frame) {
  const touched = [];
  for (const t of tests) {
    // The nearest point of the frame's rectangle to the test place's centre.
    const nx = Math.min(Math.max(t.centre.x, frame.x), frame.x + frame.size);
    const ny = Math.min(Math.max(t.centre.y, frame.y), frame.y + frame.size);
    const metres = Math.hypot(nx - t.centre.x, (ny - t.centre.y) / squash) * CAMERA.metresPerPixel;
    if (metres < t.radius) touched.push({ id: t.id, radius: t.radius, metres });
  }
  return touched;
}
