import type { ExpressionSpecification, Map as MapLibreMap, StyleSpecification } from "maplibre-gl";
import type { Theme } from "../core/theme";
import bordersUrl from "../assets/borders.json?url";
import landUrl from "../assets/land.json?url";

const OFM_TILEJSON = "https://tiles.openfreemap.org/planet";
const OFM_GLYPHS = "https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf";

export interface MapColors {
  land: string;
  landUse: string;
  water: string;
  boundary: string;
  road: string;
  roadMajor: string;
  aeroway: string;
  label: string;
  labelStrong: string;
  halo: string;
}

export const COLORS: Record<Theme, MapColors> = {
  dark: {
    land: "#171a20",
    landUse: "#1b1f26",
    water: "#0c1017",
    boundary: "#3b424d",
    road: "#252a33",
    roadMajor: "#323945",
    aeroway: "#3a414c",
    label: "#a4abb6",
    labelStrong: "#d4d7dc",
    halo: "#0d0f12",
  },
  light: {
    land: "#eceae4",
    landUse: "#e3e1da",
    water: "#c5d5e4",
    boundary: "#a6a39a",
    road: "#d9d6ce",
    roadMajor: "#c6c2b8",
    aeroway: "#c4c0b5",
    label: "#555c67",
    labelStrong: "#262a31",
    halo: "#f3f1ed",
  },
};

/** Paint properties of the basemap layers that carry a theme colour, per style. */
function themedPaint(offline: boolean, c: MapColors): Array<[layer: string, prop: string, value: string]> {
  if (offline) {
    return [
      ["background", "background-color", c.water],
      ["land", "fill-color", c.land],
      ["land", "fill-outline-color", c.boundary],
      ["borders", "line-color", c.boundary],
    ];
  }
  return [
    ["background", "background-color", c.land],
    ["landuse", "fill-color", c.landUse],
    ["water", "fill-color", c.water],
    ["waterway", "line-color", c.water],
    ["aeroway", "line-color", c.aeroway],
    ["road-minor", "line-color", c.road],
    ["road-major", "line-color", c.roadMajor],
    ["boundary-state", "line-color", c.boundary],
    ["boundary-country", "line-color", c.boundary],
    ["label-country", "text-color", c.label],
    ["label-country", "text-halo-color", c.halo],
    ["label-place", "text-color", c.labelStrong],
    ["label-place", "text-halo-color", c.halo],
  ];
}

/** Recolour the basemap in place (no style reload, so every other layer and source stays). */
export function applyBasemapTheme(map: MapLibreMap, theme: Theme, offline: boolean): void {
  for (const [layer, prop, value] of themedPaint(offline, COLORS[theme])) {
    if (map.getLayer(layer)) map.setPaintProperty(layer, prop as "background-color", value);
  }
}

const name: ExpressionSpecification = ["coalesce", ["get", "name:latin"], ["get", "name"]];

