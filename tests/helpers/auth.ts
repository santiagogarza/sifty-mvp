import { signSessionToken } from "@/lib/auth/jwt";
import { SESSION_COOKIE_NAME } from "@/lib/auth/session";
import { isCreatorEmail } from "@/lib/auth/session-shared";
import type { Repos } from "@/lib/db/repos/types";
import type { UserProfile } from "@/lib/domain/types";
import { TRIAL_DAYS, creatorSnapshot } from "@/lib/entitlements/entitlements";

/**
 * Test helpers — create a user, mint a real JWT session cookie, and return
 * a header that route handlers will accept.
 */

const SESSION_TTL_S = 60 * 60;

export async function createUserWithCookie(
  repos: Repos,
  input: { email: string; password?: string; isCreator?: boolean; displayName?: string },
): Promise<{ user: UserProfile; cookie: string }> {
  const isCreator = input.isCreator ?? isCreatorEmail(input.email);
  const user = await repos.users.create({
    email: input.email,
    passwordHash: input.password ?? "test-hash",
    displayName: input.displayName ?? input.email.split("@")[0]!,
    isCreator,
  });
  if (isCreator) {
    await repos.entitlements.upsert(user.id, creatorSnapshot());
  } else {
    await repos.entitlements.startTrialIfMissing(user.id, TRIAL_DAYS);
  }
  const session = await repos.sessions.create(user.id, SESSION_TTL_S * 1000);
  const token = await signSessionToken(
    { sub: user.id, sid: session.id, email: user.email },
    SESSION_TTL_S,
  );
  return { user, cookie: `${SESSION_COOKIE_NAME}=${token}` };
}
