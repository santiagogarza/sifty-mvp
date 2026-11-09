import type { Locale } from "@/lib/i18n/config";
import type { Messages } from "@/lib/i18n/messages";

// Types next-intl's `t()` against the English catalog: an unknown key is a
// type error, and `useLocale()` returns `Locale` instead of `string`.
declare module "next-intl" {
  interface AppConfig {
    Locale: Locale;
    Messages: Messages;
  }
}
