/**
 * Aircraft sprite atlas generated at runtime from vector paths (no image assets).
 * Each 64 px cell stores the fill coverage in the red channel and fill + outline coverage in green.
 */

export const CELL = 64;
export const COLS = 4;
export const ROWS = 2;

/** Cell index per sprite. */
export const SPRITE = { jet: 0, heavy: 1, light: 2, rotor: 3, glider: 4, ground: 5, other: 6, ring: 7 } as const;

const PATHS: Record<number, string[]> = {
  [SPRITE.jet]: [
    "M32 4C34 4 35 8 35 14L35 26L58 40L58 45L35 38L35 50L42 56L42 59L32 57L22 59L22 56L29 50L29 38L6 45L6 40L29 26L29 14C29 8 30 4 32 4Z",
  ],
  [SPRITE.heavy]: [
    "M32 3C35 3 36 8 36 14L36 24L61 41L61 47L36 40L36 52L44 58L44 61L32 59L20 61L20 58L28 52L28 40L3 47L3 41L28 24L28 14C28 8 29 3 32 3Z",
  ],
  [SPRITE.light]: [
    "M32 6C34 6 35 9 35 14L35 28L56 28L56 34L35 36L35 50L44 52L44 57L32 56L20 57L20 52L29 50L29 36L8 34L8 28L29 28L29 14C29 9 30 6 32 6Z",
  ],
  [SPRITE.rotor]: [
    "M32 14C38 14 40 22 40 30C40 36 37 40 34 42L34 56L38 58L38 61L26 61L26 58L30 56L30 42C27 40 24 36 24 30C24 22 26 14 32 14Z",
    "M9 21L13 17L56 43L52 47Z",
    "M55 21L51 17L8 43L12 47Z",
  ],
  [SPRITE.glider]: [
    "M32 6C33.5 6 34.5 9 34.5 14L34.5 30L62 31L62 34L34.5 36L34.5 50L40 54L40 57L32 56L24 57L24 54L29.5 50L29.5 36L2 34L2 31L29.5 30L29.5 14C29.5 9 30.5 6 32 6Z",
  ],
  [SPRITE.ground]: ["M23 20H41V44H23Z"],
  [SPRITE.other]: ["M32 14L46 32L32 50L18 32Z"],
};

function drawCell(ctx: CanvasRenderingContext2D, cell: number, outline: boolean): void {
  const ox = (cell % COLS) * CELL;
  const oy = Math.floor(cell / COLS) * CELL;
  ctx.save();
  ctx.translate(ox, oy);
  ctx.fillStyle = "#fff";
  ctx.strokeStyle = "#fff";
  ctx.lineJoin = "round";
  if (cell === SPRITE.ring) {
    ctx.lineWidth = outline ? 7 : 4;
    ctx.beginPath();
    ctx.arc(32, 32, 26, 0, Math.PI * 2);
    ctx.stroke();
  } else {
    for (const d of PATHS[cell] ?? []) {
      const p = new Path2D(d);
      if (outline) {
        ctx.lineWidth = 5;
        ctx.stroke(p);
      }
      ctx.fill(p);
    }
  }
  ctx.restore();
}

/** RGBA bytes for the atlas: R = fill coverage, G = fill plus outline coverage. */
export function buildAtlas(): { data: Uint8Array; width: number; height: number } {
  const width = COLS * CELL;
  const height = ROWS * CELL;
  const make = (outline: boolean): Uint8ClampedArray => {
    const c = document.createElement("canvas");
    c.width = width;
    c.height = height;
    const ctx = c.getContext("2d", { willReadFrequently: true });
    if (!ctx) throw new Error("2D canvas unavailable");
    for (let i = 0; i < COLS * ROWS; i++) drawCell(ctx, i, outline);
    return ctx.getImageData(0, 0, width, height).data;
  };
  const fill = make(false);
  const both = make(true);
  const out = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    out[i * 4] = fill[i * 4 + 3] ?? 0;
    out[i * 4 + 1] = both[i * 4 + 3] ?? 0;
    out[i * 4 + 3] = 255;
  }
  return { data: out, width, height };
}

/** Sprite and relative size per aircraft category (see server Category enum). */
export function spriteFor(category: number, onGround: boolean): { cell: number; scale: number } {
  if (onGround && category !== 4) return { cell: SPRITE.jet, scale: 0.75 };
  switch (category) {
    case 1:
      return { cell: SPRITE.light, scale: 0.85 };
    case 3:
      return { cell: SPRITE.heavy, scale: 1.2 };
    case 4:
      return { cell: SPRITE.rotor, scale: 0.9 };
    case 5:
      return { cell: SPRITE.glider, scale: 0.95 };
    case 6:
      return { cell: SPRITE.ground, scale: 0.6 };
    case 7:
      return { cell: SPRITE.other, scale: 0.8 };
    default:
      return { cell: SPRITE.jet, scale: 1 };
  }
}
