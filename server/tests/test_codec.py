import unittest

from flightmap import codec
from flightmap.models import Aircraft, Category


def sample() -> Aircraft:
    return Aircraft(
        hex=0x48AD08,
        lat=51.891593,
        lon=-20.617218,
        callsign="LOT3923",
        category=Category.JET,
        altitude_ft=12625,
        ground_speed_kt=348.5,
        track_deg=197.7,
        vertical_rate_fpm=2048,
        squawk=7700,
        military=True,
        emergency=True,
        position_age_s=0.4,
    )


class CodecTest(unittest.TestCase):
    def test_record_size(self) -> None:
        self.assertEqual(codec.RECORD_SIZE, 32)
        self.assertEqual(len(codec.encode_aircraft([sample(), sample()])), 64)

    def test_round_trip_quantisation(self) -> None:
        got = codec.decode_records(codec.encode_aircraft([sample()]))[0]
        a = sample()
        self.assertEqual(got.hex, a.hex)
        self.assertAlmostEqual(got.lat, a.lat, places=5)
        self.assertAlmostEqual(got.lon, a.lon, places=5)
        self.assertEqual(got.callsign, "LOT3923")
        self.assertEqual(got.altitude_ft, 12625)
        self.assertAlmostEqual(got.ground_speed_kt or 0, 348.5, places=1)
        self.assertAlmostEqual(got.track_deg or 0, 197.7, places=1)
        self.assertEqual(got.vertical_rate_fpm, 2048)
        self.assertEqual(got.squawk, 7700)
        self.assertTrue(got.military and got.emergency and not got.on_ground)

    def test_unknown_and_ground(self) -> None:
        a = Aircraft(hex=1, lat=0, lon=0, on_ground=True)
        got = codec.decode_records(codec.encode_aircraft([a]))[0]
        self.assertIsNone(got.altitude_ft)
        self.assertIsNone(got.track_deg)
        self.assertIsNone(got.ground_speed_kt)
        self.assertIsNone(got.vertical_rate_fpm)
        self.assertTrue(got.on_ground)

    def test_extremes_are_clamped(self) -> None:
        a = Aircraft(hex=0xFFFFFF, lat=90, lon=-180, altitude_ft=-1500, ground_speed_kt=9999,
                     vertical_rate_fpm=-9000, track_deg=359.96, position_age_s=900)  # fmt: skip
        got = codec.decode_records(codec.encode_aircraft([a]))[0]
        self.assertEqual(got.hex, 0xFFFFFF)
        self.assertEqual(got.altitude_ft, -1500)
        self.assertEqual(got.position_age_s, 255)
        self.assertEqual(got.track_deg, 0.0)

    def test_long_callsign_truncated(self) -> None:
        a = Aircraft(hex=2, lat=1, lon=1, callsign="ABCDEFGHIJK")
        self.assertEqual(codec.decode_records(codec.encode_aircraft([a]))[0].callsign, "ABCDEFGH")

    def test_response_round_trip(self) -> None:
        payload = codec.encode_aircraft([sample()])
        data = codec.encode_response(123456, [(40, 28, 1000, 1, codec.SOURCE_ADSBLOL, payload)])
        now, tiles = codec.decode_response(data)
        self.assertEqual(now, 123456)
        self.assertEqual((tiles[0].tx, tiles[0].ty, tiles[0].fetched_at_ms), (40, 28, 1000))
        self.assertEqual(tiles[0].aircraft[0].hex, 0x48AD08)

    def test_bad_input(self) -> None:
        with self.assertRaises(ValueError):
            codec.decode_response(b"XXXX" + bytes(12))
        with self.assertRaises(ValueError):
            codec.decode_records(bytes(31))
