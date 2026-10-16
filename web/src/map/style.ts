import type { ExpressionSpecification, StyleSpecification } from "maplibre-gl";
import bordersUrl from "../assets/borders.json?url";
import landUrl from "../assets/land.json?url";

const OFM_TILEJSON = "https://tiles.openfreemap.org/planet";
const OFM_GLYPHS = "https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf";

export const COLORS = {
  land: "#171a20",
  landUse: "#1b1f26",
  water: "#0c1017",
  boundary: "#3b424d",
  road: "#252a33",
  roadMajor: "#323945",
  label: "#a4abb6",
  labelStrong: "#d4d7dc",
  halo: "#0d0f12",
} as const;

const name: ExpressionSpecification = ["coalesce", ["get", "name:latin"], ["get", "name"]];

/** Dark basemap on OpenFreeMap vector tiles (OpenMapTiles schema). Needs network access. */
export function onlineStyle(): StyleSpecification {
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
      { id: "background", type: "background", paint: { "background-color": COLORS.land } },
      {
        id: "landuse",
        type: "fill",
        source: "ofm",
        "source-layer": "landuse",
        minzoom: 7,
        filter: ["in", ["get", "class"], ["literal", ["residential", "industrial", "commercial", "retail"]]],
        paint: { "fill-color": COLORS.landUse, "fill-opacity": 0.8 },
      },
      {
        id: "water",
        type: "fill",
        source: "ofm",
        "source-layer": "water",
        paint: { "fill-color": COLORS.water },
      },
      {
        id: "waterway",
        type: "line",
        source: "ofm",
        "source-layer": "waterway",
        minzoom: 8,
        paint: { "line-color": COLORS.water, "line-width": 1 },
      },
      {
        id: "aeroway",
        type: "line",
        source: "ofm",
        "source-layer": "aeroway",
        minzoom: 10,
        filter: ["in", ["get", "class"], ["literal", ["runway", "taxiway"]]],
        paint: {
          "line-color": "#3a414c",
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
        paint: { "line-color": COLORS.road, "line-width": ["interpolate", ["linear"], ["zoom"], 10, 0.4, 16, 2] },
      },
      {
        id: "road-major",
        type: "line",
        source: "ofm",
        "source-layer": "transportation",
        minzoom: 6,
        filter: ["in", ["get", "class"], ["literal", ["motorway", "trunk", "primary"]]],
        paint: { "line-color": COLORS.roadMajor, "line-width": ["interpolate", ["linear"], ["zoom"], 6, 0.4, 16, 3] },
      },
      {
        id: "boundary-state",
        type: "line",
        source: "ofm",
        "source-layer": "boundary",
        minzoom: 4,
        filter: ["all", ["==", ["get", "admin_level"], 4], ["!=", ["get", "maritime"], 1]],
        paint: { "line-color": COLORS.boundary, "line-width": 0.6, "line-dasharray": [3, 3], "line-opacity": 0.7 },
      },
      {
        id: "boundary-country",
        type: "line",
        source: "ofm",
        "source-layer": "boundary",
        filter: ["all", ["==", ["get", "admin_level"], 2], ["!=", ["get", "maritime"], 1]],
        paint: { "line-color": COLORS.boundary, "line-width": ["interpolate", ["linear"], ["zoom"], 2, 0.5, 8, 1.4] },
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
        paint: { "text-color": COLORS.label, "text-halo-color": COLORS.halo, "text-halo-width": 1.5, "text-opacity": 0.7 },
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
        paint: { "text-color": COLORS.labelStrong, "text-halo-color": COLORS.halo, "text-halo-width": 1.5, "text-opacity": 0.75 },
      },
    ],
  };
}

/** Offline basemap from bundled Natural Earth data (public domain): no network needed. */
export function offlineStyle(): StyleSpecification {
  const abs = (u: string) => new URL(u, document.baseURI).href;
  return {
    version: 8,
    sources: {
      land: { type: "geojson", data: abs(landUrl), attribution: "Natural Earth" },
      borders: { type: "geojson", data: abs(bordersUrl) },
    },
    layers: [
      { id: "background", type: "background", paint: { "background-color": COLORS.water } },
      { id: "land", type: "fill", source: "land", paint: { "fill-color": COLORS.land, "fill-outline-color": COLORS.boundary } },
      {
        id: "borders",
        type: "line",
        source: "borders",
        paint: { "line-color": COLORS.boundary, "line-width": 0.8, "line-dasharray": [3, 3] },
      },
    ],
  };
}
