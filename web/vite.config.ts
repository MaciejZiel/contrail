import { svelte } from "@sveltejs/vite-plugin-svelte";
import { maplibreDir } from "./scripts/maplibre-dir.mjs";
import { defineConfig } from "vitest/config";

const workerDir = maplibreDir(process.cwd());

export default defineConfig({
  // Relative asset URLs so the app works under any BASE_PATH behind a reverse proxy.
  base: "./",
  plugins: [svelte()],
  define: { __MAPLIBRE_DIR__: JSON.stringify(workerDir) },
  server: {
    proxy: { "/api": "http://127.0.0.1:8000" },
  },
  build: {
    target: "es2022",
    sourcemap: false,
    chunkSizeWarningLimit: 1200,
  },
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
  },
});
