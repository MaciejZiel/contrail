<script lang="ts">
  import { onMount } from "svelte";
  import { fetchAirport, fetchWeather, type AirportDetail, type Loaded, type NearbyAircraft, type Weather } from "../core/api";
  import { fmtAge, fmtAlt, fmtVrate } from "../core/format";
  import { CATEGORY_LABEL, cloudsText, pressureText, tempText, visibilityText, windText } from "../core/metar";

  let { code, onClose, onPick }: { code: string; onClose: () => void; onPick: (hex: string) => void } = $props();

  let detail = $state<Loaded<AirportDetail>>({ state: "loading" });
  let weather = $state<Weather | null>(null);
  let now = $state(Date.now() / 1000);

  $effect(() => {
    const c = code;
    const ctl = new AbortController();
    detail = { state: "loading" };
    weather = null;
    const load = () =>
      fetchAirport(c, ctl.signal).then(
        (v) => (detail = v),
        () => {
          if (!ctl.signal.aborted) detail = { state: "error", reason: "failed" };
        },
      );
    void load();
    void fetchWeather(c, ctl.signal).then(
      (w) => (weather = w),
      () => {
        if (!ctl.signal.aborted) weather = { metar: { state: "error", reason: "failed" }, taf: { state: "error", reason: "failed" } };
      },
    );
    const t = setInterval(() => {
      now = Date.now() / 1000;
      void load();
    }, 10000);
    const w = setInterval(
      () =>
        void fetchWeather(c, ctl.signal).then((x) => (weather = x), () => undefined),
      300000,
    );
    return () => {
      ctl.abort();
      clearInterval(t);
      clearInterval(w);
    };
  });

  const airport = $derived(detail.state === "ok" ? detail.value.airport : null);
  const nearby = $derived(detail.state === "ok" ? detail.value.nearby : []);
  const groups = $derived({
    arriving: nearby.filter((n) => n.state === "arriving"),
    departing: nearby.filter((n) => n.state === "departing"),
    ground: nearby.filter((n) => n.state === "ground"),
    other: nearby.filter((n) => n.state === "nearby"),
  });
  const LABELS: Array<[keyof typeof groups, string]> = [
    ["arriving", "Arriving"],
    ["departing", "Departing"],
    ["ground", "On the ground"],
    ["other", "Nearby"],
  ];

  let heading: HTMLHeadingElement | undefined;
  onMount(() => heading?.focus({ preventScroll: true })); // a new panel takes keyboard focus
</script>

