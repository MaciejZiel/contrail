import type { Feature, FeatureCollection, LineString } from "geojson";
import type { GeoJSONSource, Map as MapLibreMap } from "maplibre-gl";
import type { Trail } from "../core/api";
import type { LonLat } from "../core/geodesy";
import { altitudeRgb, ramp } from "./palette";

type SegmentFeature = Feature<LineString, { c: string }>;
const EMPTY: FeatureCollection = { type: "FeatureCollection", features: [] };

function colorFor(altFt: number | null): string {
  const [r, g, b] = altitudeRgb(altFt, false);
  return `rgb(${r},${g},${b})`;
}

/** Split into segments coloured by altitude; segments that cross the antimeridian are skipped. */
export function trailSegments(trail: Trail): SegmentFeature[] {
  const out: SegmentFeature[] = [];
  for (let i = 1; i < trail.t.length; i++) {
    const lon0 = trail.lon[i - 1] as number;
    const lon1 = trail.lon[i] as number;
    if (Math.abs(lon1 - lon0) > 180) continue;
    out.push({
      type: "Feature",
      properties: { c: colorFor(trail.alt[i] ?? trail.alt[i - 1] ?? null) },
      geometry: {
        type: "LineString",
        coordinates: [
          [lon0, trail.lat[i - 1] as number],
          [lon1, trail.lat[i] as number],
        ],
      },
    });
  }
  return out;
}

/** The selected aircraft's recorded trail plus a dashed projection ahead of it. */
export class TrailLayer {
  private ready = false;
  private trail: Trail | null = null;

  constructor(private map: MapLibreMap) {
    const add = () => {
      if (this.ready) return;
      map.addSource("trail", { type: "geojson", data: EMPTY });
      map.addSource("trail-live", { type: "geojson", data: EMPTY });
      map.addLayer({
        id: "trail-casing",
        type: "line",
        source: "trail",
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": ramp().casing, "line-width": 6, "line-opacity": 0.65 },
      });
      map.addLayer({
        id: "trail-line",
        type: "line",
        source: "trail",
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": ["get", "c"], "line-width": 3 },
      });
      map.addLayer({
        id: "trail-ahead",
        type: "line",
        source: "trail-live",
        filter: ["==", ["get", "kind"], "ahead"],
        paint: { "line-color": ramp().trailLine, "line-width": 2, "line-dasharray": [1.2, 2], "line-opacity": 0.8 },
      });
      map.addLayer({
        id: "trail-join",
        type: "line",
        source: "trail-live",
        filter: ["==", ["get", "kind"], "join"],
        paint: { "line-color": ["get", "c"], "line-width": 3 },
      });
      map.addSource("route", { type: "geojson", data: EMPTY });
      map.addLayer({
        id: "route-remaining",
        type: "line",
        source: "route",
        filter: ["==", ["get", "kind"], "remaining"],
        layout: { "line-cap": "round" },
        paint: { "line-color": ramp().trailLine, "line-width": 2, "line-dasharray": [2, 3], "line-opacity": 0.65 },
      });
      map.addLayer({
        id: "route-estimated",
        type: "line",
        source: "route",
        filter: ["==", ["get", "kind"], "estimated"],
        layout: { "line-cap": "round" },
        paint: { "line-color": ramp().trailMuted, "line-width": 2, "line-dasharray": [1, 3], "line-opacity": 0.7 },
      });
      this.ready = true;
    };
    if (map.isStyleLoaded()) add();
    else map.once("load", add);
  }

  /** Recolour for the palette that is now current (the segment colours are data, so they are rebuilt). */
  applyTheme(): void {
    const m = this.map;
    if (!this.ready) return;
    const r = ramp();
    m.setPaintProperty("trail-casing", "line-color", r.casing);
    m.setPaintProperty("trail-ahead", "line-color", r.trailLine);
    m.setPaintProperty("route-remaining", "line-color", r.trailLine);
    m.setPaintProperty("route-estimated", "line-color", r.trailMuted);
    this.setTrail(this.trail);
  }

  private src(id: string): GeoJSONSource | undefined {
    return this.map.getSource(id) as GeoJSONSource | undefined;
  }

  setTrail(trail: Trail | null): void {
    this.trail = trail;
    this.src("trail")?.setData(trail ? { type: "FeatureCollection", features: trailSegments(trail) } : EMPTY);
  }

  /** Connect the last recorded point to the live position and project the path ahead. */
  setLive(
    last: { lat: number; lon: number; altFt: number | null } | null,
    live: { lat: number; lon: number } | null,
    ahead: { lat: number; lon: number } | null,
  ): void {
    const features: Feature[] = [];
    if (last && live && Math.abs(live.lon - last.lon) < 180) {
      features.push({
        type: "Feature",
        properties: { kind: "join", c: colorFor(last.altFt) },
        geometry: { type: "LineString", coordinates: [[last.lon, last.lat], [live.lon, live.lat]] },
      });
    }
    if (live && ahead && Math.abs(live.lon - ahead.lon) < 180) {
      features.push({
        type: "Feature",
        properties: { kind: "ahead", c: "#fff" },
        geometry: { type: "LineString", coordinates: [[live.lon, live.lat], [ahead.lon, ahead.lat]] },
      });
    }
    this.src("trail-live")?.setData({ type: "FeatureCollection", features });
  }

  /** Dashed lines: remaining route to the destination and the estimated part before the first sighting. */
  setRouteLines(remaining: LonLat[][], estimated: LonLat[][]): void {
    const features: Feature[] = [
      ...remaining.filter((c) => c.length > 1).map((coords) => ({ type: "Feature" as const, properties: { kind: "remaining" }, geometry: { type: "LineString" as const, coordinates: coords } })),
      ...estimated.filter((c) => c.length > 1).map((coords) => ({ type: "Feature" as const, properties: { kind: "estimated" }, geometry: { type: "LineString" as const, coordinates: coords } })),
    ];
    this.src("route")?.setData({ type: "FeatureCollection", features });
  }

  clear(): void {
    this.setRouteLines([], []);
    this.setTrail(null);
    this.setLive(null, null, null);
  }
}
