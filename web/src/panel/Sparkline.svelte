<script lang="ts">
  let {
    title,
    times,
    values,
    color,
    unit,
    now,
    fill = false,
    zero = false,
    big = false,
    format,
  }: {
    title: string;
    times: number[];
    values: Array<number | null>;
    color: string;
    unit: string;
    now: number;
    fill?: boolean;
    zero?: boolean;
    /** The chart the panel is built around: taller, with the value at the larger size. */
    big?: boolean;
    format: (v: number) => string;
  } = $props();

  const W = 300;
  const H = $derived(big ? 120 : 44);
  const PAD = 4;

  const pts = $derived(
    times.map((t, i) => ({ t, v: values[i] ?? null })).filter((p): p is { t: number; v: number } => p.v !== null),
  );
  const span = $derived(Math.max(60, now - (times[0] ?? now)));
  const lo = $derived(pts.length ? Math.min(...pts.map((p) => p.v), zero ? 0 : Infinity) : 0);
  const hi = $derived(pts.length ? Math.max(...pts.map((p) => p.v), zero ? 0 : -Infinity) : 1);
  const x = (t: number) => PAD + ((t - (times[0] ?? now)) / span) * (W - 2 * PAD);
  const y = (v: number) => (hi - lo < 1e-9 ? H / 2 : H - PAD - ((v - lo) / (hi - lo)) * (H - 2 * PAD));
  const line = $derived(pts.map((p, i) => `${i ? "L" : "M"}${x(p.t).toFixed(1)} ${y(p.v).toFixed(1)}`).join(""));
  const area = $derived(
    pts.length ? `${line}L${x(pts[pts.length - 1]!.t).toFixed(1)} ${H - PAD}L${x(pts[0]!.t).toFixed(1)} ${H - PAD}Z` : "",
  );
  const last = $derived(pts.length ? pts[pts.length - 1]!.v : null);

  let hover = $state<number | null>(null);
  const hoverPoint = $derived(hover === null ? null : pts[hover] ?? null);

  function onMove(e: PointerEvent): void {
    const r = (e.currentTarget as SVGElement).getBoundingClientRect();
    const t = (times[0] ?? now) + ((e.clientX - r.left) / r.width) * span;
    let best = -1;
    let bestD = Infinity;
    pts.forEach((p, i) => {
      const d = Math.abs(p.t - t);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    });
    hover = best >= 0 ? best : null;
  }
</script>

<div class="spark" class:big>
  <div class="head">
    <span class="title">{title}</span>
    <span class="val num">
      {#if hoverPoint}
        {format(hoverPoint.v)} {unit} <small>· {Math.round((now - hoverPoint.t) / 60)} min ago</small>
      {:else if last !== null}
        {format(last)} {unit}
      {:else}
        –
      {/if}
    </span>
  </div>
  {#if pts.length >= 2}
    <svg
      style={`height:${H}px`}
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      role="img"
      aria-label={`${title} over the last ${Math.max(1, Math.round(span / 60))} minutes, from ${format(pts[0]!.v)} to ${format(pts[pts.length - 1]!.v)} ${unit}`}
      onpointermove={onMove}
      onpointerleave={() => (hover = null)}
    >
      {#if zero}<line x1="0" x2={W} y1={y(0)} y2={y(0)} class="zero" />{/if}
      {#if fill}<path d={area} fill={color} opacity="0.2" />{/if}
      <path d={line} fill="none" stroke={color} stroke-width="2" vector-effect="non-scaling-stroke" stroke-linejoin="round" />
      {#if hoverPoint}
        <line x1={x(hoverPoint.t)} x2={x(hoverPoint.t)} y1="0" y2={H} class="guide" vector-effect="non-scaling-stroke" />
      {/if}
    </svg>
  {:else}
    <div class="empty" style={`height:${H}px`}>Collecting history, check back in a minute</div>
  {/if}
</div>

<style>
  .spark {
    padding: 12px 14px 10px;
    border-radius: var(--radius);
    background: var(--surface-2);
    min-width: 0;
  }
  .head {
    display: flex;
    flex-wrap: wrap;
    justify-content: space-between;
    align-items: baseline;
    gap: 2px 8px;
    margin-bottom: 8px;
  }
  .title {
    color: var(--text-dim);
    font-size: var(--fs-s);
  }
  .val {
    font-weight: 600;
    font-size: var(--fs-m);
    color: var(--text);
  }
  .big .val {
    font-size: var(--fs-l);
  }
  small {
    color: var(--text-dim);
    font-weight: 400;
    font-size: var(--fs-s);
  }
  svg {
    width: 100%;
    display: block;
    touch-action: pan-y;
  }
  .zero {
    stroke: var(--surface-3);
    stroke-width: 1;
    stroke-dasharray: 3 3;
    vector-effect: non-scaling-stroke;
  }
  .guide {
    stroke: var(--text-dim);
    stroke-width: 1;
  }
  .empty {
    display: grid;
    place-items: center;
    text-align: center;
    padding: 0 8px;
    font-size: var(--fs-s);
    color: var(--text-dim);
    border-radius: var(--radius-sm);
    background: var(--surface-3);
  }
</style>
