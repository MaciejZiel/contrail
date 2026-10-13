export interface TrailBox {
  west: number;
  south: number;
  east: number;
  north: number;
}

const DIVISIONS = 8;
const MIN_STEP = 1 / 64;

/**
 * Grows a map box outwards onto a power-of-two grid of about 1/8 of its size, the same arithmetic as
 * `snap_box` on the server. Viewers of nearly the same area then send identical URLs, which the
 * server's result reuse and nginx's micro-cache can both answer once. A box 360 degrees or more wide
 * becomes the whole world; one with east < west crosses the antimeridian.
 */
export function snapBox(box: TrailBox): TrailBox {
  let { west: w, south: s, east: e, north: n } = box;
  let span = e >= w ? e - w : (((e - w) % 360) + 360) % 360;
  const world = span >= 360;
  if (world) {
    w = -180;
    span = 360;
  } else {
    w = ((((w + 180) % 360) + 360) % 360) - 180;
  }
  const step = Math.max(MIN_STEP, 2 ** Math.floor(Math.log2(Math.max(span, n - s, 1e-9) / DIVISIONS)));
  const south = Math.max(-90, Math.floor(s / step) * step);
  const north = Math.min(90, Math.ceil(n / step) * step);
  if (world) return { west: -180, south, east: 180, north };
  const w0 = Math.floor(w / step) * step;
  const e0 = Math.ceil((w + span) / step) * step;
  if (e0 - w0 >= 360) return { west: -180, south, east: 180, north };
  const wrap = (x: number) => ((((x + 180) % 360) + 360) % 360) - 180;
  return { west: wrap(w0), south, east: wrap(e0), north };
}
