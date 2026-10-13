// MapLibre loads its web worker (and the shared chunk it imports) as separate module files.
// Vite does not emit them, so copy both next to the app, in a directory named by content hash.
import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { maplibreDir, maplibreDist, WORKER_FILES } from "./maplibre-dir.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const to = resolve(root, "public/maplibre", maplibreDir(root));
mkdirSync(to, { recursive: true });
for (const f of WORKER_FILES) copyFileSync(resolve(maplibreDist(root), f), resolve(to, f));
console.log(`maplibre worker files -> ${to}`);
