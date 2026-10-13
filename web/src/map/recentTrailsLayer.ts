import type { Feature, FeatureCollection, LineString } from "geojson";
import type { GeoJSONSource, Map as MapLibreMap } from "maplibre-gl";
import { fetchRecentTrails, type RecentTrail } from "../core/api";
import { altitudeRgb } from "./palette";

/** Below this zoom there are too many aircraft for readable tracks; nothing is requested. */
export const TRAILS_MIN_ZOOM = 6;
const REFRESH_MS = 15_000;
/** A pan or zoom asks for new tracks only once the map has been still this long. */
export const MOVE_DEBOUNCE_MS = 300;
const EMPTY: FeatureCollection = { type: "FeatureCollection", features: [] };

export interface TrailsStatus {
  state: "off" | "zoom" | "loading" | "ok" | "error";
  /** Tracks drawn. */
  shown: number;
  /** Tracks available in view (the server returns at most 400 of them, nearest the centre first). */
  total: number;
}

/** One GeoJSON line per aircraft, coloured by its current altitude; antimeridian jumps are cut. */
export function trailFeatures(trails: RecentTrail[]): Array<Feature<LineString, { c: string }>> {
  const out: Array<Feature<LineString, { c: string }>> = [];
  for (const t of trails) {
    const parts: Array<[number, number]>[] = [[]];
    let prev: number | null = null;
    for (const [lon, lat] of t.p) {
      if (prev !== null && Math.abs(lon - prev) > 180) parts.push([]);
      parts[parts.length - 1]?.push([lon, lat]);
      prev = lon;
    }
    const alt = t.p[t.p.length - 1]?.[2] ?? null;
    const [r, g, b] = altitudeRgb(alt === null ? null : alt * 100, false);
    for (const coordinates of parts) {
      if (coordinates.length > 1) {
        out.push({ type: "Feature", properties: { c: `rgb(${r},${g},${b})` }, geometry: { type: "LineString", coordinates } });
      }
    }
  }
  return out;
}

/**
 * Recent tracks of every aircraft in view, drawn under the aircraft. The data is the server's own
 * trail memory (no upstream request): one request per refresh for the visible box.
 */
export class RecentTrailsLayer {
  featureCount = 0;
  private minutes = 0;
  private timer: ReturnType<typeof setInterval> | undefined;
  private abort: AbortController | undefined;
  private ready = false;
  private generation = 0;
  private moveTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    private map: MapLibreMap,
    private getFilterQuery: () => string,
    private onStatus: (s: TrailsStatus) => void,
  ) {
    const add = () => {
      if (this.ready) return;
      map.addSource("recent-trails", { type: "geojson", data: EMPTY });
      const before = map.getLayer("trail-casing") ? "trail-casing" : undefined;
      map.addLayer(
        {
          id: "recent-trails-line",
          type: "line",
          source: "recent-trails",
          layout: { "line-cap": "round", "line-join": "round" },
          paint: { "line-color": ["get", "c"], "line-width": ["interpolate", ["linear"], ["zoom"], 6, 1, 12, 2.2], "line-opacity": 0.6 },
        },
        before,
      );
      this.ready = true;
      void this.refresh();
    };
    if (map.isStyleLoaded()) add();
    else map.once("load", add);
    map.on("moveend", () => {
      clearTimeout(this.moveTimer);
      this.moveTimer = setTimeout(() => void this.refresh(), MOVE_DEBOUNCE_MS);
    });
  }

  setMinutes(minutes: number): void {
    if (minutes === this.minutes) return;
    this.minutes = minutes;
    clearInterval(this.timer);
    this.timer = undefined;
    if (minutes === 0) {
      this.clear();
      this.onStatus({ state: "off", shown: 0, total: 0 });
      return;
    }
    this.timer = setInterval(() => void this.refresh(), REFRESH_MS);
    void this.refresh();
  }

  /** The filters changed: redraw from the server with the new ones. */
  filtersChanged(): void {
    if (this.minutes) void this.refresh();
  }

  async refresh(): Promise<void> {
    if (!this.minutes || !this.ready) return;
    this.abort?.abort();
    if (this.map.getZoom() < TRAILS_MIN_ZOOM) {
      this.clear();
      this.onStatus({ state: "zoom", shown: 0, total: 0 });
      return;
    }
    const ctl = new AbortController();
    this.abort = ctl;
    const gen = ++this.generation;
    const b = this.map.getBounds();
    try {
      const r = await fetchRecentTrails(
        { west: b.getWest(), south: b.getSouth(), east: b.getEast(), north: b.getNorth() },
        this.minutes,
        this.getFilterQuery(),
        ctl.signal,
      );
      if (ctl.signal.aborted || gen !== this.generation) return;
      const features = trailFeatures(r.trails);
      this.featureCount = features.length;
      (this.map.getSource("recent-trails") as GeoJSONSource | undefined)?.setData({ type: "FeatureCollection", features });
      this.onStatus({ state: "ok", shown: r.trails.length, total: r.total });
    } catch {
      if (!ctl.signal.aborted) this.onStatus({ state: "error", shown: 0, total: 0 });
    }
  }

  private clear(): void {
    this.featureCount = 0;
    (this.map.getSource("recent-trails") as GeoJSONSource | undefined)?.setData(EMPTY);
  }

  destroy(): void {
    clearInterval(this.timer);
    clearTimeout(this.moveTimer);
    this.abort?.abort();
  }
}
