import { type AircraftRecord, FLAG_GROUND, hexString } from "./codec";
import { angleDiff, clamp, latToY, lonToX, mercatorVelocity } from "./geo";

/** Seconds a position is extrapolated before the aircraft holds its last predicted spot. */
export const MAX_EXTRAPOLATION_S = 300;
/** Seconds over which a correction from a new update is blended in. */
export const BLEND_S = 1.5;
/** A turn rate is only estimated from fixes this close together (seconds); further apart it is not a turn rate. */
const TURN_FIX_MAX_GAP_S = 60;
const TURN_FIX_MIN_GAP_S = 1.5;
/** Standard rate turn, the most an airliner holds; anything above is noise in the reported track. */
const MAX_TURN_RATE = (3 * Math.PI) / 180;
/** Rates below this (about 0.15 degrees per second) are treated as straight flight. */
const MIN_TURN_RATE = (0.15 * Math.PI) / 180;
/** A turn is not extrapolated beyond this many seconds or this many radians, then the aircraft flies straight. */
const MAX_TURN_S = 40;
const MAX_TURN_ANGLE = Math.PI / 2;

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
  /** Turn rate in radians per second, clockwise positive, estimated from the last two fixes (0 = straight). */
  turnRate = 0;
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
    const prevTrack = this.track;
    const prevT0 = this.t0;
    this.callsign = r.callsign;
    this.category = r.category;
    this.flags = r.flags;
    this.squawk = r.squawk;
    this.altFt = r.altFt;
    this.vrateFpm = r.vrateFpm ?? 0;
    this.speedKt = r.speedKt;
    this.track = r.track;
    this.turnRate = 0;
    if (!first && prevTrack !== null && r.track !== null && !(r.flags & FLAG_GROUND)) {
      const gap = t0 - prevT0;
      if (gap >= TURN_FIX_MIN_GAP_S && gap <= TURN_FIX_MAX_GAP_S) {
        const rate = (angleDiff(prevTrack, r.track) * Math.PI) / 180 / gap;
        if (Math.abs(rate) >= MIN_TURN_RATE) this.turnRate = clamp(rate, -MAX_TURN_RATE, MAX_TURN_RATE);
      }
    }
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
    if (this.turnRate !== 0 && (this.vx !== 0 || this.vy !== 0)) {
      // a turn is flown as an arc for a limited time, then straight on the final heading
      const w = this.turnRate;
      const speed = Math.hypot(this.vx, this.vy);
      const a0 = Math.atan2(this.vx, -this.vy);
      const tt = Math.min(dt, this.turnLimit());
      const a1 = a0 + w * tt;
      x = this.mx0 + (speed / w) * (Math.cos(a0) - Math.cos(a1)) + speed * Math.sin(a1) * (dt - tt);
      y = this.my0 - (speed / w) * (Math.sin(a1) - Math.sin(a0)) - speed * Math.cos(a1) * (dt - tt);
    }
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

  /** Seconds the current turn is extrapolated for. */
  private turnLimit(): number {
    return this.turnRate === 0 ? 0 : Math.min(MAX_TURN_S, MAX_TURN_ANGLE / Math.abs(this.turnRate));
  }

  /** Predicted barometric altitude (feet) at ``now``. */
  altitudeAt(now: number): number | null {
    if (this.altFt === null) return null;
    const dt = clamp(now - this.t0, 0, 120);
    return Math.max(0, this.altFt + (this.vrateFpm / 60) * dt);
  }

  /** Ease the drawn heading towards the reported track; returns the heading in degrees. */
  easeTrack(frameDt: number, now?: number): number {
    if (this.track === null) return this.shownTrack;
    let target = this.track;
    if (this.turnRate !== 0 && now !== undefined) {
      target = (target + (this.turnRate * 180 / Math.PI) * Math.min(Math.max(now - this.t0, 0), this.turnLimit()) + 360) % 360;
    }
    const d = angleDiff(this.shownTrack, target);
    const a = 1 - Math.exp(-frameDt / 0.35);
    this.shownTrack = (this.shownTrack + d * a + 360) % 360;
    return this.shownTrack;
  }
}
