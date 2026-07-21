import { signSessionToken } from "@/lib/auth/jwt";
import { hashPassword, verifyPassword } from "@/lib/auth/passwords";
import { getRepos } from "@/lib/db/repos";
import {
  isDemoSeedEnabled,
  seedDefaultLabels,
  seedDemoWorkspaceIfEmpty,
} from "@/lib/demo/seed-demo";
import type { UserProfile } from "@/lib/domain/types";
import { TRIAL_DAYS } from "@/lib/entitlements/entitlements";
import { isCreatorEmail } from "./session-shared";

/**
 * Auth service — sign-up, sign-in, sign-out helpers used by the auth route
 * handlers. Returns the cookie value to set on the response; the route
 * handler is responsible for actually writing the cookie.
 */

export interface AuthError {
  code: "invalid_credentials" | "email_taken" | "weak_password" | "invalid_input";
  message: string;
}

const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days

export interface AuthSuccess {
  user: UserProfile;
  cookie: { name: string; value: string; maxAge: number };
}

const SESSION_COOKIE_NAME = "sifty_session";

export async function signUp(input: {
  email: string;
  password: string;
  displayName?: string;
}): Promise<AuthSuccess | AuthError> {
  const email = input.email.trim().toLowerCase();
  if (!/.+@.+\..+/.test(email)) {
    return { code: "invalid_input", message: "Email is required." };
  }
  if (input.password.length < 8) {
    return { code: "weak_password", message: "Password must be at least 8 characters." };
  }

  const repos = getRepos();
  const existing = await repos.users.getByEmail(email);
  if (existing) {
    return { code: "email_taken", message: "An account already exists for that email." };
  }

  const isCreator = isCreatorEmail(email);
  const passwordHash = await hashPassword(input.password);
  const displayName = input.displayName?.trim() || email.split("@")[0]!;
  const user = await repos.users.create({
    email,
    passwordHash,
    displayName,
    isCreator,
  });

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

  return finishLogin(user);
}

export async function signIn(input: {
  email: string;
  password: string;
}): Promise<AuthSuccess | AuthError> {
  const email = input.email.trim().toLowerCase();
  const repos = getRepos();
  const row = await repos.users.getByEmail(email);
  if (!row) return { code: "invalid_credentials", message: "Email or password is incorrect." };
  const ok = await verifyPassword(input.password, row.passwordHash ?? null);
  if (!ok) return { code: "invalid_credentials", message: "Email or password is incorrect." };

  return finishLogin({
    id: row.id,
    email: row.email,
    displayName: row.displayName,
    isCreator: row.isCreator,
    createdAt: row.createdAt,
  });
}

export async function signOut(sessionId: string): Promise<void> {
  const repos = getRepos();
  await repos.sessions.delete(sessionId);
}

async function finishLogin(user: UserProfile): Promise<AuthSuccess> {
  const repos = getRepos();
  const session = await repos.sessions.create(user.id, SESSION_TTL_SECONDS * 1000);
  const token = await signSessionToken(
    { sub: user.id, sid: session.id, email: user.email },
    SESSION_TTL_SECONDS,
  );
  return {
    user,
    cookie: { name: SESSION_COOKIE_NAME, value: token, maxAge: SESSION_TTL_SECONDS },
  };
}
