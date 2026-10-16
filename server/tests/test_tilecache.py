"""Scheduler tests run on a fake clock (tests/clock.py): no real waiting, so they cannot flake under load."""

import asyncio
import unittest
from collections.abc import Callable
from typing import ClassVar

from flightmap.models import Aircraft
from flightmap.tilecache import TileCache
from flightmap.tiles import Tile
from flightmap.upstream import UpstreamError

from .clock import FakeClock, cache_with, run_for


class FakeProvider:
    name = "fake"
    source_id = 9

    def __init__(self) -> None:
        self.calls: list[Tile] = []
        self.fail: UpstreamError | None = None
        self.gate: asyncio.Event | None = None  # when set, fetches wait until the test opens it

    async def fetch_tile(self, tile: Tile) -> list[Aircraft]:
        self.calls.append(tile)
        if self.gate is not None:
            await self.gate.wait()
        if self.fail:
            raise self.fail
        return [Aircraft(hex=tile[0] * 100 + tile[1], lat=1.0, lon=1.0)]

    async def fetch_hex(self, hex_str: str) -> Aircraft | None:
        return None

    async def fetch_exact(self, kind: str, value: str) -> Aircraft | None:
        return None


class TileCacheTest(unittest.IsolatedAsyncioTestCase):
    async def test_concurrent_viewers_share_one_upstream_call(self) -> None:
        clock, p = FakeClock(), FakeProvider()
        p.gate = asyncio.Event()
        cache = cache_with(clock, provider=p, budget_rps=50.0, ttl_s=0.2, hot_window_s=5.0)
        viewers = [asyncio.ensure_future(cache.request([(1, 1)], cold_deadline_s=5.0)) for _ in range(20)]
        await asyncio.sleep(0)
        await asyncio.sleep(0)
        p.gate.set()
        await asyncio.gather(*viewers)
        self.assertEqual(p.calls.count((1, 1)), 1)
        self.assertEqual(len(cache.entries([(1, 1)])), 1)

    async def test_hot_tiles_refresh_and_idle_tiles_do_not(self) -> None:
        clock, p = FakeClock(), FakeProvider()
        cache = cache_with(clock, provider=p, budget_rps=50.0, ttl_s=1.0, hot_window_s=5.0)
        await cache.request([(2, 2)])
        await run_for(cache, clock, 4.0)
        self.assertIn(
            p.calls.count((2, 2)), (4, 5)
        )  # the first fetch and one per second while hot (float steps)
        self.assertGreater(cache.entries([(2, 2)])[0].version, 1)
        before = len(p.calls)
        await run_for(cache, clock, 30.0)  # nobody looks any more: the hot window (5 s) has passed
        self.assertLessEqual(len(p.calls) - before, 3)  # at most what was still inside the window

    async def test_no_demand_means_no_upstream_traffic(self) -> None:
        clock, p = FakeClock(), FakeProvider()
        cache = cache_with(clock, provider=p, budget_rps=50.0, ttl_s=1.0, hot_window_s=5.0)
        await run_for(cache, clock, 60.0)
        self.assertEqual(p.calls, [])

    async def test_failure_keeps_stale_data_and_reports_status(self) -> None:
        clock, p = FakeClock(), FakeProvider()
        cache = cache_with(clock, provider=p, budget_rps=50.0, ttl_s=1.0, hot_window_s=60.0)
        await cache.request([(3, 3)])
        first = cache.entries([(3, 3)])[0]
        p.fail = UpstreamError("boom", 500)
        for _ in range(10):  # keep the tile hot while the source is down
            await cache.request([(3, 3)])
            await run_for(cache, clock, 2.0)
        self.assertIs(cache.entries([(3, 3)])[0], first)
        self.assertFalse(cache.status.ok)
        self.assertIn("boom", cache.status.last_error)
        self.assertGreaterEqual(cache.status.errors, 1)

    async def test_rate_limit_pauses_all_fetching(self) -> None:
        clock, p = FakeClock(), FakeProvider()
        p.fail = UpstreamError("slow down", 429, retry_after=30)
        cache = cache_with(clock, provider=p, budget_rps=50.0, ttl_s=1.0, hot_window_s=600.0)
        await cache.request([(4, 4)], cold_deadline_s=1)
        n = len(p.calls)
        await cache.request([(5, 5)], cold_deadline_s=0.5)
        await run_for(cache, clock, 20.0)  # still inside the 30 s Retry-After
        self.assertEqual(len(p.calls), n)  # paused: no new upstream requests
        await run_for(cache, clock, 15.0)
        self.assertGreater(len(p.calls), n)  # and it resumes afterwards

    async def test_budget_limits_request_rate(self) -> None:
        clock, p = FakeClock(), FakeProvider()
        cache = cache_with(clock, provider=p, budget_rps=5.0, ttl_s=0.05, hot_window_s=600.0)
        await cache.request([(x, 6) for x in range(30)], cold_deadline_s=0.0, focus=False)
        await run_for(cache, clock, 10.0)
        # burst of 4 plus 5 per second for 10 seconds, never more
        self.assertLessEqual(len(p.calls), 4 + 5 * 10 + 1)
        self.assertGreaterEqual(len(p.calls), 5 * 10 - 5)  # and the budget is really used

    async def test_listener_receives_updates(self) -> None:
        clock, p = FakeClock(), FakeProvider()
        cache = cache_with(clock, provider=p, budget_rps=50.0)
        seen: list[Tile] = []
        cache.listeners.append(lambda tile, _ac, _t: seen.append(tile))
        await cache.request([(7, 7)])
        self.assertEqual(seen, [(7, 7)])


