import asyncio
import json
import unittest
from typing import ClassVar

from flightmap import codec
from flightmap.app import create_app
from flightmap.config import Settings
from flightmap.models import Aircraft
from flightmap.regions import DEFAULT_REGIONS, PrefetchSpec, build_plan, parse_regions
from flightmap.thinning import CELL_DEG_BY_ZOOM, level_for_zoom, thin
from flightmap.tilecache import TileCache
from flightmap.tiles import Tile, parse_region
from flightmap.trafficmask import load_traffic_tiles
from flightmap.upstream import UpstreamError

from .asgi import asgi_get
from .clock import FakeClock, cache_with, run_for


class CountingProvider:
    name = "fake"
    source_id = 9

    def __init__(self) -> None:
        self.calls: list[Tile] = []
        self.fail = False
        self.empty: set[Tile] = set()

    async def fetch_tile(self, tile: Tile) -> list[Aircraft]:
        self.calls.append(tile)
        if self.fail:
            raise UpstreamError("down", 500)
        if tile in self.empty:
            return []
        return [Aircraft(hex=tile[0] * 100 + tile[1] + n, lat=1.0, lon=1.0) for n in range(20)]

    async def fetch_hex(self, hex_str: str) -> Aircraft | None:
        return None

    async def fetch_exact(self, kind: str, value: str) -> Aircraft | None:
        return None


class RegionTest(unittest.TestCase):
    def test_europe_region_is_a_few_dozen_tiles(self) -> None:
        tiles = parse_region("35,72,-25,45")
        self.assertEqual(len(tiles), 8 * 15)
        self.assertIn((40, 28), tiles)  # Warsaw
        self.assertEqual(parse_region(""), [])
        self.assertEqual(parse_region("1,2,3"), [])


