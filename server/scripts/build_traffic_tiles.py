"""Regenerate flightmap/data/traffic_tiles.json from the OurAirports data (Unlicense).

Tiles containing at least one large or medium airport with scheduled service are the only
ones the world view will fetch. Usage: ``python scripts/build_traffic_tiles.py airports.csv``.
"""

from __future__ import annotations

import csv
import json
import sys
from pathlib import Path

from flightmap.tiles import tile_id, tile_of

OUT = Path(__file__).resolve().parent.parent / "flightmap" / "data" / "traffic_tiles.json"


def main(csv_path: str) -> None:
    tiles: set[str] = set()
    with open(csv_path, newline="", encoding="utf-8") as fh:
        for row in csv.DictReader(fh):
            if row["type"] in {"large_airport", "medium_airport"} and row["scheduled_service"] == "yes":
                tiles.add(tile_id(tile_of(float(row["latitude_deg"]), float(row["longitude_deg"]))))
    OUT.write_text(json.dumps(sorted(tiles, key=lambda t: tuple(map(int, t.split("_"))))) + "\n")
    print(f"{len(tiles)} traffic tiles -> {OUT}")


if __name__ == "__main__":
    main(sys.argv[1])
