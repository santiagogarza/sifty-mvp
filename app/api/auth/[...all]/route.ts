import { getAuth } from "@/lib/auth/auth";
import { toNextJsHandler } from "better-auth/next-js";

export const runtime = "nodejs";

/**
 * Better Auth endpoints: `/api/auth/sign-in/email`, `/sign-up/email`,
 * `/sign-out`, `/verify-email`, `/request-password-reset`,
 * `/reset-password`, `/magic-link/*`, `/callback/google`,
 * `/list-sessions`, `/revoke-session`, ... `/api/auth/me` stays a static
 * sibling route owned by the sync layer.
 */
const handler = toNextJsHandler((request) => getAuth().handler(request));

export const { GET, POST } = handler;
