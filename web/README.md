# Web

Svelte 5 + TypeScript + MapLibre GL. Aircraft are drawn on a WebGL2 canvas above the basemap and
dead-reckoned every frame from track and ground speed, so they keep moving between updates and
are never faded by age.

```bash
npm ci
npm run dev            # needs the server on 127.0.0.1:8000 (DEMO_MODE=1 python -m flightmap)
npm run typecheck && npm test
npm run test:e2e       # builds, then runs Playwright against the real server and a fixture upstream
                       # (ports 9140/9141; override with E2E_API_PORT / E2E_UPSTREAM_PORT)
node scripts/perf.mjs  # frame-time probe with 15,000 synthetic aircraft (GPU=1 for the real GPU)
```

URL parameters: `c=lat,lon`, `z=zoom`, `s=icao24` (selected aircraft), `bm=offline` (bundled
Natural Earth basemap, no network), `e2e=1` (exposes test hooks on `window.__flights`).

The CI workflow is staged in `ci/web-workflow.yml` (see the note in the server README).
