import { serverNow } from "./clock";
import { Poller, type FeedStatus } from "./poller";
import type { AircraftStore } from "./store";
import { rectForBounds } from "./tiles";

/** Keeps the aircraft store filled around a point without any map, for the "map unavailable" view. */
export function startFallbackFeed(
  store: AircraftStore,
  centre: { lat: number; lon: number; zoom: number },
  onStatus: (s: FeedStatus) => void,
  onData: () => void,
): Poller {
  const half = (360 * 1280) / (512 * 2 ** centre.zoom) / 2; // degrees of longitude in half a desktop viewport
  const poller = new Poller({
    baseUrl: "./",
    getRect: () =>
      rectForBounds({
        west: centre.lon - half,
        east: centre.lon + half,
        south: centre.lat - half * 0.6,
        north: centre.lat + half * 0.6,
      }),
    getZoom: () => Math.max(centre.zoom, 4),
    onSnapshot: (s) => {
      store.apply(s, serverNow());
      onData();
    },
    onStatus,
  });
  poller.start();
  return poller;
}
