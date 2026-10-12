import { getDb } from "@/lib/db/client";
import { type Repos, getPersistenceMode, getRepos } from "@/lib/db/repos";
import * as schema from "@/lib/db/schema";
import { isDemoSeedEnabled, seedDemoWorkspaceIfEmpty } from "@/lib/demo/seed-demo";
import { sendTemplate } from "@/lib/email/templates";
import { TRIAL_DAYS, creatorSnapshot, withResolvedTier } from "@/lib/entitlements/entitlements";
import { reportError } from "@/lib/observability/report-error";
import { seedStarterWorkspaceIfEmpty } from "@/lib/onboarding/seed";
import { id as makeId } from "@/lib/utils/ids";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { memoryAdapter } from "better-auth/adapters/memory";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { nextCookies } from "better-auth/next-js";
import { magicLink } from "better-auth/plugins";
import { authAbuseHooks } from "./abuse-hooks";
import { verifyPasswordHash } from "./passwords";
import { isCreatorEmail } from "./session-shared";
import {
  SIGNUP_BINDING_COOKIE,
  SIGNUP_BINDING_MAX_AGE_S,
  appendSignupBinding,
  hasValidSignupBinding,
  readSignupBindingCookie,
} from "./signup-binding";

/**
 * Better Auth instance.
 *
 * One instance per `Repos` instance: in production that is the process-wide
 * Postgres repos (Better Auth reads and writes the same `users`, `sessions`,
 * `accounts`, `verifications` tables through the Drizzle adapter); in tests
 * and keyless local dev it is an in-memory adapter whose user rows are
 * mirrored into the in-memory repos by the `user.create.after` hook, so
 * `getSession()` and every route see the same ids either way.
 *
 * Everything Sifty-specific about an account (creator flag, entitlement,
 * default labels, welcome email) happens in the database hooks below, so
 * email+password, magic link, and Google sign-ups all take the same path.
 */

export const AUTH_COOKIE_PREFIX = "sifty";
export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30;

const ID_PREFIX: Record<string, string> = {
  user: "user",
  users: "user",
  session: "sess",
  sessions: "sess",
  account: "acct",
  accounts: "acct",
  verification: "ver",
  verifications: "ver",
};

export function getAuthSecret(): string {
  const secret = process.env.BETTER_AUTH_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error(
      "BETTER_AUTH_SECRET must be set and at least 32 chars (it replaces AUTH_SECRET). Generate one with `openssl rand -hex 32`.",
    );
  }
  return secret;
}

export function getAuthBaseUrl(): string {
  return (
    process.env.BETTER_AUTH_URL ??
    process.env.NEXT_PUBLIC_APP_URL ??
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000")
  ).replace(/\/$/, "");
}

export function isGoogleAuthEnabled(): boolean {
  return !!process.env.GOOGLE_CLIENT_ID && !!process.env.GOOGLE_CLIENT_SECRET;
}

function trustedOrigins(): string[] {
  const origins = new Set<string>([getAuthBaseUrl()]);
  for (const host of [process.env.VERCEL_URL, process.env.VERCEL_BRANCH_URL]) {
    if (host) origins.add(`https://${host}`);
  }
  return Array.from(origins);
}

