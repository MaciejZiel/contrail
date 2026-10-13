"""Demand-driven tile cache and the single shared fetcher.

Viewers only declare which tiles they look at. This module fetches each tile at most once
per refresh interval, whatever the number of viewers, under one global request budget.
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
import time
from collections.abc import Awaitable, Callable, Iterable
from dataclasses import dataclass, field

from .codec import encode_aircraft
from .models import Aircraft
from .providers import TileProvider
from .tiles import Tile
from .upstream import TokenBucket, UpstreamError

log = logging.getLogger("flightmap.tiles")
MAX_INFLIGHT = 4
MIN_RPS = 0.15
DEFAULT_MAX_AGE_S = 900.0

UpdateListener = Callable[[Tile, list[Aircraft], float], None]


@dataclass(slots=True)
class TileEntry:
    tile: Tile
    aircraft: list[Aircraft]
    fetched_at: float  # wall clock seconds
    version: int
    payload: bytes
    source: int


@dataclass(slots=True)
class TileState:
    entry: TileEntry | None = None
    last_demand: float = 0.0  # monotonic
    last_attempt: float = 0.0  # monotonic
    failures: int = 0
    next_attempt: float = 0.0  # monotonic
    ever_had_traffic: bool = False
    rank: int = 0  # position in the latest request, nearest the view centre first


@dataclass(slots=True)
class ProviderStatus:
    ok: bool = True
    last_error: str = ""
    last_success_at: float = 0.0
    requests: int = 0
    errors: int = 0


@dataclass
class TileCache:
    provider: TileProvider
    budget_rps: float = 0.35
    ttl_s: float = 10.0
    hot_window_s: float = 60.0
    evict_after_s: float = 600.0
    max_age_s: float = DEFAULT_MAX_AGE_S
    prefetch_tiles: list[Tile] = field(default_factory=lambda: list[Tile]())
    prefetch_idle_s: float = 900.0
    prefetch_always: bool = False
    listeners: list[UpdateListener] = field(default_factory=lambda: list[UpdateListener]())

    def __post_init__(self) -> None:
        self._states: dict[Tile, TileState] = {}
        self._prefetch_set = frozenset(self.prefetch_tiles)
        self._last_request = 0.0
        self._inflight: dict[Tile, asyncio.Task[None]] = {}
        self._bucket = TokenBucket(self.budget_rps, burst=1.0 if self.budget_rps <= 2 else 4.0)
        self._version = 0
        self._limited: list[float] = []
        self._paused_until = 0.0
        self._wake = asyncio.Event()
        self._runner: asyncio.Task[None] | None = None
        self.status = ProviderStatus()

    # -- public API -------------------------------------------------------------------

    def entries(self, tiles: Iterable[Tile]) -> list[TileEntry]:
        """Current tile data; tiles that could not be refreshed for ``max_age_s`` are dropped."""
        out: list[TileEntry] = []
        now = time.time()
        for t in tiles:
            st = self._states.get(t)
            if st and st.entry and now - st.entry.fetched_at <= self.max_age_s:
                out.append(st.entry)
        return out

    def has_traffic(self, tile: Tile) -> bool:
        st = self._states.get(tile)
        return bool(st and st.ever_had_traffic)

    async def request(self, tiles: Iterable[Tile], cold_deadline_s: float = 4.0) -> None:
        """Declare demand for tiles; wait (bounded) for tiles that were never fetched."""
        now = time.monotonic()
        self._last_request = now
        cold: list[Tile] = []
        for rank, t in enumerate(tiles):
            st = self._states.setdefault(t, TileState())
            st.last_demand = now
            st.rank = rank
            if st.entry is None and now >= st.next_attempt:
                cold.append(t)
        self._wake.set()
        if not cold:
            return
        tasks = [self._ensure_fetch(t) for t in cold[:12]]
        with contextlib.suppress(asyncio.TimeoutError):
            await asyncio.wait_for(asyncio.gather(*tasks, return_exceptions=True), timeout=cold_deadline_s)

    def snapshot_status(self) -> dict[str, object]:
        now = time.monotonic()
        wall = time.time()
        hot = [s for s in self._states.values() if now - s.last_demand <= self.hot_window_s]
        ages = sorted(wall - s.entry.fetched_at for s in self._states.values() if s.entry)
        return {
            "provider": self.provider.name,
            "ok": self.status.ok,
            "last_error": self.status.last_error,
            "requests": self.status.requests,
            "errors": self.status.errors,
            "tiles_cached": len(ages),
            "tiles_hot": len(hot),
            "prefetch_tiles": len(self.prefetch_tiles),
            "prefetch_active": self._prefetch_active(now),
            "median_tile_age_s": round(ages[len(ages) // 2], 1) if ages else None,
            "oldest_tile_age_s": round(ages[-1], 1) if ages else None,
            "newest_tile_age_s": round(ages[0], 1) if ages else None,
            "budget_rps": self.budget_rps,
            "current_rps": round(self._bucket.rate, 3),
            "effective_ttl_s": round(self._effective_ttl(len(hot)), 1),
            "aircraft": sum(len(s.entry.aircraft) for s in self._states.values() if s.entry),
        }

    def _on_rate_limited(self, retry_after: float | None) -> None:
        """A few HTTP 429s are normal on a shared public API; sustained ones lower our request rate."""
        now = time.monotonic()
        self._paused_until = now + (retry_after or 4.0)
        self._limited = [t for t in self._limited if now - t < 60.0] + [now]
        if len(self._limited) >= 3:
            self._bucket.rate = max(MIN_RPS, self._bucket.rate * 0.8)
            self._limited.clear()

    async def with_budget[T](self, call: Callable[[], Awaitable[T]], wait_s: float = 6.0) -> T:
        """Run one extra upstream call (e.g. a single-aircraft lookup) against the shared budget."""
        if not await self._take_budget(wait_s):
            raise UpstreamError("upstream budget exhausted")
        self.status.requests += 1
        return await call()

    # -- scheduling -------------------------------------------------------------------

    def _effective_ttl(self, hot_count: int) -> float:
        return max(self.ttl_s, hot_count / max(self._bucket.rate, 0.01))

    def _pick(self, now: float) -> Tile | None:
        hot = [(t, s) for t, s in self._states.items() if now - s.last_demand <= self.hot_window_s]
        ttl = self._effective_ttl(len(hot))
        best: tuple[float, Tile] | None = None
        for tile, st in hot:
            if tile in self._inflight or now < st.next_attempt:
                continue
            overdue = (now - st.last_attempt) / ttl if st.last_attempt else 1e9 - st.rank
            if overdue >= 1.0 and (best is None or overdue > best[0]):
                best = (overdue, tile)
        return best[1] if best else None

    def _prefetch_active(self, now: float) -> bool:
        if not self.prefetch_tiles:
            return False
        return self.prefetch_always or (
            self._last_request > 0 and now - self._last_request < self.prefetch_idle_s
        )

    def _pick_prefetch(self, now: float) -> Tile | None:
        """Oldest prefetch-region tile, only with spare capacity and while somebody has looked recently."""
        if not self._prefetch_active(now):
            return None
        best: tuple[float, Tile] | None = None
        for tile in self.prefetch_tiles:
            if tile in self._inflight:
                continue
            st = self._states.get(tile)
            if st is not None and now < st.next_attempt:
                continue
            last = st.last_attempt if st else 0.0
            if last and now - last < self.ttl_s:
                continue
            if best is None or last < best[0]:
                best = (last, tile)
        return best[1] if best else None

    def _ensure_fetch(self, tile: Tile) -> asyncio.Task[None]:
        task = self._inflight.get(tile)
        if task is None:
            task = asyncio.ensure_future(self._fetch(tile))
            self._inflight[tile] = task
            task.add_done_callback(lambda _t, tile=tile: self._inflight.pop(tile, None))
        return task

    async def _take_budget(self, wait_s: float = 6.0) -> bool:
        deadline = time.monotonic() + wait_s
        while time.monotonic() < deadline:
            if time.monotonic() < self._paused_until:
                await asyncio.sleep(min(1.0, self._paused_until - time.monotonic()))
                continue
            if self._bucket.try_take():
                return True
            await asyncio.sleep(min(0.5, self._bucket.wait_time()))
        return False

    async def _fetch(self, tile: Tile) -> None:
        st = self._states.setdefault(tile, TileState())
        if not await self._take_budget():
            return
        st.last_attempt = time.monotonic()
        self.status.requests += 1
        try:
            aircraft = await self.provider.fetch_tile(tile)
        except UpstreamError as exc:
            self.status.errors += 1
            self.status.ok = False
            self.status.last_error = str(exc)
            st.failures += 1
            st.next_attempt = time.monotonic() + min(60.0, 2.0**st.failures)
            if exc.status in (429, 503):
                self._on_rate_limited(exc.retry_after)
            log.warning("tile %s fetch failed: %s", tile, exc)
            return
        except Exception:
            self.status.errors += 1
            self.status.ok = False
            self.status.last_error = "internal provider error"
            st.failures += 1
            st.next_attempt = time.monotonic() + min(60.0, 2.0**st.failures)
            log.exception("tile %s provider crashed", tile)
            return
        st.failures = 0
        st.next_attempt = 0.0
        # additive increase back towards the configured budget
        self._bucket.rate = min(self.budget_rps, self._bucket.rate + 0.005)
        self.status.ok = True
        self.status.last_error = ""
        self.status.last_success_at = time.time()
        self._version += 1
        now_wall = time.time()
        st.entry = TileEntry(
            tile=tile,
            aircraft=aircraft,
            fetched_at=now_wall,
            version=self._version,
            payload=encode_aircraft(aircraft),
            source=self.provider.source_id,
        )
        if aircraft:
            st.ever_had_traffic = True
        for listener in self.listeners:
            try:
                listener(tile, aircraft, now_wall)
            except Exception:
                log.exception("tile listener failed")

    async def _loop(self) -> None:
        while True:
            now = time.monotonic()
            self._evict(now)
            scheduled = 0
            while len(self._inflight) < MAX_INFLIGHT and self._bucket.available():
                tile = self._pick(now) or self._pick_prefetch(now)
                if tile is None:
                    break
                self._ensure_fetch(tile)
                scheduled += 1
                await asyncio.sleep(0)  # let the fetch start and take its budget token
            if scheduled:
                await asyncio.sleep(0.02)
                continue
            self._wake.clear()
            with contextlib.suppress(asyncio.TimeoutError):
                await asyncio.wait_for(self._wake.wait(), timeout=0.25)

    def _evict(self, now: float) -> None:
        for tile in [
            t
            for t, s in self._states.items()
            if now - s.last_demand > self.evict_after_s
            and t not in self._inflight
            and t not in self._prefetch_set
        ]:
            del self._states[tile]

    def start(self) -> None:
        if self._runner is None:
            self._runner = asyncio.ensure_future(self._loop())

    async def stop(self) -> None:
        if self._runner:
            self._runner.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self._runner
            self._runner = None
        for task in list(self._inflight.values()):
            task.cancel()
