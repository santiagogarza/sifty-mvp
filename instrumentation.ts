import { assertProductionEnv } from "@/lib/env/production-guards";
import { captureRequestError, initSentryServer } from "@/lib/observability/sentry";

/**
 * Next.js server instrumentation. `register()` runs once per server
 * process (Node and Edge runtimes) before any request is served.
 */
export async function register(): Promise<void> {
  assertProductionEnv();
  initSentryServer();
}

/** Unhandled errors from route handlers, server components, and middleware. */
export const onRequestError = captureRequestError;
