/** Decoder for the server's binary aircraft tiles (layout documented in server/flightmap/codec.py). */

export const RECORD_SIZE = 32;
const HEADER_SIZE = 16;
const TILE_HEADER_SIZE = 16;
const UNKNOWN_U16 = 0xffff;
const UNKNOWN_I16 = 0x7fff;
const MAGIC = 0x314d464c; // "LFM1" little endian

export const FLAG_GROUND = 1;
export const FLAG_MILITARY = 2;
export const FLAG_NON_ADSB = 4;
export const FLAG_EMERGENCY = 8;

export interface AircraftRecord {
  hex: number;
  lat: number;
  lon: number;
  track: number | null;
  speedKt: number | null;
  altFt: number | null;
  vrateFpm: number | null;
  category: number;
  flags: number;
  ageS: number;
  callsign: string;
  squawk: number;
}

export interface TileBlock {
  tx: number;
  ty: number;
  fetchedAtMs: number;
  source: number;
  records: AircraftRecord[];
}

export interface Snapshot {
  serverNowMs: number;
  tiles: TileBlock[];
}

export function decodeSnapshot(buffer: ArrayBuffer): Snapshot {
  const view = new DataView(buffer);
  if (buffer.byteLength < HEADER_SIZE || view.getUint32(0, true) !== MAGIC) {
    throw new Error("bad snapshot header");
  }
  const count = view.getUint16(4, true);
  const serverNowMs = Number(view.getBigUint64(8, true));
  let pos = HEADER_SIZE;
  const tiles: TileBlock[] = [];
  for (let i = 0; i < count; i++) {
    if (pos + TILE_HEADER_SIZE > buffer.byteLength) throw new Error("truncated tile header");
    const tx = view.getInt16(pos, true);
    const ty = view.getInt16(pos + 2, true);
    const fetchedAtMs = Number(view.getBigUint64(pos + 4, true));
    const n = view.getUint16(pos + 12, true);
    const source = view.getUint8(pos + 14);
    pos += TILE_HEADER_SIZE;
    if (pos + n * RECORD_SIZE > buffer.byteLength) throw new Error("truncated tile body");
    const records: AircraftRecord[] = new Array(n);
    for (let j = 0; j < n; j++) records[j] = readRecord(view, pos + j * RECORD_SIZE);
    pos += n * RECORD_SIZE;
    tiles.push({ tx, ty, fetchedAtMs, source, records });
  }
  if (pos !== buffer.byteLength) throw new Error("trailing bytes in snapshot");
  return { serverNowMs, tiles };
}

function readRecord(view: DataView, o: number): AircraftRecord {
  const hexFlags = view.getUint32(o, true);
  const track = view.getUint16(o + 12, true);
  const speed = view.getUint16(o + 14, true);
  const alt = view.getInt16(o + 16, true);
  const vrate = view.getInt16(o + 18, true);
  let callsign = "";
  for (let i = 0; i < 8; i++) {
    const c = view.getUint8(o + 22 + i);
    if (c > 32) callsign += String.fromCharCode(c);
  }
  return {
    hex: hexFlags & 0xffffff,
    flags: hexFlags >>> 24,
    lat: view.getInt32(o + 4, true) / 1e5,
    lon: view.getInt32(o + 8, true) / 1e5,
    track: track === UNKNOWN_U16 ? null : track / 10,
    speedKt: speed === UNKNOWN_U16 ? null : speed / 10,
    altFt: alt === UNKNOWN_I16 ? null : alt * 25,
    vrateFpm: vrate === UNKNOWN_I16 ? null : vrate * 64,
    category: view.getUint8(o + 20),
    ageS: view.getUint8(o + 21),
    callsign,
    squawk: view.getUint16(o + 30, true),
  };
}

export function hexString(hex: number): string {
  return hex.toString(16).padStart(6, "0");
}
