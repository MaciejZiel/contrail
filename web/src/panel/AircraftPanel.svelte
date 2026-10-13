<script lang="ts">
  import { onMount } from "svelte";
  import { fetchAircraft, fetchRoute, fetchTrail, type AircraftInfo, type Loaded, type RouteInfo, type Trail } from "../core/api";
  import { serverNow } from "../core/clock";
  import { estimateArrival, type Eta } from "../core/geodesy";
  import { fmtAge, fmtAlt, fmtAltFull, fmtSpeed, fmtSquawk, fmtTrack, fmtVrate, haversineKm, progressAlong, squawkMeaning } from "../core/format";
  import type { AircraftStore } from "../core/store";
  import Photo from "./Photo.svelte";
  import RouteBar from "./RouteBar.svelte";
  import Sparkline from "./Sparkline.svelte";

  let {
    store,
    hex,
    onClose,
    onTrail,
    onLocate,
    onRoute,
  }: {
    store: AircraftStore;
    hex: string;
    onClose: () => void;
    onTrail: (t: Trail | null) => void;
    onLocate: (lat: number, lon: number) => void;
    onRoute: (r: RouteInfo | null) => void;
  } = $props();

  let info = $state<Loaded<AircraftInfo>>({ state: "loading" });
  let route = $state<Loaded<RouteInfo>>({ state: "loading" });
  let trail = $state<Loaded<Trail>>({ state: "loading" });
  let now = $state(serverNow());
  let live = $state({
    callsign: "",
    altFt: null as number | null,
    onGround: false,
    speedKt: null as number | null,
    vrate: null as number | null,
    track: null as number | null,
    squawk: null as number | null,
    ageS: 0,
    areaAgeS: 0,
    progress: null as number | null,
    tracked: false,
    flownKm: null as number | null,
    remainingKm: null as number | null,
    eta: null as Eta | null,
  });
  let copied = $state(false);
  let infoGaveUp = $state(false);
  const RETRY_DELAYS_S = [2, 4, 8, 16, 30, 60];

  function tick(): void {
    now = serverNow();
    const plane = store.get(parseInt(hex, 16));
    if (!plane) {
      live.tracked = false;
      return;
    }
    const pos = plane.positionAt(now);
    live = {
      tracked: true,
      callsign: plane.callsign,
      altFt: plane.altitudeAt(now),
      onGround: plane.onGround,
      speedKt: plane.speedKt,
      vrate: plane.onGround ? 0 : plane.vrateFpm,
      track: plane.track,
      squawk: plane.squawk || null,
      ageS: Math.max(0, now - plane.t0),
      areaAgeS: Math.max(0, now - plane.fetchedAt),
      progress: null,
      flownKm: null,
      remainingKm: null,
      eta: null,
    };
    if (route.state === "ok") {
      const lat = yToLatLocal(pos.y);
      const lon = pos.x * 360 - 180;
      const { origin, destination } = route.value;
      live.progress = progressAlong(origin, destination, lat, lon);
      live.flownKm = haversineKm(origin.lat, origin.lon, lat, lon);
      live.remainingKm = haversineKm(lat, lon, destination.lat, destination.lon);
      live.eta = plane.onGround ? null : estimateArrival(live.remainingKm, plane.speedKt, new Date());
    }
  }

  function yToLatLocal(y: number): number {
    return (180 / Math.PI) * Math.atan(Math.sinh(Math.PI - 2 * Math.PI * y));
  }

  onMount(() => {
    tick();
    const t = setInterval(tick, 500);
    return () => clearInterval(t);
  });

  // load identity, route and trail whenever the selection changes
  $effect(() => {
    const h = hex;
    const ctl = new AbortController();
    info = { state: "loading" };
    route = { state: "loading" };
    trail = { state: "loading" };
    onTrail(null);
    onRoute(null);
    const guard = <T,>(p: Promise<Loaded<T>>, set: (v: Loaded<T>) => void) =>
      p.then(set, (e: unknown) => {
        if (!ctl.signal.aborted) set({ state: "error", reason: e instanceof Error ? e.message : "failed" });
      });
    infoGaveUp = false;
    const timers: Array<ReturnType<typeof setTimeout>> = [];
    // A failed lookup (a busy server, a tile refresh in between) is retried with backoff, so the panel
    // does not stay half empty until the visitor selects something else.
    const loadInfo = (attempt: number): void => {
      void guard(fetchAircraft(h, ctl.signal), (v) => {
        info = v;
        if (v.state === "ok" && !store.get(parseInt(h, 16))) onLocate(v.value.lat, v.value.lon);
        if (v.state === "error") {
          if (attempt < RETRY_DELAYS_S.length) {
            timers.push(setTimeout(() => loadInfo(attempt + 1), (RETRY_DELAYS_S[attempt] as number) * 1000));
          } else {
            infoGaveUp = true;
          }
        }
      });
    };
    loadInfo(0);
    const loadRoute = (attempt: number): void => {
      void guard(fetchRoute(h, ctl.signal), (v) => {
        route = v;
        onRoute(v.state === "ok" ? v.value : null);
        if (v.state === "error" && attempt < RETRY_DELAYS_S.length) {
          timers.push(setTimeout(() => loadRoute(attempt + 1), (RETRY_DELAYS_S[attempt] as number) * 1000));
        }
      });
    };
    loadRoute(0);
    const loadTrail = () =>
      guard(fetchTrail(h, ctl.signal), (v) => {
        trail = v;
        onTrail(v.state === "ok" ? v.value : null);
      });
    void loadTrail();
    const t = setInterval(() => void loadTrail(), 15000);
    return () => {
      ctl.abort();
      clearInterval(t);
      timers.forEach(clearTimeout);
      onTrail(null);
      onRoute(null);
    };
  });

  const data = $derived(info.state === "ok" ? info.value : null);
  const title = $derived(live.callsign || data?.callsign || hex.toUpperCase());
  const emergency = $derived(squawkMeaning(live.squawk));
  const series = $derived(trail.state === "ok" ? trail.value : null);
  const progress = $derived(live.progress ?? (route.state === "ok" ? route.value.progress : null));

  async function copyLink(): Promise<void> {
    try {
      await navigator.clipboard.writeText(location.href);
      copied = true;
      setTimeout(() => (copied = false), 1800);
    } catch {
      /* clipboard may be blocked; the URL bar already has the link */
    }
  }

  let heading: HTMLHeadingElement | undefined;
  onMount(() => heading?.focus({ preventScroll: true })); // a new panel takes keyboard focus
