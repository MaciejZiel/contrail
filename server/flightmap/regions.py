"""Background coverage plan: regions with a priority and a refresh target.

The tile cache always serves what viewers look at first (about every 10 s, anywhere in the world).
Spare request budget goes to these regions, shared between priority classes by weight so a busy
high-priority region cannot starve the others. Targets are best effort: with a public API that
answers about 0.15 requests per second they are an ordering and a rate, not a promise.
"""

from __future__ import annotations

from dataclasses import dataclass

from .tiles import Tile, parse_region

# share of the background capacity per priority class
CLASS_WEIGHTS: dict[int, float] = {1: 0.6, 2: 0.3, 3: 0.1}


@dataclass(frozen=True, slots=True)
class Region:
    name: str
    bounds: str  # "south,north,west,east" or "all"
    priority: int
    interval_s: float


@dataclass(frozen=True, slots=True)
class PrefetchSpec:
    priority: int
    interval_s: float


# A public API that allows roughly 0.15 requests per second cannot keep a continent, let alone the world,
# fresh, so the default plan is short: Europe first, then the two busiest US halves, then a few of the
# busiest hubs of other continents. Everything else is fetched only when somebody looks at it.
DEFAULT_REGIONS: tuple[Region, ...] = (
    Region("europe", "35,72,-25,45", 1, 300.0),
    Region("us_east", "24,50,-90,-65", 2, 900.0),
    Region("us_west", "30,50,-125,-100", 2, 900.0),
    Region("hub_dubai", "22,28,52,58", 3, 1800.0),
    Region("hub_singapore", "-2,4,100,106", 3, 1800.0),
    Region("hub_hong_kong", "20,26,111,117", 3, 1800.0),
    Region("hub_shanghai", "28,34,118,124", 3, 1800.0),
    Region("hub_beijing", "37,43,113,119", 3, 1800.0),
    Region("hub_tokyo", "33,38,137,142", 3, 1800.0),
    Region("hub_delhi", "26,31,75,80", 3, 1800.0),
    Region("hub_mumbai", "17,22,70,75", 3, 1800.0),
    Region("hub_sao_paulo", "-26,-20,-49,-43", 3, 1800.0),
    Region("hub_johannesburg", "-29,-23,25,31", 3, 1800.0),
    Region("hub_sydney", "-36,-31,148,153", 3, 1800.0),
)


def parse_regions(raw: str) -> tuple[Region, ...]:
    """``name:south,north,west,east:priority:interval_s;...`` ("all" instead of bounds for the world).

    An empty string means the defaults, ``off`` disables background prefetching.
    """
    text = raw.strip()
    if not text:
        return DEFAULT_REGIONS
    if text.lower() == "off":
        return ()
    out: list[Region] = []
    for part in text.split(";"):
        fields = part.strip().split(":")
        if len(fields) != 4:
            raise ValueError(f"bad region {part!r}: expected name:bounds:priority:interval_s")
        name, bounds, prio, interval = fields
        out.append(
            Region(name.strip(), bounds.strip(), max(1, min(3, int(prio))), max(10.0, float(interval)))
        )
    return tuple(out)


def build_plan(regions: tuple[Region, ...], traffic_tiles: frozenset[Tile]) -> dict[Tile, PrefetchSpec]:
    """Tile -> spec. Only tiles with airports (traffic tiles) are planned; overlaps keep the best spec."""
    plan: dict[Tile, PrefetchSpec] = {}
    for region in regions:
        tiles = (
            traffic_tiles
            if region.bounds == "all"
            else {t for t in parse_region(region.bounds) if t in traffic_tiles}
        )
        spec = PrefetchSpec(region.priority, region.interval_s)
        for tile in tiles:
            cur = plan.get(tile)
            if cur is None or (spec.priority, spec.interval_s) < (cur.priority, cur.interval_s):
                plan[tile] = spec
    return plan
