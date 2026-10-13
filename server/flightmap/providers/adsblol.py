"""ADSB.lol provider (https://api.adsb.lol, data licensed ODbL 1.0)."""

from __future__ import annotations

import math
import re
from typing import Any, cast

from ..codec import SOURCE_ADSBLOL
from ..models import Aircraft, Category
from ..tiles import Tile, bounds_of, center_of, query_radius_nm
from ..upstream import UpstreamClient, UpstreamError

_HEX = re.compile(r"^[0-9a-f]{6}$")

# ADS-B emitter categories: A1 light, A2 small, A3 large, A4 B757, A5 heavy, A6 high
# performance, A7 rotorcraft, B1 glider, B2 balloon, B4 ultralight, C* surface vehicles.
_CATEGORY_MAP = {
    "A1": Category.LIGHT,
    "A2": Category.LIGHT,
    "A3": Category.JET,
    "A4": Category.JET,
    "A5": Category.HEAVY,
    "A6": Category.JET,
    "A7": Category.ROTORCRAFT,
    "B1": Category.GLIDER,
    "B2": Category.OTHER,
    "B4": Category.LIGHT,
    "C1": Category.GROUND,
    "C2": Category.GROUND,
    "C3": Category.GROUND,
}


def _num(value: Any) -> float | None:
    if isinstance(value, bool) or not isinstance(value, int | float):
        return None
    number = float(value)
    return number if math.isfinite(number) else None  # Python's JSON parser accepts NaN and Infinity


def parse_aircraft(raw: dict[str, Any]) -> Aircraft | None:
    """Convert one ADSB.lol / ADSBExchange-v2 record, or None when it has no usable position."""
    hex_raw = str(raw.get("hex", "")).lower().lstrip("~")
    lat, lon = _num(raw.get("lat")), _num(raw.get("lon"))
    if lat is None or lon is None or not _HEX.match(hex_raw):
        return None
    if not (-90.0 <= lat <= 90.0 and -180.0 <= lon <= 180.0):
        return None
    alt_raw = raw.get("alt_baro")
    on_ground = alt_raw == "ground"
    alt = None if on_ground else _num(alt_raw)
    vrate = _num(raw.get("baro_rate"))
    if vrate is None:
        vrate = _num(raw.get("geom_rate"))
    squawk_raw = str(raw.get("squawk", ""))
    squawk = int(squawk_raw) if squawk_raw.isdigit() else None
    msg_type = str(raw.get("type", ""))
    category = _CATEGORY_MAP.get(str(raw.get("category", "")), Category.UNKNOWN)
    type_code = str(raw.get("t", "")).strip()
    return Aircraft(
        hex=int(hex_raw, 16),
        lat=lat,
        lon=lon,
        callsign=str(raw.get("flight", "")).strip(),
        registration=str(raw.get("r", "")).strip(),
        type_code=type_code,
        category=category,
        altitude_ft=None if alt is None else int(alt),
        on_ground=on_ground,
        ground_speed_kt=_num(raw.get("gs")),
        track_deg=_num(raw.get("track")),
        vertical_rate_fpm=None if vrate is None else int(vrate),
        squawk=squawk,
        military=bool(int(raw.get("dbFlags", 0) or 0) & 1),
        non_adsb=msg_type not in {"adsb_icao", "adsb_other", "adsb_icao_nt", "adsc"},
        emergency=squawk in {7500, 7600, 7700} or str(raw.get("emergency", "none")) not in {"none", ""},
        position_age_s=_num(raw.get("seen_pos")) or 0.0,
    )


def parse_point_response(payload: Any) -> list[Aircraft]:
    if not isinstance(payload, dict) or not isinstance(cast(dict[str, Any], payload).get("ac"), list):
        raise UpstreamError("unexpected ADSB.lol response shape")
    seen: dict[int, Aircraft] = {}
    records = cast(list[Any], cast(dict[str, Any], payload)["ac"])
    for rec in records:
        if not isinstance(rec, dict):
            continue
        try:
            a = parse_aircraft(cast(dict[str, Any], rec))
        except (TypeError, ValueError):  # one malformed record must not cost the whole tile
            continue
        if a is not None:
            seen[a.hex] = a
    return list(seen.values())


class AdsbLolProvider:
    name = "adsb.lol"
    source_id = SOURCE_ADSBLOL

    def __init__(self, client: UpstreamClient, base_url: str) -> None:
        self._client = client
        self._base = base_url.rstrip("/")

    async def fetch_tile(self, tile: Tile) -> list[Aircraft]:
        lat, lon = center_of(tile)
        radius = query_radius_nm(tile)
        url = f"{self._base}/v2/point/{lat:.4f}/{lon:.4f}/{radius}"
        payload = await self._client.get_json(url)
        b = bounds_of(tile)
        return [a for a in parse_point_response(payload) if b.contains(a.lat, a.lon)]

    async def fetch_hex(self, hex_str: str) -> Aircraft | None:
        """Current state of one aircraft anywhere in the world (None when it is not tracked)."""
        payload = await self._client.get_json(f"{self._base}/v2/hex/{hex_str.lower()}")
        found = parse_point_response(payload)
        return found[0] if found else None
