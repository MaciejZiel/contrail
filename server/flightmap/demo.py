"""Synthetic air traffic shaped like ADSB.lol ``/v2/point`` responses.

Used by demo mode (no network needed) and by the fixture upstream server that end-to-end tests
run against. Flights follow great circles between real airports; positions are a pure
function of time, so no state is kept.
"""

from __future__ import annotations

import asyncio
import math
import random
import threading
import time
from typing import Any

from .codec import SOURCE_DEMO
from .models import Aircraft
from .providers.adsblol import parse_point_response
from .providers.routes import Route, parse_route
from .tiles import Tile, tile_of

# (ICAO, lat, lon): a spread of major airports on every inhabited continent.
AIRPORTS: list[tuple[str, float, float]] = [
    ("EGLL", 51.47, -0.46), ("LFPG", 49.01, 2.55), ("EHAM", 52.31, 4.76), ("EDDF", 50.03, 8.57),
    ("EDDM", 48.35, 11.79), ("LEMD", 40.49, -3.57), ("LEBL", 41.30, 2.08), ("LIRF", 41.80, 12.25),
    ("LIMC", 45.63, 8.72), ("LSZH", 47.46, 8.55), ("LOWW", 48.11, 16.57), ("EPWA", 52.17, 20.97),
    ("EPKK", 50.08, 19.78), ("EKCH", 55.62, 12.65), ("ESSA", 59.65, 17.92), ("ENGM", 60.19, 11.10),
    ("EFHK", 60.32, 24.96), ("EIDW", 53.42, -6.27), ("LPPT", 38.77, -9.13), ("LGAV", 37.94, 23.94),
    ("LTFM", 41.26, 28.74), ("UUEE", 55.97, 37.41), ("LKPR", 50.10, 14.26), ("LHBP", 47.44, 19.26),
    ("OMDB", 25.25, 55.36), ("OTHH", 25.27, 51.61), ("OERK", 24.96, 46.70), ("LLBG", 32.01, 34.89),
    ("HECA", 30.12, 31.41), ("FAOR", -26.14, 28.24), ("FACT", -33.97, 18.60), ("HKJK", -1.32, 36.93),
    ("DNMM", 6.58, 3.32), ("GMMN", 33.37, -7.59), ("VIDP", 28.56, 77.10), ("VABB", 19.09, 72.87),
    ("VOBL", 13.20, 77.71), ("VTBS", 13.69, 100.75), ("WSSS", 1.36, 103.99), ("WMKK", 2.75, 101.71),
    ("WIII", -6.13, 106.66), ("RPLL", 14.51, 121.02), ("VHHH", 22.31, 113.91), ("ZSPD", 31.14, 121.81),
    ("ZBAA", 40.08, 116.58), ("ZGGG", 23.39, 113.30), ("RKSI", 37.46, 126.44), ("RJTT", 35.55, 139.78),
    ("RJAA", 35.77, 140.39), ("RJBB", 34.43, 135.24), ("YSSY", -33.95, 151.18), ("YMML", -37.67, 144.84),
    ("NZAA", -37.01, 174.79), ("KJFK", 40.64, -73.78), ("KEWR", 40.69, -74.17), ("KBOS", 42.36, -71.01),
    ("KORD", 41.98, -87.91), ("KATL", 33.64, -84.43), ("KDFW", 32.90, -97.04), ("KDEN", 39.86, -104.67),
    ("KLAX", 33.94, -118.41), ("KSFO", 37.62, -122.38), ("KSEA", 47.45, -122.31), ("KMIA", 25.79, -80.29),
    ("CYYZ", 43.68, -79.63), ("CYVR", 49.19, -123.18), ("MMMX", 19.44, -99.07), ("SBGR", -23.43, -46.47),
    ("SCEL", -33.39, -70.79), ("SAEZ", -34.82, -58.54), ("SKBO", 4.70, -74.15), ("SPJC", -12.02, -77.11),
]  # fmt: skip