<aside class="panel" aria-label="Airport details" data-testid="airport-card">
  <header>
    <div class="titles">
      <h2 tabindex="-1" bind:this={heading}>{airport ? airport.iata || airport.icao : code}</h2>
      <p class="sub">
        {#if airport}{airport.name}{:else if detail.state === "none"}Unknown airport{:else}&nbsp;{/if}
      </p>
      {#if airport}
        <p class="sub small">
          {airport.icao}{airport.iata ? ` · ${airport.iata}` : ""} · {[airport.city, airport.country].filter(Boolean).join(", ")}{airport.elevation_ft !== null ? ` · ${airport.elevation_ft.toLocaleString("en")} ft` : ""}
        </p>
      {/if}
    </div>
    <button class="close" onclick={onClose} aria-label="Close airport details">×</button>
  </header>

  <section class="block" aria-label="Weather">
    <h3>Weather (METAR)</h3>
    {#if !weather}
      <div class="skeleton" aria-hidden="true"></div>
    {:else if weather.metar.state === "ok"}
      {@const m = weather.metar.value}
      <div class="cat" data-cat={m.flight_category || "none"}>
        <strong>{m.flight_category || "n/a"}</strong>
        <span>{CATEGORY_LABEL[m.flight_category] ?? "Flight category unknown"}</span>
        <span class="age">observed {fmtAge(Math.max(0, now - m.observed_at))}</span>
      </div>
      <dl class="wx">
        <div><dt>Wind</dt><dd>{windText(m)}</dd></div>
        <div><dt>Visibility</dt><dd>{visibilityText(m)}</dd></div>
        <div><dt>Clouds</dt><dd>{cloudsText(m)}</dd></div>
        <div><dt>Temperature</dt><dd>{tempText(m)}</dd></div>
        <div><dt>Pressure</dt><dd>{pressureText(m)}</dd></div>
      </dl>
      <code class="raw">{m.raw}</code>
    {:else if weather.metar.state === "error"}
      <p class="muted">Weather is temporarily unavailable.</p>
    {:else}
      <p class="muted">No weather report for this airport.</p>
    {/if}
    {#if weather?.taf.state === "ok"}
      <details>
        <summary>Forecast (TAF)</summary>
        <code class="raw">{weather.taf.value}</code>
      </details>
    {/if}
  </section>

  <section class="block" aria-label="Traffic">
    <h3>Traffic within 10 nm</h3>
    {#if detail.state === "loading"}
      <div class="skeleton" aria-hidden="true"></div>
    {:else if nearby.length === 0}
      <p class="muted">No aircraft are being tracked close to this airport right now.</p>
    {:else}
      {#each LABELS as [key, label] (key)}
        {#if groups[key].length}
          <h4>{label} <small>{groups[key].length}</small></h4>
          <ul>
            {#each groups[key] as n (n.hex)}
              {@render row(n)}
            {/each}
          </ul>
        {/if}
      {/each}
    {/if}
    <p class="note">Inferred from position and vertical rate of tracked aircraft. This is not a flight schedule.</p>
  </section>
</aside>

{#snippet row(n: NearbyAircraft)}
  <li>
    <button class="plane" onclick={() => onPick(n.hex)}>
      <strong class="mono">{n.callsign || n.registration || n.hex.toUpperCase()}</strong>
      <span class="meta">{[n.airline, n.type_code].filter(Boolean).join(" · ")}</span>
      <span class="side">{n.state === "ground" ? `${n.distance_nm} nm` : `${fmtAlt(n.altitude_ft)} · ${fmtVrate(n.vertical_rate_fpm)}`}</span>
    </button>
  </li>
{/snippet}

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
    justify-content: space-between;
    align-items: flex-start;
  }
  h2 {
    margin: 0;
    font: 700 24px var(--mono);
  }
  .sub {
    margin: 2px 0 0;
    font-size: 14px;
  }
  .small {
    font-size: 12px;
    color: var(--text-dim);
  }
  .close {
    width: 44px;
    height: 44px;
    margin: -8px -8px 0 0;
    border: 0;
    background: none;
    font-size: 26px;
    color: var(--text-dim);
    cursor: pointer;
  }
  .block {
    border-top: 1px solid var(--border);
    padding-top: 10px;
  }
  h3 {
    margin: 0 0 8px;
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--text-dim);
  }
  h4 {
    margin: 10px 0 4px;
    font-size: 13px;
  }
  h4 small {
    color: var(--text-dim);
    font-weight: 400;
  }
  .cat {
    display: flex;
    align-items: baseline;
    flex-wrap: wrap;
    gap: 4px 10px;
    padding: 8px 10px;
    border-radius: 10px;
    background: var(--surface-2);
    border-left: 4px solid var(--text-dim);
  }
  .cat[data-cat="VFR"] {
    border-color: #4ade80;
  }
  .cat[data-cat="MVFR"] {
    border-color: #60a5fa;
  }
  .cat[data-cat="IFR"] {
    border-color: #f87171;
  }
  .cat[data-cat="LIFR"] {
    border-color: #e879f9;
  }
  .cat strong {
    font: 700 16px var(--mono);
  }
  .cat span {
    font-size: 13px;
  }
  .age {
    margin-left: auto;
    color: var(--text-dim);
    font-size: 12px !important;
  }
  .wx {
    margin: 10px 0 6px;
    display: grid;
    gap: 6px;
  }
  .wx div {
    display: flex;
    justify-content: space-between;
    gap: 12px;
  }
  dt {
    color: var(--text-dim);
    font-size: 12px;
  }
  dd {
    margin: 0;
    text-align: right;
    font-size: 14px;
  }
  .raw {
    display: block;
    margin-top: 6px;
    padding: 8px 10px;
    border-radius: 8px;
    background: rgba(0, 0, 0, 0.25);
    font: 12px/1.5 var(--mono);
    overflow-wrap: anywhere;
    color: var(--text-dim);
  }
  details {
    margin-top: 8px;
  }
  summary {
    cursor: pointer;
    min-height: 32px;
    font-size: 13px;
  }
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .plane {
    display: grid;
    grid-template-columns: auto 1fr auto;
    gap: 10px;
    align-items: center;
    width: 100%;
    min-height: 44px;
    padding: 6px 8px;
    border: 0;
    border-radius: 8px;
    background: none;
    text-align: left;
    cursor: pointer;
  }
  .plane:hover {
    background: var(--surface-2);
  }
  .mono {
    font-family: var(--mono);
    min-width: 60px;
  }
  .meta {
    color: var(--text-dim);
    font-size: 13px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .side {
    font: 12px var(--mono);
    color: var(--text-dim);
  }
  .muted,
  .note {
    margin: 0;
    font-size: 12px;
    color: var(--text-dim);
  }
  .note {
    margin-top: 10px;
  }
  .skeleton {
    height: 64px;
    border-radius: 10px;
    background: linear-gradient(100deg, var(--surface-2) 30%, #223052 50%, var(--surface-2) 70%);
    background-size: 200% 100%;
    animation: shimmer 1.4s infinite linear;
  }
  @keyframes shimmer {
    to {
      background-position: -200% 0;
    }
  }
</style>
