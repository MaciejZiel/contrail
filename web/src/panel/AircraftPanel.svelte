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
      <Sparkline title="Altitude" times={series?.t ?? []} values={series?.alt ?? []} color="var(--spark-1)" unit="ft" {now} fill big format={(v) => Math.round(v).toLocaleString("en")} />
      <Sparkline title="Ground speed" times={series?.t ?? []} values={series?.gs ?? []} color="var(--spark-2)" unit="kt" {now} format={(v) => Math.round(v).toString()} />
      <Sparkline title="Vertical rate" times={series?.t ?? []} values={series?.vr ?? []} color="var(--spark-2)" unit="ft/min" {now} zero format={(v) => Math.round(v).toLocaleString("en")} />
      {#if series && series.t.length > 0}
        <p class="muted since" data-testid="history-since">
          History starts {fmtAge(now - (series.t[0] as number))}, when this server first saw the flight. It is not the whole flight.
        </p>
      {/if}
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
    padding: 18px 16px 16px;
    overflow-y: auto;
    overscroll-behavior: contain;
    background: var(--surface);
    border-radius: var(--radius);
    box-shadow: var(--shadow); /* taste-skill-ignore: the desktop panel floats over the map */
  }
  .panel > :global(*) {
    flex: none;
  }
  /* The parts come in one after the other: opacity and a short rise, transform only. */
  .panel > :global(*) {
    animation: rise 380ms cubic-bezier(0.2, 0.8, 0.2, 1) both;
    animation-delay: calc(var(--i, 0) * 60ms);
  }
  .panel > :nth-child(1) { --i: 0; }
  .panel > :nth-child(2) { --i: 1; }
  .panel > :nth-child(3) { --i: 2; }
  .panel > :nth-child(4) { --i: 3; }
  .panel > :nth-child(5) { --i: 4; }
  .panel > :nth-child(6) { --i: 5; }
  .panel > :nth-child(n + 7) { --i: 6; }
  @keyframes rise {
    from {
      opacity: 0;
      transform: translateY(12px);
    }
    to {
      opacity: 1;
      transform: none;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .panel > :global(*) {
      animation: none;
    }
  }
  /* Order of the parts: header, route, photo, the live numbers, the altitude chart, details. On the
     phone the peek (196 px) shows the header and the route, the half-open sheet adds the photo, the
     full sheet the rest. */
  .panel > header {
    order: 0;
  }
  .panel > .alert {
    order: 1;
  }
  .panel > :global(.route) {
    order: 2;
  }
  .panel > .photo-slot {
    order: 3;
  }
  .panel > .charts {
    order: 4;
  }
  .panel > .stats {
    order: 5;
  }
  .panel > .ages {
    order: 6;
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
  .panel > .details {
    order: 7;
  }
  .panel > footer {
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
    outline: none; /* focused by script so a screen reader announces it; not an interactive control */
    font: 700 var(--fs-xl) / 1.05 var(--font);
    letter-spacing: -0.02em;
  }
  .sub {
    margin: 4px 0 0;
    color: var(--text-dim);
    font-size: var(--fs-s);
  }
  .close {
    flex: none;
    width: 40px;
    height: 40px;
    margin: -6px -6px 0 0;
    border: 0;
    border-radius: var(--radius);
    background: none;
    font-size: 24px;
    line-height: 1;
    color: var(--text-dim);
    cursor: pointer;
    transition: background-color 120ms, color 120ms;
  }
  .close:hover {
    background: var(--surface-2);
    color: var(--text);
  }
  .alert {
    margin: 0;
    padding: 10px 12px;
    border-radius: var(--radius);
    background: color-mix(in srgb, var(--bad) 18%, transparent);
    font-weight: 600;
  }
  .stats {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 14px 16px;
    margin: 0;
    padding: 14px;
    border-radius: var(--radius);
    background: var(--surface-2);
  }
  dt {
    font-size: var(--fs-s);
    color: var(--text-dim);
  }
  dd {
    margin: 2px 0 0;
    font: 600 var(--fs-l) / 1.2 var(--font);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }
  .charts {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px;
  }
  .charts > .since {
    grid-column: 1 / -1;
    margin: 4px 0 0;
    font-size: var(--fs-s);
  }
  .charts > :global(.spark:first-child),
  .charts > .muted {
    grid-column: 1 / -1;
  }
  .details {
    display: grid;
    grid-template-columns: 1fr;
    gap: 10px;
    margin: 0;
    padding: 14px;
    border-radius: var(--radius);
    background: var(--surface-2);
  }
  .details div {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: 12px;
  }
  .details dd {
    font: 500 var(--fs-m) / 1.3 var(--font);
    text-align: right;
    white-space: normal;
  }
  .mono {
    font-variant-numeric: tabular-nums;
    letter-spacing: 0.02em;
  }
  .muted {
    color: var(--text-dim);
    font-size: var(--fs-s);
    margin: 0;
  }
  .full {
    justify-content: flex-start !important;
  }
  footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    flex-wrap: wrap;
  }
  .ghost {
    padding: 8px 14px;
    min-height: 40px;
    border: 0;
    border-radius: var(--radius);
    background: var(--surface-3);
    font-weight: 600;
    font-size: var(--fs-s);
    cursor: pointer;
    transition: background-color 120ms, transform 120ms;
  }
  .ghost:hover {
    background: var(--track);
  }
  .ghost:active {
    transform: translateY(1px);
  }
  /* the phone sheet: tighter, so the half-open state still shows header, route and photo */
  :global(.sheet) .panel {
    gap: 10px;
    padding: 2px 16px 16px;
    background: none;
    box-shadow: none; /* taste-skill-ignore: reset */
  }
  :global(.sheet) h2 {
    font-size: 24px;
  }
</style>