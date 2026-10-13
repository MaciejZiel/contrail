"""Regression tests for the second review round (C-1, I-1 to I-4, I-6, I-9, M-1 to M-3)."""

import asyncio
import json
import pathlib
import tempfile
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any

from flightmap import codec, upstream
from flightmap.app import CONTENT_SECURITY_POLICY, create_app
from flightmap.config import Settings
from flightmap.demo import DemoProvider, DemoTraffic
from flightmap.enrich import EnrichmentCache
from flightmap.models import Aircraft
from flightmap.providers.weather import WeatherProvider
from flightmap.tilecache import TileCache
from flightmap.tiles import Tile
from flightmap.trails import TrailStore
from flightmap.upstream import BudgetExhausted, TokenBucket, UpstreamClient, UpstreamError

from .asgi import asgi_get

RECT = "x0=39&y0=27&x1=41&y1=29"


class SlowProvider:
    name = "slow"
    source_id = 9

    def __init__(self, delay: float = 0.0) -> None:
        self.delay = delay
        self.gate: asyncio.Event | None = None  # when set, tile fetches wait until the test opens it
        self.calls: list[Tile] = []
        self.exact: list[tuple[str, str]] = []

    async def fetch_tile(self, tile: Tile) -> list[Aircraft]:
        self.calls.append(tile)
        if self.gate is not None:
            await self.gate.wait()
        return [Aircraft(hex=1, lat=1.0, lon=1.0)]

    async def fetch_hex(self, hex_str: str) -> Aircraft | None:
        return None

    async def fetch_exact(self, kind: str, value: str) -> Aircraft | None:
        self.exact.append((kind, value))
        return None


class C1SharedFetchesTest(unittest.IsolatedAsyncioTestCase):
    async def test_a_viewer_that_stops_waiting_does_not_cancel_the_shared_fetch(self) -> None:
        p = SlowProvider()
        p.gate = asyncio.Event()  # the provider answers only when the test says so: no timing involved
        cache = TileCache(provider=p, budget_rps=50.0, ttl_s=30.0)
        await cache.request([(3, 3)], cold_deadline_s=0.05)  # gives up while the provider is still busy
        self.assertEqual(cache.entries([(3, 3)]), [])
        p.gate.set()
        await cache.settle()
        self.assertEqual(len(cache.entries([(3, 3)])), 1)  # the fetch finished anyway
        self.assertEqual(p.calls.count((3, 3)), 1)  # and was not repeated
        self.assertEqual(cache.status.requests, 1)


def make_app(provider: Any = None, **kw: Any) -> Any:
    tmp = tempfile.mkdtemp()
    settings = Settings(
        demo_mode=True, data_dir="", prefetch_regions="off", gzip=False, upstream_budget_rps=100.0, **kw
    )
    del tmp
    return create_app(settings, provider=provider)


class SearchBudgetTest(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self) -> None:
        self.p = SlowProvider(delay=0.0)
        self.app = create_app(
            Settings(
                demo_mode=False, data_dir="", prefetch_regions="off", gzip=False, upstream_budget_rps=100.0
            ),
            provider=self.p,
        )

    async def asyncTearDown(self) -> None:
        await self.app.state.cache.stop()

    async def test_one_search_makes_at_most_one_upstream_call(self) -> None:
        await asgi_get(self.app, "/api/v1/search?q=abc123")  # both a valid ICAO24 and a callsign shape
        self.assertEqual(self.p.exact, [("hex", "abc123")])

    async def test_short_queries_never_reach_upstream(self) -> None:
        for q in ("LOT", "LO1", "ab"):
            await asgi_get(self.app, f"/api/v1/search?q={q}")
        self.assertEqual(self.p.exact, [])

    async def test_the_lookup_allowance_runs_out_and_the_tile_budget_is_untouched(self) -> None:
        before = self.app.state.cache.status.requests
        for i in range(30):
            r = await asgi_get(self.app, f"/api/v1/search?q=ZZZ{i:03d}")
            self.assertEqual(r.status, 200)
        self.assertLessEqual(len(self.p.exact), 4)  # burst of 3 plus at most one refill, not 30
        self.assertEqual(self.app.state.cache.status.requests, before)  # tiles never paid for it


class FakeClient(UpstreamClient):
    def __init__(self) -> None:
        super().__init__("test/1.0", workers=1)
        self.urls: list[str] = []
        self.fail_first = False
        self.failed = False

    async def get_json(self, url: str, headers: dict[str, str] | None = None) -> Any:
        self.urls.append(url)
        if self.fail_first and not self.failed:
            self.failed = True
            raise UpstreamError("timeout")  # a network error: retried once
        return [{"icaoId": "EPWA", "obsTime": 1, "rawOb": "METAR EPWA", "rawTAF": "TAF EPWA"}]


