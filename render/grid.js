// Lays the shot grid over the map's areas and writes it as a frames file for shoot.js.
// Every shot is a whole number of shots from pixel (0, 0), so neighbours meet with no gap or
// overlap, and the city and Mt. Bachelor share one grid (cities/bend.json, areas).
//
//   node render/grid.js [--area city|bachelor|all] [--size 2048] [--out render/frames/bend.json]
//                       [--skip render/frames/old.json] [--svg writeup/images/<step>/grid.svg]
//
// Bend's ground runs from about 1,000 m to 2,760 m, so one ground height for the whole map
// (Perth's GROUND) no longer works. Each shot's ground comes from the Copernicus DEM
// (render/dem.js), found where each view ray meets the DEM:
//   - the area test uses the true ground point under each lattice pixel, so a shot on the
//     mountain is kept or dropped by where its pixels really land;
//   - the depth range (near, far) spans the lattice's ground plus margins, at least
//     minDepthSpanMetres wide, and wider where the shot's relief needs it.
// Frames carry height (median ground), relief, near and far; shoot.js uses near and far.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { project, unproject, depthAtHeight } from "./camera.js";
import { CITY, loadDem } from "./dem.js";

const LATTICE = 16; // Lattice steps across a shot: 17 x 17 points, 128 px (about 38 m) apart at 2,048 px.

const box = (a) => [[a.north, a.west], [a.north, a.east], [a.south, a.east], [a.south, a.west]];
/** Each area is a list of outlines, and each outline is a list of [lat, lon] corners. */
export const AREAS = Object.fromEntries(Object.entries(CITY.areas).map(([name, a]) => [name, a.outlines ?? [box(a.box)]]));

/** True when the point is inside the outline: a ray from it crosses the edge an odd number of times. */
export function inOutline(lat, lon, outline) {
  let inside = false;
  for (let i = 0, j = outline.length - 1; i < outline.length; j = i++) {
    const [[latA, lonA], [latB, lonB]] = [outline[i], outline[j]];
    if (latA > lat !== latB > lat && lon < ((lonB - lonA) * (lat - latA)) / (latB - latA) + lonA) inside = !inside;
  }
  return inside;
}

const TOP = 3300; // Above Bachelor's summit (2,740 m on the ellipsoid): every ray starts in clear air.
const BOTTOM = 800; // Below Bend's lowest ground.
const STEP = 15; // Metres along the ray per step: half the DEM's 30 m spacing.

/**
 * Where the view ray through pixel (x, y) first meets the ground, as { lat, lon, height, depth },
 * or null off the DEM. The ray is walked from above the highest ground towards the camera's
 * far side in 15 m steps, and the first step that goes below the DEM is refined by bisection.
 * Walking from the camera side finds the surface the camera sees: the crest of a ridge or the
 * rim of a cliff, never ground hidden behind it. (A fixed-point search on height, tried first,
 * could settle on that hidden ground behind slopes steeper than 45 degrees, and converged slowly
 * on slopes facing away from the camera: Gemini review, 2026-11-28.)
 */
export function groundUnder(x, y, dem) {
  const near = depthAtHeight(x, y, TOP);
  const far = depthAtHeight(x, y, BOTTOM);
  const above = (depth) => {
    const p = unproject(x, y, depth);
    const ground = dem.height(p.lat, p.lon);
    return ground === null ? null : p.height - ground;
  };
  let a = near;
  let fa = above(a);
  if (fa === null) return null;
  for (let b = near + STEP; b <= far + STEP; b += STEP) {
    const fb = above(b);
    if (fb === null) return null;
    if (fb <= 0) {
      // The ray crossed the ground between a and b.
      let lo = a, hi = b;
      for (let i = 0; i < 20 && hi - lo > 0.05; i++) {
        const mid = (lo + hi) / 2;
        const fm = above(mid);
        if (fm === null) return null;
        if (fm > 0) lo = mid;
        else hi = mid;
      }
      const depth = (lo + hi) / 2;
      return { ...unproject(x, y, depth), depth };
    }
    a = b;
    fa = fb;
  }
  return null;
}

/**
 * Ground and depth range for a shot window, from a lattice of ground points across it.
 * Returns { points, height, relief, near, far }, or null if the window is wholly off the DEM.
 */
export function shotGround(x0, y0, size, dem, g = CITY.ground) {
  const points = [];
  for (let j = 0; j <= LATTICE; j++) {
    for (let i = 0; i <= LATTICE; i++) {
      const x = x0 + (i / LATTICE) * size;
      const y = y0 + (j / LATTICE) * size;
      const p = groundUnder(x, y, dem);
      if (p) points.push({ x, y, ...p });
    }
  }
  if (!points.length) return null;
  const heights = points.map((p) => p.height).sort((a, b) => a - b);
  // Higher ground is nearer the camera: near from the top of each point's margin, far from the bottom.
  let near = Math.min(...points.map((p) => depthAtHeight(p.x, p.y, p.height + g.depthAboveMetres)));
  let far = Math.max(...points.map((p) => depthAtHeight(p.x, p.y, p.height - g.depthBelowMetres)));
  if (far - near < g.minDepthSpanMetres) {
    const grow = (g.minDepthSpanMetres - (far - near)) / 2;
    near -= grow;
    far += grow;
  }
  return {
    points,
    height: Math.round(heights[heights.length >> 1] * 10) / 10,
    relief: Math.round(heights[heights.length - 1] - heights[0]),
    near: Math.round(near * 100) / 100,
    far: Math.round(far * 100) / 100,
  };
}

