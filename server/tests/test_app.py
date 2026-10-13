import json
import tempfile
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


class AppBase(unittest.IsolatedAsyncioTestCase):
    """Runs the real app and the real ADSB.lol provider against the fixture upstream."""

    def setUp(self) -> None:
        self.upstream = ThreadingHTTPServer(("127.0.0.1", 0), make_handler(DemoTraffic(3000)))
        threading.Thread(
            target=self.upstream.serve_forever, kwargs={"poll_interval": 0.02}, daemon=True
        ).start()
        port = self.upstream.server_address[1]
        self.tmp = tempfile.TemporaryDirectory()
        self.settings = Settings(
            adsblol_url=f"http://127.0.0.1:{port}",
            routes_url=f"http://127.0.0.1:{port}",
            data_dir=self.tmp.name,
            upstream_budget_rps=50.0,
            tile_ttl_s=30.0,
            trail_min_interval_s=0.0,
            gzip=False,
        )
        self.app = create_app(self.settings)
        self.app.state.cache.start()

    async def asyncTearDown(self) -> None:
        await self.app.state.cache.stop()
        self.upstream.shutdown()
        self.upstream.server_close()
        self.tmp.cleanup()


class AppTest(AppBase):
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


class AircraftDetailTest(AppBase):
    async def _any_aircraft(self) -> tuple[str, str]:
        r = await asgi_get(self.app, f"/api/v1/aircraft?{RECT}")
        _now, tiles = codec.decode_response(r.body)
        for t in tiles:
            for a in t.aircraft:
                if a.callsign and not a.on_ground:
                    return a.hex_str, a.callsign
        raise AssertionError("no aircraft")

    async def test_detail_has_identity_fields(self) -> None:
        hex_str, callsign = await self._any_aircraft()
        r = await asgi_get(self.app, f"/api/v1/aircraft/{hex_str}")
        self.assertEqual(r.status, 200)
        body = json.loads(r.body)["aircraft"]
        self.assertEqual(body["hex"], hex_str)
        self.assertEqual(body["callsign"], callsign)
        self.assertTrue(body["registration"])
        self.assertTrue(body["type_name"])
        self.assertIsNotNone(body["altitude_ft"])

    async def test_unknown_and_invalid_hex(self) -> None:
        self.assertEqual((await asgi_get(self.app, "/api/v1/aircraft/zzzzzz")).status, 400)
        r = await asgi_get(self.app, "/api/v1/aircraft/000000")
        self.assertEqual(r.status, 404)
        self.assertFalse(json.loads(r.body)["ok"])

    async def test_route_comes_from_the_standing_data_upstream(self) -> None:
        hex_str, _cs = await self._any_aircraft()
        r = await asgi_get(self.app, f"/api/v1/aircraft/{hex_str}/route")
        self.assertEqual(r.status, 200)
        body = json.loads(r.body)
        self.assertTrue(body["ok"], body)
        route = body["route"]
        self.assertTrue(route["origin"]["icao"])
        self.assertNotEqual(route["origin"]["icao"], route["destination"]["icao"])
        self.assertIsInstance(route["plausible"], bool)
        self.assertTrue(0.0 <= route["progress"] <= 1.0)

    async def test_route_failure_degrades_only_the_route(self) -> None:
        hex_str, _cs = await self._any_aircraft()
        # point the route provider at a dead port: the endpoint must still answer 200 with ok=false
        self.app.state.api._route_lookup = _dead_route
        r = await asgi_get(self.app, f"/api/v1/aircraft/{hex_str}/route")
        self.assertEqual(r.status, 200)
        self.assertEqual(json.loads(r.body), {"ok": False, "reason": "unavailable"})
        detail = await asgi_get(self.app, f"/api/v1/aircraft/{hex_str}")
        self.assertEqual(detail.status, 200)  # identity is unaffected

    async def test_trail_accumulates_positions(self) -> None:
        hex_str, _cs = await self._any_aircraft()
        r = await asgi_get(self.app, f"/api/v1/aircraft/{hex_str}/trail")
        body = json.loads(r.body)
        self.assertTrue(body["ok"])
        self.assertGreaterEqual(len(body["t"]), 1)
        self.assertEqual(len(body["t"]), len(body["lat"]))
        empty = json.loads((await asgi_get(self.app, "/api/v1/aircraft/000000/trail")).body)
        self.assertEqual(empty["t"], [])


async def _dead_route(_callsign: str) -> None:
    from flightmap.upstream import UpstreamError

    raise UpstreamError("route source down")
