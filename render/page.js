// Browser side of the renderer. Adapted from isometric-nyc's src/web_render/main.js
// (MIT, Copyright (c) 2025 Andy Coenen; see render/LICENSE-isometric-nyc).
//
// Playwright sets window.TILES_KEY at runtime, so the key is never in this
// bundle or a URL we log. Each shot moves the frustum, never the camera.
import { FAILED, TilesRenderer, UNLOADED } from "3d-tiles-renderer";
import {
  GoogleCloudAuthPlugin,
  GLTFExtensionsPlugin,
  TileCompressionPlugin,
} from "3d-tiles-renderer/plugins";
import {
  DepthTexture,
  FloatType,
  NearestFilter,
  OrthographicCamera,
  RGBAFormat,
  Scene,
  ShaderMaterial,
  Vector3,
  WebGLRenderTarget,
  WebGLRenderer,
} from "three";
import { DRACOLoader } from "three/addons/loaders/DRACOLoader.js";
import { CAMERA, cameraBasis } from "./camera.js";

// Holes in Google's mesh render as this colour, so a check can count them.
const HOLE_COLOUR = 0xff00ff;
// Screen-space error in pixels. Lower loads finer tiles.
const ERROR_TARGET = 2;
// The scene must stay fully loaded for this many frames before a shot counts.
const STABLE_FRAMES = 30;
const SHOT_TIMEOUT_MS = 180000;

const renderer = new WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(1);
renderer.setClearColor(HOLE_COLOUR, 1);
document.body.appendChild(renderer.domElement);

const scene = new Scene();
const camera = new OrthographicCamera(-1, 1, 1, -1, 10, 200000);
const basis = cameraBasis(CAMERA);

// Fix the camera in Earth-centred space. Scene coordinates are Earth-centred too.
const toVector = ([x, y, z]) => new Vector3(x, y, z);
camera.matrixAutoUpdate = false;
camera.matrix.makeBasis(
  toVector(basis.right),
  toVector(basis.imageUp),
  toVector(basis.forward).negate(),
);
camera.matrix.setPosition(toVector(basis.position));
camera.matrix.decompose(camera.position, camera.quaternion, camera.scale);
camera.updateMatrixWorld(true);

const tiles = new TilesRenderer();
tiles.registerPlugin(
  new GoogleCloudAuthPlugin({ apiToken: window.TILES_KEY, useRecommendedSettings: false }),
);
tiles.registerPlugin(new TileCompressionPlugin());
tiles.registerPlugin(
  new GLTFExtensionsPlugin({
    dracoLoader: new DRACOLoader().setDecoderPath("/node_modules/three/examples/jsm/libs/draco/gltf/"),
  }),
);
tiles.errorTarget = ERROR_TARGET;
tiles.lruCache.maxBytesSize = 2 * 1024 ** 3;
tiles.lruCache.minBytesSize = 1 * 1024 ** 3;
tiles.lruCache.maxSize = 30000;
// Downloads set the pace: at 32 at a time a shot took about 21 s, and at 96 about 12 s. But after
// about 200 shots at 96, Google refused thousands of requests (HTTP 429). 48 is the middle.
tiles.downloadQueue.maxJobsPerOrigin = 48;
tiles.parseQueue.maxJobs = 16;
scene.add(tiles.group);
tiles.setCamera(camera);

// Writes each fragment's distance from the camera plane, in metres.
const depthMaterial = new ShaderMaterial({
  vertexShader: `
    varying float vDepth;
    void main() {
      vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);
      vDepth = -viewPosition.z;
      gl_Position = projectionMatrix * viewPosition;
    }`,
  fragmentShader: `
    varying float vDepth;
    void main() { gl_FragColor = vec4(vDepth, 0.0, 0.0, 1.0); }`,
});

/** Point the frustum at a whole-pixel window of the map. */
function aim(shot) {
  const m = CAMERA.metresPerPixel;
  camera.left = shot.x * m;
  camera.right = (shot.x + shot.size) * m;
  camera.top = -shot.y * m;
  camera.bottom = -(shot.y + shot.size) * m;
  camera.updateProjectionMatrix();
  renderer.setSize(shot.size, shot.size, false);
  tiles.setResolution(camera, shot.size, shot.size);
}

/** Resolve once every tile the shot needs has been on screen for STABLE_FRAMES frames. */
function settle() {
  return new Promise((resolve, reject) => {
    const started = performance.now();
    let stable = 0;
    window.SETTLE = { frames: 0, busyFrames: 0, lastBusyMs: 0, maxQueued: 0, maxDownloading: 0, maxParsing: 0 };
    const step = () => {
      if (performance.now() - started > SHOT_TIMEOUT_MS) {
        reject(new Error(`tiles did not settle: ${JSON.stringify(tiles.stats)}`));
        return;
      }
      camera.updateMatrixWorld(true);
      tiles.update();
      renderer.render(scene, camera);
      const { queued, downloading, parsing } = tiles.stats;
      // Counters that show where a shot's time goes: waiting on tiles, or waiting for steady frames.
      const d = window.SETTLE;
      d.frames++;
      if (queued + downloading + parsing > 0) {
        d.busyFrames++;
        d.lastBusyMs = Math.round(performance.now() - started);
      }
      d.maxQueued = Math.max(d.maxQueued, queued);
      d.maxDownloading = Math.max(d.maxDownloading, downloading);
      d.maxParsing = Math.max(d.maxParsing, parsing);
      stable = queued + downloading + parsing > 0 ? 0 : stable + 1;
      if (stable >= STABLE_FRAMES && tiles.root) resolve();
      else requestAnimationFrame(step);
    };
    step();
  });
}

