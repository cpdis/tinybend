// Where a map pixel lands on the ground: the point its view ray first hits.
//
// Perth's water sat at one height (-31 m) everywhere, so a pixel's ground point came from
// depthAtHeight(x, y, WATER_LEVEL). Bend's Deschutes drops about 110 m across town, and
// Bachelor's ground is 1,000 m above it, so the point comes from what the pixel shows:
//   - the shot's own depth pass, when there is one: exact, including trees and roofs;
//   - otherwise the DEM, by walking the view ray down to it (render/grid.js groundUnder).
import { existsSync } from "node:fs";
import { join } from "node:path";
import { createRequire } from "node:module";
import { unproject } from "../render/camera.js";
import { loadDem } from "../render/dem.js";
import { groundUnder } from "../render/grid.js";

// sharp is installed once, with the renderer.
const sharp = createRequire(new URL("../render/", import.meta.url))("sharp");

let demPromise = null;
const dem = () => (demPromise ??= loadDem());

/** (x, y) in map pixels to { lat, lon, height } on the DEM, or null off it. */
export async function demSurface() {
  const d = await dem();
  return (x, y) => groundUnder(x, y, d);
}

/**
 * (x, y) in map pixels to { lat, lon, height } from a shot's depth pass.
 * meta is the shot's sidecar, and <folder>/<meta.id>.depth.png its depth pass at one pixel per
 * map pixel (look/quarters.js cuts one for each quarter). Pixels with no geometry, or clamped
 * at either end of the range, fall back to the DEM.
 */
export async function shotSurface(folder, meta) {
  const depthPath = join(folder, `${meta.id}.depth.png`);
  const fallback = await demSurface();
  if (!existsSync(depthPath) || !meta.depth) return { at: fallback, source: "dem" };
  const { near, far } = meta.depth;
  // A grey16 PNG must be read as one 16-bit channel: without toColourspace, sharp returns it as
  // 8-bit-range sRGB (values of about 65 to 220), and every pixel decodes to the near plane.
  const { data, info } = await sharp(depthPath).toColourspace("grey16").raw({ depth: "ushort" }).toBuffer({ resolveWithObject: true });
  const values = new Uint16Array(data.buffer, data.byteOffset, data.length / 2);
  const { x: x0, y: y0, size } = meta.window;
  const camera = meta.camera;
  return {
    source: "depth",
    at(x, y) {
      const i = Math.floor(x - x0);
      const j = Math.floor(y - y0);
      if (i < 0 || j < 0 || i >= size || j >= size) return fallback(x, y);
      const v = values[(j * info.width + i) * info.channels];
      if (v <= 1 || v >= 65535) return fallback(x, y);
      return unproject(x, y, near + ((v - 1) / 65534) * (far - near), camera);
    },
  };
}
