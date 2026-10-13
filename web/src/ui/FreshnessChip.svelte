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
        return `${status.pending > 0 ? "Loading areas" : "Live"} · ${count.toLocaleString("en")} aircraft${oldest()}`;
      case "aging":
        return `Updated ${age(status.medianAgeS)} ago · ${count.toLocaleString("en")} aircraft${oldest()}`;
      default:
        return `Data ${age(status.medianAgeS)} old, refreshing · ${count.toLocaleString("en")} aircraft${oldest()}`;
    }
  });

  const detail = $derived(
    status.tiles
      ? `Position data is ${ageRange(status.newestAgeS, status.oldestAgeS)} old across ${status.tiles} ${status.tiles === 1 ? "area" : "areas"} (${status.freshTiles} refreshed within 2 minutes)` +
          (status.pending ? `; ${status.pending} more loading` : "") +
          ". Aircraft keep moving between updates by dead reckoning."
      : (status.error || "Waiting for the first data"),
  );

  /** The oldest area is always shown honestly once it is noticeably behind. */
  function oldest(): string {
    return status.oldestAgeS > 90 ? ` · oldest area ${age(status.oldestAgeS)}` : "";
  }

  function ageRange(newest: number, oldest: number): string {
    const a = age(newest);
    const b = age(oldest);
    return a === b ? a : `${a} to ${b}`;
  }

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
  [data-state="aging"] .dot {
    background: var(--accent);
    opacity: 0.8;
  }
  [data-state="old"] .dot {
    background: var(--warn);
  }
  [data-state="offline"] .dot {
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
