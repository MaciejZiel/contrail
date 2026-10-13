"""A fake clock for the scheduler tests: time only moves when the test moves it, nothing really waits."""

from __future__ import annotations

import asyncio

from flightmap.tilecache import TileCache


class FakeClock:
    def __init__(self) -> None:
        self.t = 1000.0

    def monotonic(self) -> float:
        return self.t

    def wall(self) -> float:
        return 1_800_000_000.0 + self.t

    def advance(self, seconds: float) -> None:
        self.t += seconds

    async def sleep(self, seconds: float) -> None:
        """Replacement for asyncio.sleep: sleeping moves the fake time forward."""
        self.t += max(seconds, 0.0)
        await asyncio.sleep(0)


def cache_with(clock: FakeClock, **kw: object) -> TileCache:
    return TileCache(clock=clock.monotonic, wall_clock=clock.wall, sleep=clock.sleep, **kw)  # type: ignore[arg-type]


async def run_for(cache: TileCache, clock: FakeClock, seconds: float, step: float = 0.05) -> None:
    """Drive the scheduler through ``seconds`` of fake time: advance, schedule, let fetches finish."""
    for _ in range(round(seconds / step)):
        clock.advance(step)
        await cache.tick()
        await cache.settle()
