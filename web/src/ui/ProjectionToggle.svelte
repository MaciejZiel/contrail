<script lang="ts">
  let { globe, onChange }: { globe: boolean; onChange: (globe: boolean) => void } = $props();
</script>

<div class="toggle" role="group" aria-label="Map view">
  <button type="button" aria-label="Map" aria-pressed={!globe} onclick={() => onChange(false)}>
    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6l6-2 6 2 6-2v14l-6 2-6-2-6 2z" /><path d="M9 4v14M15 6v14" /></svg>
    <span>Map</span>
  </button>
  <button type="button" aria-label="Globe" aria-pressed={globe} onclick={() => onChange(true)}>
    <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18" /></svg>
    <span>Globe</span>
  </button>
</div>

<style>
  .toggle {
    display: inline-flex;
    gap: 2px;
    padding: 2px;
    height: 44px;
    border-radius: var(--radius);
    background: var(--surface);
  }
  button {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 0 12px;
    border: 0;
    border-radius: var(--radius-sm);
    background: none;
    color: var(--text-dim);
    font-size: var(--fs-s);
    font-weight: 600;
    cursor: pointer;
  }
  button:hover {
    background: var(--surface-2);
    color: var(--text);
  }
  button[aria-pressed="true"] {
    background: var(--surface-3);
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
  @media (max-width: 640px) {
    span {
      display: none;
    }
    button {
      padding: 0 10px;
    }
  }
</style>
