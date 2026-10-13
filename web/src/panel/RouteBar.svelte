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
    <div class="ends">
      <div class="end">
        <strong>{code(r.origin)}</strong>
        <span title={r.origin.name}>{r.origin.city || r.origin.name}</span>
      </div>
      <div class="end right">
        <strong>{code(r.destination)}</strong>
        <span title={r.destination.name}>{r.destination.city || r.destination.name}</span>
      </div>
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
    {#if r.plausible && flownKm !== null && remainingKm !== null}
      <dl class="legs">
        <div><dt>Flown</dt><dd>{fmtDistance(flownKm)}</dd></div>
        <div><dt>Remaining</dt><dd>{fmtDistance(remainingKm)}</dd></div>
        {#if eta}
          <div class="eta" title="Estimate: remaining great-circle distance divided by the current ground speed. Wind, routing and the approach are not considered.">
            <dt>Arrival <em>estimate</em></dt>
            <dd>in {fmtDuration(eta.minutes)} · {fmtUtc(eta.arrivalUtc)}</dd>
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
    padding: 10px 12px;
    border-radius: 12px;
    background: var(--surface-2);
  }
  .ends {
    display: flex;
    justify-content: space-between;
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
    font: 700 22px var(--mono);
    letter-spacing: 0.03em;
  }
  .end span {
    font-size: 12px;
    color: var(--text-dim);
    max-width: 150px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .track {
    position: relative;
    height: 22px;
    margin: 4px 10px 0;
  }
  .line,
  .done {
    position: absolute;
    top: 10px;
    height: 2px;
    border-radius: 1px;
  }
  .line {
    left: 0;
    right: 0;
    background: repeating-linear-gradient(90deg, var(--text-dim) 0 4px, transparent 4px 8px);
    opacity: 0.6;
  }
  .done {
    left: 0;
    background: var(--accent);
  }
  .plane {
    position: absolute;
    top: 0;
    width: 22px;
    height: 22px;
    transform: translateX(-50%) rotate(90deg);
    fill: var(--accent);
    stroke: var(--surface-2);
    stroke-width: 3;
  }
  .legs {
    display: grid;
    gap: 4px;
    margin: 8px 0 0;
  }
  .legs div {
    display: flex;
    justify-content: space-between;
    gap: 10px;
  }
  .legs dt {
    font-size: 12px;
    color: var(--text-dim);
  }
  .legs dt em {
    font-style: normal;
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 0 4px;
    margin-left: 4px;
  }
  .legs dd {
    margin: 0;
    font: 600 13px var(--mono);
    text-align: right;
  }
  .fine {
    margin: 6px 0 0;
    font-size: 11px;
    color: var(--text-dim);
  }
  .note {
    margin: 0;
    font-size: 12px;
    color: var(--text-dim);
  }
  .skeleton {
    height: 44px;
    border-radius: 8px;
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
