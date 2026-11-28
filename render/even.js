// Evens out the render's tone, so the drawing does not show the patches in Google's photos.
//
//   node render/even.js fetch                          download the reference picture (once)
//   node render/even.js field                          work out the correction for the whole map
//   node render/even.js apply <shots> <out> [id ...]   write corrected copies of shots
//
// Google's photos were taken on different days and in different seasons. Far from the city the
// render is a patchwork: one region dark and blue, the next pale and hazy, with a straight
// edge between. The model draws what it sees, so the patches showed in the map.
//
// The reference is one cloud-free pass of the Sentinel-2 satellite over Perth. A pass is one
// picture taken in about a minute, so its tone is the same everywhere. At 10 m a pixel it is
// far too coarse to draw from. But it says what colour each 100 m of ground should be. The
// correction shifts the render's colour toward that at the 100 m scale, and keeps every detail
// finer than that from Google.
//
// The satellite's colours are not Google's colours. So the reference is first matched to
// Google over the first map (render/frames/perth.json), where Google's photos are consistent.
// The correction there comes out near 1, and the larger map keeps the first map's palette.
//
// Sentinel-2 is open data: "Contains modified Copernicus Sentinel data 2026". That credit goes
// on the site and in the write-up. Do not swap in a ready-made mosaic: the one tried first
// (EOX Sentinel-2 cloudless) is free for non-commercial use only, with a share-alike condition.
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { depthAtHeight, unproject } from "./camera.js";

const here = dirname(fileURLToPath(import.meta.url));
const OUT = join(here, "out", "even");
// The two 110 km tiles of the pass of 5 January 2026 that cover greater Perth, cloud under 0.1%.
const TILES = ["S2B_50HLK_20260105_0_L2A", "S2B_50HMK_20260105_0_L2A"];
const GROUND = -15; // Typical ground height above the ellipsoid. See render/grid.js.
const SHOT = 2048;
const K = 32; // Map pixels per pixel of the field: 9.4 m, about the satellite's pixel.
const SIGMA = 12; // Blur, in field pixels, that sets the scale of the correction: about 110 m.
const NODE = 32; // Field pixels between the points where the ground position is worked out.
const [LOW, HIGH] = [0.4, 2.5]; // The gain never changes brightness by more than this.
const SCALE = 100; // The field is stored as a picture: value 100 means "no change".
const BIG = { limitInputPixels: false };

const frames = (name) => JSON.parse(readFileSync(join(here, "frames", `${name}.json`), "utf8"));
const RENDERS = [["perth", join(here, "out", "perth")], ["greater", join(here, "out", "greater")]];

/** WGS84 latitude and longitude to UTM zone 50 south, in metres (Krueger series). */
function utm50s(lat, lon) {
  const [a, f, k0, lon0] = [6378137, 1 / 298.257223563, 0.9996, (117 * Math.PI) / 180];
  const n = f / (2 - f);
  const A = (a / (1 + n)) * (1 + n ** 2 / 4 + n ** 4 / 64);
  const alpha = [n / 2 - (2 / 3) * n ** 2 + (5 / 16) * n ** 3, (13 / 48) * n ** 2 - (3 / 5) * n ** 3, (61 / 240) * n ** 3];
  const [phi, lam] = [(lat * Math.PI) / 180, (lon * Math.PI) / 180 - lon0];
  const e = (2 * Math.sqrt(n)) / (1 + n);
  const t = Math.sinh(Math.atanh(Math.sin(phi)) - e * Math.atanh(e * Math.sin(phi)));
  const [xi, eta] = [Math.atan(t / Math.cos(lam)), Math.atanh(Math.sin(lam) / Math.sqrt(1 + t * t))];
  let [east, north] = [eta, xi];
  for (let j = 1; j <= 3; j++) {
    east += alpha[j - 1] * Math.cos(2 * j * xi) * Math.sinh(2 * j * eta);
    north += alpha[j - 1] * Math.sin(2 * j * xi) * Math.cosh(2 * j * eta);
  }
  return [500000 + k0 * A * east, 10000000 + k0 * A * north];
}

/** Downloads the pass's true-colour pictures and where they sit, from the open archive on AWS. */
async function fetchReference() {
  mkdirSync(OUT, { recursive: true });
  for (const id of TILES) {
    const item = await (await fetch(`https://earth-search.aws.element84.com/v1/collections/sentinel-2-l2a/items/${id}`)).json();
    const visual = item.assets.visual;
    writeFileSync(join(OUT, `${id}.json`), JSON.stringify({ id, href: visual.href, transform: visual["proj:transform"], datetime: item.properties.datetime }));
    if (!existsSync(join(OUT, `${id}.tif`))) writeFileSync(join(OUT, `${id}.tif`), Buffer.from(await (await fetch(visual.href)).arrayBuffer()));
    console.log(`${id}: ${item.properties.datetime}, cloud ${item.properties["eo:cloud_cover"]}%`);
  }
}

