import * as Sentry from "@sentry/nextjs";
import type { ErrorContext } from "./report-error";

/**
 * Sentry adapter. Every function here is a no-op unless `SENTRY_DSN` is set,
 * so local dev, CI, previews, and a production without a Sentry project all
 * behave identically to before Sentry existed.
 *
 * Wiring: `instrumentation.ts` calls `initSentryServer()` once per runtime
 * and forwards unhandled request errors through `captureRequestError()`;
 * `reportError()` calls `captureToSentry()` for handled errors. The client
 * SDK is started by `components/observability/sentry-client.tsx` from
 * `NEXT_PUBLIC_SENTRY_DSN`.
 */

export function isSentryEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return !!env.SENTRY_DSN;
}

export function initSentryServer(): void {
  if (!isSentryEnabled()) return;
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? "development",
    release: process.env.VERCEL_GIT_COMMIT_SHA,
    // Keep tracing cheap; errors are the point of this sink. PII is off by default.
    tracesSampleRate: 0.1,
  });
}

export function captureToSentry(err: unknown, ctx: ErrorContext): void {
  if (!isSentryEnabled()) return;
  Sentry.withScope((scope) => {
    scope.setTag("area", ctx.area);
    if (ctx.userId) scope.setUser({ id: ctx.userId });
    for (const [key, value] of Object.entries(ctx.tags ?? {})) {
      if (value !== undefined && value !== null) scope.setTag(key, String(value));
    }
    if (ctx.extra) scope.setContext("extra", ctx.extra);
    Sentry.captureException(err instanceof Error ? err : new Error(String(err)));
  });
}

/** Next.js `onRequestError` hook; no-op without a DSN. */
export const captureRequestError: typeof Sentry.captureRequestError = (...args) => {
  if (!isSentryEnabled()) return Promise.resolve();
  return Sentry.captureRequestError(...args);
};
