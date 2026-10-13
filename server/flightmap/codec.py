"""Compact binary encoding of aircraft tiles (little endian).

Response layout::

    header   16 bytes  magic "LFM1", u16 tile count, u16 reserved, u64 server time (ms)
    tile     16 bytes  i16 tx, i16 ty, u64 fetched-at (ms), u16 count, u8 source, u8 reserved
             count * 32-byte records

Record layout (32 bytes)::

    u32  icao24 (bits 0-23) | flags (bits 24-31)
    i32  latitude  * 1e5          i32  longitude * 1e5
    u16  track * 10 (0xFFFF unknown)          u16 ground speed * 10 (0xFFFF unknown)
    i16  altitude / 25 ft (0x7FFF unknown)    i16 vertical rate / 64 fpm (0x7FFF unknown)
    u8   category                 u8  position age in seconds at fetch time (saturating)
    8s   callsign (ASCII, space padded)
    u16  squawk (decimal reading, 0 unknown)
"""

from __future__ import annotations

import struct
from collections.abc import Iterable
from dataclasses import dataclass

from .models import (
    FLAG_EMERGENCY,
    FLAG_GROUND,
    FLAG_MILITARY,
    FLAG_NON_ADSB,
    Aircraft,
    Category,
)

MAGIC = b"LFM1"
HEADER = struct.Struct("<4sHHQ")
TILE_HEADER = struct.Struct("<hhQHBB")
RECORD = struct.Struct("<IiiHHhhBB8sH")
RECORD_SIZE = RECORD.size  # 32
UNKNOWN_U16 = 0xFFFF
UNKNOWN_I16 = 0x7FFF

SOURCE_ADSBLOL = 1
SOURCE_OPENSKY = 2
SOURCE_DEMO = 3


def _clamp(value: int, lo: int, hi: int) -> int:
    return max(lo, min(hi, value))


def encode_aircraft(items: Iterable[Aircraft]) -> bytes:
    """Encode aircraft into concatenated 32-byte records."""
    out = bytearray()
    for a in items:
        flags = (
            (FLAG_GROUND if a.on_ground else 0)
            | (FLAG_MILITARY if a.military else 0)
            | (FLAG_NON_ADSB if a.non_adsb else 0)
            | (FLAG_EMERGENCY if a.emergency else 0)
        )
        track = UNKNOWN_U16 if a.track_deg is None else round(a.track_deg * 10) % 3600
        speed = UNKNOWN_U16 if a.ground_speed_kt is None else _clamp(round(a.ground_speed_kt * 10), 0, 0xFFFE)
        alt = UNKNOWN_I16 if a.altitude_ft is None else _clamp(round(a.altitude_ft / 25), -32000, 32000)
        vrate = (
            UNKNOWN_I16
            if a.vertical_rate_fpm is None
            else _clamp(round(a.vertical_rate_fpm / 64), -32000, 32000)
        )
        age = _clamp(round(a.position_age_s), 0, 255)
        call = a.callsign.encode("ascii", "replace")[:8].ljust(8, b" ")
        out += RECORD.pack(
            (a.hex & 0xFFFFFF) | (flags << 24),
            _clamp(round(a.lat * 1e5), -9_000_000, 9_000_000),
            _clamp(round(a.lon * 1e5), -18_000_000, 18_000_000),
            track,
            speed,
            alt,
            vrate,
            int(a.category),
            age,
            call,
            a.squawk or 0,
        )
    return bytes(out)


@dataclass(slots=True)
class DecodedTile:
    tx: int
    ty: int
    fetched_at_ms: int
    source: int
    aircraft: list[Aircraft]


def encode_header(tile_count: int, now_ms: int) -> bytes:
    """Response header; written per response so the server time in it is always current."""
    return HEADER.pack(MAGIC, tile_count, 0, now_ms)


def encode_tiles(tiles: Iterable[tuple[int, int, int, int, int, bytes]]) -> tuple[int, bytes]:
    """Tile blocks without the response header: (tile count, bytes).

    tiles: (tx, ty, fetched_at_ms, count, source, record bytes).
    """
    out = bytearray()
    n = 0
    for tx, ty, fetched, count, source, payload in tiles:
        out += TILE_HEADER.pack(tx, ty, fetched, count, source, 0)
        out += payload
        n += 1
    return n, bytes(out)


def encode_response(now_ms: int, tiles: Iterable[tuple[int, int, int, int, int, bytes]]) -> bytes:
    """tiles: (tx, ty, fetched_at_ms, count, source, record bytes)."""
    n, body = encode_tiles(tiles)
    return encode_header(n, now_ms) + body


def decode_response(data: bytes) -> tuple[int, list[DecodedTile]]:
    magic, count, _, now_ms = HEADER.unpack_from(data, 0)
    if magic != MAGIC:
        raise ValueError("bad magic")
    pos = HEADER.size
    tiles: list[DecodedTile] = []
    for _ in range(count):
        tx, ty, fetched, n, source, _r = TILE_HEADER.unpack_from(data, pos)
        pos += TILE_HEADER.size
        items = decode_records(data[pos : pos + n * RECORD_SIZE])
        pos += n * RECORD_SIZE
        tiles.append(DecodedTile(tx, ty, fetched, source, items))
    if pos != len(data):
        raise ValueError("trailing bytes")
    return now_ms, tiles


def decode_records(data: bytes) -> list[Aircraft]:
    if len(data) % RECORD_SIZE:
        raise ValueError("truncated record block")
    items: list[Aircraft] = []
    for hexflags, lat, lon, track, speed, alt, vrate, cat, age, call, squawk in RECORD.iter_unpack(data):
        flags = hexflags >> 24
        items.append(
            Aircraft(
                hex=hexflags & 0xFFFFFF,
                lat=lat / 1e5,
                lon=lon / 1e5,
                callsign=call.decode("ascii", "replace").strip(),
                category=Category(cat) if cat in Category._value2member_map_ else Category.UNKNOWN,
                altitude_ft=None if alt == UNKNOWN_I16 else alt * 25,
                on_ground=bool(flags & FLAG_GROUND),
                ground_speed_kt=None if speed == UNKNOWN_U16 else speed / 10,
                track_deg=None if track == UNKNOWN_U16 else track / 10,
                vertical_rate_fpm=None if vrate == UNKNOWN_I16 else vrate * 64,
                squawk=squawk or None,
                military=bool(flags & FLAG_MILITARY),
                non_adsb=bool(flags & FLAG_NON_ADSB),
                emergency=bool(flags & FLAG_EMERGENCY),
                position_age_s=float(age),
            )
        )
    return items
