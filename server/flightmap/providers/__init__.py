"""Upstream data providers."""

from __future__ import annotations

from typing import Protocol

from ..models import Aircraft
from ..tiles import Tile


class TileProvider(Protocol):
    name: str
    source_id: int

    async def fetch_tile(self, tile: Tile) -> list[Aircraft]:
        """Return the aircraft currently inside ``tile`` or raise ``UpstreamError``."""
        ...

    async def fetch_hex(self, hex_str: str) -> Aircraft | None:
        """Current state of one aircraft anywhere (None when untracked)."""
        ...

    async def fetch_exact(self, kind: str, value: str) -> Aircraft | None:
        """Look one aircraft up by ``kind`` ("hex", "callsign" or "reg"); None when untracked."""
        ...
