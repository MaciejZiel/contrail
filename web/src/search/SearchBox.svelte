<script lang="ts">
  import { searchAll, type SearchAircraft, type SearchAirline, type SearchAirport, type SearchResults } from "../core/api";
  import { fmtAlt } from "../core/format";

  let {
    onAircraft,
    onAirport,
    onAirline,
  }: {
    onAircraft: (a: SearchAircraft) => void;
    onAirport: (a: SearchAirport) => void;
    onAirline: (a: SearchAirline) => void;
  } = $props();

  type Item =
    | { kind: "aircraft"; data: SearchAircraft }
    | { kind: "airport"; data: SearchAirport }
    | { kind: "airline"; data: SearchAirline };

  const MIN_CHARS = 2;
  const DEBOUNCE_MS = 200;

  let query = $state("");
  let open = $state(false);
  let busy = $state(false);
  let failed = $state(false);
  let results = $state<SearchResults | null>(null);
  let active = $state(-1);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let controller: AbortController | undefined;
  const memo = new Map<string, SearchResults>();

  const items = $derived<Item[]>(
    results
      ? [
          ...results.aircraft.map((data) => ({ kind: "aircraft" as const, data })),
          ...results.airports.map((data) => ({ kind: "airport" as const, data })),
          ...results.airlines.map((data) => ({ kind: "airline" as const, data })),
        ]
      : [],
  );

  // Requests start only from the input handler, never from reactive effects.
  function onInput(): void {
    clearTimeout(timer);
    controller?.abort();
    active = -1;
    failed = false;
    const q = query.trim();
    if (q.length < MIN_CHARS) {
      results = null;
      busy = false;
      open = false;
      return;
    }
    open = true;
    const cached = memo.get(q.toLowerCase());
    if (cached) {
      results = cached;
      busy = false;
      return;
    }
    busy = true;
    timer = setTimeout(() => void run(q), DEBOUNCE_MS);
  }

  async function run(q: string): Promise<void> {
    const ctl = new AbortController();
    controller = ctl;
    try {
      const r = await searchAll(q, ctl.signal);
      memo.set(q.toLowerCase(), r);
      if (memo.size > 50) memo.delete(memo.keys().next().value as string);
      results = r;
      failed = false;
    } catch {
      if (ctl.signal.aborted) return;
      failed = true;
      results = null;
    } finally {
      if (controller === ctl) busy = false;
    }
  }

  function choose(item: Item): void {
    open = false;
    if (item.kind === "aircraft") {
      query = item.data.callsign || item.data.registration || item.data.hex.toUpperCase();
      onAircraft(item.data);
    } else if (item.kind === "airport") {
      query = item.data.iata || item.data.icao;
      onAirport(item.data);
    } else {
      query = item.data.name;
      onAirline(item.data);
    }
  }

  function onKey(e: KeyboardEvent): void {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      if (!open && items.length) open = true;
      if (items.length === 0) return;
      e.preventDefault();
      active = (active + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
    } else if (e.key === "Enter") {
      const item = items[active] ?? (items.length === 1 ? items[0] : undefined);
      if (item) {
        e.preventDefault();
        choose(item);
      }
    } else if (e.key === "Escape") {
      if (open) {
        open = false;
        e.stopPropagation();
      } else if (query) {
        clear();
        e.stopPropagation();
      }
    }
  }

  function clear(): void {
    query = "";
    results = null;
    open = false;
    controller?.abort();
    clearTimeout(timer);
    busy = false;
  }

  const idFor = (i: number) => `search-opt-${i}`;
  const indexOf = (kind: Item["kind"], n: number) =>
    kind === "aircraft" ? n : kind === "airport" ? (results?.aircraft.length ?? 0) + n : (results?.aircraft.length ?? 0) + (results?.airports.length ?? 0) + n;
</script>

