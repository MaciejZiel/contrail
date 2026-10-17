"""Freshness scheduling: ghost retention, 429 handling, viewer share and fitting the plan to the budget.

Runs on the fake clock (tests/clock.py) with a seeded generator, so nothing waits and nothing flakes.
"""

import random
import unittest

from flightmap.config import Settings
from flightmap.models import Aircraft
from flightmap.regions import PrefetchSpec
from flightmap.tilecache import (
    CEILING_MEMORY_S,
    HOT_SHARE,
    LIMITED_TILE_COOLDOWN_S,
    PAUSE_CAP_S,
    TileCache,
)
from flightmap.tiles import Tile
from flightmap.upstream import UpstreamError

from .clock import FakeClock, cache_with, run_for


class Provider:
    name = "fake"
    source_id = 9

    def __init__(self, busy: dict[Tile, int] | None = None) -> None:
        self.calls: list[Tile] = []
        self.fail: UpstreamError | None = None
        self.busy = busy or {}

    async def fetch_tile(self, tile: Tile) -> list[Aircraft]:
        self.calls.append(tile)
        if self.fail:
            raise self.fail
        n = self.busy.get(tile, 3)
        return [Aircraft(hex=tile[0] * 10000 + tile[1] * 100 + i, lat=1.0, lon=1.0) for i in range(n)]

    async def fetch_hex(self, hex_str: str) -> Aircraft | None:
        return None

    async def fetch_exact(self, kind: str, value: str) -> Aircraft | None:
        return None


def make(clock: FakeClock, p: Provider, **kw: object) -> TileCache:
    kw.setdefault("rng", random.Random(7))
    return cache_with(clock, provider=p, **kw)


class GhostTest(unittest.IsolatedAsyncioTestCase):
    async def test_data_between_max_age_and_ghost_age_is_still_served_with_its_age(self) -> None:
        clock, p = FakeClock(), Provider()
        cache = make(clock, p, budget_rps=50.0, ttl_s=1000.0, max_age_s=100.0, ghost_age_s=300.0)
        await cache.request([(1, 1)], cold_deadline_s=1.0)
        fetched = cache.entries([(1, 1)])[0].fetched_at
        clock.advance(200.0)  # older than max_age_s, younger than ghost_age_s
        entries = cache.entries([(1, 1)])
        self.assertEqual(len(entries), 1)
        self.assertAlmostEqual(clock.wall() - entries[0].fetched_at, 200.0, delta=1.0)
        self.assertEqual(entries[0].fetched_at, fetched)
        clock.advance(150.0)  # past ghost_age_s
        self.assertEqual(cache.entries([(1, 1)]), [])

    async def test_without_a_ghost_age_nothing_changes(self) -> None:
        clock, p = FakeClock(), Provider()
        cache = make(clock, p, budget_rps=50.0, ttl_s=1000.0, max_age_s=100.0)
        await cache.request([(1, 1)], cold_deadline_s=1.0)
        clock.advance(101.0)
        self.assertEqual(cache.entries([(1, 1)]), [])

    async def test_memory_of_ghosts_is_freed_after_the_ghost_age_and_listeners_are_told(self) -> None:
        clock, p = FakeClock(), Provider()
        cache = make(clock, p, budget_rps=50.0, ttl_s=1000.0, max_age_s=100.0, ghost_age_s=300.0)
        told: list[Tile] = []
        cache.expire_listeners.append(told.append)
        await cache.request([(1, 1)], cold_deadline_s=1.0)
        clock.advance(320.0)
        await cache.tick()
        self.assertEqual(told, [])  # a ghost is still held, 1.1 x ghost_age_s
        clock.advance(20.0)
        await cache.tick()
        self.assertEqual(told, [(1, 1)])

    async def test_status_reports_ghost_age_and_coverage_counts(self) -> None:
        clock, p = FakeClock(), Provider()
        plan = {(2, 2): PrefetchSpec(1, 60.0)}
        cache = make(
            clock, p, budget_rps=50.0, ttl_s=1000.0, max_age_s=100.0, ghost_age_s=300.0, prefetch_plan=plan
        )
        await cache.request([(2, 2), (9, 9)], cold_deadline_s=1.0)
        clock.advance(150.0)
        status = cache.snapshot_status()
        self.assertEqual(status["ghost_age_s"], 300.0)
        cov = status["coverage"]
        self.assertEqual(cov["1"]["ghost"], 1)  # type: ignore[index]
        self.assertEqual(cov["1"]["fresh"], 0)  # type: ignore[index]
        self.assertEqual(cov["demand"]["with_data"], 1)  # type: ignore[index]

    def test_settings_read_the_ghost_age(self) -> None:
        self.assertEqual(Settings.from_env({}).ghost_age_s, 1800.0)
        self.assertEqual(Settings.from_env({"GHOST_AGE_S": "600"}).ghost_age_s, 600.0)


