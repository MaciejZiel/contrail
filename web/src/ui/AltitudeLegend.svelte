<script lang="ts">
  import { altitudeRgb, LEGEND } from "../map/palette";

  const stops = LEGEND.map((l) => {
    const [r, g, b] = altitudeRgb(l.ft, false);
    return `rgb(${r},${g},${b}) ${(l.ft / 40000) * 100}%`;
  }).join(",");
</script>

<div class="legend" aria-label="Altitude colour legend">
  <div class="bar" style={`background: linear-gradient(90deg, ${stops})`}></div>
  <div class="ticks">
    {#each LEGEND as l (l.ft)}<span>{l.label}</span>{/each}
  </div>
</div>

<style>
  .legend {
    width: 170px;
    padding: 7px 10px 6px;
    border-radius: 10px;
    background: var(--surface);
    border: 1px solid var(--border);
    font-size: 10px;
    color: var(--text-dim);
  }
  .bar {
    height: 6px;
    border-radius: 3px;
    margin-bottom: 3px;
  }
  .ticks {
    display: flex;
    justify-content: space-between;
  }
</style>