<div class="search" role="search">
  <svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5" /><path d="M15.5 15.5L21 21" /></svg>
  <input
    type="search"
    role="combobox"
    aria-label="Search flights, registrations, airports and airlines"
    aria-expanded={open}
    aria-controls="search-list"
    aria-autocomplete="list"
    aria-activedescendant={active >= 0 ? idFor(active) : undefined}
    placeholder="Search callsign, registration, airport…"
    autocomplete="off"
    autocapitalize="off"
    spellcheck="false"
    bind:value={query}
    oninput={onInput}
    onkeydown={onKey}
    onfocus={() => {
      if (items.length) open = true;
    }}
  />
  {#if query}
    <button class="clear" onclick={clear} aria-label="Clear search" type="button">×</button>
  {/if}

  {#if open}
    <div class="results" id="search-list" role="listbox" aria-label="Search results">
      {#if results?.aircraft.length}
        <div class="group" role="presentation">Flights</div>
        {#each results.aircraft as a, n (a.hex)}
          {@const i = indexOf("aircraft", n)}
          <div id={idFor(i)} role="option" aria-selected={active === i} class="row" class:active={active === i} onmousedown={(e) => { e.preventDefault(); choose({ kind: "aircraft", data: a }); }} tabindex="-1">
            <strong class="mono">{a.callsign || a.registration || a.hex.toUpperCase()}</strong>
            <span class="meta">{[a.airline, a.registration, a.type_code].filter(Boolean).join(" · ")}</span>
            <span class="side">{fmtAlt(a.altitude_ft, a.on_ground)}</span>
          </div>
        {/each}
      {/if}
      {#if results?.airports.length}
        <div class="group" role="presentation">Airports</div>
        {#each results.airports as a, n (a.icao)}
          {@const i = indexOf("airport", n)}
          <div id={idFor(i)} role="option" aria-selected={active === i} class="row" class:active={active === i} onmousedown={(e) => { e.preventDefault(); choose({ kind: "airport", data: a }); }} tabindex="-1">
            <strong class="mono">{a.iata || a.icao}</strong>
            <span class="meta">{a.name}{a.city ? ` · ${a.city}` : ""}</span>
            <span class="side">{a.icao}</span>
          </div>
        {/each}
      {/if}
      {#if results?.airlines.length}
        <div class="group" role="presentation">Airlines</div>
        {#each results.airlines as a, n (a.code)}
          {@const i = indexOf("airline", n)}
          <div id={idFor(i)} role="option" aria-selected={active === i} class="row" class:active={active === i} onmousedown={(e) => { e.preventDefault(); choose({ kind: "airline", data: a }); }} tabindex="-1">
            <strong class="mono">{a.code}</strong>
            <span class="meta">{a.name}</span>
            <span class="side">{a.aircraft ? `${a.aircraft} in air` : "none loaded"}</span>
          </div>
        {/each}
      {/if}
      {#if busy && !items.length}
        <div class="state">Searching…</div>
      {:else if failed}
        <div class="state">Search is unavailable right now.</div>
      {:else if !busy && results && !items.length}
        <div class="state">Nothing found for “{query.trim()}”. Only flights in loaded areas can be matched by name.</div>
      {/if}
    </div>
  {/if}
</div>

<style>
  .search {
    position: relative;
    flex: 1 1 260px;
    max-width: 440px;
    min-width: 0;
  }
  .icon {
    position: absolute;
    left: 13px;
    top: 50%;
    width: 18px;
    height: 18px;
    transform: translateY(-50%);
    fill: none;
    stroke: var(--text-dim);
    stroke-width: 2;
    stroke-linecap: round;
    pointer-events: none;
    z-index: 1;
  }
  input {
    width: 100%;
    height: 44px;
    padding: 0 40px 0 40px;
    border-radius: 999px;
    border: 1px solid var(--border);
    background: var(--surface);
    color: var(--text);
    font: inherit;
    font-size: 15px;
    box-shadow: var(--shadow);
    backdrop-filter: blur(8px);
    appearance: none;
  }
  input::placeholder {
    color: var(--text-dim);
  }
  input::-webkit-search-cancel-button {
    display: none;
  }
  .clear {
    position: absolute;
    right: 4px;
    top: 50%;
    width: 36px;
    height: 36px;
    transform: translateY(-50%);
    border: 0;
    background: none;
    color: var(--text-dim);
    font-size: 22px;
    cursor: pointer;
  }
  .results {
    position: absolute;
    top: 50px;
    left: 0;
    right: 0;
    max-height: min(60vh, 420px);
    overflow-y: auto;
    padding: 6px;
    border-radius: var(--radius);
    background: var(--surface-solid);
    border: 1px solid var(--border);
    box-shadow: var(--shadow);
  }
  .group {
    padding: 8px 10px 4px;
    font-size: 11px;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--text-dim);
  }
  .row {
    display: grid;
    grid-template-columns: auto 1fr auto;
    gap: 10px;
    align-items: center;
    min-height: 44px;
    padding: 6px 10px;
    border-radius: 10px;
    cursor: pointer;
  }
  .row:hover,
  .row.active {
    background: var(--surface-2);
  }
  .mono {
    font-family: var(--mono);
    min-width: 54px;
  }
  .meta {
    color: var(--text-dim);
    font-size: 13px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .side {
    font: 12px var(--mono);
    color: var(--text-dim);
  }
  .state {
    padding: 14px 12px;
    color: var(--text-dim);
    font-size: 13px;
  }
</style>