</script>

<aside class="panel" aria-label="Aircraft details" data-testid="aircraft-panel">
  <header>
    <div class="titles">
      <h2 tabindex="-1" bind:this={heading}>{title}</h2>
      <p class="sub">
        {#if data?.airline}{data.airline.name}{:else if data?.type_name}{data.type_name}{:else}&nbsp;{/if}
      </p>
    </div>
    <button class="close" onclick={onClose} aria-label="Close aircraft details">×</button>
  </header>

  {#if emergency}
    <p class="alert" role="alert">Squawk {fmtSquawk(live.squawk)}: {emergency}</p>
  {/if}

  <div class="photo-slot"><Photo {hex} registration={data?.registration ?? ""} typeCode={data?.type_code ?? ""} typeName={data?.type_name ?? null} category={data?.category ?? "unknown"} ready={info.state === "ok" || info.state === "none" || infoGaveUp} /></div>
  <RouteBar {route} {progress} flownKm={live.flownKm} remainingKm={live.remainingKm} eta={live.eta} />

  <dl class="stats">
    <div><dt>Altitude</dt><dd>{fmtAlt(live.altFt, live.onGround)}</dd></div>
    <div><dt>Ground speed</dt><dd>{fmtSpeed(live.speedKt)}</dd></div>
    <div><dt>Vertical rate</dt><dd>{fmtVrate(live.vrate)}</dd></div>
    <div><dt>Track</dt><dd>{fmtTrack(live.track)}</dd></div>
    <div><dt>Squawk</dt><dd>{fmtSquawk(live.squawk)}</dd></div>
    <div><dt>Position</dt><dd>{live.tracked ? fmtAge(live.ageS) : "not in view"}</dd></div>
  </dl>

  {#if live.tracked}
    <p class="muted ages">Position fix {fmtAge(live.ageS)} · area data refreshed {fmtAge(live.areaAgeS)}</p>
  {/if}

  <section class="charts" aria-label="Flight history">
    {#if trail.state === "error"}
      <p class="muted">History is temporarily unavailable.</p>
    {:else}
      <Sparkline title="Altitude" times={series?.t ?? []} values={series?.alt ?? []} color="#5eead4" unit="ft" {now} fill format={(v) => Math.round(v).toLocaleString("en")} />
      <Sparkline title="Ground speed" times={series?.t ?? []} values={series?.gs ?? []} color="#fbbf24" unit="kt" {now} format={(v) => Math.round(v).toString()} />
      <Sparkline title="Vertical rate" times={series?.t ?? []} values={series?.vr ?? []} color="#a78bfa" unit="ft/min" {now} zero format={(v) => Math.round(v).toLocaleString("en")} />
    {/if}
  </section>

  <dl class="details">
    <div><dt>Registration</dt><dd>{data?.registration || "–"}</dd></div>
    <div><dt>Type</dt><dd>{data?.type_name ? `${data.type_name} (${data.type_code})` : data?.type_code || "–"}</dd></div>
    <div><dt>ICAO24</dt><dd class="mono">{hex.toUpperCase()}</dd></div>
    {#if data?.military}<div><dt>Operator</dt><dd>Military</dd></div>{/if}
    {#if info.state === "none"}<div class="muted full">This aircraft is not tracked right now.</div>{/if}
    {#if info.state === "error"}<div class="muted full" role="status">Details are temporarily unavailable{infoGaveUp ? "" : ", retrying"}.</div>{/if}
  </dl>

  <footer>
    <button class="ghost" onclick={copyLink}>{copied ? "Link copied" : "Copy link"}</button>
    <span class="muted">Data: ADSB.lol · routes: VRS standing data</span>
  </footer>
  <span class="sr-only" aria-live="polite">{info.state === "ok" ? `Selected ${title}` : ""}</span>
  <span class="sr-only">{fmtAltFull(live.altFt, live.onGround)}</span>
</aside>

<style>
  .panel {
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: 14px;
    overflow-y: auto;
    overscroll-behavior: contain;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    box-shadow: var(--shadow);
    backdrop-filter: blur(10px);
  }
  .panel > :global(*) {
    flex: none;
  }
  /* Inside the phone bottom sheet the order is: header, route, photo, numbers, ...  The peek (196 px)
     shows the header and the route line, the half-open sheet adds the photo, the full sheet the rest. */
  :global(.sheet) .panel > header {
    order: 0;
  }
  :global(.sheet) .panel > .alert {
    order: 1;
  }
  :global(.sheet) .panel > :global(.route) {
    order: 2;
  }
  :global(.sheet) .panel > .photo-slot {
    order: 3;
  }
  :global(.sheet) .panel > .stats {
    order: 4;
  }
  :global(.sheet) .panel > .ages {
    order: 5;
  }
  :global(.sheet) .panel > .charts {
    order: 6;
  }
  :global(.sheet) .panel > .details {
    order: 7;
  }
  :global(.sheet) .panel > footer {
    order: 8;
  }
  header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 8px;
  }
  h2 {
    margin: 0;
    font: 700 22px var(--mono);
    letter-spacing: 0.02em;
  }
  .sub {
    margin: 2px 0 0;
    color: var(--text-dim);
    font-size: 13px;
  }
  .close {
    flex: none;
    width: 44px;
    height: 44px;
    margin: -8px -8px 0 0;
    border: 0;
    background: none;
    font-size: 26px;
    color: var(--text-dim);
    cursor: pointer;
  }
  .alert {
    margin: 0;
    padding: 8px 10px;
    border-radius: 10px;
    background: rgba(248, 113, 113, 0.16);
    border: 1px solid rgba(248, 113, 113, 0.5);
    font-weight: 600;
  }
  .stats {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 10px 8px;
    margin: 0;
  }
  dt {
    font-size: 11px;
    color: var(--text-dim);
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }
  dd {
    margin: 2px 0 0;
    font: 600 15px var(--mono);
    white-space: nowrap;
  }
  .charts {
    border-top: 1px solid var(--border);
    padding-top: 4px;
  }
  .details {
    display: grid;
    grid-template-columns: 1fr;
    gap: 8px;
    margin: 0;
    border-top: 1px solid var(--border);
    padding-top: 10px;
  }
  .details div {
    display: flex;
    justify-content: space-between;
    gap: 12px;
  }
  .details dd {
    font: 500 14px var(--font);
    text-align: right;
    white-space: normal;
  }
  .mono {
    font-family: var(--mono) !important;
  }
  .muted {
    color: var(--text-dim);
    font-size: 12px;
    margin: 0;
  }
  .full {
    justify-content: flex-start !important;
  }
  footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    flex-wrap: wrap;
  }
  .ghost {
    padding: 8px 12px;
    min-height: 40px;
    border-radius: 10px;
    background: var(--surface-2);
    border: 1px solid var(--border);
    cursor: pointer;
  }
</style>
