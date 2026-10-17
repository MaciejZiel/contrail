<script lang="ts">
  import { untrack } from "svelte";
  import { fetchAirlineNames, fetchTypeSuggestions, type TypeSuggestion } from "../core/api";
  import { ALT_LIMIT, activeFilterCount, airlineCounts, DEFAULT_FILTERS, parseCallsigns, parseTypes, type Filters } from "../core/filters";
  import { ui } from "../core/state.svelte";
  import type { AircraftStore } from "../core/store";
  import type { TrailMinutes } from "../core/urlState";

  let { filters = $bindable(), store, onTrails }: { filters: Filters; store: AircraftStore; onTrails: (m: TrailMinutes) => void } = $props();

  let typeDraft = $state(filters.types.join(", "));
  let callsignDraft = $state(filters.callsigns.join(", "));
  let suggestions = $state<TypeSuggestion[]>([]);
  let suggestTimer: ReturnType<typeof setTimeout> | undefined;
  let suggestAbort: AbortController | undefined;

  // the chips and Reset change the filter from outside: keep the text box in step
  $effect(() => {
    const joined = filters.types.join(", ");
    if (untrack(() => parseTypes(typeDraft).join(", ")) !== joined) typeDraft = joined;
  });

  $effect(() => {
    const joined = filters.callsigns.join(", ");
    if (untrack(() => parseCallsigns(callsignDraft).join(", ")) !== joined) callsignDraft = joined;
  });

  function onCallsignInput(e: Event & { currentTarget: HTMLInputElement }): void {
    callsignDraft = e.currentTarget.value;
    const callsigns = parseCallsigns(callsignDraft);
    if (callsigns.join(",") !== filters.callsigns.join(",")) filters = { ...filters, callsigns };
  }

  function onTypeInput(e: Event & { currentTarget: HTMLInputElement }): void {
    const inputType = (e as unknown as InputEvent).inputType;
    typeDraft = e.currentTarget.value;
    const word = typeDraft.split(/[\s,;]+/).pop() ?? "";
    clearTimeout(suggestTimer);
    suggestAbort?.abort();
    if (word.replace("*", "").length < 2) {
      suggestions = [];
    } else {
      suggestTimer = setTimeout(async () => {
        const ctl = new AbortController();
        suggestAbort = ctl;
        suggestions = await fetchTypeSuggestions(word.replace("*", ""), ctl.signal).catch(() => []);
      }, 180);
    }
    // a pick from the list replaces the text in one step: apply it at once
    if (inputType === "insertReplacementText" || inputType === undefined) commitTypes();
  }

  function commitTypes(): void {
    const types = parseTypes(typeDraft);
    if (types.join(",") !== filters.types.join(",")) filters = { ...filters, types };
  }

  const trailsHint = $derived.by(() => {
    const st = ui.trailsStatus;
    if (ui.trails === 0) return "Draws where each aircraft has been in the last 30 or 60 minutes, from this server's own record. It makes no extra requests to the ADS-B source.";
    if (st.state === "zoom") return "Zoom in to see tracks: there are too many aircraft for readable tracks at this zoom.";
    if (st.state === "error") return "Tracks are temporarily unavailable.";
    if (st.state === "loading") return "Loading tracks.";
    const n = st.shown;
    const more = st.total > st.shown ? ` of ${st.total.toLocaleString("en")}, nearest the centre` : "";
    return `${n.toLocaleString("en")} ${n === 1 ? "track" : "tracks"} in view${more}. Tracks start when the server first saw the aircraft.`;
  });

  let open = $state(false);
  let wrap = $state<HTMLElement>();
  let panel = $state<HTMLElement>();
  let button = $state<HTMLButtonElement>();

  /** Escape closes the panel and hands focus back to the button that opened it. */
  function onKeydown(e: KeyboardEvent): void {
    if (e.key !== "Escape" || !open) return;
    e.stopPropagation(); // do not also deselect the aircraft behind
    open = false;
    button?.focus();
  }

  // The panel may only grow down to the bottom of the screen. Its top moves when the chips next to
  // the button wrap onto more rows, so measure where it really starts instead of guessing a constant.
  $effect(() => {
    const el = panel;
    const bar = wrap?.parentElement;
    if (!el) return;
    const fit = () => el.style.setProperty("--room", `${Math.max(120, window.innerHeight - el.getBoundingClientRect().top - 12)}px`);
    fit();
    const ro = new ResizeObserver(fit);
    if (bar) ro.observe(bar);
    window.addEventListener("resize", fit);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", fit);
    };
  });
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

