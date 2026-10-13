import { type AircraftRecord, FLAG_GROUND, hexString } from "./codec";
import { angleDiff, clamp, latToY, lonToX, mercatorVelocity } from "./geo";

/** Seconds a position is extrapolated before the aircraft holds its last predicted spot. */
export const MAX_EXTRAPOLATION_S = 300;
/** Seconds over which a correction from a new update is blended in. */
export const BLEND_S = 1.5;
/** Corrections larger than this (Mercator units, about 0.4 degrees) snap instead of blending. */
const SNAP_DISTANCE = 0.001;

export class Plane {
  readonly hex: number;
  readonly id: string;
  tileKey = -1;
  callsign = "";
  category = 0;
  flags = 0;
  squawk = 0;
  altFt: number | null = null;
  vrateFpm = 0;
  speedKt: number | null = null;
  track: number | null = null;
  /** Position in Mercator units at server time t0 (seconds). */
  mx0 = 0;
  my0 = 0;
  t0 = 0;
  vx = 0;
  vy = 0;
  /** Blend offset applied on top of the extrapolated position, decaying to zero. */
  offX = 0;
  offY = 0;
  blendStart = 0;
  /** Heading currently drawn; eased towards `track` each frame. */
  shownTrack = 0;
  /** Server time (seconds) the tile that carried this record was fetched. */
  fetchedAt = 0;

  constructor(hex: number) {
    this.hex = hex;
    this.id = hexString(hex);
  }

  get onGround(): boolean {
    return (this.flags & FLAG_GROUND) !== 0;
  }

  /** Apply a fresh record. ``now`` and ``fetchedAtS`` are server-clock seconds. */
  update(r: AircraftRecord, fetchedAtS: number, now: number): boolean {
    const t0 = fetchedAtS - r.ageS;
    if (this.t0 !== 0 && t0 <= this.t0) return false;
    const first = this.t0 === 0;
    const before = first ? null : this.positionAt(now);
    this.callsign = r.callsign;
    this.category = r.category;
    this.flags = r.flags;
    this.squawk = r.squawk;
    this.altFt = r.altFt;
    this.vrateFpm = r.vrateFpm ?? 0;
    this.speedKt = r.speedKt;
    this.track = r.track;
    this.mx0 = lonToX(r.lon);
    this.my0 = latToY(r.lat);
    this.t0 = t0;
    this.fetchedAt = fetchedAtS;
    if (r.speedKt !== null && r.track !== null && !this.onGround) {
      const v = mercatorVelocity(r.lat, r.track, r.speedKt);
      this.vx = v.vx;
      this.vy = v.vy;
    } else {
      this.vx = 0;
      this.vy = 0;
    }
    if (first) {
      this.shownTrack = r.track ?? 0;
      this.offX = 0;
      this.offY = 0;
    } else if (before) {
      const after = this.positionAt(now, false);
      const dx = before.x - after.x;
      const dy = before.y - after.y;
      if (Math.hypot(dx, dy) > SNAP_DISTANCE) {
        this.offX = 0;
        this.offY = 0;
      } else {
        this.offX = dx;
        this.offY = dy;
        this.blendStart = now;
      }
    }
    return true;
  }

  /** Drawn position (Mercator units) at server time ``now``, including the blend offset. */
  positionAt(now: number, withBlend = true): { x: number; y: number } {
    const dt = clamp(now - this.t0, 0, MAX_EXTRAPOLATION_S);
    let x = this.mx0 + this.vx * dt;
    let y = this.my0 + this.vy * dt;
    if (withBlend && (this.offX !== 0 || this.offY !== 0)) {
      const k = (now - this.blendStart) / BLEND_S;
      if (k >= 1) {
        this.offX = 0;
        this.offY = 0;
      } else if (k >= 0) {
        const e = 1 - k * k * (3 - 2 * k); // smoothstep, reversed: 1 -> 0
        x += this.offX * e;
        y += this.offY * e;
      }
    }
    return { x, y };
  }

  /** Predicted barometric altitude (feet) at ``now``. */
  altitudeAt(now: number): number | null {
    if (this.altFt === null) return null;
    const dt = clamp(now - this.t0, 0, 120);
    return Math.max(0, this.altFt + (this.vrateFpm / 60) * dt);
  }

  /** Ease the drawn heading towards the reported track; returns the heading in degrees. */
  easeTrack(frameDt: number): number {
    if (this.track === null) return this.shownTrack;
    const d = angleDiff(this.shownTrack, this.track);
    const a = 1 - Math.exp(-frameDt / 0.35);
    this.shownTrack = (this.shownTrack + d * a + 360) % 360;
    return this.shownTrack;
  }
}