class FocusPriorityTest(unittest.IsolatedAsyncioTestCase):
    async def test_world_viewer_does_not_starve_a_zoomed_in_viewer(self) -> None:
        clock, p = FakeClock(), FakeProvider()
        cache = cache_with(clock, provider=p, budget_rps=5.0, ttl_s=0.2, hot_window_s=5.0)
        await cache.request([(x, 20) for x in range(40)], cold_deadline_s=0.05, focus=False)
        await cache.request([(50, 30)], cold_deadline_s=1.0)
        before = p.calls.count((50, 30))
        for _ in range(6):  # both viewers keep polling
            await run_for(cache, clock, 0.5)
            await cache.request([(x, 20) for x in range(40)], cold_deadline_s=0.0, focus=False)
            await cache.request([(50, 30)], cold_deadline_s=0.0)
        # 41 tiles at 5 req/s would refresh each tile only every ~8 s without priority
        self.assertGreaterEqual(p.calls.count((50, 30)) - before, 5)
        wide_calls = sum(1 for t in p.calls if t[1] == 20)
        self.assertGreater(wide_calls, 3)  # wide views still get part of the budget


class AdaptiveRateTest(unittest.IsolatedAsyncioTestCase):
    async def test_sustained_rate_limits_lower_the_request_rate(self) -> None:
        clock, p = FakeClock(), FakeProvider()
        p.fail = UpstreamError("slow down", 429, retry_after=0.05)
        cache = cache_with(clock, provider=p, budget_rps=1.0, ttl_s=0.2, hot_window_s=5.0)
        for x in range(4):
            await cache.request([(8, x)], cold_deadline_s=1)
            clock.advance(0.1)
        self.assertLess(cache.snapshot_status()["current_rps"], 1.0)  # type: ignore[operator]

    async def test_a_single_429_does_not_slow_us_down(self) -> None:
        clock, p = FakeClock(), FakeProvider()
        p.fail = UpstreamError("slow down", 429, retry_after=0.05)
        cache = cache_with(clock, provider=p, budget_rps=1.0, ttl_s=0.2, hot_window_s=5.0)
        await cache.request([(8, 8)], cold_deadline_s=1)
        self.assertEqual(cache.snapshot_status()["current_rps"], 1.0)

    async def test_rate_recovers_with_time_not_request_count(self) -> None:
        clock = FakeClock()
        cache = cache_with(clock, provider=FakeProvider(), budget_rps=0.35)
        cache._bucket.rate = 0.08  # type: ignore[attr-defined]  # as after several 429s
        cache._last_rate_change = 0.0  # type: ignore[attr-defined]
        now = 1000.0
        for _ in range(20):  # 20 * 30 s = 10 minutes, whatever the number of requests
            now += 30.0
            cache._recover_rate(now)  # type: ignore[attr-defined]
        self.assertAlmostEqual(cache.snapshot_status()["current_rps"], 0.35)  # type: ignore[arg-type]
        cache._recover_rate(now + 1)  # type: ignore[attr-defined]
        self.assertLessEqual(cache._bucket.rate, 0.35)  # type: ignore[attr-defined]


