import threading
import unittest
from http.server import ThreadingHTTPServer

from flightmap import codec
from flightmap.app import create_app
from flightmap.config import Settings
from flightmap.demo import DemoTraffic
from flightmap.fixture_upstream import make_handler
from flightmap.tiles import tile_of

from .asgi import asgi_get

# Warsaw sits in tile (40, 28); Europe in the demo data is dense.
RECT = "x0=39&y0=27&x1=41&y1=29"


class AppTest(unittest.IsolatedAsyncioTestCase):
    """Runs the real app and the real ADSB.lol provider against the fixture upstream."""

    def setUp(self) -> None:
        self.upstream = ThreadingHTTPServer(("127.0.0.1", 0), make_handler(DemoTraffic(3000)))
        threading.Thread(target=self.upstream.serve_forever, daemon=True).start()
        port = self.upstream.server_address[1]
        self.settings = Settings(
            adsblol_url=f"http://127.0.0.1:{port}", upstream_budget_rps=50.0, tile_ttl_s=30.0, gzip=False
        )
        self.app = create_app(self.settings)
        self.app.state.cache.start()

    async def asyncTearDown(self) -> None:
        await self.app.state.cache.stop()
        self.upstream.shutdown()
        self.upstream.server_close()

    async def test_returns_decodable_binary_snapshot(self) -> None:
        r = await asgi_get(self.app, f"/api/v1/aircraft?{RECT}")
        self.assertEqual(r.status, 200)
        self.assertEqual(r.headers["content-type"], "application/octet-stream")
        self.assertIn("max-age=2", r.headers["cache-control"])
        _now, tiles = codec.decode_response(r.body)
        self.assertEqual(len(tiles), 9)
        aircraft = [a for t in tiles for a in t.aircraft]
        self.assertGreater(len(aircraft), 50)
        for t in tiles:
            for a in t.aircraft:
                self.assertEqual(tile_of(a.lat, a.lon), (t.tx, t.ty))

    async def test_etag_gives_304_without_new_upstream_calls(self) -> None:
        first = await asgi_get(self.app, f"/api/v1/aircraft?{RECT}")
        calls = self.app.state.cache.status.requests
        second = await asgi_get(
            self.app, f"/api/v1/aircraft?{RECT}", {"If-None-Match": first.headers["etag"]}
        )
        self.assertEqual(second.status, 304)
        self.assertEqual(second.body, b"")
        self.assertEqual(self.app.state.cache.status.requests, calls)

    async def test_bad_parameters(self) -> None:
        self.assertEqual((await asgi_get(self.app, "/api/v1/aircraft?x0=1")).status, 400)
        self.assertEqual((await asgi_get(self.app, "/api/v1/aircraft?x0=a&y0=1&x1=2&y1=3")).status, 400)

    async def test_wide_request_is_limited_to_traffic_tiles(self) -> None:
        api = self.app.state.api
        wide = api.select_tiles(0, 0, 71, 35)
        self.assertLess(len(wide), 2000)
        self.assertGreater(len(wide), 100)
        self.assertLessEqual(len(wide), len(api.traffic) + 5)
        small = api.select_tiles(0, 0, 3, 2)
        self.assertEqual(len(small), 12)

    async def test_too_many_tiles_rejected(self) -> None:
        self.app.state.api.settings = Settings(max_tiles_per_request=4)
        r = await asgi_get(self.app, f"/api/v1/aircraft?{RECT}")
        self.assertEqual(r.status, 400)

    async def test_status_and_health(self) -> None:
        await asgi_get(self.app, f"/api/v1/aircraft?{RECT}")
        status = await asgi_get(self.app, "/api/v1/status")
        self.assertEqual(status.status, 200)
        self.assertIn(b'"tiles_cached":9', status.body)
        self.assertEqual((await asgi_get(self.app, "/api/v1/health")).status, 200)


class BasePathTest(unittest.IsolatedAsyncioTestCase):
    async def test_mounted_under_base_path(self) -> None:
        app = create_app(Settings(demo_mode=True, base_path="/flights", gzip=False))
        r = await asgi_get(app, "/flights/api/v1/health")
        self.assertEqual(r.status, 200)
        self.assertEqual((await asgi_get(app, "/api/v1/health")).status, 404)
