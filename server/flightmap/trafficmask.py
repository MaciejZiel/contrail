"""Tiles worth fetching when a viewer looks at a large area (world view)."""

from __future__ import annotations

import json
from importlib import resources

from .tiles import Tile, parse_tile_id


def load_traffic_tiles() -> frozenset[Tile]:
    raw = resources.files("flightmap").joinpath("data/traffic_tiles.json").read_text("utf-8")
    return frozenset(parse_tile_id(t) for t in json.loads(raw))
