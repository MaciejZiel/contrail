<script lang="ts">
  import { AttributionControl, Map as MapLibreMap, NavigationControl, setWorkerUrl } from "maplibre-gl";
  import { onMount, tick } from "svelte";
  import { serverNow } from "./core/clock";
  import { Poller } from "./core/poller";
  import { ui } from "./core/state.svelte";
  import { AircraftStore } from "./core/store";
  import { rectForBounds } from "./core/tiles";
  import { parseUrlState, preservedParams, serializeUrlState } from "./core/urlState";
  import { AircraftLayer } from "./map/aircraftLayer";
  import { TrailLayer } from "./map/trailLayer";
  import type { Trail } from "./core/api";
    import { offlineStyle, onlineStyle } from "./map/style";
  import AltitudeLegend from "./ui/AltitudeLegend.svelte";
  import FreshnessChip from "./ui/FreshnessChip.svelte";
  import AircraftPanel from "./panel/AircraftPanel.svelte";

  setWorkerUrl(new URL("maplibre/maplibre-gl-worker.mjs", document.baseURI).href);

  const store = new AircraftStore();
  let container: HTMLDivElement;

  function select(hex: number | null): void {
    ui.selected = hex === null ? null : hex.toString(16).padStart(6, "0");
    writeUrl();
    if (hex !== null) void revealSelected(hex);
  }

  let aircraftLayer: AircraftLayer | null = null;
  let panelSlot: HTMLDivElement | undefined = $state();

  /** Pan the map when the panel that just opened covers the selected aircraft. */
  async function revealSelected(hex: number): Promise<void> {
    await tick();
    const pos = aircraftLayer?.screenPosition(hex);
    if (!map || !pos || !panelSlot) return;
    const box = panelSlot.getBoundingClientRect();
    const mapBox = map.getContainer().getBoundingClientRect();
    const x = pos.x + mapBox.left;
    const y = pos.y + mapBox.top;
    const margin = 32;
    if (x < box.left - margin || x > box.right + margin || y < box.top - margin || y > box.bottom + margin) return;
    const sidePanel = box.height > mapBox.height * 0.75;
    const target = sidePanel
      ? { x: box.right + (mapBox.right - box.right) / 2, y }
      : { x, y: mapBox.top + (box.top - mapBox.top) / 2 };
    const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
    map.panBy([x - target.x, y - target.y], { duration: reduced ? 0 : 450 });
  }

  let map: MapLibreMap | undefined;
  let trailLayer: TrailLayer | undefined;
  let currentTrail: Trail | null = null;
  const hadCenterParam = new URLSearchParams(location.search).has("c");

  function onTrail(t: Trail | null): void {
    currentTrail = t;
    trailLayer?.setTrail(t);
    updateLiveTrail();
  }

  /** Join the last recorded point to the live position and project the path 2 minutes ahead. */
  function updateLiveTrail(): void {
    if (!trailLayer) return;
    const plane = ui.selected ? store.get(parseInt(ui.selected, 16)) : undefined;
    if (!plane) {
      trailLayer.setLive(null, null, null);
      return;
    }
    const now = serverNow();
    const pos = plane.positionAt(now);
    const toLat = (y: number) => (180 / Math.PI) * Math.atan(Math.sinh(Math.PI - 2 * Math.PI * y));
    const live = { lat: toLat(pos.y), lon: pos.x * 360 - 180 };
    const ahead = { lat: toLat(pos.y + plane.vy * 120), lon: (pos.x + plane.vx * 120) * 360 - 180 };
    const n = currentTrail?.t.length ?? 0;
    const last =
      currentTrail && n > 0
        ? { lat: currentTrail.lat[n - 1] as number, lon: currentTrail.lon[n - 1] as number, altFt: currentTrail.alt[n - 1] ?? null }
        : null;
    trailLayer.setLive(last, live, plane.speedKt ? ahead : null);
  }

  function locate(lat: number, lon: number): void {
    if (!map || hadCenterParam) return;
    map.flyTo({ center: [lon, lat], zoom: Math.max(map.getZoom(), 8), essential: false });
  }

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
    trailLayer = new TrailLayer(m);
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
      aircraftLayer = layerHandle.current;
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

    const liveTrail = setInterval(updateLiveTrail, 1000);
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
      clearInterval(liveTrail);
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
    <div class="panel-slot" bind:this={panelSlot}>
      <AircraftPanel {store} hex={ui.selected} onClose={() => select(null)} {onTrail} onLocate={locate} />
    </div>
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
  .panel-slot {
    position: absolute;
    z-index: 6;
    left: var(--gutter);
    right: var(--gutter);
    bottom: calc(8px + env(safe-area-inset-bottom));
    max-height: 62vh;
    display: flex;
  }
  .panel-slot > :global(.panel) {
    flex: 1;
    min-width: 0;
  }
  @media (min-width: 900px) {
    .panel-slot {
      right: auto;
      top: calc(12px + env(safe-area-inset-top));
      bottom: 12px;
      width: 380px;
      max-height: none;
    }
    .app:has(.panel-slot) .topbar {
      left: calc(var(--gutter) + 392px);
    }
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
