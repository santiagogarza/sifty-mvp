import { REDACTED, isSecretKey, redactRecord, redactSecrets } from "@/lib/executions/redact";
import { describe, expect, it } from "vitest";

describe("redactSecrets", () => {
  it("replaces values under secret-looking keys, recursively", () => {
    const out = redactSecrets({
      user: "ana",
      password: "hunter2",
      apiKey: "abc",
      api_key: "def",
      Authorization: "Bearer x",
      nested: { refreshToken: "r", headers: { Cookie: "a=b", "set-cookie": "c=d" }, ok: 1 },
      list: [{ clientSecret: "s" }, "plain"],
    }) as Record<string, unknown>;
    expect(out).toEqual({
      user: "ana",
      password: REDACTED,
      apiKey: REDACTED,
      api_key: REDACTED,
      Authorization: REDACTED,
      nested: {
        refreshToken: REDACTED,
        headers: { Cookie: REDACTED, "set-cookie": REDACTED },
        ok: 1,
      },
      list: [{ clientSecret: REDACTED }, "plain"],
    });
    expect(isSecretKey("tokenizer")).toBe(false);
    expect(isSecretKey("x-api-key")).toBe(true);
    expect(isSecretKey("title")).toBe(false);
  });

  it("scrubs credential shapes out of free text", () => {
    const jwt = `eyJhbGciOiJIUzI1NiJ9.${"a".repeat(20)}.${"b".repeat(20)}`;
    const text = [
      `curl -H "Authorization: Bearer sk-live_${"x".repeat(24)}"`,
      `token ${jwt} and ghp_${"A".repeat(36)} and xoxb-1234567890-abc and AKIAABCDEFGHIJKLMNOP`,
      "-----BEGIN RSA PRIVATE KEY-----\nMIIE\n-----END RSA PRIVATE KEY-----",
      "but ordinary words stay",
    ].join("\n");
    const out = redactSecrets({ text }) as { text: string };
    expect(out.text).not.toContain("sk-live_");
    expect(out.text).not.toContain(jwt);
    expect(out.text).not.toContain("ghp_");
    expect(out.text).not.toContain("xoxb-");
    expect(out.text).not.toContain("AKIA");
    expect(out.text).not.toContain("MIIE");
    expect(out.text).toContain("ordinary words stay");
    expect(out.text.match(/\[redacted\]/g)?.length).toBeGreaterThanOrEqual(6);
  });

  it("bounds depth, arrays, strings, and key counts and never throws", () => {
    const deep: Record<string, unknown> = {};
    let cursor = deep;
    for (let i = 0; i < 10; i += 1) {
      cursor.next = {};
      cursor = cursor.next as Record<string, unknown>;
    }
    const circular: Record<string, unknown> = { a: 1 };
    circular.self = circular;
    const out = redactSecrets(
      {
        deep,
        circular,
        many: Array.from({ length: 60 }, (_, i) => i),
        long: "x".repeat(5000),
        fn: () => 1,
        date: new Date("2026-10-12T00:00:00Z"),
        big: 10n,
      },
      { maxDepth: 4 },
    ) as Record<string, unknown>;
    expect(JSON.stringify(out)).toContain("[nested]");
    expect(JSON.stringify(out)).toContain("[circular]");
    expect((out.many as unknown[]).length).toBe(51);
    expect((out.many as unknown[])[50]).toBe("[10 more items]");
    expect((out.long as string).length).toBeLessThan(4100);
    expect(out.fn).toBe("[function]");
    expect(out.date).toBe("2026-10-12T00:00:00.000Z");
    expect(out.big).toBe("10");

    const wide = Object.fromEntries(Array.from({ length: 150 }, (_, i) => [`k${i}`, i]));
    const bounded = redactSecrets(wide) as Record<string, unknown>;
    expect(Object.keys(bounded).length).toBe(101);
    expect(bounded["[more]"]).toBe("50 more keys");
  });

  it("redactRecord wraps non-object values and keeps null", () => {
    expect(redactRecord(null)).toBeNull();
    expect(redactRecord(undefined)).toBeNull();
    expect(redactRecord("Bearer abcdefghijklmnop")).toEqual({ value: REDACTED });
    expect(redactRecord([1, 2])).toEqual({ value: [1, 2] });
    expect(redactRecord({ a: 1 })).toEqual({ a: 1 });
  });
});
