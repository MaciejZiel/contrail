import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchPhoto, fetchPhotoByReg, resetPhotoClientForTests } from "../src/core/planespotters";

const ok = (photos: unknown[]) =>
  Promise.resolve(new Response(JSON.stringify({ photos }), { status: 200, headers: { "content-type": "application/json" } }));

describe("Planespotters client", () => {
  beforeEach(() => resetPhotoClientForTests());
  afterEach(() => vi.unstubAllGlobals());

  it("shares one request between callers asking for the same photo", async () => {
    const fetchMock = vi.fn(() => ok([]));
    vi.stubGlobal("fetch", fetchMock);
    const ctl = new AbortController();
    await Promise.all([fetchPhoto("48AE23", ctl.signal), fetchPhoto("48AE23", ctl.signal)]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("a caller that aborts does not break another caller waiting for the same lookup", async () => {
    vi.stubGlobal("fetch", vi.fn(() => ok([])));
    const first = new AbortController();
    const second = new AbortController();
    const a = fetchPhoto("48AE23", first.signal);
    const b = fetchPhoto("48AE23", second.signal);
    first.abort();
    await expect(a).rejects.toThrow();
    await expect(b).resolves.toBeNull();
  });

  it("after a CORS or network failure it stops asking, so the console gets one error, not one per aircraft", async () => {
    const fetchMock = vi.fn(() => Promise.reject(new TypeError("Failed to fetch")));
    vi.stubGlobal("fetch", fetchMock);
    const ctl = new AbortController();
    await expect(fetchPhoto("48AE23", ctl.signal)).rejects.toThrow();
    await expect(fetchPhotoByReg("SP-LSD", ctl.signal)).rejects.toThrow();
    await expect(fetchPhoto("440B30", ctl.signal)).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("an HTTP error does not disable later lookups", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response("busy", { status: 429 })).mockImplementation(() => ok([]));
    vi.stubGlobal("fetch", fetchMock);
    const ctl = new AbortController();
    await expect(fetchPhoto("48AE23", ctl.signal)).rejects.toThrow(/429/);
    await expect(fetchPhoto("440B30", ctl.signal)).resolves.toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
