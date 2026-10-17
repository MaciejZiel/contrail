import type { Feature, FeatureCollection, Point } from "geojson";
import type { GeoJSONSource, Map as MapLibreMap, MapMouseEvent } from "maplibre-gl";
import type { AirportRow } from "../core/api";
import type { Theme } from "../core/theme";
import { paletteTheme } from "./palette";

const SOURCE = "airports";

interface AirportColors {
  fill: string;
  ring: string;
  core: string;
  label: string;
  halo: string;
  selectedFill: string;
  selected: string;
}

const COLORS: Record<Theme, AirportColors> = {
  dark: {
    fill: "rgba(22,26,34,0.95)",
    ring: "#7f8ba3",
    core: "#cfd6e3",
    label: "#a4abb6",
    halo: "#0d0f12",
    selectedFill: "rgba(255,138,61,0.16)",
    selected: "#ff8a3d",
  },
  light: {
    fill: "rgba(255,255,255,0.96)",
    ring: "#5f6b82",
    core: "#2b3445",
    label: "#4b525d",
    halo: "#f3f1ed",
    selectedFill: "rgba(255,138,61,0.22)",
    selected: "#e0600a",
  },
};

/** The airport marker: a rounded diamond, ringed in cool grey, with a small core. Drawn as an image per theme. */
function airportIcon(theme: Theme): ImageData {
  const c0 = COLORS[theme];
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
  g.fillStyle = c0.fill;
  g.fill();
  g.lineWidth = 2;
  g.strokeStyle = c0.ring;
  g.stroke();
  diamond(8.5, 2.5);
  g.fillStyle = c0.core;
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
    if (!map.hasImage("airport-icon")) map.addImage("airport-icon", airportIcon(paletteTheme()), { pixelRatio: 2 });
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
      paint: { "circle-radius": 13, "circle-color": COLORS[paletteTheme()].selectedFill, "circle-stroke-color": COLORS[paletteTheme()].selected, "circle-stroke-width": 2 },
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
          paint: { "text-color": COLORS[paletteTheme()].label, "text-halo-color": COLORS[paletteTheme()].halo, "text-halo-width": 1.5 },
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

  /** Redraw the marker image and recolour the selection ring and the labels for the current palette. */
  applyTheme(): void {
    if (!this.installed) return;
    const map = this.map;
    const c = COLORS[paletteTheme()];
    if (map.hasImage("airport-icon")) map.updateImage("airport-icon", airportIcon(paletteTheme()));
    map.setPaintProperty("airport-selected", "circle-color", c.selectedFill);
    map.setPaintProperty("airport-selected", "circle-stroke-color", c.selected);
    for (const id of ["airports-large-label", "airports-medium-label"]) {
      if (!map.getLayer(id)) continue;
      map.setPaintProperty(id, "text-color", c.label);
      map.setPaintProperty(id, "text-halo-color", c.halo);
    }
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
