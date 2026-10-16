<script lang="ts">
  import type { FeedStatus } from "../core/poller";
  import { detail, label, tone } from "./freshness";

  let { status, count }: { status: FeedStatus; count: number } = $props();

  const text = $derived(label(status, count));
  const detailText = $derived(detail(status));
  const toneName = $derived(tone(status));
</script>

<div class="chip" data-state={status.state} data-tone={toneName} title={detailText} role="status">
  <span class="dot" aria-hidden="true"></span>
  <span class="text">{text}</span>
  <span class="sr-only">{detailText}</span>
</div>

<style>
  .chip {
    display: inline-flex;
    align-items: center;
    gap: 9px;
    padding: 0 14px;
    min-height: 44px;
    border-radius: var(--radius);
    background: var(--surface);
    font-size: var(--fs-s);
    font-weight: 500;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
    max-width: 100%;
  }
  @media (max-width: 480px) {
    .chip {
      white-space: normal;
      padding-block: 6px;
    }
  }
  .dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--text-dim);
    flex: none;
  }
  [data-tone="ok"] .dot {
    background: var(--good);
  }
  [data-tone="neutral"] .dot {
    background: var(--text-dim);
  }
  [data-tone="warn"] .dot {
    background: var(--warn);
  }
  [data-tone="bad"] .dot {
    background: var(--bad); /* red only when the feed itself is failing, never for normal ageing */
  }
</style>
