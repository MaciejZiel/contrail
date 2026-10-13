"""HTTP API (Starlette)."""

from __future__ import annotations

import hashlib
import logging
import math
import os
import re
import time
from collections import OrderedDict
from collections.abc import AsyncGenerator, Awaitable, Callable
from contextlib import asynccontextmanager
from dataclasses import dataclass
from typing import Protocol

from starlette.applications import Starlette
from starlette.datastructures import MutableHeaders
from starlette.middleware import Middleware
from starlette.middleware.gzip import GZipMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse, Response
from starlette.routing import BaseRoute, Mount
from starlette.routing import Route as HttpRoute
from starlette.staticfiles import StaticFiles
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from . import __version__
from .airports import airport_details, load_catalog
from .codec import encode_aircraft, encode_header, encode_tiles
from .config import Settings
from .demo import DemoProvider, DemoWeather
from .enrich import EnrichmentCache
from .filtering import AircraftFilter, hexes_matching, suggest_types, type_counts
from .index import AircraftIndex
from .models import Aircraft
from .providers import TileProvider
from .providers.adsblol import AdsbLolProvider
from .providers.routes import Route, RouteProvider, is_plausible, progress
from .providers.weather import Metar, WeatherProvider
from .reference import airline_for_callsign, airline_name, type_name
from .regions import build_plan, parse_regions
from .search import aircraft_item, nearby_traffic, search_all
from .thinning import level_for_zoom, thin
from .tilecache import TileCache, TileEntry
from .tiles import Tile, tile_of, tiles_in_rect
from .trafficmask import load_traffic_tiles
from .trails import TrailStore
from .upstream import BudgetExhausted, TokenBucket, UpstreamClient, UpstreamError

log = logging.getLogger("flightmap")

WIDE_REQUEST_TILES = 12  # above this many tiles only traffic tiles are fetched
SNAPSHOT_CACHE_SIZE = 128
CACHE_CONTROL = "public, max-age=2, stale-while-revalidate=5"
# Lookups of aircraft outside every cached tile may use this share of the upstream budget.
TRAILS_MAX_LIMIT = 400  # aircraft per /trails response
TRAILS_CACHE_S = 12.0  # how long a /trails result is reused; the trail memory only moves every 10-15 s
TRAILS_CACHE_MAX = 64
TRAILS_GRID_DIVISIONS = 8  # the box snaps to a grid of about 1/8 of its size
TRAILS_MIN_STEP = 1 / 64
LOOKUP_RPS = 0.05  # single-aircraft ADSB.lol lookups, on their own thread and budget
WEATHER_RPS = 1.5  # NOAA allows 100 requests per minute
ROUTE_RPS = 2.0
LOOKUP_RETRY_AFTER_S = 20
MIN_EXACT_LOOKUP_CHARS = 4


_Block = tuple[int, int, int, int, int, bytes]
FINEST_LEVEL = 6


@dataclass(slots=True)
class _Snapshot:
    blocks: list[_Block]
    present: frozenset[int]
    encoded: tuple[int, bytes]


class LookupsExhausted(Exception):
    """Too many single-aircraft upstream lookups right now."""


SECURITY_HEADERS = {
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "X-Frame-Options": "SAMEORIGIN",
}
# Keep in sync with deploy/termux/nginx-headers.conf (a test compares them).
CONTENT_SECURITY_POLICY = (
    "default-src 'self'; script-src 'self'; worker-src 'self' blob:; style-src 'self' 'unsafe-inline'; "
    "img-src 'self' data: blob: https://t.plnspttrs.net; "
    "connect-src 'self' https://api.planespotters.net https://tiles.openfreemap.org; "
    "font-src 'self'; frame-ancestors 'none'; base-uri 'self'; object-src 'none'"
)
ICON_FILES = frozenset({"favicon.svg", "favicon.ico", "favicon-32.png", "apple-touch-icon.png"})
DATA_LICENSE = "ODbL-1.0; aircraft data from ADSB.lol (https://adsb.lol), see https://opendatacommons.org/licenses/odbl/1-0/"


