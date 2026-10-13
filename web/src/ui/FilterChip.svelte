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
    gap: 4px;
    padding: 0 4px 0 12px;
    min-height: 36px;
    border-radius: 999px;
    /* tinted but opaque, so map labels never show through the text */
    background: linear-gradient(rgba(94, 234, 212, 0.14), rgba(94, 234, 212, 0.14)), var(--surface-solid);
    border: 1px solid rgba(94, 234, 212, 0.5);
    font-size: 13px;
    max-width: 100%;
  }
  span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  button {
    width: 32px;
    height: 32px;
    border: 0;
    background: none;
    font-size: 18px;
    cursor: pointer;
    color: var(--text);
  }
</style>
