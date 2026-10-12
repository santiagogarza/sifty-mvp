import { reportError } from "@/lib/observability/report-error";
import { checkBotId } from "botid/server";
import { NextResponse } from "next/server";

/**
 * Vercel BotID on the two endpoints a bot would farm: sign-up and invite
 * redemption. The client half (`BotIdClient` in `app/layout.tsx`) attaches
 * a challenge token to requests for the paths in `./botid-routes.ts`; the
 * server half classifies the request from that token.
 *
 * `checkBotId` only has what it needs on a Vercel deployment (request
 * context + OIDC token), so everywhere else — local dev, `next start`,
 * tests, CI — this module answers "human" without calling it. If the check
 * itself fails on Vercel the request is let through and the failure is
 * reported: a classifier outage must not lock out sign-ups.
 *
 * `SIFTY_DISABLE_BOTID=1` turns the check off on Vercel too (escape hatch
 * for false positives).
 */

export { BOTID_PROTECTED_ROUTES } from "./botid-routes";

export interface BotVerdict {
  isBot: boolean;
  /** Where the verdict came from; useful in logs. */
  source: "botid" | "inactive" | "error" | "timeout" | "test";
}

/**
 * Deadline for the classifier round-trip. `checkBotId` takes no abort
 * signal, so a hung classifier is abandoned (fail open, reported) rather
 * than holding the sign-up invocation until the platform kills it.
 */
export const BOTID_TIMEOUT_MS = 3000;

let testOverride: BotVerdict | null = null;

export function isBotIdActive(): boolean {
  return (
    process.env.VERCEL === "1" &&
    process.env.NODE_ENV === "production" &&
    process.env.SIFTY_DISABLE_BOTID !== "1"
  );
}

export async function verifyNotBot(area: string): Promise<BotVerdict> {
  if (testOverride) return testOverride;
  if (!isBotIdActive()) return { isBot: false, source: "inactive" };
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<"timeout">((resolve) => {
    timer = setTimeout(() => resolve("timeout"), BOTID_TIMEOUT_MS);
  });
  try {
    const result = await Promise.race([checkBotId(), deadline]);
    if (result === "timeout") {
      reportError(new Error(`BotID check timed out after ${BOTID_TIMEOUT_MS}ms`), {
        area: `botid.${area}`,
      });
      return { isBot: false, source: "timeout" };
    }
    return { isBot: result.isBot, source: "botid" };
  } catch (err) {
    reportError(err, { area: `botid.${area}` });
    return { isBot: false, source: "error" };
  } finally {
    clearTimeout(timer);
  }
}

export function botDeniedResponse(): NextResponse {
  return NextResponse.json(
    { error: "Automated requests are not allowed here.", code: "bot_detected" },
    { status: 403 },
  );
}

/** Test-only: force a verdict (pass `null` to clear). */
export function setBotVerdictForTesting(verdict: BotVerdict | null): void {
  testOverride = verdict;
}
