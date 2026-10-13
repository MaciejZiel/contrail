"""Airport catalog (OurAirports, Unlicense) with search."""

from __future__ import annotations

import json
import math
from dataclasses import dataclass
from functools import lru_cache
from importlib import resources
from typing import Any


@dataclass(frozen=True, slots=True)
class AirportRec:
    icao: str
    iata: str
    name: str
    lat: float
    lon: float
    elevation_ft: int | None
    kind: str  # L, M or S
    country: str
    city: str
    scheduled: bool

    def as_dict(self) -> dict[str, Any]:
        return {
            "icao": self.icao, "iata": self.iata, "name": self.name, "lat": self.lat, "lon": self.lon,
            "elevation_ft": self.elevation_ft, "kind": self.kind, "country": self.country, "city": self.city,
        }  # fmt: skip


class AirportCatalog:
    def __init__(self, rows: list[list[Any]]) -> None:
        self._all = [
            AirportRec(r[0], r[1], r[2], float(r[3]), float(r[4]), r[5], r[6], r[7], r[8], bool(r[9]))
            for r in rows
        ]
        self._by_icao = {a.icao.upper(): a for a in self._all}
        self._by_iata = {a.iata.upper(): a for a in self._all if a.iata}
        self._catalog_json: str | None = None

    def get(self, code: str) -> AirportRec | None:
        c = code.strip().upper()
        return self._by_icao.get(c) or self._by_iata.get(c)

    def __len__(self) -> int:
        return len(self._all)

    def map_catalog(self) -> str:
        """Compact JSON of airports shown on the map: [icao, iata, name, lat, lon, kind]."""
        if self._catalog_json is None:
            rows = [
                [a.icao, a.iata, a.name, a.lat, a.lon, a.kind]
                for a in self._all
                if a.kind in ("L", "M") and a.scheduled
            ]
            self._catalog_json = json.dumps(rows, separators=(",", ":"), ensure_ascii=False)
        return self._catalog_json

    def search(self, query: str, limit: int = 6) -> list[AirportRec]:
        q = query.strip().lower()
        if len(q) < 2:
            return []
        scored: list[tuple[int, AirportRec]] = []
        for a in self._all:
            icao, iata, name, city = a.icao.lower(), a.iata.lower(), a.name.lower(), a.city.lower()
            if q in (icao, iata):
                score = 0
            elif icao.startswith(q) or iata.startswith(q):
                score = 2
            elif city.startswith(q) or name.startswith(q):
                score = 3
            elif len(q) >= 3 and (q in name or q in city):
                score = 5
            else:
                continue
            score += {"L": 0, "M": 1, "S": 2}.get(a.kind, 3) + (0 if a.scheduled else 1)
            scored.append((score, a))
        scored.sort(key=lambda it: (it[0], it[1].name))
        return [a for _s, a in scored[:limit]]

    def within(self, lat: float, lon: float, radius_nm: float) -> list[AirportRec]:
        out: list[tuple[float, AirportRec]] = []
        for a in self._all:
            d = distance_nm(lat, lon, a.lat, a.lon)
            if d <= radius_nm:
                out.append((d, a))
        out.sort(key=lambda it: it[0])
        return [a for _d, a in out]


def distance_nm(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    p1, p2 = math.radians(lat1), math.radians(lat2)
    a = (
        math.sin((p2 - p1) / 2) ** 2
        + math.cos(p1) * math.cos(p2) * math.sin(math.radians(lon2 - lon1) / 2) ** 2
    )
    return 2 * 3440.065 * math.asin(min(1.0, math.sqrt(a)))


@lru_cache(maxsize=1)
def load_catalog() -> AirportCatalog:
    raw = resources.files("flightmap").joinpath("data/airports.json").read_text("utf-8")
    return AirportCatalog(json.loads(raw))


_KIND_LABEL = {"L": "Large airport", "M": "Medium airport", "S": "Small airport"}


@lru_cache(maxsize=1)
def _detail_offsets() -> dict[str, tuple[int, int]]:
    """Byte range of each airport's line in airport_details.tsv; the file itself is not kept in memory."""
    out: dict[str, tuple[int, int]] = {}
    pos = 0
    with resources.files("flightmap").joinpath("data/airport_details.tsv").open("rb") as fh:
        for line in fh:
            icao, _sep, _rest = line.partition(b"\t")
            out[icao.decode()] = (pos + len(icao) + 1, len(line) - len(icao) - 1)
            pos += len(line)
    return out


def _details_for(icao: str) -> dict[str, Any]:
    span = _detail_offsets().get(icao)
    if span is None:
        return {}
    with resources.files("flightmap").joinpath("data/airport_details.tsv").open("rb") as fh:
        fh.seek(span[0])
        return json.loads(fh.read(span[1]))


def airport_details(rec: AirportRec) -> dict[str, Any]:
    """OurAirports metadata for the airport card: type, region, runways, frequencies and links."""
    d = _details_for(rec.icao)
    return {
        "type": _KIND_LABEL.get(rec.kind, "Airport"),
        "scheduled_service": rec.scheduled,
        "region": d.get("reg", ""),
        "runways": [
            {"ends": [r[0], r[1]], "length_ft": r[2], "surface": r[3], "lighted": bool(r[4])}
            for r in d.get("r", [])
        ],
        "frequencies": [{"type": f[0], "mhz": f[1]} for f in d.get("f", [])],
        "wikipedia": d.get("w", ""),
        "website": d.get("h", ""),
    }