AIRPORT_NAMES: dict[str, tuple[str, str, str]] = {
    "EGLL": ("London Heathrow Airport", "London", "GB"), "LFPG": ("Paris Charles de Gaulle Airport", "Paris", "FR"),
    "EHAM": ("Amsterdam Schiphol Airport", "Amsterdam", "NL"), "EDDF": ("Frankfurt Airport", "Frankfurt", "DE"),
    "EDDM": ("Munich Airport", "Munich", "DE"), "LEMD": ("Madrid Barajas Airport", "Madrid", "ES"),
    "LEBL": ("Barcelona El Prat Airport", "Barcelona", "ES"), "LIRF": ("Rome Fiumicino Airport", "Rome", "IT"),
    "LIMC": ("Milan Malpensa Airport", "Milan", "IT"), "LSZH": ("Zurich Airport", "Zurich", "CH"),
    "LOWW": ("Vienna International Airport", "Vienna", "AT"), "EPWA": ("Warsaw Chopin Airport", "Warsaw", "PL"),
    "EPKK": ("Krakow John Paul II Airport", "Krakow", "PL"), "EKCH": ("Copenhagen Airport", "Copenhagen", "DK"),
    "ESSA": ("Stockholm Arlanda Airport", "Stockholm", "SE"), "ENGM": ("Oslo Gardermoen Airport", "Oslo", "NO"),
    "EFHK": ("Helsinki Vantaa Airport", "Helsinki", "FI"), "EIDW": ("Dublin Airport", "Dublin", "IE"),
    "LPPT": ("Lisbon Humberto Delgado Airport", "Lisbon", "PT"), "LGAV": ("Athens Eleftherios Venizelos Airport", "Athens", "GR"),
    "LTFM": ("Istanbul Airport", "Istanbul", "TR"), "UUEE": ("Moscow Sheremetyevo Airport", "Moscow", "RU"),
    "LKPR": ("Prague Vaclav Havel Airport", "Prague", "CZ"), "LHBP": ("Budapest Ferenc Liszt Airport", "Budapest", "HU"),
    "OMDB": ("Dubai International Airport", "Dubai", "AE"), "OTHH": ("Hamad International Airport", "Doha", "QA"),
    "OERK": ("King Khalid International Airport", "Riyadh", "SA"), "LLBG": ("Ben Gurion Airport", "Tel Aviv", "IL"),
    "HECA": ("Cairo International Airport", "Cairo", "EG"), "FAOR": ("O. R. Tambo International Airport", "Johannesburg", "ZA"),
    "FACT": ("Cape Town International Airport", "Cape Town", "ZA"), "HKJK": ("Jomo Kenyatta International Airport", "Nairobi", "KE"),
    "DNMM": ("Murtala Muhammed International Airport", "Lagos", "NG"), "GMMN": ("Mohammed V International Airport", "Casablanca", "MA"),
    "VIDP": ("Indira Gandhi International Airport", "Delhi", "IN"), "VABB": ("Chhatrapati Shivaji Maharaj International Airport", "Mumbai", "IN"),
    "VOBL": ("Kempegowda International Airport", "Bengaluru", "IN"), "VTBS": ("Suvarnabhumi Airport", "Bangkok", "TH"),
    "WSSS": ("Singapore Changi Airport", "Singapore", "SG"), "WMKK": ("Kuala Lumpur International Airport", "Kuala Lumpur", "MY"),
    "WIII": ("Soekarno-Hatta International Airport", "Jakarta", "ID"), "RPLL": ("Ninoy Aquino International Airport", "Manila", "PH"),
    "VHHH": ("Hong Kong International Airport", "Hong Kong", "HK"), "ZSPD": ("Shanghai Pudong International Airport", "Shanghai", "CN"),
    "ZBAA": ("Beijing Capital International Airport", "Beijing", "CN"), "ZGGG": ("Guangzhou Baiyun International Airport", "Guangzhou", "CN"),
    "RKSI": ("Incheon International Airport", "Seoul", "KR"), "RJTT": ("Tokyo Haneda Airport", "Tokyo", "JP"),
    "RJAA": ("Narita International Airport", "Tokyo", "JP"), "RJBB": ("Kansai International Airport", "Osaka", "JP"),
    "YSSY": ("Sydney Kingsford Smith Airport", "Sydney", "AU"), "YMML": ("Melbourne Airport", "Melbourne", "AU"),
    "NZAA": ("Auckland Airport", "Auckland", "NZ"), "KJFK": ("John F. Kennedy International Airport", "New York", "US"),
    "KEWR": ("Newark Liberty International Airport", "Newark", "US"), "KBOS": ("Boston Logan International Airport", "Boston", "US"),
    "KORD": ("Chicago O'Hare International Airport", "Chicago", "US"), "KATL": ("Hartsfield-Jackson Atlanta International Airport", "Atlanta", "US"),
    "KDFW": ("Dallas/Fort Worth International Airport", "Dallas", "US"), "KDEN": ("Denver International Airport", "Denver", "US"),
    "KLAX": ("Los Angeles International Airport", "Los Angeles", "US"), "KSFO": ("San Francisco International Airport", "San Francisco", "US"),
    "KSEA": ("Seattle-Tacoma International Airport", "Seattle", "US"), "KMIA": ("Miami International Airport", "Miami", "US"),
    "CYYZ": ("Toronto Pearson International Airport", "Toronto", "CA"), "CYVR": ("Vancouver International Airport", "Vancouver", "CA"),
    "MMMX": ("Mexico City International Airport", "Mexico City", "MX"), "SBGR": ("Sao Paulo Guarulhos International Airport", "Sao Paulo", "BR"),
    "SCEL": ("Santiago International Airport", "Santiago", "CL"), "SAEZ": ("Buenos Aires Ezeiza International Airport", "Buenos Aires", "AR"),
    "SKBO": ("El Dorado International Airport", "Bogota", "CO"), "SPJC": ("Jorge Chavez International Airport", "Lima", "PE"),
}  # fmt: skip

