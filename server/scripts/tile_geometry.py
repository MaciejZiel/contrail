"""Does a bigger tile fit one ADSB.lol point request (radius cap 250 nm)?

Prints, per tile size, the rows of the 5 degree grid where an N-column-wide, 1-row-high super tile still fits
inside the cap, and how many of the default prefetch plan's upstream requests pairing/merging would save.

    python scripts/tile_geometry.py
"""

from __future__ import annotations

import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from flightmap.regions import DEFAULT_REGIONS, build_plan
from flightmap.tiles import MAX_RADIUS_NM, TILE_DEG
from flightmap.trafficmask import load_traffic_tiles


def radius_nm(row: int, cols: int, rows: int = 1) -> float:
    south, north = row * TILE_DEG - 90.0, row * TILE_DEG - 90.0 + rows * TILE_DEG
    half_h = rows * TILE_DEG * 60.0 / 2
    widest = max(math.cos(math.radians(min(abs(south), abs(north)))), 0.0) if south * north > 0 else 1.0
    return math.hypot(half_h, cols * TILE_DEG * 60.0 * widest / 2) * 1.03


def main() -> None:
    plan = build_plan(DEFAULT_REGIONS, load_traffic_tiles())
    print(f"plan tiles: {len(plan)}, cap {MAX_RADIUS_NM:.0f} nm")
    for cols, rows in ((1, 1), (2, 1), (3, 1), (2, 2)):
        ok = {y for y in range(36 // rows) if radius_nm(y * rows, cols, rows) <= MAX_RADIUS_NM}
        done: set[tuple[int, int]] = set()
        reqs = 0
        for t in sorted(plan, key=lambda t: (t[1], t[0])):
            if t in done:
                continue
            block = {(t[0] + i, t[1] + j) for i in range(cols) for j in range(rows)}
            if t[0] % cols == 0 and t[1] % rows == 0 and t[1] // rows in ok and block <= set(plan) - done:
                done |= block
            else:
                done.add(t)
            reqs += 1
        print(
            f"{cols}x{rows} tiles per request: eligible block rows {sorted(ok)}; plan requests {len(plan)} -> {reqs}"
        )


if __name__ == "__main__":
    main()
