import unittest

from flightmap.providers.routes import is_plausible, parse_route, progress
from flightmap.reference import airline_for_callsign, search_airlines, type_name
from flightmap.upstream import UpstreamError

LOT45 = {
    "callsign": "LOT45", "number": "45", "airline_code": "LOT", "airport_codes": "EPWA-CYYZ",
    "_airports": [
        {"name": "Warsaw Chopin Airport", "icao": "EPWA", "iata": "WAW", "location": "Warsaw",
         "countryiso2": "PL", "lat": 52.165699, "lon": 20.9671, "alt_feet": 362.0},
        {"name": "Lester B. Pearson International Airport", "icao": "CYYZ", "iata": "YYZ",
         "location": "Toronto", "countryiso2": "CA", "lat": 43.6772, "lon": -79.6306, "alt_feet": 569.0},
    ],
}  # fmt: skip


class RouteTest(unittest.TestCase):
    def test_parses_the_standing_data_shape(self) -> None:
        r = parse_route(LOT45, "LOT45")
        assert r is not None
        self.assertEqual([a.icao for a in r.airports], ["EPWA", "CYYZ"])
        self.assertEqual(r.flight_number, "45")
        self.assertEqual(r.airports[0].city, "Warsaw")

    def test_missing_or_broken_routes(self) -> None:
        self.assertIsNone(parse_route({"_airports": []}, "X"))
        self.assertIsNone(parse_route({"_airports": [{"lat": "x"}, {"lat": 1, "lon": 1}]}, "X"))
        with self.assertRaises(UpstreamError):
            parse_route([], "X")

    def test_plausibility(self) -> None:
        r = parse_route(LOT45, "LOT45")
        assert r is not None
        self.assertTrue(is_plausible(r, 53.0, 5.0))  # over the North Sea, on the way
        self.assertFalse(is_plausible(r, -33.0, 151.0))  # Sydney is nowhere near

    def test_progress(self) -> None:
        r = parse_route(LOT45, "LOT45")
        assert r is not None
        self.assertAlmostEqual(progress(r, 52.1657, 20.9671) or 0, 0.0, places=2)
        self.assertAlmostEqual(progress(r, 43.6772, -79.6306) or 0, 1.0, places=2)
        mid = progress(r, 60.0, -20.0)
        assert mid is not None
        self.assertTrue(0.3 < mid < 0.8)


class ReferenceTest(unittest.TestCase):
    def test_airline_from_callsign(self) -> None:
        self.assertEqual(airline_for_callsign("LOT45"), ("LOT", "LOT Polish Airlines"))
        self.assertIsNone(airline_for_callsign("N123AB"))
        self.assertIsNone(airline_for_callsign(""))

    def test_type_names(self) -> None:
        self.assertIn("175", type_name("E75S") or "")
        self.assertIsNone(type_name("ZZZZ"))

    def test_airline_search(self) -> None:
        names = [n for _c, n in search_airlines("ryan")]
        self.assertIn("Ryanair", names)
        self.assertEqual(search_airlines("r"), [])

    def test_exact_airline_code_ranks_first(self) -> None:
        self.assertEqual(search_airlines("baw")[0], ("BAW", "British Airways"))
        self.assertEqual(search_airlines("lot")[0][0], "LOT")
