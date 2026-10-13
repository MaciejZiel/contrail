import asyncio
import unittest

from flightmap.models import Aircraft
from flightmap.tilecache import TileCache
from flightmap.tiles import Tile
from flightmap.upstream import UpstreamError


class FakeProvider:
    name = "fake"
    source_id = 9

    def __init__(self) -> None:
        self.calls: list[Tile] = []
        self.fail: UpstreamError | None = None
        self.delay = 0.0

    async def fetch_tile(self, tile: Tile) -> list[Aircraft]:
        self.calls.append(tile)
        if self.delay:
            await asyncio.sleep(self.delay)
        if self.fail:
            raise self.fail
        return [Aircraft(hex=tile[0] * 100 + tile[1], lat=1.0, lon=1.0)]


def make(provider: FakeProvider, budget_rps: float = 50.0, ttl_s: float = 0.2) -> TileCache:
    return TileCache(provider=provider, budget_rps=budget_rps, ttl_s=ttl_s, hot_window_s=5.0)


class TileCacheTest(unittest.IsolatedAsyncioTestCase):
    async def test_concurrent_viewers_share_one_upstream_call(self) -> None:
        p = FakeProvider()
        p.delay = 0.05
        cache = make(p)
        cache.start()
        try:
            await asyncio.gather(*(cache.request([(1, 1)]) for _ in range(20)))
            self.assertEqual(p.calls.count((1, 1)), 1)
            self.assertEqual(len(cache.entries([(1, 1)])), 1)
        finally:
            await cache.stop()

    async def test_hot_tiles_refresh_and_idle_tiles_do_not(self) -> None:
        p = FakeProvider()
        cache = make(p, ttl_s=0.1)
        cache.start()
        try:
            await cache.request([(2, 2)])
            await asyncio.sleep(1.0)
            hot_calls = len(p.calls)
            self.assertGreaterEqual(hot_calls, 2)
            self.assertGreater(cache.entries([(2, 2)])[0].version, 1)
        finally:
            await cache.stop()

    async def test_no_demand_means_no_upstream_traffic(self) -> None:
        p = FakeProvider()
        cache = make(p)
        cache.start()
        try:
            await asyncio.sleep(0.5)
            self.assertEqual(p.calls, [])
        finally:
            await cache.stop()

    async def test_failure_keeps_stale_data_and_reports_status(self) -> None:
        p = FakeProvider()
        cache = make(p, ttl_s=0.1)
        cache.start()
        try:
            await cache.request([(3, 3)])
            first = cache.entries([(3, 3)])[0]
            p.fail = UpstreamError("boom", 500)
            await asyncio.sleep(0.6)
            self.assertIs(cache.entries([(3, 3)])[0], first)
            self.assertFalse(cache.status.ok)
            self.assertIn("boom", cache.status.last_error)
            self.assertGreaterEqual(cache.status.errors, 1)
        finally:
            await cache.stop()

    async def test_rate_limit_pauses_all_fetching(self) -> None:
        p = FakeProvider()
        p.fail = UpstreamError("slow down", 429, retry_after=30)
        cache = make(p)
        cache.start()
        try:
            await cache.request([(4, 4)], cold_deadline_s=1)
            n = len(p.calls)
            await cache.request([(5, 5)], cold_deadline_s=0.5)
            self.assertEqual(len(p.calls), n)  # paused: no new upstream requests
        finally:
            await cache.stop()

    async def test_budget_limits_request_rate(self) -> None:
        p = FakeProvider()
        cache = make(p, budget_rps=5.0, ttl_s=0.05)
        cache.start()
        try:
            await cache.request([(x, 6) for x in range(30)], cold_deadline_s=0.1)
            await asyncio.sleep(1.0)
            # burst 2 + 5/s for ~1.1 s
            self.assertLessEqual(len(p.calls), 10)
        finally:
            await cache.stop()

    async def test_listener_receives_updates(self) -> None:
        p = FakeProvider()
        cache = make(p)
        seen: list[Tile] = []
        cache.listeners.append(lambda tile, _ac, _t: seen.append(tile))
        cache.start()
        try:
            await cache.request([(7, 7)])
            self.assertEqual(seen, [(7, 7)])
        finally:
            await cache.stop()


class AdaptiveRateTest(unittest.IsolatedAsyncioTestCase):
    async def test_rate_limit_lowers_the_request_rate(self) -> None:
        p = FakeProvider()
        p.fail = UpstreamError("slow down", 429, retry_after=1)
        cache = make(p, budget_rps=1.0)
        cache.start()
        try:
            await cache.request([(8, 8)], cold_deadline_s=1)
            self.assertLess(cache.snapshot_status()["current_rps"], 1.0)  # type: ignore[operator]
        finally:
            await cache.stop()