AIRLINES = ["DLH", "BAW", "AFR", "KLM", "RYR", "EZY", "LOT", "SAS", "UAE", "QTR", "SIA", "ANA",
            "JAL", "UAL", "DAL", "AAL", "ACA", "QFA", "THY", "WZZ", "IBE", "VLG", "SWR", "AUA"]  # fmt: skip
# (ICAO type, ADS-B category, cruise altitude ft, cruise ground speed kt)
TYPES = [("A320", "A3", 36000, 450), ("B738", "A3", 37000, 455), ("A21N", "A3", 38000, 460),
         ("E190", "A3", 35000, 420), ("A333", "A5", 38000, 480), ("B77W", "A5", 39000, 490),
         ("B788", "A5", 40000, 485), ("A359", "A5", 39000, 488), ("DH8D", "A3", 25000, 310)]  # fmt: skip

_EARTH_KM = 6371.0088


def _gc_point(lat1: float, lon1: float, lat2: float, lon2: float, f: float) -> tuple[float, float, float]:
    """Point at fraction ``f`` along the great circle and the bearing there (degrees)."""
    p1, l1, p2, l2 = map(math.radians, (lat1, lon1, lat2, lon2))
    d = 2 * math.asin(
        math.sqrt(math.sin((p2 - p1) / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin((l2 - l1) / 2) ** 2)
    )
    if d < 1e-9:
        return lat1, lon1, 0.0
    a = math.sin((1 - f) * d) / math.sin(d)
    b = math.sin(f * d) / math.sin(d)
    x = a * math.cos(p1) * math.cos(l1) + b * math.cos(p2) * math.cos(l2)
    y = a * math.cos(p1) * math.sin(l1) + b * math.cos(p2) * math.sin(l2)
    z = a * math.sin(p1) + b * math.sin(p2)
    lat = math.atan2(z, math.hypot(x, y))
    lon = math.atan2(y, x)
    # bearing from this point to the destination
    dl = l2 - lon
    by = math.sin(dl) * math.cos(p2)
    bx = math.cos(lat) * math.sin(p2) - math.sin(lat) * math.cos(p2) * math.cos(dl)
    return math.degrees(lat), math.degrees(lon), (math.degrees(math.atan2(by, bx)) + 360) % 360


def _distance_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    p1, p2 = math.radians(lat1), math.radians(lat2)
    a = (
        math.sin((p2 - p1) / 2) ** 2
        + math.cos(p1) * math.cos(p2) * math.sin(math.radians(lon2 - lon1) / 2) ** 2
    )
    return 2 * _EARTH_KM * math.asin(math.sqrt(a))


class _Flight:
    __slots__ = (
        "callsign",
        "cat",
        "cruise_alt",
        "cycle",
        "d",
        "duration",
        "gs",
        "hex",
        "military",
        "o",
        "offset",
        "reg",
        "type",
    )  # fmt: skip

    def __init__(self, idx: int, rng: random.Random) -> None:
        self.hex = (0x400000 + idx * 2654435761) & 0xFFFFFF
        origin = rng.choice(AIRPORTS)
        while True:
            dest = rng.choice(AIRPORTS)
            km = _distance_km(origin[1], origin[2], dest[1], dest[2])
            if 350 < km < 11000:
                break
        self.o, self.d = origin, dest
        t = rng.choice(TYPES)
        self.type, self.cat, self.cruise_alt, self.gs = t[0], t[1], t[2] + rng.choice((-2000, 0, 1000)), t[3]
        self.callsign = f"{rng.choice(AIRLINES)}{rng.randint(1, 9999)}"
        self.reg = (
            rng.choice("DGFSOEHPLN")
            + "-"
            + "".join(rng.choice("ABCDEFGHIJKLMNOPQRSTUVWXYZ") for _ in range(4))
        )
        self.duration = km / (self.gs * 1.852) * 3600 + 900  # seconds airborne incl. climb/descent
        self.cycle = self.duration + rng.randint(1200, 3600)  # plus turnaround on the ground
        self.offset = rng.uniform(0, self.cycle)
        self.military = idx % 97 == 0

    def state(self, now: float) -> dict[str, Any] | None:
        e = (now + self.offset) % self.cycle
        if e >= self.duration:
            # on the ground at the origin during the turnaround
            lat, lon = self.o[1], self.o[2]
            return {
                "hex": f"{self.hex:06x}", "type": "adsb_icao", "flight": self.callsign.ljust(8),
                "r": self.reg, "t": self.type, "alt_baro": "ground", "gs": 0.0, "track": 0.0,
                "category": self.cat, "lat": lat, "lon": lon, "seen_pos": 0.2,
            }  # fmt: skip
        f = e / self.duration
        lat, lon, trk = _gc_point(self.o[1], self.o[2], self.d[1], self.d[2], f)
        climb, descend = 0.12, 0.88
        if f < climb:
            alt = self.cruise_alt * (f / climb)
            vrate = self.cruise_alt / (climb * self.duration / 60)
        elif f > descend:
            alt = self.cruise_alt * ((1 - f) / (1 - descend))
            vrate = -self.cruise_alt / ((1 - descend) * self.duration / 60)
        else:
            alt, vrate = self.cruise_alt, 0.0
        gs = self.gs * (0.55 + 0.45 * min(1.0, alt / 12000))
        rec: dict[str, Any] = {
            "hex": f"{self.hex:06x}", "type": "adsb_icao", "flight": self.callsign.ljust(8),
            "r": self.reg, "t": self.type, "alt_baro": int(alt), "gs": round(gs, 1),
            "track": round(trk, 2), "baro_rate": int(vrate), "squawk": "1000",
            "category": self.cat, "lat": round(lat, 6), "lon": round(lon, 6), "seen_pos": 0.4,
        }  # fmt: skip
        if self.military:
            rec["dbFlags"] = 1
        return rec


class DemoTraffic:
    def __init__(self, flights: int = 5000, seed: int = 7) -> None:
        rng = random.Random(seed)
        self._flights = [_Flight(i + 1, rng) for i in range(flights)]
        self._lock = threading.Lock()
        self._second = -1
        self._cached: list[dict[str, Any]] = []
        self._by_tile: dict[Tile, list[dict[str, Any]]] = {}

    def records(self, now: float | None = None) -> list[dict[str, Any]]:
        """All flights at ``now``; recomputed at most once per second."""
        t = time.time() if now is None else now
        with self._lock:
            if int(t) != self._second:
                recs = [r for fl in self._flights if (r := fl.state(int(t))) is not None]
                by_tile: dict[Tile, list[dict[str, Any]]] = {}
                for r in recs:
                    by_tile.setdefault(tile_of(r["lat"], r["lon"]), []).append(r)
                self._cached, self._by_tile, self._second = recs, by_tile, int(t)
            return self._cached

    def route_payload(self, callsign: str) -> dict[str, Any] | None:
        """Route in the shape of the VRS standing data JSON, for the flight with this callsign."""
        fl = next((f for f in self._flights if f.callsign == callsign.upper()), None)
        if fl is None:
            return None
        airports: list[dict[str, Any]] = []
        for icao, lat, lon in (fl.o, fl.d):
            name, city, country = AIRPORT_NAMES.get(icao, (icao, "", ""))
            airports.append({"name": name, "icao": icao, "iata": "", "location": city, "countryiso2": country,
                             "lat": lat, "lon": lon, "alt_feet": 100.0, "alt_meters": 30.48})  # fmt: skip
        return {"callsign": fl.callsign, "number": fl.callsign[3:], "airline_code": fl.callsign[:3],
                "airport_codes": f"{fl.o[0]}-{fl.d[0]}", "_airport_codes_iata": "", "_airports": airports}  # fmt: skip

    def by_hex(self, hex_str: str) -> dict[str, Any] | None:
        return next((r for r in self.records() if r["hex"] == hex_str.lower()), None)

    def in_tile(self, tile: Tile) -> list[dict[str, Any]]:
        self.records()
        return self._by_tile.get(tile, [])

    def point(self, lat: float, lon: float, radius_nm: float, now: float | None = None) -> dict[str, Any]:
        """ADSB.lol ``/v2/point`` shaped response."""
        out: list[dict[str, Any]] = []
        for rec in self.records(now):
            if _distance_km(lat, lon, rec["lat"], rec["lon"]) / 1.852 <= radius_nm:
                out.append(rec)
        t = time.time() if now is None else now
        return {
            "ac": out,
            "msg": "No error",
            "now": int(t * 1000),
            "total": len(out),
            "ctime": int(t * 1000),
            "ptime": 0,
        }


class DemoProvider:
    """Tile provider backed by :class:`DemoTraffic`, parsed through the real ADSB.lol parser."""

    name = "demo"
    source_id = SOURCE_DEMO

    def __init__(self, traffic: DemoTraffic | None = None) -> None:
        self._traffic = traffic or DemoTraffic()

    async def fetch_tile(self, tile: Tile) -> list[Aircraft]:
        recs = await asyncio.to_thread(self._traffic.in_tile, tile)
        return parse_point_response({"ac": recs})

    async def fetch_hex(self, hex_str: str) -> Aircraft | None:
        rec = await asyncio.to_thread(self._traffic.by_hex, hex_str)
        found = parse_point_response({"ac": [rec]}) if rec else []
        return found[0] if found else None

    async def lookup_route(self, callsign: str) -> Route | None:
        payload = self._traffic.route_payload(callsign)
        return parse_route(payload, callsign) if payload else None