class WeatherAndRouteBudgetTest(unittest.IsolatedAsyncioTestCase):
    async def test_every_weather_attempt_takes_a_token_and_the_limit_holds(self) -> None:
        client = FakeClient()
        client.fail_first = True
        w = WeatherProvider(client, "http://x", TokenBucket(0.01, burst=3.0))
        got = await w.metar("EPWA")  # attempt 1 fails, attempt 2 succeeds: two tokens
        self.assertIsNotNone(got)
        self.assertEqual(len(client.urls), 2)
        await w.taf("EPWA")  # the third and last token
        with self.assertRaises(BudgetExhausted):
            await w.metar("EPKK")
        self.assertEqual(len(client.urls), 3)  # nothing was sent once the bucket was empty
        client.close()

    async def test_http_errors_are_not_retried(self) -> None:
        class Always503(FakeClient):
            async def get_json(self, url: str, headers: dict[str, str] | None = None) -> Any:
                self.urls.append(url)
                raise UpstreamError("HTTP 503", 503)

        client = Always503()
        w = WeatherProvider(client, "http://x", TokenBucket(5.0, burst=5.0))
        with self.assertRaises(UpstreamError):
            await w.metar("EPWA")
        self.assertEqual(len(client.urls), 1)
        client.close()

    async def test_weather_endpoint_reports_busy_and_limits_to_airports_with_reports(self) -> None:
        class Dry:
            async def metar(self, icao: str) -> None:
                raise BudgetExhausted("weather")

            async def taf(self, icao: str) -> None:
                raise BudgetExhausted("weather")

        app = make_app()
        app.state.api._weather = Dry()
        r = json.loads((await asgi_get(app, "/api/v1/airports/EPWA/weather")).body)
        self.assertEqual(r["metar"], {"ok": False, "reason": "busy"})
        small = await asgi_get(
            app, "/api/v1/airports/EP14/weather"
        )  # not a scheduled large or medium airport
        self.assertEqual(small.status, 404)

    async def test_running_out_of_budget_is_not_a_source_failure(self) -> None:
        c = EnrichmentCache(ttl_s=60, breaker_threshold=2, breaker_pause_s=60)

        async def dry() -> None:
            raise BudgetExhausted("x")

        for k in "abcd":
            with self.assertRaises(BudgetExhausted):
                await c.get(k, dry)
        self.assertFalse(c.open)  # four refusals did not trip the breaker
        # and nothing was negative-cached, so the next attempt may succeed

        async def ok() -> int:
            return 7

        self.assertEqual(await c.get("a", ok), 7)


class KeepAndZoomTest(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self) -> None:
        self.app = create_app(
            Settings(
                demo_mode=True, data_dir="", prefetch_regions="off", gzip=False, upstream_budget_rps=100.0
            )
        )
        self.app.state.cache.start()
        for _ in range(40):
            r = await asgi_get(self.app, f"/api/v1/aircraft?{RECT}&z=9")
            if r.headers["x-pending"] == "0":
                break
            await asyncio.sleep(0.1)

    async def asyncTearDown(self) -> None:
        await self.app.state.cache.stop()

    async def test_random_keep_values_do_not_multiply_cached_snapshots(self) -> None:
        api = self.app.state.api
        for i in range(50):
            await asgi_get(self.app, f"/api/v1/aircraft?{RECT}&z=4&keep={i:06x}")
            await asgi_get(self.app, f"/api/v1/aircraft?{RECT}&z=9&keep={i:06x}")
        self.assertLessEqual(len(api._snapshots), 2)

    async def test_keep_still_protects_a_real_aircraft_from_thinning(self) -> None:
        _n, tiles = codec.decode_response((await asgi_get(self.app, f"/api/v1/aircraft?{RECT}&z=4")).body)
        shown = {a.hex for t in tiles for a in t.aircraft}
        index = self.app.state.api.index
        hidden = next(a for a, _t in index.values() if a.hex not in shown and 20 < a.lat < 70)
        r = await asgi_get(self.app, f"/api/v1/aircraft?{RECT}&z=4&keep={hidden.hex_str}")
        _n, kept = codec.decode_response(r.body)
        self.assertIn(hidden.hex, {a.hex for t in kept for a in t.aircraft})
        self.assertEqual(sum(len(t.aircraft) for t in kept), sum(len(t.aircraft) for t in tiles) + 1)

    async def test_a_wide_request_without_zoom_is_thinned(self) -> None:
        api = self.app.state.api
        levels: list[int] = []
        original = api._blocks

        def spy(entries: Any, level: int) -> Any:
            levels.append(level)
            return original(entries, level)

        api._blocks = spy
        await asgi_get(self.app, "/api/v1/aircraft?x0=0&y0=0&x1=71&y1=35")  # no z at all
        await asgi_get(self.app, "/api/v1/aircraft?x0=0&y0=0&x1=71&y1=35&z=12")  # claims full detail
        self.assertTrue(levels)
        self.assertTrue(all(lv > 0 for lv in levels))

    async def test_odd_digits_in_z_are_a_normal_request_not_a_500(self) -> None:
        r = await asgi_get(self.app, f"/api/v1/aircraft?{RECT}&z=%C2%B2")  # "²" is a digit to str.isdigit()
        self.assertEqual(r.status, 200)
        self.assertEqual((await asgi_get(self.app, f"/api/v1/aircraft?{RECT}&z=99999999999")).status, 200)


