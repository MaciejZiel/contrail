"""Search over the aircraft we currently track, the airport catalog and airline names."""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

from .airports import AirportCatalog, AirportRec, distance_nm
from .index import AircraftIndex
from .reference import airline_for_callsign, search_airlines

NEARBY_RADIUS_NM = 10.0


def aircraft_item(a: Any) -> dict[str, Any]:
    airline = airline_for_callsign(a.callsign)
    return {
        "kind": "aircraft",
        "hex": a.hex_str,
        "callsign": a.callsign,
        "registration": a.registration,
        "type_code": a.type_code,
        "airline": airline[1] if airline else None,
        "lat": a.lat,
        "lon": a.lon,
        "altitude_ft": a.altitude_ft,
        "on_ground": a.on_ground,
    }


def search_aircraft(index: AircraftIndex, query: str, limit: int = 8) -> list[dict[str, Any]]:
    up = query.strip().upper().replace(" ", "")
    if len(up) < 2:
        return []
    reg_q = up.replace("-", "")
    hex_q = up.lower()
    scored: list[tuple[int, str, Any]] = []
    for a, _t in index.values():
        cs = a.callsign.upper()
        reg = a.registration.upper().replace("-", "")
        score: int | None = None
        if up == cs or reg_q == reg or (len(hex_q) == 6 and hex_q == a.hex_str):
            score = 0
        elif (
            (cs and cs.startswith(up))
            or (reg and reg.startswith(reg_q))
            or (len(hex_q) >= 4 and a.hex_str.startswith(hex_q))
        ):
            score = 1
        elif len(up) >= 3 and cs and up in cs:
            score = 2
        if score is not None:
            scored.append((score, cs or reg, a))
    scored.sort(key=lambda it: (it[0], it[1]))
    return [aircraft_item(a) for _s, _k, a in scored[:limit]]


def search_all(
    index: AircraftIndex, catalog: AirportCatalog, query: str, limits: tuple[int, int, int] = (8, 5, 4)
) -> dict[str, Any]:
    aircraft = search_aircraft(index, query, limits[0])
    airports = [{"kind": "airport", **a.as_dict()} for a in catalog.search(query, limits[1])]
    airlines: list[dict[str, Any]] = []
    matches = search_airlines(query, limits[2])
    if matches:
        wanted = {code for code, _n in matches}
        counts = dict.fromkeys(wanted, 0)
        for a, _t in index.values():
            al = airline_for_callsign(a.callsign)
            if al and al[0] in wanted:
                counts[al[0]] += 1
        airlines = [
            {"kind": "airline", "code": code, "name": name, "aircraft": counts[code]}
            for code, name in matches
        ]
    return {"aircraft": aircraft, "airports": airports, "airlines": airlines}


def nearby_traffic(
    index: AircraftIndex,
    airport: AirportRec,
    radius_nm: float = NEARBY_RADIUS_NM,
    limit: int = 40,
    known_route: Callable[[str], tuple[str, str] | None] | None = None,
) -> tuple[list[dict[str, Any]], dict[str, int]]:
    """Aircraft on the ground at or low around an airport, with an inferred arriving/departing state.

    Returns the ``limit`` nearest and the counts per state over *all* of them, so a busy airport is
    not undercounted by the cut.

    ``known_route(callsign)`` may return the (origin, destination) ICAO codes of a route that is
    already cached; it must not cause a lookup. A known route to or from this airport settles the
    state of an airborne aircraft; without one the state comes from the vertical rate alone.
    """
    elev = airport.elevation_ft or 0
    dlat = radius_nm / 60.0
    out: list[tuple[float, dict[str, Any]]] = []
    counts = dict.fromkeys(("arriving", "departing", "ground", "nearby"), 0)
    for a, _t in index.values():
        if abs(a.lat - airport.lat) > dlat:
            continue
        d = distance_nm(airport.lat, airport.lon, a.lat, a.lon)
        if d > radius_nm:
            continue
        agl = None if a.altitude_ft is None else a.altitude_ft - elev
        vr = a.vertical_rate_fpm or 0
        if a.on_ground:
            state = "ground"
        elif agl is None or agl > 8000:
            continue
        elif vr <= -300:
            state = "arriving"
        elif vr >= 300:
            state = "departing"
        else:
            state = "nearby"
        route = known_route(a.callsign) if known_route and a.callsign and not a.on_ground else None
        # a return route (A to B to A) says nothing about which leg this is: keep the vertical-rate state
        if route and state != "ground" and route[0] != route[1]:
            if route[1] == airport.icao:
                state = "arriving"
            elif route[0] == airport.icao:
                state = "departing"
        item = aircraft_item(a)
        if route:
            item.update({"origin": route[0], "destination": route[1]})
        item.update({"state": state, "distance_nm": round(d, 1), "vertical_rate_fpm": a.vertical_rate_fpm})
        counts[state] += 1
        out.append((d, item))
    out.sort(key=lambda it: it[0])
    return [item for _d, item in out[:limit]], counts


def nearby_aircraft(
    index: AircraftIndex,
    airport: AirportRec,
    radius_nm: float = NEARBY_RADIUS_NM,
    limit: int = 40,
    known_route: Callable[[str], tuple[str, str] | None] | None = None,
) -> list[dict[str, Any]]:
    """The nearest aircraft of :func:`nearby_traffic`, without the counts."""
    return nearby_traffic(index, airport, radius_nm, limit, known_route)[0]
