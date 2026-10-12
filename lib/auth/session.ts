import { type Repos, getRepos } from "@/lib/db/repos";
import type { EntitlementSnapshot } from "@/lib/db/repos/types";
import {
  isDemoSeedEnabled,
  seedDefaultLabels,
  seedDemoWorkspaceIfEmpty,
} from "@/lib/demo/seed-demo";
import type { UserProfile } from "@/lib/domain/types";
import { TRIAL_DAYS, creatorSnapshot, withResolvedTier } from "@/lib/entitlements/entitlements";
import { demoFlagEnabled } from "@/lib/env/production-guards";
import { getSessionCookie } from "better-auth/cookies";
import { headers } from "next/headers";
import { AUTH_COOKIE_PREFIX, type Auth, getAuth } from "./auth";
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
  /** Persisted billing facts; `deriveEntitlement()` turns them into caps. */
  entitlement: EntitlementSnapshot | null;
  /** Raw session id for sign-out; null for the auth-bypass session. */
  sessionId: string | null;
}

export async function getSession(req?: Request): Promise<Session | null> {
  const requestHeaders = await resolveHeaders(req);
  const resolved = requestHeaders ? await resolveAuthSession(requestHeaders) : null;

  if (!resolved) {
    if (isAuthBypassMode()) return getBypassSession();
    return null;
  }

  const repos = getRepos();
  // The fallback profile (row not mirrored into the repos) takes the creator
  // flag from Better Auth's user, which is only set once the address is
  // verified. Deriving it from the email here would skip that proof.
  const user =
    (await repos.users.getById(resolved.user.id)) ??
    ({
      id: resolved.user.id,
      email: resolved.user.email,
      displayName: resolved.user.name,
      isCreator: resolved.user.isCreator === true,
      createdAt: new Date(resolved.user.createdAt).toISOString(),
    } satisfies UserProfile);

  const entitlement = await repos.entitlements.get(user.id);
  return { user, entitlement, sessionId: resolved.session.id };
}

function isAuthBypassMode(): boolean {
  return demoFlagEnabled("SIFTY_DISABLE_AUTH");
}

type ResolvedAuthSession = Awaited<ReturnType<Auth["api"]["getSession"]>>;

/**
 * Only touches Better Auth when a Sifty session cookie is present, so the
 * keyless `SIFTY_DISABLE_AUTH=1` setup never needs `BETTER_AUTH_SECRET`.
 * With bypass off, a missing secret still fails loudly.
 */
async function resolveAuthSession(requestHeaders: Headers): Promise<ResolvedAuthSession> {
  if (!getSessionCookie(requestHeaders, { cookiePrefix: AUTH_COOKIE_PREFIX })) return null;
  let auth: Auth;
  try {
    auth = getAuth();
  } catch (err) {
    if (isAuthBypassMode()) return null;
    throw err;
  }
  return auth.api.getSession({ headers: requestHeaders }).catch(() => null);
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
 * object so `setReposForTesting()` gets a fresh bootstrap. Only the user is
 * memoized; the entitlement is re-read per request so a checkout or invite
 * redemption shows up without a restart.
 */
const bypassBootstraps = new WeakMap<Repos, Promise<UserProfile>>();

async function getBypassSession(): Promise<Session> {
  const repos = getRepos();
  let bootstrap = bypassBootstraps.get(repos);
  if (!bootstrap) {
    bootstrap = bootstrapBypassUser(repos);
    bypassBootstraps.set(repos, bootstrap);
    // Never cache a rejection: a transient DB failure would otherwise
    // poison every bypass request this instance serves.
    bootstrap.catch(() => bypassBootstraps.delete(repos));
  }
  const user = await bootstrap;
  const entitlement = await repos.entitlements.get(user.id);
  return { user, entitlement, sessionId: null };
}

async function bootstrapBypassUser(repos: Repos): Promise<UserProfile> {
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
    const existing = await repos.entitlements.get(user.id);
    await repos.entitlements.upsert(user.id, withResolvedTier(existing ?? creatorSnapshot(), true));
  } else {
    await repos.entitlements.startTrialIfMissing(user.id, TRIAL_DAYS);
  }

  if (isDemoSeedEnabled()) {
    await seedDemoWorkspaceIfEmpty(repos, user.id);
  } else {
    await seedDefaultLabels(repos, user.id);
  }

  return user;
}