/** Solves M x = v by elimination. M is small. */
function solve(M, v) {
  const n = v.length;
  const m = M.map((row, i) => [...row, v[i]]);
  for (let i = 0; i < n; i++) {
    let pivot = i;
    for (let k = i + 1; k < n; k++) if (Math.abs(m[k][i]) > Math.abs(m[pivot][i])) pivot = k;
    [m[i], m[pivot]] = [m[pivot], m[i]];
    for (let k = i + 1; k < n; k++) {
      const factor = m[k][i] / m[i][i];
      for (let j = i; j <= n; j++) m[k][j] -= factor * m[i][j];
    }
  }
  const x = new Float64Array(n);
  for (let i = n - 1; i >= 0; i--) {
    let sum = m[i][n];
    for (let j = i + 1; j < n; j++) sum -= m[i][j] * x[j];
    x[i] = sum / m[i][i];
  }
  return x;
}

async function field() {
  const shots = RENDERS.flatMap(([name, folder]) => frames(name).map((shot) => ({ ...shot, folder })));
  const [x0, y0] = [Math.min(...shots.map((s) => s.x)), Math.min(...shots.map((s) => s.y))];
  const per = SHOT / K; // Field pixels along one shot.
  const [W, H] = [(Math.max(...shots.map((s) => s.x)) - x0) / K + per, (Math.max(...shots.map((s) => s.y)) - y0) / K + per];
  const byId = new Map(shots.map((s) => [s.id, s]));

  // 1. Google's render at the field's size, and where it has data.
  const google = Buffer.alloc(W * H * 3);
  const has = new Uint8Array(W * H);
  for (const shot of shots) {
    const small = await sharp(join(shot.folder, `${shot.id}.png`)).removeAlpha().resize(per, per).raw().toBuffer();
    const [left, top] = [(shot.x - x0) / K, (shot.y - y0) / K];
    for (let y = 0; y < per; y++) {
      small.copy(google, ((top + y) * W + left) * 3, y * per * 3, (y + 1) * per * 3);
      has.fill(1, (top + y) * W + left, (top + y) * W + left + per);
    }
  }

  // 2. The reference in the same frame. Each field pixel needs its place on the ground. Hills
  // shift the picture by hundreds of pixels, so the true distance to the ground is read from
  // the shot's depth pass at every NODE, and the places between are interpolated.
  const tiles = [];
  for (const id of TILES) {
    const meta = JSON.parse(readFileSync(join(OUT, `${id}.json`), "utf8"));
    const { data, info } = await sharp(join(OUT, `${id}.tif`), BIG).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    tiles.push({ data, width: info.width, height: info.height, east: meta.transform[2], north: meta.transform[5], size: meta.transform[0] });
  }
  const depths = new Map();
  async function depthAt(X, Y) {
    const id = `c${Math.floor(X / SHOT)}_r${Math.floor(Y / SHOT)}`;
    const flat = depthAtHeight(X, Y, GROUND);
    if (!byId.has(id)) return flat;
    if (!depths.has(id)) {
      if (depths.size > 300) depths.clear();
      const folder = byId.get(id).folder;
      const range = JSON.parse(readFileSync(join(folder, `${id}.json`), "utf8")).depth;
      const small = await sharp(join(folder, `${id}.depth.png`)).toColourspace("grey16").resize(per, per, { kernel: "nearest" }).raw({ depth: "ushort" }).toBuffer();
      const values = new Uint16Array(small.buffer, small.byteOffset, small.length / 2);
      depths.set(id, { values, channels: values.length / (per * per), ...range });
    }
    const d = depths.get(id);
    const inShot = (v) => Math.min(per - 1, Math.floor((((v % SHOT) + SHOT) % SHOT) / K));
    const raw = d.values[(inShot(Y) * per + inShot(X)) * d.channels];
    // 0 is no geometry, and the two ends of the range are clamped values: use sea level there.
    return raw <= 1 || raw >= 65535 ? flat : d.near + ((raw - 1) / 65534) * (d.far - d.near);
  }
  const [nodesAcross, nodesDown] = [Math.ceil(W / NODE) + 1, Math.ceil(H / NODE) + 1];
  const place = new Float64Array(nodesAcross * nodesDown * 2);
  for (let j = 0; j < nodesDown; j++) {
    for (let i = 0; i < nodesAcross; i++) {
      const [X, Y] = [x0 + i * NODE * K, y0 + j * NODE * K];
      const ground = unproject(X, Y, await depthAt(X, Y));
      [place[(j * nodesAcross + i) * 2], place[(j * nodesAcross + i) * 2 + 1]] = utm50s(ground.lat, ground.lon);
    }
  }
  const reference = Buffer.alloc(W * H * 3);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const [i, j, fx, fy] = [Math.floor(x / NODE), Math.floor(y / NODE), (x % NODE) / NODE, (y % NODE) / NODE];
      const at = (ii, jj, c) => place[(jj * nodesAcross + ii) * 2 + c];
      const mix = (c) => (at(i, j, c) * (1 - fx) + at(i + 1, j, c) * fx) * (1 - fy) + (at(i, j + 1, c) * (1 - fx) + at(i + 1, j + 1, c) * fx) * fy;
      const [east, north] = [mix(0), mix(1)];
      // The two tiles overlap by 9.8 km. The west one is used up to the middle of the overlap.
      const tile = tiles[east < tiles[1].east + 4900 ? 0 : 1];
      const [sx, sy] = [Math.floor((east - tile.east) / tile.size), Math.floor((tile.north - north) / tile.size)];
      if (sx < 0 || sy < 0 || sx >= tile.width || sy >= tile.height) continue;
      tile.data.copy(reference, (y * W + x) * 3, (sy * tile.width + sx) * 3, (sy * tile.width + sx) * 3 + 3);
    }
  }

  // 3. Both blurred to the scale of the correction.
  // Past the map's edge the render is black. A plain blur would mix that black in and make the
  // render look darker near the edge than it is, so the correction would brighten a band all
  // round the map. So each blur is divided by the blur of "where there is data".
  const blur = (buffer) => sharp(buffer, { raw: { width: W, height: H, channels: 3 }, ...BIG }).blur(SIGMA).raw().toBuffer();
  const cover = Buffer.alloc(W * H * 3);
  for (let i = 0; i < W * H; i++) if (has[i]) cover.fill(255, i * 3, i * 3 + 3);
  const coverSoft = await blur(cover);
  const soften = async (buffer) => {
    const soft = await blur(buffer);
    for (let i = 0; i < soft.length; i++) soft[i] = coverSoft[i] > 8 ? Math.min(255, Math.round((soft[i] * 255) / coverSoft[i])) : 0;
    return soft;
  };
  // The reference is blanked where the render has no data, so both blurs lose the same share.
  for (let i = 0; i < W * H; i++) if (!has[i]) reference.fill(0, i * 3, i * 3 + 3);
  const [googleSoft, referenceSoft] = [await soften(google), await soften(reference)];

  // 4. Match the reference's colours to Google's over the first map: predict each of Google's
  // channels from the reference's three, their squares and their products, by least squares.
  const terms = (i) => {
    const [r, g, b] = [referenceSoft[i * 3] / 255, referenceSoft[i * 3 + 1] / 255, referenceSoft[i * 3 + 2] / 255];
    return [1, r, g, b, r * r, g * g, b * b, r * g, r * b, g * b];
  };
  const T = 10;
  const A = Array.from({ length: T }, (_, p) => Float64Array.from({ length: T }, (_, q) => (p === q ? 1e-6 : 0)));
  const B = [0, 1, 2].map(() => new Float64Array(T));
  for (const shot of frames("perth")) {
    const [left, top] = [(shot.x - x0) / K, (shot.y - y0) / K];
    for (let y = top; y < top + per; y += 2) {
      for (let x = left; x < left + per; x += 2) {
        const i = y * W + x;
        const t = terms(i);
        for (let p = 0; p < T; p++) {
          for (let q = 0; q < T; q++) A[p][q] += t[p] * t[q];
          for (let c = 0; c < 3; c++) B[c][p] += t[p] * googleSoft[i * 3 + c];
        }
      }
    }
  }
  const weights = B.map((b) => solve(A, b));

  // 5. The correction, in two parts. The gain is one number for all three channels: how much
  // brighter the matched reference is than Google. The shift is what is still missing in each
  // channel after the gain. A gain for each channel was tried first: where a photo run is
  // very brown it tripled the blue, and bright ground came out blue-white.
  const luma = (buffer, i) => 0.299 * buffer[i * 3] + 0.587 * buffer[i * 3 + 1] + 0.114 * buffer[i * 3 + 2];
  const gain = Buffer.alloc(W * H, SCALE);
  const shift = Buffer.alloc(W * H * 3, 128);
  const preview = Buffer.alloc(W * H * 3, 230);
  for (let i = 0; i < W * H; i++) {
    if (!has[i]) continue;
    const t = terms(i);
    const target = [0, 1, 2].map((c) => {
      let sum = 0;
      for (let p = 0; p < T; p++) sum += weights[c][p] * t[p];
      return Math.min(255, Math.max(0, sum));
    });
    // The 4 keeps the ratio steady where both are near black.
    const g = Math.min(HIGH, Math.max(LOW, (0.299 * target[0] + 0.587 * target[1] + 0.114 * target[2] + 4) / (luma(googleSoft, i) + 4)));
    gain[i] = Math.round(g * SCALE);
    for (let c = 0; c < 3; c++) {
      const s = Math.min(127, Math.max(-128, Math.round(target[c] - g * googleSoft[i * 3 + c])));
      shift[i * 3 + c] = s + 128;
      preview[i * 3 + c] = Math.min(255, Math.max(0, Math.round(google[i * 3 + c] * g + s)));
    }
  }
  const save = (buffer, name, channels = 3) => sharp(buffer, { raw: { width: W, height: H, channels }, ...BIG }).png().toFile(join(OUT, name));
  await save(gain, "gain.png", 1);
  await save(shift, "shift.png");
  await save(google, "before.png");
  await save(preview, "after.png");
  writeFileSync(join(OUT, "gain.json"), JSON.stringify({ x: x0, y: y0, k: K, width: W, height: H, scale: SCALE, reference: TILES }));
  console.log(`field of ${W} x ${H} written to ${OUT}, with before.png and after.png to check by eye`);
}