class PrefetchTest(unittest.IsolatedAsyncioTestCase):
    """Scheduler tests run on a fake clock: no real waiting, so they cannot flake under load."""

    REGION: ClassVar[list[Tile]] = [(1, 1), (2, 1), (3, 1)]

    def make(self, clock: FakeClock, p: CountingProvider, **kw: object) -> TileCache:
        base: dict[str, object] = {
            "budget_rps": 100.0, "ttl_s": 0.05, "hot_window_s": 5.0,
            "prefetch_plan": {t: PrefetchSpec(1, 0.05) for t in self.REGION},
            "prefetch_idle_s": 5.0,
        }  # fmt: skip
        base.update(kw)
        return cache_with(clock, provider=p, **base)

    async def test_prefetch_warms_the_region_after_a_viewer_appeared(self) -> None:
        clock, p = FakeClock(), CountingProvider()
        c = self.make(clock, p)
        await c.request([(9, 9)])  # somebody looks at an unrelated tile
        await run_for(c, clock, 0.4)
        self.assertTrue(set(self.REGION) <= set(p.calls))
        self.assertEqual(len(c.entries(self.REGION)), 3)

    async def test_no_prefetch_without_viewers_or_after_they_left(self) -> None:
        clock, p = FakeClock(), CountingProvider()
        c = self.make(clock, p, prefetch_idle_s=0.2)
        await run_for(c, clock, 0.3)
        self.assertEqual(p.calls, [])  # nobody has ever looked
        await c.request([(9, 9)])
        await run_for(c, clock, 0.5)  # the idle window passes
        n = sum(t in self.REGION for t in p.calls)
        await run_for(c, clock, 0.4)
        self.assertEqual(sum(t in self.REGION for t in p.calls), n)  # prefetch paused again

    async def test_usually_empty_tiles_are_refreshed_much_less_often(self) -> None:
        clock, p = FakeClock(), CountingProvider()
        p.empty = {(2, 1)}  # open ocean
        c = self.make(
            clock,
            p,
            prefetch_always=True,
            ttl_s=0.3,
            prefetch_plan={t: PrefetchSpec(1, 0.3) for t in self.REGION},
        )
        await run_for(c, clock, 3.2)
        busy, empty = p.calls.count((1, 1)), p.calls.count((2, 1))
        self.assertGreaterEqual(busy, 9)
        self.assertLessEqual(empty, 3)
        self.assertLess(empty * 2, busy)

    async def test_tiles_that_stay_empty_are_left_alone_for_hours(self) -> None:
        clock, p = FakeClock(), CountingProvider()
        p.empty = {(2, 1)}
        c = self.make(
            clock,
            p,
            prefetch_always=True,
            ttl_s=1.0,
            prefetch_plan={t: PrefetchSpec(1, 60.0) for t in self.REGION},
        )
        await run_for(c, clock, 3600.0, step=5.0)  # an hour of fake time
        busy, empty = p.calls.count((1, 1)), p.calls.count((2, 1))
        self.assertGreaterEqual(busy, 50)  # every minute
        self.assertLessEqual(empty, 8)  # a handful of looks in the whole hour, backing off further each time

    async def test_always_on_prefetch_works_without_viewers(self) -> None:
        clock, p = FakeClock(), CountingProvider()
        c = self.make(clock, p, prefetch_always=True)
        await run_for(c, clock, 0.4)
        self.assertTrue(set(self.REGION) <= set(p.calls))

    async def test_demanded_tiles_are_fetched_before_prefetch_tiles(self) -> None:
        clock, p = FakeClock(), CountingProvider()
        c = self.make(clock, p, budget_rps=3.0)
        await c.request([(9, 9), (9, 8)], cold_deadline_s=0.05)
        await run_for(c, clock, 0.9)
        first_prefetch = min(i for i, t in enumerate(p.calls) if t in self.REGION)
        demanded = [i for i, t in enumerate(p.calls) if t in {(9, 9), (9, 8)}]
        self.assertTrue(demanded and min(demanded) < first_prefetch)

    async def test_tiles_that_cannot_refresh_expire(self) -> None:
        clock, p = FakeClock(), CountingProvider()
        c = self.make(clock, p, max_age_s=0.3, prefetch_plan={})
        await c.request([(5, 5)])
        self.assertEqual(len(c.entries([(5, 5)])), 1)
        p.fail = True
        await run_for(c, clock, 0.6)
        self.assertEqual(c.entries([(5, 5)]), [])  # too old to show


def planes() -> list[tuple[int, Aircraft]]:
    return [
        (0, Aircraft(hex=1, lat=48.1, lon=10.1, altitude_ft=10000)),
        (0, Aircraft(hex=2, lat=48.2, lon=10.2, altitude_ft=38000)),  # higher: wins the cell
        (1, Aircraft(hex=3, lat=49.0, lon=10.3, on_ground=True)),
        (1, Aircraft(hex=4, lat=-30.0, lon=100.0, altitude_ft=1000)),  # alone in its cell
        (1, Aircraft(hex=5, lat=48.3, lon=10.3, altitude_ft=500, emergency=True)),  # emergencies always win
    ]


class RegionPlanTest(unittest.TestCase):
    def test_defaults_are_europe_first_then_the_us_and_a_few_hubs_not_the_world(self) -> None:
        traffic = load_traffic_tiles()
        plan = build_plan(DEFAULT_REGIONS, traffic)
        eu = plan[(40, 28)]  # Warsaw
        self.assertEqual((eu.priority, eu.interval_s), (1, 300.0))
        self.assertEqual(plan[(21, 26)].priority, 2)  # New York area
        self.assertEqual(plan[(26, 13)].priority, 3)  # the Sao Paulo hub
        self.assertEqual(plan[(47, 23)].priority, 3)  # Dubai
        counts = {p: sum(1 for s in plan.values() if s.priority == p) for p in (1, 2, 3)}
        self.assertGreater(counts[1], 40)
        self.assertLess(sum(counts.values()), 200)  # under 200 tiles, not the 751 of the whole world
        self.assertLess(len(plan), len(traffic) / 4)
        self.assertNotIn((60, 5), plan)  # somewhere over the Pacific is fetched only on demand
        self.assertTrue(all(t in traffic for t in plan))  # never a tile without an airport

    def test_overlaps_keep_the_better_spec_and_parsing(self) -> None:
        regs = parse_regions("a:35,72,-25,45:2:900;b:45,60,0,30:1:120")
        plan = build_plan(regs, load_traffic_tiles())
        self.assertEqual(plan[(40, 28)], PrefetchSpec(1, 120.0))
        self.assertEqual(parse_regions("off"), ())
        self.assertEqual(parse_regions(""), DEFAULT_REGIONS)
        with self.assertRaises(ValueError):
            parse_regions("broken")


