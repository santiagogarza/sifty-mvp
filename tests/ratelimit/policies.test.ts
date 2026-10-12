import { readFileSync } from "node:fs";
import path from "node:path";
import { AUTH_IP_POLICY, TRIAGE_POLICY, clientIdFromRequest } from "@/lib/ratelimit/policies";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("rate-limit policies", () => {
  it("read env overrides per call and ignore junk", () => {
    expect(AUTH_IP_POLICY.capacity).toBe(20);
    vi.stubEnv("RATELIMIT_AUTH_IP_PER_MIN", "7");
    expect(AUTH_IP_POLICY.capacity).toBe(7);
    vi.stubEnv("RATELIMIT_TRIAGE_PER_MIN", "not-a-number");
    expect(TRIAGE_POLICY.capacity).toBe(30);
    vi.stubEnv("RATELIMIT_TRIAGE_PER_MIN", "0");
    expect(TRIAGE_POLICY.capacity).toBe(30);
  });

  it("only reference env vars statically, so the Edge middleware bundle inlines them", () => {
    // Next's Edge runtime does not populate `process.env[dynamicKey]`; a
    // dynamic read would silently pin every override to its default there.
    const src = readFileSync(path.resolve(__dirname, "../../lib/ratelimit/policies.ts"), "utf8");
    expect(src).not.toMatch(/process\.env\[/);
    expect(src).toMatch(/process\.env\.RATELIMIT_AUTH_IP_PER_MIN/);
  });

  it("clientIdFromRequest prefers the first x-forwarded-for hop, then x-real-ip, then the fallback", () => {
    const req = (headers: Record<string, string>) => new Request("http://x", { headers });
    expect(clientIdFromRequest(req({ "x-forwarded-for": "1.1.1.1, 10.0.0.1" }))).toBe("1.1.1.1");
    expect(clientIdFromRequest(req({ "x-real-ip": "2.2.2.2" }))).toBe("2.2.2.2");
    expect(clientIdFromRequest(req({}))).toBe("anonymous");
    expect(clientIdFromRequest(req({}), "fallback")).toBe("fallback");
  });
});
