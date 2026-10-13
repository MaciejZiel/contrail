import json
import time
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
        total, ((hex_, last_t, pts), *rest) = s.recent(everything, window_s=600, max_points=20, now=2195.0)
        self.assertEqual(total, 1)
        self.assertEqual((hex_, rest), (1, []))
        self.assertEqual(last_t, 2190.0)
        self.assertLessEqual(len(pts), 20)
        self.assertAlmostEqual(pts[-1][1], 50 + 119 * 0.01, places=4)  # the newest fix is always kept
        newest_first_lat = pts[0][1]
        self.assertGreaterEqual(newest_first_lat, 50 + (119 - 61) * 0.01)  # nothing older than the window

    def test_stale_and_rejected_aircraft_are_skipped(self) -> None:
        s = self.store()
        self.assertEqual(s.recent(everything, now=2190.0 + 901.0, max_age_s=900.0), (0, []))
        self.assertEqual(s.recent(nothing, now=2195.0), (0, []))

    def test_points_are_capped_per_trail(self) -> None:
        s = self.store()
        _total, rows = s.recent(everything, window_s=3600, max_points=40, now=2195.0)
        self.assertEqual(len(rows[0][2]), 40)

    def test_a_track_starts_after_its_last_gap_or_jump(self) -> None:
        s = TrailStore(retention_s=3600, min_interval_s=1)
        for i in range(6):  # a flight, then a 10 minute silence, then a few more fixes
            s.record(ac(1, 50 + i * 0.01, 10), 1000.0 + i * 10, 1000.0 + i * 10)
        for i in range(4):
            s.record(ac(1, 50.5 + i * 0.01, 10), 1700.0 + i * 10, 1700.0 + i * 10)
        for i in range(3):  # then a jump of about 500 km within one minute
            s.record(ac(1, 55 + i * 0.01, 10), 1750.0 + i * 10, 1750.0 + i * 10)
        _total, ((_h, _t, pts),) = s.recent(everything, window_s=3600, now=1800.0)
        self.assertEqual(len(pts), 3)
        self.assertTrue(all(p[1] >= 55 for p in pts))

    def test_limit_keeps_the_best_ranked_and_reports_the_total(self) -> None:
        s = TrailStore(retention_s=3600, min_interval_s=1)
        for h in range(1, 6):
            for i in range(3):
                s.record(ac(h, 50 + h, 10 + i * 0.01), 1000.0 + i * 10, 1000.0 + i * 10)
        total, rows = s.recent(everything, rank=lambda la, _lo: abs(la - 53.2), limit=2, now=1030.0)
        self.assertEqual(total, 5)
        self.assertEqual(sorted(h for h, _t, _p in rows), [3, 4])


class FilterTest(unittest.TestCase):
    def test_parsing_ignores_bad_values(self) -> None:
        f = AircraftFilter.from_params(
            {"cs": "lo", "ty": "a32*, b738,<script>", "alt": "0-12000", "gnd": "0"}
        )
        self.assertEqual(
            (f.callsign_prefixes, f.types, f.alt_max, f.hide_ground), (("LO",), ("A32*", "B738"), 12000, True)
        )
        self.assertFalse(
            AircraftFilter.from_params({"cs": "b!, toolonggg", "ty": "toolong", "alt": "x"}).active
        )

    def test_callsign_prefixes_split_on_commas_and_whitespace(self) -> None:
        for raw in ("LO,RYR", "lo, ryr", "LO RYR", " LO ;RYR,, ", "LO,RYR,LO"):
            self.assertEqual(AircraftFilter.from_params({"cs": raw}).callsign_prefixes, ("LO", "RYR"), raw)
        many = ",".join(f"A{i}" for i in range(20))
        self.assertEqual(len(AircraftFilter.from_params({"cs": many}).callsign_prefixes), 8)
        self.assertEqual(AircraftFilter.from_params({"cs": "LO,bad!,RYR"}).callsign_prefixes, ("LO", "RYR"))

    def test_matching(self) -> None:
        idx = make_index()
        by = {a.callsign: a for a, _t in idx.values()}
        fam = AircraftFilter(types=("A21*",))
        self.assertTrue(fam.matches(by["WZZ2706"]))
        self.assertFalse(fam.matches(by["LOT45"]))
        self.assertFalse(fam.matches(by["LOT3"]))  # no type known
        self.assertTrue(AircraftFilter(callsign_prefixes=("LOT",)).matches(by["LOT45"]))
        multi = AircraftFilter(callsign_prefixes=("RYR", "LOT"))
        self.assertTrue(multi.matches(by["LOT45"]) and multi.matches(by["RYR12AB"]))
        self.assertFalse(multi.matches(by["WZZ2706"]))
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