class SchedulerFairnessTest(unittest.IsolatedAsyncioTestCase):
    async def test_classes_share_spare_capacity_by_weight_and_nobody_starves(self) -> None:
        clock, p = FakeClock(), CountingProvider()
        plan = {
            **{(x, 1): PrefetchSpec(1, 0.05) for x in range(10)},
            **{(x, 2): PrefetchSpec(2, 0.05) for x in range(10)},
            **{(x, 3): PrefetchSpec(3, 0.05) for x in range(10)},
        }
        c = cache_with(
            clock, provider=p, budget_rps=40.0, ttl_s=0.05, prefetch_plan=plan, prefetch_always=True
        )
        await run_for(c, clock, 3.0)
        served = {prio: sum(1 for t in p.calls if t[1] == prio) for prio in (1, 2, 3)}
        total = sum(served.values())
        self.assertGreater(total, 100)
        self.assertGreater(served[3], 0)  # the lowest class is never starved
        self.assertGreater(served[1], served[2])
        self.assertGreater(served[2], served[3])
        self.assertAlmostEqual(served[1] / total, 0.6, delta=0.05)
        self.assertAlmostEqual(served[2] / total, 0.3, delta=0.05)
        self.assertAlmostEqual(served[3] / total, 0.1, delta=0.05)

    async def test_a_class_without_due_tiles_hands_its_share_to_the_others(self) -> None:
        clock, p = FakeClock(), CountingProvider()
        plan = {(x, 1): PrefetchSpec(1, 0.05) for x in range(6)} | {
            (x, 3): PrefetchSpec(3, 0.05) for x in range(6)
        }
        c = cache_with(
            clock, provider=p, budget_rps=40.0, ttl_s=0.05, prefetch_plan=plan, prefetch_always=True
        )
        await run_for(c, clock, 1.5)
        served = {prio: sum(1 for t in p.calls if t[1] == prio) for prio in (1, 3)}
        self.assertGreater(served[3], 0)
        self.assertGreater(served[1], served[3])  # classes 1 and 3 only: priority 2's share is not wasted
        self.assertAlmostEqual(served[1] / (served[1] + served[3]), 0.6 / 0.7, delta=0.06)

    async def test_the_viewport_beats_background_tiles_anywhere_in_the_world(self) -> None:
        clock, p = FakeClock(), CountingProvider()
        plan = {(x, 1): PrefetchSpec(1, 0.05) for x in range(20)}
        c = cache_with(clock, provider=p, budget_rps=3.0, ttl_s=0.2, prefetch_plan=plan, prefetch_always=True)
        await run_for(c, clock, 0.5)  # background work is under way
        before = len(p.calls)
        await c.request([(60, 5)], cold_deadline_s=3.0)  # a viewer far away from every region
        fetched_at = next(i for i, t in enumerate(p.calls) if t == (60, 5))
        self.assertLess(fetched_at - before, 4)  # served within a few fetches, not after the sweep
        self.assertEqual(len(c.entries([(60, 5)])), 1)

    async def test_old_tile_data_is_freed_and_listeners_are_told(self) -> None:
        clock, p = FakeClock(), CountingProvider()
        c = cache_with(
            clock,
            provider=p,
            budget_rps=100.0,
            ttl_s=0.05,
            max_age_s=0.2,
            hot_window_s=0.05,
            prefetch_plan={},
        )
        expired: list[Tile] = []
        c.expire_listeners.append(expired.append)
        await c.request([(5, 5)])
        p.fail = True  # the tile can no longer be refreshed
        await run_for(c, clock, 0.7)
        self.assertIn((5, 5), expired)
        self.assertEqual(c.snapshot_status()["tiles_cached"], 0)