class SecurityHeaders:
    """Baseline response headers, also for the static app when the server serves it itself:
    a CSP and cache rules for the pages (the HTML must never be cached stale, hashed assets may),
    and the ODbL notice on API output, which re-publishes ADSB.lol data."""

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        path = str(scope.get("path", ""))
        is_api = "/api/" in path

        async def send_with_headers(message: Message) -> None:
            if message["type"] == "http.response.start":
                headers = MutableHeaders(scope=message)
                for key, value in SECURITY_HEADERS.items():
                    headers.setdefault(key, value)
                if is_api:
                    headers.setdefault("X-Data-License", DATA_LICENSE)
                else:
                    headers.setdefault("Content-Security-Policy", CONTENT_SECURITY_POLICY)
                    if path.endswith(("/", ".html")) or "." not in path.rsplit("/", 1)[-1]:
                        headers["Cache-Control"] = "no-cache"
                    elif path.rsplit("/", 1)[-1] in ICON_FILES:
                        headers["Cache-Control"] = "public, max-age=86400"
                    elif "/assets/" in path or "/maplibre/" in path:
                        headers["Cache-Control"] = "public, max-age=31536000, immutable"
            await send(message)

        await self.app(scope, receive, send_with_headers)


def _clamp_float(raw: str | None, default: float, lo: float, hi: float) -> float:
    try:
        v = float(raw) if raw is not None else default
    except ValueError:
        return default
    return min(hi, max(lo, v)) if math.isfinite(v) else default


def snap_box(w: float, s: float, e: float, n: float) -> tuple[float, float, float, float]:
    """Grow a map box outwards onto a coarse power-of-two grid (a step of about 1/8 of its size).

    Viewers of nearly the same area then ask for, and share, the same result. A box 360 degrees or
    more wide becomes the whole world (-180 to 180); a box with ``e < w`` crosses the antimeridian.
    The web app uses the same arithmetic, so its URLs line up with the server's cache keys.
    """
    span = e - w if e >= w else (e - w) % 360
    if span >= 360:
        w, e = -180.0, 180.0
        span = 360.0
    else:
        w = ((w + 180) % 360) - 180
    step = max(TRAILS_MIN_STEP, 2.0 ** math.floor(math.log2(max(span, n - s, 1e-9) / TRAILS_GRID_DIVISIONS)))
    sn, nn = max(-90.0, math.floor(s / step) * step), min(90.0, math.ceil(n / step) * step)
    if span >= 360:
        return -180.0, sn, 180.0, nn
    w0, e0 = math.floor(w / step) * step, math.ceil((w + span) / step) * step
    if e0 - w0 >= 360:
        return -180.0, sn, 180.0, nn
    return ((w0 + 180) % 360) - 180, sn, ((e0 + 180) % 360) - 180, nn


def _int_param(request: Request, name: str) -> int:
    try:
        return int(request.query_params[name])
    except (KeyError, ValueError) as exc:
        raise ValueError(f"missing or invalid '{name}'") from exc


_HEX_RE = re.compile(r"^[0-9a-f]{6}$")
_CATEGORY_NAMES = {
    0: "unknown",
    1: "light",
    2: "jet",
    3: "heavy",
    4: "rotorcraft",
    5: "glider",
    6: "ground",
    7: "other",
}


def aircraft_json(a: Aircraft, fetched_at: float) -> dict[str, object]:
    airline = airline_for_callsign(a.callsign)
    return {
        "hex": a.hex_str,
        "callsign": a.callsign,
        "registration": a.registration,
        "type_code": a.type_code,
        "type_name": type_name(a.type_code) if a.type_code else None,
        "airline": {"code": airline[0], "name": airline[1]} if airline else None,
        "category": _CATEGORY_NAMES.get(int(a.category), "unknown"),
        "squawk": a.squawk,
        "on_ground": a.on_ground,
        "military": a.military,
        "emergency": a.emergency,
        "lat": a.lat,
        "lon": a.lon,
        "altitude_ft": a.altitude_ft,
        "speed_kt": a.ground_speed_kt,
        "track": a.track_deg,
        "vertical_rate_fpm": a.vertical_rate_fpm,
        "position_time": round(fetched_at - a.position_age_s, 1),
    }


