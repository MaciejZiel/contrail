"""Filters over the aircraft the server already holds: callsign prefix, aircraft type, altitude.

Everything here reads the in-memory index; nothing causes an upstream request.
"""

from __future__ import annotations

import re
from collections import Counter
from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any

from .index import AircraftIndex
from .models import Aircraft
from .reference import search_types, type_name

_CALLSIGN_RE = re.compile(r"^[A-Z0-9]{1,8}$")
_TYPE_RE = re.compile(r"^[A-Z0-9-]{1,4}\*?$")
_AIRLINE_RE = re.compile(r"^[A-Z]{3}$")
MAX_TYPE_PATTERNS = 8
ALT_LIMIT = 45000


@dataclass(frozen=True, slots=True)
class AircraftFilter:
    callsign_prefix: str = ""
    types: tuple[str, ...] = ()  # ICAO type codes; a trailing "*" matches a family such as "A32*"
    airline: str = ""
    hide_ground: bool = False
    alt_min: int = 0
    alt_max: int = ALT_LIMIT

    @classmethod
    def from_params(cls, params: Mapping[str, str]) -> AircraftFilter:
        """Parse ``cs``, ``ty``, ``gnd=0`` and ``alt=min-max``; invalid values are ignored."""
        cs = params.get("cs", "").strip().upper()
        types = tuple(
            dict.fromkeys(
                t
                for t in (x.strip().upper() for x in params.get("ty", "").split(",")[:MAX_TYPE_PATTERNS])
                if _TYPE_RE.match(t)
            )
        )
        air = params.get("air", "").strip().upper()
        alt_min, alt_max = 0, ALT_LIMIT
        m = re.fullmatch(r"(\d{1,5})-(\d{1,5})", params.get("alt", ""))
        if m:
            a, b = int(m.group(1)), int(m.group(2))
            alt_min, alt_max = min(a, b, ALT_LIMIT), min(max(a, b), ALT_LIMIT)
        return cls(
            callsign_prefix=cs if _CALLSIGN_RE.match(cs) else "",
            types=types,
            airline=air if _AIRLINE_RE.match(air) else "",
            hide_ground=params.get("gnd") == "0",
            alt_min=alt_min,
            alt_max=alt_max,
        )

    @property
    def active(self) -> bool:
        return bool(
            self.callsign_prefix
            or self.types
            or self.airline
            or self.hide_ground
            or self.alt_min > 0
            or self.alt_max < ALT_LIMIT
        )

    def matches_type(self, type_code: str) -> bool:
        code = type_code.upper()
        return bool(code) and any(
            code.startswith(t[:-1]) if t.endswith("*") else code == t for t in self.types
        )

    @property
    def tile_key(self) -> str:
        """Part of the filter that changes which aircraft a thinned tile response holds."""
        return f"{self.callsign_prefix}|{self.airline}|{','.join(self.types)}"

    def matches(self, a: Aircraft) -> bool:
        if self.hide_ground and a.on_ground:
            return False
        if self.callsign_prefix and not a.callsign.upper().startswith(self.callsign_prefix):
            return False
        if self.airline and a.callsign.upper()[:3] != self.airline:
            return False
        if self.types and not self.matches_type(a.type_code):
            return False
        if self.alt_min > 0 or self.alt_max < ALT_LIMIT:
            alt = 0 if a.on_ground else a.altitude_ft
            if alt is not None and (alt < self.alt_min or (self.alt_max < ALT_LIMIT and alt > self.alt_max)):
                return False
        return True


def type_counts(index: AircraftIndex, limit: int = 40) -> list[dict[str, Any]]:
    """The most common aircraft types among the tracked aircraft, with their full names."""
    counts = Counter(a.type_code.upper() for a, _t in index.values() if a.type_code)
    return [
        {"code": code, "name": type_name(code) or code, "count": n} for code, n in counts.most_common(limit)
    ]


def hexes_matching(index: AircraftIndex, flt: AircraftFilter, limit: int = 8000) -> list[str]:
    """ICAO24 of every tracked aircraft whose type matches the filter (the map does not carry types)."""
    out = [a.hex_str for a, _t in index.values() if flt.matches_type(a.type_code)]
    return out[:limit]


def suggest_types(index: AircraftIndex, query: str, limit: int = 12) -> list[dict[str, Any]]:
    """Types matching a code prefix or a name fragment, with how many are tracked right now.

    Types that are in the air now come first; the rest of the reference list follows.
    """
    counts = Counter(a.type_code.upper() for a, _t in index.values() if a.type_code)
    ranked = sorted(search_types(query, limit=60), key=lambda it: -counts.get(it[0], 0))
    return [{"code": code, "name": name, "count": counts.get(code, 0)} for code, name in ranked[:limit]]
