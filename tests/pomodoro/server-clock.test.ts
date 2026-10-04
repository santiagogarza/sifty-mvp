import {
  clockOffsetMs,
  computeOffsetMs,
  isClockSynced,
  resetServerClock,
  serverNow,
  shouldAdopt,
  syncServerClock,
} from "@/lib/time/server-clock";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const HOUR = 3_600_000;

function timeResponse(now: number): Response {
  return new Response(JSON.stringify({ now, iso: new Date(now).toISOString() }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

beforeEach(() => {
  resetServerClock();
});

afterEach(() => {
  vi.unstubAllGlobals();
  resetServerClock();
});

describe("computeOffsetMs", () => {
  it("assumes the server read its clock at the round-trip midpoint", () => {
    expect(computeOffsetMs(1_050, 1_000, 1_100)).toBe(0);
    expect(computeOffsetMs(1_050 + HOUR, 1_000, 1_100)).toBe(HOUR);
  });
});

describe("shouldAdopt", () => {
  const sample = (rttMs: number, takenAt = 0) => ({ offsetMs: 0, rttMs, takenAt });

  it("takes the first usable sample and prefers tighter round trips", () => {
    expect(shouldAdopt(null, sample(120), 0)).toBe(true);
    expect(shouldAdopt(sample(120), sample(40), 0)).toBe(true);
    expect(shouldAdopt(sample(40), sample(120), 0)).toBe(false);
  });

  it("rejects a round trip too slow to bound the error", () => {
    expect(shouldAdopt(null, sample(5_000), 0)).toBe(false);
  });

  it("replaces a stale sample even when the new one is slower", () => {
    expect(shouldAdopt(sample(40, 0), sample(120), 10 * 60_000)).toBe(true);
  });
});

describe("syncServerClock", () => {
  it("corrects a local clock that is an hour behind", async () => {
    vi.stubGlobal("fetch", async () => timeResponse(Date.now() + HOUR));

    expect(isClockSynced()).toBe(false);
    expect(await syncServerClock()).toBe(true);
    expect(isClockSynced()).toBe(true);
    expect(clockOffsetMs()).toBeGreaterThan(HOUR - 1_000);
    expect(serverNow() - Date.now()).toBeGreaterThan(HOUR - 1_000);
  });

  it("shares one request between concurrent callers", async () => {
    const fetchMock = vi.fn(async () => timeResponse(Date.now()));
    vi.stubGlobal("fetch", fetchMock);

    await Promise.all([syncServerClock(), syncServerClock(), syncServerClock()]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("falls back to the local clock when the server is unreachable", async () => {
    vi.stubGlobal("fetch", async () => {
      throw new Error("offline");
    });

    expect(await syncServerClock()).toBe(false);
    expect(clockOffsetMs()).toBe(0);
    expect(serverNow()).toBeCloseTo(Date.now(), -2);
  });

  it("ignores a response that isn't a usable timestamp", async () => {
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ now: "soon" })));

    expect(await syncServerClock()).toBe(false);
    expect(isClockSynced()).toBe(false);
  });
});
