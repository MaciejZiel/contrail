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
    gap: 8px;
    padding: 7px 12px;
    border-radius: 999px;
    background: var(--surface);
    border: 1px solid var(--border);
    box-shadow: var(--shadow);
    font-size: 13px;
    white-space: nowrap;
    backdrop-filter: blur(8px);
    max-width: 100%;
  }
  @media (max-width: 480px) {
    .chip {
      white-space: normal;
    }
  }
  .dot {
    width: 9px;
    height: 9px;
    border-radius: 50%;
    background: var(--text-dim);
    flex: none;
  }
  [data-tone="ok"] .dot {
    background: var(--good);
    box-shadow: 0 0 0 0 rgba(74, 222, 128, 0.6);
    animation: pulse 2.4s infinite;
  }
  [data-tone="neutral"] .dot {
    background: var(--accent);
    opacity: 0.8;
  }
  [data-tone="warn"] .dot {
    background: var(--warn);
  }
  [data-tone="bad"] .dot {
    background: var(--bad); /* red only when the feed itself is failing, never for normal ageing */
  }
  @keyframes pulse {
    70% {
      box-shadow: 0 0 0 7px rgba(74, 222, 128, 0);
    }
    100% {
      box-shadow: 0 0 0 0 rgba(74, 222, 128, 0);
    }
  }
</style>
