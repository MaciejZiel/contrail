<script lang="ts">
  import { otherTheme, type Theme } from "../core/theme";

  let { theme, onChange }: { theme: Theme; onChange: (theme: Theme) => void } = $props();

  const NAMES: Record<Theme, string> = { light: "Light", dark: "Dark" };
  const next = $derived(otherTheme(theme));
</script>

<button
  type="button"
  class="theme"
  data-theme-now={theme}
  aria-label={`Theme: ${NAMES[theme]}. Switch to ${NAMES[next]}`}
  title={`Theme: ${NAMES[theme]}`}
  onclick={() => onChange(next)}
>
  <svg viewBox="0 0 24 24" aria-hidden="true">
    {#if theme === "light"}
      <circle cx="12" cy="12" r="4" />
      <path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M5.6 18.4L7 17M17 7l1.4-1.4" />
    {:else}
      <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" />
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
</style>
