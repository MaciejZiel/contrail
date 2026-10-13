import unittest

from flightmap import tiles


class TileMathTest(unittest.TestCase):
    def test_tile_of_and_bounds_round_trip(self) -> None:
        t = tiles.tile_of(52.23, 21.01)
        b = tiles.bounds_of(t)
        self.assertTrue(b.contains(52.23, 21.01))
        self.assertEqual(t, (40, 28))

    def test_edges(self) -> None:
        self.assertEqual(tiles.tile_of(-90, -180), (0, 0))
        self.assertEqual(tiles.tile_of(90, 180), (0, 35))  # lon 180 wraps, lat 90 clamps
        self.assertEqual(tiles.tile_of(0, 190), tiles.tile_of(0, -170))

    def test_query_radius_covers_corners_within_limit(self) -> None:
        for tx in range(tiles.COLS):
            for ty in range(tiles.ROWS):
                r = tiles.query_radius_nm((tx, ty))
                self.assertLessEqual(r, 250)
                self.assertGreater(r, 100)

    def test_rect_wraps_antimeridian(self) -> None:
        got = tiles.tiles_in_rect(70, 20, 1, 21)
        self.assertEqual({x for x, _ in got}, {70, 71, 0, 1})
        self.assertEqual(len(got), 8)

    def test_rect_clamps_rows(self) -> None:
        got = tiles.tiles_in_rect(0, -5, 0, 100)
        self.assertEqual(len(got), tiles.ROWS)

    def test_parse_tile_id(self) -> None:
        self.assertEqual(tiles.parse_tile_id("40_28"), (40, 28))
        with self.assertRaises(ValueError):
            tiles.parse_tile_id("99_1")