function createAuth(repos: Repos) {
  const database =
    getPersistenceMode() === "postgres"
      ? drizzleAdapter(getDb(), {
          provider: "pg",
          schema: {
            users: schema.users,
            sessions: schema.sessions,
            accounts: schema.accounts,
            verifications: schema.verifications,
          },
        })
      : memoryAdapter({ users: [], sessions: [], accounts: [], verifications: [] });

  const google = isGoogleAuthEnabled()
    ? {
        google: {
          clientId: process.env.GOOGLE_CLIENT_ID!,
          clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
          prompt: "select_account" as const,
          // Google can report `email_verified: false` (e.g. some Workspace
          // tenants). Without this, Better Auth would still open a session
          // for the unproven address; with it the account is created
          // unverified and the user gets the normal verification email.
          requireEmailVerification: true,
        },
      }
    : {};

  return betterAuth({
    appName: "Sifty",
    baseURL: getAuthBaseUrl(),
    basePath: "/api/auth",
    secret: getAuthSecret(),
    database,
    trustedOrigins: trustedOrigins(),
    advanced: {
      cookiePrefix: AUTH_COOKIE_PREFIX,
      // Better Auth skips origin/CSRF checks under NODE_ENV=test by default;
      // keep them on so the route tests exercise production behavior.
      disableOriginCheck: false,
      database: {
        generateId: ({ model }) => makeId(ID_PREFIX[model] ?? "id"),
      },
    },
    user: {
      modelName: "users",
      fields: { name: "displayName" },
      additionalFields: {
        isCreator: { type: "boolean", defaultValue: false, input: false, required: false },
      },
    },
    session: {
      modelName: "sessions",
      expiresIn: SESSION_TTL_SECONDS,
      updateAge: 60 * 60 * 24,
    },
    account: { modelName: "accounts" },
    verification: {
      modelName: "verifications",
      // Reset and magic-link tokens are bearer secrets; store only a hash so
      // a database read cannot redeem them.
      storeIdentifier: "hashed",
    },
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 8,
      maxPasswordLength: 200,
      requireEmailVerification: true,
      autoSignIn: false,
      resetPasswordTokenExpiresIn: 60 * 60,
      revokeSessionsOnPasswordReset: true,
      password: { verify: verifyPasswordHash },
      sendResetPassword: async ({ user, url }) => {
        await sendTemplate("password-reset", {
          to: user.email,
          props: { name: user.name, resetUrl: url },
        });
      },
    },
    emailVerification: {
      sendOnSignUp: true,
      // A blocked sign-in (unverified address, incl. accounts migrated from
      // the pre-verification era) re-sends the link instead of dead-ending.
      sendOnSignIn: true,
      autoSignInAfterVerification: true,
      expiresIn: 60 * 60,
      sendVerificationEmail: async ({ user, url }) => {
        await sendTemplate("verify-email", {
          to: user.email,
          props: { name: user.name, verifyUrl: url },
        });
      },
      // First mailbox proof. Unless the link is opened from the browser
      // that chose the password (signup binding cookie), the password and
      // any sessions created before the proof are unproven and removed.
      beforeEmailVerification: async (user, request) => {
        if (user.emailVerified) return;
        // Verification tokens are stateless JWTs keyed by email, so account
        // deletion cannot revoke them. A link minted before this account
        // existed belongs to a previous owner of the address; refuse it
        // before anything below can touch this account's credentials.
        if (tokenPredatesAccount(request, user.createdAt)) {
          throw new APIError("UNAUTHORIZED", {
            message:
              "This verification link was issued before this account existed. Request a new one.",
          });
        }
        if (hasValidSignupBinding(request?.headers, user.id, getAuthSecret())) return;
        await revokeUnprovenCredentials(user.id);
      },
      afterEmailVerification: async (user) => {
        await sendWelcome(user);
      },
    },
    socialProviders: google,
    databaseHooks: {
      user: {
        create: {
          before: async (user) => ({
            data: {
              ...user,
              name: user.name?.trim() || user.email.split("@")[0]!,
              isCreator: isVerifiedCreator(user),
            },
          }),
          after: async (user, ctx) => {
            await onUserCreated(repos, user);
            if (ctx && !user.emailVerified) setSignupBinding(ctx, user.id);
          },
        },
        update: {
          // Every path that proves the mailbox ends in an `emailVerified`
          // update (verify-email link, magic link on an unverified account,
          // OAuth linking a verified address). The creator tier is granted
          // here and nowhere earlier.
          after: async (user) => {
            const u = user as AuthUser;
            if (u.isCreator === true || !isVerifiedCreator(u)) return;
            await promoteVerifiedCreator(repos, u);
          },
        },
      },
    },
    hooks: {
      before: authAbuseHooks,
      // A correct password on a not-yet-verified account (e.g. a user
      // migrated from the pre-verification era) proves the password to this
      // browser too, so the re-sent verification link keeps it.
      after: createAuthMiddleware(async (ctx) => {
        if (ctx.path !== "/sign-in/email") return;
        const returned = ctx.context.returned;
        if (!(returned instanceof APIError) || returned.body?.code !== "EMAIL_NOT_VERIFIED") return;
        const email = (ctx.body as { email?: string } | undefined)?.email;
        if (!email) return;
        const found = await ctx.context.internalAdapter.findUserByEmail(email);
        if (found) setSignupBinding(ctx, found.user.id);
      }),
    },
    plugins: [
      magicLink({
        expiresIn: 60 * 5,
        storeToken: "hashed",
        // Deliberately no special case for unverified accounts: Better Auth
        // treats the magic link as the first proof of mailbox ownership and
        // strips any password or session set before it (GHSA-qq9h-g4jm-xgf3).
        // Rerouting to a verification email would let whoever registered the
        // address first keep their password on the owner's account.
        sendMagicLink: async ({ email, url }) => {
          await sendTemplate("magic-link", { to: email, props: { magicLinkUrl: url } });
        },
      }),
      nextCookies(),
    ],
    onAPIError: {
      onError: (error) => {
        reportError(error, { area: "auth.api" });
      },
    },
  });
}