<div class="wrap" bind:this={wrap} onkeydown={onKeydown} role="presentation">
  <button class="btn" bind:this={button} onclick={toggle} aria-expanded={open} aria-controls="filter-panel" aria-label={count ? `Filters, ${count} active` : "Filters"}>
    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h16M7 12h10M10 18h4" /></svg>
    <span class="label">Filters</span>
    {#if count}<span class="badge">{count}</span>{/if}
  </button>
  {#if open}
    <div class="panel" bind:this={panel} id="filter-panel" role="group" aria-label="Filters">
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

      <label class="field">
        <span>Callsign starts with</span>
        <input
          type="text"
          class="text"
          autocomplete="off"
          autocapitalize="characters"
          spellcheck="false"
          placeholder="LO, RYR1, N12"
          value={callsignDraft}
          oninput={onCallsignInput}
        />
      </label>

      <label class="field">
        <span>Aircraft type</span>
        <input
          type="text"
          class="text"
          list="type-suggestions"
          autocomplete="off"
          autocapitalize="characters"
          spellcheck="false"
          placeholder="B738, A32*, boeing 787"
          value={typeDraft}
          oninput={onTypeInput}
          onchange={commitTypes}
          onkeydown={(e) => e.key === "Enter" && commitTypes()}
        />
        <datalist id="type-suggestions">
          {#each suggestions as t (t.code)}
            <option value={t.code} label={`${t.name}${t.count ? ` (${t.count})` : ""}`}></option>
          {/each}
        </datalist>
      </label>
      <p class="hint">ICAO codes, several allowed, <code>*</code> matches a family (A32* is every A320 variant). Type a name to find the code.</p>

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

      <fieldset class="trails">
        <legend>Recent tracks</legend>
        <div class="radios">
          {#each [[0, "Off"], [30, "30 min"], [60, "60 min"]] as [m, label] (m)}
            <label class="radio">
              <input type="radio" name="recent-tracks" value={m} checked={ui.trails === m} onchange={() => onTrails(m as TrailMinutes)} />
              <span>{label}</span>
            </label>
          {/each}
        </div>
        <p class="hint" data-testid="trails-hint">{trailsHint}</p>
      </fieldset>
    </div>
  {/if}
</div>

<style>
  .wrap {
    position: relative;
  }
  .btn {
    position: relative;
    height: 44px;
    padding: 0 14px;
    border-radius: var(--radius);
    border: 0;
    background: var(--surface);
    display: inline-flex;
    align-items: center;
    gap: 9px;
    cursor: pointer;
    font-size: var(--fs-s);
    font-weight: 600;
  }
  .btn:hover,
  .btn[aria-expanded="true"] {
    background: var(--surface-2);
  }
  svg {
    width: 18px;
    height: 18px;
    fill: none;
    stroke: var(--text);
    stroke-width: 2;
    stroke-linecap: round;
  }
  .label {
    display: none;
  }
  @media (min-width: 640px) {
    .label {
      display: inline;
    }
  }
  .badge {
    min-width: 20px;
    height: 20px;
    padding: 0 6px;
    border-radius: var(--radius-sm);
    background: var(--accent);
    color: var(--accent-ink);
    font: 700 12px/20px var(--font);
    text-align: center;
  }
  .panel {
    position: absolute;
    top: 52px;
    left: 0;
    width: min(340px, calc(100vw - 24px));
    padding: 18px;
    border-radius: var(--radius);
    background: var(--surface);
    box-shadow: var(--shadow); /* taste-skill-ignore: the filter menu floats over the map */
    z-index: 10;
    max-height: calc(var(--room, calc(100dvh - 76px)) - env(safe-area-inset-bottom));
    overflow-y: auto;
    overscroll-behavior: contain;
  }
  /* on a phone the panel spans the top bar (gutter to gutter) instead of hanging off the button */
  @media (max-width: 640px) {
    .wrap {
      position: static;
    }
    .panel {
      top: calc(100% + 8px);
      left: 0;
      right: 0;
      width: auto;
      max-height: calc(var(--room, calc(100dvh - 130px)) - env(safe-area-inset-bottom));
    }
  }
  .head {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 14px;
  }
  .head strong {
    font-size: var(--fs-l);
    font-weight: 650;
  }
  .link {
    border: 0;
    background: none;
    color: var(--accent-text);
    font-weight: 600;
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
    margin: 0 0 16px;
  }
  legend,
  .field span {
    font-size: var(--fs-s);
    font-weight: 600;
    color: var(--text);
    padding: 0;
  }
  .range-values {
    display: flex;
    justify-content: space-between;
    font: 500 var(--fs-s) var(--font);
    font-variant-numeric: tabular-nums;
    color: var(--text-dim);
    margin: 6px 0;
  }
  input[type="range"] {
    width: 100%;
    accent-color: var(--accent);
    height: 28px;
    margin: 0;
  }
  /* the native track turns near-black on a light ground: draw it in the palette instead (light only) */
  :global(:root[data-theme="light"]) input[type="range"] {
    appearance: none;
    background: transparent;
  }
  :global(:root[data-theme="light"]) input[type="range"]::-webkit-slider-runnable-track {
    height: 4px;
    border-radius: 2px;
    background: var(--surface-3);
  }
  :global(:root[data-theme="light"]) input[type="range"]::-moz-range-track {
    height: 4px;
    border-radius: 2px;
    background: var(--surface-3);
  }
  :global(:root[data-theme="light"]) input[type="range"]::-webkit-slider-thumb {
    appearance: none;
    width: 18px;
    height: 18px;
    margin-top: -7px;
    border: 0;
    border-radius: 50%;
    background: var(--accent-text);
  }
  :global(:root[data-theme="light"]) input[type="range"]::-moz-range-thumb {
    width: 18px;
    height: 18px;
    border: 0;
    border-radius: 50%;
    background: var(--accent-text);
  }
  .check {
    display: flex;
    align-items: center;
    gap: 10px;
    min-height: 44px;
    margin-bottom: 8px;
  }
  .check input {
    width: 20px;
    height: 20px;
    accent-color: var(--accent);
  }
  .field {
    display: flex;
    flex-direction: column;
    gap: 6px;
    margin-bottom: 4px;
  }
  select,
  .text {
    height: 44px;
    border-radius: var(--radius);
    border: 0;
    background: var(--surface-2);
    color: var(--text);
    padding: 0 12px;
    font: inherit;
    min-width: 0;
  }
  select:hover,
  .text:hover {
    background: var(--surface-3);
  }
  .trails {
    margin: 16px 0 0;
  }
  .radios {
    display: flex;
    gap: 4px;
    margin-top: 6px;
  }
  .radio {
    flex: 1;
    position: relative;
    min-height: 44px;
    display: grid;
    place-items: center;
    border-radius: var(--radius);
    background: var(--surface-2);
    cursor: pointer;
    font-size: var(--fs-s);
    font-weight: 600;
  }
  .radio:hover {
    background: var(--surface-3);
  }
  .radio input {
    position: absolute;
    inset: 0;
    opacity: 0;
    margin: 0;
    cursor: pointer;
  }
  .radio:has(input:checked) {
    background: var(--accent);
    color: var(--accent-ink);
  }
  .radio:has(input:focus-visible) {
    outline: 2px solid var(--accent-text);
    outline-offset: 2px;
  }
  code {
    font-family: var(--font);
    font-weight: 600;
  }
  .hint {
    margin: 8px 0 0;
    font-size: var(--fs-s);
    line-height: 1.45;
    color: var(--text-dim);
  }
</style>
