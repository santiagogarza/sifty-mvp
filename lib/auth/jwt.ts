import { SignJWT, jwtVerify } from "jose";

/**
 * Session JWT.
 *
 * The session row is the source of truth (we can revoke). The cookie holds
 * a compact, signed claim that includes the session id; the server
 * validates the signature, then loads the row and re-checks expiry.
 *
 * `AUTH_SECRET` must be set in production. In tests/dev we accept a fixed
 * value (from `tests/setup.ts`) to keep iteration fast.
 */

const ISSUER = "sifty";
const AUDIENCE = "sifty-app";

export interface SessionPayload {
  sub: string; // user id
  sid: string; // session id (matches sessions.id row)
  email: string;
}

function getKey(): Uint8Array {
  const secret = process.env.AUTH_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error(
      "AUTH_SECRET must be set and at least 32 chars. Generate one with `openssl rand -hex 32`.",
    );
  }
  return new TextEncoder().encode(secret);
}

export async function signSessionToken(
  payload: SessionPayload,
  ttlSeconds: number,
): Promise<string> {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setSubject(payload.sub)
    .setIssuedAt()
    .setExpirationTime(`${ttlSeconds}s`)
    .sign(getKey());
}

export async function verifySessionToken(token: string): Promise<SessionPayload> {
  const { payload } = await jwtVerify(token, getKey(), {
    issuer: ISSUER,
    audience: AUDIENCE,
  });
  if (
    typeof payload.sub !== "string" ||
    typeof (payload as { sid?: unknown }).sid !== "string" ||
    typeof (payload as { email?: unknown }).email !== "string"
  ) {
    throw new Error("Malformed session token");
  }
  return {
    sub: payload.sub,
    sid: (payload as { sid: string }).sid,
    email: (payload as { email: string }).email,
  };
}
