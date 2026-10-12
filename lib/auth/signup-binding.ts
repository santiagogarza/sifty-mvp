import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Signup-browser binding.
 *
 * A verification link is a bearer token delivered to a mailbox. If someone
 * registers another person's address with a password, the owner opening
 * the link would otherwise confirm an account the attacker can sign in to.
 *
 * The browser that chose the password gets an httpOnly cookie bound to the
 * user id. When the verification link is opened from that browser, the
 * password is proven and kept. Opened anywhere else, the credential and any
 * pre-proof sessions are stripped first (same rule Better Auth applies to
 * magic links), and the owner sets a password through the reset flow.
 */

export const SIGNUP_BINDING_COOKIE = "sifty.signup_binding";
export const SIGNUP_BINDING_MAX_AGE_S = 60 * 60;

export function signupBindingValue(userId: string, secret: string): string {
  const mac = createHmac("sha256", secret).update(`signup-binding:${userId}`).digest("base64url");
  return `${userId}.${mac}`;
}

export function hasValidSignupBinding(
  headers: Headers | undefined,
  userId: string,
  secret: string,
): boolean {
  const raw = headers?.get("cookie");
  if (!raw) return false;
  const match = raw.match(
    new RegExp(`(?:^|;\\s*)(?:__Secure-)?${SIGNUP_BINDING_COOKIE.replace(".", "\\.")}=([^;]+)`),
  );
  if (!match) return false;
  const presented = Buffer.from(decodeURIComponent(match[1]!));
  const expected = Buffer.from(signupBindingValue(userId, secret));
  return presented.length === expected.length && timingSafeEqual(presented, expected);
}
