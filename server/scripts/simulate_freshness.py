"""Offline, deterministic simulation of tile freshness under the real scheduler (no network, fake clock).

It drives the real ``TileCache`` and the default prefetch plan (183 traffic tiles) for a few simulated
hours against a synthetic upstream that behaves like the public ADSB.lol API as measured in the README:
some random HTTP 429s and many more when the request rate is too high. Two viewers are simulated, a wide
view of Europe and a zoomed-in view of London. The same script runs any git revision of ``flightmap``:

    python scripts/simulate_freshness.py --baseline main          # compare the working tree with main
    python scripts/simulate_freshness.py --hours 3 --seed 1       # working tree only

Numbers are for comparing schedulers, not a forecast: the synthetic traffic and the 429 model are
assumptions (documented below), and the real server also loses requests to timeouts.
"""

from __future__ import annotations

import argparse
import asyncio
import dataclasses
import json
import math
import random
import subprocess
import sys
import tempfile
from pathlib import Path

SERVER = Path(__file__).resolve().parents[1]
STEP_S = 0.25
WARMUP_S = 1800.0
SAMPLE_EVERY_S = 60.0
VIEW_EVERY_S = 10.0
SOLID_AGE_S = 900.0  # what the client shows at full strength (the old limit)


class Clock:
    def __init__(self) -> None:
        self.t = 1000.0

    def monotonic(self) -> float:
        return self.t

    def wall(self) -> float:
        return 1_800_000_000.0 + self.t

    async def sleep(self, seconds: float) -> None:
        self.t += max(seconds, 0.0)
        await asyncio.sleep(0)


def tile_traffic(tile: tuple[int, int], rnd: random.Random) -> float:
    """Average number of aircraft in a tile: busy over central Europe and the US east coast, thin elsewhere."""
    x, y = tile  # 5 degree tiles: x = floor((lon + 180) / 5), y = floor((lat + 90) / 5)
    lon, lat = x * 5 - 180 + 2.5, y * 5 - 90 + 2.5
    hubs = (
        (50.0, 8.0, 90.0),
        (40.0, -75.0, 70.0),
        (25.0, 55.0, 40.0),
        (32.0, 118.0, 50.0),
        (36.0, 139.0, 40.0),
    )
    best = 0.0
    for hlat, hlon, peak in hubs:
        d = math.hypot(lat - hlat, (lon - hlon) * math.cos(math.radians(lat)))
        best = max(best, peak * math.exp(-((d / 12.0) ** 2)))
    return max(1.0, best * rnd.uniform(0.6, 1.4) + rnd.uniform(0.0, 4.0))


