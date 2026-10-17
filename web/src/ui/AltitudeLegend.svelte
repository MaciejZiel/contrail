<script lang="ts">
  import type { Theme } from "../core/theme";
  import { altitudeRgb, LEGEND, ramp } from "../map/palette";

  /** The theme of the map the legend describes (the globe is dark even when the interface is light), and the interface's. */
  let { mapTheme, uiTheme }: { mapTheme: Theme; uiTheme: Theme } = $props();

  const stops = $derived(
    LEGEND.map((l) => {
      const [r, g, b] = altitudeRgb(l.ft, false, mapTheme);
      return `rgb(${r},${g},${b}) ${(l.ft / 40000) * 100}%`;
    }).join(","),
  );
  const ghost = $derived(ramp(mapTheme).ghost.join(","));
  const order = $derived(mapTheme === "dark" ? "lighter is higher" : "darker is higher");
</script>

<div
  class="legend"
  class:on-dark={mapTheme === "dark" && uiTheme === "light"}
  role="img"
  aria-label={`Altitude colour legend, from 0 to 40,000 feet, ${order}; grey means last known position`}
>
  <div class="bar" style={`background: linear-gradient(90deg, ${stops})`}></div> <!-- taste-skill-ignore: a continuous colour scale is data, not decoration -->
  <div class="ticks">
    {#each LEGEND as l (l.ft)}<span>{l.label}</span>{/each}
  </div>
  <div class="ghost"><i aria-hidden="true" style={`--ghost:${ghost}`}></i>Grey: last known position</div>
</div>

<style>
  .legend {
    width: 188px;
    padding: 10px 12px 8px;
    border-radius: var(--radius);
    background: var(--surface);
    font-size: 11px;
    font-weight: 500;
    font-variant-numeric: tabular-nums;
    color: var(--text-dim);
  }
  /* the globe is a dark sphere in both themes, so its legend stays dark on a light interface */
  .on-dark {
    --surface: #1e232b;
    --text-dim: #a0a7b2;
  }
  .bar {
    height: 6px;
    border-radius: 1px;
    margin-bottom: 6px;
  }
  .ghost {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-top: 8px;
  }
  .ghost i {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: rgb(var(--ghost));
    opacity: 0.7;
  }
  .ticks {
    display: flex;
    justify-content: space-between;
  }
</style>