class SnapBoxTest(unittest.TestCase):
    def test_grows_outwards_onto_a_grid_and_is_stable(self) -> None:
        from flightmap.app import snap_box

        w, s, e, n = snap_box(14.13, 48.07, 25.91, 55.88)
        self.assertLessEqual((w, s), (14.13, 48.07))
        self.assertGreaterEqual((e, n), (25.91, 55.88))
        self.assertLess(e - 25.91, 3)  # no more than a grid step of extra
        self.assertEqual(snap_box(14.13, 48.07, 25.91, 55.88), (w, s, e, n))
        self.assertEqual(snap_box(14.2, 48.1, 25.8, 55.8), (w, s, e, n))  # a nearby viewer shares the box

    def test_antimeridian_and_whole_world(self) -> None:
        from flightmap.app import snap_box

        w, _s, e, _n = snap_box(170.2, -10, -170.3, 10)
        self.assertGreater(w, e)  # still crosses it
        self.assertLessEqual(w, 170.2)
        self.assertGreaterEqual(e, -170.3)
        self.assertEqual(snap_box(-180, -90, 180, 90), (-180.0, -90.0, 180.0, 90.0))
        self.assertEqual(snap_box(-200, -30, 200, 30)[::2], (-180.0, 180.0))


class TrailsResultReuseTest(AppBase):
    BOX = "w=14&s=48&e=26&n=56"

    async def _warm(self) -> None:
        await asgi_get(self.app, f"/api/v1/aircraft?{RECT}")
        api = self.app.state.api
        for a, t in api.index.values():
            api.trails.record(replace(a, lat=a.lat + 0.01), t + 15, t + 15)

    async def test_whole_world_box_returns_trails(self) -> None:
        await self._warm()
        r = json.loads((await asgi_get(self.app, "/api/v1/trails?w=-180&s=-90&e=180&n=90")).body)
        self.assertGreater(len(r["trails"]), 0)
        self.assertGreaterEqual(r["total"], len(r["trails"]))
        wide = json.loads((await asgi_get(self.app, "/api/v1/trails?w=-300&s=-90&e=300&n=90")).body)
        self.assertEqual(wide["total"], r["total"])

    async def test_limit_is_capped_at_400(self) -> None:
        await self._warm()
        r = json.loads((await asgi_get(self.app, f"/api/v1/trails?{self.BOX}&limit=600")).body)
        self.assertLessEqual(len(r["trails"]), 400)

    async def test_the_selection_is_reused_for_a_nearby_box_and_expires(self) -> None:
        await self._warm()
        api = self.app.state.api
        calls = 0
        real = api.trails.recent

        def counting(*a: object, **k: object) -> object:
            nonlocal calls
            calls += 1
            return real(*a, **k)

        api.trails.recent = counting
        first = await asgi_get(self.app, f"/api/v1/trails?{self.BOX}")
        again = await asgi_get(self.app, "/api/v1/trails?w=14.05&s=48.02&e=25.95&n=55.97")
        self.assertEqual((calls, again.body), (1, first.body))
        await asgi_get(self.app, f"/api/v1/trails?{self.BOX}&ty=A32*")  # another filter is another result
        self.assertEqual(calls, 2)
        for k, (_exp, body) in list(api._trail_results.items()):
            api._trail_results[k] = (0.0, body)  # everything has expired
        await asgi_get(self.app, f"/api/v1/trails?{self.BOX}")
        self.assertEqual(calls, 3)

    async def test_the_cache_stays_small(self) -> None:
        await self._warm()
        api = self.app.state.api
        for i in range(100):
            await asgi_get(self.app, f"/api/v1/trails?w={i}&s=0&e={i + 1}&n=1")
        self.assertLessEqual(len(api._trail_results), 64)

    async def test_a_reused_result_is_much_cheaper_than_a_selection(self) -> None:
        api = self.app.state.api
        now = time.time()
        for h in range(1, 3001):
            for k in range(60):
                api.trails.record(
                    ac(h, 40 + (h % 300) * 0.05 + k * 0.003, 10 + (h % 100) * 0.1),
                    now - 600 + k * 10,
                    now - 600 + k * 10,
                )
        url = "/api/v1/trails?w=5&s=38&e=25&n=56"
        t0 = time.perf_counter()
        first = await asgi_get(self.app, url)
        cold = time.perf_counter() - t0
        t0 = time.perf_counter()
        again = first
        for _ in range(10):
            again = await asgi_get(self.app, url)
        warm = (time.perf_counter() - t0) / 10
        self.assertEqual(again.body, first.body)
        self.assertGreater(len(json.loads(first.body)["trails"]), 100)
        self.assertLess(warm, cold / 3)
