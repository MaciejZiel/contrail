<script lang="ts">
  let { label, onClear, clearLabel, id }: { label: string; onClear: () => void; clearLabel: string; id?: string } = $props();
</script>

<div class="chip" data-testid={id}>
  <span>{label}</span>
  <button onclick={onClear} aria-label={clearLabel}>×</button>
</div>

<style>
  .chip {
    display: inline-flex;
    align-items: center;
    gap: 2px;
    padding: 0 2px 0 12px;
    min-height: 40px;
    border-radius: var(--radius);
    background: var(--surface-2);
    font-size: var(--fs-s);
    font-weight: 500;
    max-width: 100%;
  }
  span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  button {
    width: 36px;
    height: 36px;
    border: 0;
    border-radius: var(--radius-sm);
    background: none;
    font-size: 18px;
    cursor: pointer;
    color: var(--text-dim);
  }
  button:hover {
    background: var(--surface-3);
    color: var(--text);
  }
</style>
