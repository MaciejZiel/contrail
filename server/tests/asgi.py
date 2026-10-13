"""Minimal ASGI client for tests (no httpx dependency)."""

from __future__ import annotations

import asyncio
from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any
from urllib.parse import urlsplit


@dataclass
class Result:
    status: int
    headers: dict[str, str]
    body: bytes


async def asgi_get(app: Any, url: str, headers: Mapping[str, str] | None = None) -> Result:
    parts = urlsplit(url)
    scope = {
        "type": "http", "asgi": {"version": "3.0"}, "http_version": "1.1", "method": "GET",
        "scheme": "http", "path": parts.path, "raw_path": parts.path.encode(),
        "query_string": parts.query.encode(), "root_path": "",
        "headers": [(k.lower().encode(), v.encode()) for k, v in (headers or {}).items()],
        "client": ("127.0.0.1", 1), "server": ("test", 80),
    }  # fmt: skip
    sent = False

    async def receive() -> dict[str, Any]:
        nonlocal sent
        if not sent:
            sent = True
            return {"type": "http.request", "body": b"", "more_body": False}
        await asyncio.sleep(3600)
        return {"type": "http.disconnect"}

    status = 0
    hdrs: dict[str, str] = {}
    chunks: list[bytes] = []

    async def send(message: dict[str, Any]) -> None:
        nonlocal status
        if message["type"] == "http.response.start":
            status = message["status"]
            hdrs.update({k.decode().lower(): v.decode() for k, v in message["headers"]})
        elif message["type"] == "http.response.body":
            chunks.append(message.get("body", b""))

    await app(scope, receive, send)
    return Result(status, hdrs, b"".join(chunks))
