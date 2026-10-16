<script lang="ts">
  import { altitudeRgb, LEGEND } from "../map/palette";

  const stops = LEGEND.map((l) => {
    const [r, g, b] = altitudeRgb(l.ft, false);
    return `rgb(${r},${g},${b}) ${(l.ft / 40000) * 100}%`;
  }).join(",");
</script>

<div class="legend" role="img" aria-label="Altitude colour legend, from 0 to 40,000 feet, lighter is higher; grey means last known position">
  <div class="bar" style={`background: linear-gradient(90deg, ${stops})`}></div> <!-- taste-skill-ignore: a continuous colour scale is data, not decoration -->
  <div class="ticks">
    {#each LEGEND as l (l.ft)}<span>{l.label}</span>{/each}
  </div>
  <div class="ghost"><i aria-hidden="true"></i>Grey: last known position</div>
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
    background: rgb(150, 158, 170);
    opacity: 0.7;
  }
  .ticks {
    display: flex;
    justify-content: space-between;
  }
</style>
