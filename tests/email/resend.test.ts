import { EmailSendError, createResendProvider } from "@/lib/email";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Resend provider against a stubbed `fetch`: payload mapping, idempotency
 * header, error mapping, and the missing-id guard.
 */

const message = {
  to: "ana@example.com",
  subject: "Hello",
  html: "<p>Hello</p>",
  text: "Hello",
  category: "transactional" as const,
  headers: { "List-Unsubscribe": "<https://sifty.example/u>" },
  idempotencyKey: "welcome:user_1",
};

function stubFetch(status: number, body: unknown) {
  const spy = vi.fn(
    async () =>
      new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json" },
      }),
  );
  vi.stubGlobal("fetch", spy);
  return spy;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("resend provider", () => {
  it("posts the mapped payload with reply-to, tags, headers, and the idempotency key", async () => {
    const spy = stubFetch(200, { id: "re_123" });
    const provider = createResendProvider({
      apiKey: "re_test",
      from: "Sifty <hello@sifty.example>",
      replyTo: "support@sifty.example",
    });
    const sent = await provider.send(message);
    expect(sent).toEqual({ id: "re_123", provider: "resend" });

    const [url, init] = spy.mock.calls[0] as unknown as [string, RequestInit];
    expect(String(url)).toContain("/emails");
    const headers = new Headers(init.headers);
    expect(headers.get("Idempotency-Key")).toBe("welcome:user_1");
    expect(headers.get("Authorization")).toBe("Bearer re_test");
    expect(init.signal).toBeInstanceOf(AbortSignal);
    const body = JSON.parse(String(init.body));
    expect(body).toMatchObject({
      from: "Sifty <hello@sifty.example>",
      to: "ana@example.com",
      subject: "Hello",
      html: "<p>Hello</p>",
      text: "Hello",
      reply_to: "support@sifty.example",
      headers: { "List-Unsubscribe": "<https://sifty.example/u>" },
      tags: [{ name: "category", value: "transactional" }],
    });
  });

  it("maps API errors to EmailSendError", async () => {
    stubFetch(403, { statusCode: 403, name: "validation_error", message: "domain not verified" });
    const provider = createResendProvider({ apiKey: "re_test", from: "x@sifty.example" });
    await expect(provider.send(message)).rejects.toThrow(EmailSendError);
    await expect(provider.send(message)).rejects.toThrow(/domain not verified/);
  });

  it("treats a 200 without a message id as a failure", async () => {
    stubFetch(200, {});
    const provider = createResendProvider({ apiKey: "re_test", from: "x@sifty.example" });
    await expect(provider.send(message)).rejects.toThrow(/no message id/);
  });
});
