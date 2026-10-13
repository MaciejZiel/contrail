import asyncio
import unittest

from flightmap.enrich import EnrichmentCache
from flightmap.upstream import UpstreamError


class EnrichmentCacheTest(unittest.IsolatedAsyncioTestCase):
    async def test_caches_values_including_none(self) -> None:
        calls = 0

        async def loader() -> None:
            nonlocal calls
            calls += 1

        c = EnrichmentCache(ttl_s=60)
        self.assertIsNone(await c.get("k", loader))
        self.assertIsNone(await c.get("k", loader))
        self.assertEqual(calls, 1)

    async def test_single_flight(self) -> None:
        calls = 0

        async def loader() -> int:
            nonlocal calls
            calls += 1
            await asyncio.sleep(0.05)
            return 7

        c = EnrichmentCache(ttl_s=60)
        got = await asyncio.gather(*(c.get("k", loader) for _ in range(10)))
        self.assertEqual(got, [7] * 10)
        self.assertEqual(calls, 1)

    async def test_failures_are_negative_cached_and_trip_the_breaker(self) -> None:
        calls = 0

        async def boom() -> int:
            nonlocal calls
            calls += 1
            raise UpstreamError("down", 500)

        c = EnrichmentCache(ttl_s=60, neg_ttl_s=60, breaker_threshold=3, breaker_pause_s=60)
        for _ in range(2):
            with self.assertRaises(UpstreamError):
                await c.get("same", boom)
        self.assertEqual(calls, 1)  # second call came from the negative cache
        for key in ("a", "b"):
            with self.assertRaises(UpstreamError):
                await c.get(key, boom)
        self.assertTrue(c.open)
        before = calls
        with self.assertRaises(UpstreamError):
            await c.get("fresh", boom)
        self.assertEqual(calls, before)  # short-circuited

    async def test_timeout_becomes_an_upstream_error(self) -> None:
        async def slow() -> int:
            await asyncio.sleep(5)
            return 1

        c = EnrichmentCache(ttl_s=60, timeout_s=0.05)
        with self.assertRaises(UpstreamError):
            await c.get("k", slow)
