/**
 * Error reporting seam.
 *
 * Stage 4 keeps this minimal — every server-side `catch` should call
 * `reportError(err, context)` instead of (or in addition to) `console.error`.
 * The default sink writes to stderr with a stable JSON shape; pointing it
 * at Sentry / Vercel Observability later is a one-file change.
 *
 * The shape (`name`, `message`, `stack`, `tags`) is what Sentry's `withScope`
 * + `captureException` would consume; we keep it stable so the future
 * adapter is just routing.
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
}
