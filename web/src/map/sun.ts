/** Where the Sun stands: the point on Earth with the Sun straight overhead, from the date (about 0.1 degree). */
export function subsolarPoint(date: Date): { lat: number; lon: number } {
  const rad = Math.PI / 180;
  const n = date.getTime() / 86400000 + 2440587.5 - 2451545.0; // days since J2000
  const meanLon = (280.46 + 0.9856474 * n) % 360;
  const g = ((357.528 + 0.9856003 * n) % 360) * rad;
  const eclLon = (meanLon + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * rad;
  const obliquity = (23.439 - 0.0000004 * n) * rad;
  const declination = Math.asin(Math.sin(obliquity) * Math.sin(eclLon));
  const rightAscension = Math.atan2(Math.cos(obliquity) * Math.sin(eclLon), Math.cos(eclLon));
  const gmstDeg = (((18.697374558 + 24.06570982441908 * n) % 24) + 24) % 24 * 15;
  let lon = rightAscension / rad - gmstDeg;
  lon = ((((lon + 180) % 360) + 360) % 360) - 180;
  return { lat: declination / rad, lon };
}

/**
 * Cosine of the angle between the surface normal and the Sun for a point on the visible disc. (u, v) is the
 * position on the disc in units of the disc radius (u right, v up); the camera model is the same pinhole the
 * aircraft layer uses. Returns null outside the globe.
 */
export function sunLight(
  u: number,
  v: number,
  view: { radius: number; camera: number; rim: number },
  sun: { sx: number; sy: number; sz: number },
): number | null {
  const dx = u * view.rim;
  const dy = v * view.rim;
  const A = view.camera;
  const D = view.radius + A;
  // ray from the camera at (0, 0, D) through the screen point, against the sphere of radius R at the origin
  const len = Math.hypot(dx, dy, A);
  const rx = dx / len;
  const ry = dy / len;
  const rz = -A / len;
  const b = D * rz;
  const c = D * D - view.radius * view.radius;
  const disc = b * b - c;
  if (disc < 0) return null;
  const t = -b - Math.sqrt(disc);
  const px = t * rx;
  const py = t * ry;
  const pz = D + t * rz;
  return (px * sun.sx + py * sun.sy + pz * sun.sz) / view.radius;
}

/** The Sun's direction in the camera frame of a globe centred on (lat0, lon0): x east, y north, z at the viewer. */
export function sunInView(sun: { lat: number; lon: number }, lat0: number, lon0: number): { sx: number; sy: number; sz: number } {
  const rad = Math.PI / 180;
  const dl = (sun.lon - lon0) * rad;
  const la = sun.lat * rad;
  const l0 = lat0 * rad;
  return {
    sx: Math.cos(la) * Math.sin(dl),
    sy: Math.cos(l0) * Math.sin(la) - Math.sin(l0) * Math.cos(la) * Math.cos(dl),
    sz: Math.sin(l0) * Math.sin(la) + Math.cos(l0) * Math.cos(la) * Math.cos(dl),
  };
}
