import { AttributionControl, Map as MapLibreMap, type MapMouseEvent, Marker, NavigationControl, setWorkerUrl } from "maplibre-gl";
import { fetchAirportCatalog, type RouteInfo, type Trail } from "../core/api";
import { greatCircle } from "../core/geodesy";
import { haversineKm } from "../core/format";
import { serverNow } from "../core/clock";
import { serverFilterQuery, type Filters } from "../core/filters";
import { limits, loadLimits } from "../core/staleness";
import { Poller, type FeedStatus } from "../core/poller";
import type { Plane } from "../core/plane";
import type { AircraftStore } from "../core/store";
import { rectForBounds } from "../core/tiles";
import { preservedParams, serializeUrlState, type TrailMinutes, type ViewState } from "../core/urlState";
import { AircraftLayer } from "./aircraftLayer";
import { AirportLayer } from "./airportLayer";
import type { Theme } from "../core/theme";
import { applyBasemapTheme, offlineStyle, onlineStyle } from "./style";
import { setPaletteTheme } from "./palette";
import { RecentTrailsLayer, type TrailsStatus } from "./recentTrailsLayer";
import { TrailLayer } from "./trailLayer";
import { GlobeShading } from "./globeShading";

export interface UrlSelection {
  selected: string | null;
  airport: string | null;
  filters: Filters;
  trails: TrailMinutes;
  globe: boolean;
}

export interface ControllerOptions {
  container: HTMLElement;
  store: AircraftStore;
  view: ViewState;
  offline: boolean;
  /** The interface theme; the globe always draws dark whatever this is. */
  theme: Theme;
  getUrlSelection: () => UrlSelection;
  accepts: (p: Plane) => boolean;
  getSelected: () => number | null;
  onSelectAircraft: (hex: number | null) => void;
  onSelectAirport: (icao: string) => void;
  onStatus: (s: FeedStatus) => void;
  onData: () => void;
  onZoom: (zoom: number) => void;
  onTrailsStatus: (s: TrailsStatus) => void;
  /** URL of the checked MapLibre worker file. */
  workerUrl: string;
  onLoaded: () => void;
  /** The basemap's style or tiles keep failing (blocked or unreachable); aircraft still work. */
  onBasemapProblem: () => void;
}

const toLat = (y: number) => (180 / Math.PI) * Math.atan(Math.sinh(Math.PI - 2 * Math.PI * y));

/** Owns the MapLibre map, the aircraft/trail/airport layers, the poller and URL syncing. */
export class MapController {
  readonly map: MapLibreMap;
  readonly aircraft: AircraftLayer | null;
  private trail: TrailLayer;
  readonly recentTrails: RecentTrailsLayer;
  private airports: AirportLayer;
  private poller: Poller;
  private currentTrail: Trail | null = null;
  private route: RouteInfo | null = null;
  private markers: Marker[] = [];
  private timers: Array<ReturnType<typeof setInterval>> = [];
  private moveTimer: ReturnType<typeof setTimeout> | undefined;
  private urlTimer: ReturnType<typeof setTimeout> | undefined;
  private lastUrlWrite = 0;
  private catalogAbort = new AbortController();

