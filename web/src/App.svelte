<script lang="ts">
  import { onMount, tick } from "svelte";
  import { fetchAirlineNames, type SearchAircraft, type SearchAirline, type SearchAirport, type Trail } from "./core/api";
  import { accepts } from "./core/filters";
  import { ui } from "./core/state.svelte";
  import { AircraftStore } from "./core/store";
  import { parseUrlState } from "./core/urlState";
  import FilterPopover from "./filters/FilterPopover.svelte";
  import { MapController } from "./map/controller";
  import AircraftPanel from "./panel/AircraftPanel.svelte";
  import AirportCard from "./panel/AirportCard.svelte";
  import SearchBox from "./search/SearchBox.svelte";
  import AltitudeLegend from "./ui/AltitudeLegend.svelte";
  import FilterChip from "./ui/FilterChip.svelte";
  import FreshnessChip from "./ui/FreshnessChip.svelte";

  const store = new AircraftStore();
  let container: HTMLDivElement;
  let ctl: MapController | undefined;
  let airlineLabel = $state<string | null>(null);
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
      ? { x: box.right + (mapBox.right - box.right) / 2, y }
      : { x, y: mapBox.top + (box.top - mapBox.top) / 2 };
    const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
    ctl.map.panBy([x - target.x, y - target.y], { duration: reduced ? 0 : 450 });
  }

  function selectAircraft(n: number | null): void {
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

  function locateSelected(lat: number, lon: number): void {
    if (!hadCenterParam) ctl?.flyTo(lat, lon, 8);
  }

  // filters change URL state; the aircraft layer reads them on every frame
  $effect(() => {
    void ui.filters;
    ctl?.syncUrl();
  });

  onMount(() => {
    const view = parseUrlState(location.search);
    ui.selected = view.selected;
    ui.airport = view.airport;
    ui.filters = view.filters;
    ui.zoom = view.zoom;
    const params = new URLSearchParams(location.search);

    const c = new MapController({
      container,
      store,
      view,
      offline: params.get("bm") === "offline",
      getUrlSelection: () => ({ selected: ui.selected, airport: ui.airport, filters: ui.filters }),
      accepts: (p) => accepts(p, ui.filters),
      getSelected: () => (ui.selected ? parseInt(ui.selected, 16) : null),
      onSelectAircraft: selectAircraft,
      onSelectAirport: selectAirport,
      onStatus: (s) => (ui.status = s),
      onData: () => (ui.aircraftCount = store.size),
      onZoom: (z) => (ui.zoom = z),
      onWebglError: (m) => (ui.webglError = m),
    });
    ctl = c;
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
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (ui.selected) selectAircraft(null);
        else if (ui.airport) selectAirport(null);
      }
    };
    window.addEventListener("keydown", onKey);
    if (params.has("e2e")) {
      (window as unknown as Record<string, unknown>).__flights = {
        map: c.map,
        store,
        layer: c.aircraft,
        select: selectAircraft,
      };
    }
    return () => {
      window.removeEventListener("keydown", onKey);
      c.destroy();
      ctl = undefined;
    };
  });

  const panelOpen = $derived(Boolean(ui.selected || ui.airport));
</script>

<div class="app" class:has-panel={panelOpen}>
  <div class="map" bind:this={container} role="application" aria-label="Live aircraft map"></div>

  <div class="topbar">
    <SearchBox onAircraft={onSearchAircraft} onAirport={onSearchAirport} onAirline={onSearchAirline} />
    <FilterPopover bind:filters={ui.filters} {store} />
    <FreshnessChip status={ui.status} count={ui.aircraftCount} />
    {#if ui.filters.airline}
      <FilterChip label={airlineLabel ?? ui.filters.airline} onClear={() => { ui.filters = { ...ui.filters, airline: null }; airlineLabel = null; }} />
    {/if}
  </div>

  <div class="legend-slot"><AltitudeLegend /></div>

  {#if ui.selected}
    <div class="panel-slot">
      <AircraftPanel {store} hex={ui.selected} onClose={() => selectAircraft(null)} onTrail={(t: Trail | null) => ctl?.setTrail(t)} onRoute={(r) => ctl?.setRoute(r)} onLocate={locateSelected} />
    </div>
  {:else if ui.airport}
    <div class="panel-slot">
      <AirportCard code={ui.airport} onClose={() => selectAirport(null)} onPick={(h) => selectAircraft(parseInt(h, 16))} />
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
    flex-wrap: wrap;
    align-items: center;
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
    bottom: calc(140px + env(safe-area-inset-bottom));
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
    .has-panel .topbar {
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
