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

  const FREQ_NAMES: Record<string, string> = { ATIS: "ATIS", TWR: "Tower", GND: "Ground", CLD: "Clearance", DEL: "Delivery", APP: "Approach", DEP: "Departure", CTAF: "CTAF", UNICOM: "Unicom", "A/D": "Arrival / departure", AFIS: "AFIS", ATF: "ATF" };
  const SURFACES: Array<[RegExp, string]> = [[/^(ASP|ASPH)/, "asphalt"], [/^(CON|CONC)/, "concrete"], [/^(GRS|GRASS|TURF)/, "grass"], [/^(GRV|GRVL|GRAVEL)/, "gravel"], [/^(DIRT|EARTH)/, "dirt"], [/^(WATER)/, "water"], [/^(SAND)/, "sand"], [/^(SNOW|ICE)/, "snow or ice"]];
  function surfaceName(code: string): string {
    const c = code.toUpperCase();
    return SURFACES.find(([re]) => re.test(c))?.[1] ?? (code ? code.toLowerCase() : "surface unknown");
  }

  /** Both end names ("09 / 27"), or a numbered fallback for the runways the data leaves unnamed. */
  const runwayName = (ends: readonly string[], i: number): string => ends.filter(Boolean).join(" / ") || `Runway ${i + 1}`;

  let heading: HTMLHeadingElement | undefined;
  onMount(() => heading?.focus({ preventScroll: true })); // a new panel takes keyboard focus
</script>