class BodyCapTest(unittest.IsolatedAsyncioTestCase):
    async def test_oversized_upstream_bodies_are_refused(self) -> None:
        class H(BaseHTTPRequestHandler):
            def do_GET(self) -> None:
                body = b"[" + b"1," * 600 + b"1]"
                self.send_response(200)
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)

            def log_message(self, format: str, *args: Any) -> None:
                return

        srv = ThreadingHTTPServer(("127.0.0.1", 0), H)
        threading.Thread(target=srv.serve_forever, kwargs={"poll_interval": 0.02}, daemon=True).start()
        old = upstream.MAX_BODY_BYTES
        upstream.MAX_BODY_BYTES = 500
        client = UpstreamClient("t/1", timeout_s=3)
        try:
            with self.assertRaises(UpstreamError) as ctx:
                await client.get_json(f"http://127.0.0.1:{srv.server_address[1]}/")
            self.assertIn("larger", str(ctx.exception))
        finally:
            upstream.MAX_BODY_BYTES = old
            srv.shutdown()
            srv.server_close()
            client.close()


class TrailEvictionTest(unittest.TestCase):
    def test_the_least_recently_seen_trail_is_evicted_instead_of_refusing_new_aircraft(self) -> None:
        s = TrailStore(min_interval_s=1, max_trails=3)
        for h in (1, 2, 3):
            s.record(Aircraft(hex=h, lat=1, lon=1), 10.0 + h, 10.0 + h)
        s.record(Aircraft(hex=1, lat=1, lon=1), 100.0, 100.0)  # 1 is seen again: now 2 is the oldest
        self.assertTrue(s.record(Aircraft(hex=4, lat=2, lon=2), 101.0, 101.0))
        self.assertIsNone(s.snapshot(2))
        self.assertIsNotNone(s.snapshot(1))
        self.assertIsNotNone(s.snapshot(4))
        self.assertEqual((len(s), s.evicted), (3, 1))
        self.assertEqual(s.points, sum(len(s.snapshot(h)["t"]) for h in (1, 3, 4) if s.snapshot(h)))  # type: ignore[index]


class HeadersTest(unittest.IsolatedAsyncioTestCase):
    async def test_static_pages_get_csp_and_sensible_cache_rules_and_api_gets_the_data_licence(self) -> None:
        with tempfile.TemporaryDirectory() as d:
            root = pathlib.Path(d)
            (root / "assets").mkdir()
            (root / "index.html").write_text("<html></html>")
            (root / "assets" / "app-abc123.js").write_text("1")
            (root / "maplibre").mkdir()
            (root / "maplibre" / "w.mjs").write_text("1")
            app = create_app(
                Settings(demo_mode=True, data_dir="", prefetch_regions="off", gzip=False, static_dir=d)
            )
            index = await asgi_get(app, "/")
            self.assertEqual(index.headers["cache-control"], "no-cache")
            self.assertEqual(index.headers["content-security-policy"], CONTENT_SECURITY_POLICY)
            self.assertEqual(index.headers["x-content-type-options"], "nosniff")
            asset = await asgi_get(app, "/assets/app-abc123.js")
            self.assertIn("immutable", asset.headers["cache-control"])
            api = await asgi_get(app, "/api/v1/health")
            self.assertIn("ODbL-1.0", api.headers["x-data-license"])
            self.assertNotIn("content-security-policy", api.headers)

    def test_the_nginx_snippet_sends_the_same_csp(self) -> None:
        conf = (
            pathlib.Path(__file__).resolve().parents[2] / "deploy" / "termux" / "nginx-headers.conf"
        ).read_text()
        self.assertIn(CONTENT_SECURITY_POLICY, conf)


class DemoStillWorks(unittest.TestCase):
    def test_demo_provider_unchanged(self) -> None:
        self.assertIsNotNone(DemoProvider(DemoTraffic(10)))
