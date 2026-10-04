import { GET } from "@/app/api/time/route";
import { describe, expect, it } from "vitest";

/**
 * The focus timer trusts this endpoint over the local clock, so its contract
 * is narrow: a fresh epoch reading, on every request, without a session.
 */
describe("GET /api/time", () => {
  it("returns the current epoch time and a matching ISO string", async () => {
    const before = Date.now();
    const res = GET();
    const after = Date.now();

    expect(res.status).toBe(200);
    const body = (await res.json()) as { now: number; iso: string };
    expect(typeof body.now).toBe("number");
    expect(body.now).toBeGreaterThanOrEqual(before);
    expect(body.now).toBeLessThanOrEqual(after);
    expect(new Date(body.iso).getTime()).toBe(body.now);
  });

  it("is never cached — a stale timestamp is worse than none", () => {
    expect(GET().headers.get("cache-control")).toBe("no-store");
  });

  it("answers without a session, so the timer works before the app loads", async () => {
    const res = GET();
    expect(res.status).toBe(200);
    expect(typeof ((await res.json()) as { now: number }).now).toBe("number");
  });
});
