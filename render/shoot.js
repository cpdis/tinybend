// Renders shots with Chrome on this Mac's GPU: colour, 16-bit depth and a camera sidecar.
//
//   node render/shoot.js render/frames/phase1.json [--out render/out/phase1] [--only id,id]
//
// A shot whose sidecar already exists is skipped, so a stopped run carries on where it left off.
//
// A frames file is a list of { id, lat, lon, height, size } or { id, x, y, size }.
// height is the ground's height above the WGS84 ellipsoid, in metres. A frame from
// render/grid.js also carries near and far, its depth range from the DEM: shots on Bend's
// buttes and on Mt. Bachelor need a range set by their own ground (see grid.js).
import { existsSync, readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import sharp from "sharp";
import { createServer } from "vite";
import { CAMERA, depthRange, shotAt } from "./camera.js";

const here = dirname(fileURLToPath(import.meta.url));
const PORT = 8080; // The API key's referrer restriction allows only this port.
const RETRY_WAITS_S = [30, 60, 120, 240]; // Waits between tries of one shot, in seconds.
// Google's tile session ends after about 4 hours, and then every tile request gets HTTP 400.
// A page reload starts a new session. Reload well before that, and after any failed try.
const SHOTS_PER_SESSION = 400;
// A shot that shows coarse tiles (see page.js) is tried again this many times. If it is still
// coarse it is kept and marked, because a few places may have no finer data.
const COARSE_RETRIES = 2;
// After this many failed shots in a row the run stops. Something is wrong that a wait will not
// fix in this process, and each further shot would waste seven minutes of waits.
const STOP_AFTER_FAILED = 3;

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

/** Read one key from the ignored .env. The value is never printed. */
function envKey(name) {
  const text = readFileSync(join(here, "..", ".env"), "utf8");
  const match = text.match(new RegExp(`^${name}=(.*)$`, "m"));
  if (!match) throw new Error(`${name} is missing from .env`);
  return match[1].trim().replace(/^["']|["']$/g, "");
}

const framesFile = process.argv[2];
const out = resolve(arg("--out", join(here, "out", "shots")));
const only = arg("--only", "")?.split(",").filter(Boolean);
mkdirSync(out, { recursive: true });

const key = envKey("GOOGLE_MAPS_API_KEY");
const redact = (text) => String(text).split(key).join("<key>");

const wanted = JSON.parse(readFileSync(framesFile, "utf8")).filter((f) => !only?.length || only.includes(f.id));
// The sidecar is written last, so its presence means the whole shot is on disk.
const frames = wanted.filter((f) => !existsSync(join(out, `${f.id}.json`)));
console.log(`${frames.length} shots to render, ${wanted.length - frames.length} already done`);
const failed = [];

const server = await createServer({
  root: here,
  logLevel: "error",
  server: { port: PORT, strictPort: true, host: "localhost" },
});
await server.listen();

const browser = await chromium.launch({
  channel: "chrome",
  headless: false,
  args: [
    "--use-angle=metal",
    "--enable-gpu-rasterization",
    "--ignore-gpu-blocklist",
    "--window-size=400,400",
    // Keep Chrome drawing at full speed when its window is covered or in the background.
    "--disable-backgrounding-occluded-windows",
    "--disable-renderer-backgrounding",
    "--disable-background-timer-throttling",
  ],
});

try {
  const page = await browser.newPage();
  // Tile errors seen on the page's console since the current try began. The page's own count
  // of failed tiles missed some after the session ended, and blurry shots were saved as good.
  let tileErrors = 0;
  page.on("console", (m) => {
    if (m.type() === "error" || m.type() === "warning") console.log(`[page] ${redact(m.text()).slice(0, 300)}`);
    if (m.type() === "error" && /Failed to load/i.test(m.text())) tileErrors++;
  });
  page.on("pageerror", (e) => console.log(`[page error] ${redact(e.message).slice(0, 300)}`));
  await page.addInitScript((k) => {
    window.TILES_KEY = k;
  }, key);
  /** Loads the render page afresh, which starts a new tile session with Google. */
  const startSession = async () => {
    await page.goto(`http://localhost:${PORT}/`);
    await page.waitForFunction(() => window.RENDERER_READY === true, null, { timeout: 60000 });
  };
  await startSession();
  let shotsThisSession = 0;
  let failedInARow = 0;

  const gpu = await page.evaluate(() => window.gpuName());
  console.log(`GPU: ${gpu}`);
  if (/swiftshader|llvmpipe|software/i.test(gpu)) throw new Error(`software rendering: ${gpu}`);

  for (const frame of frames) {
    const shot =
      frame.x !== undefined
        ? { id: frame.id, x: frame.x, y: frame.y, size: frame.size }
        : shotAt(frame.id, frame.lat, frame.lon, frame.height ?? 0, frame.size);
    const range = frame.near !== undefined ? { near: frame.near, far: frame.far } : depthRange(shot, frame.height ?? 0);
    const started = Date.now();
    // A shot with failed tiles is retried after a growing wait, which lets a rate limit clear.
    let result;
    for (let attempt = 0; !result && attempt <= RETRY_WAITS_S.length; attempt++) {
      try {
        if (shotsThisSession >= SHOTS_PER_SESSION) {
          await startSession();
          shotsThisSession = 0;
        }
        tileErrors = 0;
        const tried = await page.evaluate(([s, r]) => window.shoot(s, r), [shot, range]);
        if (tileErrors > 0) throw new Error(`${tileErrors} tile errors on the page`);
        if (tried.coarseTiles > 0 && attempt < COARSE_RETRIES) throw new Error(`${tried.coarseTiles} coarse tiles shown`);
        result = tried;
        shotsThisSession++;
      } catch (error) {
        const wait = RETRY_WAITS_S[attempt];
        console.log(`${shot.id}: attempt ${attempt + 1} failed, ${redact(error.message).slice(0, 160)}${wait ? `; waiting ${wait} s` : ""}`);
        if (wait) await new Promise((done) => setTimeout(done, wait * 1000));
        // A fresh page drops tiles that are stuck as failed and starts a new session.
        await startSession().catch((e) => console.log(`reload failed: ${redact(e.message).slice(0, 160)}`));
        shotsThisSession = 0;
      }
    }
    if (!result) {
      console.log(`${shot.id}: FAILED, left for the next run`);
      failed.push(shot.id);
      if (++failedInARow >= STOP_AFTER_FAILED) throw new Error(`${STOP_AFTER_FAILED} shots failed in a row: stopping`);
      continue;
    }
    failedInARow = 0;
    const png = Buffer.from(result.colour, "base64");
    await sharp(png).removeAlpha().png().toFile(join(out, `${shot.id}.png`));

    const depth = Buffer.from(result.depth, "base64");
    await sharp(new Uint16Array(depth.buffer, depth.byteOffset, depth.length / 2), {
      raw: { width: shot.size, height: shot.size, channels: 1 },
    })
      .toColourspace("grey16")
      .png()
      .toFile(join(out, `${shot.id}.depth.png`));

    writeFileSync(
      join(out, `${shot.id}.json`),
      JSON.stringify(
        {
          id: shot.id,
          place: frame.lat !== undefined ? { lat: frame.lat, lon: frame.lon, height: frame.height ?? 0 } : null,
          camera: CAMERA,
          window: { x: shot.x, y: shot.y, size: shot.size },
          depth: { near: range.near, far: range.far, encoding: "0 = no geometry; 1..65535 linear from near to far, metres from the camera plane" },
          clampedPixels: result.clampedPixels,
          coarseTiles: result.coarseTiles,
          worstError: result.worstError,
          emptyPixels: result.emptyPixels,
          tilesShown: result.diag.visible,
          settleMs: result.settleMs,
          attributions: result.attributions,
          gpu,
          renderedAt: new Date().toISOString(),
        },
        null,
        2,
      ),
    );
    console.log(
      `${shot.id}: window (${shot.x}, ${shot.y}) ${shot.size}px, settled ${result.settleMs} ms, total ${Date.now() - started} ms, empty ${result.emptyPixels}, clamped ${result.clampedPixels}, coarse ${result.coarseTiles}`,
    );
  }
  console.log(`done: ${frames.length - failed.length} rendered, ${failed.length} failed${failed.length ? `: ${failed.join(", ")}` : ""}`);
} finally {
  await browser.close();
  await server.close();
}