class RateLimitTest(unittest.IsolatedAsyncioTestCase):
    async def test_refused_tile_rests_before_it_is_tried_again_and_counters_see_it(self) -> None:
        clock, p = FakeClock(), Provider()
        p.fail = UpstreamError("slow down", 429)
        cache = make(clock, p, budget_rps=50.0, ttl_s=0.2, hot_window_s=600.0)
        await cache.request([(4, 4)], cold_deadline_s=1.0)
        n = len(p.calls)
        await run_for(cache, clock, LIMITED_TILE_COOLDOWN_S * 0.8 - 1.0)
        self.assertEqual(len(p.calls), n)  # nothing before the shortest jittered cooldown
        await run_for(cache, clock, LIMITED_TILE_COOLDOWN_S * 0.5 + 8.0)
        self.assertGreater(len(p.calls), n)
        window = cache.upstream_window()
        self.assertEqual(window["limited_429"], window["requests"])
        self.assertEqual(window["limited_share"], 1.0)

    async def test_consecutive_refusals_without_retry_after_pause_longer_each_time(self) -> None:
        clock = FakeClock()
        cache = make(clock, Provider(), budget_rps=1.0)
        pauses: list[float] = []
        for _ in range(8):
            before = clock.monotonic()
            cache._on_rate_limited(None)  # type: ignore[attr-defined]
            pauses.append(cache._paused_until - before)  # type: ignore[attr-defined]
        self.assertGreater(pauses[3], pauses[0])
        self.assertLessEqual(max(pauses), PAUSE_CAP_S * 1.25 + 1e-9)
        self.assertGreaterEqual(min(pauses), 4.0 * 0.8 - 1e-9)

    async def test_a_given_retry_after_is_used_as_it_is(self) -> None:
        clock = FakeClock()
        cache = make(clock, Provider(), budget_rps=1.0)
        cache._on_rate_limited(30.0)  # type: ignore[attr-defined]
        cache._on_rate_limited(30.0)  # type: ignore[attr-defined]
        self.assertAlmostEqual(cache._paused_until - clock.monotonic(), 30.0)  # type: ignore[attr-defined]

    async def test_success_resets_the_pause_escalation(self) -> None:
        clock, p = FakeClock(), Provider()
        cache = make(clock, p, budget_rps=50.0, ttl_s=1000.0)
        for _ in range(4):
            cache._on_rate_limited(None)  # type: ignore[attr-defined]
        clock.advance(200.0)
        await cache.request([(3, 3)], cold_deadline_s=1.0)
        self.assertEqual(cache._consecutive_limited, 0)  # type: ignore[attr-defined]

    async def test_two_refusals_lower_the_rate_and_recovery_is_quick_then_cautious(self) -> None:
        clock = FakeClock()
        cache = make(clock, Provider(), budget_rps=0.2)
        cache._on_rate_limited(0.05)  # type: ignore[attr-defined]
        self.assertEqual(cache._bucket.rate, 0.2)  # type: ignore[attr-defined]  # one is not enough
        cache._on_rate_limited(0.05)  # type: ignore[attr-defined]
        self.assertAlmostEqual(cache._bucket.rate, 0.16)  # type: ignore[attr-defined]
        now = clock.monotonic()
        # quick: back to 90 percent of the rate that drew the refusals within a minute or two
        for _ in range(3):
            now += 20.0
            cache._recover_rate(now)  # type: ignore[attr-defined]
        self.assertGreaterEqual(cache._bucket.rate, 0.9 * 0.2)  # type: ignore[attr-defined]
        reached = cache._bucket.rate  # type: ignore[attr-defined]
        # then cautious: one small probe every two minutes, not a step every 20 s
        now += 20.0
        cache._recover_rate(now)  # type: ignore[attr-defined]
        self.assertAlmostEqual(cache._bucket.rate, reached, places=6)  # type: ignore[attr-defined]
        now += 120.0
        cache._recover_rate(now)  # type: ignore[attr-defined]
        self.assertGreater(cache._bucket.rate, reached)  # type: ignore[attr-defined]
        # the memory of the ceiling fades, and then recovery is quick all the way to the budget again
        now += CEILING_MEMORY_S + 1.0
        for _ in range(10):
            now += 20.0
            cache._recover_rate(now)  # type: ignore[attr-defined]
        self.assertAlmostEqual(cache._bucket.rate, 0.2)  # type: ignore[attr-defined]


