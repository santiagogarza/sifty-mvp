import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * One-click unsubscribe tokens for digest emails.
 *
 * `userId.signature`, HMAC-SHA256 under `BETTER_AUTH_SECRET`. No expiry:
 * the link in a six-month-old email must still work (RFC 8058 clients
 * POST it without asking). The token only ever turns the email channel
 * off, so a leaked one cannot do anything a user would mind.
 */

function secret(): string {
  const s = process.env.BETTER_AUTH_SECRET;
  if (!s) throw new Error("BETTER_AUTH_SECRET is required to sign unsubscribe links.");
  return s;
}

function sign(userId: string): string {
  return createHmac("sha256", secret()).update(`unsubscribe:${userId}`).digest("base64url");
}

export function createUnsubscribeToken(userId: string): string {
  return `${Buffer.from(userId, "utf8").toString("base64url")}.${sign(userId)}`;
}

export function verifyUnsubscribeToken(token: string | null | undefined): string | null {
  if (!token) return null;
  const dot = token.indexOf(".");
  if (dot <= 0) return null;
  let userId: string;
  try {
    userId = Buffer.from(token.slice(0, dot), "base64url").toString("utf8");
  } catch {
    return null;
  }
  if (!userId) return null;
  const expected = Buffer.from(sign(userId));
  const given = Buffer.from(token.slice(dot + 1));
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  return userId;
}

export function unsubscribeUrl(appUrl: string, userId: string): string {
  return `${appUrl}/api/notifications/unsubscribe?token=${encodeURIComponent(
    createUnsubscribeToken(userId),
  )}`;
}