/** The frames for the named areas: every shot with a lattice ground point inside an area. */
export function layGrid(names, dem, size = CITY.shotSize, skip = new Set()) {
  const frames = [];
  const seen = new Set();
  for (const name of names) {
    const outlines = AREAS[name];
    if (!outlines) throw new Error(`no area "${name}" in cities/bend.json (have ${Object.keys(AREAS).join(", ")})`);
    // The outline's corners in pixel space at the area's lowest and highest ground: high ground
    // shows up higher on screen, so the candidate range covers both.
    const corners = [];
    for (const outline of outlines) {
      for (const [lat, lon] of outline) for (const h of [900, 2900]) corners.push(project(lat, lon, h));
    }
    const cols = corners.map((c) => Math.floor(c.x / size));
    const rows = corners.map((c) => Math.floor(c.y / size));
    for (let row = Math.min(...rows) - 1; row <= Math.max(...rows) + 1; row++) {
      for (let col = Math.min(...cols) - 1; col <= Math.max(...cols) + 1; col++) {
        const id = `c${col}_r${row}`;
        if (seen.has(id) || skip.has(id)) continue;
        const ground = shotGround(col * size, row * size, size, dem);
        if (!ground) continue;
        if (!ground.points.some((p) => outlines.some((o) => inOutline(p.lat, p.lon, o)))) continue;
        seen.add(id);
        const { height, relief, near, far } = ground;
        frames.push({ id, area: name, x: col * size, y: row * size, size, height, relief, near, far });
      }
    }
  }
  return frames;
}

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const size = Number(arg("--size", CITY.shotSize));
  const out = arg("--out", "render/frames/bend.json");
  const svgPath = arg("--svg", null);
  const area = arg("--area", "all");
  const names = area === "all" ? Object.keys(AREAS) : area.split(",");
  const skipPath = arg("--skip", null);
  const skip = new Set(skipPath ? JSON.parse(readFileSync(skipPath, "utf8")).map((f) => f.id) : []);

  const dem = await loadDem();
  const frames = layGrid(names, dem, size, skip);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, `${JSON.stringify(frames)}\n`);
  for (const name of names) {
    const mine = frames.filter((f) => f.area === name);
    const hs = mine.map((f) => f.height);
    const wide = mine.filter((f) => f.far - f.near > CITY.ground.minDepthSpanMetres + 0.01).length;
    console.log(
      `${name}: ${mine.length} shots of ${size} px, ground ${Math.min(...hs).toFixed(0)} to ${Math.max(...hs).toFixed(0)} m, ` +
        `most relief ${Math.max(...mine.map((f) => f.relief))} m, ${wide} with a depth range wider than ${CITY.ground.minDepthSpanMetres} m`,
    );
  }
  console.log(`${frames.length} shots in all, ${((frames.length * size * size) / 1e9).toFixed(2)} billion pixels`);

  if (svgPath) {
    // A small picture of the grid for the write-up: one square per shot, shaded by ground height,
    // with each area's outline at its median ground height.
    const k = 6 / size; // 6 SVG units per shot.
    const xs = frames.map((f) => f.x);
    const ys = frames.map((f) => f.y);
    const [minX, minY] = [Math.min(...xs), Math.min(...ys)];
    const at = (x, y) => [(x - minX) * k + 10, (y - minY) * k + 10];
    const [lo, hi] = [Math.min(...frames.map((f) => f.height)), Math.max(...frames.map((f) => f.height))];
    const shade = (h) => {
      const t = (h - lo) / Math.max(1, hi - lo);
      const mix = (a, b) => Math.round(a + (b - a) * t);
      return `rgb(${mix(159, 120)},${mix(211, 110)},${mix(214, 150)})`;
    };
    const squares = frames.map((f) => { const [x, y] = at(f.x, f.y); return `<rect x="${x}" y="${y}" width="5.4" height="5.4" fill="${shade(f.height)}"/>`; }).join("");
    const outlines = names.flatMap((name) => {
      const mine = frames.filter((f) => f.area === name).map((f) => f.height).sort((a, b) => a - b);
      const h = mine[mine.length >> 1];
      return AREAS[name].map((o) => `<polygon points="${o.map(([lat, lon]) => at(project(lat, lon, h).x, project(lat, lon, h).y).map((v) => v.toFixed(1)).join(",")).join(" ")}" fill="none" stroke="#b4452c" stroke-width="1.2"/>`);
    }).join("");
    const [w, h] = [(Math.max(...xs) - minX) * k + 26, (Math.max(...ys) - minY) * k + 26];
    mkdirSync(dirname(svgPath), { recursive: true });
    writeFileSync(
      svgPath,
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h + 22}" font-family="Helvetica, Arial, sans-serif" font-size="9"><rect width="100%" height="100%" fill="#ffffff"/>${squares}${outlines}<text x="10" y="${h + 14}" fill="#17211f">${frames.length} shots of ${size} px, darker where the ground is higher (${lo.toFixed(0)} to ${hi.toFixed(0)} m). Red: the map areas.</text></svg>\n`,
    );
  }
}
