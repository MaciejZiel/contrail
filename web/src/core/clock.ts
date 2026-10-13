/** Estimate of the server clock so positions line up even if the device clock is off. */
let offsetMs = 0;

export function syncServerTime(serverNowMs: number): void {
  offsetMs = serverNowMs - Date.now();
}

/** Server-clock seconds. */
export function serverNow(): number {
  return (Date.now() + offsetMs) / 1000;
}
