import { getRepos } from "@/lib/db/repos";
import type { UserProfile } from "@/lib/domain/types";
import { cookies } from "next/headers";
import { verifySessionToken } from "./jwt";
import { CREATOR_EMAIL, SESSION_COOKIE_NAME, isCreatorEmail } from "./session-shared";

/**
 * Session boundary.
 *
 * Reads the `sifty_session` JWT cookie, verifies it, loads the session row
 * (so we can revoke), and returns the user profile + entitlement snapshot
 * the route handlers care about.
 *
 * If `SIFTY_DISABLE_AUTH=1` (and only then), `getSession()` returns a
 * synthetic creator session. This is the local-dev escape hatch that
 * keeps the UI usable without going through sign-up — it is *off* by
 * default in production.
 */

export { SESSION_COOKIE_NAME, isCreatorEmail };

export function getCreatorEmail(): string {
  return CREATOR_EMAIL;
}

export interface Session {
  user: UserProfile;
  trialStartedAt: string | null;
  subscriptionActive: boolean;
  /** Raw session id for sign-out. */
  sessionId: string | null;
}

export async function getSession(req?: Request): Promise<Session | null> {
  const token = await readSessionCookie(req);

  if (!token) {
    if (isAuthBypassMode()) return buildBypassSession();
    return null;
  }

  const payload = await verifySessionToken(token).catch(() => null);
  if (!payload) return null;

  const repos = getRepos();
  const row = await repos.sessions.get(payload.sid);
  if (!row || row.userId !== payload.sub) return null;

  const user = await repos.users.getById(payload.sub);
  if (!user) return null;

  const ent = await repos.entitlements.get(user.id);
  return {
    user,
    trialStartedAt: ent?.trialStartedAt ?? null,
    subscriptionActive: !!ent?.subscriptionActive,
    sessionId: payload.sid,
  };
}

function isAuthBypassMode(): boolean {
  return process.env.SIFTY_DISABLE_AUTH === "1";
}

async function readSessionCookie(req?: Request): Promise<string | null> {
  if (req) {
    const header = req.headers.get("cookie");
    if (!header) return null;
    const match = header.match(new RegExp(`(?:^|;\\s*)${SESSION_COOKIE_NAME}=([^;]+)`));
    return match?.[1] ?? null;
  }
  try {
    const store = await cookies();
    const c = store.get(SESSION_COOKIE_NAME);
    return c?.value ?? null;
  } catch {
    return null;
  }
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
    subscriptionActive: profile.isCreator,
    sessionId: null,
  };
}
