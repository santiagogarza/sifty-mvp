/**
 * Auth constants shared by both server and edge runtimes.
 *
 * These are split out from `session.ts` so the middleware (which runs in the
 * edge runtime) can import them without pulling in `next/headers` or the
 * repo layer.
 */

const RAW_CREATOR = process.env.CREATOR_EMAIL ?? "s.gonzalez.garza@gmail.com";
export const CREATOR_EMAIL = RAW_CREATOR.toLowerCase();
export const SESSION_COOKIE_NAME = "sifty_session";

export function isCreatorEmail(email: string): boolean {
  return email.toLowerCase() === CREATOR_EMAIL;
}
