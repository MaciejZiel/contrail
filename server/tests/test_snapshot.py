"""The tile cache survives a restart: it is written to disk and restored with its real age."""

import os
import tempfile
import unittest
from pathlib import Path

from flightmap.tilecache import TileCache

from .clock import FakeClock, cache_with
from .test_tilecache import FakeProvider


def _write_junk(path: str) -> None:
    Path(path).write_bytes(b"not gzip at all")


def _cache(clock: FakeClock, ghost_age_s: float = 600.0) -> TileCache:
    return cache_with(
        clock, provider=FakeProvider(), budget_rps=50.0, ttl_s=1.0, hot_window_s=5.0, ghost_age_s=ghost_age_s
    )


class SnapshotTest(unittest.IsolatedAsyncioTestCase):
    async def test_round_trip_keeps_aircraft_and_age(self) -> None:
        clock = FakeClock()
        first = _cache(clock)
        await first.request([(3, 4), (5, 6)])
        wall = first._wall()  # pyright: ignore[reportPrivateUsage]
        with tempfile.TemporaryDirectory() as d:
            path = os.path.join(d, "tiles.json.gz")
            self.assertEqual(first.save_snapshot(path), 2)
            clock.advance(30.0)  # the restart takes a while
            second = _cache(clock)
            restored = second.load_snapshot(path)
        self.assertEqual({t for t, _, _ in restored}, {(3, 4), (5, 6)})
        entries = {e.tile: e for e in second.entries([(3, 4), (5, 6)])}
        self.assertEqual(len(entries), 2)
        self.assertEqual(entries[(3, 4)].aircraft[0].hex, 3 * 100 + 4)
        self.assertAlmostEqual(
            entries[(3, 4)].fetched_at, wall, places=3
        )  # served with its real age, not as new

    async def test_tiles_older_than_the_ghost_age_are_not_restored(self) -> None:
        clock = FakeClock()
        first = _cache(clock)
        await first.request([(1, 1)])
        with tempfile.TemporaryDirectory() as d:
            path = os.path.join(d, "tiles.json.gz")
            first.save_snapshot(path)
            clock.advance(3600.0)
            self.assertEqual(_cache(clock).load_snapshot(path), [])

    async def test_missing_or_damaged_files_are_ignored(self) -> None:
        clock = FakeClock()
        with tempfile.TemporaryDirectory() as d:
            self.assertEqual(_cache(clock).load_snapshot(os.path.join(d, "none.json.gz")), [])
            bad = os.path.join(d, "bad.json.gz")
            _write_junk(bad)
            self.assertEqual(_cache(clock).load_snapshot(bad), [])


if __name__ == "__main__":
    unittest.main()
