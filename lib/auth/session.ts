import type { UserProfile } from "@/lib/domain/types";

/**
 * Session boundary.
 *
 * The MVP demo runs without sign-in. `getSession()` returns a synthetic
 * session derived from `SIFTY_USER_EMAIL` (or the creator email by default).
 * Stage 2 swaps this implementation for cookie-based auth — every other file
 * stays the same.
 */

const CREATOR_EMAIL = (process.env.CREATOR_EMAIL ?? "s.gonzalez.garza@gmail.com").toLowerCase();

export const SESSION_COOKIE_NAME = "sifty_session";

export interface Session {
  user: UserProfile;
  /** When the user's trial began. Used by entitlement derivation. */
  trialStartedAt: string | null;
  subscriptionActive: boolean;
}

export function getCreatorEmail(): string {
  return CREATOR_EMAIL;
}

export function isCreatorEmail(email: string): boolean {
  return email.toLowerCase() === CREATOR_EMAIL;
}

/**
 * Returns the active session.
 *
 * The `req` parameter is read in Stage 2 (cookie-based auth). Returning a
 * non-null bypass session here keeps the single-user demo path intact.
 */
export async function getSession(_req?: Request): Promise<Session | null> {
  return buildBypassSession();
}

export function getSessionSync(): Session | null {
  return buildBypassSession();
}

function buildBypassSession(): Session {
  const email = process.env.SIFTY_USER_EMAIL ?? CREATOR_EMAIL;
  const profile: UserProfile = {
    id: "user_local",
    email,
    displayName: isCreatorEmail(email) ? "Santi" : email.split("@")[0]!,
    isCreator: isCreatorEmail(email),
    createdAt: new Date(0).toISOString(),
  };
  return {
    user: profile,
    trialStartedAt: null,
    subscriptionActive: false,
  };
}