/** Writes corrected copies of shots. With no ids, every shot in the folder that the field covers. */
async function apply(from, to, ids) {
  const f = JSON.parse(readFileSync(join(OUT, "gain.json"), "utf8"));
  const per = SHOT / f.k;
  const PAD = 2; // Field pixels of margin, so the enlarged field is smooth across shot edges.
  mkdirSync(to, { recursive: true });
  const fieldTime = statSync(join(OUT, "gain.png")).mtimeMs;
  const list = ids.length ? ids : readdirSync(from).filter((n) => /^c-?\d+_r-?\d+\.png$/.test(n)).map((n) => n.slice(0, -4));
  let done = 0;
  for (const id of list) {
    // A copy made after the field was last built is up to date. An older one is made again.
    if (existsSync(join(to, `${id}.png`)) && statSync(join(to, `${id}.png`)).mtimeMs > fieldTime) continue;
    const [, col, row] = id.match(/c(-?\d+)_r(-?\d+)/).map(Number);
    const [left, top] = [(col * SHOT - f.x) / f.k - PAD, (row * SHOT - f.y) / f.k - PAD];
    const side = per + 2 * PAD;
    // At the field's edge there is no margin. Take what exists and repeat the edge pixels.
    const cut = { left: Math.max(0, left), top: Math.max(0, top), right: Math.min(f.width, left + side), bottom: Math.min(f.height, top + side) };
    /** One of the field's two pictures, cut for this shot and enlarged to the shot's size. */
    const enlarged = async (name, channels) => {
      const piece = await sharp(join(OUT, name), BIG)
        .extract({ left: cut.left, top: cut.top, width: cut.right - cut.left, height: cut.bottom - cut.top })
        .extend({ left: cut.left - left, top: cut.top - top, right: left + side - cut.right, bottom: top + side - cut.bottom, extendWith: "copy" })
        .png()
        .toBuffer();
      const big = sharp(piece).resize(side * f.k, side * f.k, { kernel: "cubic" }).extract({ left: PAD * f.k, top: PAD * f.k, width: SHOT, height: SHOT });
      return (channels === 1 ? big.extractChannel(0) : big.removeAlpha()).raw().toBuffer();
    };
    const [gain, shift] = [await enlarged("gain.png", 1), await enlarged("shift.png", 3)];
    const shot = await sharp(join(from, `${id}.png`)).removeAlpha().raw().toBuffer();
    for (let i = 0; i < shot.length; i++) shot[i] = Math.min(255, Math.max(0, Math.round((shot[i] * gain[Math.floor(i / 3)]) / f.scale + shift[i] - 128)));
    await sharp(shot, { raw: { width: SHOT, height: SHOT, channels: 3 } }).png().toFile(join(to, `${id}.png`));
    if (++done % 200 === 0) console.log(`${done} shots evened`);
  }
  console.log(`${done} shots evened into ${to}`);
}

const [command, ...rest] = process.argv.slice(2);
if (command === "fetch") await fetchReference();
else if (command === "field") await field();
else if (command === "apply") await apply(rest[0], rest[1], rest.slice(2));
else console.log("usage: node render/even.js fetch | field | apply <shots> <out> [id ...]");
