import json
import unittest

from flightmap.airports import load_catalog
from flightmap.index import AircraftIndex
from flightmap.models import Aircraft
from flightmap.providers.weather import parse_metar
from flightmap.search import nearby_aircraft, search_aircraft, search_all


def make_index() -> AircraftIndex:
    idx = AircraftIndex()
    idx.update(
        (40, 28),
        [
            Aircraft(
                hex=0x48AE23,
                lat=52.2,
                lon=19.8,
                callsign="LOT45",
                registration="SP-LSD",
                type_code="B789",
                altitude_ft=36000,
            ),
            Aircraft(
                hex=0x471FA7,
                lat=52.1,
                lon=19.4,
                callsign="WZZ2706",
                registration="HA-LZR",
                type_code="A21N",
                altitude_ft=36000,
            ),
            Aircraft(
                hex=0x4AA000, lat=52.17, lon=20.97, callsign="RYR12AB", registration="EI-ABC", on_ground=True
            ),
            Aircraft(
                hex=0x4AA001, lat=52.2, lon=21.1, callsign="LOT3", altitude_ft=1500, vertical_rate_fpm=-800
            ),
            Aircraft(
                hex=0x4AA002, lat=52.1, lon=20.9, callsign="LOT9", altitude_ft=2200, vertical_rate_fpm=1500
            ),
            Aircraft(
                hex=0x4AA003, lat=52.18, lon=20.95, callsign="LOT7", altitude_ft=35000, vertical_rate_fpm=0
            ),
        ],
        1000.0,
    )
    return idx


class AircraftSearchTest(unittest.TestCase):
    def test_exact_and_prefix_matches_rank_first(self) -> None:
        idx = make_index()
        self.assertEqual(search_aircraft(idx, "lot45")[0]["callsign"], "LOT45")
        self.assertEqual([r["callsign"] for r in search_aircraft(idx, "LOT")][:2], ["LOT3", "LOT45"])
        self.assertEqual(search_aircraft(idx, "sp-lsd")[0]["hex"], "48ae23")
        self.assertEqual(search_aircraft(idx, "SPLSD")[0]["hex"], "48ae23")
        self.assertEqual(search_aircraft(idx, "471fa7")[0]["callsign"], "WZZ2706")
        self.assertEqual(search_aircraft(idx, "4aa0")[0]["kind"], "aircraft")

    def test_short_or_unmatched_queries(self) -> None:
        idx = make_index()
        self.assertEqual(search_aircraft(idx, "x"), [])
        self.assertEqual(search_aircraft(idx, "nothing-here"), [])

    def test_search_all_groups_results(self) -> None:
        res = search_all(make_index(), load_catalog(), "lot")
        self.assertTrue(res["aircraft"])
        self.assertTrue(
            any(a["name"] == "LOT Polish Airlines" and a["aircraft"] == 4 for a in res["airlines"])
        )
        self.assertEqual(search_all(make_index(), load_catalog(), "warsaw")["airports"][0]["icao"], "EPWA")


class AirportCatalogTest(unittest.TestCase):
    def test_lookup_by_icao_and_iata(self) -> None:
        c = load_catalog()
        self.assertEqual(c.get("epwa").name, "Warsaw Chopin Airport")  # type: ignore[union-attr]
        self.assertEqual(c.get("WAW").icao, "EPWA")  # type: ignore[union-attr]
        self.assertIsNone(c.get("ZZZZ"))

    def test_search_prefers_exact_codes_and_big_airports(self) -> None:
        c = load_catalog()
        self.assertEqual(c.search("EGLL")[0].icao, "EGLL")
        self.assertEqual(c.search("LHR")[0].icao, "EGLL")
        self.assertEqual(c.search("heathrow")[0].icao, "EGLL")
        self.assertEqual(c.search("x"), [])

    def test_map_catalog_is_compact_and_scheduled_only(self) -> None:
        rows = json.loads(load_catalog().map_catalog())
        self.assertGreater(len(rows), 2500)
        self.assertLess(len(rows), 5000)
        self.assertEqual(len(rows[0]), 6)
        self.assertTrue(all(r[5] in ("L", "M") for r in rows))


class NearbyTest(unittest.TestCase):
    def test_infers_arriving_departing_and_ground_traffic(self) -> None:
        epwa = load_catalog().get("EPWA")
        assert epwa is not None
        got = {r["callsign"]: r for r in nearby_aircraft(make_index(), epwa)}
        self.assertEqual(got["RYR12AB"]["state"], "ground")
        self.assertEqual(got["LOT3"]["state"], "arriving")
        self.assertEqual(got["LOT9"]["state"], "departing")
        self.assertNotIn("LOT7", got)  # cruising overhead is not airport traffic
        self.assertNotIn("LOT45", got)  # too far away
        self.assertLessEqual(got["RYR12AB"]["distance_nm"], 10)


ITEM = {
    "icaoId": "EPWA", "obsTime": 1791907200, "temp": 10, "dewp": 7, "wdir": "VRB", "wspd": 2, "visib": "6+",
    "altim": 1026, "rawOb": "METAR EPWA 131600Z VRB02KT 9999 FEW020 BKN044 10/07 Q1026 NOSIG",
    "clouds": [{"cover": "FEW", "base": 2000}, {"cover": "BKN", "base": 4400}], "fltCat": "VFR",
}  # fmt: skip


class MetarTest(unittest.TestCase):
    def test_parses_the_aviation_weather_shape(self) -> None:
        m = parse_metar(ITEM)
        assert m is not None
        self.assertTrue(m.wind_variable)
        self.assertIsNone(m.wind_dir)
        self.assertEqual((m.wind_kt, m.temp_c, m.dewpoint_c, m.qnh_hpa), (2.0, 10.0, 7.0, 1026.0))
        self.assertTrue(m.visibility_plus)
        self.assertEqual(m.visibility_m, 9656)
        self.assertEqual(m.clouds[1], {"cover": "BKN", "base_ft": 4400.0})
        self.assertEqual(m.flight_category, "VFR")

    def test_numeric_wind_and_missing_fields(self) -> None:
        m = parse_metar({**ITEM, "wdir": 30, "visib": 3, "clouds": None})
        assert m is not None
        self.assertEqual(
            (m.wind_dir, m.wind_variable, m.visibility_plus, m.visibility_m, m.clouds),
            (30, False, False, 4828, []),
        )
        self.assertIsNone(parse_metar({"icaoId": "X"}))
