import { type AircraftRecord, type Snapshot, type TileBlock } from "./codec";
import { Plane } from "./plane";
import { tileKey } from "./tiles";

/** Holds every known aircraft and merges tile snapshots into it. */
export class AircraftStore {
  readonly byHex = new Map<number, Plane>();
  planes: Plane[] = [];
  private byTile = new Map<number, Set<number>>();
  private dirty = false;

  get size(): number {
    return this.byHex.size;
  }

  /** ``now`` is server-clock seconds. Returns how many aircraft changed. */
  apply(snapshot: Snapshot, now: number): number {
    let changed = 0;
    for (const tile of snapshot.tiles) changed += this.applyTile(tile, now);
    if (this.dirty) {
      this.planes = Array.from(this.byHex.values());
      this.dirty = false;
    }
    return changed;
  }

  private applyTile(tile: TileBlock, now: number): number {
    const key = tileKey(tile.tx, tile.ty);
    const fetchedAtS = tile.fetchedAtMs / 1000;
    const seen = new Set<number>();
    let changed = 0;
    for (const r of tile.records as AircraftRecord[]) {
      seen.add(r.hex);
      let plane = this.byHex.get(r.hex);
      if (!plane) {
        plane = new Plane(r.hex);
        this.byHex.set(r.hex, plane);
        this.dirty = true;
      }
      if (plane.update(r, fetchedAtS, now)) {
        plane.tileKey = key;
        changed++;
      }
    }
    const previous = this.byTile.get(key);
    if (previous) {
      for (const hex of previous) {
        if (seen.has(hex)) continue;
        const plane = this.byHex.get(hex);
        if (plane && plane.tileKey === key) {
          this.byHex.delete(hex);
          this.dirty = true;
        }
      }
    }
    this.byTile.set(key, seen);
    return changed;
  }

  get(hex: number): Plane | undefined {
    return this.byHex.get(hex);
  }

  /** Drop aircraft whose data is older than ``maxAgeS`` (server seconds), e.g. after leaving an area. */
  prune(now: number, maxAgeS: number): void {
    for (const [hex, p] of this.byHex) {
      if (now - p.fetchedAt > maxAgeS) {
        this.byHex.delete(hex);
        this.dirty = true;
      }
    }
    if (this.dirty) {
      this.planes = Array.from(this.byHex.values());
      this.dirty = false;
    }
  }
}