class SparseProvider(FakeProvider):
    """Aircraft only in tiles whose x is below 10 (the 'real' traffic); everything else is open ocean."""

    async def fetch_tile(self, tile: Tile) -> list[Aircraft]:
        self.calls.append(tile)
        if tile[0] >= 10:
            return []
        return [Aircraft(hex=tile[0] * 100 + tile[1], lat=1.0, lon=1.0) for _ in range(1)]


class BudgetFloodTest(unittest.IsolatedAsyncioTestCase):
    REAL: ClassVar[list[Tile]] = [
        (x, y) for x in range(5) for y in range(4)
    ]  # 20 tiles somebody really watches

    async def _flood(
        self, cache: TileCache, clock: FakeClock, tiles_for: Callable[[int], Tile], minutes: int
    ) -> int:
        """Real viewer asks every 10 s; an attacker asks 216 narrow views per minute (3.6 per second).

        Returns how many times a real tile had no servable data when the viewer looked."""
        empty = 0
        n = 0
        for _ in range(0, 400, 10):  # the real viewer is there first: its tiles are loaded and known
            await cache.request(self.REAL, focus=True)
            await run_for(cache, clock, 10.0, step=0.25)
        for second in range(minutes * 60):
            if second % 10 == 0:
                await cache.request(self.REAL, focus=True)
                if len(cache.entries(self.REAL)) < len(self.REAL):
                    empty += 1
            for _ in range(4 if second % 5 else 3):  # about 3.6 per second
                n += 1
                await cache.request([tiles_for(n)], focus=True)
            await run_for(cache, clock, 1.0, step=0.25)
        return empty

    async def test_cold_tiles_outside_the_traffic_mask_cost_nothing(self) -> None:
        clock, p = FakeClock(), SparseProvider()
        mask = frozenset(self.REAL)
        cache = cache_with(
            clock,
            provider=p,
            budget_rps=0.15,
            ttl_s=10.0,
            hot_window_s=60.0,
            max_age_s=300.0,
            traffic_mask=mask,
        )
        lapses = await self._flood(cache, clock, lambda n: (20 + n % 50, 30 + n // 50), 8)
        self.assertEqual([t for t in p.calls if t not in mask], [])
        self.assertEqual(lapses, 0)
        # viewers may use 65 percent of the budget, so the same load shows as a 1.5 times longer interval
        self.assertLess(cache.snapshot_status()["effective_ttl_s"], 300)  # type: ignore[operator]

    async def test_cold_tiles_inside_the_mask_cannot_starve_real_ones(self) -> None:
        clock, p = FakeClock(), SparseProvider()
        ocean = [(20 + i % 40, 5 + i // 40) for i in range(2000)]  # in the mask, but nothing flies there
        cache = cache_with(
            clock,
            provider=p,
            budget_rps=0.15,
            ttl_s=10.0,
            hot_window_s=60.0,
            max_age_s=300.0,
            traffic_mask=frozenset(self.REAL) | frozenset(ocean),
        )
        lapses = await self._flood(cache, clock, lambda n: ocean[n % len(ocean)], 8)
        self.assertEqual(lapses, 0)
        real_calls = sum(1 for t in p.calls if t in set(self.REAL))
        self.assertGreater(real_calls, 100)  # the real tiles kept their share (about 20 per 200 s)

    async def test_usually_empty_hot_tiles_refresh_less_often_than_busy_ones(self) -> None:
        clock, p = FakeClock(), SparseProvider()
        cache = cache_with(
            clock, provider=p, budget_rps=50.0, ttl_s=1.0, hot_window_s=1000.0, max_age_s=900.0
        )
        busy, quiet = (1, 1), (30, 30)
        for _ in range(60):
            await cache.request([busy, quiet])
            await run_for(cache, clock, 5.0)
        self.assertGreater(p.calls.count(busy), 3 * p.calls.count(quiet))
        self.assertGreaterEqual(p.calls.count(quiet), 300 // 40)  # still looked at within max_age
