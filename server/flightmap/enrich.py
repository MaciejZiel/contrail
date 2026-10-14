"""Cached, isolated enrichment lookups: a failing source degrades one field, never a request."""

from __future__ import annotations

import asyncio
import time
from collections.abc import Awaitable, Callable
from typing import Any

from .upstream import BudgetExhausted, UpstreamError

_MISSING = object()


def _is_source_fault(exc: UpstreamError) -> bool:
    """Timeouts, network errors, 429 and 5xx say the source is in trouble; an empty answer or a
    4xx for one particular key does not, and must not switch the lookup off for everybody."""
    status = exc.status
    return status is None or status == 429 or status >= 500


class EnrichmentCache:
    """TTL cache with single-flight loading, negative caching and a simple circuit breaker."""

    def __init__(
        self,
        ttl_s: float,
        neg_ttl_s: float = 60.0,
        max_entries: int = 5000,
        breaker_threshold: int = 5,
        breaker_pause_s: float = 60.0,
        timeout_s: float = 10.0,
    ) -> None:
        self.ttl_s = ttl_s
        self.neg_ttl_s = neg_ttl_s
        self.max_entries = max_entries
        self._threshold = breaker_threshold
        self._pause = breaker_pause_s
        self._timeout = timeout_s
        self._store: dict[str, tuple[float, Any]] = {}
        self._inflight: dict[str, asyncio.Future[Any]] = {}
        self._failures = 0
        self._open_until = 0.0

    @property
    def open(self) -> bool:
        return time.monotonic() < self._open_until

    def has(self, key: str) -> bool:
        """True when ``key`` is cached (as a value or a failure) or being loaded right now."""
        hit = self._store.get(key)
        return (hit is not None and hit[0] > time.monotonic()) or key in self._inflight

    def peek(self, key: str) -> Any:
        """The cached value for ``key``, or None when it is missing, failed or expired. Never loads."""
        hit = self._store.get(key)
        if hit is None or hit[0] <= time.monotonic() or isinstance(hit[1], UpstreamError):
            return None
        return hit[1]

    async def get(self, key: str, loader: Callable[[], Awaitable[Any]]) -> Any:
        """Value for ``key`` (may be None for "known to not exist"); raises UpstreamError when unavailable."""
        now = time.monotonic()
        hit = self._store.get(key)
        if hit and hit[0] > now:
            if isinstance(hit[1], UpstreamError):
                raise hit[1]
            return hit[1]
        if self.open:
            raise UpstreamError("source temporarily disabled")
        running = self._inflight.get(key)
        if running is not None:
            return await asyncio.shield(running)
        fut: asyncio.Future[Any] = asyncio.ensure_future(self._load(key, loader))
        self._inflight[key] = fut
        fut.add_done_callback(lambda _f: self._inflight.pop(key, None))
        return await asyncio.shield(fut)

    async def _load(self, key: str, loader: Callable[[], Awaitable[Any]]) -> Any:
        try:
            value = await asyncio.wait_for(loader(), timeout=self._timeout)
        except BudgetExhausted:
            raise  # our own limit, not the source's fault: no breaker, no negative caching
        except (UpstreamError, TimeoutError) as exc:
            err = exc if isinstance(exc, UpstreamError) else UpstreamError("timeout")
            if _is_source_fault(err):
                self._failures += 1
                if self._failures >= self._threshold:
                    self._open_until = time.monotonic() + self._pause
                    self._failures = 0
            self._put(key, err, self.neg_ttl_s)
            raise err from exc
        self._failures = 0
        self._put(key, value, self.ttl_s)
        return value

    def _put(self, key: str, value: Any, ttl: float) -> None:
        if len(self._store) >= self.max_entries:
            now = time.monotonic()
            for k in [k for k, (exp, _) in self._store.items() if exp <= now][: self.max_entries // 4]:
                del self._store[k]
            if len(self._store) >= self.max_entries:
                self._store.pop(next(iter(self._store)))
        self._store[key] = (time.monotonic() + ttl, value)
