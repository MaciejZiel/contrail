<script lang="ts">
  import { nextPref, type ThemePref } from "../core/theme";

  let { pref, onChange }: { pref: ThemePref; onChange: (pref: ThemePref) => void } = $props();

  const NAMES: Record<ThemePref, string> = { system: "System", light: "Light", dark: "Dark" };
  const next = $derived(nextPref(pref));
</script>

<button
  type="button"
  class="theme"
  data-pref={pref}
  aria-label={`Theme: ${NAMES[pref]}. Switch to ${NAMES[next]}`}
  title={`Theme: ${NAMES[pref]}`}
  onclick={() => onChange(next)}
>
  <svg viewBox="0 0 24 24" aria-hidden="true">
    {#if pref === "light"}
      <circle cx="12" cy="12" r="4" />
      <path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M5.6 18.4L7 17M17 7l1.4-1.4" />
    {:else if pref === "dark"}
      <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" />
    {:else}
      <circle cx="12" cy="12" r="8.5" />
      <path class="half" d="M12 3.5a8.5 8.5 0 0 1 0 17z" />
    {/if}
  </svg>
</button>

<style>
  .theme {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 44px;
    height: 44px;
    padding: 0;
    border: 0;
    border-radius: var(--radius);
    background: var(--surface);
    color: var(--text-dim);
    cursor: pointer;
  }
  .theme:hover {
    background: var(--surface-2);
    color: var(--text);
  }
  svg {
    width: 18px;
    height: 18px;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.8;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  .half {
    fill: currentColor;
  }
</style>
