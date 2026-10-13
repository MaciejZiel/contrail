import unittest

from flightmap.models import Category
from flightmap.providers.adsblol import parse_aircraft, parse_point_response
from flightmap.upstream import UpstreamError

REAL_SHAPE = {
    "hex": "48ad08", "type": "adsb_icao", "flight": "LOT3923 ", "r": "SP-LII", "t": "E75S",
    "alt_baro": 12625, "alt_geom": 13025, "gs": 348.5, "track": 197.71, "baro_rate": 2048,
    "squawk": "1000", "category": "A3", "lat": 51.891593, "lon": 20.617218, "seen_pos": 0.184,
    "dbFlags": 0, "emergency": "none",
}  # fmt: skip


class ParseTest(unittest.TestCase):
    def test_full_record(self) -> None:
        a = parse_aircraft(REAL_SHAPE)
        assert a is not None
        self.assertEqual(a.hex_str, "48ad08")
        self.assertEqual(a.callsign, "LOT3923")
        self.assertEqual(a.registration, "SP-LII")
        self.assertEqual(a.type_code, "E75S")
        self.assertEqual(a.altitude_ft, 12625)
        self.assertEqual(a.category, Category.JET)
        self.assertFalse(a.on_ground or a.military or a.non_adsb or a.emergency)
        self.assertEqual(a.vertical_rate_fpm, 2048)

    def test_ground_and_helicopter(self) -> None:
        a = parse_aircraft({**REAL_SHAPE, "alt_baro": "ground", "category": "A7"})
        assert a is not None
        self.assertTrue(a.on_ground)
        self.assertIsNone(a.altitude_ft)
        self.assertEqual(a.category, Category.ROTORCRAFT)

    def test_flags(self) -> None:
        a = parse_aircraft({**REAL_SHAPE, "dbFlags": 1, "type": "mlat", "squawk": "7700"})
        assert a is not None
        self.assertTrue(a.military and a.non_adsb and a.emergency)

    def test_rejects_unusable(self) -> None:
        self.assertIsNone(parse_aircraft({"hex": "48ad08"}))  # no position
        self.assertIsNone(parse_aircraft({**REAL_SHAPE, "hex": "zzzz"}))
        self.assertIsNone(parse_aircraft({**REAL_SHAPE, "lat": 95.0}))
        self.assertIsNone(parse_aircraft({**REAL_SHAPE, "lat": "51"}))

    def test_tisb_hex_prefix(self) -> None:
        a = parse_aircraft({**REAL_SHAPE, "hex": "~48ad08"})
        assert a is not None
        self.assertEqual(a.hex, 0x48AD08)

    def test_response_dedupes_and_validates(self) -> None:
        got = parse_point_response({"ac": [REAL_SHAPE, REAL_SHAPE, {"hex": "bad"}]})
        self.assertEqual(len(got), 1)
        with self.assertRaises(UpstreamError):
            parse_point_response({"nope": 1})
        with self.assertRaises(UpstreamError):
            parse_point_response([])