class WeatherSource(Protocol):
    async def metar(self, icao: str) -> Metar | None: ...

    async def taf(self, icao: str) -> str | None: ...


def _etag_matches(if_none_match: str, digest: str) -> bool:
    """Weak comparison (RFC 9110): W/"x" and "x" both match."""
    tags = (t.strip().removeprefix("W/") for t in if_none_match.split(","))
    return f'"{digest}"' in tags or if_none_match.strip() == "*"


def _busy() -> Response:
    return JSONResponse(
        {"ok": False, "reason": "busy"},
        status_code=503,
        headers={"Retry-After": str(LOOKUP_RETRY_AFTER_S), "Cache-Control": "no-store"},
    )


class Api:
    def __init__(
        self,
        settings: Settings,
        cache: TileCache,
        index: AircraftIndex,
        trails: TrailStore,
        route_lookup: Callable[[str], Awaitable[Route | None]],
        weather: WeatherSource,
    ) -> None:
        self.settings = settings
        self.cache = cache
        self.index = index
        self.trails = trails
        self.traffic = load_traffic_tiles()
        self._snapshots: OrderedDict[str, _Snapshot] = OrderedDict()
        self._trail_results: OrderedDict[tuple[object, ...], tuple[float, bytes]] = OrderedDict()
        self._route_lookup = route_lookup
        self._weather = weather
        self.airports = load_catalog()
        self._metars = EnrichmentCache(ttl_s=600.0, neg_ttl_s=60.0)
        self._tafs = EnrichmentCache(ttl_s=1800.0, neg_ttl_s=120.0)
        self._searches = EnrichmentCache(ttl_s=30.0, neg_ttl_s=60.0)
        self._routes = EnrichmentCache(ttl_s=6 * 3600, neg_ttl_s=120.0)
        self._hexes = EnrichmentCache(ttl_s=20.0, neg_ttl_s=30.0)
        # Any client can name any ICAO24, so lookups get their own small allowance, separate from the
        # tile budget: random addresses must not be able to starve the tiles everybody watches.
        self._lookups = TokenBucket(LOOKUP_RPS, burst=3.0)

    def select_tiles(self, x0: int, y0: int, x1: int, y1: int) -> list[Tile]:
        tiles = tiles_in_rect(x0, y0, x1, y1)
        if len(tiles) > WIDE_REQUEST_TILES:
            tiles = [t for t in tiles if t in self.traffic or self.cache.has_traffic(t)]
        return tiles

    async def aircraft(self, request: Request) -> Response:
        try:
            x0, y0, x1, y1 = (_int_param(request, k) for k in ("x0", "y0", "x1", "y1"))
        except ValueError as exc:
            return JSONResponse({"error": str(exc)}, status_code=400)
        tiles = self.select_tiles(x0, y0, x1, y1)
        cx, cy = (x0 + ((x1 - x0) % 72) / 2) % 72, (y0 + y1) / 2
        tiles.sort(key=lambda t: min(abs(t[0] - cx), 72 - abs(t[0] - cx)) ** 2 + (t[1] - cy) ** 2)
        zoom_raw = request.query_params.get("z", "")
        level = level_for_zoom(int(zoom_raw)) if re.fullmatch(r"-?\d{1,3}", zoom_raw) else 0
        wide = len(tiles_in_rect(x0, y0, x1, y1)) > WIDE_REQUEST_TILES
        if wide and level == 0:
            level = FINEST_LEVEL  # a wide rectangle is never served unthinned
        parsed = AircraftFilter.from_params(request.query_params)
        # Only a thinned response needs the filter (thinning would otherwise keep aircraft the client
        # then hides); full-density responses are shared and filtered by the client.
        flt = (
            AircraftFilter(callsign_prefix=parsed.callsign_prefix, airline=parsed.airline, types=parsed.types)
            if level > 0
            else AircraftFilter()
        )
        keep_raw = request.query_params.get("keep", "").lower()
        keep = int(keep_raw, 16) if level > 0 and _HEX_RE.match(keep_raw) else None
        # A world view can cover more traffic tiles than one request may hold: keep the nearest ones.
        del tiles[self.settings.max_tiles_per_request :]
        focus = not wide
        await self.cache.request(tiles, focus=focus)
        entries = self.cache.entries(tiles)
        digest = hashlib.sha1(
            (
                f"L{level}:{flt.tile_key}:"
                + ",".join(f"{e.tile[0]}_{e.tile[1]}:{e.version}" for e in entries)
            ).encode()
        ).hexdigest()[:20]
        # Weak: the tile data is identical for equal tags, but every body carries the current server time.
        etag = f'W/"{digest}"'
        newest = max((e.fetched_at for e in entries), default=0.0)
        headers = {
            "ETag": etag,
            "Cache-Control": CACHE_CONTROL,
            "X-Data-Time": str(int(newest * 1000)),
            "X-Tiles": str(len(entries)),
            "X-Pending": str(len(tiles) - len(entries)),
        }
        if _etag_matches(request.headers.get("if-none-match", ""), digest):
            return Response(status_code=304, headers=headers)
        snap = self._snapshots.get(digest)
        if snap is None:
            blocks, present = self._blocks(entries, level, flt)
            snap = _Snapshot(blocks, present, encode_tiles(blocks))
            self._snapshots[digest] = snap
            while len(self._snapshots) > SNAPSHOT_CACHE_SIZE:
                self._snapshots.popitem(last=False)
        else:
            self._snapshots.move_to_end(digest)
        cached = snap.encoded
        if keep is not None and keep not in snap.present:
            cached = self._with_kept(snap, entries, keep) or cached
        body = encode_header(cached[0], int(time.time() * 1000)) + cached[1]
        return Response(body, media_type="application/octet-stream", headers=headers)

    def _with_kept(self, snap: _Snapshot, entries: list[TileEntry], keep: int) -> tuple[int, bytes] | None:
        """Add the selected aircraft to its tile block of a cached, thinned snapshot (O(one block))."""
        found = self.index.get(keep)
        if found is None:
            return None
        aircraft = found[0]
        tile = tile_of(aircraft.lat, aircraft.lon)
        for i, e in enumerate(entries):
            if e.tile == tile:
                tx, ty, fetched, count, source, payload = snap.blocks[i]
                blocks = list(snap.blocks)
                blocks[i] = (tx, ty, fetched, count + 1, source, payload + encode_aircraft([aircraft]))
                return encode_tiles(blocks)
        return None

    @staticmethod
    def _blocks(
        entries: list[TileEntry], level: int, flt: AircraftFilter
    ) -> tuple[list[_Block], frozenset[int]]:
        """Tile blocks for the response; at low zoom one representative aircraft per grid cell."""
        if level == 0:
            return (
                [
                    (
                        e.tile[0],
                        e.tile[1],
                        int(e.fetched_at * 1000),
                        len(e.payload) // 32,
                        e.source,
                        e.payload,
                    )
                    for e in entries
                ],
                frozenset(),
            )
        owned = [(i, a) for i, e in enumerate(entries) for a in e.aircraft if flt.matches(a)]
        kept: dict[int, list[Aircraft]] = {}
        for i, a in thin(owned, level):
            kept.setdefault(i, []).append(a)
        out: list[_Block] = []
        for i, e in enumerate(entries):
            subset = kept.get(i, [])
            out.append(
                (
                    e.tile[0],
                    e.tile[1],
                    int(e.fetched_at * 1000),
                    len(subset),
                    e.source,
                    encode_aircraft(subset),
                )
            )
        return out, frozenset(a.hex for sub in kept.values() for a in sub)

    # -- single aircraft ---------------------------------------------------------------

    async def _find(self, hex_str: str) -> tuple[Aircraft, float] | None:
        found = self.index.get(int(hex_str, 16))
        if found:
            return found
        if not self._hexes.has(hex_str) and not self._lookups.try_take():
            raise LookupsExhausted
        try:
            ac = await self._hexes.get(hex_str, lambda: self.cache.provider.fetch_hex(hex_str))
        except UpstreamError:
            return None
        return (ac, time.time()) if ac else None

    def _hex_or_error(self, request: Request) -> str | Response:
        hex_str = str(request.path_params["hex"]).lower()
        if not _HEX_RE.match(hex_str):
            return JSONResponse({"error": "invalid ICAO24"}, status_code=400)
        return hex_str

    async def aircraft_detail(self, request: Request) -> Response:
        hex_str = self._hex_or_error(request)
        if isinstance(hex_str, Response):
            return hex_str
        try:
            found = await self._find(hex_str)
        except LookupsExhausted:
            return _busy()
        if not found:
            return JSONResponse({"ok": False, "reason": "not_tracked"}, status_code=404)
        return JSONResponse(
            {"ok": True, "aircraft": aircraft_json(*found)}, headers={"Cache-Control": "public, max-age=5"}
        )

    async def route(self, request: Request) -> Response:
        hex_str = self._hex_or_error(request)
        if isinstance(hex_str, Response):
            return hex_str
        try:
            found = await self._find(hex_str)
        except LookupsExhausted:
            return _busy()
        if not found:
            return JSONResponse({"ok": False, "reason": "not_tracked"}, status_code=404)
        ac = found[0]
        headers = {"Cache-Control": "public, max-age=60"}
        if not ac.callsign:
            return JSONResponse({"ok": False, "reason": "no_callsign"}, headers=headers)
        try:
            route = await self._routes.get(ac.callsign, lambda: self._route_lookup(ac.callsign))
        except BudgetExhausted:
            return JSONResponse({"ok": False, "reason": "busy"}, headers={"Cache-Control": "no-store"})
        except UpstreamError:
            return JSONResponse({"ok": False, "reason": "unavailable"}, headers={"Cache-Control": "no-store"})
        if route is None:
            return JSONResponse({"ok": False, "reason": "unknown_route"}, headers=headers)
        airports = [a.as_dict() for a in route.airports]
        return JSONResponse(
            {
                "ok": True,
                "route": {
                    "origin": airports[0],
                    "destination": airports[-1],
                    "stops": airports[1:-1],
                    "flight_number": route.flight_number,
                    "plausible": is_plausible(route, ac.lat, ac.lon),
                    "progress": progress(route, ac.lat, ac.lon),
                },
            },
            headers=headers,
        )

    async def trail(self, request: Request) -> Response:
        hex_str = self._hex_or_error(request)
        if isinstance(hex_str, Response):
            return hex_str
        snap = self.trails.snapshot(int(hex_str, 16))
        body: dict[str, object] = {
            "ok": True,
            **(snap or {"t": [], "lat": [], "lon": [], "alt": [], "gs": [], "vr": []}),
        }
        return JSONResponse(body, headers={"Cache-Control": "public, max-age=5"})

    async def recent_trails(self, request: Request) -> Response:
        """Recent tracks of the aircraft in a box, newest first, for drawing a trail behind each one.

        The box is snapped outwards to a grid and the encoded result is reused for a few seconds, so
        a crowd looking at the same area costs one selection, not one each.
        """
        q = request.query_params
        try:
            w, s_, e, n = (float(q[k]) for k in ("w", "s", "e", "n"))
        except (KeyError, ValueError):
            return JSONResponse({"error": "w, s, e and n are required numbers"}, status_code=400)
        if not all(math.isfinite(v) for v in (w, s_, e, n)) or not (-90 <= s_ <= n <= 90):
            return JSONResponse({"error": "invalid box"}, status_code=400)
        window = _clamp_float(q.get("window"), 1800.0, 60.0, 3600.0)
        limit = int(_clamp_float(q.get("limit"), float(TRAILS_MAX_LIMIT), 1.0, float(TRAILS_MAX_LIMIT)))
        flt = AircraftFilter.from_params(q)
        w, s_, e, n = snap_box(w, s_, e, n)
        headers = {"Cache-Control": "public, max-age=5"}

        key = (w, s_, e, n, window, limit, flt)
        mono = time.monotonic()
        hit = self._trail_results.get(key)
        if hit is not None and hit[0] > mono:
            return Response(hit[1], media_type="application/json", headers=headers)

        cx = (w + (e - w if e >= w else e - w + 360) / 2 + 180) % 360 - 180
        cy = (s_ + n) / 2

        def accept(hex_: int, lat: float, lon: float) -> bool:
            if not (s_ <= lat <= n):
                return False
            if not (w <= lon <= e if w <= e else lon >= w or lon <= e):
                return False
            if not flt.active:
                return True
            found = self.index.get(hex_)
            return found is not None and flt.matches(found[0])

        def rank(lat: float, lon: float) -> float:
            dx = (lon - cx + 180) % 360 - 180
            return dx * dx + (lat - cy) ** 2

        total, shown = self.trails.recent(
            accept, rank, limit, window_s=window, max_age_s=self.settings.max_tile_age_s, now=time.time()
        )
        body = {
            "ok": True,
            "total": total,
            "window_s": window,
            "trails": [
                {
                    "h": f"{h:06x}",
                    "p": [[round(lo, 4), round(la, 4), None if al is None else round(al / 100)] for lo, la, al in pts],
                }
                for h, _t, pts in shown
            ],
        }  # fmt: skip
        payload = JSONResponse(body).body
        self._trail_results.pop(key, None)
        self._trail_results[key] = (mono + TRAILS_CACHE_S, bytes(payload))
        while len(self._trail_results) > TRAILS_CACHE_MAX:
            self._trail_results.popitem(last=False)
        return Response(payload, media_type="application/json", headers=headers)

    async def types(self, request: Request) -> Response:
        q = request.query_params.get("q", "").strip()[:30]
        found = suggest_types(self.index, q) if q else type_counts(self.index)
        return JSONResponse({"ok": True, "types": found}, headers={"Cache-Control": "public, max-age=10"})

    async def type_hexes(self, request: Request) -> Response:
        flt = AircraftFilter.from_params({"ty": request.query_params.get("ty", "")})
        if not flt.types:
            return JSONResponse({"error": "ty must list type codes such as A320 or A32*"}, status_code=400)
        return JSONResponse(
            {"ok": True, "types": list(flt.types), "hexes": hexes_matching(self.index, flt)},
            headers={"Cache-Control": "public, max-age=5"},
        )

    # -- search, airports, weather ------------------------------------------------------

    async def search(self, request: Request) -> Response:
        q = request.query_params.get("q", "").strip()[:40]
        if len(q) < 2:
            return JSONResponse({"aircraft": [], "airports": [], "airlines": []})
        result = search_all(self.index, self.airports, q)
        if not result["aircraft"] and len(q) >= MIN_EXACT_LOOKUP_CHARS:
            exact = await self._exact_lookup(q)
            if exact is not None:
                result["aircraft"] = [exact]
        return JSONResponse(result, headers={"Cache-Control": "public, max-age=3"})

    @staticmethod
    def _exact_kind(q: str) -> tuple[str, str] | None:
        """The one most specific kind a query can be: ICAO24, then registration, then callsign."""
        up = q.upper().replace(" ", "")
        if _HEX_RE.match(up.lower()):
            return "hex", up.lower()
        if re.fullmatch(r"[A-Z]{1,2}-[A-Z0-9]{2,5}|N[0-9]{1,5}[A-Z]{0,2}", up):
            return "reg", up
        if re.fullmatch(r"[A-Z0-9]{3,8}", up) and any(c.isdigit() for c in up):
            return "callsign", up
        return None

    async def _exact_lookup(self, q: str) -> dict[str, object] | None:
        """A complete callsign, registration or ICAO24 that is not in a loaded tile: at most one
        upstream call, from the lookup allowance (never the tile budget), and none when it is empty."""
        kind = self._exact_kind(q)
        if kind is None:
            return None
        key = f"{kind[0]}:{kind[1]}"
        if not self._searches.has(key) and not self._lookups.try_take():
            return None
        try:
            ac = await self._searches.get(key, lambda: self.cache.provider.fetch_exact(*kind))
        except UpstreamError:
            return None
        return aircraft_item(ac) if ac is not None else None

    async def airport_catalog(self, _request: Request) -> Response:
        return Response(
            self.airports.map_catalog(),
            media_type="application/json",
            headers={"Cache-Control": "public, max-age=86400"},
        )

    def _cached_route(self, callsign: str) -> tuple[str, str] | None:
        """Origin and destination of an already cached route; never starts a lookup."""
        route = self._routes.peek(callsign)
        if route is None:
            return None
        return route.airports[0].icao, route.airports[-1].icao

    async def airport(self, request: Request) -> Response:
        rec = self.airports.get(str(request.path_params["code"]))
        if rec is None:
            return JSONResponse({"ok": False, "reason": "unknown_airport"}, status_code=404)
        nearby, counts = nearby_traffic(self.index, rec, known_route=self._cached_route)
        return JSONResponse(
            {
                "ok": True,
                "airport": {**rec.as_dict(), **airport_details(rec)},
                "nearby": nearby,
                "counts": counts,
                "radius_nm": 10,
            },
            headers={"Cache-Control": "public, max-age=5"},
        )

    async def weather(self, request: Request) -> Response:
        rec = self.airports.get(str(request.path_params["code"]))
        if rec is None:
            return JSONResponse({"ok": False, "reason": "unknown_airport"}, status_code=404)
        if not (rec.scheduled and rec.kind in ("L", "M")):  # only airports that publish reports we can use
            return JSONResponse({"ok": False, "reason": "no_weather_service"}, status_code=404)
        station = rec.icao.upper()

        async def part(cache: EnrichmentCache, loader: Callable[[], Awaitable[object]]) -> dict[str, object]:
            try:
                value = await cache.get(station, loader)
            except BudgetExhausted:
                return {"ok": False, "reason": "busy"}
            except UpstreamError:
                return {"ok": False, "reason": "unavailable"}
            if value is None:
                return {"ok": False, "reason": "no_report"}
            return {"ok": True, "data": value.as_dict() if isinstance(value, Metar) else value}

        metar = await part(self._metars, lambda: self._weather.metar(station))
        taf = await part(self._tafs, lambda: self._weather.taf(station))
        return JSONResponse(
            {"ok": True, "metar": metar, "taf": taf}, headers={"Cache-Control": "public, max-age=60"}
        )

    async def airline_names(self, request: Request) -> Response:
        codes = [
            c
            for c in request.query_params.get("codes", "").upper().split(",")
            if re.fullmatch(r"[A-Z]{3}", c)
        ]
        names = {c: n for c in codes[:60] if (n := airline_name(c))}
        return JSONResponse(names, headers={"Cache-Control": "public, max-age=86400"})

    async def status(self, _request: Request) -> Response:
        data = self.cache.snapshot_status()
        data["version"] = __version__
        data["max_age_s"] = self.settings.max_tile_age_s
        data["demo"] = self.settings.demo_mode
        data["trails"] = len(self.trails)
        data["trails_evicted"] = self.trails.evicted
        data["trail_points"] = self.trails.points
        data["indexed_aircraft"] = len(self.index)
        return JSONResponse(data, headers={"Cache-Control": "no-store"})

    async def health(self, _request: Request) -> Response:
        return JSONResponse({"ok": True}, headers={"Cache-Control": "no-store"})


