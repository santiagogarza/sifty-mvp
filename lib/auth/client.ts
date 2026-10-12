"use client";

import { magicLinkClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";

/**
 * Browser-side Better Auth client. Same origin as the app, so no baseURL.
 * Server code never imports this; it talks to `getAuth()` directly.
 */
export const authClient = createAuthClient({
  basePath: "/api/auth",
  plugins: [magicLinkClient()],
});

/** Human copy for the error codes the auth forms surface. */
export function authErrorMessage(error: { code?: string; message?: string } | null): string {
  switch (error?.code) {
    case "INVALID_EMAIL_OR_PASSWORD":
    case "INVALID_PASSWORD":
      return "Email or password is incorrect.";
    case "EMAIL_NOT_VERIFIED":
      return "Confirm your email first. We just sent you a fresh link.";
    case "PASSWORD_TOO_SHORT":
      return "Password must be at least 8 characters.";
    case "INVALID_TOKEN":
      return "That link has expired or was already used. Request a new one.";
    case "CREDENTIAL_ACCOUNT_NOT_FOUND":
      return "This account signs in with Google. Use the Google button, or reset your password to add one.";
    default:
      return error?.message || "Something went wrong. Try again.";
  }
}
