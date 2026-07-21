import { type Repos, getRepos } from "@/lib/db/repos";
import {
  isDemoSeedEnabled,
  seedDefaultLabels,
  seedDemoWorkspaceIfEmpty,
} from "@/lib/demo/seed-demo";
import type { UserProfile } from "@/lib/domain/types";
import { TRIAL_DAYS } from "@/lib/entitlements/entitlements";
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
 * bypass session without requiring sign-in. The bypass user is a real row
 * in the configured store (created on first touch) so that task/memory
 * writes — which carry foreign keys to `users` — work identically with and
 * without auth. This is the local-dev escape hatch; it is *off* by default
 * in production.
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
    if (isAuthBypassMode()) return getBypassSession();
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

/**
 * One bootstrap per repos instance: the bypass user is created (or found by
 * email), entitled, and seeded exactly once per process. Keyed by the repos
 * object so `setReposForTesting()` gets a fresh bootstrap.
 */
const bypassBootstraps = new WeakMap<Repos, Promise<Session>>();

function getBypassSession(): Promise<Session> {
  const repos = getRepos();
  let bootstrap = bypassBootstraps.get(repos);
  if (!bootstrap) {
    bootstrap = bootstrapBypassSession(repos);
    bypassBootstraps.set(repos, bootstrap);
    // Never cache a rejection: a transient DB failure would otherwise
    // poison every bypass request this instance serves.
    bootstrap.catch(() => bypassBootstraps.delete(repos));
  }
  return bootstrap;
}

async function bootstrapBypassSession(repos: Repos): Promise<Session> {
  const email = (process.env.SIFTY_USER_EMAIL ?? CREATOR_EMAIL).toLowerCase();
  const isCreator = isCreatorEmail(email);

  const existing = await repos.users.getByEmail(email);
  let user: UserProfile;
  if (existing) {
    const { passwordHash: _ph, ...profile } = existing;
    user = profile;
  } else {
    user = await repos.users
      .create({
        id: "user_local",
        email,
        passwordHash: null,
        displayName: isCreator ? "Santi" : email.split("@")[0]!,
        isCreator,
      })
      .catch(async () => {
        // A concurrent instance won the create race — adopt its row.
        const raced = await repos.users.getByEmail(email);
        if (raced) {
          const { passwordHash: _ph, ...profile } = raced;
          return profile;
        }
        // The fixed id is taken by a *different* email (SIFTY_USER_EMAIL
        // changed against a persistent DB): fall back to a generated id.
        return repos.users.create({
          email,
          passwordHash: null,
          displayName: isCreator ? "Santi" : email.split("@")[0]!,
          isCreator,
        });
      });
  }

  if (isCreator) {
    await repos.entitlements.upsert(user.id, {
      tier: "creator",
      trialStartedAt: null,
      trialEndsAt: null,
      subscriptionActive: true,
      stripeCustomerId: null,
      stripeSubscriptionId: null,
      stripeStatus: null,
      currentPeriodEnd: null,
      aiRunsLimitDay: 1_000_000,
    });
  } else {
    await repos.entitlements.startTrialIfMissing(user.id, TRIAL_DAYS);
  }

  if (isDemoSeedEnabled()) {
    await seedDemoWorkspaceIfEmpty(repos, user.id);
  } else {
    await seedDefaultLabels(repos, user.id);
  }

  const ent = await repos.entitlements.get(user.id);
  return {
    user,
    trialStartedAt: ent?.trialStartedAt ?? null,
    subscriptionActive: !!ent?.subscriptionActive,
    sessionId: null,
  };
}
