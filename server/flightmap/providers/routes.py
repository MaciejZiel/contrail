"""Scheduled route lookup from the VRS standing data (CC0-1.0), as hosted by ADSB.lol."""

from __future__ import annotations

import math
import re
from dataclasses import dataclass, field
from typing import Any, cast

from ..upstream import UpstreamClient, UpstreamError

_CALLSIGN = re.compile(r"^[A-Z0-9]{3,8}$")


@dataclass(slots=True)
class Airport:
    name: str
    icao: str
    iata: str
    city: str
    country: str
    lat: float
    lon: float
    elevation_ft: float | None = None

    def as_dict(self) -> dict[str, Any]:
        return {
            "name": self.name, "icao": self.icao, "iata": self.iata, "city": self.city,
            "country": self.country, "lat": self.lat, "lon": self.lon, "elevation_ft": self.elevation_ft,
        }  # fmt: skip


@dataclass(slots=True)
class Route:
    callsign: str
    flight_number: str
    airline_code: str
    airports: list[Airport] = field(default_factory=lambda: list[Airport]())


def distance_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    p1, p2 = math.radians(lat1), math.radians(lat2)
    a = (
        math.sin((p2 - p1) / 2) ** 2
        + math.cos(p1) * math.cos(p2) * math.sin(math.radians(lon2 - lon1) / 2) ** 2
    )
    return 2 * 6371.0088 * math.asin(math.sqrt(a))


def parse_route(payload: Any, callsign: str) -> Route | None:
    if not isinstance(payload, dict):
        raise UpstreamError("unexpected route response shape")
    doc = cast(dict[str, Any], payload)
    raw_airports = doc.get("_airports")
    if not isinstance(raw_airports, list) or len(cast(list[Any], raw_airports)) < 2:
        return None
    airports: list[Airport] = []
    for raw in cast(list[Any], raw_airports):
        if not isinstance(raw, dict):
            return None
        item = cast(dict[str, Any], raw)
        lat, lon = item.get("lat"), item.get("lon")
        if not isinstance(lat, int | float) or not isinstance(lon, int | float):
            return None
        elev = item.get("alt_feet")
        airports.append(
            Airport(
                name=str(item.get("name") or ""),
                icao=str(item.get("icao") or ""),
                iata=str(item.get("iata") or ""),
                city=str(item.get("location") or ""),
                country=str(item.get("countryiso2") or ""),
                lat=float(lat),
                lon=float(lon),
                elevation_ft=float(elev) if isinstance(elev, int | float) else None,
            )
        )
    return Route(
        callsign=str(doc.get("callsign") or callsign),
        flight_number=str(doc.get("number") or ""),
        airline_code=str(doc.get("airline_code") or ""),
        airports=airports,
    )


def is_plausible(route: Route, lat: float, lon: float) -> bool:
    """True when the aircraft could be flying one leg of the route (no big detour)."""
    for a, b in zip(route.airports, route.airports[1:], strict=False):
        direct = distance_km(a.lat, a.lon, b.lat, b.lon)
        via = distance_km(a.lat, a.lon, lat, lon) + distance_km(lat, lon, b.lat, b.lon)
        if via <= direct * 1.25 + 150:
            return True
    return False


def progress(route: Route, lat: float, lon: float) -> float | None:
    """Fraction of the first-to-last airport distance already flown, clamped to 0..1."""
    first, last = route.airports[0], route.airports[-1]
    done = distance_km(first.lat, first.lon, lat, lon)
    left = distance_km(lat, lon, last.lat, last.lon)
    total = done + left
    return None if total <= 0 else max(0.0, min(1.0, done / total))


class RouteProvider:
    name = "vrs-standing-data"

    def __init__(self, client: UpstreamClient, base_url: str) -> None:
        self._client = client
        self._base = base_url.rstrip("/")

    async def lookup(self, callsign: str) -> Route | None:
        """Route for a callsign, None when the standing data has none, UpstreamError on failures."""
        cs = callsign.strip().upper()
        if not _CALLSIGN.match(cs):
            return None
        try:
            payload = await self._client.get_json(f"{self._base}/routes/{cs[:2]}/{cs}.json")
        except UpstreamError as exc:
            if exc.status == 404:
                return None
            raise
        return parse_route(payload, cs)
