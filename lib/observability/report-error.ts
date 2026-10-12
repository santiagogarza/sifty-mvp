import { captureToSentry } from "./sentry";

/**
 * Error reporting seam.
 *
 * Every server-side `catch` calls `reportError(err, context)` instead of
 * (or in addition to) `console.error`. The default sink writes one JSON
 * line to stderr (what Vercel Logs shows) and forwards to Sentry when
 * `SENTRY_DSN` is set (`lib/observability/sentry.ts`). Tests swap the sink
 * with `setErrorSink()`.
 */

export interface ErrorContext {
  /** Logical area, e.g. "stripe.webhook", "triage.route". */
  area: string;
  userId?: string | null;
  /** Tags surfaced as filterable attributes. */
  tags?: Record<string, string | number | boolean | null | undefined>;
  /** Free-form extra context. Keep small. */
  extra?: Record<string, unknown>;
}

type Sink = (err: unknown, ctx: ErrorContext) => void;

let sink: Sink = defaultSink;

export function setErrorSink(next: Sink): void {
  sink = next;
}

export function reportError(err: unknown, ctx: ErrorContext): void {
  try {
    sink(err, ctx);
  } catch {
    // Never let observability take down the request path.
    defaultSink(err, ctx);
  }
}

function defaultSink(err: unknown, ctx: ErrorContext): void {
  if (process.env.NODE_ENV === "test") return;
  const payload =
    err instanceof Error
      ? { name: err.name, message: err.message, stack: err.stack }
      : { name: "Unknown", message: String(err), stack: null };
  const line = JSON.stringify({
    level: "error",
    area: ctx.area,
    userId: ctx.userId ?? null,
    err: payload,
    tags: ctx.tags ?? null,
    extra: ctx.extra ?? null,
    ts: new Date().toISOString(),
  });
  console.error(line);
  captureToSentry(err, ctx);
}
