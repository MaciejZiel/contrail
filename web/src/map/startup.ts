/** Checks that run before the map is created, so a failure becomes a clear message instead of a blank page. */

export type ProblemKind = "webgl" | "worker" | "init" | "timeout";

export interface MapProblem {
  kind: ProblemKind;
  title: string;
  /** What happened, in plain words. */
  detail: string;
  /** What the visitor can try. */
  hints: string[];
  /** The technical reason, also logged to the console. */
  technical: string;
}

export function webgl2Available(): boolean {
  try {
    const c = document.createElement("canvas");
    return !!c.getContext("webgl2");
  } catch {
    return false;
  }
}

export function webglProblem(): MapProblem {
  return {
    kind: "webgl",
    title: "The map needs WebGL 2, which this browser is not providing",
    detail: "Contrail draws the map and the aircraft with WebGL 2, and the browser reports that it is unavailable.",
    hints: [
      "Turn on hardware acceleration in the browser settings (in Chrome: Settings, System, \"Use graphics acceleration when available\"), then restart the browser.",
      "Check chrome://gpu: \"WebGL2\" should say hardware accelerated.",
      "A privacy extension or browser setting that blocks WebGL can cause this too; allow it for this site.",
    ],
    technical: "getContext('webgl2') returned null",
  };
}

export function workerProblem(technical: string, wrongType = false): MapProblem {
  return {
    kind: "worker",
    title: wrongType ? "The map's worker file was delivered the wrong way" : "The map's worker file could not be loaded",
    detail: wrongType
      ? "The map engine needs a small script file, and the server answered with a content type that browsers refuse for scripts."
      : "The map engine needs a small script file from this site, and it could not be loaded.",
    hints: wrongType
      ? [
          "Reload the page once. If it persists, the server needs a mapping for .mjs files (text/javascript); tell the site owner.",
        ]
      : [
          "An ad or content blocker may be blocking the file: disable it for this site and reload.",
          "Reload the page, or open it in a private window to rule out a cached copy.",
        ],
    technical,
  };
}

export function initProblem(technical: string): MapProblem {
  return {
    kind: "init",
    title: "The map could not start",
    detail: "Something went wrong while the map was being created.",
    hints: ["Reload the page.", "Disable extensions for this site, or try a private window.", "Make sure the browser is up to date."],
    technical,
  };
}

export function timeoutProblem(): MapProblem {
  return {
    kind: "timeout",
    title: "The map is taking too long to start",
    detail: "The map did not finish loading. Its script files or its background tiles may be blocked or very slow.",
    hints: [
      "An ad or content blocker may be blocking requests from this site: disable it for this site and reload.",
      "Check that the network is working, then reload.",
      "Hardware acceleration should be on (chrome://gpu).",
    ],
    technical: "map 'load' event did not fire within the time limit",
  };
}

const isJavascript = (ct: string | null) => /javascript|ecmascript/i.test(ct ?? "");

async function head(url: string): Promise<{ ok: boolean; contentType: string | null }> {
  const res = await fetch(url, { method: "HEAD", cache: "no-store" });
  return { ok: res.ok, contentType: res.headers.get("content-type") };
}

/**
 * Make sure the worker files are reachable and have a script content type before MapLibre tries to run them
 * (a module worker silently refuses anything else, which looks like a blank map). If the worker is served
 * with the wrong type, one retry with a cache-busting query is made, in case a stale copy is being served.
 */
export async function resolveWorkerUrl(
  dir: string,
  baseUrl: string,
): Promise<{ url: string } | { problem: MapProblem }> {
  const worker = new URL(`maplibre/${dir}/maplibre-gl-worker.mjs`, baseUrl).href;
  const shared = new URL(`maplibre/${dir}/maplibre-gl-shared.mjs`, baseUrl).href;
  try {
    let url = worker;
    let w = await head(url);
    if (w.ok && !isJavascript(w.contentType)) {
      url = `${worker}?cb=${Date.now()}`; // one retry past any cached copy
      w = await head(url);
    }
    if (!w.ok) return { problem: workerProblem(`HEAD ${worker} -> not ok`) };
    if (!isJavascript(w.contentType)) {
      return { problem: workerProblem(`worker served as ${w.contentType ?? "unknown"}`, true) };
    }
    const s = await head(shared);
    if (!s.ok) return { problem: workerProblem(`HEAD ${shared} -> not ok`) };
    if (!isJavascript(s.contentType)) {
      return { problem: workerProblem(`shared chunk served as ${s.contentType ?? "unknown"}`, true) };
    }
    return { url };
  } catch (err) {
    return { problem: workerProblem(`fetching the worker failed: ${err instanceof Error ? err.message : String(err)}`) };
  }
}