type AuthUser = {
  id: string;
  email: string;
  name: string;
  emailVerified: boolean;
  createdAt: Date;
} & Record<string, unknown>;

/**
 * The creator tier requires both the address and proof of the mailbox.
 * Matching `CREATOR_EMAIL` alone is not enough: anyone can type that
 * address into the sign-up form, and an OAuth provider can assert it
 * unverified. Until `emailVerified` is true the account is an ordinary
 * trial account, and it is promoted by the `user.update.after` hook.
 */
function isVerifiedCreator(user: Pick<AuthUser, "email" | "emailVerified">): boolean {
  return user.emailVerified === true && isCreatorEmail(user.email);
}

/**
 * Runs once per new account, whatever the sign-up method. Mirrors the row
 * into the repos when they are not the same store as Better Auth's, grants
 * the creator or trial entitlement, and seeds the workspace.
 */
async function onUserCreated(repos: Repos, user: AuthUser): Promise<void> {
  const isCreator = isVerifiedCreator(user);
  const existing = await repos.users.getById(user.id);
  if (!existing) {
    await repos.users.create({
      id: user.id,
      email: user.email,
      displayName: user.name,
      isCreator,
    });
  }

  if (isCreator) {
    await repos.entitlements.upsert(user.id, creatorSnapshot());
  } else {
    await repos.entitlements.startTrialIfMissing(user.id, TRIAL_DAYS);
  }

  if (isDemoSeedEnabled()) {
    await seedDemoWorkspaceIfEmpty(repos, user.id);
  } else {
    await seedStarterWorkspaceIfEmpty(repos, user.id);
  }

  // OAuth sign-ups arrive verified and never pass through
  // `afterEmailVerification`, so welcome them here.
  if (user.emailVerified) await sendWelcome(user);
}

/**
 * First verification of the creator address: flag the account in both
 * stores and replace the trial with the creator entitlement, keeping any
 * Stripe facts already recorded. Idempotent; the Better Auth write re-enters
 * the `user.update.after` hook, which sees `isCreator` set and returns.
 */
async function promoteVerifiedCreator(repos: Repos, user: AuthUser): Promise<void> {
  const ctx = await getAuth().$context;
  await ctx.internalAdapter.updateUser(user.id, { isCreator: true });
  await repos.users.setCreator(user.id, true);
  const existing = await repos.entitlements.get(user.id);
  await repos.entitlements.upsert(user.id, withResolvedTier(existing ?? creatorSnapshot(), true));
}

function setSignupBinding(
  ctx: {
    headers?: Headers;
    setCookie: (name: string, value: string, opts?: Record<string, unknown>) => unknown;
  },
  userId: string,
): void {
  const secure = getAuthBaseUrl().startsWith("https://");
  ctx.setCookie(
    secure ? `__Secure-${SIGNUP_BINDING_COOKIE}` : SIGNUP_BINDING_COOKIE,
    appendSignupBinding(readSignupBindingCookie(ctx.headers), userId, getAuthSecret()),
    { httpOnly: true, sameSite: "lax", secure, path: "/", maxAge: SIGNUP_BINDING_MAX_AGE_S },
  );
}

/** `iat` is whole seconds; the sign-up link is minted in the same second the row is created. */
const TOKEN_IAT_GRACE_MS = 2_000;

function tokenPredatesAccount(request: Request | undefined, createdAt: Date | string): boolean {
  if (!request) return false;
  const token = new URL(request.url).searchParams.get("token");
  if (!token) return false;
  const iat = jwtIssuedAt(token);
  if (iat === null) return false;
  return iat * 1000 + TOKEN_IAT_GRACE_MS < new Date(createdAt).getTime();
}

/** `iat` from a JWT the route has already signature-checked; null when unreadable. */
function jwtIssuedAt(token: string): number | null {
  const payload = token.split(".")[1];
  if (!payload) return null;
  try {
    const json = Buffer.from(payload, "base64url").toString("utf8");
    const { iat } = JSON.parse(json) as { iat?: unknown };
    return typeof iat === "number" ? iat : null;
  } catch {
    return null;
  }
}