  constructor(private o: ControllerOptions) {
    setWorkerUrl(o.workerUrl);
    this.theme = o.theme;
    setPaletteTheme(o.theme);
    const m = new MapLibreMap({
      container: o.container,
      style: o.offline ? offlineStyle(o.theme) : onlineStyle(o.theme),
      center: [o.view.lon, o.view.lat],
      zoom: o.view.zoom,
      minZoom: 2,
      maxZoom: 16,
      attributionControl: false,
      dragRotate: false,
      pitchWithRotate: false,
      touchPitch: false,
      fadeDuration: 0,
      canvasContextAttributes: { antialias: false },
    });
    this.map = m;
    m.touchZoomRotate.disableRotation();
    m.keyboard.disableRotation();
    m.addControl(new NavigationControl({ showCompass: false }), "bottom-right");
    m.addControl(
      new AttributionControl({
        compact: true,
        customAttribution:
          '<a href="https://adsb.lol" target="_blank" rel="noopener">Aircraft data: ADSB.lol</a> (<a href="https://opendatacommons.org/licenses/odbl/1-0/" target="_blank" rel="noopener">ODbL 1.0</a>) · ' +
          '<a href="https://ourairports.com" target="_blank" rel="noopener">Airports: OurAirports</a> · ' +
          '<a href="https://aviationweather.gov" target="_blank" rel="noopener">Weather: NOAA AWC</a> · ' +
          '<a href="licenses/NOTICES.txt" target="_blank" rel="noopener">Licences</a>',
      }),
      "bottom-right",
    );
    this.trail = new TrailLayer(m);
    this.recentTrails = new RecentTrailsLayer(m, () => serverFilterQuery(o.getUrlSelection().filters, true), o.onTrailsStatus);
    this.airports = new AirportLayer(m, o.onSelectAirport);

    const layer = new AircraftLayer({
      map: m,
      store: o.store,
      getSelected: o.getSelected,
      accepts: o.accepts,
      onSelect: (hex) => {
        if (hex !== null) return o.onSelectAircraft(hex);
        const airport = this.lastClick ? this.airports.pick(this.lastClick) : null;
        if (airport) o.onSelectAirport(airport);
        else o.onSelectAircraft(null);
      },
      onClickPoint: (e) => {
        this.lastClick = e;
      },
    });
    layer.start();
    this.aircraft = layer;

    this.poller = new Poller({
      baseUrl: "./",
      getRect: () => {
        const b = m.getBounds();
        return rectForBounds({ west: b.getWest(), south: b.getSouth(), east: b.getEast(), north: b.getNorth() });
      },
      getZoom: () => m.getZoom(),
      getFilterQuery: () => serverFilterQuery(o.getUrlSelection().filters),
      getKeep: () => (o.getSelected() === null ? null : o.getSelected()!.toString(16).padStart(6, "0")),
      onSnapshot: (snapshot) => {
        o.store.apply(snapshot, serverNow());
        o.onData();
      },
      onStatus: o.onStatus,
    });

    m.on("moveend", () => {
      o.onZoom(m.getZoom());
      this.syncUrl();
      clearTimeout(this.moveTimer);
      this.moveTimer = setTimeout(() => this.poller.refreshNow(), 300);
    });
    let basemapReported = false;
    m.on("error", (e) => {
      const msg = e.error?.message ?? "";
      console.warn("[contrail] map error:", msg);
      // style, tile and glyph failures from the basemap host: the map still works without a background
      if (!basemapReported && /openfreemap|Failed to fetch|AJAXError|glyph/i.test(msg)) {
        basemapReported = true;
        o.onBasemapProblem();
      }
    });
    m.on("load", () => {
      o.onLoaded();
      this.applyMapTheme();
      if (o.view.globe) this.setGlobe(true);
      // the credits stay one tap away but do not cover a small map on first paint
      if (window.innerWidth < 900) {
        const attr = o.container.querySelector(".maplibregl-ctrl-attrib");
        attr?.classList.remove("maplibregl-compact-show");
        attr?.removeAttribute("open");
      }
      void loadLimits("./");
      this.poller.start();
      void fetchAirportCatalog(this.catalogAbort.signal).then(
        (rows) => this.airports.install(rows),
        () => undefined, // airports are a nicety; the map works without them
      );
    });
    this.timers.push(
      setInterval(() => this.updateLiveTrail(), 1000),
      setInterval(() => {
        o.store.prune(serverNow(), limits.hideAfterS);
        o.onData();
      }, 30000),
    );
  }

  private theme: Theme;
  private lastClick: MapMouseEvent | null = null;

  /** Switch the interface theme: the map restyles in place, with no reload. */
  setTheme(theme: Theme): void {
    this.theme = theme;
    this.applyMapTheme();
  }

  /** The globe is a dark sphere in space in both themes. */
  private mapTheme(): Theme {
    return this.globe ? "dark" : this.theme;
  }

