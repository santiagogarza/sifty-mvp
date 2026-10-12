import {
  EmailNotConfiguredError,
  createConsoleProvider,
  getEmailProvider,
  isEmailDeliveryConfigured,
  sendEmail,
  setEmailProviderForTesting,
} from "@/lib/email";
import { setErrorSink } from "@/lib/observability/report-error";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const message = {
  to: "ana@example.com",
  subject: "Hello",
  html: "<p>Hello</p>",
  text: "Hello",
  category: "transactional" as const,
};

beforeEach(() => {
  // Exercise the real resolver, not the per-test outbox from setup.ts.
  setEmailProviderForTesting(null);
  vi.stubEnv("RESEND_API_KEY", "");
  vi.stubEnv("EMAIL_FROM", "");
  vi.stubEnv("VERCEL_ENV", "");
});

afterEach(() => {
  setErrorSink(() => undefined);
  setEmailProviderForTesting(null);
});

describe("email provider selection", () => {
  it("uses the console provider when Resend is not configured", () => {
    expect(isEmailDeliveryConfigured()).toBe(false);
    expect(getEmailProvider().name).toBe("console");
  });

  it("uses Resend when RESEND_API_KEY and EMAIL_FROM are both set", () => {
    vi.stubEnv("RESEND_API_KEY", "re_test_123");
    vi.stubEnv("EMAIL_FROM", "Sifty <onboarding@resend.dev>");
    expect(isEmailDeliveryConfigured()).toBe(true);
    expect(getEmailProvider().name).toBe("resend");
  });

  it("still falls back to console when only one of the two is set", () => {
    vi.stubEnv("RESEND_API_KEY", "re_test_123");
    expect(getEmailProvider().name).toBe("console");
  });

  it("reports a loud error in production without Resend, but keeps delivering to the log", () => {
    vi.stubEnv("VERCEL_ENV", "production");
    const reported: unknown[] = [];
    setErrorSink((err) => reported.push(err));

    const provider = getEmailProvider();
    expect(provider.name).toBe("console");
    expect(reported).toHaveLength(1);
    expect(reported[0]).toBeInstanceOf(EmailNotConfiguredError);
    expect(String((reported[0] as Error).message)).toContain("RESEND_API_KEY");
  });

  it("caches the resolved provider per process", () => {
    expect(getEmailProvider()).toBe(getEmailProvider());
  });
});

describe("console provider", () => {
  it("records every message in its outbox and returns an id", async () => {
    const provider = createConsoleProvider({ silent: true });
    const sent = await provider.send(message);
    expect(sent.provider).toBe("console");
    expect(sent.id).toMatch(/^console_/);
    expect(provider.outbox).toHaveLength(1);
    expect(provider.outbox[0]!.subject).toBe("Hello");
    provider.clear();
    expect(provider.outbox).toHaveLength(0);
  });

  it("prints the plain-text body so links are visible in the terminal", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const provider = createConsoleProvider({ silent: false });
    await provider.send({ ...message, text: "Click https://sifty.example/verify?token=t0k" });
    expect(info).toHaveBeenCalledTimes(1);
    expect(String(info.mock.calls[0]![0])).toContain("https://sifty.example/verify?token=t0k");
    info.mockRestore();
  });
});

describe("sendEmail", () => {
  it("reports and rethrows provider failures", async () => {
    const reported: unknown[] = [];
    setErrorSink((err) => reported.push(err));
    setEmailProviderForTesting({
      name: "resend",
      async send() {
        throw new Error("boom");
      },
    });
    await expect(sendEmail(message)).rejects.toThrow("boom");
    expect(reported).toHaveLength(1);
  });
});
