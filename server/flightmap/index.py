"""In-memory index of the aircraft currently held in the tile cache."""

from __future__ import annotations

from .models import Aircraft
from .tiles import Tile


class AircraftIndex:
    def __init__(self) -> None:
        self._by_hex: dict[int, tuple[Aircraft, Tile, float]] = {}
        self._by_tile: dict[Tile, set[int]] = {}

    def update(self, tile: Tile, aircraft: list[Aircraft], fetched_at: float) -> None:
        """Listener for :class:`TileCache`: replace the aircraft of one tile."""
        fresh = {a.hex for a in aircraft}
        for hex_ in self._by_tile.get(tile, set()) - fresh:
            cur = self._by_hex.get(hex_)
            if cur and cur[1] == tile:
                del self._by_hex[hex_]
        for a in aircraft:
            self._by_hex[a.hex] = (a, tile, fetched_at)
        self._by_tile[tile] = fresh

    def get(self, hex_: int) -> tuple[Aircraft, float] | None:
        cur = self._by_hex.get(hex_)
        return (cur[0], cur[2]) if cur else None

    def __len__(self) -> int:
        return len(self._by_hex)

    def values(self) -> list[tuple[Aircraft, float]]:
        return [(a, t) for a, _tile, t in self._by_hex.values()]
