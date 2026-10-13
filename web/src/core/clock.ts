/**
 * Estimate of the server clock so positions line up even if the device clock is off.
 *
 * Every sample arrives late (network delay, or a body the browser served from its HTTP cache),
 * so a sample can only under-estimate the server time. The largest offset among the recent
 * samples is therefore the best estimate; a short window lets it follow device clock changes.
 */
const WINDOW = 12;
const samples: number[] = [];
let offsetMs = 0;

export function syncServerTime(serverNowMs: number, localNowMs = Date.now()): void {
  samples.push(serverNowMs - localNowMs);
  if (samples.length > WINDOW) samples.shift();
  offsetMs = Math.max(...samples);
}

/** Server-clock seconds. */
export function serverNow(localNowMs = Date.now()): number {
  return (localNowMs + offsetMs) / 1000;
}

/** Test helper. */
export function resetClock(): void {
  samples.length = 0;
  offsetMs = 0;
}
