<script lang="ts">
  import { fetchAirlineNames } from "../core/api";
  import { ALT_LIMIT, activeFilterCount, airlineCounts, DEFAULT_FILTERS, type Filters } from "../core/filters";
  import type { AircraftStore } from "../core/store";

  let { filters = $bindable(), store }: { filters: Filters; store: AircraftStore } = $props();

  let open = $state(false);
  let names = $state<Record<string, string>>({});
  let airlines = $state<Array<[string, number]>>([]);
  const count = $derived(activeFilterCount(filters));

  async function toggle(): Promise<void> {
    open = !open;
    if (!open) return;
    airlines = airlineCounts(store.planes);
    const codes = airlines.map(([c]) => c).concat(filters.airline ? [filters.airline] : []);
    names = await fetchAirlineNames([...new Set(codes)], new AbortController().signal).catch(() => ({}));
  }

  const lo = $derived(Math.min(filters.altMin, filters.altMax));
  function setMin(v: number): void {
    filters = { ...filters, altMin: Math.min(v, filters.altMax) };
  }
  function setMax(v: number): void {
    filters = { ...filters, altMax: Math.max(v, filters.altMin) };
  }
  const altLabel = (v: number) => (v >= ALT_LIMIT ? "any" : v >= 18000 ? `FL${Math.round(v / 100)}` : `${v.toLocaleString("en")} ft`);
</script>

<div class="wrap">
  <button class="btn" onclick={toggle} aria-expanded={open} aria-controls="filter-panel" aria-label={count ? `Filters, ${count} active` : "Filters"}>
    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h16M7 12h10M10 18h4" /></svg>
    {#if count}<span class="badge">{count}</span>{/if}
  </button>
  {#if open}
    <div class="panel" id="filter-panel" role="group" aria-label="Filters">
      <div class="head">
        <strong>Filters</strong>
        <button class="link" onclick={() => (filters = { ...DEFAULT_FILTERS })} disabled={count === 0}>Reset</button>
      </div>

      <fieldset>
        <legend>Altitude</legend>
        <div class="range-values"><span>{altLabel(lo)}</span><span>{altLabel(filters.altMax)}</span></div>
        <label class="sr-only" for="alt-min">Minimum altitude</label>
        <input id="alt-min" type="range" min="0" max={ALT_LIMIT} step="500" value={filters.altMin} oninput={(e) => setMin(+e.currentTarget.value)} />
        <label class="sr-only" for="alt-max">Maximum altitude</label>
        <input id="alt-max" type="range" min="0" max={ALT_LIMIT} step="500" value={filters.altMax} oninput={(e) => setMax(+e.currentTarget.value)} />
      </fieldset>

      <label class="check">
        <input type="checkbox" checked={filters.hideGround} onchange={(e) => (filters = { ...filters, hideGround: e.currentTarget.checked })} />
        Hide aircraft on the ground
      </label>

      <label class="field">
        <span>Airline</span>
        <select value={filters.airline ?? ""} onchange={(e) => (filters = { ...filters, airline: e.currentTarget.value || null })}>
          <option value="">All airlines</option>
          {#if filters.airline && !airlines.some(([c]) => c === filters.airline)}
            <option value={filters.airline}>{names[filters.airline] ?? filters.airline}</option>
          {/if}
          {#each airlines as [code, n] (code)}
            <option value={code}>{names[code] ?? code} ({n})</option>
          {/each}
        </select>
      </label>
      <p class="hint">Airlines listed are the most common among loaded aircraft. Search an airline by name to filter any other.</p>
    </div>
  {/if}
</div>

<style>
  .wrap {
    position: relative;
  }
  .btn {
    position: relative;
    width: 44px;
    height: 44px;
    border-radius: 50%;
    border: 1px solid var(--border);
    background: var(--surface);
    box-shadow: var(--shadow);
    display: grid;
    place-items: center;
    cursor: pointer;
    backdrop-filter: blur(8px);
  }
  svg {
    width: 20px;
    height: 20px;
    fill: none;
    stroke: var(--text);
    stroke-width: 2;
    stroke-linecap: round;
  }
  .badge {
    position: absolute;
    top: -3px;
    right: -3px;
    min-width: 18px;
    height: 18px;
    padding: 0 5px;
    border-radius: 9px;
    background: var(--accent);
    color: #04201c;
    font: 700 11px/18px var(--font);
    text-align: center;
  }
  .panel {
    position: absolute;
    top: 52px;
    left: 0;
    width: min(320px, calc(100vw - 24px));
    padding: 14px;
    border-radius: var(--radius);
    background: var(--surface-solid);
    border: 1px solid var(--border);
    box-shadow: var(--shadow);
    z-index: 10;
  }
  .head {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 8px;
  }
  .link {
    border: 0;
    background: none;
    color: var(--accent);
    cursor: pointer;
    min-height: 32px;
  }
  .link:disabled {
    color: var(--text-dim);
    cursor: default;
  }
  fieldset {
    border: 0;
    padding: 0;
    margin: 0 0 12px;
  }
  legend,
  .field span {
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text-dim);
    padding: 0;
  }
  .range-values {
    display: flex;
    justify-content: space-between;
    font: 600 13px var(--mono);
    margin: 4px 0;
  }
  input[type="range"] {
    width: 100%;
    accent-color: var(--accent);
    height: 28px;
    margin: 0;
  }
  .check {
    display: flex;
    align-items: center;
    gap: 10px;
    min-height: 44px;
  }
  .check input {
    width: 20px;
    height: 20px;
    accent-color: var(--accent);
  }
  .field {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  select {
    height: 44px;
    border-radius: 10px;
    border: 1px solid var(--border);
    background: var(--surface-2);
    color: var(--text);
    padding: 0 10px;
    font: inherit;
  }
  .hint {
    margin: 8px 0 0;
    font-size: 12px;
    color: var(--text-dim);
  }
</style>
