<script lang="ts">
  import { fmtAlt } from "../core/format";
  import { serverNow } from "../core/clock";
  import type { MapProblem } from "../map/startup";
  import type { AircraftStore } from "../core/store";
  import type { Plane } from "../core/plane";
  import AircraftPanel from "../panel/AircraftPanel.svelte";

  let {
    problem,
    store,
    centre,
    count,
  }: { problem: MapProblem; store: AircraftStore; centre: { lat: number; lon: number }; count: number } = $props();

  let rows = $state<Array<{ hex: number; label: string; detail: string; type: string }>>([]);
  let selected = $state<string | null>(null);

  function refresh(): void {
    const now = serverNow();
    const scored: Array<{ d: number; p: Plane }> = [];
    for (const p of store.planes) {
      const pos = p.positionAt(now);
      const lat = (180 / Math.PI) * Math.atan(Math.sinh(Math.PI - 2 * Math.PI * pos.y));
      const lon = pos.x * 360 - 180;
      scored.push({ d: (lat - centre.lat) ** 2 + ((lon - centre.lon) * Math.cos((centre.lat * Math.PI) / 180)) ** 2, p });
    }
    scored.sort((a, b) => a.d - b.d);
    rows = scored.slice(0, 40).map(({ p }) => ({
      hex: p.hex,
      label: p.callsign || p.id.toUpperCase(),
      detail: `${fmtAlt(p.altitudeAt(now), p.onGround)} · ${p.speedKt === null ? "–" : Math.round(p.speedKt) + " kt"}`,
      type: p.id.toUpperCase(),
    }));
  }

  $effect(() => {
    void count;
    refresh();
    const t = setInterval(refresh, 3000);
    return () => clearInterval(t);
  });
</script>

<div class="overlay" role="alertdialog" aria-labelledby="mp-title" aria-describedby="mp-detail" data-testid="map-problem" data-kind={problem.kind}>
  <div class="card">
    <h1 id="mp-title">{problem.title}</h1>
    <p id="mp-detail">{problem.detail}</p>
    <ul>
      {#each problem.hints as h (h)}<li>{h}</li>{/each}
    </ul>
    <div class="actions">
      <button class="primary" onclick={() => location.reload()}>Reload</button>
      <button onclick={() => (location.href = `${location.pathname}?${new URLSearchParams(location.search).toString()}${location.search ? "&" : ""}r=${Date.now()}`)}>Reload and skip cached files</button>
    </div>
    <details class="tech">
      <summary>Technical details for the site owner</summary>
      <code>{problem.kind}: {problem.technical}</code>
    </details>

    <h2>Live aircraft near the requested view, without the map</h2>
    {#if selected}
      <div class="detail">
        <AircraftPanel {store} hex={selected} onClose={() => (selected = null)} onTrail={() => undefined} onRoute={() => undefined} onLocate={() => undefined} />
      </div>
    {:else if rows.length === 0}
      <p class="muted">Loading the aircraft list…</p>
    {:else}
      <ul class="list" aria-label="Aircraft near the requested view">
        {#each rows as r (r.hex)}
          <li><button onclick={() => (selected = r.type.toLowerCase())}><strong>{r.label}</strong><span>{r.detail}</span></button></li>
        {/each}
      </ul>
    {/if}
  </div>
</div>

<style>
  .overlay {
    position: absolute;
    inset: 0;
    z-index: 30;
    overflow-y: auto;
    background: var(--bg);
    padding: max(24px, env(safe-area-inset-top)) 16px 40px;
  }
  .card {
    max-width: 640px;
    margin: 0 auto;
  }
  .card > * {
    animation: rise 0.45s cubic-bezier(0.2, 0.8, 0.2, 1) both;
  }
  .card > :nth-child(2) {
    animation-delay: 60ms;
  }
  .card > :nth-child(3) {
    animation-delay: 120ms;
  }
  .card > :nth-child(n + 4) {
    animation-delay: 180ms;
  }
  @keyframes rise {
    from {
      opacity: 0;
      transform: translateY(12px);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .card > * {
      animation: none;
    }
  }
  h1 {
    font-size: var(--fs-xl);
    line-height: 1.1;
    letter-spacing: -0.02em;
    margin: 8px 0 12px;
  }
  h2 {
    font-size: var(--fs-l);
    font-weight: 600;
    margin: 36px 0 12px;
  }
  p,
  li {
    line-height: 1.5;
  }
  ul:not(.list) {
    margin: 12px 0 0;
    padding: 14px 16px 14px 32px;
    border-radius: var(--radius);
    background: var(--surface);
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin: 16px 0;
  }
  button {
    min-height: 44px;
    padding: 0 18px;
    border-radius: var(--radius);
    border: 0;
    background: var(--surface-2);
    color: var(--text);
    font-weight: 600;
    cursor: pointer;
    transition: background-color 0.15s;
  }
  button:hover {
    background: var(--surface-3);
  }
  .primary {
    background: var(--accent);
    color: var(--accent-ink);
  }
  .primary:hover {
    background: color-mix(in srgb, var(--accent) 88%, white);
  }
  .tech {
    color: var(--text-dim);
    font-size: var(--fs-s);
  }
  .tech summary {
    min-height: 32px;
    display: flex;
    align-items: center;
    cursor: pointer;
  }
  code {
    display: block;
    margin-top: 6px;
    overflow-wrap: anywhere;
    font: 12px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  }
  .list {
    list-style: none;
    padding: 0;
    margin: 0;
  }
  .list button {
    width: 100%;
    display: flex;
    justify-content: space-between;
    align-items: center;
    text-align: left;
    background: var(--surface);
    border-radius: var(--radius-sm);
  }
  .list button:hover {
    background: var(--surface-2);
  }
  .list li + li {
    margin-top: 2px;
  }
  .list strong {
    font-weight: 700;
  }
  .list span {
    font-variant-numeric: tabular-nums;
  }
  .list span,
  .muted {
    color: var(--text-dim);
    font-size: var(--fs-s);
  }
  .detail {
    display: flex;
  }
  .detail > :global(.panel) {
    flex: 1;
    min-width: 0;
  }
</style>
