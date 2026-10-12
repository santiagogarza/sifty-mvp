import { getDb } from "@/lib/db/client";
import { type Repos, getPersistenceMode, getRepos } from "@/lib/db/repos";
import * as schema from "@/lib/db/schema";
import {
  isDemoSeedEnabled,
  seedDefaultLabels,
  seedDemoWorkspaceIfEmpty,
} from "@/lib/demo/seed-demo";
import { sendTemplate } from "@/lib/email/templates";
import { TRIAL_DAYS } from "@/lib/entitlements/entitlements";
import { reportError } from "@/lib/observability/report-error";
import { id as makeId } from "@/lib/utils/ids";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { memoryAdapter } from "better-auth/adapters/memory";
import { sendVerificationEmailFn } from "better-auth/api";
import { nextCookies } from "better-auth/next-js";
import { magicLink } from "better-auth/plugins";
import { verifyPasswordHash } from "./passwords";
import { isCreatorEmail } from "./session-shared";

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
    verification: { modelName: "verifications" },
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
      autoSignInAfterVerification: true,
      expiresIn: 60 * 60,
      sendVerificationEmail: async ({ user, url }) => {
        await sendTemplate("verify-email", {
          to: user.email,
          props: { name: user.name, verifyUrl: url },
        });
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
              isCreator: isCreatorEmail(user.email),
            },
          }),
          after: async (user) => {
            await onUserCreated(repos, user);
          },
        },
      },
    },
    plugins: [
      magicLink({
        expiresIn: 60 * 5,
        sendMagicLink: async ({ email, url }, ctx) => {
          // Verifying a magic link on an unverified account deletes all of its
          // linked accounts, including the password chosen at sign-up. Send the
          // verification email instead: it proves the mailbox and keeps them.
          const existing = ctx ? await ctx.context.internalAdapter.findUserByEmail(email) : null;
          if (ctx && existing && !existing.user.emailVerified) {
            await sendVerificationEmailFn(ctx, existing.user);
            return;
          }
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
 * Runs once per new account, whatever the sign-up method. Mirrors the row
 * into the repos when they are not the same store as Better Auth's, grants
 * the creator or trial entitlement, and seeds the workspace.
 */
async function onUserCreated(repos: Repos, user: AuthUser): Promise<void> {
  const isCreator = user.isCreator === true || isCreatorEmail(user.email);
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

  // OAuth sign-ups arrive verified and never pass through
  // `afterEmailVerification`, so welcome them here.
  if (user.emailVerified) await sendWelcome(user);
}

async function sendWelcome(user: { id: string; email: string; name: string }): Promise<void> {
  const appUrl = getAuthBaseUrl();
  try {
    await sendTemplate("welcome", {
      to: user.email,
      props: { name: user.name, appUrl, unsubscribeUrl: `${appUrl}/settings#notifications` },
      idempotencyKey: `welcome:${user.id}`,
    });
  } catch (err) {
    // Already reported by sendEmail; a failed welcome must not fail sign-up.
    void err;
  }
}

const instances = new WeakMap<Repos, ReturnType<typeof createAuth>>();

export function getAuth(): ReturnType<typeof createAuth> {
  const repos = getRepos();
  let auth = instances.get(repos);
  if (!auth) {
    auth = createAuth(repos);
    instances.set(repos, auth);
  }
  return auth;
}

export type Auth = ReturnType<typeof createAuth>;
