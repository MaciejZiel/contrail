// MapLibre loads its web worker (and the shared chunk it imports) as separate module files.
// Vite does not emit them, so copy both next to the app and point MapLibre at them.
import { copyFileSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const from = resolve(root, "node_modules/maplibre-gl/dist");
// the files are named by version, so they can be cached for ever and an upgrade can never pair a new
// main bundle with an old worker
const version = JSON.parse(readFileSync(resolve(from, "../package.json"), "utf8")).version;
const to = resolve(root, "public/maplibre", version);
mkdirSync(to, { recursive: true });
for (const f of ["maplibre-gl-worker.mjs", "maplibre-gl-shared.mjs"]) copyFileSync(resolve(from, f), resolve(to, f));
