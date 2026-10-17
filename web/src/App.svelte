<script lang="ts">
  import { onMount, tick } from "svelte";
  import { fetchAirlineNames, type SearchAircraft, type SearchAirline, type SearchAirport, type Trail } from "./core/api";
  import { accepts } from "./core/filters";
  import { ui } from "./core/state.svelte";
  import { AircraftStore } from "./core/store";
  import { TypeHexes } from "./core/typeHexes";
  import type { Plane } from "./core/plane";
  import type { TrailMinutes } from "./core/urlState";
  import { parseUrlState } from "./core/urlState";
  import FilterPopover from "./filters/FilterPopover.svelte";
  import { installGlobalHandlers } from "./core/diagnostics";
  import { startFallbackFeed } from "./core/fallbackFeed";
  import type { Poller } from "./core/poller";
  import { MapController } from "./map/controller";
  import { initProblem, resolveWorkerUrl, timeoutProblem, webgl2Available, webglProblem, type MapProblem } from "./map/startup";
  import MapProblemView from "./ui/MapProblem.svelte";
  import AircraftPanel from "./panel/AircraftPanel.svelte";
  import PanelHost from "./panel/PanelHost.svelte";
  import AirportCard from "./panel/AirportCard.svelte";
  import SearchBox from "./search/SearchBox.svelte";
  import AltitudeLegend from "./ui/AltitudeLegend.svelte";
  import ProjectionToggle from "./ui/ProjectionToggle.svelte";
  import ThemeToggle from "./ui/ThemeToggle.svelte";
  import { setThemePref, themeState } from "./core/themeState.svelte";
  import FilterChip from "./ui/FilterChip.svelte";
  import ViewList from "./ui/ViewList.svelte";
  import FreshnessChip from "./ui/FreshnessChip.svelte";

  const store = new AircraftStore();
  const typeHexes = new TypeHexes();
  const accept = (p: Plane) => accepts(p, ui.filters, typeHexes.set);
  const view0 = parseUrlState(location.search);
  let container: HTMLDivElement;
  let ctl: MapController | undefined;
  let airlineLabel = $state<string | null>(null);
  let sheetHeight = $state(0);
  const hadCenterParam = new URLSearchParams(location.search).has("c");

  const hex = (n: number) => n.toString(16).padStart(6, "0");

  /** Pan the map when the panel that just opened covers the selected aircraft. */
  async function revealSelected(n: number): Promise<void> {
    await tick();
    const pos = ctl?.aircraft?.screenPosition(n);
    const panel = document.querySelector<HTMLElement>(".side, .sheet");
    if (!ctl || !pos || !panel) return;
    const box = panel.getBoundingClientRect();
    const mapBox = ctl.map.getContainer().getBoundingClientRect();
    const x = pos.x + mapBox.left;
    const y = pos.y + mapBox.top;
    const margin = 32;
    if (x < box.left - margin || x > box.right + margin || y < box.top - margin || y > box.bottom + margin) return;
    const sidePanel = box.height > mapBox.height * 0.75;
    const target = sidePanel
      ? { x: mapBox.left + (box.left - mapBox.left) / 2, y }
      : { x, y: mapBox.top + (box.top - mapBox.top) / 2 };
    const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
    ctl.map.panBy([x - target.x, y - target.y], { duration: reduced ? 0 : 450 });
  }

  function selectAircraft(n: number | null): void {
    if (n === null && ui.selected) queueMicrotask(() => ctl?.map.getCanvas().focus({ preventScroll: true }));
    ui.selected = n === null ? null : hex(n);
    if (n !== null) ui.airport = null;
    afterSelectionChange();
    if (n !== null) void revealSelected(n);
  }

  function selectAirport(icao: string | null): void {
    ui.airport = icao;
    if (icao) ui.selected = null;
    afterSelectionChange();
  }

  function afterSelectionChange(): void {
    ctl?.setAirportHighlight(ui.airport);
    ctl?.syncUrl();
    ctl?.refresh();
  }

  function onSearchAircraft(a: SearchAircraft): void {
    selectAircraft(parseInt(a.hex, 16));
    ctl?.flyTo(a.lat, a.lon, 8);
  }
  function onSearchAirport(a: SearchAirport): void {
    selectAirport(a.icao);
    ctl?.flyTo(a.lat, a.lon, 10);
  }
  function onSearchAirline(a: SearchAirline): void {
    ui.filters = { ...ui.filters, airline: a.code };
    airlineLabel = a.name;
  }

  let pendingLocate: { lat: number; lon: number } | null = null;

  function locateSelected(lat: number, lon: number): void {
    if (hadCenterParam) return;
    if (ctl) ctl.flyTo(lat, lon, 8);
    else pendingLocate = { lat, lon }; // the panel can answer before the map has started
  }

  // filters change URL state; the aircraft layer reads them on every frame
  $effect(() => {
    const f = ui.filters;
    typeHexes.setTypes(f.types);
    ctl?.syncUrl();
    ctl?.filtersChanged();
  });

  // the theme changes: the map restyles in place
  $effect(() => {
    ctl?.setTheme(themeState.theme);
  });

  function setTrails(m: TrailMinutes): void {
    ui.trails = m;
    ctl?.setRecentTrails(m);
  }

  let fallback: Poller | undefined;
  const timers: Array<ReturnType<typeof setTimeout>> = [];

  /** Show a clear message and keep a map-free aircraft list alive, whatever went wrong with the map. */
  function showProblem(problem: MapProblem, view: { lat: number; lon: number; zoom: number }): void {
    if (ui.problem) return;
    console.error(`[contrail] map unavailable (${problem.kind}): ${problem.technical}`);
    ui.problem = problem;
    ctl?.destroy();
    ctl = undefined;
    fallback ??= startFallbackFeed(
      store,
      view,
      (st) => (ui.status = st),
      () => (ui.aircraftCount = store.size),
    );
  }

  onMount(() => {
    const view = parseUrlState(location.search);
    ui.selected = view.selected;
    ui.airport = view.airport;
    ui.filters = view.filters;
    ui.trails = view.trails;
    ui.globe = view.globe;
    typeHexes.setTypes(view.filters.types);
    ui.zoom = view.zoom;
    const params = new URLSearchParams(location.search);
    let alive = true;
    let loaded = false;

    installGlobalHandlers((message) => {
      // a script error before the map has loaded means the page is not usable as a map
      if (!loaded && alive && !ui.problem) showProblem(initProblem(message), view);
    });

    // the status pill must never say "loading" for ever
    timers.push(
      setTimeout(() => {
        if (ui.status.state === "loading") ui.status = { ...ui.status, state: "slow" };
      }, 15000),
    );

    void (async () => {
      if (!webgl2Available()) return showProblem(webglProblem(), view);
      const worker = await resolveWorkerUrl(__MAPLIBRE_DIR__, document.baseURI);
      if (!alive) return;
      if ("problem" in worker) return showProblem(worker.problem, view);
      let c: MapController;
      try {
        c = new MapController({
          container,
          store,
          view,
          offline: params.get("bm") === "offline",
          theme: themeState.theme,
          workerUrl: worker.url,
          getUrlSelection: () => ({ selected: ui.selected, airport: ui.airport, filters: ui.filters, trails: ui.trails, globe: ui.globe }),
          accepts: accept,
          onTrailsStatus: (st) => (ui.trailsStatus = st),
          getSelected: () => (ui.selected ? parseInt(ui.selected, 16) : null),
          onSelectAircraft: selectAircraft,
          onSelectAirport: selectAirport,
          onStatus: (st) => (ui.status = st),
          onData: () => (ui.aircraftCount = store.size),
          onZoom: (z) => (ui.zoom = z),
          onLoaded: () => (loaded = true),
          onBasemapProblem: () => (ui.basemapNotice = true),
        });
      } catch (err) {
        return showProblem(initProblem(err instanceof Error ? err.message : String(err)), view);
      }
      ctl = c;
      if (view.trails) c.setRecentTrails(view.trails);
      if (pendingLocate) c.flyTo(pendingLocate.lat, pendingLocate.lon, 8);
      // the map must finish loading in reasonable time, or the visitor gets an explanation instead of a blank page
      timers.push(setTimeout(() => !loaded && alive && showProblem(timeoutProblem(), view), 15000));
      c.setAirportHighlight(ui.airport);
      const code = view.filters.airline;
      if (code) {
        void fetchAirlineNames([code], new AbortController().signal).then(
          (n) => (airlineLabel ??= n[code] ?? null),
          () => undefined,
        );
      }
      if (view.airport && !hadCenterParam) {
        // centre on the airport once its coordinates are known
        fetch(new URL(`api/v1/airports/${view.airport}`, document.baseURI))
          .then((r) => r.json())
          .then((d: { airport?: { lat: number; lon: number } }) => d.airport && c.flyTo(d.airport.lat, d.airport.lon, 10))
          .catch(() => undefined);
      }
      if (params.has("e2e")) {
        (window as unknown as Record<string, unknown>).__flights = {
          map: c.map,
          store,
          layer: c.aircraft,
          select: selectAircraft,
          recentTrails: c.recentTrails,
        };
      }
    })();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (ui.selected) selectAircraft(null);
        else if (ui.airport) selectAirport(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      alive = false;
      typeHexes.stop();
      window.removeEventListener("keydown", onKey);
      timers.forEach(clearTimeout);
      fallback?.stop();
      ctl?.destroy();
      ctl = undefined;
    };
  });

  const panelOpen = $derived(Boolean(ui.selected || ui.airport));
