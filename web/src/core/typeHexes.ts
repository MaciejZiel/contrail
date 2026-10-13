import { fetchTypeHexes } from "./api";

const REFRESH_MS = 10_000;

/**
 * The ICAO24 of the aircraft matching a type filter. The map data does not carry the aircraft type,
 * so the server (which knows it) lists the matching addresses; this keeps the list fresh while a
 * type filter is active. Reads server memory only.
 */
export class TypeHexes {
  /** null until the first answer for the current types has arrived. */
  set: Set<number> | null = null;
  private types: string[] = [];
  private timer: ReturnType<typeof setInterval> | undefined;
  private abort: AbortController | undefined;

  constructor(private onChange: () => void = () => undefined) {}

  setTypes(types: string[]): void {
    if (types.join(",") === this.types.join(",")) return;
    this.types = types;
    this.stop();
    this.set = null;
    if (types.length === 0) return this.onChange();
    void this.load();
    this.timer = setInterval(() => void this.load(), REFRESH_MS);
  }

  private async load(): Promise<void> {
    this.abort?.abort();
    const ctl = new AbortController();
    this.abort = ctl;
    const wanted = this.types.join(",");
    try {
      const s = await fetchTypeHexes(this.types, ctl.signal);
      if (ctl.signal.aborted || wanted !== this.types.join(",")) return;
      this.set = s;
      this.onChange();
    } catch {
      // keep the previous list; the next refresh tries again
    }
  }

  stop(): void {
    clearInterval(this.timer);
    this.timer = undefined;
    this.abort?.abort();
  }
}
