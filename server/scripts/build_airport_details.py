"""Regenerate flightmap/data/airport_details.json from the OurAirports data (Unlicense).

Per airport of the catalog (large and medium airports and any with scheduled service): runways, the
main radio frequencies, region, and the Wikipedia and home page links. Row layout per ICAO ident::

    {"r": [[le_ident, he_ident, length_ft, surface, lighted], ...],
     "f": [[type, mhz], ...], "reg": iso_region, "w": wikipedia_url, "h": home_url}

Usage: ``python scripts/build_airport_details.py airports.csv runways.csv airport-frequencies.csv``.
"""

from __future__ import annotations

import csv
import json
import sys
from pathlib import Path

DATA = Path(__file__).resolve().parent.parent / "flightmap" / "data"
FREQ_ORDER = ["ATIS", "TWR", "GND", "CLD", "DEL", "APP", "DEP", "CTAF", "UNICOM", "A/D", "AFIS", "ATF"]
MAX_RUNWAYS = 8
MAX_FREQUENCIES = 8


def main(airports_csv: str, runways_csv: str, freq_csv: str) -> None:
    wanted = {row[0] for row in json.loads((DATA / "airports.json").read_text("utf-8"))}
    details: dict[str, dict[str, object]] = {}
    with open(airports_csv, newline="", encoding="utf-8") as fh:
        for r in csv.DictReader(fh):
            if r["ident"] not in wanted:
                continue
            d: dict[str, object] = {}
            if r["iso_region"]:
                d["reg"] = r["iso_region"]
            if r["wikipedia_link"].startswith("https://"):
                d["w"] = r["wikipedia_link"]
            if r["home_link"].startswith(("https://", "http://")):
                d["h"] = r["home_link"]
            details[r["ident"]] = d
    with open(runways_csv, newline="", encoding="utf-8") as fh:
        for r in csv.DictReader(fh):
            d = details.get(r["airport_ident"])
            if d is None or r["closed"] == "1" or not r["length_ft"]:
                continue
            runways: list[list[object]] = d.setdefault("r", [])  # type: ignore[assignment]
            runways.append(
                [
                    r["le_ident"],
                    r["he_ident"],
                    int(float(r["length_ft"])),
                    r["surface"],
                    int(r["lighted"] or 0),
                ]
            )
    with open(freq_csv, newline="", encoding="utf-8") as fh:
        for r in csv.DictReader(fh):
            d = details.get(r["airport_ident"])
            if d is None or not r["frequency_mhz"]:
                continue
            freqs: list[list[object]] = d.setdefault("f", [])  # type: ignore[assignment]
            freqs.append([r["type"].upper(), float(r["frequency_mhz"])])
    for d in details.values():
        runways = d.get("r")  # type: ignore[assignment]
        if runways:
            runways.sort(key=lambda x: -x[2])  # type: ignore[index]
            del runways[MAX_RUNWAYS:]
        freqs = d.get("f")  # type: ignore[assignment]
        if freqs:
            order = {t: i for i, t in enumerate(FREQ_ORDER)}
            freqs.sort(key=lambda x: (order.get(str(x[0]), 99), x[1]))  # type: ignore[index]
            seen: set[tuple[object, object]] = set()
            kept = [f for f in freqs if not ((f[0], f[1]) in seen or seen.add((f[0], f[1])))]
            d["f"] = kept[:MAX_FREQUENCIES]
    out = DATA / "airport_details.json"
    out.write_text(json.dumps(details, separators=(",", ":"), ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"{len(details)} airports -> {out} ({out.stat().st_size // 1024} KiB)")


if __name__ == "__main__":
    main(*sys.argv[1:4])
