// Name of the directory the MapLibre worker files are served from: version plus a hash of the files'
// content. The URL therefore changes whenever the files change, so a browser that once cached a bad copy
// (for example served with the wrong content type) can never keep using it: it asks for a new URL.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

export const WORKER_FILES = ["maplibre-gl-worker.mjs", "maplibre-gl-shared.mjs"];

export function maplibreDist(root) {
  return resolve(root, "node_modules/maplibre-gl/dist");
}

export function maplibreDir(root) {
  const dist = maplibreDist(root);
  const version = JSON.parse(readFileSync(resolve(dist, "../package.json"), "utf8")).version;
  const hash = createHash("sha256");
  for (const f of WORKER_FILES) hash.update(readFileSync(resolve(dist, f)));
  return `${version}-${hash.digest("hex").slice(0, 10)}`;
}
