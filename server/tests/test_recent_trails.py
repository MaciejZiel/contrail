import json
import unittest
from dataclasses import replace

from flightmap.enrich import EnrichmentCache
from flightmap.filtering import AircraftFilter, hexes_matching, type_counts
from flightmap.models import Aircraft
from flightmap.trails import TrailStore

from .asgi import asgi_get
from .test_app import RECT, AppBase
from .test_search import make_index


def ac(hex_: int, lat: float, lon: float, alt: int = 30000) -> Aircraft:
    return Aircraft(hex=hex_, lat=lat, lon=lon, altitude_ft=alt, ground_speed_kt=400.0)


def everything(_h: int, _la: float, _lo: float) -> bool:
    return True


def nothing(_h: int, _la: float, _lo: float) -> bool:
    return False


class RecentTrailsTest(unittest.TestCase):
    def store(self) -> TrailStore:
        s = TrailStore(retention_s=3600, min_interval_s=1)
        for i in range(120):  # two hours would be 720 fixes; this is 120 fixes ten seconds apart
            s.record(ac(1, 50 + i * 0.01, 10), 1000.0 + i * 10, 1000.0 + i * 10)
        s.record(ac(2, 51, 11), 2190.0, 2190.0)  # a single fix has no trail yet
        return s

    def test_window_and_point_limit(self) -> None:
        s = self.store()
        (hex_, last_t, pts), *rest = s.recent(everything, window_s=600, max_points=20, now=2195.0)
        self.assertEqual((hex_, rest), (1, []))
        self.assertEqual(last_t, 2190.0)
        self.assertLessEqual(len(pts), 20)
        self.assertAlmostEqual(pts[-1][1], 50 + 119 * 0.01, places=4)  # the newest fix is always kept
        newest_first_lat = pts[0][1]
        self.assertGreaterEqual(newest_first_lat, 50 + (119 - 61) * 0.01)  # nothing older than the window

    def test_stale_and_rejected_aircraft_are_skipped(self) -> None:
        s = self.store()
        self.assertEqual(s.recent(everything, now=2190.0 + 901.0, max_age_s=900.0), [])
        self.assertEqual(s.recent(nothing, now=2195.0), [])

    def test_does_not_copy_the_whole_history(self) -> None:
        s = self.store()
        rows = s.recent(everything, window_s=3600, max_points=40, now=2195.0)
        self.assertEqual(len(rows[0][2]), 40)


class FilterTest(unittest.TestCase):
    def test_parsing_ignores_bad_values(self) -> None:
        f = AircraftFilter.from_params(
            {"cs": "lo", "ty": "a32*, b738,<script>", "alt": "0-12000", "gnd": "0"}
        )
        self.assertEqual(
            (f.callsign_prefix, f.types, f.alt_max, f.hide_ground), ("LO", ("A32*", "B738"), 12000, True)
        )
        self.assertFalse(AircraftFilter.from_params({"cs": "a b!", "ty": "toolong", "alt": "x"}).active)

    def test_matching(self) -> None:
        idx = make_index()
        by = {a.callsign: a for a, _t in idx.values()}
        fam = AircraftFilter(types=("A21*",))
        self.assertTrue(fam.matches(by["WZZ2706"]))
        self.assertFalse(fam.matches(by["LOT45"]))
        self.assertFalse(fam.matches(by["LOT3"]))  # no type known
        self.assertTrue(AircraftFilter(callsign_prefix="LOT").matches(by["LOT45"]))
        self.assertFalse(AircraftFilter(airline="WZZ").matches(by["LOT45"]))
        self.assertFalse(AircraftFilter(hide_ground=True).matches(by["RYR12AB"]))
        self.assertFalse(AircraftFilter(alt_max=10000).matches(by["LOT45"]))
        self.assertTrue(AircraftFilter(alt_max=10000).matches(by["RYR12AB"]))  # parked counts as 0 ft

    def test_type_counts_and_hexes(self) -> None:
        idx = make_index()
        self.assertEqual({t["code"] for t in type_counts(idx)}, {"B789", "A21N"})
        names = {t["code"]: t["name"] for t in type_counts(idx)}
        self.assertNotEqual(names["B789"], "B789")  # decoded from the type reference
        self.assertEqual(hexes_matching(idx, AircraftFilter(types=("B78*",))), ["48ae23"])


class SuggestTest(unittest.TestCase):
    def test_by_name_and_by_code_with_live_counts_first(self) -> None:
        from flightmap.filtering import suggest_types

        idx = make_index()
        by_name = suggest_types(idx, "boeing 787")
        self.assertTrue(by_name)
        self.assertEqual(by_name[0]["code"], "B789")  # the one that is tracked now comes first
        self.assertEqual(by_name[0]["count"], 1)
        self.assertEqual(suggest_types(idx, "a21")[0]["code"], "A21N")
        self.assertEqual(suggest_types(idx, "x"), [])


