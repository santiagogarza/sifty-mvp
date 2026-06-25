import { CREATOR_EMAIL, SESSION_COOKIE_NAME } from "@/lib/auth/session-shared";
import { jwtVerify } from "jose";
import { type NextRequest, NextResponse } from "next/server";

/**
 * Middleware.
 *
 * Two responsibilities:
 *
 * 1. Gate the signed-in app routes (`/today`, `/focus`, ...) — redirect
 *    unauthenticated users to `/sign-in?next=<original>`.
 * 2. Light pre-check on the JWT cookie. We don't load the DB here; the
 *    server-side `getSession()` does that on each request. The middleware
 *    only catches the obviously-missing-or-tampered-cookie case so we don't
 *    spin up a route handler just to redirect.
 *
 * `SIFTY_DISABLE_AUTH=1` is the local-dev escape hatch — when set, the
 * middleware lets every request through (matching the bypass in
 * `getSession()`).
 */

const ISSUER = "sifty";
const AUDIENCE = "sifty-app";

const PROTECTED_PREFIXES = [
  "/today",
  "/focus",
  "/inbox",
  "/waiting",
  "/someday",
  "/memory",
  "/settings",
];

const SIGN_IN_PATH = "/sign-in";

export async function middleware(req: NextRequest): Promise<NextResponse> {
  const { pathname } = req.nextUrl;

  if (process.env.SIFTY_DISABLE_AUTH === "1") {
    return NextResponse.next();
  }

  const isProtected = PROTECTED_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );
  if (!isProtected) return NextResponse.next();

  const cookie = req.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (!cookie) return redirectToSignIn(req);

  const ok = await verifyCookie(cookie).catch(() => false);
  if (!ok) return redirectToSignIn(req);

  return NextResponse.next();
}

async function verifyCookie(token: string): Promise<boolean> {
  const secret = process.env.AUTH_SECRET;
  if (!secret || secret.length < 32) return false;
  const key = new TextEncoder().encode(secret);
  await jwtVerify(token, key, { issuer: ISSUER, audience: AUDIENCE });
  return true;
}

function redirectToSignIn(req: NextRequest): NextResponse {
  const url = req.nextUrl.clone();
  url.pathname = SIGN_IN_PATH;
  url.searchParams.set("next", req.nextUrl.pathname);
  return NextResponse.redirect(url);
}

export const config = {
  matcher: [
    /*
     * Match all routes except:
     * - api (route handlers do their own auth)
     * - _next/static, _next/image, favicon
     * - public files (anything with a file extension)
     */
    "/((?!api|_next/static|_next/image|favicon.ico|manifest.webmanifest|.*\\..*).*)",
  ],
};

// Suppress unused export warning for CREATOR_EMAIL - re-exported for ergonomics.
export { CREATOR_EMAIL };
