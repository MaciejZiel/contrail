<script lang="ts">
  import { AttributionControl, Map as MapLibreMap, NavigationControl, setWorkerUrl } from "maplibre-gl";
  import { onMount } from "svelte";
  import { serverNow } from "./core/clock";
  import { Poller } from "./core/poller";
  import { ui } from "./core/state.svelte";
  import { AircraftStore } from "./core/store";
  import { rectForBounds } from "./core/tiles";
  import { parseUrlState, preservedParams, serializeUrlState } from "./core/urlState";
  import { AircraftLayer } from "./map/aircraftLayer";
  import { offlineStyle, onlineStyle } from "./map/style";
  import AltitudeLegend from "./ui/AltitudeLegend.svelte";
  import FreshnessChip from "./ui/FreshnessChip.svelte";
  import SelectedCard from "./ui/SelectedCard.svelte";

  setWorkerUrl(new URL("maplibre/maplibre-gl-worker.mjs", document.baseURI).href);

  const store = new AircraftStore();
  let container: HTMLDivElement;

  function select(hex: number | null): void {
    ui.selected = hex === null ? null : hex.toString(16).padStart(6, "0");
    writeUrl();
  }

  let map: MapLibreMap | undefined;
  let lastUrlWrite = 0;
  let urlTimer: ReturnType<typeof setTimeout> | undefined;

  function writeUrl(): void {
    if (!map) return;
    clearTimeout(urlTimer);
    const wait = Math.max(0, 500 - (Date.now() - lastUrlWrite));
    urlTimer = setTimeout(() => {
      if (!map) return;
      const c = map.getCenter().wrap();
      const view = { lat: c.lat, lon: c.lng, zoom: map.getZoom(), selected: ui.selected };
      const extra = preservedParams(location.search);
      const q = serializeUrlState(view) + (extra.size ? `&${extra}` : "");
      history.replaceState(null, "", `${location.pathname}?${q}${location.hash}`);
      lastUrlWrite = Date.now();
    }, wait);
  }

  onMount(() => {
    const params = new URLSearchParams(location.search);
    const view = parseUrlState(location.search);
    ui.selected = view.selected;
    ui.zoom = view.zoom;

    const m = new MapLibreMap({
      container,
      style: params.get("bm") === "offline" ? offlineStyle() : onlineStyle(),
      center: [view.lon, view.lat],
      zoom: view.zoom,
      minZoom: 2,
      maxZoom: 16,
      attributionControl: false,
      dragRotate: false,
      pitchWithRotate: false,
      touchPitch: false,
      fadeDuration: 0,
      canvasContextAttributes: { antialias: false },
    });
    map = m;
    m.touchZoomRotate.disableRotation();
    m.keyboard.disableRotation();
    m.addControl(new NavigationControl({ showCompass: false }), "bottom-right");
    m.addControl(
      new AttributionControl({
        compact: true,
        customAttribution:
          '<a href="https://adsb.lol" target="_blank" rel="noopener">Aircraft data: ADSB.lol</a> (<a href="https://opendatacommons.org/licenses/odbl/1-0/" target="_blank" rel="noopener">ODbL 1.0</a>)',
      }),
      "bottom-right",
    );

    const layerHandle: { current: AircraftLayer | null } = { current: null };
    try {
      layerHandle.current = new AircraftLayer({
        map: m,
        store,
        getSelected: () => (ui.selected ? parseInt(ui.selected, 16) : null),
        onSelect: select,
      });
      layerHandle.current.start();
    } catch (err) {
      ui.webglError = err instanceof Error ? err.message : "WebGL unavailable";
    }

    const poller = new Poller({
      baseUrl: "./",
      getRect: () => {
        const b = m.getBounds();
        return rectForBounds({ west: b.getWest(), south: b.getSouth(), east: b.getEast(), north: b.getNorth() });
      },
      onSnapshot: (snapshot) => {
        store.apply(snapshot, serverNow());
        ui.aircraftCount = store.size;
      },
      onStatus: (s) => {
        ui.status = s;
      },
    });

    let moveTimer: ReturnType<typeof setTimeout> | undefined;
    m.on("moveend", () => {
      ui.zoom = m.getZoom();
      writeUrl();
      clearTimeout(moveTimer);
      moveTimer = setTimeout(() => poller.refreshNow(), 300);
    });
    m.on("load", () => poller.start());

    const prune = setInterval(() => {
      store.prune(serverNow(), 900);
      ui.aircraftCount = store.size;
    }, 30000);

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && ui.selected) select(null);
    };
    window.addEventListener("keydown", onKey);

    if (params.has("e2e")) {
      (window as unknown as Record<string, unknown>).__flights = {
        map: m,
        store,
        layer: layerHandle.current,
        select,
      };
    }

    return () => {
      window.removeEventListener("keydown", onKey);
      clearInterval(prune);
      clearTimeout(moveTimer);
      poller.stop();
      layerHandle.current?.stop();
      m.remove();
      map = undefined;
    };
  });
</script>

<div class="app">
  <div class="map" bind:this={container} role="application" aria-label="Live aircraft map"></div>

  <div class="topbar">
    <FreshnessChip status={ui.status} count={ui.aircraftCount} />
  </div>

  <div class="legend-slot"><AltitudeLegend /></div>

  {#if ui.selected}
    <SelectedCard {store} hex={ui.selected} onClose={() => select(null)} />
  {/if}

  {#if ui.webglError}
    <div class="fatal" role="alert">
      <h1>This map needs WebGL 2</h1>
      <p>{ui.webglError}. Try a current browser with hardware acceleration enabled.</p>
    </div>
  {/if}
</div>

<style>
  .app {
    position: fixed;
    inset: 0;
    overflow: hidden;
  }
  .map {
    position: absolute;
    inset: 0;
  }
  .topbar {
    position: absolute;
    top: calc(12px + env(safe-area-inset-top));
    left: var(--gutter);
    right: var(--gutter);
    display: flex;
    gap: 8px;
    pointer-events: none;
    z-index: 5;
  }
  .topbar > :global(*) {
    pointer-events: auto;
  }
  .legend-slot {
    position: absolute;
    right: var(--gutter);
    top: calc(56px + env(safe-area-inset-top));
    z-index: 4;
  }
  .fatal {
    position: absolute;
    inset: 0;
    display: grid;
    place-content: center;
    text-align: center;
    padding: 24px;
    background: var(--bg);
    z-index: 20;
  }
</style>
