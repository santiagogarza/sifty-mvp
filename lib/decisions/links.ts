import { isVercelProduction } from "@/lib/env/production-guards";
import { APPROVE_OPTION } from "@/lib/executions/copy";
import { id as makeId } from "@/lib/utils/ids";
import { SignJWT, errors as joseErrors, jwtVerify } from "jose";

/**
 * Signed one-tap links for decisions.
 *
 * A digest email or a push notification cannot assume a session on the
 * device that opens it, so the link itself is the credential: an HS256 JWT
 * under `BETTER_AUTH_SECRET` scoped to one user, one decision, and one
 * action, valid for 24 hours. Single use follows from the decision's own
 * state machine — `open` can only leave once — so a second tap on any link
 * for the same decision lands on "already answered" instead of acting.
 *
 * Actions:
 *   - `open`: deep-link into the inbox with the decision focused. Needs a
 *     session (the app route is behind sign-in); the token only carries the
 *     target.
 *   - `answer` with an `option`: resolve the decision with that option.
 *   - `dismiss`: resolve the decision as dismissed.
 */

export const DECISION_LINK_TTL_SECONDS = 24 * 60 * 60;
const AUDIENCE = "sifty:decision-link";

/** Keyless local dev (`SIFTY_DISABLE_AUTH=1`, no secret) still renders links. */
const DEV_FALLBACK_SECRET = "sifty-dev-decision-links-not-for-production-0000";

export type DecisionLinkAction =
  | { action: "open" }
  | { action: "answer"; option: string }
  | { action: "dismiss" };

export interface DecisionLinkClaims {
  userId: string;
  decisionId: string;
  /** Token id, recorded on the answer for audit. */
  jti: string;
  link: DecisionLinkAction;
}

export type DecisionLinkFailure = "malformed" | "expired" | "invalid";

function secret(): Uint8Array {
  const s = process.env.BETTER_AUTH_SECRET;
  if (s) return new TextEncoder().encode(s);
  if (isVercelProduction()) {
    throw new Error("BETTER_AUTH_SECRET is required to sign decision links.");
  }
  return new TextEncoder().encode(DEV_FALLBACK_SECRET);
}

export async function createDecisionLinkToken(input: {
  userId: string;
  decisionId: string;
  link: DecisionLinkAction;
  now?: Date;
}): Promise<string> {
  const now = input.now ?? new Date();
  const issued = Math.floor(now.getTime() / 1000);
  const claims: Record<string, unknown> = { d: input.decisionId, a: input.link.action };
  if (input.link.action === "answer") claims.o = input.link.option;
  return new SignJWT(claims)
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(input.userId)
    .setAudience(AUDIENCE)
    .setJti(makeId("dlk"))
    .setIssuedAt(issued)
    .setExpirationTime(issued + DECISION_LINK_TTL_SECONDS)
    .sign(secret());
}

export async function verifyDecisionLinkToken(
  token: string | null | undefined,
  now: Date = new Date(),
): Promise<{ ok: true; claims: DecisionLinkClaims } | { ok: false; reason: DecisionLinkFailure }> {
  if (!token || token.length > 2048) return { ok: false, reason: "malformed" };
  try {
    const { payload } = await jwtVerify(token, secret(), {
      audience: AUDIENCE,
      algorithms: ["HS256"],
      currentDate: now,
    });
    const decisionId = payload.d;
    const action = payload.a;
    if (
      typeof payload.sub !== "string" ||
      typeof payload.jti !== "string" ||
      typeof decisionId !== "string" ||
      (action !== "open" && action !== "answer" && action !== "dismiss")
    ) {
      return { ok: false, reason: "malformed" };
    }
    let link: DecisionLinkAction;
    if (action === "answer") {
      if (typeof payload.o !== "string" || !payload.o.trim()) {
        return { ok: false, reason: "malformed" };
      }
      link = { action, option: payload.o };
    } else {
      link = { action };
    }
    return { ok: true, claims: { userId: payload.sub, decisionId, jti: payload.jti, link } };
  } catch (err) {
    if (err instanceof joseErrors.JWTExpired) return { ok: false, reason: "expired" };
    if (err instanceof joseErrors.JOSEError) return { ok: false, reason: "invalid" };
    return { ok: false, reason: "malformed" };
  }
}

/**
 * The links a notification about an approval or a draft review needs:
 * open it, approve it as is, reject it. Edit-then-approve is app-only
 * (the `open` link lands on the card). Same tokens as v1: `approve` is an
 * `answer` with the `Approve` option, `reject` is a `dismiss`.
 */
export async function executionDecisionLinks(
  appUrl: string,
  input: { userId: string; decisionId: string },
): Promise<{ open: string; approve: string; reject: string }> {
  const links = await decisionLinks(appUrl, { ...input, options: [APPROVE_OPTION] });
  return { open: links.open, approve: links.answers[0]!.url, reject: links.dismiss };
}

/** Absolute URL for a one-tap link; `appUrl` has no trailing slash. */
export function decisionLinkUrl(appUrl: string, token: string): string {
  return `${appUrl}/api/decisions/link?token=${encodeURIComponent(token)}`;
}

/**
 * Every link a notification about a decision may need: open it, plus one
 * tap per suggested option and a dismiss. Stable shape for the
 * notifications worker.
 */
export async function decisionLinks(
  appUrl: string,
  input: { userId: string; decisionId: string; options: readonly string[] },
): Promise<{ open: string; dismiss: string; answers: Array<{ option: string; url: string }> }> {
  const base = { userId: input.userId, decisionId: input.decisionId };
  const [open, dismiss, ...answers] = await Promise.all([
    createDecisionLinkToken({ ...base, link: { action: "open" } }),
    createDecisionLinkToken({ ...base, link: { action: "dismiss" } }),
    ...input.options.map((option) =>
      createDecisionLinkToken({ ...base, link: { action: "answer", option } }),
    ),
  ]);
  return {
    open: decisionLinkUrl(appUrl, open!),
    dismiss: decisionLinkUrl(appUrl, dismiss!),
    answers: input.options.map((option, i) => ({
      option,
      url: decisionLinkUrl(appUrl, answers[i]!),
    })),
  };
}
