import type { Feature, FeatureCollection, Point } from "geojson";
import type { GeoJSONSource, Map as MapLibreMap, MapMouseEvent } from "maplibre-gl";
import type { AirportRow } from "../core/api";

const SOURCE = "airports";

/** The airport marker: a rounded diamond, ringed in cool grey, with a small bright core. Drawn once as an image. */
function airportIcon(): ImageData {
  const n = 40; // 20 css px at pixel ratio 2
  const c = document.createElement("canvas");
  c.width = n;
  c.height = n;
  const g = c.getContext("2d");
  if (!g) return new ImageData(n, n);
  g.translate(n / 2, n / 2);
  g.rotate(Math.PI / 4);
  const diamond = (size: number, radius: number) => {
    g.beginPath();
    g.roundRect(-size / 2, -size / 2, size, size, radius);
  };
  diamond(23, 6);
  g.fillStyle = "rgba(22,26,34,0.95)";
  g.fill();
  g.lineWidth = 2;
  g.strokeStyle = "#7f8ba3";
  g.stroke();
  diamond(8.5, 2.5);
  g.fillStyle = "#cfd6e3";
  g.fill();
  return g.getImageData(0, 0, n, n);
}

/** Large and medium airports as badges, with code labels when the basemap provides fonts. */
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
    if (!map.hasImage("airport-icon")) map.addImage("airport-icon", airportIcon(), { pixelRatio: 2 });
    const badge = (id: string, kind: string, minzoom: number, size: [number, number]) =>
      map.addLayer({
        id,
        type: "symbol",
        source: SOURCE,
        minzoom,
        filter: ["==", ["get", "kind"], kind],
        layout: {
          "icon-image": "airport-icon",
          "icon-size": ["interpolate", ["linear"], ["zoom"], minzoom, size[0], 12, size[1]],
          "icon-allow-overlap": true,
          "icon-ignore-placement": true,
        },
        paint: { "icon-opacity": kind === "L" ? 1 : 0.85 },
      });
    badge("airports-large", "L", 3, [0.85, 1.3]);
    badge("airports-medium", "M", 6, [0.72, 1.05]);
    map.addLayer({
      id: "airport-selected",
      type: "circle",
      source: SOURCE,
      filter: ["==", ["get", "icao"], ""],
      paint: { "circle-radius": 13, "circle-color": "rgba(255,138,61,0.16)", "circle-stroke-color": "#ff8a3d", "circle-stroke-width": 2 },
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
            "text-offset": [0, 1.3],
            "text-anchor": "top",
            "text-optional": true,
          },
          paint: { "text-color": "#a4abb6", "text-halo-color": "#0d0f12", "text-halo-width": 1.5 },
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
