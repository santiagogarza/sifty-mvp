/**
 * VAPID configuration check. Dependency-free on purpose: the production
 * boot guard (`lib/env/production-guards.ts`) runs in the Edge middleware
 * bundle and must not pull `web-push` in.
 */

export interface PushConfig {
  publicKey: string;
  privateKey: string;
  /** `mailto:` or `https:` URL push services may contact about abuse. */
  subject: string;
}

export class PushMisconfiguredError extends Error {
  constructor(missing: string[]) {
    super(
      `Web Push is partially configured: ${missing.join(", ")} missing. Set VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, and VAPID_SUBJECT together (generate a pair with \`npx web-push generate-vapid-keys\`), or unset all three to disable push.`,
    );
    this.name = "PushMisconfiguredError";
  }
}

/**
 * `null` when none of the three variables is set (push off), the config
 * when all are valid, or an error describing the mistake.
 */
export function inspectPushEnv(
  env: Record<string, string | undefined> = process.env,
): PushConfig | Error | null {
  const publicKey = env.VAPID_PUBLIC_KEY?.trim() || "";
  const privateKey = env.VAPID_PRIVATE_KEY?.trim() || "";
  const subject = env.VAPID_SUBJECT?.trim() || "";
  if (!publicKey && !privateKey && !subject) return null;
  const missing = [
    !publicKey && "VAPID_PUBLIC_KEY",
    !privateKey && "VAPID_PRIVATE_KEY",
    !subject && "VAPID_SUBJECT",
  ].filter((x): x is string => typeof x === "string");
  if (missing.length) return new PushMisconfiguredError(missing);
  if (!/^(mailto:|https:\/\/)/.test(subject)) {
    return new Error("VAPID_SUBJECT must be a mailto: address or an https: URL.");
  }
  return { publicKey, privateKey, subject };
}
