// Cuts any window of the map out of the grid of shots, joining shots where the window crosses them.
//
//   import { cropWindow } from "./crop.js";
//   const png = await cropWindow("render/out/bend", { x: -1020, y: 1564, size: 1024 });
import { existsSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";

const SHOT = 2048; // Shot size in the full render. Shot c{col}_r{row} covers x from col * SHOT, y from row * SHOT.

/**
 * A PNG buffer of the window, or null when part of it lies outside the rendered area.
 * With allowGaps, the missing part is left black, for overview pictures at the map's edge.
 */
export async function cropWindow(dir, { x, y, size }, { allowGaps = false } = {}) {
  const pieces = [];
  for (let row = Math.floor(y / SHOT); row * SHOT < y + size; row++) {
    for (let col = Math.floor(x / SHOT); col * SHOT < x + size; col++) {
      const file = join(dir, `c${col}_r${row}.png`);
      if (!existsSync(file)) {
        if (allowGaps) continue;
        return null;
      }
      // The part of this shot that falls inside the window, in the shot's own pixels.
      const left = Math.max(x, col * SHOT);
      const top = Math.max(y, row * SHOT);
      const width = Math.min(x + size, (col + 1) * SHOT) - left;
      const height = Math.min(y + size, (row + 1) * SHOT) - top;
      const input = await sharp(file)
        .extract({ left: left - col * SHOT, top: top - row * SHOT, width, height })
        .png()
        .toBuffer();
      pieces.push({ input, left: left - x, top: top - y });
    }
  }
  return sharp({ create: { width: size, height: size, channels: 3, background: "#000000" } })
    .composite(pieces)
    .png()
    .toBuffer();
}
