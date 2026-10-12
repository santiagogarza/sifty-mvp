/**
 * URL scrubbing for telemetry.
 *
 * Reset tokens (`/reset-password?token=`), invite codes (`/redeem?code=`),
 * and the sign-in bounce (`/sign-in?next=/redeem?code=…`) put bearer
 * secrets in the query string. Nothing we send to Sentry or Vercel
 * Analytics may carry a query string or fragment, so every URL-ish field
 * goes through `stripQuery()` and every query-shaped field is removed.
 * Safe for both server and browser.
 */
export function stripQuery(url: string | undefined | null): string | undefined {
  if (!url) return undefined;
  const cut = url.search(/[?#]/);
  return cut === -1 ? url : url.slice(0, cut);
}

/**
 * Keys that hold a query string or parsed query parameters on Sentry
 * events, Next.js request contexts, breadcrumbs, and analytics payloads.
 * Their values are replaced wholesale; there is no safe subset.
 */
const QUERY_KEYS =
  /(^|[._-])(query_string|querystring|query|query_params|queryparams|search|searchparams)$/i;

export const SCRUBBED = "[scrubbed]";

/** Depth-limited walk: scrub URL-shaped strings and drop query-shaped fields. */
export function scrubUrlsDeep<T>(value: T, depth = 8): T {
  if (depth < 0) return value;
  if (typeof value === "string") {
    return (/^(https?:\/\/|\/)\S*[?#]/.test(value) ? stripQuery(value) : value) as T;
  }
  if (Array.isArray(value)) return value.map((v) => scrubUrlsDeep(v, depth - 1)) as T;
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = QUERY_KEYS.test(k) && v != null && v !== "" ? SCRUBBED : scrubUrlsDeep(v, depth - 1);
    }
    return out as T;
  }
  return value;
}
