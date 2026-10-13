"""Static reference data: airline and aircraft type names (VRS standing data, CC0-1.0)."""

from __future__ import annotations

import json
from functools import lru_cache
from importlib import resources


@lru_cache(maxsize=1)
def _load(name: str) -> dict[str, str]:
    raw = resources.files("flightmap").joinpath(f"data/{name}.json").read_text("utf-8")
    data = json.loads(raw)
    return {str(k): str(v) for k, v in data.items()}


def airline_for_callsign(callsign: str) -> tuple[str, str] | None:
    """(ICAO code, name) for callsigns of the form ABC123 (3 letter airline designator + number)."""
    cs = callsign.strip().upper()
    if len(cs) >= 4 and cs[:3].isalpha() and cs[3].isdigit():
        name = _load("airlines").get(cs[:3])
        if name:
            return cs[:3], name
    return None


def airline_name(code: str) -> str | None:
    return _load("airlines").get(code.upper())


def type_name(type_code: str) -> str | None:
    return _load("types").get(type_code.strip().upper())


def search_airlines(query: str, limit: int = 5) -> list[tuple[str, str]]:
    """Airlines whose name contains the query, or whose ICAO code starts with it."""
    q = query.strip().lower()
    if len(q) < 2:
        return []
    out: list[tuple[str, str]] = []
    for code, name in _load("airlines").items():
        low = name.lower()
        if code.lower() == q or low.startswith(q) or (len(q) >= 3 and q in low):
            out.append((code, name))
    out.sort(key=lambda it: (it[0].lower() != q, not it[1].lower().startswith(q), len(it[1])))
    return out[:limit]


def search_types(query: str, limit: int = 12) -> list[tuple[str, str]]:
    """Aircraft types whose ICAO code starts with the query or whose name contains it."""
    q = query.strip().lower()
    if len(q) < 2:
        return []
    out: list[tuple[str, str]] = []
    for code, name in _load("types").items():
        low = name.lower()
        if code.lower().startswith(q) or q in low:
            out.append((code, name))
    out.sort(key=lambda it: (not it[0].lower().startswith(q), not it[1].lower().startswith(q), it[0]))
    return out[:limit]
