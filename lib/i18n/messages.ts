import { CATALOGS } from "@/messages";
import { DEFAULT_LOCALE, type Locale } from "./config";

export type Messages = (typeof CATALOGS)[typeof DEFAULT_LOCALE];

type Tree = { [key: string]: string | Tree };

/**
 * The catalog for `locale`, with every key it lacks filled in from English.
 * The catalog-parity test keeps `es` complete in CI; the merge is the runtime
 * safety net so a missing key renders English instead of a raw key path.
 */
export function getMessages(locale: Locale): Messages {
  if (locale === DEFAULT_LOCALE) return CATALOGS[DEFAULT_LOCALE];
  return mergeTrees(CATALOGS[DEFAULT_LOCALE] as Tree, CATALOGS[locale] as Tree) as Messages;
}

function mergeTrees(base: Tree, override: Tree): Tree {
  const out: Tree = { ...base };
  for (const [key, value] of Object.entries(override)) {
    const fallback = base[key];
    out[key] =
      typeof value === "object" && typeof fallback === "object"
        ? mergeTrees(fallback, value)
        : value;
  }
  return out;
}
