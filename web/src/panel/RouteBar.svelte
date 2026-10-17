<script lang="ts">
  import type { Loaded, RouteInfo } from "../core/api";
  import { type Eta, fmtDistance, fmtDuration, fmtUtc } from "../core/geodesy";

  let {
    route,
    progress,
    flownKm,
    remainingKm,
    eta,
  }: { route: Loaded<RouteInfo>; progress: number | null; flownKm: number | null; remainingKm: number | null; eta: Eta | null } = $props();

  const code = (a: { iata: string; icao: string }) => a.iata || a.icao;
</script>

<section class="route" aria-label="Route">
  {#if route.state === "ok"}
    {@const r = route.value}
    <div class="strip">
      <div class="end">
        <strong class="num">{code(r.origin)}</strong>
        <span title={r.origin.name}>{r.origin.city || r.origin.name}</span>
      </div>
      <div class="track" role="img" aria-label={progress === null ? "Progress unknown" : `${Math.round(progress * 100)} percent of the route flown`}>
        <div class="line"></div>
        {#if progress !== null}
          <div class="done" style={`width:${progress * 100}%`}></div>
          <svg class="plane" style={`left:${progress * 100}%`} viewBox="0 0 64 64" aria-hidden="true">
            <path d="M32 4C34 4 35 8 35 14L35 26L58 40L58 45L35 38L35 50L42 56L42 59L32 57L22 59L22 56L29 50L29 38L6 45L6 40L29 26L29 14C29 8 30 4 32 4Z" />
          </svg>
        {/if}
      </div>
      <div class="end right">
        <strong class="num">{code(r.destination)}</strong>
        <span title={r.destination.name}>{r.destination.city || r.destination.name}</span>
      </div>
    </div>
    {#if r.plausible && flownKm !== null && remainingKm !== null}
      <dl class="legs">
        <div><dt>Flown</dt><dd class="num">{fmtDistance(flownKm)}</dd></div>
        <div><dt>Remaining</dt><dd class="num">{fmtDistance(remainingKm)}</dd></div>
        {#if eta}
          <div class="eta" title="Estimate: remaining great-circle distance divided by the current ground speed. Wind, routing and the approach are not considered.">
            <dt>Arrival <em>estimate</em></dt>
            <dd class="num">in {fmtDuration(eta.minutes)} · {fmtUtc(eta.arrivalUtc)}</dd>
          </div>
        {/if}
      </dl>
      <p class="fine">Distances are straight lines between the airports and the aircraft, not the flown path.</p>
    {/if}
    {#if !r.plausible}
      <p class="note">This aircraft does not look like it is flying this scheduled route right now.</p>
    {/if}
  {:else if route.state === "loading"}
    <div class="skeleton" aria-hidden="true"></div>
    <span class="sr-only">Loading route</span>
  {:else if route.state === "error"}
    <p class="note">Route information is temporarily unavailable.</p>
  {:else}
    <p class="note">{route.reason === "no_callsign" ? "No callsign, so no route." : "No scheduled route known for this flight."}</p>
  {/if}
</section>

<style>
  .route {
    padding: 14px;
    border-radius: var(--radius);
    background: var(--surface-2);
  }
  .strip {
    display: grid;
    grid-template-columns: auto minmax(40px, 1fr) auto;
    align-items: start;
    gap: 12px;
  }
  .end {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }
  .end.right {
    text-align: right;
    align-items: flex-end;
  }
  strong {
    font: 700 var(--fs-xl) / 1.05 var(--font);
    letter-spacing: -0.02em;
  }
  .end span {
    margin-top: 4px;
    font-size: var(--fs-s);
    color: var(--text-dim);
    max-width: 120px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .track {
    position: relative;
    height: 24px;
    margin-top: 4px;
  }
  .line,
  .done {
    position: absolute;
    top: 10px;
    height: 4px;
  }
  .line {
    left: 0;
    right: 0;
    background: var(--surface-3);
  }
  .done {
    left: 0;
    background: var(--accent);
  }
  .plane {
    position: absolute;
    top: 0;
    width: 24px;
    height: 24px;
    transform: translateX(-50%) rotate(90deg);
    fill: var(--accent);
    stroke: var(--surface-2);
    stroke-width: 4;
    paint-order: stroke;
  }
  /* distances and the estimate need room: they appear once the sheet is expanded */
  :global(.sheet:not(.expanded)) .legs,
  :global(.sheet:not(.expanded)) .fine {
    display: none;
  }
  .legs {
    display: grid;
    gap: 6px;
    margin: 14px 0 0;
    padding: 12px 14px;
    border-radius: var(--radius-sm);
    background: var(--surface-3);
  }
  .legs div {
    display: flex;
    justify-content: space-between;
    gap: 10px;
  }
  .legs dt {
    font-size: var(--fs-s);
    color: var(--text-dim);
  }
  .legs dt em {
    font-style: normal;
  }
  .legs dd {
    margin: 0;
    font-weight: 600;
    font-size: var(--fs-s);
    text-align: right;
  }
  .fine {
    margin: 8px 0 0;
    font-size: var(--fs-s);
    color: var(--text-dim);
  }
  .note {
    margin: 0;
    font-size: var(--fs-s);
    color: var(--text-dim);
  }
  .skeleton {
    height: 52px;
    border-radius: var(--radius-sm);
    background: var(--surface-3);
    animation: pulse 1.4s ease-in-out infinite;
  }
  @keyframes pulse {
    50% {
      opacity: 0.45;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .skeleton {
      animation: none;
    }
  }
  :global(.sheet) strong {
    font-size: 24px;
  }
  :global(.sheet) .route {
    padding: 10px 14px;
  }
</style>