async def worker(pkg_root: str, hours: float, seed: int, scenario: str, upstream: str) -> dict[str, object]:
    sys.path.insert(0, pkg_root)
    from flightmap.models import Aircraft
    from flightmap.regions import DEFAULT_REGIONS, build_plan
    from flightmap.tilecache import TileCache
    from flightmap.trafficmask import load_traffic_tiles
    from flightmap.upstream import UpstreamError

    rnd = random.Random(seed)
    traffic = load_traffic_tiles()
    plan = build_plan(DEFAULT_REGIONS, traffic)
    counts = {t: tile_traffic(t, rnd) for t in sorted(traffic)}
    clock = Clock()
    upstream_rnd = random.Random(seed + 1)
    recent: list[float] = []
    stats = {"requests": 0, "limited": 0}

    class Provider:
        name = "sim"
        source_id = 9

        async def fetch_tile(self, tile: tuple[int, int]) -> list[Aircraft]:
            now = clock.t
            recent[:] = [t for t in recent if now - t < 30.0]
            recent.append(now)
            stats["requests"] += 1
            if upstream == "bursty":
                # a load-based limit: far more refusals when 3 or more requests landed inside the last 20 s
                p = 0.04 + (0.55 if sum(1 for t in recent if now - t < 20.0) >= 3 else 0.0)
            else:
                # independent refusals: a base chance, and a high chance once more than 5 requests land inside 30 s
                p = 0.08 + (0.45 if len(recent) > 5 else 0.0)
            if upstream_rnd.random() < p:
                stats["limited"] += 1
                raise UpstreamError("HTTP 429", 429)
            n = max(0, round(counts.get(tile, 1.0) * upstream_rnd.uniform(0.85, 1.15)))
            return [Aircraft(hex=tile[0] * 100000 + tile[1] * 1000 + i, lat=1.0, lon=1.0) for i in range(n)]

        async def fetch_hex(self, hex_str: str) -> Aircraft | None:
            return None

        async def fetch_exact(self, kind: str, value: str) -> Aircraft | None:
            return None

    kw: dict[str, object] = dict(
        provider=Provider(),
        budget_rps=0.15,
        ttl_s=10.0,
        hot_window_s=60.0,
        evict_after_s=600.0,
        max_age_s=900.0,
        prefetch_plan=plan,
        prefetch_always=True,
        traffic_mask=traffic,
        clock=clock.monotonic,
        wall_clock=clock.wall,
        sleep=clock.sleep,
    )
    fields = {f.name for f in dataclasses.fields(TileCache)}
    if "ghost_age_s" in fields:
        kw["ghost_age_s"] = 1800.0
    if "rng" in fields:
        kw["rng"] = random.Random(seed + 2)
    cache = TileCache(**kw)  # type: ignore[arg-type]

    # viewers: wide Europe (about 60 tiles, no focus) and London zoomed in (4 tiles, focus)
    europe = sorted(
        (t for t in plan if plan[t].priority == 1), key=lambda t: math.hypot(t[0] - 37, t[1] - 28)
    )[:60]
    london = [(35, 28), (36, 28), (35, 27), (36, 27)]
    plan_tiles = list(plan)
    samples: list[dict[str, float]] = []
    next_view = 0.0
    next_sample = WARMUP_S
    end = hours * 3600.0
    elapsed = 0.0
    while elapsed < end:
        clock.t += STEP_S
        elapsed += STEP_S
        if elapsed >= next_view:
            next_view += VIEW_EVERY_S
            if scenario in ("both", "zoomed"):
                await cache.request(london, cold_deadline_s=0.0, focus=True)
            if scenario in ("both", "wide"):
                await cache.request(europe, cold_deadline_s=0.0, focus=False)
        await cache.tick()
        await cache.settle()
        if elapsed >= next_sample:
            next_sample += SAMPLE_EVERY_S
            wall = clock.wall()
            shown = cache.entries(plan_tiles)
            ages = sorted(wall - e.fetched_at for e in shown)
            solid = [e for e in shown if wall - e.fetched_at <= SOLID_AGE_S]
            total_aircraft = sum(counts[t] for t in plan_tiles)
            samples.append(
                {
                    "shown_tiles": len(shown) / len(plan_tiles),
                    "solid_tiles": len(solid) / len(plan_tiles),
                    "shown_aircraft": sum(len(e.aircraft) for e in shown) / total_aircraft,
                    "solid_aircraft": sum(len(e.aircraft) for e in solid) / total_aircraft,
                    "median_age_s": ages[len(ages) // 2] if ages else 0.0,
                    "oldest_age_s": ages[-1] if ages else 0.0,
                    "london_age_s": sum(wall - e.fetched_at for e in cache.entries(london))
                    / max(1, len(cache.entries(london))),
                }
            )
    keys = samples[0].keys()
    mean = {k: sum(s[k] for s in samples) / len(samples) for k in keys}
    mean["oldest_age_s"] = max(s["oldest_age_s"] for s in samples)
    mean.update(requests=stats["requests"], limited=stats["limited"])
    mean["limited_share"] = stats["limited"] / max(1, stats["requests"])
    return mean


def run_tree(root: Path, hours: float, seed: int, scenario: str, upstream: str) -> dict[str, float]:
    out = subprocess.run(
        [
            sys.executable,
            str(Path(__file__).resolve()),
            "--worker",
            str(root),
            "--hours",
            str(hours),
            "--seed",
            str(seed),
            "--scenario",
            scenario,
            "--upstream",
            upstream,
        ],
        check=True,
        capture_output=True,
        text=True,
    )
    return json.loads(out.stdout.strip().splitlines()[-1])


SCENARIOS = {
    "idle": "nobody is looking, only the background plan runs",
    "wide": "one wide view of Europe (60 tiles, no focus)",
    "zoomed": "one zoomed-in view of London (4 tiles, focus)",
    "both": "the wide Europe view and the zoomed London view together",
}


def baseline_tree(ref: str) -> tuple[tempfile.TemporaryDirectory[str], Path]:
    tmp = tempfile.TemporaryDirectory(prefix="flightmap-baseline-")
    archive = subprocess.run(
        ["git", "archive", ref, "server/flightmap"], cwd=SERVER.parent, check=True, capture_output=True
    ).stdout
    subprocess.run(["tar", "-x", "-C", tmp.name], input=archive, check=True)
    return tmp, Path(tmp.name) / "server"


def table(rows: dict[str, dict[str, float]]) -> str:
    names = list(rows)
    spec = [
        ("shown_tiles", "planned tiles shown (%)", 100.0, "{:.1f}"),
        ("solid_tiles", "planned tiles <= 15 min old (%)", 100.0, "{:.1f}"),
        ("shown_aircraft", "aircraft shown (% of planned traffic)", 100.0, "{:.1f}"),
        ("solid_aircraft", "aircraft <= 15 min old (%)", 100.0, "{:.1f}"),
        ("median_age_s", "median age of shown tiles (s)", 1.0, "{:.0f}"),
        ("oldest_age_s", "oldest shown tile (s)", 1.0, "{:.0f}"),
        ("london_age_s", "zoomed-in view mean age (s)", 1.0, "{:.0f}"),
        ("requests", "upstream requests", 1.0, "{:.0f}"),
        ("limited_share", "of them answered 429 (%)", 100.0, "{:.1f}"),
    ]
    width = max(len(label) for _k, label, _s, _f in spec)
    lines = [" " * width + "  " + "  ".join(f"{n:>10}" for n in names)]
    for key, label, scale, fmt in spec:
        cells = "  ".join(f"{fmt.format(rows[n][key] * scale):>10}" for n in names)
        lines.append(f"{label:<{width}}  {cells}")
    return "\n".join(lines)


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--hours", type=float, default=3.0)
    ap.add_argument("--seed", type=int, default=1)
    ap.add_argument("--baseline", help="git ref to compare against (e.g. main)")
    ap.add_argument("--scenario", default="all", choices=("all", "both", "idle", "wide", "zoomed"))
    ap.add_argument("--upstream", default="iid", choices=("iid", "bursty"), help="429 model (see worker)")
    ap.add_argument("--worker", help=argparse.SUPPRESS)
    args = ap.parse_args()
    if args.worker:
        print(
            json.dumps(asyncio.run(worker(args.worker, args.hours, args.seed, args.scenario, args.upstream)))
        )
        return
    scenarios = ("idle", "wide", "zoomed", "both") if args.scenario == "all" else (args.scenario,)
    trees: dict[str, Path] = {}
    tmp = None
    if args.baseline:
        tmp, trees[args.baseline] = baseline_tree(args.baseline)
    trees["working tree"] = SERVER
    try:
        for scenario in scenarios:
            rows = {
                name: run_tree(root, args.hours, args.seed, scenario, args.upstream)
                for name, root in trees.items()
            }
            print(
                f"\nscenario {scenario!r}: {SCENARIOS[scenario]} ({args.hours:g} simulated hours, seed {args.seed}, 0.15 req/s, {args.upstream} 429s)"
            )
            print(table(rows))
    finally:
        if tmp is not None:
            tmp.cleanup()


if __name__ == "__main__":
    main()
