"use client";

import { useLocale, useTranslations } from "next-intl";
import { useCallback } from "react";

type AuthErrorKey =
  | "invalidCredentials"
  | "emailNotVerified"
  | "passwordTooShort"
  | "passwordTooLong"
  | "invalidEmail"
  | "userExists"
  | "invalidToken"
  | "noPassword"
  | "rateLimited"
  | "botDetected";

/** Better Auth error codes (plus the `rate_limited` / `bot_detected` codes from Sifty's guards). */
const CODE_KEYS: Record<string, AuthErrorKey> = {
  INVALID_EMAIL_OR_PASSWORD: "invalidCredentials",
  INVALID_PASSWORD: "invalidCredentials",
  EMAIL_NOT_VERIFIED: "emailNotVerified",
  PASSWORD_TOO_SHORT: "passwordTooShort",
  PASSWORD_TOO_LONG: "passwordTooLong",
  INVALID_EMAIL: "invalidEmail",
  USER_ALREADY_EXISTS: "userExists",
  USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL: "userExists",
  INVALID_TOKEN: "invalidToken",
  CREDENTIAL_ACCOUNT_NOT_FOUND: "noPassword",
  rate_limited: "rateLimited",
  bot_detected: "botDetected",
};

/** Localized copy for the errors the auth forms surface. */
export function useAuthErrorMessage() {
  const t = useTranslations("auth.errors");
  const locale = useLocale();
  return useCallback(
    (error: { code?: string; message?: string } | null): string => {
      const key = error?.code ? CODE_KEYS[error.code] : undefined;
      if (key) return t(key);
      // Unmapped server messages are English; show them only to English readers.
      if (locale === "en" && error?.message) return error.message;
      return t("generic");
    },
    [t, locale],
  );
}
