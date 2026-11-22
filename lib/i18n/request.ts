import { getRequestConfig } from "next-intl/server";
import { cookies } from "next/headers";
import { DEFAULT_LOCALE, LOCALE_COOKIE, isLocale } from "./config";
import { getMessages } from "./messages";

/**
 * Per-request i18n config for next-intl (wired in `next.config.ts`).
 *
 * Sifty does not put the locale in the URL: the language is a personal
 * preference chosen in Settings and stored in a cookie, so links and
 * bookmarks stay the same in every language.
 */
export default getRequestConfig(async () => {
  const stored = (await cookies()).get(LOCALE_COOKIE)?.value;
  const locale = isLocale(stored) ? stored : DEFAULT_LOCALE;
  return { locale, messages: getMessages(locale) };
});
