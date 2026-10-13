"""Small polite HTTP client for upstream APIs (standard library only).

Blocking ``urllib`` calls run in a bounded thread pool so the event loop is never blocked.
Every failure mode, including an empty body, is raised as :class:`UpstreamError` so callers
can degrade one field instead of failing a whole request.
"""

from __future__ import annotations

import asyncio
import gzip
import io
import json
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from typing import Any


class UpstreamError(Exception):
    def __init__(self, message: str, status: int | None = None, retry_after: float | None = None):
        super().__init__(message)
        self.status = status
        self.retry_after = retry_after


class BudgetExhausted(UpstreamError):
    """Our own per-source request budget is empty: nothing was sent, so the source is not at fault."""

    def __init__(self, source: str) -> None:
        super().__init__(f"{source} request budget exhausted")


MAX_BODY_BYTES = 8 * 1024 * 1024


class UpstreamClient:
    def __init__(self, user_agent: str, timeout_s: float = 15.0, workers: int = 1) -> None:
        self.user_agent = user_agent
        self.timeout_s = timeout_s
        self._pool = ThreadPoolExecutor(max_workers=workers, thread_name_prefix="upstream")

    def _request(
        self, method: str, url: str, body: bytes | None, headers: dict[str, str]
    ) -> tuple[int, bytes]:
        if not url.startswith(("http://", "https://")):
            raise UpstreamError(f"unsupported URL scheme: {url}")
        req = urllib.request.Request(url, data=body, method=method)  # noqa: S310
        req.add_header("User-Agent", self.user_agent)
        req.add_header("Accept", "application/json")
        req.add_header("Accept-Encoding", "gzip")
        for key, value in headers.items():
            req.add_header(key, value)
        try:
            with urllib.request.urlopen(req, timeout=self.timeout_s) as resp:  # noqa: S310
                raw = resp.read(MAX_BODY_BYTES + 1)
                if len(raw) > MAX_BODY_BYTES:
                    raise UpstreamError(f"response from {url} is larger than {MAX_BODY_BYTES} bytes")
                if resp.headers.get("Content-Encoding") == "gzip":
                    with gzip.GzipFile(fileobj=io.BytesIO(raw)) as gz:
                        raw = gz.read(MAX_BODY_BYTES + 1)
                    if len(raw) > MAX_BODY_BYTES:
                        raise UpstreamError(f"decompressed response from {url} is too large")
                return resp.status, raw
        except urllib.error.HTTPError as exc:
            exc.close()
            retry: float | None = None
            header = exc.headers.get("Retry-After") if exc.headers else None
            if header and header.isdigit():
                retry = float(header)
            raise UpstreamError(f"HTTP {exc.code} from {url}", exc.code, retry) from exc
        except (urllib.error.URLError, TimeoutError, OSError) as exc:
            raise UpstreamError(f"request failed for {url}: {exc}") from exc

    async def get_json(self, url: str, headers: dict[str, str] | None = None) -> Any:
        return await self._json("GET", url, None, headers or {})

    async def post_json(self, url: str, payload: Any, headers: dict[str, str] | None = None) -> Any:
        body = json.dumps(payload).encode()
        merged = {"Content-Type": "application/json", **(headers or {})}
        return await self._json("POST", url, body, merged)

    async def _json(self, method: str, url: str, body: bytes | None, headers: dict[str, str]) -> Any:
        loop = asyncio.get_running_loop()
        status, raw = await loop.run_in_executor(self._pool, self._request, method, url, body, headers)
        if not raw.strip():
            raise UpstreamError(f"empty body (HTTP {status}) from {url}", status)
        try:
            return json.loads(raw)
        except ValueError as exc:
            raise UpstreamError(f"invalid JSON (HTTP {status}) from {url}", status) from exc

    def close(self) -> None:
        self._pool.shutdown(wait=False, cancel_futures=True)


class TokenBucket:
    """Global request budget: ``rate`` requests per second with a small burst."""

    def __init__(self, rate: float, burst: float = 2.0) -> None:
        self.rate = max(rate, 0.01)
        self.burst = burst
        self._tokens = burst
        self._stamp = time.monotonic()

    def _refill(self) -> None:
        now = time.monotonic()
        self._tokens = min(self.burst, self._tokens + (now - self._stamp) * self.rate)
        self._stamp = now

    def try_take(self) -> bool:
        self._refill()
        if self._tokens >= 1.0:
            self._tokens -= 1.0
            return True
        return False

    def available(self) -> bool:
        self._refill()
        return self._tokens >= 1.0

    def wait_time(self) -> float:
        self._refill()
        return 0.0 if self._tokens >= 1.0 else (1.0 - self._tokens) / self.rate
