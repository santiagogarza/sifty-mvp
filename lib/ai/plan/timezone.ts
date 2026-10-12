import type { Repos } from "@/lib/db/repos";
import { isValidTimeZone } from "@/lib/notifications/preferences";

export { isValidTimeZone };

/**
 * The zone a user's "today" is computed in: the one saved with their
 * notification preferences, else UTC. The manual "Re-plan today" route
 * passes the browser's zone explicitly, so it is right even before the
 * user has saved preferences.
 */
export async function resolveUserTimeZone(repos: Repos, userId: string): Promise<string> {
  const prefs = await repos.notificationPreferences.get(userId);
  return prefs && isValidTimeZone(prefs.timezone) ? prefs.timezone : "UTC";
}
