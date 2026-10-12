import * as Sentry from "@sentry/nextjs";
import type { ErrorContext } from "./report-error";
import { scrubUrlsDeep } from "./scrub";

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
 *
 * Every event and breadcrumb passes through `scrubEvent()`: request URLs,
 * referers, `contexts.nextjs.request_path`, and navigation breadcrumbs lose
 * their query strings so reset tokens and invite codes never reach Sentry.
 */

export function isSentryEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return !!env.SENTRY_DSN;
}

/** `beforeSend` / `beforeBreadcrumb` hook shared by the server and browser inits. */
export function scrubEvent<T>(event: T): T {
  return scrubUrlsDeep(event);
}

/** Options common to both runtimes; exported so the browser init stays in sync. */
export function sentryBaseOptions(): Pick<
  Sentry.NodeOptions,
  "beforeSend" | "beforeBreadcrumb" | "tracesSampleRate"
> {
  return {
    beforeSend: (event) => scrubEvent(event),
    beforeBreadcrumb: (breadcrumb) => scrubEvent(breadcrumb),
    // Keep tracing cheap; errors are the point of this sink.
    tracesSampleRate: 0.1,
  };
}

export function initSentryServer(): void {
  if (!isSentryEnabled()) return;
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? "development",
    release: process.env.VERCEL_GIT_COMMIT_SHA,
    ...sentryBaseOptions(),
  });
}

/** Never throws: observability must not take down the request path. */
export function captureToSentry(err: unknown, ctx: ErrorContext): void {
  if (!isSentryEnabled()) return;
  try {
    Sentry.withScope((scope) => {
      scope.setTag("area", ctx.area);
      if (ctx.userId) scope.setUser({ id: ctx.userId });
      for (const [key, value] of Object.entries(ctx.tags ?? {})) {
        if (value !== undefined && value !== null) scope.setTag(key, String(value));
      }
      if (ctx.extra) scope.setContext("extra", scrubEvent(ctx.extra));
      Sentry.captureException(err instanceof Error ? err : new Error(String(err)));
    });
  } catch {
    // Dropped on purpose; the stderr line in reportError already recorded it.
  }
}

/** Next.js `onRequestError` hook; no-op without a DSN, never rejects. */
export const captureRequestError: typeof Sentry.captureRequestError = async (...args) => {
  if (!isSentryEnabled()) return;
  try {
    await Sentry.captureRequestError(...args);
  } catch {
    // Same policy as captureToSentry.
  }
};