function bytesToBase64(bytes) {
  let out = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    out += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  }
  return btoa(out);
}

/** Render the current tiles to floats. Returns rows top-down, 0 where nothing was drawn. */
function renderDepth(size) {
  const target = new WebGLRenderTarget(size, size, {
    type: FloatType,
    format: RGBAFormat,
    minFilter: NearestFilter,
    magFilter: NearestFilter,
    depthTexture: new DepthTexture(size, size, FloatType),
  });
  const rgba = new Float32Array(size * size * 4);
  const previousClear = renderer.getClearAlpha();
  renderer.setRenderTarget(target);
  renderer.setClearColor(0x000000, 0);
  renderer.clear();
  scene.overrideMaterial = depthMaterial;
  renderer.render(scene, camera);
  scene.overrideMaterial = null;
  renderer.readRenderTargetPixels(target, 0, 0, size, size, rgba);
  renderer.setRenderTarget(null);
  renderer.setClearColor(HOLE_COLOUR, previousClear);
  target.depthTexture.dispose();
  target.dispose();

  const depth = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    const row = size - 1 - y;
    for (let x = 0; x < size; x++) depth[y * size + x] = rgba[(row * size + x) * 4];
  }
  return depth;
}

/**
 * Marks every failed tile as not yet loaded, so the next update asks for it again.
 * The library's own resetFailedTiles() throws on a tile it has not set up yet, and after
 * that every later shot failed too. This version skips such tiles.
 */
function retryFailedTiles() {
  if (tiles.rootLoadingState === FAILED) tiles.rootLoadingState = UNLOADED;
  if (tiles.stats.failed === 0) return;
  tiles.traverse(
    (tile) => {
      if (tile.internal?.loadingState === FAILED) tile.internal.loadingState = UNLOADED;
    },
    null,
    false,
  );
  tiles.stats.failed = 0;
}

// Called from Node for each shot. The colour and depth renders happen back to back,
// with no tile update between them, so both show exactly the same geometry.
window.shoot = async (shot, range) => {
  aim(shot);
  retryFailedTiles();
  const started = performance.now();
  await settle();
  const settleMs = performance.now() - started;
  // A failed tile leaves a blank or blurry patch, and the queue still empties. So a shot with
  // any failed tile is not a shot: stop here and let the caller wait and try again.
  if (tiles.stats.failed > 0) throw new Error(`${tiles.stats.failed} tiles failed to load`);

  renderer.render(scene, camera);
  const colour = renderer.domElement.toDataURL("image/png").split(",")[1];
  const depth = renderDepth(shot.size);

  // 0 means no geometry. 1..65535 map linearly onto near..far.
  const encoded = new Uint16Array(depth.length);
  let clamped = 0;
  let empty = 0;
  const span = range.far - range.near;
  for (let i = 0; i < depth.length; i++) {
    if (depth[i] === 0) {
      empty++;
      continue;
    }
    const t = (depth[i] - range.near) / span;
    if (t < 0 || t > 1) clamped++;
    encoded[i] = Math.round(Math.min(1, Math.max(0, t)) * 65534) + 1;
  }

  // Detail check. A drawn tile is coarse when it is blurrier than the target and has finer
  // children it could have shown in its place. That happens when the children failed to load.
  // A tile with no children is Google's finest data, however blurry, and is not counted.
  let coarse = 0;
  let worstError = 0;
  for (const tile of tiles.visibleTiles) {
    const error = tile.traversal?.error ?? 0;
    if (error > tiles.errorTarget && tile.children?.length > 0) {
      coarse++;
      if (Number.isFinite(error)) worstError = Math.max(worstError, error);
    }
  }

  return {
    coarseTiles: coarse,
    worstError: Math.round(worstError * 10) / 10,
    colour,
    depth: bytesToBase64(new Uint8Array(encoded.buffer)),
    clampedPixels: clamped,
    emptyPixels: empty,
    settleMs: Math.round(settleMs),
    diag: { ...window.SETTLE, visible: tiles.stats.visible, inFrustum: tiles.stats.inFrustum, cacheBytes: tiles.lruCache.cachedBytes },
    attributions: tiles.getAttributions().map((a) => a.value).filter((v) => typeof v === "string"),
    renderer: gpuName(),
  };
};

function gpuName() {
  const gl = renderer.getContext();
  const info = gl.getExtension("WEBGL_debug_renderer_info");
  return info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
}

window.gpuName = gpuName;
window.RENDERER_READY = true;
