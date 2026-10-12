import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sentry = vi.hoisted(() => ({
  init: vi.fn(),
  captureException: vi.fn(),
  captureRequestError: vi.fn(() => Promise.resolve()),
  withScope: vi.fn((cb: (scope: unknown) => void) =>
    cb({ setTag: vi.fn(), setUser: vi.fn(), setContext: vi.fn() }),
  ),
}));

vi.mock("@sentry/nextjs", () => sentry);

type SentryModule = typeof import("@/lib/observability/sentry");
type ReportErrorModule = typeof import("@/lib/observability/report-error");

let adapter: SentryModule;
let reporter: ReportErrorModule;

beforeEach(async () => {
  vi.clearAllMocks();
  // tests/setup.ts already imported lib/observability through lib/email with
  // the real SDK; re-import so the modules under test see the mock.
  vi.resetModules();
  adapter = await import("@/lib/observability/sentry");
  reporter = await import("@/lib/observability/report-error");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("sentry adapter", () => {
  it("is a no-op without SENTRY_DSN", async () => {
    vi.stubEnv("SENTRY_DSN", "");
    expect(adapter.isSentryEnabled()).toBe(false);
    adapter.initSentryServer();
    adapter.captureToSentry(new Error("x"), { area: "test" });
    await adapter.captureRequestError(
      new Error("x"),
      { path: "/x", method: "GET", headers: {} },
      { routerKind: "App Router", routePath: "/x", routeType: "route" },
    );
    expect(sentry.init).not.toHaveBeenCalled();
    expect(sentry.captureException).not.toHaveBeenCalled();
    expect(sentry.captureRequestError).not.toHaveBeenCalled();
  });

  it("initializes and captures with the DSN set", () => {
    vi.stubEnv("SENTRY_DSN", "https://key@o1.ingest.sentry.io/1");
    vi.stubEnv("VERCEL_ENV", "preview");
    adapter.initSentryServer();
    expect(sentry.init).toHaveBeenCalledWith(
      expect.objectContaining({ dsn: "https://key@o1.ingest.sentry.io/1", environment: "preview" }),
    );

    const err = new Error("boom");
    adapter.captureToSentry(err, { area: "triage.route", userId: "user_1", tags: { status: 500 } });
    expect(sentry.withScope).toHaveBeenCalledTimes(1);
    expect(sentry.captureException).toHaveBeenCalledWith(err);
  });

  it("wraps non-Error values before capturing", () => {
    vi.stubEnv("SENTRY_DSN", "https://key@o1.ingest.sentry.io/1");
    adapter.captureToSentry("string failure", { area: "test" });
    const captured = sentry.captureException.mock.calls[0]?.[0] as Error;
    expect(captured).toBeInstanceOf(Error);
    expect(captured.message).toBe("string failure");
  });
});

describe("reportError", () => {
  it("routes through the installed sink and survives a throwing sink", () => {
    const seen: string[] = [];
    reporter.setErrorSink((_err, ctx) => {
      seen.push(ctx.area);
    });
    reporter.reportError(new Error("a"), { area: "one" });
    expect(seen).toEqual(["one"]);

    reporter.setErrorSink(() => {
      throw new Error("sink down");
    });
    expect(() => reporter.reportError(new Error("b"), { area: "two" })).not.toThrow();
  });
});
