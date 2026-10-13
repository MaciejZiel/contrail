<script lang="ts">
  import { onMount } from "svelte";
  import { fetchAircraft, fetchRoute, fetchTrail, type AircraftInfo, type Loaded, type RouteInfo, type Trail } from "../core/api";
  import { serverNow } from "../core/clock";
  import { fmtAge, fmtAlt, fmtAltFull, fmtSpeed, fmtTrack, fmtVrate, progressAlong, squawkMeaning } from "../core/format";
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
  }: {
    store: AircraftStore;
    hex: string;
    onClose: () => void;
    onTrail: (t: Trail | null) => void;
    onLocate: (lat: number, lon: number) => void;
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
    progress: null as number | null,
    tracked: false,
  });
  let copied = $state(false);

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
      progress:
        route.state === "ok"
          ? progressAlong(route.value.origin, route.value.destination, yToLatLocal(pos.y), pos.x * 360 - 180)
          : null,
    };
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
    const guard = <T,>(p: Promise<Loaded<T>>, set: (v: Loaded<T>) => void) =>
      p.then(set, (e: unknown) => {
        if (!ctl.signal.aborted) set({ state: "error", reason: e instanceof Error ? e.message : "failed" });
      });
    void guard(fetchAircraft(h, ctl.signal), (v) => {
      info = v;
      if (v.state === "ok" && !store.get(parseInt(h, 16))) onLocate(v.value.lat, v.value.lon);
    });
    void guard(fetchRoute(h, ctl.signal), (v) => (route = v));
    const loadTrail = () =>
      guard(fetchTrail(h, ctl.signal), (v) => {
        trail = v;
        onTrail(v.state === "ok" ? v.value : null);
      });
    void loadTrail();
    const t = setInterval(() => void loadTrail(), 15000);
    // a route lookup that failed is retried once a minute
    const r = setInterval(() => {
      if (route.state === "error") void guard(fetchRoute(h, ctl.signal), (v) => (route = v));
    }, 60000);
    return () => {
      ctl.abort();
      clearInterval(t);
      clearInterval(r);
      onTrail(null);
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
</script>

<aside class="panel" aria-label="Aircraft details" data-testid="aircraft-panel">
  <header>
    <div class="titles">
      <h2>{title}</h2>
      <p class="sub">
        {#if data?.airline}{data.airline.name}{:else if data?.type_name}{data.type_name}{:else}&nbsp;{/if}
      </p>
    </div>
    <button class="close" onclick={onClose} aria-label="Close aircraft details">×</button>
  </header>

  {#if emergency}
    <p class="alert" role="alert">Squawk {live.squawk}: {emergency}</p>
  {/if}

  <Photo {hex} registration={data?.registration ?? ""} typeCode={data?.type_code ?? ""} typeName={data?.type_name ?? null} category={data?.category ?? "unknown"} ready={info.state !== "loading"} />
  <RouteBar {route} {progress} />

  <dl class="stats">
    <div><dt>Altitude</dt><dd>{fmtAlt(live.altFt, live.onGround)}</dd></div>
    <div><dt>Ground speed</dt><dd>{fmtSpeed(live.speedKt)}</dd></div>
    <div><dt>Vertical rate</dt><dd>{fmtVrate(live.vrate)}</dd></div>
    <div><dt>Track</dt><dd>{fmtTrack(live.track)}</dd></div>
    <div><dt>Squawk</dt><dd>{live.squawk ?? "–"}</dd></div>
    <div><dt>Position</dt><dd>{live.tracked ? fmtAge(live.ageS) : "not in view"}</dd></div>
  </dl>

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
