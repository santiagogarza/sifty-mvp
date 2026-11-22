/**
 * Locales Sifty ships. English is the default and the fallback for any key a
 * catalog has not translated yet. Edge-safe: imported by the request config
 * and the client language picker alike.
 */
export const LOCALES = ["en", "es"] as const;
export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = "en";

/** next-intl's conventional cookie name; holds the explicit user choice. */
export const LOCALE_COOKIE = "NEXT_LOCALE";
export const LOCALE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

/** Each language named in itself, so the picker is readable in any locale. */
export const LOCALE_NAMES: Record<Locale, string> = {
  en: "English",
  es: "Español",
};

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (LOCALES as readonly string[]).includes(value);
}
