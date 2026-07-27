/**
 * A clock that doesn't care what the laptop thinks the time is.
 *
 * `Date.now()` is whatever the OS says, and it moves: NTP corrections, a
 * wrong timezone-less BIOS clock, a user nudging the system clock. A focus
 * timer anchored to absolute timestamps inherits every one of those jumps.
 *
 * So we measure the offset against the server once (NTP's simplest trick —
 * assume symmetric latency and take the round-trip midpoint) and add it to
 * every reading. A lower round trip is a tighter bound on the error, so the
 * best sample wins until it goes stale.
 */

const MAX_ACCEPTED_RTT_MS = 2_000;
const STALE_AFTER_MS = 5 * 60_000;
const REQUEST_TIMEOUT_MS = 4_000;

interface ClockSample {
  offsetMs: number;
  rttMs: number;
  /** Local time the sample was taken, for staleness only. */
  takenAt: number;
}

let best: ClockSample | null = null;
let inFlight: Promise<boolean> | null = null;

/**
 * Server time minus local time, assuming the server read its clock at the
 * midpoint of the round trip.
 */
export function computeOffsetMs(serverTime: number, sentAt: number, receivedAt: number): number {
  return serverTime - (sentAt + receivedAt) / 2;
}

/** Whether a newer sample should replace the one we're using. */
export function shouldAdopt(
  current: ClockSample | null,
  candidate: ClockSample,
  now: number,
): boolean {
  if (candidate.rttMs > MAX_ACCEPTED_RTT_MS) return false;
  if (!current) return true;
  if (now - current.takenAt > STALE_AFTER_MS) return true;
  return candidate.rttMs < current.rttMs;
}

export function clockOffsetMs(): number {
  return best?.offsetMs ?? 0;
}

export function isClockSynced(): boolean {
  return best !== null;
}

/** UTC epoch milliseconds, corrected toward the server's clock. */
export function serverNow(): number {
  return Date.now() + clockOffsetMs();
}

/** Test seam — drops the measured offset. */
export function resetServerClock(): void {
  best = null;
  inFlight = null;
}

/**
 * Take one sample. Concurrent callers share the in-flight request. Failure is
 * silent by design: an unreachable `/api/time` just leaves the timer running
 * on the local clock, which is right often enough.
 */
export function syncServerClock(): Promise<boolean> {
  if (inFlight) return inFlight;
  inFlight = takeSample().finally(() => {
    inFlight = null;
  });
  return inFlight;
}

async function takeSample(): Promise<boolean> {
  const sentAt = Date.now();
  try {
    const res = await fetch("/api/time", {
      cache: "no-store",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!res.ok) return false;
    const receivedAt = Date.now();
    const body = (await res.json()) as { now?: unknown };
    if (typeof body.now !== "number" || !Number.isFinite(body.now)) return false;

    const candidate: ClockSample = {
      offsetMs: computeOffsetMs(body.now, sentAt, receivedAt),
      rttMs: receivedAt - sentAt,
      takenAt: receivedAt,
    };
    if (shouldAdopt(best, candidate, receivedAt)) best = candidate;
    return true;
  } catch {
    return false;
  }
}
