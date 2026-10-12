/**
 * Strip secrets out of anything an execution logs.
 *
 * `execution_steps` keep the inputs and outputs of every tool and model
 * call so the user can audit what Sifty did. Those payloads come from
 * connectors and models and may carry tokens, cookies, or keys; nothing
 * like that may land in the database. Two rules, applied recursively:
 *
 *   - a key that names a secret (`token`, `password`, `apiKey`,
 *     `Authorization`, …) has its value replaced wholesale;
 *   - a string value that looks like a credential (bearer header, JWT,
 *     `sk-…`, GitHub / Slack / AWS key shapes, a PEM private key) is
 *     replaced wherever it appears, including inside longer text.
 *
 * Output is also bounded (depth, array length, string length) so one
 * chatty tool cannot write megabytes per step.
 */

export const REDACTED = "[redacted]";

const SECRET_KEY =
  /(^|[^a-z])(token|secret|password|passwd|pwd|authorization|api[_-]?key|apikey|cookie|credentials?|private[_-]?key|access[_-]?key|refresh[_-]?token|client[_-]?secret|session[_-]?id|set-cookie)([^a-z]|$)/i;

const SECRET_VALUES: readonly RegExp[] = [
  /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi,
  /\bBasic\s+[A-Za-z0-9+/=]{12,}/g,
  // JWT: three base64url segments.
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g,
  // OpenAI / Anthropic / Stripe style.
  /\bsk-(?:ant-|live_|test_)?[A-Za-z0-9_-]{16,}\b/g,
  /\brk_(?:live|test)_[A-Za-z0-9]{16,}\b/g,
  /\bwhsec_[A-Za-z0-9]{16,}\b/g,
  // GitHub, Slack, AWS, Google.
  /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g,
  /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\bAIza[0-9A-Za-z_-]{35}\b/g,
  // Vercel / Resend / generic prefixed keys.
  /\bre_[A-Za-z0-9_]{20,}\b/g,
  /\bvcp_[A-Za-z0-9]{20,}\b/g,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
];

export interface RedactOptions {
  maxDepth?: number;
  maxArray?: number;
  maxString?: number;
  maxKeys?: number;
}

const DEFAULTS: Required<RedactOptions> = {
  maxDepth: 6,
  maxArray: 50,
  maxString: 4000,
  maxKeys: 100,
};

export function isSecretKey(key: string): boolean {
  return SECRET_KEY.test(key);
}

export function redactString(value: string, opts: RedactOptions = {}): string {
  const max = opts.maxString ?? DEFAULTS.maxString;
  let out = value;
  for (const pattern of SECRET_VALUES) out = out.replace(pattern, REDACTED);
  if (out.length > max) out = `${out.slice(0, max)}… [${out.length - max} more chars]`;
  return out;
}

/**
 * A copy of `value` safe to persist. Never throws: a value that cannot be
 * represented (function, symbol, cycle beyond `maxDepth`) becomes a
 * placeholder string.
 */
export function redactSecrets(value: unknown, opts: RedactOptions = {}): unknown {
  const o = { ...DEFAULTS, ...opts };
  return walk(value, o, 0, new WeakSet());
}

/** `redactSecrets` for the object-shaped columns; non-objects are wrapped. */
export function redactRecord(
  value: unknown,
  opts: RedactOptions = {},
): Record<string, unknown> | null {
  if (value === undefined || value === null) return null;
  const out = redactSecrets(value, opts);
  if (out && typeof out === "object" && !Array.isArray(out)) {
    return out as Record<string, unknown>;
  }
  return { value: out };
}

function walk(
  value: unknown,
  o: Required<RedactOptions>,
  depth: number,
  seen: WeakSet<object>,
): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === "string") return redactString(value, o);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "bigint") return value.toString();
  if (typeof value !== "object") return `[${typeof value}]`;
  if (value instanceof Date) return value.toISOString();
  if (seen.has(value)) return "[circular]";
  if (depth >= o.maxDepth) return "[nested]";
  seen.add(value);
  if (Array.isArray(value)) {
    const items: unknown[] = value.slice(0, o.maxArray).map((v) => walk(v, o, depth + 1, seen));
    if (value.length > o.maxArray) items.push(`[${value.length - o.maxArray} more items]`);
    return items;
  }
  const out: Record<string, unknown> = {};
  let keys = 0;
  for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
    if (keys >= o.maxKeys) {
      out["[more]"] = `${Object.keys(value as object).length - o.maxKeys} more keys`;
      break;
    }
    keys += 1;
    out[key] =
      isSecretKey(key) && v !== null && v !== undefined ? REDACTED : walk(v, o, depth + 1, seen);
  }
  return out;
}
