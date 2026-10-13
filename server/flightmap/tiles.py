"""Fixed 5 degree tile grid shared by the server cache and the client."""

from __future__ import annotations

import math
from collections.abc import Iterable
from dataclasses import dataclass

TILE_DEG = 5
COLS = 360 // TILE_DEG  # 72
ROWS = 180 // TILE_DEG  # 36
MAX_RADIUS_NM = 250.0
_EARTH_NM = 3440.065

Tile = tuple[int, int]


@dataclass(frozen=True, slots=True)
class Bounds:
    south: float
    west: float
    north: float
    east: float

    def contains(self, lat: float, lon: float) -> bool:
        return self.south <= lat < self.north and self.west <= lon < self.east


def tile_of(lat: float, lon: float) -> Tile:
    """Tile containing a coordinate; longitudes outside +-180 wrap, latitudes clamp."""
    lon = (lon + 180.0) % 360.0
    tx = int(lon // TILE_DEG) % COLS
    ty = int((min(max(lat, -90.0), 89.999999) + 90.0) // TILE_DEG)
    return tx, ty


def bounds_of(tile: Tile) -> Bounds:
    tx, ty = tile
    west = tx * TILE_DEG - 180.0
    south = ty * TILE_DEG - 90.0
    return Bounds(south, west, south + TILE_DEG, west + TILE_DEG)


def center_of(tile: Tile) -> tuple[float, float]:
    b = bounds_of(tile)
    return (b.south + b.north) / 2.0, (b.west + b.east) / 2.0


def _haversine_nm(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dphi = p2 - p1
    dl = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * _EARTH_NM * math.asin(min(1.0, math.sqrt(a)))


def query_radius_nm(tile: Tile) -> int:
    """Smallest whole radius (nm) around the tile centre that covers all four corners."""
    b = bounds_of(tile)
    clat, clon = center_of(tile)
    far = max(_haversine_nm(clat, clon, lat, lon) for lat in (b.south, b.north) for lon in (b.west, b.east))
    return min(math.ceil(far * 1.03), int(MAX_RADIUS_NM))


def tiles_in_rect(x0: int, y0: int, x1: int, y1: int) -> list[Tile]:
    """Tile indices in an inclusive rectangle; x0 > x1 means the range wraps the antimeridian."""
    y_lo, y_hi = max(0, min(y0, y1)), min(ROWS - 1, max(y0, y1))
    x0 %= COLS
    x1 %= COLS
    xs = list(range(x0, x1 + 1)) if x0 <= x1 else list(range(x0, COLS)) + list(range(0, x1 + 1))
    return [(x, y) for y in range(y_lo, y_hi + 1) for x in xs]


def parse_tile_id(raw: str) -> Tile:
    a, b = raw.split("_", 1)
    tx, ty = int(a), int(b)
    if not (0 <= tx < COLS and 0 <= ty < ROWS):
        raise ValueError(f"tile out of range: {raw}")
    return tx, ty


def tile_id(tile: Tile) -> str:
    return f"{tile[0]}_{tile[1]}"


def tile_ids(tiles: Iterable[Tile]) -> list[str]:
    return [tile_id(t) for t in tiles]
