import { type Repos, getRepos } from "@/lib/db/repos";
import {
  isDemoSeedEnabled,
  seedDefaultLabels,
  seedDemoWorkspaceIfEmpty,
} from "@/lib/demo/seed-demo";
import type { UserProfile } from "@/lib/domain/types";
import { TRIAL_DAYS } from "@/lib/entitlements/entitlements";
import { headers } from "next/headers";
import { getAuth } from "./auth";
import { CREATOR_EMAIL, isCreatorEmail } from "./session-shared";

/**
 * Session boundary.
 *
 * Asks Better Auth to resolve the session cookie (signature + session row,
 * so revocation is immediate), then returns the user profile + entitlement
 * snapshot the route handlers care about. The `Session` shape and
 * `getSession()` signature are unchanged from the hand-rolled auth, so API
 * routes and pages did not have to change.
 *
 * If `SIFTY_DISABLE_AUTH=1` (and only then), `getSession()` returns a
 * bypass session without requiring sign-in. The bypass user is a real row
 * in the configured store (created on first touch) so that task/memory
 * writes — which carry foreign keys to `users` — work identically with and
 * without auth. This is the local-dev escape hatch; it is *off* by default
 * in production.
 */

export { isCreatorEmail };

export function getCreatorEmail(): string {
  return CREATOR_EMAIL;
}

export interface Session {
  user: UserProfile;
  trialStartedAt: string | null;
  subscriptionActive: boolean;
  /** Raw session id for sign-out; null for the auth-bypass session. */
  sessionId: string | null;
}

export async function getSession(req?: Request): Promise<Session | null> {
  const requestHeaders = await resolveHeaders(req);
  const resolved = requestHeaders
    ? await getAuth()
        .api.getSession({ headers: requestHeaders })
        .catch(() => null)
    : null;

  if (!resolved) {
    if (isAuthBypassMode()) return getBypassSession();
    return null;
  }

  const repos = getRepos();
  const user =
    (await repos.users.getById(resolved.user.id)) ??
    ({
      id: resolved.user.id,
      email: resolved.user.email,
      displayName: resolved.user.name,
      isCreator: isCreatorEmail(resolved.user.email),
      createdAt: new Date(resolved.user.createdAt).toISOString(),
    } satisfies UserProfile);

  const ent = await repos.entitlements.get(user.id);
  return {
    user,
    trialStartedAt: ent?.trialStartedAt ?? null,
    subscriptionActive: !!ent?.subscriptionActive,
    sessionId: resolved.session.id,
  };
}

function isAuthBypassMode(): boolean {
  return process.env.SIFTY_DISABLE_AUTH === "1";
}

async function resolveHeaders(req?: Request): Promise<Headers | null> {
  if (req) return req.headers;
  try {
    return await headers();
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
    user = existing;
  } else {
    user = await repos.users
      .create({
        id: "user_local",
        email,
        displayName: isCreator ? "Santi" : email.split("@")[0]!,
        isCreator,
      })
      .catch(async () => {
        // A concurrent instance won the create race — adopt its row.
        const raced = await repos.users.getByEmail(email);
        if (raced) return raced;
        // The fixed id is taken by a *different* email (SIFTY_USER_EMAIL
        // changed against a persistent DB): fall back to a generated id.
        return repos.users.create({
          email,
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
