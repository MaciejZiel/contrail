"""Zoom-dependent thinning: at low zoom keep one representative aircraft per screen-sized grid cell."""

from __future__ import annotations

from .models import Aircraft

# Cell size in degrees per integer map zoom: a cell is about 36 CSS pixels wide on a map whose world
# is 512 * 2**zoom pixels across (36 * 360 / (512 * 2**zoom)). At most one aircraft is drawn per cell, so a
# 1280 x 800 viewport never shows more than about 800 aircraft below zoom 7.
CELL_DEG_BY_ZOOM: dict[int, float] = {2: 6.3, 3: 3.2, 4: 1.6, 5: 0.8, 6: 0.4}
FULL_DENSITY_ZOOM = 7


def level_for_zoom(zoom: int | None) -> int:
    """0 means no thinning; otherwise the integer zoom (clamped to 2..6) selecting the cell size."""
    if zoom is None or zoom >= FULL_DENSITY_ZOOM:
        return 0
    return max(2, zoom)


def _priority(a: Aircraft) -> tuple[int, int, int, float]:
    return (
        1 if a.emergency else 0,
        0 if a.on_ground else 1,
        a.altitude_ft if a.altitude_ft is not None else -1,
        -a.position_age_s,
    )


def thin[T](items: list[tuple[T, Aircraft]], level: int) -> list[tuple[T, Aircraft]]:
    """Keep the highest-priority aircraft in each grid cell (emergency, airborne, highest, freshest)."""
    if level == 0:
        return items
    cell = CELL_DEG_BY_ZOOM[level]
    best: dict[tuple[int, int], tuple[tuple[int, int, int, float], T, Aircraft]] = {}
    for owner, a in items:
        key = (int(a.lat // cell), int(a.lon // cell))
        pr = _priority(a)
        cur = best.get(key)
        if cur is None or pr > cur[0]:
            best[key] = (pr, owner, a)
    return [(owner, a) for _p, owner, a in best.values()]
