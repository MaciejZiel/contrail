import { decodeSnapshot, type Snapshot } from "./codec";
import { syncServerTime } from "./clock";
import { rectKey, rectQuery, type TileRect } from "./tiles";

export type Freshness = "loading" | "live" | "delayed" | "stale" | "offline";

export interface FeedStatus {
  state: Freshness;
  /** Median age of the tiles in view, seconds. */
  medianAgeS: number;
  oldestAgeS: number;
  newestAgeS: number;
  /** Areas refreshed within the last two minutes. */
  freshTiles: number;
  tiles: number;
  pending: number;
  error: string;
}

export const INITIAL_STATUS: FeedStatus = {
  state: "loading",
  medianAgeS: 0,
  oldestAgeS: 0,
  newestAgeS: 0,
  freshTiles: 0,
  tiles: 0,
  pending: 0,
  error: "",
};

export interface PollerOptions {
  baseUrl: string;
  getRect: () => TileRect;
  /** Current map zoom; the server thins aircraft at low zoom. */
  getZoom: () => number;
  /** ICAO24 of the selected aircraft: the server never thins it out. */
  getKeep?: () => string | null;
  onSnapshot: (s: Snapshot) => void;
  onStatus: (s: FeedStatus) => void;
  fetchImpl?: typeof fetch;
}

const IDLE_MS = 6000;
const FILLING_MS = 2500;
const ERROR_MS = 8000;

export function classify(medianAgeS: number): Freshness {
  if (medianAgeS < 45) return "live";
  if (medianAgeS < 180) return "delayed";
  return "stale";
}

export function summarize(snapshot: Snapshot, pending: number): FeedStatus {
  const ages = snapshot.tiles
    .map((t) => (snapshot.serverNowMs - t.fetchedAtMs) / 1000)
    .sort((a, b) => a - b);
  const median = ages.length ? (ages[Math.floor(ages.length / 2)] ?? 0) : 0;
  return {
    state: ages.length ? classify(median) : "loading",
    medianAgeS: median,
    oldestAgeS: ages[ages.length - 1] ?? 0,
    newestAgeS: ages[0] ?? 0,
    freshTiles: ages.filter((a) => a < 120).length,
    tiles: ages.length,
    pending,
    error: "",
  };
}

/** Polls the aircraft endpoint for the current viewport: one request in flight, aborted when superseded. */
export class Poller {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private abort: AbortController | undefined;
  private lastEtag = new Map<string, string>();
  private lastStatus: FeedStatus = INITIAL_STATUS;
  private stopped = true;
  private fetchImpl: typeof fetch;

  constructor(private opts: PollerOptions) {
    this.fetchImpl = opts.fetchImpl ?? ((...a) => fetch(...a));
  }

  start(): void {
    this.stopped = false;
    document.addEventListener("visibilitychange", this.onVisibility);
    void this.tick();
  }

  stop(): void {
    this.stopped = true;
    document.removeEventListener("visibilitychange", this.onVisibility);
    clearTimeout(this.timer);
    this.abort?.abort();
  }

  /** The viewport changed: fetch now (debounced by the caller). */
  refreshNow(): void {
    if (this.stopped) return;
    clearTimeout(this.timer);
    void this.tick();
  }

  private onVisibility = (): void => {
    if (document.hidden) {
      clearTimeout(this.timer);
      this.abort?.abort();
    } else if (!this.stopped) {
      this.refreshNow();
    }
  };

  private schedule(ms: number): void {
    clearTimeout(this.timer);
    if (this.stopped || document.hidden) return;
    this.timer = setTimeout(() => void this.tick(), ms + Math.random() * 400);
  }

  private async tick(): Promise<void> {
    this.abort?.abort();
    const ctl = new AbortController();
    this.abort = ctl;
    const rect = this.opts.getRect();
    const zoom = Math.floor(this.opts.getZoom());
    const keep = this.opts.getKeep?.() ?? null;
    const key = `${rectKey(rect)},${zoom},${keep ?? ""}`;
    let next = IDLE_MS;
    try {
      const res = await this.fetchImpl(`${this.opts.baseUrl}api/v1/aircraft?${rectQuery(rect)}&z=${zoom}${keep ? `&keep=${keep}` : ""}`, {
        signal: ctl.signal,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const etag = res.headers.get("etag") ?? "";
      const pending = Number(res.headers.get("x-pending") ?? "0");
      const unchanged = etag !== "" && this.lastEtag.get(key) === etag;
      const buffer = await res.arrayBuffer();
      const snapshot = decodeSnapshot(buffer);
      syncServerTime(snapshot.serverNowMs);
      this.lastEtag.clear();
      this.lastEtag.set(key, etag);
      if (!unchanged) this.opts.onSnapshot(snapshot);
      this.publish(summarize(snapshot, pending));
      if (pending > 0) next = FILLING_MS;
    } catch (err) {
      if (ctl.signal.aborted) return;
      this.fail(err instanceof Error ? err.message : "request failed");
      next = ERROR_MS;
    }
    this.schedule(next);
  }

  private fail(message: string): void {
    this.publish({ ...this.lastStatus, state: "offline", error: message });
  }

  private publish(s: FeedStatus): void {
    this.lastStatus = s;
    this.opts.onStatus(s);
  }
}