  private applyMapTheme(): void {
    const t = this.mapTheme();
    setPaletteTheme(t);
    try {
      applyBasemapTheme(this.map, t, this.o.offline);
    } catch {
      // the style document is still loading: the "load" handler applies the theme
    }
    this.trail.applyTheme();
    this.recentTrails.applyTheme();
    this.airports.applyTheme();
    this.aircraft?.applyTheme();
  }
  private globe = false;
  private flatZoom = 5;
  private shading: GlobeShading | null = null;

  /** Zoom at which the globe is as big as the screen allows: its outline spans 88% of the shorter side. */
  private globeFitZoom(): number {
    const c = this.o.container;
    const target = 0.44 * Math.min(c.clientWidth, c.clientHeight);
    return Math.min(2.8, Math.max(0, GlobeShading.zoomForRadius(target, this.map.getCenter().lat, c.clientHeight)));
  }

  /** Switch between the flat map and the globe. The aircraft layer follows the projection. */
  setGlobe(on: boolean, animate = false): void {
    if (this.globe === on) return;
    this.globe = on;
    const m = this.map;
    const before = m.getCenter();
    m.setProjection({ type: on ? "globe" : "mercator" });
    m.setSky(
      on
        ? {
            "sky-color": "#10151d",
            "horizon-color": "#3b5f93",
            "fog-color": "#0d0f12",
            "sky-horizon-blend": 0.5,
            "horizon-fog-blend": 0.5,
            "fog-ground-blend": 0.9,
            "atmosphere-blend": 0,
          }
        : { "atmosphere-blend": 0 },
    );
    if (on) {
      this.flatZoom = m.getZoom();
      m.setMinZoom(0);
    } else {
      // leaving the globe from a far-out view: return to the zoom the flat map had, so the centre is not clamped
      m.jumpTo({ center: before, zoom: Math.max(m.getZoom(), this.flatZoom, 3) });
      m.setMinZoom(2);
    }
    // outer space is a touch darker than the ocean, so the disc reads against it
    this.o.container.style.background = on ? "#050608" : "";
    if (animate && on && m.getZoom() > 3) m.easeTo({ zoom: this.globeFitZoom(), duration: 900, essential: false });
    this.aircraft?.setGlobe(on);
    this.applyMapTheme();
    if (on && !this.shading) {
      // faint stars behind the basemap
      this.shading = new GlobeShading(m);
      this.shading.start();
    } else if (!on && this.shading) {
      this.shading.stop();
      this.shading = null;
    }
    this.syncUrl();
    this.poller.refreshNow();
  }

  destroy(): void {
    this.timers.forEach(clearInterval);
    clearTimeout(this.moveTimer);
    clearTimeout(this.urlTimer);
    clearTimeout(this.filterTimer);
    this.catalogAbort.abort();
    this.recentTrails.destroy();
    this.poller.stop();
    this.aircraft?.stop();
    this.shading?.stop();
    this.map.remove();
  }

  flyTo(lat: number, lon: number, minZoom = 8): void {
    this.map.flyTo({ center: [lon, lat], zoom: Math.max(this.map.getZoom(), minZoom), essential: false });
  }

  /** Fetch now (e.g. after the selection changed). */
  refresh(): void {
    this.poller.refreshNow();
  }

  /** Draw (or stop drawing) the recent tracks of all aircraft in view. */
  setRecentTrails(minutes: TrailMinutes): void {
    this.recentTrails.setMinutes(minutes);
    this.syncUrl();
  }

  /** The filters changed in a way that changes what the server returns (thinned tiles, tracks). */
  filtersChanged(): void {
    clearTimeout(this.filterTimer);
    this.filterTimer = setTimeout(() => {
      this.recentTrails.filtersChanged();
      this.poller.refreshNow();
    }, 400);
  }
  private filterTimer: ReturnType<typeof setTimeout> | undefined;

  setAirportHighlight(icao: string | null): void {
    this.airports.highlight(icao);
  }

  setTrail(t: Trail | null): void {
    this.currentTrail = t;
    this.refreshEstimated();
    this.trail.setTrail(t);
    this.updateLiveTrail();
  }

