<script lang="ts">
  import type { FeedStatus } from "../core/poller";

  let { status, count }: { status: FeedStatus; count: number } = $props();

  const label = $derived.by(() => {
    switch (status.state) {
      case "loading":
        return "Loading traffic";
      case "offline":
        return "Offline, retrying";
      case "live":
        return status.pending > 0 ? `Loading areas · ${count.toLocaleString("en")} aircraft` : `Live · ${count.toLocaleString("en")} aircraft`;
      default:
        return `Data ${age(status.medianAgeS)} old · ${count.toLocaleString("en")} aircraft`;
    }
  });

  const detail = $derived(
    status.tiles
      ? `Position data is ${age(status.newestAgeS)} to ${age(status.oldestAgeS)} old across ${status.tiles} areas` +
          (status.pending ? `; ${status.pending} more loading` : "") +
          ". Aircraft keep moving between updates by dead reckoning."
      : (status.error || "Waiting for the first data"),
  );

  function age(s: number): string {
    if (s < 90) return `${Math.max(1, Math.round(s))} s`;
    if (s < 5400) return `${Math.round(s / 60)} min`;
    return `${Math.round(s / 3600)} h`;
  }
</script>

<div class="chip" data-state={status.state} title={detail} role="status">
  <span class="dot" aria-hidden="true"></span>
  <span class="text">{label}</span>
  <span class="sr-only">{detail}</span>
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
  }
  .dot {
    width: 9px;
    height: 9px;
    border-radius: 50%;
    background: var(--text-dim);
    flex: none;
  }
  [data-state="live"] .dot {
    background: var(--good);
    box-shadow: 0 0 0 0 rgba(74, 222, 128, 0.6);
    animation: pulse 2.4s infinite;
  }
  [data-state="delayed"] .dot {
    background: var(--warn);
  }
  [data-state="stale"] .dot,
  [data-state="offline"] .dot {
    background: var(--bad);
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
