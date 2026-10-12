/**
 * Routes BotID protects. Shared by the client component in `app/layout.tsx`
 * (which attaches the challenge token to matching requests) and the server
 * check in `./botid.ts`. Kept dependency-free so the layout bundle does not
 * pull in the server SDK.
 */
export const BOTID_PROTECTED_ROUTES: ReadonlyArray<{ path: string; method: string }> = [
  { path: "/api/auth/sign-up", method: "POST" },
  // Better Auth's sign-up endpoint, so the protection carries over when the
  // auth layer is swapped.
  { path: "/api/auth/sign-up/email", method: "POST" },
  { path: "/api/invites/redeem", method: "POST" },
];
