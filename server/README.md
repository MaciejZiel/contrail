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
`TILE_TTL_S`, `USER_AGENT_CONTACT`.

## API

`GET /api/v1/aircraft?x0=&y0=&x1=&y1=` returns the aircraft in an inclusive rectangle of
5 degree tile indices (`tx = floor((lon + 180) / 5)`, `ty = floor((lat + 90) / 5)`; `x0 > x1`
wraps the antimeridian) as `application/octet-stream`, see `flightmap/codec.py` for the layout.
The response has a strong `ETag` and answers 304 when no tile in the rectangle changed. Headers
`X-Tiles` and `X-Pending` say how many requested tiles have data and how many are still being
fetched. `GET /api/v1/status` reports provider health, cache size and the current request rate.

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

## Data sources

Positions come from [ADSB.lol](https://adsb.lol) (data licensed ODbL 1.0; attribution required in
the UI). Tiles are fetched on demand, once per refresh interval however many viewers look at
them, under a global request budget. See `docs/design.md` for the reasoning, including the
sources that were evaluated and left out.