/** Delete credential accounts and every session of a user whose address was never proven. */
async function revokeUnprovenCredentials(userId: string): Promise<void> {
  const ctx = await getAuth().$context;
  const accounts = await ctx.internalAdapter.findAccounts(userId);
  for (const account of accounts) {
    if (account.providerId === "credential") await ctx.internalAdapter.deleteAccount(account.id);
  }
  await ctx.internalAdapter.deleteUserSessions(userId);
}

/**
 * Remove a user's Better Auth identity: sessions, credential and OAuth
 * accounts, and the user row itself. On Postgres the repos' `users.delete`
 * already cascaded through these tables, so this is what keeps the
 * in-memory adapter (tests, keyless dev) in step; both paths end with no
 * session that can still resolve for the id.
 */
export async function deleteAuthIdentity(userId: string, email: string): Promise<void> {
  const ctx = await getAuth().$context;
  await ctx.internalAdapter.deleteUser(userId);
  await ctx.internalAdapter.deleteUserSessions(userId);
  // Verification tokens are not keyed by user id: a reset token stores the
  // user id as its value, a magic link stores the address (as typed) inside
  // a JSON value. Neither would cascade, and either could act on whoever
  // registers the address next. Magic links are matched by parsing the
  // JSON, not by LIKE: the address is user input and `_`/`%` are wildcards.
  await ctx.adapter.deleteMany({
    model: "verification",
    where: [{ field: "value", value: userId, operator: "eq" }],
  });
  // Identifiers are stored hashed (`storeIdentifier: "hashed"`), so the
  // purpose prefix cannot be filtered on; bound the read by lifetime and
  // page size instead. Live rows are short-lived tokens (minutes to an
  // hour), so this stays a small scan.
  const wanted = email.toLowerCase();
  const pageSize = 500;
  for (let page = 0; page < MAX_VERIFICATION_PAGES; page++) {
    const rows = await ctx.adapter.findMany<{ id: string; value: string }>({
      model: "verification",
      where: [{ field: "expiresAt", value: new Date(), operator: "gt" }],
      sortBy: { field: "id", direction: "asc" },
      limit: pageSize,
      offset: page * pageSize,
    });
    for (const row of rows) {
      if (tokenEmail(row.value) !== wanted) continue;
      await ctx.adapter.delete({ model: "verification", where: [{ field: "id", value: row.id }] });
    }
    if (rows.length < pageSize) break;
  }
}

/** 500 rows × 20 pages; far beyond the live tokens short TTLs can accumulate. */
const MAX_VERIFICATION_PAGES = 20;

/** The address inside a JSON verification value, whatever else it carries. */
function tokenEmail(value: string): string | null {
  if (!value.startsWith("{")) return null;
  try {
    const parsed = JSON.parse(value) as { email?: unknown };
    return typeof parsed.email === "string" ? parsed.email.toLowerCase() : null;
  } catch {
    return null;
  }
}

/** The session cookies Better Auth sets, so a route can expire them on its own response. */
export async function sessionCookieNames(): Promise<
  Array<{ name: string; attributes: { path?: string; secure?: boolean; httpOnly?: boolean } }>
> {
  const { sessionToken, sessionData, dontRememberToken } = (await getAuth().$context).authCookies;
  return [sessionToken, sessionData, dontRememberToken];
}

async function sendWelcome(user: { id: string; email: string; name: string }): Promise<void> {
  const appUrl = getAuthBaseUrl();
  try {
    await sendTemplate("welcome", {
      to: user.email,
      props: { name: user.name, appUrl, unsubscribeUrl: `${appUrl}/settings/notifications` },
      idempotencyKey: `welcome:${user.id}`,
    });
  } catch (err) {
    // Already reported by sendEmail; a failed welcome must not fail sign-up.
    void err;
  }
}

export type Auth = ReturnType<typeof createAuth>;

// Keyed by repos instance so `setReposForTesting()` yields a fresh auth, and
// pinned on `globalThis` so `next dev`'s per-bundle module copies share one
// instance (and one memory adapter) across route handlers and layouts.
const globalStore = globalThis as typeof globalThis & { __siftyAuth?: WeakMap<Repos, Auth> };
if (!globalStore.__siftyAuth) globalStore.__siftyAuth = new WeakMap<Repos, Auth>();
const instances = globalStore.__siftyAuth;

export function getAuth(): Auth {
  const repos = getRepos();
  let auth = instances.get(repos);
  if (!auth) {
    auth = createAuth(repos);
    instances.set(repos, auth);
  }
  return auth;
}
