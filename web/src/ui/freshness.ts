import type { FeedStatus } from "../core/poller";

export type Tone = "neutral" | "ok" | "warn" | "bad";

/** The oldest area is called out once it is more than two minutes behind. */
export const OLDEST_WARN_S = 120;
/** Below this median age the pill simply says the feed is live. */
export const LIVE_MEDIAN_S = 60;

export function age(s: number): string {
  if (s < 90) return `${Math.max(1, Math.round(s))} s`;
  if (s < 5400) return `${Math.round(s / 60)} min`;
  return `${Math.round(s / 3600)} h`;
}

function ageRange(newest: number, oldest: number): string {
  const a = age(newest);
  const b = age(oldest);
  return a === b ? a : `${a} to ${b}`;
}

/** Red only when the feed itself is failing; amber when some area is well behind; never alarming for normal tile rotation. */
export function tone(status: FeedStatus): Tone {
  switch (status.state) {
    case "offline":
      return "bad";
    case "loading":
      return "neutral";
    case "slow":
      return "warn";
    default:
      return status.oldestAgeS > OLDEST_WARN_S ? "warn" : status.medianAgeS < LIVE_MEDIAN_S ? "ok" : "neutral";
  }
}

export function label(status: FeedStatus, count: number): string {
  const n = `${count.toLocaleString("en")} aircraft`;
  switch (status.state) {
    case "loading":
      return "Loading traffic";
    case "slow":
      return "Still waiting for traffic data";
    case "offline":
      return "Can't reach the traffic feed, retrying";
    default: {
      // short on purpose: the amber tone says the oldest area is behind, the tooltip has the exact ages
      const head = status.pending > 0 ? "Loading areas" : status.medianAgeS < LIVE_MEDIAN_S ? "Live" : `${age(status.medianAgeS)} behind`;
      return `${head} · ${n}`;
    }
  }
}

export function detail(status: FeedStatus): string {
  if (status.tiles) {
    return (
      `Median data age ${age(status.medianAgeS)}, oldest area ${age(status.oldestAgeS)}. ` +
      `Position data is ${ageRange(status.newestAgeS, status.oldestAgeS)} old across ${status.tiles} ${status.tiles === 1 ? "area" : "areas"} (${status.freshTiles} refreshed within 2 minutes)` +
      (status.pending ? `; ${status.pending} more loading` : "") +
      ". Areas are refreshed in turn within a request budget, and aircraft keep moving between updates by dead reckoning."
    );
  }
  if (status.state === "slow") return "No traffic data has arrived yet. The network, an ad or content blocker, or the server may be blocking or delaying the request; the browser console has details.";
  if (status.state === "offline") return `The traffic request failed (${status.error || "unknown reason"}). Retrying every few seconds.`;
  return status.error || "Waiting for the first data";
}
