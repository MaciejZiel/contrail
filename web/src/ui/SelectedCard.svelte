<script lang="ts">
  import { onMount } from "svelte";
  import { serverNow } from "../core/clock";
  import type { AircraftStore } from "../core/store";

  let { store, hex, onClose }: { store: AircraftStore; hex: string; onClose: () => void } = $props();

  let info = $state({ callsign: "", alt: "–", speed: "–", vrate: "–", track: "–", onGround: false, found: true });

  function refresh(): void {
    const plane = store.get(parseInt(hex, 16));
    if (!plane) {
      info.found = false;
      return;
    }
    const alt = plane.altitudeAt(serverNow());
    info = {
      found: true,
      callsign: plane.callsign || hex.toUpperCase(),
      alt: plane.onGround ? "On ground" : alt === null ? "–" : `${Math.round(alt).toLocaleString("en")} ft`,
      speed: plane.speedKt === null ? "–" : `${Math.round(plane.speedKt)} kt`,
      vrate: plane.vrateFpm ? `${plane.vrateFpm > 0 ? "+" : ""}${Math.round(plane.vrateFpm)} ft/min` : "level",
      track: plane.track === null ? "–" : `${Math.round(plane.track)}°`,
      onGround: plane.onGround,
    };
  }

  onMount(() => {
    refresh();
    const t = setInterval(refresh, 500);
    return () => clearInterval(t);
  });
</script>

<aside class="card" aria-label="Selected aircraft">
  <header>
    <h2>{info.found ? info.callsign : hex.toUpperCase()}</h2>
    <button class="close" onclick={onClose} aria-label="Close aircraft details">×</button>
  </header>
  {#if info.found}
    <dl>
      <div><dt>Altitude</dt><dd>{info.alt}</dd></div>
      <div><dt>Speed</dt><dd>{info.speed}</dd></div>
      <div><dt>Vertical</dt><dd>{info.vrate}</dd></div>
      <div><dt>Track</dt><dd>{info.track}</dd></div>
    </dl>
  {:else}
    <p class="dim">This aircraft is not in the loaded area.</p>
  {/if}
</aside>

<style>
  .card {
    position: absolute;
    left: var(--gutter);
    bottom: calc(28px + env(safe-area-inset-bottom));
    width: min(340px, calc(100vw - 2 * var(--gutter)));
    padding: 12px 14px;
    border-radius: var(--radius);
    background: var(--surface);
    border: 1px solid var(--border);
    box-shadow: var(--shadow);
    z-index: 6;
  }
  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  h2 {
    margin: 0;
    font: 600 18px var(--mono);
    letter-spacing: 0.02em;
  }
  .close {
    width: 44px;
    height: 44px;
    margin: -8px -10px -8px 0;
    border: 0;
    background: none;
    font-size: 24px;
    cursor: pointer;
    color: var(--text-dim);
  }
  dl {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px 12px;
    margin: 6px 0 0;
  }
  dt {
    font-size: 11px;
    color: var(--text-dim);
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }
  dd {
    margin: 0;
    font: 500 15px var(--mono);
  }
  .dim {
    color: var(--text-dim);
    margin: 6px 0 0;
  }
</style>
