import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { decodeSnapshot, FLAG_EMERGENCY, FLAG_GROUND, FLAG_MILITARY } from "../src/core/codec";

function golden(): ArrayBuffer {
  const hex = readFileSync(new URL("./fixtures/snapshot.hex", import.meta.url), "utf8").trim();
  const bytes = Uint8Array.from(hex.match(/../g) ?? [], (h) => parseInt(h, 16));
  return bytes.buffer;
}

describe("decodeSnapshot", () => {
  it("decodes bytes produced by the Python server codec", () => {
    const snap = decodeSnapshot(golden());
    expect(snap.serverNowMs).toBe(1791900000123);
    expect(snap.tiles).toHaveLength(1);
    const tile = snap.tiles[0]!;
    expect([tile.tx, tile.ty, tile.fetchedAtMs, tile.source]).toEqual([40, 28, 1791899990000, 1]);
    const a = tile.records[0]!;
    expect(a.hex).toBe(0x48ad08);
    expect(a.callsign).toBe("LOT3923");
    expect(a.lat).toBeCloseTo(51.891593, 5);
    expect(a.lon).toBeCloseTo(20.617218, 5);
    expect(a.altFt).toBe(12625);
    expect(a.speedKt).toBeCloseTo(348.5, 1);
    expect(a.track).toBeCloseTo(197.7, 1);
    expect(a.vrateFpm).toBe(2048);
    expect(a.squawk).toBe(7700);
    expect(a.flags & FLAG_MILITARY).toBeTruthy();
    expect(a.flags & FLAG_EMERGENCY).toBeTruthy();
    expect(a.flags & FLAG_GROUND).toBeFalsy();
  });

  it("maps unknown sentinels to null", () => {
    const b = decodeSnapshot(golden()).tiles[0]!.records[1]!;
    expect(b.hex).toBe(1);
    expect(b.flags & FLAG_GROUND).toBeTruthy();
    expect([b.altFt, b.track, b.speedKt, b.vrateFpm]).toEqual([null, null, null, null]);
    expect(b.lat).toBeCloseTo(-33.9, 5);
  });

  it("rejects corrupt input", () => {
    expect(() => decodeSnapshot(new ArrayBuffer(4))).toThrow();
    const bad = new Uint8Array(golden());
    bad[0] = 0;
    expect(() => decodeSnapshot(bad.buffer)).toThrow(/header/);
    expect(() => decodeSnapshot(golden().slice(0, 40))).toThrow();
  });
});
