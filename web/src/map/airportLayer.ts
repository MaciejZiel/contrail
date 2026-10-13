import type { Feature, FeatureCollection, Point } from "geojson";
import type { GeoJSONSource, Map as MapLibreMap, MapMouseEvent } from "maplibre-gl";
import type { AirportRow } from "../core/api";

const SOURCE = "airports";

/** Large and medium airports as dots, with code labels when the basemap provides fonts. */
export class AirportLayer {
  constructor(
    private map: MapLibreMap,
    private onPick: (icao: string) => void,
  ) {}

  private installed = false;

  /** Missing text glyphs (offline basemap) simply skip the labels. */
  install(rows: AirportRow[]): void {
    const map = this.map;
    const features: Feature<Point>[] = rows.map(([icao, iata, name, lat, lon, kind]) => ({
      type: "Feature",
      properties: { icao, label: iata || icao, name, kind },
      geometry: { type: "Point", coordinates: [lon, lat] },
    }));
    const data: FeatureCollection = { type: "FeatureCollection", features };
    const existing = map.getSource(SOURCE) as GeoJSONSource | undefined;
    if (existing) {
      existing.setData(data);
      return;
    }
    map.addSource(SOURCE, { type: "geojson", data });
    const hasGlyphs = Boolean(map.getStyle().glyphs);
    const dot = (id: string, kind: string, minzoom: number, radius: [number, number]) =>
      map.addLayer({
        id,
        type: "circle",
        source: SOURCE,
        minzoom,
        filter: ["==", ["get", "kind"], kind],
        paint: {
          "circle-radius": ["interpolate", ["linear"], ["zoom"], minzoom, radius[0], 12, radius[1]],
          "circle-color": "#0b1020",
          "circle-stroke-color": "#8fa3cc",
          "circle-stroke-width": 1.5,
        },
      });
    dot("airports-large", "L", 3, [2.5, 6]);
    dot("airports-medium", "M", 6, [2.5, 5]);
    map.addLayer({
      id: "airport-selected",
      type: "circle",
      source: SOURCE,
      filter: ["==", ["get", "icao"], ""],
      paint: { "circle-radius": 10, "circle-color": "rgba(94,234,212,0.15)", "circle-stroke-color": "#5eead4", "circle-stroke-width": 2 },
    });
    if (hasGlyphs) {
      const label = (id: string, kind: string, minzoom: number) =>
        map.addLayer({
          id,
          type: "symbol",
          source: SOURCE,
          minzoom,
          filter: ["==", ["get", "kind"], kind],
          layout: {
            "text-field": ["get", "label"],
            "text-font": ["Noto Sans Bold"],
            "text-size": 11,
            "text-offset": [0, 1.1],
            "text-anchor": "top",
            "text-optional": true,
          },
          paint: { "text-color": "#9fb0d4", "text-halo-color": "#0b1020", "text-halo-width": 1.5 },
        });
      label("airports-large-label", "L", 5.5);
      label("airports-medium-label", "M", 8);
    }
    map.on("mouseenter", "airports-large", this.hover(true));
    map.on("mouseleave", "airports-large", this.hover(false));
    map.on("mouseenter", "airports-medium", this.hover(true));
    map.on("mouseleave", "airports-medium", this.hover(false));
    this.installed = true;
  }

  private hover(on: boolean) {
    return () => {
      this.map.getCanvas().style.cursor = on ? "pointer" : "";
    };
  }

  /** Airport under a click, or null. */
  pick(e: MapMouseEvent): string | null {
    if (!this.installed) return null;
    const box: [[number, number], [number, number]] = [
      [e.point.x - 12, e.point.y - 12],
      [e.point.x + 12, e.point.y + 12],
    ];
    const hit = this.map.queryRenderedFeatures(box, { layers: ["airports-large", "airports-medium"] })[0];
    return hit ? String(hit.properties?.icao ?? "") || null : null;
  }

  highlight(icao: string | null): void {
    if (this.installed) this.map.setFilter("airport-selected", ["==", ["get", "icao"], icao ?? ""]);
  }
}
