import { getSessionCookie } from "better-auth/cookies";
import { type NextRequest, NextResponse } from "next/server";

/**
 * Middleware.
 *
 * Gates the signed-in app routes (`/today`, `/focus`, ...) — redirect
 * visitors without a session cookie to `/sign-in?next=<original>`.
 *
 * This is the optimistic check Better Auth recommends for middleware: it
 * only looks for the cookie, it does not validate it (that needs the
 * database). The authoritative check is `getSession()` in the `(app)`
 * layout, which redirects when the cookie is stale or tampered with. The
 * middleware exists so an obviously signed-out visitor never renders the
 * app shell.
 *
 * `SIFTY_DISABLE_AUTH=1` is the local-dev escape hatch — when set, the
 * middleware lets every request through (matching the bypass in
 * `getSession()`).
 */

// Mirrors AUTH_COOKIE_PREFIX in lib/auth/auth.ts; that module pulls in the
// database layer and cannot be imported from the edge runtime.
const COOKIE_PREFIX = "sifty";

const PROTECTED_PREFIXES = [
  "/today",
  "/focus",
  "/inbox",
  "/waiting",
  "/someday",
  "/done",
  "/memory",
  "/settings",
  "/redeem",
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

  const cookie = getSessionCookie(req, { cookiePrefix: COOKIE_PREFIX });
  if (!cookie) return redirectToSignIn(req);

  // The `(app)` layout can't see the URL; it needs the path to build `next`
  // when the cookie turns out to be stale.
  const headers = new Headers(req.headers);
  headers.set("x-sifty-path", pathname);
  return NextResponse.next({ request: { headers } });
}

function redirectToSignIn(req: NextRequest): NextResponse {
  const url = req.nextUrl.clone();
  url.pathname = SIGN_IN_PATH;
  // Keep the query so `/redeem?code=…` survives the round trip.
  url.search = "";
  url.searchParams.set("next", `${req.nextUrl.pathname}${req.nextUrl.search}`);
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
