# Server

Starlette API that serves aircraft positions as compact binary tiles.

```bash
python -m venv .venv && . .venv/bin/activate
pip install -r requirements-dev.txt
DEMO_MODE=1 python -m flightmap          # synthetic traffic, no network needed
python -m unittest discover -s tests -t .
ruff check . && npx pyright               # after: npm ci
```

Configuration is read from environment variables only: `HOST`, `PORT`, `BASE_PATH`,
`DEMO_MODE`, `GZIP` (set to `0` behind nginx), `STATIC_DIR`, `ADSBLOL_URL`,
`UPSTREAM_BUDGET_RPS` (upper bound, default 0.2; lowered automatically on HTTP 429),
`TILE_TTL_S`, `MAX_TILE_AGE_S` (default 900), `GHOST_AGE_S` (default 1800, see "Freshness"), `USER_AGENT_CONTACT`.

## API

`GET /api/v1/aircraft?x0=&y0=&x1=&y1=` returns the aircraft in an inclusive rectangle of
5 degree tile indices (`tx = floor((lon + 180) / 5)`, `ty = floor((lat + 90) / 5)`; `x0 > x1`
wraps the antimeridian) as `application/octet-stream`, see `flightmap/codec.py` for the layout.
The response has a strong `ETag` and answers 304 when no tile in the rectangle changed. Headers
`X-Tiles` and `X-Pending` say how many requested tiles have data and how many are still being
fetched. `GET /api/v1/status` reports provider health, cache size and tile ages. The scheduler internals (hot tile count, effective refresh interval, current request rate) are served at `GET /api/v1/internal/status` to localhost only: query it on the server with `curl http://127.0.0.1:8100/api/v1/internal/status`, because the proxy blocks that path.

Everything below reads server memory only and never causes a request to ADSB.lol:

- `GET /api/v1/trails?w=&s=&e=&n=[&window=1800][&limit=400][&cs=][&air=][&ty=][&alt=min-max][&gnd=0]`
  recent tracks of the aircraft in a box (`window` 60 to 3600 seconds, `limit` at most 600). Each
  track is thinned to at most 40 fixes: `{"h": "48ae23", "p": [[lon, lat, altitude_hundreds_ft], ...]}`.
  The nearest `limit` aircraft to the centre are returned and `total` says how many matched.
- `GET /api/v1/aircraft` also accepts `cs` (callsign prefixes, comma or space separated, up to 8), `air` (airline designator) and
  `ty` (comma separated ICAO types, `A32*` for a family). They only matter for thinned (low
  zoom) responses, where they are applied before thinning and are part of the ETag.
- `GET /api/v1/types[?q=]` the most common tracked aircraft types, or the types matching a code
  prefix or name fragment, with how many are tracked. `GET /api/v1/type-hexes?ty=` lists the
  ICAO24 of the tracked aircraft of those types (the binary tiles do not carry the type).
- `GET /api/v1/airports/{code}` has the OurAirports metadata (type, region, runways, frequencies,
  links), counts of arriving, departing and parked aircraft within 10 nm, and, for aircraft whose
  route the server already holds, their origin and destination.

## Freshness and the request budget

The public API allows about 0.15 requests per second, and the default plan (183 traffic tiles) wants 0.35,
so the scheduler decides who gets the budget. In this order:

1. Tiles viewers look at, but only up to 65 percent of the rate (`HOT_SHARE`). Without a cap, a single
   zoomed-in viewer refreshed its four tiles every 27 s and the background plan never ran at all.
2. The background plan. Per priority class (60 / 30 / 10 percent) it keeps the busiest tiles that the budget can
   hold on the map; the rest of an over-full class is a tail that is only fetched when nothing else is due,
   so the budget is never idle. Busier tiles are refreshed sooner (a tile with 60 aircraft about 3 times as
   often as one with 2). Tiles that stay empty are looked at rarely, as before.
3. Whatever is left goes back to the viewers.

**Ghosts.** Tile data is served, with its fetch time, for `GHOST_AGE_S` (default 1800 s) instead of dropping
out at `MAX_TILE_AGE_S` (900 s). Each request buys at most that much display time, so the same budget keeps
about twice as many tiles on the map. `GET /api/v1/status` keeps `max_age_s` as it was (a client that only
knows it still hides data after 900 s) and adds `ghost_age_s`; the client decides how to draw data in
between. Memory: a held aircraft is about 250 to 350 bytes (record plus encoded tile), and tile data is
freed after `1.1 * GHOST_AGE_S` instead of `1.5 * MAX_TILE_AGE_S`, that is 1980 s instead of 1350 s: with
the live 6,700 aircraft this adds about 1 to 2 MB (roughly 290 instead of 200 tile entries at most).

**HTTP 429.** A refused tile rests 15 s or more (doubling to 2 minutes, jittered), so it is not tried again
right away. Without a `Retry-After` header, consecutive refusals pause all fetching for 4 s, 8 s, 16 s and so
on up to 90 s (jittered); a success resets that. Two refusals within a minute lower the request rate by
20 percent and remember the rate that drew them as a ceiling for 10 minutes: recovery is quick (0.02 req/s
every 20 s) up to 90 percent of the ceiling, then it only probes upwards (0.005 req/s every 2 minutes).

The operator's status (`/api/v1/internal/status`) has, per priority class and for `demand` tiles (asked for
by viewers only), the tiles with data, how many are within `max_age_s` (`fresh`) and between that and
`ghost_age_s` (`ghost`), median and oldest age and how many are `demoted` to the tail, and
`upstream_10min`: requests, HTTP 429s, other errors and the 429 share over the last 10 minutes.

`python scripts/simulate_freshness.py --baseline master` replays the real scheduler on a fake clock against a
synthetic upstream (no network, deterministic) and compares a git revision with the working tree: see the
docstring for its assumptions. It measures what the scheduler does with a budget, not what ADSB.lol does.

## Data sources

Positions come from [ADSB.lol](https://adsb.lol) (data licensed ODbL 1.0; attribution required in
the UI). Tiles are fetched on demand, once per refresh interval however many viewers look at
them, under a global request budget. See `docs/design.md` for the reasoning, including the
sources that were evaluated and left out.
