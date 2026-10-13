"""Full request cost of /api/v1/trails: python scripts/bench_trails.py [aircraft] (run from server/).

Fills the trail memory with synthetic 30 minute tracks and times the whole handler (selection, JSON
encoding, response) for a box covering most of them, once cold and then served from the result reuse.
"""

from __future__ import annotations

import asyncio
import gzip
import random
import statistics
import sys
import tempfile
import time

from flightmap.app import create_app
from flightmap.config import Settings
from flightmap.models import Aircraft
from tests.asgi import asgi_get


def timed_ms(app: object, url: str, runs: int) -> list[float]:
    out = []
    for _ in range(runs):
        t0 = time.perf_counter()
        r = asyncio.run(asgi_get(app, url))
        out.append((time.perf_counter() - t0) * 1000)
        assert r.status == 200
    return out


def main() -> None:
    n = int(sys.argv[1]) if len(sys.argv) > 1 else 12000
    rng = random.Random(5)
    with tempfile.TemporaryDirectory() as tmp:
        app = create_app(
            Settings(adsblol_url="http://127.0.0.1:9", data_dir=tmp, prefetch_regions="off", gzip=False)
        )
        trails = app.state.api.trails
        now = time.time()
        for i in range(n):
            lat, lon, trk = rng.uniform(36, 70), rng.uniform(-20, 40), rng.uniform(0, 6.28)
            for k in range(180):  # 30 minutes, ten seconds apart
                d = k * 0.0035
                a = Aircraft(
                    hex=i + 1,
                    lat=lat + d * 0.8 * (1 if trk < 3.14 else -1),
                    lon=lon + d,
                    altitude_ft=30000,
                    ground_speed_kt=450.0,
                )
                trails.record(a, now - 1800 + k * 10, now - 1800 + k * 10)
        box = "w=-20&s=36&e=40&n=70&window=1800"
        cold = []
        for i in range(8):  # a different limit each time, so nothing is reused
            cold += timed_ms(app, f"/api/v1/trails?{box}&limit={400 - i}", 1)
        warm = timed_ms(app, f"/api/v1/trails?{box}", 1) + timed_ms(app, f"/api/v1/trails?{box}", 20)
        raw = asyncio.run(asgi_get(app, f"/api/v1/trails?{box}")).body
        print(
            f"{n} trails, response {len(raw) / 1024:.0f} KB raw, {len(gzip.compress(raw)) / 1024:.0f} KB gzipped"
        )
        print(f"cold request: median {statistics.median(cold):.1f} ms, worst {max(cold):.1f} ms")
        print(f"reused result: median {statistics.median(warm[1:]):.2f} ms")


if __name__ == "__main__":
    main()
