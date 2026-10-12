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
 * Every error event, transaction, span, and breadcrumb passes through
 * `scrubEvent()`: request URLs, referers, `contexts.nextjs.request_path`,
 * `http.target`/`url.*` span attributes, and navigation breadcrumbs lose
 * their query strings and Better Auth path tokens, so reset tokens and
 * invite codes never reach Sentry. Tracing is off (`tracesSampleRate: 0`)
 * until span export is verified end to end; the hooks are installed so
 * turning it on later cannot reopen the leak.
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
  | "beforeSend"
  | "beforeSendTransaction"
  | "beforeSendSpan"
  | "beforeBreadcrumb"
  | "tracesSampleRate"
> {
  return {
    beforeSend: (event) => scrubEvent(event),
    beforeSendTransaction: (event) => scrubEvent(event),
    beforeSendSpan: (span) => scrubEvent(span),
    beforeBreadcrumb: (breadcrumb) => scrubEvent(breadcrumb),
    // Errors are the point of this sink; spans carry raw request targets.
    tracesSampleRate: 0,
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
