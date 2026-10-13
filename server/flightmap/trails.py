"""Position history of the current flight per aircraft, in compact arrays with SQLite checkpoints.

Only aircraft in tiles somebody is looking at are ever recorded. The last ``recent_s`` seconds are
kept at full resolution (at least ``min_interval_s`` apart, a minute while parked); older points are
thinned with the Douglas-Peucker algorithm (position and altitude), so a whole flight, even a
12 hour one, costs a few hundred points. A trail starts again after a landing or when an aircraft
has not been seen for ``flight_gap_s``. Memory is bounded by ``MAX_TRAILS`` and ``max_points``.
"""

from __future__ import annotations

import asyncio
import bisect
import contextlib
import logging
import math
import sqlite3
import time
from array import array
from collections.abc import Callable, Sequence
from typing import Any

from .models import Aircraft

log = logging.getLogger("flightmap.trails")

_NONE_I16 = 32767
_NONE_U16 = 65535
MAX_TRAILS = 12000
_CHECKPOINT_S = 120.0
_SIMPLIFY_EVERY = 40  # simplify the old part once this many new old points have accumulated
_POS_TOLERANCE_DEG = 0.012  # about 1.3 km
_ALT_TOLERANCE_FT = 800.0
PERSIST_SPACING_S = 30.0
PERSIST_RETENTION_S = 3 * 3600.0


# A track is drawn only from its last continuous stretch: a long silence or an implausible jump
# (a position glitch, or an aircraft that left coverage and came back far away) must not become a line.
BREAK_GAP_S = 300.0
BREAK_JUMP_KM = 150.0


def _jump_km(tr: _Trail, a: int, b: int) -> float:
    dlat = (tr.lat[b] - tr.lat[a]) / 1e5
    dlon = (tr.lon[b] - tr.lon[a]) / 1e5 * math.cos(math.radians(tr.lat[b] / 1e5))
    return math.hypot(dlat, dlon) * 111.2


class _Trail:
    __slots__ = (
        "airborne_seen",
        "alt",
        "gnd",
        "gs",
        "last_seen",
        "lat",
        "lon",
        "saved_t",
        "simplified",
        "t",
        "vr",
    )

    def arrays(self) -> list[array[Any]]:
        return [self.t, self.lat, self.lon, self.alt, self.gs, self.vr, self.gnd]

    def __init__(self) -> None:
        self.gnd = array("B")
        self.airborne_seen = False
        self.simplified = 0  # length of the thinned prefix
        self.saved_t = 0.0
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


def _keep_indices(
    t: Sequence[float], lat: Sequence[int], lon: Sequence[int], alt: Sequence[int]
) -> list[int]:
    """Douglas-Peucker over position and altitude; returns the indices to keep (always the ends)."""
    n = len(t)
    if n <= 2:
        return list(range(n))
    keep = [False] * n
    keep[0] = keep[-1] = True
    stack = [(0, n - 1)]
    while stack:
        i0, i1 = stack.pop()
        if i1 - i0 < 2:
            continue
        la0, lo0, la1, lo1 = lat[i0] / 1e5, lon[i0] / 1e5, lat[i1] / 1e5, lon[i1] / 1e5
        k = math.cos(math.radians((la0 + la1) / 2))
        dx, dy = (lo1 - lo0) * k, la1 - la0
        seg2 = dx * dx + dy * dy
        a0, a1 = alt[i0], alt[i1]
        best, best_e = -1, 1.0
        for i in range(i0 + 1, i1):
            px, py = (lon[i] / 1e5 - lo0) * k, lat[i] / 1e5 - la0
            if seg2 > 1e-12:
                u = max(0.0, min(1.0, (px * dx + py * dy) / seg2))
                ex, ey = px - u * dx, py - u * dy
            else:
                ex, ey = px, py
            e = math.hypot(ex, ey) / _POS_TOLERANCE_DEG
            if a0 != _NONE_I16 and a1 != _NONE_I16 and alt[i] != _NONE_I16:
                f = (t[i] - t[i0]) / (t[i1] - t[i0]) if t[i1] > t[i0] else 0.0
                e = max(e, abs(alt[i] * 25 - (a0 * 25 + f * (a1 - a0) * 25)) / _ALT_TOLERANCE_FT)
            if e > best_e:
                best, best_e = i, e
        if best >= 0:
            keep[best] = True
            stack.append((i0, best))
            stack.append((best, i1))
    return [i for i, kept in enumerate(keep) if kept]


