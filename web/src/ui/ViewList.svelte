<script lang="ts">
  import { fmtAlt } from "../core/format";
  import type { AircraftStore } from "../core/store";
  import type { Plane } from "../core/plane";
  import { serverNow } from "../core/clock";

  let {
    store,
    center,
    accepts,
    onPick,
  }: {
    store: AircraftStore;
    center: () => { lat: number; lon: number };
    accepts: (p: Plane) => boolean;
    onPick: (hex: number) => void;
  } = $props();

  let open = $state(false);
  let rows = $state<Array<{ hex: number; label: string; detail: string }>>([]);

  function refresh(): void {
    const c = center();
    const now = serverNow();
    const scored: Array<{ d: number; p: Plane }> = [];
    for (const p of store.planes) {
      if (!accepts(p)) continue;
      const pos = p.positionAt(now);
      const lat = (180 / Math.PI) * Math.atan(Math.sinh(Math.PI - 2 * Math.PI * pos.y));
      const lon = pos.x * 360 - 180;
      scored.push({ d: (lat - c.lat) ** 2 + ((lon - c.lon) * Math.cos((c.lat * Math.PI) / 180)) ** 2, p });
    }
    scored.sort((a, b) => a.d - b.d);
    rows = scored.slice(0, 25).map(({ p }) => ({
      hex: p.hex,
      label: p.callsign || p.id.toUpperCase(),
      detail: fmtAlt(p.altitudeAt(now), p.onGround),
    }));
  }

  $effect(() => {
    if (!open) return;
    refresh();
    const t = setInterval(refresh, 5000);
    return () => clearInterval(t);
  });
</script>

<!-- A keyboard and screen reader route to the aircraft that the canvas shows. Visible only when focused. -->
<details class="viewlist" ontoggle={(e) => (open = e.currentTarget.open)}>
  <summary>Aircraft near the map centre (keyboard list)</summary>
  <ul>
    {#each rows as r (r.hex)}
      <li><button onclick={() => onPick(r.hex)}>{r.label} <span>{r.detail}</span></button></li>
    {/each}
    {#if open && rows.length === 0}<li class="empty">No aircraft loaded yet.</li>{/if}
  </ul>
</details>

<style>
  .viewlist {
    position: absolute;
    left: -9999px;
    top: 0;
    z-index: 30;
    width: min(360px, 90vw);
    max-height: 70vh;
    overflow: auto;
    background: var(--surface-solid);
    border: 1px solid var(--border);
    border-radius: 12px;
    padding: 8px;
  }
  .viewlist:focus-within {
    left: 12px;
    top: 12px;
  }
  summary {
    min-height: 44px;
    display: flex;
    align-items: center;
    cursor: pointer;
  }
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  button {
    width: 100%;
    min-height: 44px;
    text-align: left;
    background: none;
    border: 0;
    border-radius: 8px;
    font: 600 14px var(--mono);
    cursor: pointer;
  }
  button:hover,
  button:focus-visible {
    background: var(--surface-2);
  }
  button span {
    float: right;
    color: var(--text-dim);
    font-weight: 400;
  }
  .empty {
    color: var(--text-dim);
    padding: 8px;
  }
</style>