</script>

<main class="app" class:has-panel={panelOpen} class:sheet-open={panelOpen && sheetHeight > 0} style={`--sheet-h:${panelOpen ? sheetHeight : 0}px`}>
  <h1 class="sr-only">Contrail, live air traffic map</h1>

  <!-- search and filters come before the map in the DOM, so they are first in the tab order, ahead of the attribution links inside the map -->
  <div class="topbar">
    <div class="brand" aria-hidden="true">
      <svg viewBox="0 0 32 32" width="26" height="26">
        <g stroke="currentColor" stroke-width="2.4" stroke-linecap="round" fill="none">
          <path d="M3 27 L13 17" opacity="0.35" />
          <path d="M7 30 L15 22" opacity="0.6" />
        </g>
        <path fill="var(--accent)" transform="translate(19.5 12.5) rotate(45) scale(0.36) translate(-32 -32)" d="M32 4C34 4 35 8 35 14L35 26L58 40L58 45L35 38L35 50L42 56L42 59L32 57L22 59L22 56L29 50L29 38L6 45L6 40L29 26L29 14C29 8 30 4 32 4Z" />
      </svg>
      <span>Contrail</span>
    </div>
    <SearchBox onAircraft={onSearchAircraft} onAirport={onSearchAirport} onAirline={onSearchAirline} />
    <FilterPopover bind:filters={ui.filters} {store} onTrails={setTrails} />
    <ProjectionToggle globe={ui.globe} onChange={(g) => { ui.globe = g; ctl?.setGlobe(g, true); }} />
    <ThemeToggle pref={themeState.pref} onChange={setThemePref} />
    <FreshnessChip status={ui.status} count={ui.aircraftCount} />
    {#if ui.filters.airline}
      <FilterChip
        id="chip-airline"
        label={`Only ${airlineLabel ?? ui.filters.airline}`}
        clearLabel={`Show all airlines instead of only ${airlineLabel ?? ui.filters.airline}`}
        onClear={() => { ui.filters = { ...ui.filters, airline: null }; airlineLabel = null; }}
      />
    {/if}
    {#if ui.filters.callsigns.length}
      <FilterChip id="chip-callsign" label={`Callsign ${ui.filters.callsigns.map((c) => `${c}*`).join(", ")}`} clearLabel="Remove the callsign filter" onClear={() => (ui.filters = { ...ui.filters, callsigns: [] })} />
    {/if}
    {#if ui.filters.types.length}
      <FilterChip id="chip-types" label={`Type ${ui.filters.types.join(", ")}`} clearLabel="Remove the aircraft type filter" onClear={() => (ui.filters = { ...ui.filters, types: [] })} />
    {/if}
    {#if ui.trails}
      <FilterChip
        id="chip-trails"
        label={ui.trailsStatus.state === "zoom" ? `Tracks ${ui.trails} min, zoom in` : `Tracks ${ui.trails} min`}
        clearLabel="Turn recent tracks off"
        onClear={() => setTrails(0)}
      />
    {/if}
  </div>

  <div class="map" bind:this={container} role="application" aria-label="Live aircraft map"></div>

  <ViewList {store} center={() => { const c = ctl?.map.getCenter(); return { lat: c?.lat ?? 0, lon: c?.lng ?? 0 }; }} accepts={accept} onPick={(h) => { selectAircraft(h); }} />

  <div class="legend-slot"><AltitudeLegend mapTheme={ui.globe ? "dark" : themeState.theme} uiTheme={themeState.theme} /></div>

  {#if ui.selected}
    {#key ui.selected}
      <PanelHost label="Aircraft details" onClose={() => selectAircraft(null)} onHeight={(h) => (sheetHeight = h)}>
        <AircraftPanel {store} hex={ui.selected} onClose={() => selectAircraft(null)} onTrail={(t: Trail | null) => ctl?.setTrail(t)} onRoute={(r) => ctl?.setRoute(r)} onLocate={locateSelected} />
      </PanelHost>
    {/key}
  {:else if ui.airport}
    {#key ui.airport}
      <PanelHost label="Airport details" onClose={() => selectAirport(null)} onHeight={(h) => (sheetHeight = h)}>
        <AirportCard code={ui.airport} onClose={() => selectAirport(null)} onPick={(h) => selectAircraft(parseInt(h, 16))} />
      </PanelHost>
    {/key}
  {/if}

  {#if ui.basemapNotice && !ui.problem}
    <p class="notice" role="status">The map background could not be loaded (blocked or offline). Aircraft are still live.</p>
  {/if}

  {#if ui.problem}
    <MapProblemView problem={ui.problem} {store} centre={{ lat: view0.lat, lon: view0.lon }} count={ui.aircraftCount} />
  {/if}
</main>

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
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
    pointer-events: none;
    z-index: 5;
  }
  .topbar > :global(*) {
    pointer-events: auto;
  }
  .brand {
    display: none;
    align-items: center;
    gap: 10px;
    height: 44px;
    padding: 0 16px 0 12px;
    border-radius: var(--radius);
    background: var(--surface);
    font-size: var(--fs-m);
    font-weight: 700;
    letter-spacing: -0.01em;
    user-select: none;
  }
  @media (min-width: 900px) {
    .brand {
      display: inline-flex;
    }
  }
  .legend-slot {
    position: absolute;
    right: var(--gutter);
    bottom: calc(140px + env(safe-area-inset-bottom));
    z-index: 4;
  }
  @media (min-width: 900px) {
    /* the panel sits on the right: the top bar and the bottom-right map furniture make room for it */
    .has-panel .topbar {
      right: calc(var(--gutter) + 392px);
    }
    .has-panel .legend-slot {
      right: calc(var(--gutter) + 392px);
    }
    .has-panel :global(.maplibregl-ctrl-bottom-right) {
      right: 392px;
    }
  }
  /* on phones the bottom sheet covers the lower part of the map: lift the map controls above it */
  .sheet-open :global(.maplibregl-ctrl-bottom-right),
  .sheet-open :global(.maplibregl-ctrl-bottom-left) {
    bottom: var(--sheet-h);
    transition: bottom 0.22s ease;
  }
  .sheet-open .legend-slot {
    display: none;
  }
  .notice {
    position: absolute;
    left: 50%;
    top: calc(64px + env(safe-area-inset-top));
    transform: translateX(-50%);
    margin: 0;
    padding: 8px 14px;
    border-radius: var(--radius);
    background: var(--surface);
    font-size: var(--fs-s);
    z-index: 8;
    max-width: calc(100vw - 24px);
  }
</style>
