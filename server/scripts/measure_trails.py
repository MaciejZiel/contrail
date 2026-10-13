"""Memory probe for the trail store at Europe scale: python scripts/measure_trails.py [aircraft] [hours]."""

from __future__ import annotations

import math
import random
import sys
import time

from flightmap.models import Aircraft
from flightmap.trails import TrailStore


def rss_mb() -> float:
    with open("/proc/self/status", encoding="utf-8") as fh:
        for line in fh:
            if line.startswith("VmRSS:"):
                return int(line.split()[1]) / 1024
    return 0.0


def main() -> None:
    n = int(sys.argv[1]) if len(sys.argv) > 1 else 5000
    hours = float(sys.argv[2]) if len(sys.argv) > 2 else 6.0
    rng = random.Random(3)
    store = TrailStore(retention_s=2700, min_interval_s=10)
    base = rss_mb()
    flights = [
        (rng.uniform(36, 70), rng.uniform(-20, 40), rng.uniform(0, 360), rng.uniform(380, 500), rng.uniform(0.0, hours * 3600 * 0.5))
        for _ in range(n)
    ]  # fmt: skip
    t0 = time.time()
    steps = int(hours * 360)
    for step in range(steps):
        t = step * 10.0
        if step % 12 == 0:
            store._unsaved.clear()
        for i, (lat, lon, trk, gs, start) in enumerate(flights):
            if t < start:
                continue
            dt = t - start
            wobble = math.sin(dt / 900 + i) * 0.4  # gentle turns so the thinning has work to do
            d = gs * 0.514444 * dt / 111_000.0
            la = lat + d * math.cos(math.radians(trk + wobble * 20))
            lo = lon + d * math.sin(math.radians(trk + wobble * 20)) / max(0.2, math.cos(math.radians(lat)))
            climb = min(1.0, dt / 1200)
            store.record(
                Aircraft(
                    hex=i + 1,
                    lat=la,
                    lon=lo,
                    altitude_ft=int(36000 * climb),
                    ground_speed_kt=gs,
                    vertical_rate_fpm=0,
                ),
                1_800_000_000 + t,
                1_800_000_000 + t,
            )
    took = time.time() - t0
    per = store.points / max(len(store), 1)
    print(f"{n} aircraft, {hours} h of flight: {store.points:,} points ({per:.0f} per aircraft), "
          f"{rss_mb() - base:.0f} MB extra RSS, simulated in {took:.0f} s")  # fmt: skip
    sample = store.snapshot(1)
    print("sample trail points:", len(sample["t"]) if sample else 0)


if __name__ == "__main__":
    main()
