# Bigger tiles: study and decision (no behaviour change)

Question: do larger or hierarchical tiles (for example 10 degree tiles when zoomed out) show more aircraft per
upstream request within the 0.15 req/s budget and the ADSB.lol radius limit?

## What the server requests

One `GET /v2/point/{lat}/{lon}/{radius_nm}` per 5 degree tile (`providers/adsblol.py`), radius = distance from
the tile centre to the farthest corner x 1.03, capped at 250 nm (`tiles.MAX_RADIUS_NM`). The response is
filtered to the tile. For the 183 default plan tiles the radius is 163 to 219 nm. ADSB.lol returned 774 aircraft
for a 250 nm circle over central Europe (docs/design.md), so there is no practical result cap below that.

## Geometry (run `python server/scripts/tile_geometry.py`)

The binding constraint is the 250 nm circle, not the budget. A 10 degree tile needs a radius of about 424 nm
at the equator (and about 300 nm even at 60 N) and cannot be fetched in one request; it would need four
requests, which is exactly what four 5 degree tiles cost today. A hierarchical or coarser grid therefore adds no
data, only a different cache key. The largest square that fits is about 5.8 degrees at the equator, 6.9 at 45 N.

The only merge that fits is two adjacent columns (10 x 5 degrees), and only in rows with a far-edge latitude of
55 and beyond (or -60 and beyond):

| tiles per request | rows where it fits | plan requests (183 tiles) |
|---|---|---|
| 1 x 1 (today) | all | 183 |
| 2 x 1 | lat >= 55 N / <= -60 | 171 (-6.6%, all in sparse high-latitude tiles) |
| 3 x 1 | lat >= 65 N / <= -80 | 181 |
| 2 x 2 | none | 183 |

The busy mid-latitude core (Europe 35 to 55 N, US, East Asia) is excluded, so the plan shrinks by 12 requests
that mostly serve thin traffic. That is a small freshness gain (about 6% of cycle time at best) for a scheduler
change that touches per-tile TTL, 429 cooldown and ghost state, so `simulate_freshness.py` was not extended: a
merged request cannot move its numbers beyond that bound.

## Decision

No change. Grid constants (`TILE_DEG = 5`, `COLS`, `ROWS`) stay identical on client and server, API unchanged.
If the budget is ever the limit again, better levers are the traffic mask (skip empty tiles) and priority
classes, both already in place.