class ThinningTest(unittest.TestCase):
    def test_levels(self) -> None:
        self.assertEqual(level_for_zoom(None), 0)
        self.assertEqual(level_for_zoom(9), 0)
        self.assertEqual(level_for_zoom(7), 0)
        self.assertEqual(level_for_zoom(6), 6)
        self.assertEqual(level_for_zoom(-3), 2)
        self.assertEqual(set(CELL_DEG_BY_ZOOM), {2, 3, 4, 5, 6})

    def test_one_per_cell_with_priorities(self) -> None:
        kept = {a.hex for _o, a in thin(planes(), 2)}
        self.assertEqual(kept, {5, 4})
        no_emergency = [(o, a) for o, a in planes() if a.hex != 5]
        self.assertEqual({a.hex for _o, a in thin(no_emergency, 2)}, {2, 4})

    def test_level_zero_keeps_everything_and_cells_are_small_at_high_zoom(self) -> None:
        self.assertEqual(len(thin(planes(), 0)), 5)
        self.assertGreater(len(thin(planes(), 6)), len(thin(planes(), 2)))

    def test_the_selected_aircraft_survives_thinning(self) -> None:
        kept = {
            a.hex for _o, a in thin(planes(), 2, keep=1)
        }  # plane 1 is low and would normally lose to 2 and 5
        self.assertIn(1, kept)
        self.assertNotIn(5, kept)

    def test_owner_is_preserved(self) -> None:
        owners = {o for o, _a in thin(planes(), 2)}
        self.assertEqual(owners, {1})


class ThinnedResponseTest(unittest.IsolatedAsyncioTestCase):
    async def test_low_zoom_returns_far_fewer_aircraft_than_city_zoom(self) -> None:
        app = create_app(
            Settings(
                demo_mode=True, data_dir="", prefetch_regions="off", gzip=False, upstream_budget_rps=100.0
            )
        )
        app.state.cache.start()
        try:
            rect = "x0=30&y0=24&x1=46&y1=32"
            full = await asgi_get(app, f"/api/v1/aircraft?{rect}&z=9")
            for _ in range(
                2000
            ):  # the demo cache fills over a few requests; bounded by progress, not by time
                full = await asgi_get(app, f"/api/v1/aircraft?{rect}&z=9")
                if full.headers["x-pending"] == "0":
                    break
                await asyncio.sleep(0.005)
            thinned = await asgi_get(app, f"/api/v1/aircraft?{rect}&z=3")
            n_full = sum(len(t.aircraft) for t in codec.decode_response(full.body)[1])
            n_thin = sum(len(t.aircraft) for t in codec.decode_response(thinned.body)[1])
            self.assertGreater(n_full, 100)
            self.assertLess(n_thin, n_full * 0.5)
            self.assertGreater(n_thin, 3)
            self.assertNotEqual(full.headers["etag"], thinned.headers["etag"])
            again = await asgi_get(
                app, f"/api/v1/aircraft?{rect}&z=3", {"If-None-Match": thinned.headers["etag"]}
            )
            self.assertEqual(again.status, 304)
            status = json.loads((await asgi_get(app, "/api/v1/status")).body)
            self.assertIn("median_tile_age_s", status)
        finally:
            await app.state.cache.stop()