class TrailStore:
    def __init__(
        self,
        retention_s: float = 2700.0,
        min_interval_s: float = 10.0,
        db_path: str | None = None,
        recent_s: float = 900.0,
        max_points: int = 1500,
        max_trails: int = MAX_TRAILS,
    ):
        self.retention_s = retention_s  # unseen for this long: the flight is over
        self.min_interval_s = min_interval_s
        self.recent_s = recent_s
        self.max_points = max_points
        self._db_path = db_path
        self._trails: dict[int, _Trail] = {}
        self._unsaved: list[tuple[int, float, int, int, int, int, int]] = []
        self._task: asyncio.Task[None] | None = None
        self.points = 0
        self.max_trails = max_trails
        self.evicted = 0  # trails dropped to make room for newly seen aircraft

    # -- recording --------------------------------------------------------------------

    def record(self, a: Aircraft, fix_time: float, now: float | None = None) -> bool:
        """Append a position if it is new enough. ``fix_time`` is when the position was observed."""
        now = time.time() if now is None else now
        tr = self._trails.pop(a.hex, None)  # re-inserted below: dict order is least-recently-seen first
        if tr is None:
            if len(self._trails) >= self.max_trails:
                oldest = next(iter(self._trails))
                self.points -= len(self._trails.pop(oldest).t)
                self.evicted += 1
            tr = _Trail()
        self._trails[a.hex] = tr
        tr.last_seen = now
        if tr.t:
            if fix_time - tr.t[-1] > self.retention_s or (
                tr.gnd[-1] and not a.on_ground and tr.airborne_seen
            ):
                self._reset(tr)  # a new flight: a long gap, or a take-off after a landing
            elif fix_time - tr.t[-1] < (60.0 if a.on_ground else self.min_interval_s):
                return False
        packed = _pack(a)
        tr.t.append(fix_time)
        tr.lat.append(packed[0])
        tr.lon.append(packed[1])
        tr.alt.append(packed[2])
        tr.gs.append(packed[3])
        tr.vr.append(packed[4])
        tr.gnd.append(1 if a.on_ground else 0)
        tr.airborne_seen = tr.airborne_seen or not a.on_ground
        self.points += 1
        if fix_time - tr.saved_t >= PERSIST_SPACING_S and len(self._unsaved) < 300_000:
            tr.saved_t = fix_time
            self._unsaved.append((a.hex, fix_time, *packed))
        self._compact(tr, fix_time)
        return True

    def _reset(self, tr: _Trail) -> None:
        self.points -= len(tr.t)
        for arr in tr.arrays():
            del arr[:]
        tr.simplified = 0
        tr.airborne_seen = False

    def on_tile_update(self, _tile: object, aircraft: list[Aircraft], fetched_at: float) -> None:
        for a in aircraft:
            self.record(a, fetched_at - a.position_age_s, fetched_at)

    def _compact(self, tr: _Trail, now: float) -> None:
        """Thin the part older than ``recent_s``; enforce the point cap."""
        split = bisect.bisect_left(tr.t, now - self.recent_s)
        if split - tr.simplified >= _SIMPLIFY_EVERY:
            idx = _keep_indices(tr.t[:split], tr.lat[:split], tr.lon[:split], tr.alt[:split])
            for arr in tr.arrays():
                thinned = arr[:0]
                thinned.extend(arr[i] for i in idx)
                arr[:split] = thinned
            self.points -= split - len(idx)
            tr.simplified = len(idx)
        if len(tr.t) > self.max_points:  # a very long flight: keep every other old point
            old = max(tr.simplified, 2)
            before = len(tr.t)
            for arr in tr.arrays():
                arr[:old] = arr[0:old:2]
            tr.simplified = len(range(0, old, 2))
            self.points -= before - len(tr.t)

    def sweep(self, now: float | None = None) -> None:
        """Forget aircraft that have not been seen for a whole ``retention_s``."""
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

    def recent(
        self,
        accept: Callable[[int, float, float], bool],
        rank: Callable[[float, float], float] | None = None,
        limit: int = 400,
        window_s: float = 1800.0,
        max_points: int = 40,
        max_age_s: float = 900.0,
        now: float | None = None,
    ) -> tuple[int, list[tuple[int, float, list[tuple[float, float, int | None]]]]]:
        """The last ``window_s`` seconds of the trails whose aircraft are still on the map.

        ``accept(hex, lat, lon)`` is asked about the last known position first, so rejected aircraft
        cost nothing more. Of the accepted ones the ``limit`` with the lowest ``rank(lat, lon)`` are
        returned (all, in insertion order, without a rank), each thinned to at most ``max_points``
        evenly spaced fixes (always the newest) as ``(lon, lat, altitude_ft)``. The first value is how
        many were accepted. Reads memory only; it never causes an upstream request.
        """
        now = time.time() if now is None else now
        found: list[tuple[float, int, _Trail]] = []
        for hex_, tr in self._trails.items():
            if len(tr.t) < 2 or now - tr.t[-1] > max_age_s:
                continue
            la, lo = tr.lat[-1] / 1e5, tr.lon[-1] / 1e5
            if accept(hex_, la, lo):
                found.append((rank(la, lo) if rank else 0.0, hex_, tr))
        total = len(found)
        if rank:
            found.sort(key=lambda it: it[0])
        out: list[tuple[int, float, list[tuple[float, float, int | None]]]] = []
        for _r, hex_, tr in found[:limit]:
            first = bisect.bisect_left(tr.t, tr.t[-1] - window_s)
            idx = list(range(first, len(tr.t)))
            for k in range(len(idx) - 1, 0, -1):  # start after the last data gap or position jump
                a, b = idx[k - 1], idx[k]
                if tr.t[b] - tr.t[a] > BREAK_GAP_S or _jump_km(tr, a, b) > BREAK_JUMP_KM:
                    idx = idx[k:]
                    break
            if len(idx) < 2:
                continue
            if len(idx) > max_points:
                step = (len(idx) - 1) / (max_points - 1)
                idx = [idx[round(i * step)] for i in range(max_points)]
            pts = [
                (tr.lon[i] / 1e5, tr.lat[i] / 1e5, None if tr.alt[i] == _NONE_I16 else tr.alt[i] * 25)
                for i in idx
            ]
            out.append((hex_, tr.t[-1], pts))
        return total, out

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
            rows = await asyncio.to_thread(self._load_sync, now - PERSIST_RETENTION_S)
        except sqlite3.Error:
            log.exception("could not load trail history")
            rows = []
        for hex_, t, lat, lon, alt, gs, vr in rows:
            tr = self._trails.setdefault(hex_, _Trail())
            if tr.t and t - tr.t[-1] > self.retention_s:
                self._reset(tr)  # an older flight of the same aircraft
            tr.t.append(t)
            tr.lat.append(lat)
            tr.lon.append(lon)
            tr.alt.append(alt)
            tr.gs.append(gs)
            tr.vr.append(vr)
            tr.gnd.append(0)
            tr.airborne_seen = True
            tr.last_seen = t
            tr.saved_t = t
            self.points += 1
        for tr in self._trails.values():
            if tr.t:
                self._compact(tr, tr.t[-1])
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
            await asyncio.to_thread(self._save_sync, rows, time.time() - PERSIST_RETENTION_S)
        except sqlite3.Error:
            log.exception("could not checkpoint trails")
            if len(rows) < 100_000:
                self._unsaved = rows + self._unsaved
            else:
                log.warning("dropping %d unsaved trail rows after a failed checkpoint", len(rows))

    async def stop(self) -> None:
        if self._task:
            self._task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self._task
            self._task = None
        await self.checkpoint()