<aside class="panel" aria-label="Airport details" data-testid="airport-card">
  <header style="--i: 0">
    <div class="titles">
      <h2 tabindex="-1" bind:this={heading}>{airport ? airport.iata || airport.icao : code}</h2>
      <p class="name">
        {#if airport}{airport.name}{:else if detail.state === "none"}Unknown airport{:else}&nbsp;{/if}
      </p>
      {#if airport}
        <p class="sub num">
          {airport.icao}{airport.iata ? ` · ${airport.iata}` : ""} · {[airport.city, airport.country].filter(Boolean).join(", ")}{airport.elevation_ft !== null ? ` · ${airport.elevation_ft.toLocaleString("en")} ft` : ""}
        </p>
        <p class="sub">{airport.type}{airport.scheduled_service ? ", scheduled service" : ""}{airport.region ? ` · ${airport.region}` : ""}</p>
      {/if}
    </div>
    <button class="close" onclick={onClose} aria-label="Close airport details">×</button>
  </header>

  <section class="block" aria-label="Weather" style="--i: 1">
    <h3>Weather (METAR)</h3>
    {#if !weather}
      <div class="skeleton" aria-hidden="true"></div>
    {:else if weather.metar.state === "ok"}
      {@const m = weather.metar.value}
      <div class="cat" data-cat={m.flight_category || "none"}>
        <strong>{m.flight_category || "n/a"}</strong>
        <span class="catname">{CATEGORY_LABEL[m.flight_category] ?? "Flight category unknown"}</span>
        <span class="age num">observed {fmtAge(Math.max(0, now - m.observed_at))}</span>
      </div>
      <dl class="wx num">
        <div><dt>Wind</dt><dd>{windText(m)}</dd></div>
        <div><dt>Visibility</dt><dd>{visibilityText(m)}</dd></div>
        <div><dt>Clouds</dt><dd>{cloudsText(m)}</dd></div>
        <div><dt>Temperature</dt><dd>{tempText(m)}</dd></div>
        <div><dt>Pressure</dt><dd>{pressureText(m)}</dd></div>
      </dl>
      <code class="raw num">{m.raw}</code>
    {:else if weather.metar.state === "error"}
      <p class="muted">Weather is temporarily unavailable.</p>
    {:else if weather.metar.state === "none" && weather.metar.reason === "no_station"}
      <p class="muted">This airport has no weather station.</p>
    {:else}
      <p class="muted">No weather report for this airport right now.</p>
    {/if}
    {#if weather?.taf.state === "ok"}
      <details>
        <summary>Forecast (TAF)</summary>
        <code class="raw num">{weather.taf.value}</code>
      </details>
    {/if}
  </section>

  <section class="block" aria-label="Traffic" style="--i: 2">
    <h3>Traffic within 10 nm</h3>
    {#if detail.state === "ok"}
      <p class="summary num" data-testid="airport-summary">
        <span><b>{detail.value.counts.arriving}</b> arriving</span>
        <span><b>{detail.value.counts.departing}</b> departing</span>
        <span><b>{detail.value.counts.ground}</b> on the ground</span>
      </p>
    {/if}
    {#if detail.state === "loading"}
      <div class="skeleton" aria-hidden="true"></div>
    {:else if nearby.length === 0}
      <p class="muted">No aircraft are being tracked close to this airport right now.</p>
    {:else}
      {#each LABELS as [key, label] (key)}
        {#if groups[key].length}
          <h4>{label} <small class="num">{groups[key].length}</small></h4>
          <ul data-group={key}>
            {#each groups[key] as n (n.hex)}
              {@render row(n)}
            {/each}
          </ul>
        {/if}
      {/each}
    {/if}
    <p class="note">Inferred from position and vertical rate of tracked aircraft; a route the server already knows settles arriving or departing. This is not a flight schedule.</p>
  </section>

  {#if airport}
    <section class="block" aria-label="Airport information" data-testid="airport-info" style="--i: 3">
      <h3>Airport</h3>
      {#if airport.runways.length}
        <table aria-label="Runways" class="num">
          <thead><tr><th scope="col">Runway</th><th scope="col">Length</th><th scope="col">Surface</th></tr></thead>
          <tbody>
            {#each airport.runways as r, i (i)}
              <tr>
                <th scope="row">{runwayName(r.ends, i)}</th>
                <td>{Math.round(r.length_ft * 0.3048).toLocaleString("en")} m <small>({r.length_ft.toLocaleString("en")} ft)</small></td>
                <td>{surfaceName(r.surface)}{r.lighted ? ", lit" : ""}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      {:else}
        <p class="muted">No runway data for this airport.</p>
      {/if}
      {#if airport.frequencies.length}
        <h4>Frequencies</h4>
        <ul class="freqs num" aria-label="Frequencies">
          {#each airport.frequencies as f, i (`${f.type}${f.mhz}${i}`)}
            <li><span>{FREQ_NAMES[f.type] ?? f.type}</span><b>{f.mhz.toFixed(3)}</b></li>
          {/each}
        </ul>
      {/if}
      {#if airport.wikipedia || airport.website}
        <p class="links">
          {#if airport.wikipedia}<a href={airport.wikipedia} target="_blank" rel="noopener noreferrer">Wikipedia</a>{/if}
          {#if airport.website}<a href={airport.website} target="_blank" rel="noopener noreferrer">Airport website</a>{/if}
        </p>
      {/if}
      <p class="note">Airport data: <a href="https://ourairports.com" target="_blank" rel="noopener noreferrer">OurAirports</a> (public domain). Frequencies may be out of date; do not use them for navigation.</p>
    </section>
  {/if}
</aside>

{#snippet row(n: NearbyAircraft)}
  <li>
    <button class="plane" onclick={() => onPick(n.hex)}>
      <strong>{n.callsign || n.registration || n.hex.toUpperCase()}</strong>
      <span class="meta">{[n.origin && n.destination ? `${n.origin} → ${n.destination}` : null, n.airline, n.type_code].filter(Boolean).join(" · ")}</span>
      <span class="side num">{n.state === "ground" ? `${n.distance_nm} nm` : `${fmtAlt(n.altitude_ft)} · ${fmtVrate(n.vertical_rate_fpm)}`}</span>
    </button>
  </li>
{/snippet}

<style>
  .panel {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 8px;
    overflow-y: auto;
    overscroll-behavior: contain;
    background: var(--surface);
    border-radius: var(--radius);
    box-shadow: var(--shadow); /* taste-skill-ignore: the desktop card floats over the map */
  }
  .panel > :global(*) {
    flex: none;
  }
  /* each part rises in turn */
  header,
  .block {
    animation: rise 0.45s cubic-bezier(0.2, 0.8, 0.2, 1) both;
    animation-delay: calc(var(--i, 0) * 60ms);
  }
  @keyframes rise {
    from {
      opacity: 0;
      transform: translateY(12px);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    header,
    .block {
      animation: none;
    }
    .skeleton {
      animation: none;
    }
  }
  header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    padding: 10px 8px 6px 10px;
  }
  h2 {
    margin: 0;
    font: 700 var(--fs-xl)/1.05 var(--font);
    letter-spacing: -0.02em;
    outline: none;
  }
  .name {
    margin: 6px 0 0;
    font-size: var(--fs-l);
    font-weight: 500;
    line-height: 1.25;
  }
  .sub {
    margin: 4px 0 0;
    font-size: var(--fs-s);
    color: var(--text-dim);
  }
  .name + .sub {
    margin-top: 8px;
  }
  .close {
    width: 44px;
    height: 44px;
    margin: -4px -4px 0 8px;
    border: 0;
    border-radius: var(--radius);
    background: none;
    font-size: 26px;
    color: var(--text-dim);
    cursor: pointer;
    transition: background-color 0.15s, color 0.15s;
  }
  .close:hover {
    background: var(--surface-2);
    color: var(--text);
  }
  .block {
    padding: 14px;
    border-radius: var(--radius);
    background: var(--surface-2);
  }
  h3 {
    margin: 0 0 12px;
    font-size: var(--fs-m);
    font-weight: 600;
  }
  h4 {
    margin: 16px 0 4px;
    font-size: var(--fs-s);
    font-weight: 600;
    color: var(--text-dim);
  }
  h4 small {
    font-weight: 400;
  }
  .cat {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 4px 12px;
  }
  .cat strong {
    padding: 4px 10px;
    border-radius: var(--radius-sm);
    background: var(--surface-3);
    font-size: var(--fs-m);
    font-weight: 700;
  }
  .cat[data-cat="VFR"] strong {
    background: #4ade80;
    color: #08170d;
  }
  .cat[data-cat="MVFR"] strong {
    background: #60a5fa;
    color: #08121f;
  }
  .cat[data-cat="IFR"] strong {
    background: #f87171;
    color: #1f0a0a;
  }
  .cat[data-cat="LIFR"] strong {
    background: #e879f9;
    color: #1e0a21;
  }
  .catname {
    font-size: var(--fs-s);
  }
  .age {
    margin-left: auto;
    color: var(--text-dim);
    font-size: var(--fs-s);
  }
  .wx {
    margin: 14px 0 0;
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px;
  }
  .wx div {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 10px 12px;
    border-radius: var(--radius-sm);
    background: var(--surface-3);
    min-width: 0;
  }
  .wx div:nth-child(5) {
    grid-column: 1 / -1;
  }
  dt {
    color: var(--text-dim);
    font-size: var(--fs-s);
  }
  dd {
    margin: 0;
    font-size: var(--fs-m);
    font-weight: 600;
    overflow-wrap: anywhere;
  }
  .raw {
    display: block;
    font-family: var(--font);
    margin: 12px 0 0;
    font-size: var(--fs-s);
    line-height: 1.5;
    overflow-wrap: anywhere;
    color: var(--text-dim);
  }
  details {
    margin-top: 12px;
  }
  summary {
    cursor: pointer;
    min-height: 32px;
    display: flex;
    align-items: center;
    font-size: var(--fs-s);
    font-weight: 600;
  }
  details .raw {
    margin-top: 4px;
  }
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .plane {
    display: grid;
    grid-template-columns: minmax(64px, auto) 1fr auto;
    gap: 12px;
    align-items: center;
    width: 100%;
    min-height: 44px;
    padding: 6px 10px;
    margin-bottom: 2px;
    border: 0;
    border-radius: var(--radius-sm);
    background: var(--surface-3);
    text-align: left;
    cursor: pointer;
    transition: background-color 0.15s;
  }
  .plane:hover {
    background: var(--surface-4);
  }
  .plane strong {
    font-size: var(--fs-m);
    font-weight: 700;
  }
  .meta {
    color: var(--text-dim);
    font-size: var(--fs-s);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .side {
    font-size: var(--fs-s);
    color: var(--text-dim);
  }
  .summary {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 8px;
    margin: 0 0 4px;
    font-size: var(--fs-s);
    color: var(--text-dim);
  }
  .summary span {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 10px 12px;
    border-radius: var(--radius-sm);
    background: var(--surface-3);
  }
  .summary b {
    font-size: var(--fs-xl);
    line-height: 1.05;
    font-weight: 700;
    color: var(--text);
  }
  table {
    width: 100%;
    border-collapse: separate;
    border-spacing: 0 2px;
    font-size: var(--fs-s);
  }
  th,
  td {
    padding: 9px 10px;
    text-align: left;
    vertical-align: top;
    font-weight: 400;
    background: var(--surface-3);
  }
  tr > :first-child {
    border-radius: var(--radius-sm) 0 0 var(--radius-sm);
  }
  tr > :last-child {
    border-radius: 0 var(--radius-sm) var(--radius-sm) 0;
  }
  thead th {
    background: none;
    padding-block: 4px;
    font-size: var(--fs-s);
    color: var(--text-dim);
  }
  tbody th {
    font-weight: 700;
    white-space: nowrap;
  }
  td small {
    color: var(--text-dim);
  }
  .freqs {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 2px 8px;
  }
  .freqs li {
    display: flex;
    justify-content: space-between;
    gap: 12px;
    padding: 9px 10px;
    border-radius: var(--radius-sm);
    background: var(--surface-3);
    font-size: var(--fs-s);
  }
  @media (max-width: 400px) {
    .freqs {
      grid-template-columns: 1fr;
    }
  }
  .freqs b {
    font-weight: 700;
    font-size: var(--fs-m);
  }
  .links {
    display: flex;
    flex-wrap: wrap;
    gap: 4px 20px;
    margin: 12px 0 0;
  }
  .links a {
    display: inline-flex;
    align-items: center;
    min-height: 44px;
    color: var(--accent-text);
    font-weight: 600;
    text-decoration: none;
  }
  .links a:hover,
  .note a:hover {
    text-decoration: underline;
  }
  .note a {
    color: var(--accent-text);
  }
  .muted,
  .note {
    margin: 0;
    font-size: var(--fs-s);
    color: var(--text-dim);
  }
  .note {
    margin-top: 14px;
  }
  .skeleton {
    height: 72px;
    border-radius: var(--radius-sm);
    background: var(--surface-3);
    animation: breathe 1.4s ease-in-out infinite;
  }
  @keyframes breathe {
    50% {
      opacity: 0.45;
    }
  }
</style>
