/** Tile grid shared with the server (5 degree tiles). */

export const TILE_DEG = 5;
export const COLS = 72;
export const ROWS = 36;

export interface TileRect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface Bounds {
  west: number;
  south: number;
  east: number;
  north: number;
}

export function tileKey(tx: number, ty: number): number {
  return ty * COLS + tx;
}

/** Inclusive tile rectangle covering the bounds plus a margin; x0 > x1 means it wraps. */
export function rectForBounds(b: Bounds, marginDeg = 0): TileRect {
  const south = Math.max(-90, b.south - marginDeg);
  const north = Math.min(89.999, b.north + marginDeg);
  const y0 = Math.floor((south + 90) / TILE_DEG);
  const y1 = Math.floor((north + 90) / TILE_DEG);
  if (b.east - b.west + 2 * marginDeg >= 360) return { x0: 0, y0, x1: COLS - 1, y1 };
  const mod = (n: number) => ((n % COLS) + COLS) % COLS;
  const x0 = mod(Math.floor((b.west - marginDeg + 180) / TILE_DEG));
  const x1 = mod(Math.floor((b.east + marginDeg + 180) / TILE_DEG));
  return { x0, y0, x1, y1 };
}

export function rectTileCount(r: TileRect): number {
  const w = r.x0 <= r.x1 ? r.x1 - r.x0 + 1 : COLS - r.x0 + r.x1 + 1;
  return w * (r.y1 - r.y0 + 1);
}

export function rectKey(r: TileRect): string {
  return `${r.x0},${r.y0},${r.x1},${r.y1}`;
}

export function rectQuery(r: TileRect): string {
  return `x0=${r.x0}&y0=${r.y0}&x1=${r.x1}&y1=${r.y1}`;
}
