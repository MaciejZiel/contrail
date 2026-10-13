import json
import unittest

from flightmap.airports import load_catalog
from flightmap.index import AircraftIndex
from flightmap.models import Aircraft
from flightmap.providers.weather import parse_metar
from flightmap.search import nearby_aircraft, nearby_traffic, search_aircraft, search_all


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


class NearbyKnownRouteTest(unittest.TestCase):
    def test_a_cached_route_settles_the_state_and_adds_the_endpoints(self) -> None:
        epwa = load_catalog().get("EPWA")
        assert epwa is not None
        routes = {"LOT3": ("EGLL", "EPWA"), "LOT9": ("EPWA", "LFPG"), "WZZ2706": ("EPWA", "EGSS")}
        got = {r["callsign"]: r for r in nearby_aircraft(make_index(), epwa, known_route=routes.get)}
        self.assertEqual((got["LOT3"]["origin"], got["LOT3"]["destination"]), ("EGLL", "EPWA"))
        self.assertEqual(got["LOT9"]["state"], "departing")
        self.assertEqual(got["RYR12AB"]["state"], "ground")
        self.assertNotIn("origin", got["RYR12AB"])

    def test_a_route_to_this_airport_turns_a_level_flight_into_an_arrival(self) -> None:
        epwa = load_catalog().get("EPWA")
        assert epwa is not None
        got = {r["callsign"]: r for r in nearby_aircraft(make_index(), epwa)}
        self.assertEqual(got["LOT3"]["state"], "arriving")  # from the vertical rate alone
        routes = {"LOT3": ("EPWA", "EPKK")}
        got = {r["callsign"]: r for r in nearby_aircraft(make_index(), epwa, known_route=routes.get)}
        self.assertEqual(got["LOT3"]["state"], "departing")  # a known route wins over the vertical rate

    def test_a_return_route_keeps_the_vertical_rate_state(self) -> None:
        epwa = load_catalog().get("EPWA")
        assert epwa is not None
        routes = {"LOT9": ("EPWA", "EPWA"), "LOT3": ("EPWA", "EPWA")}  # out and straight back
        got = {r["callsign"]: r for r in nearby_aircraft(make_index(), epwa, known_route=routes.get)}
        self.assertEqual((got["LOT9"]["state"], got["LOT3"]["state"]), ("departing", "arriving"))

    def test_counts_cover_every_aircraft_not_just_the_nearest_ones(self) -> None:
        epwa = load_catalog().get("EPWA")
        assert epwa is not None
        idx = AircraftIndex()
        idx.update(
            (40, 28),
            [
                Aircraft(
                    hex=0x500000 + i, lat=epwa.lat + 0.001 * i, lon=epwa.lon, callsign=f"X{i}", on_ground=True
                )
                for i in range(60)
            ],
            1000.0,
        )
        items, counts = nearby_traffic(idx, epwa)
        self.assertEqual(len(items), 40)
        self.assertEqual(counts["ground"], 60)


class AirportDetailsTest(unittest.TestCase):
    def test_frankfurt_has_runways_frequencies_and_links(self) -> None:
        from flightmap.airports import airport_details

        rec = load_catalog().get("EDDF")
        assert rec is not None
        d = airport_details(rec)
        self.assertEqual(d["type"], "Large airport")
        self.assertTrue(d["scheduled_service"])
        self.assertEqual(d["region"], "DE-HE")
        self.assertGreaterEqual(len(d["runways"]), 3)
        self.assertEqual(d["runways"][0]["length_ft"], max(r["length_ft"] for r in d["runways"]))
        self.assertTrue(any(f["type"] == "TWR" for f in d["frequencies"]))
        self.assertTrue(d["wikipedia"].startswith("https://"))

    def test_an_airport_without_details_still_answers(self) -> None:
        from flightmap.airports import AirportRec, airport_details

        rec = AirportRec("ZZZZ", "", "Nowhere", 0.0, 0.0, None, "S", "XX", "", False)
        d = airport_details(rec)
        self.assertEqual((d["runways"], d["frequencies"], d["wikipedia"]), ([], [], ""))
