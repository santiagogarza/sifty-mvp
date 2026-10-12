import { getAuth } from "@/lib/auth/auth";
import type { Repos } from "@/lib/db/repos/types";
import type { UserProfile } from "@/lib/domain/types";

/**
 * Test helpers — create a verified user through Better Auth, sign in, and
 * return the session cookie header that route handlers will accept.
 *
 * Creator vs. trial entitlement is decided by the email (same hook as
 * production); `isCreator` is accepted for readability at call sites.
 */

export const TEST_PASSWORD = "correct-horse-battery";

export async function createUserWithCookie(
  repos: Repos,
  input: { email: string; password?: string; isCreator?: boolean; displayName?: string },
): Promise<{ user: UserProfile; cookie: string }> {
  const auth = getAuth();
  const email = input.email.toLowerCase();
  const password = input.password ?? TEST_PASSWORD;

  const signedUp = await auth.api.signUpEmail({
    body: { email, password, name: input.displayName ?? email.split("@")[0]! },
  });
  await markEmailVerified(signedUp.user.id);

  const cookie = await signInCookie(email, password);
  const user = await repos.users.getById(signedUp.user.id);
  if (!user) throw new Error("user was not mirrored into repos");
  return { user, cookie };
}

/** Flip `emailVerified` without going through the emailed link. */
export async function markEmailVerified(userId: string): Promise<void> {
  const ctx = await getAuth().$context;
  await ctx.internalAdapter.updateUser(userId, { emailVerified: true });
}

/** Sign in with email + password and return a `Cookie` header value. */
export async function signInCookie(email: string, password: string): Promise<string> {
  const res = await getAuth().api.signInEmail({
    body: { email, password },
    asResponse: true,
  });
  if (!res.ok) throw new Error(`sign-in failed: ${res.status} ${await res.text()}`);
  return cookieHeaderFromResponse(res);
}

/** Collapse a response's `Set-Cookie` headers into one `Cookie` request header. */
export function cookieHeaderFromResponse(res: Response): string {
  const pairs = res.headers
    .getSetCookie()
    .map((c) => c.split(";")[0]!)
    .filter((kv) => !kv.endsWith("="));
  if (!pairs.length) throw new Error("response set no cookies");
  return pairs.join("; ");
}

/** Pull the first `https?://...` URL out of an email body. */
export function firstUrl(text: string): string {
  const match = text.match(/https?:\/\/[^\s)]+/);
  if (!match) throw new Error("no url in email");
  return match[0];
}
