// MapLibre loads its web worker (and the shared chunk it imports) as separate module files.
// Vite does not emit them, so copy both next to the app and point MapLibre at them.
import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const from = resolve(root, "node_modules/maplibre-gl/dist");
const to = resolve(root, "public/maplibre");
mkdirSync(to, { recursive: true });
for (const f of ["maplibre-gl-worker.mjs", "maplibre-gl-shared.mjs"]) copyFileSync(resolve(from, f), resolve(to, f));