/** Basemap (dark by default; ``applyBasemapTheme`` recolours it) on OpenFreeMap vector tiles (OpenMapTiles schema). Needs network access. */
export function onlineStyle(theme: Theme = "dark"): StyleSpecification {
  const colors = COLORS[theme];
  return {
    version: 8,
    glyphs: OFM_GLYPHS,
    sources: {
      ofm: {
        type: "vector",
        url: OFM_TILEJSON,
        attribution:
          '<a href="https://openfreemap.org" target="_blank" rel="noopener">OpenFreeMap</a> ' +
          '<a href="https://www.openmaptiles.org/" target="_blank" rel="noopener">&copy; OpenMapTiles</a> ' +
          'Data from <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>',
      },
    },
    layers: [
      { id: "background", type: "background", paint: { "background-color": colors.land } },
      {
        id: "landuse",
        type: "fill",
        source: "ofm",
        "source-layer": "landuse",
        minzoom: 7,
        filter: ["in", ["get", "class"], ["literal", ["residential", "industrial", "commercial", "retail"]]],
        paint: { "fill-color": colors.landUse, "fill-opacity": 0.8 },
      },
      {
        id: "water",
        type: "fill",
        source: "ofm",
        "source-layer": "water",
        paint: { "fill-color": colors.water },
      },
      {
        id: "waterway",
        type: "line",
        source: "ofm",
        "source-layer": "waterway",
        minzoom: 8,
        paint: { "line-color": colors.water, "line-width": 1 },
      },
      {
        id: "aeroway",
        type: "line",
        source: "ofm",
        "source-layer": "aeroway",
        minzoom: 10,
        filter: ["in", ["get", "class"], ["literal", ["runway", "taxiway"]]],
        paint: {
          "line-color": colors.aeroway,
          "line-width": ["interpolate", ["linear"], ["zoom"], 10, 1, 15, ["case", ["==", ["get", "class"], "runway"], 12, 3]],
        },
      },
      {
        id: "road-minor",
        type: "line",
        source: "ofm",
        "source-layer": "transportation",
        minzoom: 10,
        filter: ["in", ["get", "class"], ["literal", ["minor", "service", "tertiary", "secondary"]]],
        paint: { "line-color": colors.road, "line-width": ["interpolate", ["linear"], ["zoom"], 10, 0.4, 16, 2] },
      },
      {
        id: "road-major",
        type: "line",
        source: "ofm",
        "source-layer": "transportation",
        minzoom: 6,
        filter: ["in", ["get", "class"], ["literal", ["motorway", "trunk", "primary"]]],
        paint: { "line-color": colors.roadMajor, "line-width": ["interpolate", ["linear"], ["zoom"], 6, 0.4, 16, 3] },
      },
      {
        id: "boundary-state",
        type: "line",
        source: "ofm",
        "source-layer": "boundary",
        minzoom: 4,
        filter: ["all", ["==", ["get", "admin_level"], 4], ["!=", ["get", "maritime"], 1]],
        paint: { "line-color": colors.boundary, "line-width": 0.6, "line-dasharray": [3, 3], "line-opacity": 0.7 },
      },
      {
        id: "boundary-country",
        type: "line",
        source: "ofm",
        "source-layer": "boundary",
        filter: ["all", ["==", ["get", "admin_level"], 2], ["!=", ["get", "maritime"], 1]],
        paint: { "line-color": colors.boundary, "line-width": ["interpolate", ["linear"], ["zoom"], 2, 0.5, 8, 1.4] },
      },
      {
        id: "label-country",
        type: "symbol",
        source: "ofm",
        "source-layer": "place",
        maxzoom: 7,
        filter: ["==", ["get", "class"], "country"],
        layout: {
          "text-field": name,
          "text-font": ["Noto Sans Bold"],
          "text-size": ["interpolate", ["linear"], ["zoom"], 2, 11, 6, 16],
          "text-max-width": 8,
        },
        paint: { "text-color": colors.label, "text-halo-color": colors.halo, "text-halo-width": 1.5, "text-opacity": 0.7 },
      },
      {
        id: "label-place",
        type: "symbol",
        source: "ofm",
        "source-layer": "place",
        minzoom: 3,
        filter: ["in", ["get", "class"], ["literal", ["city", "town", "village", "suburb"]]],
        layout: {
          "text-field": name,
          "text-font": ["Noto Sans Regular"],
          "text-size": ["interpolate", ["linear"], ["zoom"], 4, 10, 12, 15],
          "text-max-width": 8,
          "symbol-sort-key": ["coalesce", ["get", "rank"], 99],
        },
        paint: { "text-color": colors.labelStrong, "text-halo-color": colors.halo, "text-halo-width": 1.5, "text-opacity": 0.75 },
      },
    ],
  };
}

/** Offline basemap from bundled Natural Earth data (public domain): no network needed. */
export function offlineStyle(theme: Theme = "dark"): StyleSpecification {
  const colors = COLORS[theme];
  const abs = (u: string) => new URL(u, document.baseURI).href;
  return {
    version: 8,
    sources: {
      land: { type: "geojson", data: abs(landUrl), attribution: "Natural Earth" },
      borders: { type: "geojson", data: abs(bordersUrl) },
    },
    layers: [
      { id: "background", type: "background", paint: { "background-color": colors.water } },
      { id: "land", type: "fill", source: "land", paint: { "fill-color": colors.land, "fill-outline-color": colors.boundary } },
      {
        id: "borders",
        type: "line",
        source: "borders",
        paint: { "line-color": colors.boundary, "line-width": 0.8, "line-dasharray": [3, 3] },
      },
    ],
  };
}
