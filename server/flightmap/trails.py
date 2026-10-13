"""Short position history per aircraft: compact in-memory ring buffers with SQLite checkpoints.

Only aircraft in tiles somebody is looking at are ever recorded, spaced at least
``min_interval_s`` apart (a minute while parked), and only the last ``retention_s`` are kept.
"""

from __future__ import annotations

import asyncio
import bisect
import contextlib
import logging
import sqlite3
import time
from array import array
from typing import Any

from .models import Aircraft

log = logging.getLogger("flightmap.trails")

_NONE_I16 = 32767
_NONE_U16 = 65535
MAX_TRAILS = 40000
_CHECKPOINT_S = 120.0


class _Trail:
    __slots__ = ("alt", "gs", "last_seen", "lat", "lon", "t", "vr")

    def __init__(self) -> None:
        self.t = array("d")
        self.lat = array("i")  # degrees * 1e5
        self.lon = array("i")
        self.alt = array("h")  # feet / 25
        self.gs = array("H")  # knots * 10
        self.vr = array("h")  # ft/min / 64
        self.last_seen = 0.0


def _pack(a: Aircraft) -> tuple[int, int, int, int, int]:
    return (
        round(a.lat * 1e5),
        round(a.lon * 1e5),
        _NONE_I16 if a.altitude_ft is None else max(-32000, min(32000, round(a.altitude_ft / 25))),
        _NONE_U16 if a.ground_speed_kt is None else max(0, min(65000, round(a.ground_speed_kt * 10))),
        _NONE_I16
        if a.vertical_rate_fpm is None
        else max(-32000, min(32000, round(a.vertical_rate_fpm / 64))),
    )


class TrailStore:
    def __init__(self, retention_s: float = 2700.0, min_interval_s: float = 10.0, db_path: str | None = None):
        self.retention_s = retention_s
        self.min_interval_s = min_interval_s
        self._db_path = db_path
        self._trails: dict[int, _Trail] = {}
        self._unsaved: list[tuple[int, float, int, int, int, int, int]] = []
        self._task: asyncio.Task[None] | None = None
        self.points = 0

    # -- recording --------------------------------------------------------------------

    def record(self, a: Aircraft, fix_time: float, now: float | None = None) -> bool:
        """Append a position if it is new enough. ``fix_time`` is when the position was observed."""
        now = time.time() if now is None else now
        tr = self._trails.get(a.hex)
        if tr is None:
            if len(self._trails) >= MAX_TRAILS:
                return False
            tr = self._trails[a.hex] = _Trail()
        tr.last_seen = now
        if tr.t:
            gap = 60.0 if a.on_ground else self.min_interval_s
            if fix_time - tr.t[-1] < gap:
                return False
        packed = _pack(a)
        tr.t.append(fix_time)
        tr.lat.append(packed[0])
        tr.lon.append(packed[1])
        tr.alt.append(packed[2])
        tr.gs.append(packed[3])
        tr.vr.append(packed[4])
        self.points += 1
        if len(self._unsaved) < 300_000:
            self._unsaved.append((a.hex, fix_time, *packed))
        self._trim(tr, fix_time)
        return True

    def on_tile_update(self, _tile: object, aircraft: list[Aircraft], fetched_at: float) -> None:
        for a in aircraft:
            self.record(a, fetched_at - a.position_age_s, fetched_at)

    def _trim(self, tr: _Trail, now: float) -> None:
        cut = bisect.bisect_left(tr.t, now - self.retention_s)
        if cut >= 24:  # amortise the O(n) deletion
            for arr in (tr.t, tr.lat, tr.lon, tr.alt, tr.gs, tr.vr):
                del arr[:cut]
            self.points -= cut

    def sweep(self, now: float | None = None) -> None:
        """Forget aircraft that have not been seen for a whole retention window."""
        now = time.time() if now is None else now
        for hex_ in [h for h, tr in self._trails.items() if now - tr.last_seen > self.retention_s]:
            self.points -= len(self._trails[hex_].t)
            del self._trails[hex_]

    # -- reading ----------------------------------------------------------------------

    def snapshot(self, hex_: int) -> dict[str, Any] | None:
        tr = self._trails.get(hex_)
        if tr is None or not tr.t:
            return None
        return {
            "t": [round(x, 1) for x in tr.t],
            "lat": [v / 1e5 for v in tr.lat],
            "lon": [v / 1e5 for v in tr.lon],
            "alt": [None if v == _NONE_I16 else v * 25 for v in tr.alt],
            "gs": [None if v == _NONE_U16 else v / 10 for v in tr.gs],
            "vr": [None if v == _NONE_I16 else v * 64 for v in tr.vr],
        }

    def __len__(self) -> int:
        return len(self._trails)

    # -- persistence ------------------------------------------------------------------

    def _connect(self) -> sqlite3.Connection:
        assert self._db_path
        conn = sqlite3.connect(self._db_path, timeout=10)
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA synchronous=NORMAL")
        conn.execute(
            "CREATE TABLE IF NOT EXISTS trail_points ("
            "hex INTEGER NOT NULL, t REAL NOT NULL, lat INTEGER, lon INTEGER, alt INTEGER, gs INTEGER, vr INTEGER)"
        )
        conn.execute("CREATE INDEX IF NOT EXISTS trail_points_t ON trail_points (t)")
        return conn

    def _load_sync(self, since: float) -> list[tuple[int, float, int, int, int, int, int]]:
        with contextlib.closing(self._connect()) as conn:
            conn.execute("DELETE FROM trail_points WHERE t < ?", (since,))
            conn.commit()
            return conn.execute(
                "SELECT hex, t, lat, lon, alt, gs, vr FROM trail_points WHERE t >= ? ORDER BY hex, t",
                (since,),
            ).fetchall()

    def _save_sync(self, rows: list[tuple[int, float, int, int, int, int, int]], before: float) -> None:
        with contextlib.closing(self._connect()) as conn:
            conn.executemany("INSERT INTO trail_points VALUES (?,?,?,?,?,?,?)", rows)
            conn.execute("DELETE FROM trail_points WHERE t < ?", (before,))
            conn.commit()

    async def start(self) -> None:
        if not self._db_path:
            return
        now = time.time()
        try:
            rows = await asyncio.to_thread(self._load_sync, now - self.retention_s)
        except sqlite3.Error:
            log.exception("could not load trail history")
            rows = []
        for hex_, t, lat, lon, alt, gs, vr in rows:
            tr = self._trails.setdefault(hex_, _Trail())
            tr.t.append(t)
            tr.lat.append(lat)
            tr.lon.append(lon)
            tr.alt.append(alt)
            tr.gs.append(gs)
            tr.vr.append(vr)
            tr.last_seen = t
            self.points += 1
        self._task = asyncio.ensure_future(self._checkpoint_loop())

    async def _checkpoint_loop(self) -> None:
        while True:
            await asyncio.sleep(_CHECKPOINT_S)
            await self.checkpoint()

    async def checkpoint(self) -> None:
        self.sweep()
        if not self._db_path or not self._unsaved:
            return
        rows, self._unsaved = self._unsaved, []
        try:
            await asyncio.to_thread(self._save_sync, rows, time.time() - self.retention_s)
        except sqlite3.Error:
            log.exception("could not checkpoint trails")
            self._unsaved = rows + self._unsaved if len(rows) < 100_000 else self._unsaved

    async def stop(self) -> None:
        if self._task:
            self._task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self._task
            self._task = None
        await self.checkpoint()
