/** Last-resort logging: anything that escapes the app ends up in the console with a recognisable prefix. */
export function installGlobalHandlers(onFatal: (message: string) => void): void {
  window.addEventListener("error", (e) => {
    console.error("[contrail] uncaught error:", e.message, e.filename ? `(${e.filename}:${e.lineno})` : "");
    // only our own scripts count: extensions and the ResizeObserver notice must not take the map down
    if (e.filename.startsWith(location.origin) && !/ResizeObserver/.test(e.message)) onFatal(e.message);
  });
  window.addEventListener("unhandledrejection", (e) => {
    const reason = e.reason instanceof Error ? e.reason.message : String(e.reason);
    console.error("[contrail] unhandled promise rejection:", reason);
  });
}