def build_provider(
    settings: Settings, tiles: UpstreamClient | None, lookups: UpstreamClient | None
) -> TileProvider:
    if settings.demo_mode or tiles is None:
        return DemoProvider()
    return AdsbLolProvider(tiles, settings.adsblol_url, lookup_client=lookups)


def create_app(settings: Settings | None = None, provider: TileProvider | None = None) -> Starlette:
    settings = settings or Settings.from_env()
    live = not (settings.demo_mode and provider is None)
    # Separate threads: tile fetching must never queue behind lookups, routes or weather.
    tile_client = UpstreamClient(settings.user_agent, workers=1) if live else None
    side_client = UpstreamClient(settings.user_agent, workers=2) if live else None
    tile_provider = provider or build_provider(settings, tile_client, side_client)
    traffic_tiles = load_traffic_tiles()
    plan = build_plan(parse_regions(settings.prefetch_regions), traffic_tiles)
    cache = TileCache(
        provider=tile_provider,
        budget_rps=settings.upstream_budget_rps,
        ttl_s=settings.tile_ttl_s,
        hot_window_s=settings.hot_window_s,
        evict_after_s=settings.evict_after_s,
        max_age_s=settings.max_tile_age_s,
        prefetch_plan=plan,
        prefetch_idle_s=settings.prefetch_idle_s,
        prefetch_always=settings.prefetch_always,
    )
    index = AircraftIndex()
    cache.listeners.append(index.update)
    cache.expire_listeners.append(lambda tile: index.update(tile, [], 0.0))
    db_path = None
    if settings.data_dir:
        os.makedirs(settings.data_dir, exist_ok=True)
        db_path = os.path.join(settings.data_dir, "flightmap.sqlite3")
    trails = TrailStore(settings.trail_retention_s, settings.trail_min_interval_s, db_path)
    cache.listeners.append(trails.on_tile_update)

    demo_routes = getattr(tile_provider, "lookup_route", None)
    side = side_client or UpstreamClient(settings.user_agent, workers=2)
    if demo_routes is not None:
        route_lookup: Callable[[str], Awaitable[Route | None]] = demo_routes
    else:
        route_lookup = RouteProvider(side, settings.routes_url, TokenBucket(ROUTE_RPS, burst=5.0)).lookup
    weather: WeatherSource = (
        DemoWeather()
        if settings.demo_mode and provider is None
        else WeatherProvider(side, settings.weather_url, TokenBucket(WEATHER_RPS, burst=5.0))
    )
    api = Api(settings, cache, index, trails, route_lookup, weather)

    @asynccontextmanager
    async def lifespan(_app: Starlette) -> AsyncGenerator[None]:
        await trails.start()
        cache.start()
        try:
            yield
        finally:
            await cache.stop()
            await trails.stop()
            for c in {tile_client, side_client}:
                if c:
                    c.close()

    routes: list[BaseRoute] = [
        HttpRoute("/api/v1/aircraft", api.aircraft),
        HttpRoute("/api/v1/aircraft/{hex}", api.aircraft_detail),
        HttpRoute("/api/v1/aircraft/{hex}/route", api.route),
        HttpRoute("/api/v1/aircraft/{hex}/trail", api.trail),
        HttpRoute("/api/v1/trails", api.recent_trails),
        HttpRoute("/api/v1/types", api.types),
        HttpRoute("/api/v1/type-hexes", api.type_hexes),
        HttpRoute("/api/v1/search", api.search),
        HttpRoute("/api/v1/airports/catalog", api.airport_catalog),
        HttpRoute("/api/v1/airports/{code}", api.airport),
        HttpRoute("/api/v1/airports/{code}/weather", api.weather),
        HttpRoute("/api/v1/airlines", api.airline_names),
        HttpRoute("/api/v1/status", api.status),
        HttpRoute("/api/v1/health", api.health),
    ]
    if settings.static_dir and os.path.isdir(settings.static_dir):
        routes.append(Mount("/", StaticFiles(directory=settings.static_dir, html=True)))
    middleware = [Middleware(SecurityHeaders)]
    if settings.gzip:
        middleware.append(Middleware(GZipMiddleware, minimum_size=500))
    inner = Starlette(routes=routes, middleware=middleware)
    if settings.base_path:
        outer = Starlette(routes=[Mount(settings.base_path, app=inner)], lifespan=lifespan)
    else:
        inner.router.lifespan_context = lifespan
        outer = inner
    outer.state.api = api
    outer.state.cache = cache
    return outer
