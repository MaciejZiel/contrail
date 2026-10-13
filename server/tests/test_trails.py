import asyncio
import os
import tempfile
import unittest

from flightmap.models import Aircraft
from flightmap.trails import TrailStore


def ac(
    hex_: int = 1, lat: float = 50.0, lon: float = 10.0, alt: int | None = 30000, on_ground: bool = False
) -> Aircraft:
    return Aircraft(
        hex=hex_,
        lat=lat,
        lon=lon,
        altitude_ft=alt,
        ground_speed_kt=450.0,
        vertical_rate_fpm=0,
        on_ground=on_ground,
    )


class TrailStoreTest(unittest.TestCase):
    def test_spacing_and_snapshot(self) -> None:
        s = TrailStore(retention_s=1000, min_interval_s=10)
        self.assertTrue(s.record(ac(), 100.0, 100.0))
        self.assertFalse(s.record(ac(), 105.0, 105.0))  # too soon
        self.assertTrue(s.record(ac(lat=50.1), 111.0, 111.0))
        snap = s.snapshot(1)
        assert snap is not None
        self.assertEqual(snap["t"], [100.0, 111.0])
        self.assertEqual(snap["lat"], [50.0, 50.1])
        self.assertEqual(snap["alt"], [30000, 30000])
        self.assertEqual(snap["gs"], [450.0, 450.0])
        self.assertIsNone(s.snapshot(99))

    def test_unknown_values_round_trip_as_none(self) -> None:
        s = TrailStore()
        s.record(Aircraft(hex=2, lat=1, lon=1), 10.0, 10.0)
        snap = s.snapshot(2)
        assert snap is not None
        self.assertEqual((snap["alt"], snap["gs"], snap["vr"]), ([None], [None], [None]))

    def test_retention_trims_old_points(self) -> None:
        s = TrailStore(retention_s=100, min_interval_s=1)
        for i in range(200):
            s.record(ac(), float(i), float(i))
        snap = s.snapshot(1)
        assert snap is not None
        self.assertGreaterEqual(snap["t"][0], 199 - 100 - 24)
        self.assertLessEqual(len(snap["t"]), 130)
        self.assertEqual(s.points, len(snap["t"]))

    def test_ground_traffic_is_sampled_slowly(self) -> None:
        s = TrailStore(min_interval_s=10)
        self.assertTrue(s.record(ac(on_ground=True), 0.0, 0.0))
        self.assertFalse(s.record(ac(on_ground=True), 30.0, 30.0))
        self.assertTrue(s.record(ac(on_ground=True), 61.0, 61.0))

    def test_sweep_forgets_silent_aircraft(self) -> None:
        s = TrailStore(retention_s=100)
        s.record(ac(1), 0.0, 0.0)
        s.record(ac(2), 90.0, 90.0)
        s.sweep(now=150.0)
        self.assertIsNone(s.snapshot(1))
        self.assertIsNotNone(s.snapshot(2))
        self.assertEqual(len(s), 1)

    def test_tile_listener_uses_the_position_time(self) -> None:
        s = TrailStore()
        s.on_tile_update((0, 0), [Aircraft(hex=3, lat=1, lon=1, position_age_s=4.0)], 100.0)
        snap = s.snapshot(3)
        assert snap is not None
        self.assertEqual(snap["t"], [96.0])


class TrailPersistenceTest(unittest.IsolatedAsyncioTestCase):
    async def test_survives_a_restart_and_stays_bounded(self) -> None:
        import time

        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, "t.sqlite3")
            now = time.time()
            first = TrailStore(retention_s=600, min_interval_s=1, db_path=path)
            await first.start()
            first.record(ac(7, lat=50.0), now - 300, now)
            first.record(ac(7, lat=50.5), now - 100, now)
            first.record(ac(8, lat=1.0), now - 5000, now)  # far outside the window
            await first.stop()

            second = TrailStore(retention_s=600, min_interval_s=1, db_path=path)
            await second.start()
            snap = second.snapshot(7)
            assert snap is not None
            self.assertEqual(snap["lat"], [50.0, 50.5])
            self.assertIsNone(second.snapshot(8))
            await asyncio.sleep(0)
            await second.stop()