class RecentTrailsEndpointTest(AppBase):
    async def _warm(self) -> None:
        await asgi_get(self.app, f"/api/v1/aircraft?{RECT}")
        api = self.app.state.api
        for a, t in api.index.values():  # a second fix per aircraft, as the next tile refresh would give
            api.trails.record(replace(a, lat=a.lat + 0.01), t + 15, t + 15)

    BOX = "w=14&s=48&e=26&n=56"

    async def test_trails_for_a_box(self) -> None:
        await self._warm()
        r = await asgi_get(self.app, f"/api/v1/trails?{self.BOX}&limit=50")
        body = json.loads(r.body)
        self.assertTrue(body["ok"])
        self.assertGreater(len(body["trails"]), 0)
        self.assertLessEqual(len(body["trails"]), 50)
        self.assertGreaterEqual(body["total"], len(body["trails"]))
        t = body["trails"][0]
        self.assertRegex(t["h"], r"^[0-9a-f]{6}$")
        self.assertGreaterEqual(len(t["p"]), 2)

    async def test_filter_and_validation(self) -> None:
        await self._warm()
        api = self.app.state.api
        some = next(iter(api.index.values()))[0]
        prefix = some.callsign[:3]
        r = json.loads((await asgi_get(self.app, f"/api/v1/trails?{self.BOX}&cs={prefix}")).body)
        for t in r["trails"]:
            found = api.index.get(int(t["h"], 16))
            assert found is not None
            self.assertTrue(found[0].callsign.startswith(prefix))
        self.assertEqual((await asgi_get(self.app, "/api/v1/trails?w=1&s=2")).status, 400)
        self.assertEqual((await asgi_get(self.app, "/api/v1/trails?w=1&s=60&e=2&n=10")).status, 400)
        self.assertEqual((await asgi_get(self.app, "/api/v1/trails?w=nan&s=1&e=2&n=3")).status, 400)

    async def test_no_upstream_requests(self) -> None:
        await self._warm()
        before = self.app.state.cache.status.requests
        for q in (self.BOX, f"{self.BOX}&ty=A32*", "w=170&s=-10&e=-170&n=10"):
            await asgi_get(self.app, f"/api/v1/trails?{q}")
        await asgi_get(self.app, "/api/v1/types")
        await asgi_get(self.app, "/api/v1/type-hexes?ty=A32*")
        await asgi_get(self.app, "/api/v1/airports/EPWA")
        self.assertEqual(self.app.state.cache.status.requests, before)

    async def test_type_suggestions_over_http(self) -> None:
        await self._warm()
        r = json.loads((await asgi_get(self.app, "/api/v1/types?q=airbus")).body)
        self.assertTrue(r["ok"])
        self.assertTrue(r["types"])
        self.assertTrue(
            all("airbus" in t["name"].lower() or t["code"].lower().startswith("airbus") for t in r["types"])
        )

    async def test_types_and_type_hexes(self) -> None:
        await self._warm()
        types = json.loads((await asgi_get(self.app, "/api/v1/types")).body)["types"]
        self.assertTrue(types)
        self.assertGreaterEqual(types[0]["count"], types[-1]["count"])
        code = types[0]["code"]
        r = json.loads((await asgi_get(self.app, f"/api/v1/type-hexes?ty={code}")).body)
        self.assertEqual(len(r["hexes"]), types[0]["count"])
        self.assertEqual((await asgi_get(self.app, "/api/v1/type-hexes")).status, 400)

    async def test_thinned_tiles_honour_callsign_and_type_filters(self) -> None:
        from flightmap import codec

        wide = "x0=30&y0=20&x1=50&y1=34&z=2"
        plain = await asgi_get(self.app, f"/api/v1/aircraft?{wide}")
        await self._warm()
        api = self.app.state.api
        wanted = next(a for a, _t in api.index.values() if a.type_code)
        flt = f"{wide}&ty={wanted.type_code}"
        filtered = await asgi_get(self.app, f"/api/v1/aircraft?{flt}")
        self.assertNotEqual(plain.headers["etag"], filtered.headers["etag"])
        _t, tiles = codec.decode_response(filtered.body)
        got = [a for tile in tiles for a in tile.aircraft]
        self.assertTrue(got)
        for a in got:
            found = api.index.get(a.hex)
            assert found is not None
            self.assertEqual(found[0].type_code, wanted.type_code)


class EnrichmentPeekTest(unittest.IsolatedAsyncioTestCase):
    async def test_peek_never_loads(self) -> None:
        c = EnrichmentCache(ttl_s=60)
        self.assertIsNone(c.peek("a"))

        async def load() -> str:
            return "v"

        await c.get("a", load)
        self.assertEqual(c.peek("a"), "v")
