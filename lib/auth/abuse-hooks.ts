import { verifyNotBot } from "@/lib/abuse/botid";
import { buildRateLimitKey, consumeToken, rateLimitResponseInit } from "@/lib/ratelimit/limiter";
import { AUTH_EMAIL_POLICY } from "@/lib/ratelimit/policies";
import { APIError, createAuthMiddleware } from "better-auth/api";

/**
 * Abuse controls on Better Auth's own endpoints, replacing what the
 * hand-rolled `/api/auth/sign-in` and `/sign-up` handlers did:
 *
 * - Per-email rate limit (same `consumeToken` store as every other route,
 *   so it is durable whenever Redis is configured) on every endpoint that
 *   takes an email: a password can only be guessed a few times a minute
 *   for one mailbox from anywhere, and reset / magic-link mail cannot be
 *   used to flood an inbox. The per-IP limit for `POST /api/auth/*` lives
 *   in `middleware.ts`.
 * - Vercel BotID on sign-up.
 */

const EMAIL_LIMITED_PATHS = new Set([
  "/sign-up/email",
  "/sign-in/email",
  "/sign-in/magic-link",
  "/request-password-reset",
  "/send-verification-email",
]);

export const RATE_LIMIT_MESSAGE = "Too many attempts. Try again in a minute.";

export const authAbuseHooks = createAuthMiddleware(async (ctx) => {
  if (!EMAIL_LIMITED_PATHS.has(ctx.path)) return;
  const email = (ctx.body as { email?: unknown } | undefined)?.email;
  if (typeof email !== "string" || !email) return;

  const limit = await consumeToken(
    buildRateLimitKey("auth", "subject", email.trim().toLowerCase()),
    AUTH_EMAIL_POLICY,
  );
  if (!limit.ok) {
    const init = rateLimitResponseInit(limit);
    throw new APIError(
      "TOO_MANY_REQUESTS",
      { message: RATE_LIMIT_MESSAGE, code: "rate_limited" },
      init.headers,
    );
  }

  if (ctx.path === "/sign-up/email") {
    const bot = await verifyNotBot("auth.sign-up");
    if (bot.isBot) {
      throw new APIError("FORBIDDEN", {
        message: "Automated requests are not allowed here.",
        code: "bot_detected",
      });
    }
  }
});