class ViewerShareTest(unittest.IsolatedAsyncioTestCase):
    async def test_a_zoomed_in_viewer_cannot_starve_the_background_plan(self) -> None:
        clock, p = FakeClock(), Provider()
        plan = {(20 + i, 5): PrefetchSpec(1, 60.0) for i in range(40)}  # wants more than the whole budget
        cache = make(
            clock, p, budget_rps=0.2, ttl_s=10.0, hot_window_s=60.0, prefetch_plan=plan, prefetch_always=True
        )
        viewed = [(1, 1), (1, 2), (2, 1), (2, 2)]
        for _ in range(60):  # ten minutes of a viewer re-declaring the same four tiles every 10 s
            await cache.request(viewed, cold_deadline_s=0.0, focus=True)
            await run_for(cache, clock, 10.0, step=0.5)
        background = sum(1 for t in p.calls if t in plan)
        viewer = sum(1 for t in p.calls if t in viewed)
        total = background + viewer
        self.assertGreater(background, 0.25 * total)  # the plan keeps a real share
        self.assertLess(viewer, 0.75 * total)  # and the viewer does not take everything (HOT_SHARE is 0.65)
        self.assertLess(HOT_SHARE, 0.75)

    async def test_viewers_get_the_budget_back_when_no_background_tile_is_due(self) -> None:
        clock, p = FakeClock(), Provider()
        cache = make(clock, p, budget_rps=0.2, ttl_s=10.0, hot_window_s=60.0, prefetch_always=True)
        viewed = [(1, 1), (1, 2), (2, 1), (2, 2)]
        for _ in range(60):
            await cache.request(viewed, cold_deadline_s=0.0, focus=True)
            await run_for(cache, clock, 10.0, step=0.5)
        self.assertGreater(len(p.calls), 0.9 * 0.2 * 600)  # no plan: the whole budget is used


class FitTest(unittest.IsolatedAsyncioTestCase):
    async def test_over_full_class_keeps_its_busiest_tiles_and_the_tail_only_gets_leftovers(self) -> None:
        clock = FakeClock()
        tiles = [(30 + i, 5) for i in range(40)]
        busy = {t: (50 if i < 5 else 1) for i, t in enumerate(tiles)}
        p = Provider(busy)
        plan = {t: PrefetchSpec(1, 60.0) for t in tiles}
        # 0.1 req/s * 0.7 background * 0.6 class weight * 0.9 * 200 s = 7 tiles can be kept, not 40
        cache = make(
            clock,
            p,
            budget_rps=0.1,
            ttl_s=10.0,
            max_age_s=100.0,
            ghost_age_s=200.0,
            prefetch_plan=plan,
            prefetch_always=True,
        )
        await run_for(cache, clock, 1500.0, step=1.0)
        demoted = cache._demoted  # type: ignore[attr-defined]
        self.assertTrue(demoted)
        self.assertTrue(all(t not in demoted for t in tiles[:5]))  # the five busy tiles are kept
        counts = {t: p.calls.count(t) for t in tiles}
        self.assertGreater(min(counts[t] for t in tiles[:5]), 3 * max(counts[t] for t in demoted))
        self.assertEqual(cache.snapshot_status()["coverage"]["1"]["demoted"], len(demoted))  # type: ignore[index]

    async def test_busy_tiles_are_refreshed_more_often_than_quiet_ones(self) -> None:
        clock = FakeClock()
        tiles = [(30 + i, 5) for i in range(6)]
        busy = {t: (60 if i < 3 else 2) for i, t in enumerate(tiles)}
        p = Provider(busy)
        plan = {t: PrefetchSpec(1, 20.0) for t in tiles}  # all want 20 s, the budget allows far less
        cache = make(clock, p, budget_rps=0.1, ttl_s=10.0, prefetch_plan=plan, prefetch_always=True)
        await run_for(cache, clock, 2400.0, step=1.0)
        busy_calls = sum(p.calls.count(t) for t in tiles[:3])
        quiet_calls = sum(p.calls.count(t) for t in tiles[3:])
        self.assertGreater(busy_calls, 1.3 * quiet_calls)

    async def test_a_plan_that_fits_the_budget_demotes_nothing(self) -> None:
        clock, p = FakeClock(), Provider()
        plan = {(30 + i, 5): PrefetchSpec(1, 60.0) for i in range(3)}
        cache = make(clock, p, budget_rps=0.5, prefetch_plan=plan, prefetch_always=True, ghost_age_s=1800.0)
        await run_for(cache, clock, 200.0, step=1.0)
        self.assertEqual(cache._demoted, frozenset())  # type: ignore[attr-defined]


if __name__ == "__main__":
    unittest.main()
