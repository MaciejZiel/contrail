"""Regenerate flightmap/data/airlines.json and types.json from the VRS standing data (CC0-1.0).

Source: https://github.com/vradarserver/standing-data (airlines/schema-01/airlines.csv and
model-type/schema-01/*.csv). Usage: ``python scripts/build_reference_data.py``.
"""

from __future__ import annotations

import csv
import io
import json
import string
import urllib.request
from pathlib import Path

BASE = "https://raw.githubusercontent.com/vradarserver/standing-data/main"
OUT = Path(__file__).resolve().parent.parent / "flightmap" / "data"


def fetch(path: str) -> str | None:
    req = urllib.request.Request(f"{BASE}/{path}", headers={"User-Agent": "LiveFlightsMap-build/1.0"})
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return resp.read().decode("utf-8-sig")
    except OSError:
        return None


def main() -> None:
    airlines: dict[str, str] = {}
    raw = fetch("airlines/schema-01/airlines.csv")
    assert raw, "airlines.csv unavailable"
    for row in csv.DictReader(io.StringIO(raw)):
        if row["ICAO"] and row["Name"]:
            airlines.setdefault(row["ICAO"], row["Name"].strip())
    types: dict[str, str] = {}
    for letter in [*string.ascii_uppercase, "-"]:
        text = fetch(f"model-type/schema-01/{letter}.csv")
        if not text:
            continue
        for row in csv.DictReader(io.StringIO(text)):
            code = row["ICAO"]
            if code and row["IsActive"] == "1" and code not in types:
                types[code] = f"{row['Manufacturer']} {row['Model']}".strip()
    (OUT / "airlines.json").write_text(json.dumps(airlines, separators=(",", ":"), sort_keys=True) + "\n")
    (OUT / "types.json").write_text(json.dumps(types, separators=(",", ":"), sort_keys=True) + "\n")
    print(f"{len(airlines)} airlines, {len(types)} aircraft types")


if __name__ == "__main__":
    main()
