"""HTTP API (Starlette)."""

from __future__ import annotations

import hashlib
import logging
import os
import re
import time
from collections import OrderedDict
from collections.abc import AsyncGenerator, Awaitable, Callable
from contextlib import asynccontextmanager

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
from .codec import encode_header, encode_tiles
from .config import Settings
from .demo import DemoProvider
from .enrich import EnrichmentCache
from .index import AircraftIndex
from .models import Aircraft
from .providers import TileProvider
from .providers.adsblol import AdsbLolProvider
from .providers.routes import Route, RouteProvider, is_plausible, progress
from .reference import airline_for_callsign, type_name
from .tilecache import TileCache
from .tiles import Tile, tiles_in_rect
from .trafficmask import load_traffic_tiles
from .trails import TrailStore
from .upstream import UpstreamClient, UpstreamError

log = logging.getLogger("flightmap")

WIDE_REQUEST_TILES = 12  # above this many tiles only traffic tiles are fetched
SNAPSHOT_CACHE_SIZE = 128
CACHE_CONTROL = "public, max-age=2, stale-while-revalidate=5"


SECURITY_HEADERS = {
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "X-Frame-Options": "SAMEORIGIN",
}


class SecurityHeaders:
    """Baseline response headers, also for the static app when the server serves it itself."""

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        async def send_with_headers(message: Message) -> None:
            if message["type"] == "http.response.start":
                headers = MutableHeaders(scope=message)
                for key, value in SECURITY_HEADERS.items():
                    headers.setdefault(key, value)
            await send(message)

        await self.app(scope, receive, send_with_headers)


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


def _etag_matches(if_none_match: str, digest: str) -> bool:
    """Weak comparison (RFC 9110): W/"x" and "x" both match."""
    tags = (t.strip().removeprefix("W/") for t in if_none_match.split(","))
    return f'"{digest}"' in tags or if_none_match.strip() == "*"


class Api:
    def __init__(
        self,
        settings: Settings,
        cache: TileCache,
        index: AircraftIndex,
        trails: TrailStore,
        route_lookup: Callable[[str], Awaitable[Route | None]],
    ) -> None:
        self.settings = settings
        self.cache = cache
        self.index = index
        self.trails = trails
        self.traffic = load_traffic_tiles()
        self._snapshots: OrderedDict[str, tuple[int, bytes]] = OrderedDict()
        self._route_lookup = route_lookup
        self._routes = EnrichmentCache(ttl_s=6 * 3600, neg_ttl_s=120.0)
        self._hexes = EnrichmentCache(ttl_s=20.0, neg_ttl_s=30.0)

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
        # A world view can cover more traffic tiles than one request may hold: keep the nearest ones.
        del tiles[self.settings.max_tiles_per_request :]
        focus = len(tiles_in_rect(x0, y0, x1, y1)) <= WIDE_REQUEST_TILES
        await self.cache.request(tiles, focus=focus)
        entries = self.cache.entries(tiles)
        digest = hashlib.sha1(
            ",".join(f"{e.tile[0]}_{e.tile[1]}:{e.version}" for e in entries).encode()
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
        cached = self._snapshots.get(digest)
        if cached is None:
            cached = encode_tiles(
                (e.tile[0], e.tile[1], int(e.fetched_at * 1000), len(e.payload) // 32, e.source, e.payload)
                for e in entries
            )
            self._snapshots[digest] = cached
            while len(self._snapshots) > SNAPSHOT_CACHE_SIZE:
                self._snapshots.popitem(last=False)
        else:
            self._snapshots.move_to_end(digest)
        body = encode_header(cached[0], int(time.time() * 1000)) + cached[1]
        return Response(body, media_type="application/octet-stream", headers=headers)

    # -- single aircraft ---------------------------------------------------------------

    async def _find(self, hex_str: str) -> tuple[Aircraft, float] | None:
        found = self.index.get(int(hex_str, 16))
        if found:
            return found
        try:
            ac = await self._hexes.get(
                hex_str, lambda: self.cache.with_budget(lambda: self.cache.provider.fetch_hex(hex_str))
            )
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
        found = await self._find(hex_str)
        if not found:
            return JSONResponse({"ok": False, "reason": "not_tracked"}, status_code=404)
        return JSONResponse(
            {"ok": True, "aircraft": aircraft_json(*found)}, headers={"Cache-Control": "public, max-age=5"}
        )

    async def route(self, request: Request) -> Response:
        hex_str = self._hex_or_error(request)
        if isinstance(hex_str, Response):
            return hex_str
        found = await self._find(hex_str)
        if not found:
            return JSONResponse({"ok": False, "reason": "not_tracked"}, status_code=404)
        ac = found[0]
        headers = {"Cache-Control": "public, max-age=60"}
        if not ac.callsign:
            return JSONResponse({"ok": False, "reason": "no_callsign"}, headers=headers)
        try:
            route = await self._routes.get(ac.callsign, lambda: self._route_lookup(ac.callsign))
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

    async def status(self, _request: Request) -> Response:
        data = self.cache.snapshot_status()
        data["version"] = __version__
        data["demo"] = self.settings.demo_mode
        data["trails"] = len(self.trails)
        data["trail_points"] = self.trails.points
        data["indexed_aircraft"] = len(self.index)
        return JSONResponse(data, headers={"Cache-Control": "no-store"})

    async def health(self, _request: Request) -> Response:
        return JSONResponse({"ok": True}, headers={"Cache-Control": "no-store"})


def build_provider(settings: Settings, client: UpstreamClient | None) -> TileProvider:
    if settings.demo_mode or client is None:
        return DemoProvider()
    return AdsbLolProvider(client, settings.adsblol_url)


def create_app(settings: Settings | None = None, provider: TileProvider | None = None) -> Starlette:
    settings = settings or Settings.from_env()
    client = None if settings.demo_mode and provider is None else UpstreamClient(settings.user_agent)
    tile_provider = provider or build_provider(settings, client)
    cache = TileCache(
        provider=tile_provider,
        budget_rps=settings.upstream_budget_rps,
        ttl_s=settings.tile_ttl_s,
        hot_window_s=settings.hot_window_s,
        evict_after_s=settings.evict_after_s,
    )
    index = AircraftIndex()
    cache.listeners.append(index.update)
    db_path = None
    if settings.data_dir:
        os.makedirs(settings.data_dir, exist_ok=True)
        db_path = os.path.join(settings.data_dir, "flightmap.sqlite3")
    trails = TrailStore(settings.trail_retention_s, settings.trail_min_interval_s, db_path)
    cache.listeners.append(trails.on_tile_update)

    demo_routes = getattr(tile_provider, "lookup_route", None)
    if demo_routes is not None:
        route_lookup: Callable[[str], Awaitable[Route | None]] = demo_routes
    else:
        route_client = client or UpstreamClient(settings.user_agent)
        route_lookup = RouteProvider(route_client, settings.routes_url).lookup
    api = Api(settings, cache, index, trails, route_lookup)

    @asynccontextmanager
    async def lifespan(_app: Starlette) -> AsyncGenerator[None]:
        await trails.start()
        cache.start()
        try:
            yield
        finally:
            await cache.stop()
            await trails.stop()
            if client:
                client.close()

    routes: list[BaseRoute] = [
        HttpRoute("/api/v1/aircraft", api.aircraft),
        HttpRoute("/api/v1/aircraft/{hex}", api.aircraft_detail),
        HttpRoute("/api/v1/aircraft/{hex}/route", api.route),
        HttpRoute("/api/v1/aircraft/{hex}/trail", api.trail),
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
