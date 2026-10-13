# Third-party components

| source | name | license type | license link |
| --- | --- | --- | --- |
| https://pypi.org/project/gunicorn/26.2.0/ | gunicorn | MIT | https://github.com/benoitc/gunicorn/blob/master/LICENSE |
| https://pypi.org/project/starlette/1.7.0/ | starlette | BSD-3-Clause | https://github.com/encode/starlette/blob/master/LICENSE.md |
| https://pypi.org/project/uvicorn/0.54.0/ | uvicorn | BSD-3-Clause | https://github.com/encode/uvicorn/blob/master/LICENSE.md |
| https://pypi.org/project/anyio/4.15.1/ | anyio | MIT | https://github.com/agronholm/anyio/blob/master/LICENSE |
| https://pypi.org/project/h11/0.16.0/ | h11 | MIT | https://github.com/python-hyper/h11/blob/master/LICENSE.txt |
| https://pypi.org/project/click/8.5.0/ | click | BSD-3-Clause | https://github.com/pallets/click/blob/main/LICENSE.txt |
| https://pypi.org/project/idna/3.20/ | idna | BSD-3-Clause | https://github.com/kjd/idna/blob/master/LICENSE.md |
| https://pypi.org/project/typing-extensions/ | typing_extensions (installed by starlette/anyio on Python < 3.13) | PSF-2.0 | https://github.com/python/typing_extensions/blob/main/LICENSE |
| https://pypi.org/project/ruff/0.16.9/ | ruff (dev only) | MIT | https://github.com/astral-sh/ruff/blob/main/LICENSE |
| https://www.npmjs.com/package/pyright/v/1.1.414 | pyright (dev only) | MIT | https://github.com/microsoft/pyright/blob/main/LICENSE.txt |
| https://github.com/davidmegginson/ourairports-data | OurAirports data (airports.csv, used to derive server/flightmap/data/traffic_tiles.json) | Unlicense | https://github.com/davidmegginson/ourairports-data/blob/main/LICENSE |
| https://www.npmjs.com/package/maplibre-gl/v/6.11.2 | maplibre-gl | BSD-3-Clause | https://github.com/maplibre/maplibre-gl-js/blob/main/LICENSE.txt |
| https://www.npmjs.com/package/svelte/v/5.57.1 | svelte (build time; compiled into the app) | MIT | https://github.com/sveltejs/svelte/blob/main/LICENSE.md |
| https://www.npmjs.com/package/vite/v/7.3.6 | vite (build only) | MIT | https://github.com/vitejs/vite/blob/main/LICENSE |
| https://www.npmjs.com/package/@sveltejs/vite-plugin-svelte/v/6.2.4 | @sveltejs/vite-plugin-svelte (build only) | MIT | https://github.com/sveltejs/vite-plugin-svelte/blob/main/LICENSE |
| https://www.npmjs.com/package/svelte-check/v/4.7.6 | svelte-check (dev only) | MIT | https://github.com/sveltejs/language-tools/blob/master/LICENSE |
| https://www.npmjs.com/package/typescript/v/5.9.3 | typescript (dev only) | Apache-2.0 | https://github.com/microsoft/TypeScript/blob/main/LICENSE.txt |
| https://www.npmjs.com/package/vitest/v/5.0.2 | vitest (dev only) | MIT | https://github.com/vitest-dev/vitest/blob/main/LICENSE |
| https://www.npmjs.com/package/@playwright/test/v/1.63.0 | @playwright/test (dev only) | Apache-2.0 | https://github.com/microsoft/playwright/blob/main/LICENSE |
| https://www.npmjs.com/package/@types/node/v/24.19.0 | @types/node (dev only) | MIT | https://github.com/DefinitelyTyped/DefinitelyTyped/blob/master/LICENSE |
| https://www.naturalearthdata.com/downloads/110m-physical-vectors/ | Natural Earth 1:110m land and boundary lines (web/src/assets, offline basemap) | Public domain | https://www.naturalearthdata.com/about/terms-of-use/ |
| https://openfreemap.org | OpenFreeMap vector tiles and glyphs (hosted service, not vendored; OpenStreetMap data under ODbL) | ODbL-1.0 (data); free public instance | https://openfreemap.org/tos/ |
| https://github.com/vradarserver/standing-data | VRS standing data: airlines.csv and model-type CSVs (derived into server/flightmap/data/airlines.json and types.json); route JSON fetched at runtime from vrs-standing-data.adsb.lol | CC0-1.0 | https://github.com/vradarserver/standing-data/blob/main/LICENSE |
| https://www.planespotters.net/photo/api | Planespotters photo API (called from the visitor's browser only; thumbnails and photographer credit shown with a link back, never stored or proxied) | Terms of use, no licence granted for storage | https://www.planespotters.net/photo/api |
| https://aviationweather.gov/data/api/ | Aviation Weather Center data API (METAR and TAF, fetched server side, cached; US government data, 100 requests per minute limit respected) | Public domain (US government work) | https://www.weather.gov/disclaimer |
