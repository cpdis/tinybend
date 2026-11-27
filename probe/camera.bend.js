// The one camera for the whole map, as data plus pure maths. No dependencies,
// so the browser renderer and the Node tools share the same projection.
//
// Pixel space: x grows right, y grows down, and (0, 0) is the camera axis.
// Every shot is a whole-pixel window on this space, so shots line up exactly.

export const CAMERA = {
  // Perth CBD on the WGS84 ellipsoid. The map's projection hangs off this point.
  origin: { lat: 44.0582, lon: -121.3153, height: 1085 },
  tiltDeg: 45, // Down from the horizon.
  yawDeg: 15, // Clockwise from north: the camera looks north 15° east.
  metresPerPixel: 0.293,
  // Back along the axis. An orthographic view does not change with it.
  standoffMetres: 20000,
};

const WGS84_A = 6378137;
const WGS84_E2 = 6.69437999014e-3;
const rad = (deg) => (deg * Math.PI) / 180;
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const add = (a, b, k = 1) => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];

/** Geodetic degrees and metres to Earth-centred coordinates. */
export function toEcef(lat, lon, height = 0) {
  const phi = rad(lat);
  const lam = rad(lon);
  const n = WGS84_A / Math.sqrt(1 - WGS84_E2 * Math.sin(phi) ** 2);
  return [
    (n + height) * Math.cos(phi) * Math.cos(lam),
    (n + height) * Math.cos(phi) * Math.sin(lam),
    (n * (1 - WGS84_E2) + height) * Math.sin(phi),
  ];
}

/** Earth-centred coordinates to geodetic degrees and metres (Bowring). */
export function fromEcef([x, y, z]) {
  const b = WGS84_A * Math.sqrt(1 - WGS84_E2);
  const ep2 = (WGS84_A ** 2 - b ** 2) / b ** 2;
  const p = Math.hypot(x, y);
  const theta = Math.atan2(z * WGS84_A, p * b);
  const phi = Math.atan2(
    z + ep2 * b * Math.sin(theta) ** 3,
    p - WGS84_E2 * WGS84_A * Math.cos(theta) ** 3,
  );
  const n = WGS84_A / Math.sqrt(1 - WGS84_E2 * Math.sin(phi) ** 2);
  return {
    lat: (phi * 180) / Math.PI,
    lon: (Math.atan2(y, x) * 180) / Math.PI,
    height: p / Math.cos(phi) - n,
  };
}

/** The camera's fixed axes in Earth-centred coordinates, from its east-north-up frame. */
export function cameraBasis(camera = CAMERA) {
  const phi = rad(camera.origin.lat);
  const lam = rad(camera.origin.lon);
  const east = [-Math.sin(lam), Math.cos(lam), 0];
  const north = [-Math.sin(phi) * Math.cos(lam), -Math.sin(phi) * Math.sin(lam), Math.cos(phi)];
  const up = [Math.cos(phi) * Math.cos(lam), Math.cos(phi) * Math.sin(lam), Math.sin(phi)];

  const yaw = rad(camera.yawDeg);
  const tilt = rad(camera.tiltDeg);
  const heading = add([east[0] * Math.sin(yaw), east[1] * Math.sin(yaw), east[2] * Math.sin(yaw)], north, Math.cos(yaw));
  const right = add([east[0] * Math.cos(yaw), east[1] * Math.cos(yaw), east[2] * Math.cos(yaw)], north, -Math.sin(yaw));
  const forward = add([heading[0] * Math.cos(tilt), heading[1] * Math.cos(tilt), heading[2] * Math.cos(tilt)], up, -Math.sin(tilt));
  const imageUp = add([heading[0] * Math.sin(tilt), heading[1] * Math.sin(tilt), heading[2] * Math.sin(tilt)], up, Math.cos(tilt));

  const originEcef = toEcef(camera.origin.lat, camera.origin.lon, camera.origin.height);
  const position = add(originEcef, forward, -camera.standoffMetres);
  return { right, imageUp, forward, originEcef, position };
}

/** A geodetic point to pixel space, plus its distance from the camera plane in metres. */
export function project(lat, lon, height = 0, camera = CAMERA) {
  const basis = cameraBasis(camera);
  const delta = add(toEcef(lat, lon, height), basis.originEcef, -1);
  return {
    x: dot(delta, basis.right) / camera.metresPerPixel,
    y: -dot(delta, basis.imageUp) / camera.metresPerPixel,
    depth: dot(delta, basis.forward) + camera.standoffMetres,
  };
}

/** A pixel and its depth back to a geodetic point. */
export function unproject(x, y, depth, camera = CAMERA) {
  const basis = cameraBasis(camera);
  let p = add(basis.position, basis.right, x * camera.metresPerPixel);
  p = add(p, basis.imageUp, -y * camera.metresPerPixel);
  return fromEcef(add(p, basis.forward, depth));
}

/** The whole-pixel shot window centred on a geodetic point. */
export function shotAt(id, lat, lon, height, size, camera = CAMERA) {
  const c = project(lat, lon, height, camera);
  return { id, x: Math.round(c.x - size / 2), y: Math.round(c.y - size / 2), size };
}

/** Depth along the view ray through a pixel, where the ray reaches a height above the ellipsoid. */
export function depthAtHeight(x, y, height, camera = CAMERA) {
  let depth = camera.standoffMetres;
  for (let i = 0; i < 8; i++) {
    depth += (unproject(x, y, depth, camera).height - height) / Math.sin(rad(camera.tiltDeg));
  }
  return depth;
}

/** The 16-bit depth range for a shot: 1 km centred on its middle, at the given ground height. */
export function depthRange(shot, groundHeight = 0, camera = CAMERA) {
  const depth = depthAtHeight(shot.x + shot.size / 2, shot.y + shot.size / 2, groundHeight, camera);
  return { near: depth - 500, far: depth + 500 };
}
