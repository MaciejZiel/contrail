"""HTTP API (Starlette)."""

from __future__ import annotations

import hashlib
import logging
import os
import time
from collections import OrderedDict
from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager

from starlette.applications import Starlette
from starlette.datastructures import MutableHeaders
from starlette.middleware import Middleware
from starlette.middleware.gzip import GZipMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse, Response
from starlette.routing import BaseRoute, Mount, Route
from starlette.staticfiles import StaticFiles
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from . import __version__
from .codec import encode_header, encode_tiles
from .config import Settings
from .demo import DemoProvider
from .providers import TileProvider
from .providers.adsblol import AdsbLolProvider
from .tilecache import TileCache
from .tiles import Tile, tiles_in_rect
from .trafficmask import load_traffic_tiles
from .upstream import UpstreamClient

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


def _etag_matches(if_none_match: str, digest: str) -> bool:
    """Weak comparison (RFC 9110): W/"x" and "x" both match."""
    tags = (t.strip().removeprefix("W/") for t in if_none_match.split(","))
    return f'"{digest}"' in tags or if_none_match.strip() == "*"


class Api:
    def __init__(self, settings: Settings, cache: TileCache) -> None:
        self.settings = settings
        self.cache = cache
        self.traffic = load_traffic_tiles()
        self._snapshots: OrderedDict[str, tuple[int, bytes]] = OrderedDict()

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

    async def status(self, _request: Request) -> Response:
        data = self.cache.snapshot_status()
        data["version"] = __version__
        data["demo"] = self.settings.demo_mode
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
    cache = TileCache(
        provider=provider or build_provider(settings, client),
        budget_rps=settings.upstream_budget_rps,
        ttl_s=settings.tile_ttl_s,
        hot_window_s=settings.hot_window_s,
        evict_after_s=settings.evict_after_s,
    )
    api = Api(settings, cache)

    @asynccontextmanager
    async def lifespan(_app: Starlette) -> AsyncGenerator[None]:
        cache.start()
        try:
            yield
        finally:
            await cache.stop()
            if client:
                client.close()

    routes: list[BaseRoute] = [
        Route("/api/v1/aircraft", api.aircraft),
        Route("/api/v1/status", api.status),
        Route("/api/v1/health", api.health),
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
