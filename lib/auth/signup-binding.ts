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
/** A browser may sign up a few accounts in a row ("Use a different email"); keep the newest. */
const MAX_BINDINGS = 5;
// RFC 6265 cookie-octet; never appears in ids (alnum/_/.) or base64url MACs.
const SEPARATOR = "~";

export function signupBindingValue(userId: string, secret: string): string {
  const mac = createHmac("sha256", secret).update(`signup-binding:${userId}`).digest("base64url");
  return `${userId}.${mac}`;
}

/** Cookie value with `userId` added to whatever bindings the browser already holds. */
export function appendSignupBinding(existing: string | undefined, userId: string, secret: string) {
  const next = signupBindingValue(userId, secret);
  const kept = (existing ? decodeURIComponent(existing).split(SEPARATOR) : [])
    .filter((v) => v && v !== next)
    .slice(-(MAX_BINDINGS - 1));
  return [...kept, next].join(SEPARATOR);
}

export function readSignupBindingCookie(headers: Headers | undefined): string | undefined {
  const raw = headers?.get("cookie");
  if (!raw) return undefined;
  const match = raw.match(
    new RegExp(`(?:^|;\\s*)(?:__Secure-)?${SIGNUP_BINDING_COOKIE.replace(".", "\\.")}=([^;]+)`),
  );
  return match?.[1];
}

export function hasValidSignupBinding(
  headers: Headers | undefined,
  userId: string,
  secret: string,
): boolean {
  const cookie = readSignupBindingCookie(headers);
  if (!cookie) return false;
  const expected = Buffer.from(signupBindingValue(userId, secret));
  return decodeURIComponent(cookie)
    .split(SEPARATOR)
    .some((v) => {
      const presented = Buffer.from(v);
      return presented.length === expected.length && timingSafeEqual(presented, expected);
    });
}
