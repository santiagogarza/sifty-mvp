"use client";

import * as React from "react";

/**
 * Starts the browser Sentry SDK when `NEXT_PUBLIC_SENTRY_DSN` is set. The
 * SDK is imported lazily so pages ship no Sentry code without a DSN.
 */
export function SentryClient(): null {
  React.useEffect(() => {
    const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;
    if (!dsn) return;
    import("@sentry/nextjs").then((Sentry) => {
      Sentry.init({
        dsn,
        environment: process.env.NEXT_PUBLIC_VERCEL_ENV ?? "development",
        tracesSampleRate: 0,
      });
    });
  }, []);
  return null;
}
