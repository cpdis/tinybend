// Proves the renderer's three promises from saved shots:
//   1. Shots on the lattice line up to the pixel.
//   2. Depth edges fall on colour edges.
//   3. Depth converts back to true heights in metres.
//
//   node render/verify.js render/out/proof
import { readFileSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import { CAMERA, cameraBasis } from "./camera.js";

const dir = process.argv[2];

async function loadColour(id) {
  const { data, info } = await sharp(join(dir, `${id}.png`)).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, size: info.width };
}

/** Depth in metres per pixel, NaN where there is no geometry. */
async function loadDepth(id) {
  const meta = JSON.parse(readFileSync(join(dir, `${id}.json`), "utf8"));
  const { data, info } = await sharp(join(dir, `${id}.depth.png`)).toColourspace("grey16").raw({ depth: "ushort" }).toBuffer({ resolveWithObject: true });
  const raw = new Uint16Array(data.buffer, data.byteOffset, data.length / 2);
  const step = info.channels;
  const out = new Float64Array(info.width * info.height);
  const { near, far } = meta.depth;
  for (let i = 0; i < out.length; i++) {
    const v = raw[i * step];
    out[i] = v === 0 ? NaN : near + ((v - 1) / 65534) * (far - near);
  }
  return { depth: out, size: info.width, meta };
}

// 1. A shot that straddles two neighbours must repeat their pixels.
async function checkLattice() {
  const a = await loadColour("adj-a");
  const b = await loadColour("adj-b");
  const c = await loadColour("adj-c");
  const size = a.size;
  const half = size / 2;
  let same = 0;
  let exact = 0;
  let total = 0;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      // c starts half a frame into a, so its left half is a's right half.
      const source = x < half ? a : b;
      const sx = x < half ? x + half : x - half;
      const i = (y * size + x) * 3;
      const j = (y * size + sx) * 3;
      const diff = Math.max(
        Math.abs(c.data[i] - source.data[j]),
        Math.abs(c.data[i + 1] - source.data[j + 1]),
        Math.abs(c.data[i + 2] - source.data[j + 2]),
      );
      total++;
      if (diff <= 8) same++;
      if (diff === 0) exact++;
    }
  }
  console.log(`lattice: ${((same / total) * 100).toFixed(2)}% of ${total} pixels within 8 levels, ${((exact / total) * 100).toFixed(2)}% identical`);
}

// 2. Compare strong depth edges with colour edges, at zero offset and at a shifted control.
async function checkEdges(id) {
  const colour = await loadColour(id);
  const { depth, size } = await loadDepth(id);
  const luma = new Float32Array(size * size);
  for (let i = 0; i < luma.length; i++) {
    luma[i] = 0.299 * colour.data[i * 3] + 0.587 * colour.data[i * 3 + 1] + 0.114 * colour.data[i * 3 + 2];
  }
  const COLOUR_EDGE = 30;
  const DEPTH_EDGE = 3; // Metres.
  const colourEdge = new Uint8Array(size * size);
  for (let y = 1; y < size - 1; y++) {
    for (let x = 1; x < size - 1; x++) {
      const i = y * size + x;
      const g = Math.max(Math.abs(luma[i + 1] - luma[i - 1]), Math.abs(luma[i + size] - luma[i - size]));
      colourEdge[i] = g >= COLOUR_EDGE ? 1 : 0;
    }
  }
  const score = (shift) => {
    let hit = 0;
    let edges = 0;
    for (let y = 2; y < size - 2 - shift; y++) {
      for (let x = 2; x < size - 2 - shift; x++) {
        const i = y * size + x;
        const d = Math.max(Math.abs(depth[i + 1] - depth[i]), Math.abs(depth[i + size] - depth[i]));
        if (!(d >= DEPTH_EDGE)) continue;
        edges++;
        const j = (y + shift) * size + x + shift;
        // Allow one pixel either way, as an edge pair straddles two pixels.
        if (colourEdge[j] || colourEdge[j + 1] || colourEdge[j - 1] || colourEdge[j + size] || colourEdge[j - size]) hit++;
      }
    }
    return { hit, edges };
  };
  // Aligned passes peak at zero shift and fall away on either side.
  const line = [0, 1, 2, 4, 8, 16].map((shift) => {
    const { hit, edges } = score(shift);
    return `${shift}px ${((hit / edges) * 100).toFixed(1)}%`;
  });
  console.log(`edges (${id}): ${score(0).edges} depth-edge pixels on a colour edge, by shift: ${line.join(", ")}`);
}

// 3. Turn every pixel back into a height above the ellipsoid.
async function checkHeight(id) {
  const { depth, size, meta } = await loadDepth(id);
  const basis = cameraBasis(CAMERA);
  const m = CAMERA.metresPerPixel;
  const { x: wx, y: wy } = meta.window;
  // Height is the rise above the origin's up direction, good to centimetres across a CBD.
  const lat = (CAMERA.origin.lat * Math.PI) / 180;
  const lon = (CAMERA.origin.lon * Math.PI) / 180;
  const up = [Math.cos(lat) * Math.cos(lon), Math.cos(lat) * Math.sin(lon), Math.sin(lat)];
  const dotUp = (v) => v[0] * up[0] + v[1] * up[1] + v[2] * up[2];
  const rightUp = dotUp(basis.right);
  const imageUpUp = dotUp(basis.imageUp);
  const forwardUp = dotUp(basis.forward);
  const baseUp = dotUp(basis.position) - dotUp(basis.originEcef);
  const heights = [];
  let top = { h: -Infinity };
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const d = depth[y * size + x];
      if (Number.isNaN(d)) continue;
      const h = baseUp + rightUp * (wx + x) * m - imageUpUp * (wy + y) * m + forwardUp * d;
      heights.push(h);
      if (h > top.h) top = { h, x, y };
    }
  }
  heights.sort((p, q) => p - q);
  const pct = (p) => heights[Math.floor(heights.length * p)].toFixed(1);
  console.log(`height (${id}): lowest 1% ${pct(0.01)} m, median ${pct(0.5)} m, 99.9% ${pct(0.999)} m, top ${heights[heights.length - 1].toFixed(1)} m above the ellipsoid`);
  console.log(`  top pixel at (${top.x}, ${top.y}) in the shot`);
  return { depth, size, heightAt: (x, y) => baseUp + rightUp * (wx + x) * m - imageUpUp * (wy + y) * m + forwardUp * depth[y * size + x] };
}

await checkLattice();
await checkEdges("adj-a");
await checkEdges("central-park");
await checkHeight("central-park");

// Named boxes as "id:label:x0,y0,x1,y1" arguments print their median height, to compare a roof with its street.
const boxes = process.argv.slice(3);
for (const spec of boxes) {
  const [id, label, coords] = spec.split(":");
  const [x0, y0, x1, y1] = coords.split(",").map(Number);
  const { heightAt } = await checkHeight(id);
  const values = [];
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) values.push(heightAt(x, y));
  values.sort((p, q) => p - q);
  console.log(`  box ${label}: median ${values[values.length >> 1].toFixed(1)} m, top ${values[values.length - 1].toFixed(1)} m, 10-90% ${values[Math.floor(values.length * 0.1)].toFixed(1)} to ${values[Math.floor(values.length * 0.9)].toFixed(1)} m`);
}
