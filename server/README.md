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
`UPSTREAM_BUDGET_RPS` (upper bound, default 0.35; lowered automatically on HTTP 429),
`TILE_TTL_S`, `USER_AGENT_CONTACT`.

## API

`GET /api/v1/aircraft?x0=&y0=&x1=&y1=` returns the aircraft in an inclusive rectangle of
5 degree tile indices (`tx = floor((lon + 180) / 5)`, `ty = floor((lat + 90) / 5)`; `x0 > x1`
wraps the antimeridian) as `application/octet-stream`, see `flightmap/codec.py` for the layout.
The response has a strong `ETag` and answers 304 when no tile in the rectangle changed. Headers
`X-Tiles` and `X-Pending` say how many requested tiles have data and how many are still being
fetched. `GET /api/v1/status` reports provider health, cache size and the current request rate.

## Data sources

Positions come from [ADSB.lol](https://adsb.lol) (data licensed ODbL 1.0; attribution required in
the UI). Tiles are fetched on demand, once per refresh interval however many viewers look at
them, under a global request budget. See `docs/design.md` for the reasoning, including the
sources that were evaluated and left out.
