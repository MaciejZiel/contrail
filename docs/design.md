# Contrail: rebuild design

Status: proposal, awaiting owner approval. No implementation code is part of this PR.

## Amendments after terms verification (supersede conflicting text below)

Terms were read from primary sources before implementation. They changed the design:

1. **OpenSky is not a default source.** Its Terms of Use and Data License Agreement (https://opensky-network.org/about/terms-of-use) state that operational use of the REST API in any live product or service requires a previous written agreement, even for non-profits, and that the data licence is for non-profit research and education. A public live tracker is operational use. OpenSky therefore stays in the codebase only as an **opt-in provider** (`OPENSKY_ENABLED=1` plus `OPENSKY_CLIENT_ID` / `OPENSKY_CLIENT_SECRET`, from env vars only), to be switched on only if the owner holds a written agreement. It is off by default. Where the text below says "world layer from OpenSky", read "optional".
2. **airplanes.live is left out.** Its terms page returned 403 and no official terms could be verified (the API archive states only a 1 request/s limit). Unverifiable terms mean not added.
3. **adsbdb.com is left out.** Its README states that the flight route data may not be copied, published or incorporated into other databases without permission, and the aircraft data comes from PlaneBase. Route data comes only from the ADSB.lol `routeset` endpoint; aircraft type and registration come from the ADSB.lol state records themselves (`r`, `t`, `desc`).
4. **Planespotters photos are fetched by the browser, not by our server.** The Photo API terms prohibit proxying or rewriting URLs, passing images on to other clients, and re-exposing the API's data through our own API. Browsers must call the CORS-enabled API from a page with a valid Origin; thumbnails must be used from the returned URLs unchanged, link to the returned photo page with a plain anchor (no `nofollow`), and show the photographer in text next to the image; JSON may be cached up to 24 h; the photo area must be free to all users. The backend has no photo endpoint.
5. **World view without OpenSky.** ADSB.lol has no global endpoint (`/v2/all` returns 503). The world view is a mosaic: the same tile cache is used at every zoom, the client asks for the tiles intersecting its viewport (capped), and the server only fetches tiles from a precomputed set of "traffic tiles" (tiles containing a large or medium airport from OurAirports, plus tiles where aircraft were observed). Tiles are refreshed oldest-first under the global request budget, so a world view fills in progressively and each tile carries its age; the effective TTL stretches with demand (a full world view cycles in several minutes). Dead reckoning keeps aircraft moving, and the freshness chip states the age honestly.
6. **Tile size is 5 x 5 degrees** (half-diagonal ~212 nm at the equator, inside the 250 nm `point` limit; ADSB.lol returned 774 aircraft for a 250 nm circle over central Europe, so there is no 1,000 cap to subdivide for).
7. **Fixtures are synthetic only.** The fixture upstream serves synthetic data shaped exactly like each real API response; no ADSB.lol extract is committed.
8. **Basemap:** OpenFreeMap vector tiles with our own dark style; attribution "OpenFreeMap, (c) OpenMapTiles, data from OpenStreetMap" (ODbL).
9. **Storage:** SQLite plus in-memory ring buffers. Public copy calls the host a self-hosted server.

## 1. Why a rebuild

A QA audit (evidence in the review thread) found the current app fundamentally broken, not merely buggy:

- The map looks empty: aircraft fade with snapshot age while anonymous OpenSky only refreshes the world every ~20 minutes. The WebGL world layer is invisible (DPR handling in `u_resolution` / `gl_PointSize`).
- The flight inspector returns 500 on every open, replay is empty outside demo mode, search loops requests forever, and one server-side workspace profile overrides URL state for every browser.
- A 3.4 MB uncompressed snapshot is polled every 30 s, with no gzip or useful caching; 2-4 requests happen per pan; SQLite grows ~0.7 GB/day; Flask runs on its dev server; `App.svelte` has 9,054 lines.

The cause is breadth: dozens of features (workspaces, alerts, webhooks, notes, watchlists, embeds, reports, replay, simple/advanced modes) on top of a data pipeline that cannot supply fresh positions. The plan is to keep one excellent core: **a fast, smooth, honest live aircraft map with a good inspector, search and airport card**. Everything else is removed, not ported.

Goal: the quality bar of the best consumer flight trackers (smooth motion, instant interaction, clear panel, mobile-first), with our own visual identity. No third-party brand names, logos, icons, copy or styling are used; the icon set, palette and layout are designed here.

## 2. Data sources and legality

This section is engineering research, not legal advice. Items marked **(verify)** could not be confirmed from primary sources while writing and must be checked before the relevant PR merges.

### 2.1 Comparison

| | ADSB.lol | airplanes.live | OpenSky Network |
|---|---|---|---|
| Coverage | Community feeders, global, strong in EU/NA | Community feeders, global | Terrestrial receivers, global, thinner over oceans/remote areas |
| Query model | `GET /v2/point/{lat}/{lon}/{radius_nm}` (radius up to 250 nm), `/v2/hex`, `/v2/callsign`, `/v2/reg`, `/v2/type`, `/api/0/routeset` | Same ADSBExchange-v2-style API: point/radius, hex, callsign, reg | `/states/all` with bbox or global |
| Auth | None today; API keys for feeders planned | None | Anonymous or OAuth2 client credentials (free account) |
| Rate limit | No fixed number published; "dynamic based on load", 4xx means back off | Reported 1 request/s, up to ~1000 aircraft per query **(verify, secondary source)** | Credit based: anonymous 400/day, standard registered 4,000/day, active feeder 8,000/day. `/states/all` costs 1-4 credits by bbox area (global = 4). 429 includes `X-Rate-Limit-Retry-After-Seconds` |
| Resolution | ~1 s upstream, we poll slower | ~1 s | Anonymous 10 s, registered 5 s |
| Data licence | ODbL 1.0 (API data); API code BSD-3 | Free for non-commercial / educational use **(verify exact terms; no official page could be fetched)** | Research / non-commercial terms; credit the OpenSky Network **(verify wording on the account/terms page)** |
| Fit | Primary source for viewport tiles | Fallback for tiles (personal, non-commercial deployment only) | World layer and fallback |

### 2.2 ADSB.lol and the ODbL

ODbL 1.0 obligations that matter here:

- **Attribution** is required wherever the data or a produced work is presented. The UI footer and the About dialog credit "Aircraft data: ADSB.lol (ODbL 1.0)" with a link.
- **Share-alike** applies when we *publicly use a Derived Database* (a modified or combined database). Our design keeps the stored data to a short-lived in-memory/SQLite cache and 45-60 minute trails, never published as a dataset. We therefore expose **no bulk export or database dump endpoint** and only serve a rendered live view (a Produced Work). If the owner later wants public data downloads, those would have to be ODbL and attribute ADSB.lol; that is explicitly out of scope.
- We do not blend ADSB.lol data into a long-lived database that is redistributed. This is also why the old unbounded archive (and replay) is dropped.
- Test fixtures recorded from ADSB.lol are a small extract (<= ~300 aircraft, one snapshot) kept with an ODbL notice in `tests/fixtures/`. This is an insubstantial extract, but it should be an explicit owner decision (open question 3).

### 2.3 airplanes.live

Non-commercial use only. Used only as a fallback tile provider and only when the owner confirms the deployment is non-commercial and personal. Hard cap of 1 request/s, descriptive `User-Agent`, attribution in the UI ("airplanes.live"). If the project is ever monetised, this provider must be disabled (config flag `PROVIDERS` excludes it).

### 2.4 OpenSky: anonymous vs free registered account

Recommendation: **the owner registers a free OpenSky account and creates an API client** (OAuth2 client credentials; tokens last 30 min, refreshed automatically).

- Anonymous: 400 credits/day, a global `/states/all` costs 4, so ~100 calls/day (one every ~14 min). This is the root of the "empty map" symptom.
- Registered: 4,000 credits/day (10x) and 5 s resolution. A global call every 150 s costs 4 x 576 = 2,304 credits/day, leaving headroom. Refreshing the world every 2-3 minutes with dead reckoning looks live.
- Credentials come from env vars (`OPENSKY_CLIENT_ID`, `OPENSKY_CLIENT_SECRET`); never in the repo. The code degrades to anonymous behaviour (slower world refresh, clearly shown in the freshness indicator) without them.

### 2.5 Other providers (enrichment)

| Need | Provider | Notes |
|---|---|---|
| Photo | Planespotters public photo API, `GET /pub/photos/hex/{hex}` | Terms (secondary sources, **verify**): show photographer credit as "© name", thumbnail links back to the Planespotters photo page, do not store image bytes, cache JSON <= 24 h, honour 429, send a descriptive `User-Agent` (so the server fetches, the browser only loads the thumbnail URL from Planespotters' CDN). |
| Route, airline, type, registration | adsb.lol `routeset` (plausibility-checked), plus `adsbdb.com` aircraft/callsign lookup | adsbdb licence/ToS **(verify)** before adoption. Route is best-effort and labelled as such. |
| Airports | OurAirports CSV (public domain), loaded once into a local table | No per-viewport upstream calls. |
| METAR / TAF | aviationweather.gov API (US government data) | 5-10 minute cache per station. |
| Basemap | OpenFreeMap vector tiles (OpenStreetMap data, ODbL) rendered by MapLibre with our own dark style | Attribution "OpenFreeMap, (c) OpenMapTiles, data (c) OpenStreetMap contributors". Alternative: CARTO dark raster (non-commercial, attribution). Demo/CI uses a bundled Natural Earth (public domain) coastline style so offline screenshots and tests need no network. |

All upstream calls go through one provider layer with a descriptive `User-Agent`, timeouts, a token bucket per host, exponential backoff with jitter on 429/5xx, and a circuit breaker so one failing source degrades one field.

### 2.6 Polling strategy

Principle: **only fetch what someone is looking at, once, however many people look.**

**Tile mode (zoom >= ~7.5, roughly a country or smaller).**

- The world is divided into fixed 4 x 4 degree tiles (a tile fits inside a 250 nm radius circle; query radius = half-diagonal, rounded up). Tile key `x_y`.
- The client asks for a rectangle of tile indices. The server fetches each missing/stale tile with one `point` call, filters results to the tile, and stores the encoded tile in memory (versioned).
- Refresh is demand driven: a tile is "hot" for 60 s after any request; the poller refreshes hot tiles whose data is older than a TTL (default 10 s) by priority (most viewers first), under a global budget (default 1.5 req/s, env configurable; adaptive: when the queue exceeds the budget the effective TTL grows up to 30 s instead of exceeding the limit). No viewers means zero upstream traffic.
- Concurrent cold requests for the same tile are coalesced (single-flight). Many viewers of the same area multiply nothing.
- A response of >= ~1,000 aircraft (provider cap) triggers subdividing that tile into four 2-degree tiles.
- If the primary provider fails, the fallback provider serves the tile and the response reports the source.

Worst case on a desktop at the tile-mode threshold is about 4 x 3 = 12 tiles, ~1.2 req/s at a 10 s TTL, which fits the budget; mobile viewports are smaller.

**World mode (zoom < ~7.5).**

- A global OpenSky `/states/all` snapshot (every 150 s registered, every 15 min anonymous, only while at least one viewer is on the world layer or tile data is not available) provides roughly 8-15k aircraft.
- Client dead reckoning (section 3) keeps them moving between refreshes. Tile data for areas in view overrides world data for the same ICAO24 (fresher timestamp wins).
- The UI shows the data age and source in a small indicator, never by hiding aircraft.

**Honest limits.** In world mode, positions can be minutes old and sparse over oceans (OpenSky terrestrial coverage). The indicator says so. We do not scrape or crawl anything else.

## 3. Smooth motion

Each aircraft record carries position at time `t0 = receive_time - seen_pos`, track, ground speed and vertical rate.

- Predicted position at time `t` (flat-earth step, accurate for the short horizons involved):
  `lat = lat0 + (v * cos(trk) * dt) / R`, `lon = lon0 + (v * sin(trk) * dt) / (R * cos(lat0))`, `alt = alt0 + vrate * dt` (clamped at ground).
- Extrapolation is capped (default 120 s tile data, 6 min world data); beyond the cap the aircraft holds its last predicted position. It never disappears or fades.
- When a new update arrives, each aircraft stores `from` (where it was drawn at that instant) and `to` (new position), and blends between them over ~1.5 s with smoothstep, so there are no jumps and no rubber-banding. Rotation blends the same way along the shortest arc.
- The animation runs in the vertex shader (section 4) from per-aircraft attributes plus a time uniform, so there is zero per-frame CPU work regardless of aircraft count.
- Staleness is shown only as data: the "updated 8 s ago" chip in the top bar (green, amber after 30 s, red after 2 min with a one-line explanation) and per-aircraft "position age" in the panel. `prefers-reduced-motion` disables the blend and the camera follow animation but keeps motion.

## 4. Rendering

Decision: **MapLibre GL JS with a custom WebGL layer (instanced quads from a sprite atlas)**, not Leaflet and not a symbol layer for the aircraft.

Why not a pure symbol layer: updating a GeoJSON source at 10-60 Hz for 15k features re-tiles in a worker each time and cannot animate smoothly. A custom layer sits in the same GL context as the basemap, shares the camera and projection, and handles interaction (pan, zoom, rotation, tilt-free) for free.

Custom layer details:

- One draw call, instanced quads. Per-instance attributes (uploaded only on data updates): `from`/`to` position in Web Mercator relative to a per-update origin (float32 precision), `t0`, `trackFrom`/`trackTo`, `speed`, `vrate`, `category`, `altitude` (colour), `flags` (selected, filtered-out, on ground).
- Fragment colour from an altitude ramp texture (own palette, designed for contrast on the dark basemap and colour-blind safe); sprite chosen by category (light, jet, heavy, rotorcraft, glider, ground vehicle, other) from an atlas of our own SVG silhouettes, rotated by track in the shader.
- **DPR correct by construction**: sizes are specified in CSS pixels and converted using `map.getCanvas()` drawing-buffer size and `devicePixelRatio`; no `gl_PointSize` (quads instead, so there are no driver size limits).
- Hit testing: a CPU uniform grid over current predicted positions rebuilt at update time (and lazily per click), giving O(1) nearest-aircraft lookup with a 12 px touch tolerance. Hover highlight on desktop.
- Selected aircraft: highlight ring, plus a separate GeoJSON line layer for the trail (altitude-coloured segments) and a dashed projected path of the next ~2 minutes. Callsign labels use a regular symbol layer limited to the nearest ~300 aircraft above zoom 8, refreshed at 1 Hz.
- Airports: a symbol layer fed by a compact catalog (large and medium airports, ~150 KB gzipped, fetched once, cached long).
- Targets: 60 fps pan/zoom with 15,000 aircraft on a mid-range laptop (integrated GPU), >= 30 fps on a recent phone; first aircraft visible < 2 s after load on a warm server. These are measured in CI-adjacent perf scripts (section 8) and reported in the PRs.
- No WebGL2: a clear message with a fallback to a short list of nearby aircraft is out of scope; we show the message only.

## 5. Core features (the whole product)

1. **Live map** (section 4), dark theme, attribution control, locate-me button, zoom controls.
2. **Aircraft panel**: click or tap an aircraft. Content: photo (Planespotters credit and link), callsign, airline, type, registration, ICAO24, route (from/to with progress bar when both known), live altitude / ground speed / vertical rate / track / squawk, position age, small chart of altitude, speed and vertical rate over the available history, trail on the map. Each section loads independently with its own skeleton and error state.
3. **Search** (callsign, registration, ICAO24, airport name/IATA/ICAO/city, airline name or callsign prefix): a combobox with grouped results, 200 ms debounce, `AbortController`, minimum 2 characters, keyboard navigation, no reactive request loops (requests only start from the input handler). Aircraft results zoom to and select the aircraft; airports open the airport card.
4. **Airport card**: name, codes, elevation, METAR (decoded wind/visibility/ceiling/temperature plus raw text) and TAF if available, and "Nearby now": aircraft within ~10 nm that are on ground or low and descending/climbing, labelled as inferred (no schedule data is claimed; real arrivals/departures boards are out of scope).
5. **Filters** (small popover): altitude range, airline (callsign prefix or name), hide ground traffic. Applied in the shader/attributes without refetching.
6. **Shareable URL state**: `?c=lat,lon&z=zoom&s=icao24&f=alt:0-12000,air:RYR,gnd:0`. Updated with `history.replaceState` (throttled), restored on load. No server-side state, so no profile can override a URL.
7. **About / attribution** dialog with all sources and licences.

**Removed entirely:** workspace profiles, saved views, alerts, webhooks, notes, watchlists, embed mode, print reports, CSV export, simple/advanced modes, launchers, replay timeline, aircraft clustering UI, traffic intelligence boards. Replay is dropped: doing it reliably needs a long-lived archive (an ODbL share-alike and storage cost problem, section 2.2) and it duplicated work the live view must do well first. It can return later only as a short rolling window if cheap.

## 6. Backend

**Decision: Starlette + uvicorn (pure Python), not Flask+gunicorn and not FastAPI.**

- Async fits the shared poller, request coalescing and streaming enrichment calls; one process, one event loop.
- FastAPI pulls in pydantic v2, whose `pydantic-core` is a Rust extension with no guaranteed Android/aarch64 wheel; Starlette, uvicorn (without `[standard]`, so no `uvloop`/`httptools`), `httpx`, `h11`, `anyio` are pure Python and run on Python 3.12-3.14 on the self-hosted server. Types use dataclasses/`TypedDict`, checked with mypy and ruff; no native wheels anywhere.
- Single worker process by design: the tile cache and trail buffers live in process memory. Capacity is dominated by serialisation; encoded tiles are cached so request handling is a dictionary lookup.
- Config entirely via env vars: `HOST`, `PORT`, `BASE_PATH`, `PROVIDERS`, `UPSTREAM_BUDGET_RPS`, `TILE_TTL_S`, `OPENSKY_CLIENT_ID/SECRET`, `DATA_DIR`, `DEMO_MODE`, `UPSTREAM_*_URL` (used by tests and demo to point at a fixture upstream).

**Payloads.** Compact binary (`application/octet-stream`), little endian, fixed record per aircraft, then a short string table:

| field | bytes | encoding |
|---|---|---|
| icao24 | 3 | raw |
| lat, lon | 4 + 4 | int32, 1e-5 degree |
| track | 2 | uint16, 0.1 degree (0xFFFF = unknown) |
| ground speed | 2 | uint16, 0.1 kt |
| barometric altitude | 2 | int16, 25 ft steps (sentinel for ground / unknown) |
| vertical rate | 2 | int16, 64 ft/min steps |
| category | 1 | enum |
| flags | 1 | on ground, source, emergency squawk |
| position age | 1 | seconds, saturating |
| callsign | 8 | ASCII, space padded |

About 30 bytes per aircraft: 15k aircraft is ~450 KB raw, ~300 KB gzipped, versus 3.4 MB of JSON today, and tile mode typically ships a few thousand aircraft. Parsing is a typed-array read in a worker.

**Endpoints (`/api/v1`).**

- `GET /aircraft?x0=&y0=&x1=&y1=` tile-index rectangle of the current tile grid; returns concatenated per-tile blocks plus headers `X-Data-Time`, `X-Source`.
- `GET /world` global snapshot.
- `GET /aircraft/{hex}` live state and cached identity fields; `/aircraft/{hex}/photo`, `/route`, `/trail` as independent endpoints.
- `GET /search?q=`; `GET /airports/catalog` (static, long cache); `GET /airports/{icao}` (+ METAR, nearby traffic).
- `GET /health` and `GET /status` (provider state, budget usage, cache sizes, last update age).

**Caching.** Every snapshot response has a strong `ETag` derived from the tile versions it contains, `Cache-Control: public, max-age=2, stale-while-revalidate=5`, and 304 handling that does no encoding work. nginx adds `gzip on` for the binary type, `proxy_cache` with `proxy_cache_lock` and a 2 s micro-cache so N viewers produce one backend hit, and long immutable caching for hashed static assets. Brotli is used only if the host nginx build has it.

**Provider isolation.** Each enrichment (photo, route, aircraft identity, METAR) has its own timeout, cache, negative cache and circuit breaker. A failure returns `{ "ok": false, "reason": ... }` for that field only; the endpoint never 500s because one upstream returned an empty body or a 201. The known bug (`.json()` on an empty 201) becomes a test.

**Storage.** Stdlib `sqlite3` (WAL), no extra service, no native dependency; the shared PostgreSQL instance is not required. Contents: airport/airline tables (loaded from the public datasets at start), small caches with TTLs, and trail points. Trails are kept in per-aircraft in-memory ring buffers (compact `array` types), recorded only for aircraft in hot tiles at >= 10 s spacing, retained 45-60 minutes, checkpointed to SQLite so a restart keeps recent trails, and purged by a timer. No payload blobs. Expected size is tens of MB, not 0.7 GB/day. When history for a selected aircraft is shorter than a few minutes and OpenSky credentials exist, the trail is backfilled from OpenSky `/tracks` (cached).

**Demo mode** stays: a synthetic upstream (great-circle flights between real airports, realistic categories, altitudes and speeds) implemented as an upstream-shaped provider, so the rest of the stack runs unchanged. It powers CI, offline screenshots and `docker compose up` without network.

Docker/compose stay for local dev and CI only. `deploy/termux/` holds `start.sh`, `env.example`, an nginx location snippet and the README "Self-hosting on Termux" section (static frontend via nginx, backend on 127.0.0.1, configurable port and base path).

## 7. Frontend

Svelte 5 + TypeScript + Vite, MapLibre GL JS, no UI framework dependency. Plain CSS with design tokens (CSS variables, light/dark by `prefers-color-scheme`, dark default for the map).

```
web/src/
  main.ts, App.svelte               (< 150 lines, composition only)
  map/       MapView.svelte, aircraftLayer.ts (custom GL layer), shaders.ts,
             sprites.ts, hitGrid.ts, trailLayer.ts, airportLayer.ts, style.ts
  core/      codec.ts (binary parser, worker), deadReckoning.ts, tiles.ts,
             store.svelte.ts (aircraft, selection, filters), urlState.ts, api.ts
  panel/     AircraftPanel.svelte, Photo.svelte, RouteBar.svelte,
             TelemetryChart.svelte, AirportCard.svelte, BottomSheet.svelte
  search/    SearchBox.svelte, searchClient.ts
  filters/   FilterPopover.svelte
  ui/        Chip.svelte, FreshnessBadge.svelte, Attribution.svelte, icons
```

Rule: no file over ~300 lines; logic that can be pure lives in `core/` and is unit tested.

**Layout (mobile first).**

- Mobile: full-bleed map, floating search, filter button and freshness chip; selecting an aircraft opens a bottom sheet with three snap points (peek: callsign, route, key numbers; half: photo and telemetry; full: everything), drag handle, swipe-down to dismiss, safe-area insets respected.
- Desktop (>= 900 px): the same content as a 380 px side panel on the left; search on top; map controls on the right.
- Accessibility: keyboard reachable controls and panel, visible focus, ARIA combobox pattern for search, live-region announcements for selection, WCAG AA contrast, 44 px touch targets, reduced-motion support, text alternatives for the chart (a summary table). Aircraft on canvas are exposed through the search/selection UI and an accessible "nearby aircraft" list for keyboard users.

**Performance rules:** data parsing in a worker, no snapshot in `localStorage` (only small preferences), no reactive request loops (requests start from events and a single scheduler), at most one `/aircraft` request per pan (debounced on `moveend`, aborted when superseded, tile-index based so unchanged tiles are 304).

## 8. Testing and quality gates

- **Backend unit tests (pytest)**: codec round trip and boundary values, tile math, scheduler budget and coalescing, ETag/304, provider isolation (including the empty-201 regression), search ranking, trail retention. `ruff` and `mypy --strict` in CI.
- **Frontend unit tests (vitest)**: dead reckoning, binary codec against golden bytes produced by the backend, URL state round trip, hit grid, filter logic.
- **End to end (Playwright)**: runs the real backend and the real built frontend against a **fixture upstream server** (a tiny HTTP server replaying recorded ADSB.lol, OpenSky, Planespotters, adsbdb and METAR responses). The app code is unmodified; only `UPSTREAM_*_URL` env vars differ. Scenarios: map shows aircraft within seconds, aircraft keep moving between updates, click opens panel with all fields, a failing photo upstream degrades only the photo, search by callsign/registration/airport, filters, URL restore, mobile bottom sheet, canvas DPR 1 and 2 screenshots (non-blank pixel assertions), no request loops (request-count budget assertions).
- **Perf checks** (scripted, results published in PR descriptions and README): frame times with 15k synthetic aircraft, bytes per snapshot (raw/gzip), requests per pan, time to first aircraft, server memory.
- CI: lint, typecheck, unit, e2e on every PR; builds the static frontend.

## 9. Delivery as reviewable PRs

New code lives in `server/` and `web/` so `main` keeps working until the swap; the legacy `backend/` and `frontend/` are deleted in the last PR.

1. **This PR**: `docs/design.md`. Review and approve.
2. **PR 1, backend core**: providers (ADSB.lol, airplanes.live, OpenSky with OAuth), tile math, demand-driven scheduler and budget, binary codec, ETag/caching, `/aircraft`, `/world`, `/status`, demo upstream and fixture upstream, tests, CI job, licence records.
3. **PR 2, map core**: web skeleton (Svelte, TS, MapLibre), custom GL layer with dead reckoning, DPR-correct rendering, basemap style, URL state, freshness badge, attribution, first Playwright smoke test.
4. **PR 3, aircraft panel**: identity, photo, route, telemetry chart, trail (history buffers and SQLite checkpoint), independent enrichment endpoints and degradation tests.
5. **PR 4, search, airports and filters**: search index and combobox, airport catalog layer, airport card with METAR and nearby traffic, filter popover.
6. **PR 5, mobile and polish**: bottom sheet, accessibility pass, empty/error states, perf tuning against the budgets, `deploy/termux/`, nginx snippet, README with real screenshots, deletion of legacy code and workspace/alert/replay code, `FEATURES.md` rewrite.

Each PR is small enough to review in one sitting (target < 1,500 changed lines excluding lockfiles and fixtures), with many small logical commits, and records any new third-party dependency in `3rdparty_licenses.md` (all candidates below are permissive, versions pinned at least two weeks old):

| Component | Licence |
|---|---|
| Starlette, uvicorn, httpx (h11, httpcore, anyio, certifi) | BSD-3-Clause / MIT / ISC-style permissive (each confirmed per package in PR 1) |
| MapLibre GL JS | BSD-3-Clause |
| Svelte, Vite, vitest | MIT |
| Playwright | Apache-2.0 |
| ruff, mypy, pytest | MIT / MIT / MIT |
| OurAirports data | Public domain |
| Natural Earth data | Public domain |

Dropped dependencies: Flask, requests, python-dotenv, gunicorn, Leaflet, leaflet.markercluster.

## 10. Risks and decisions needed from the owner

1. **OpenSky account**: please register a free account and create an API client. It gives 10x credits and is what makes the world view usable. Without it the world layer refreshes every ~15 minutes.
2. **Non-commercial confirmation**: airplanes.live and OpenSky restrict commercial use. Confirm the deployment is personal/non-commercial.
3. **Fixtures**: OK to commit one small (<= ~300 aircraft) ADSB.lol extract with an ODbL notice? Alternative: fixtures from our own synthetic generator only (weaker as a "recorded" test).
4. **Basemap**: OpenFreeMap vectors with our own dark style (recommended) versus CARTO dark raster.
5. **Storage**: SQLite plus in-memory ring buffers (recommended, no extra service) versus the shared PostgreSQL. Trails are bounded either way.
6. **Unverified terms** flagged above (airplanes.live, Planespotters, adsbdb, OpenSky credit wording) are checked in the PR that first uses each source; a source whose terms cannot be verified is not added.
7. **Residual honesty limits**: world-mode positions can be minutes old, oceans are sparse, routes are best-effort, "nearby now" at airports is inferred, not a schedule.


## Outcome and deviations (written after implementation)

- OpenSky was **not implemented** (its terms need a written licence for a live service); airplanes.live and adsbdb were not used (see the amendments at the top). The world view is a mosaic of ADSB.lol tiles, dead-reckoned and age-labelled, with background prefetch for a configured region.
- The tile grid stayed at 5 x 5 degrees. Measurements showed that ADSB.lol rate limits (27 to 43 percent HTTP 429 at about 0.2 requests per second) make cold-start of a continent slow; variable-width tiles at high latitude (roughly half the requests) were left as future work.
- Rendering uses an own WebGL2 canvas above MapLibre rather than a MapLibre custom layer; positions are dead-reckoned on the CPU (3 to 5 ms per frame for 15,000 aircraft) instead of in the vertex shader, which avoids float precision problems at high zoom and keeps the code simple. Decoding is on the main thread.
- Photos use three tiers (airframe photo from the browser, a stored Wikimedia Commons type gallery, own illustrations); the server never touches Planespotters.
- Trails cover the whole current flight (thinned), not only 45 minutes; replay was dropped as planned.
- Storage is SQLite plus in-memory arrays; the shared PostgreSQL instance is not needed.