  /** The selected aircraft's route: marks origin and destination and draws the rest of the way. */
  setRoute(route: RouteInfo | null): void {
    this.route = route;
    this.refreshEstimated();
    this.markers.forEach((m) => m.remove());
    this.markers = [];
    if (route?.plausible) {
      const pin = (a: RouteInfo["origin"], role: string, text = a.iata || a.icao) => {
        const el = document.createElement("div");
        el.className = `route-pin ${role}`;
        el.textContent = text;
        el.title = `${role === "origin" ? "Origin" : "Destination"}: ${a.name}`;
        this.markers.push(new Marker({ element: el, anchor: "bottom" }).setLngLat([a.lon, a.lat]).addTo(this.map));
      };
      pin(route.origin, "origin");
      pin(route.destination, "destination");
    }
    this.updateLiveTrail();
  }

  /** Join the last recorded point to the live position and project the path 2 minutes ahead. */
  private updateLiveTrail(): void {
    const hex = this.o.getSelected();
    const plane = hex === null ? undefined : this.o.store.get(hex);
    if (!plane) {
      this.trail.setLive(null, null, null);
      this.trail.setRouteLines([], []);
      return;
    }
    const pos = plane.positionAt(serverNow());
    const live = { lat: toLat(pos.y), lon: pos.x * 360 - 180 };
    const ahead = { lat: toLat(pos.y + plane.vy * 120), lon: (pos.x + plane.vx * 120) * 360 - 180 };
    const t = this.currentTrail;
    const n = t?.t.length ?? 0;
    const last = t && n > 0 ? { lat: t.lat[n - 1] as number, lon: t.lon[n - 1] as number, altFt: t.alt[n - 1] ?? null } : null;
    this.trail.setLive(last, live, plane.speedKt ? ahead : null);
    this.updateRouteLines(live);
  }

  private estLabel: Marker | null = null;
  private estimatedLine: ReturnType<typeof greatCircle> = [];

  /** Where the aircraft probably came from when it was first seen far from its origin airport. */
  private refreshEstimated(): void {
    this.estLabel?.remove();
    this.estLabel = null;
    this.estimatedLine = [];
    const r = this.route;
    const t = this.currentTrail;
    if (!r?.plausible || !t || t.t.length === 0) return;
    const fLat = t.lat[0] as number;
    const fLon = t.lon[0] as number;
    if (haversineKm(r.origin.lat, r.origin.lon, fLat, fLon) <= 40) return;
    this.estimatedLine = greatCircle(r.origin.lat, r.origin.lon, fLat, fLon, 40);
    const seg = this.estimatedLine[0];
    const mid = seg?.[Math.floor((seg?.length ?? 0) / 2)];
    if (mid) {
      const el = document.createElement("div");
      el.className = "route-est-label";
      el.textContent = "estimated path";
      this.estLabel = new Marker({ element: el }).setLngLat(mid).addTo(this.map);
    }
  }

  private updateRouteLines(live: { lat: number; lon: number }): void {
    const r = this.route;
    if (!r?.plausible) {
      this.trail.setRouteLines([], []);
      return;
    }
    this.trail.setRouteLines(greatCircle(live.lat, live.lon, r.destination.lat, r.destination.lon, 48), this.estimatedLine);
  }

  /** Mirror the view and selection into the address bar (throttled). */
  syncUrl(): void {
    clearTimeout(this.urlTimer);
    const wait = Math.max(0, 500 - (Date.now() - this.lastUrlWrite));
    this.urlTimer = setTimeout(() => {
      const c = this.map.getCenter().wrap();
      const sel = this.o.getUrlSelection();
      const q = serializeUrlState({ lat: c.lat, lon: c.lng, zoom: this.map.getZoom(), ...sel, globe: this.globe });
      const extra = preservedParams(location.search);
      history.replaceState(null, "", `${location.pathname}?${q}${extra.size ? `&${extra}` : ""}${location.hash}`);
      this.lastUrlWrite = Date.now();
    }, wait);
  }
}
