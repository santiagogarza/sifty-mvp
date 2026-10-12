import type { Repos } from "@/lib/db/repos";

/**
 * The zone a user's "today" is computed in.
 *
 * Saved notification preferences carry the zone once that feature lands;
 * until then every account plans in UTC, and the manual "Re-plan today"
 * route passes the browser's zone explicitly so it is right regardless.
 */
export async function resolveUserTimeZone(_repos: Repos, _userId: string): Promise<string> {
  return "UTC";
}

const timeZoneCache = new Map<string, boolean>();

/** An IANA zone the runtime knows (`Europe/Ljubljana`, `America/New_York`, `UTC`). */
export function isValidTimeZone(tz: string): boolean {
  const cached = timeZoneCache.get(tz);
  if (cached !== undefined) return cached;
  let ok = false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    ok = tz.length > 0 && tz.length <= 64;
  } catch {
    ok = false;
  }
  timeZoneCache.set(tz, ok);
  return ok;
}
