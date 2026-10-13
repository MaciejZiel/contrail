"""Regenerate flightmap/data/airports.json from the OurAirports data (Unlicense).

Keeps large and medium airports and small ones with an IATA code. Row layout:
[icao, iata, name, lat, lon, elevation_ft, kind (L/M/S), country, city, scheduled (0/1)].
Usage: ``python scripts/build_airports.py airports.csv``.
"""

from __future__ import annotations

import csv
import json
import sys
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / "flightmap" / "data" / "airports.json"
KINDS = {"large_airport": "L", "medium_airport": "M", "small_airport": "S"}


def main(csv_path: str) -> None:
    rows: list[list[object]] = []
    with open(csv_path, newline="", encoding="utf-8") as fh:
        for r in csv.DictReader(fh):
            kind = KINDS.get(r["type"])
            if kind is None or not r["ident"].isalnum():
                continue
            if kind == "S" and not r["iata_code"]:
                continue
            elev = int(float(r["elevation_ft"])) if r["elevation_ft"] else None
            rows.append(
                [
                    r["ident"], r["iata_code"], r["name"],
                    round(float(r["latitude_deg"]), 4), round(float(r["longitude_deg"]), 4),
                    elev, kind, r["iso_country"], r["municipality"],
                    1 if r["scheduled_service"] == "yes" else 0,
                ]
            )  # fmt: skip
    OUT.write_text(json.dumps(rows, separators=(",", ":"), ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"{len(rows)} airports -> {OUT}")


if __name__ == "__main__":
    main(sys.argv[1])
