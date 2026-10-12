import type { PushSubscriptionRecord, Repos } from "@/lib/db/repos/types";
import { reportError } from "@/lib/observability/report-error";
import webpush from "web-push";
import type { PushPayload } from "./digest";
import { type PushConfig, inspectPushEnv } from "./push-config";

export { type PushConfig, PushMisconfiguredError, inspectPushEnv } from "./push-config";

/**
 * Web Push delivery.
 *
 * VAPID keys come from the environment (`VAPID_PUBLIC_KEY`,
 * `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`). With none of them set, push is
 * a no-op everywhere — Settings hides the toggle and `sendPushToUser`
 * reports `not_configured` — so the rest of notifications works without
 * it. Setting some but not all three is a deployment mistake: the
 * production boot guard refuses it, and elsewhere it is reported and
 * treated as "push off".
 */

const PUSH_REQUEST_TIMEOUT_MS = 10_000;

let reportedMisconfig = false;

/**
 * Runtime view: a partial or invalid VAPID setup behaves as "push off" so
 * Settings and email digests keep working, and is reported once per
 * process through the observability seam. On Vercel production the boot
 * guard already refuses to start with that env, so this path is for
 * previews and local dev.
 */
export function getPushConfig(): PushConfig | null {
  const result = inspectPushEnv();
  if (result === null) return null;
  if (result instanceof Error) {
    if (!reportedMisconfig) {
      reportedMisconfig = true;
      reportError(result, { area: "notifications.push.config" });
    }
    return null;
  }
  return result;
}

export function isPushConfigured(): boolean {
  return getPushConfig() !== null;
}

export function resetPushConfigReportForTesting(): void {
  reportedMisconfig = false;
}

/** What the push service answered for one subscription. */
export type PushDelivery = "delivered" | "gone" | "failed";

export type PushTransport = (
  subscription: PushSubscriptionRecord,
  payload: PushPayload,
  config: PushConfig,
) => Promise<PushDelivery>;

const webPushTransport: PushTransport = async (subscription, payload, config) => {
  try {
    await webpush.sendNotification(
      {
        endpoint: subscription.endpoint,
        keys: { p256dh: subscription.p256dh, auth: subscription.auth },
      },
      JSON.stringify(payload),
      {
        vapidDetails: {
          subject: config.subject,
          publicKey: config.publicKey,
          privateKey: config.privateKey,
        },
        // A digest that cannot be delivered within the hour is stale.
        TTL: 60 * 60,
        urgency: "normal",
        // A stalled push service must not eat the cron's time budget.
        timeout: PUSH_REQUEST_TIMEOUT_MS,
      },
    );
    return "delivered";
  } catch (err) {
    const status = (err as { statusCode?: number }).statusCode;
    // 404/410: the browser dropped the subscription (user revoked, app
    // uninstalled). Nothing will ever be delivered there again.
    if (status === 404 || status === 410) return "gone";
    throw err;
  }
};

let _transport: PushTransport = webPushTransport;

export function setPushTransportForTesting(transport: PushTransport | null): void {
  _transport = transport ?? webPushTransport;
}

export type PushSendResult =
  | { status: "not_configured" }
  | { status: "no_subscriptions" }
  | { status: "sent"; delivered: number; removed: number; failed: number };

/**
 * Fan one payload out to every subscription the user has. Dead endpoints
 * are removed; other failures are reported and counted, never thrown, so
 * one bad device cannot block the email channel or the rest of the run.
 */
export async function sendPushToUser(
  repos: Repos,
  userId: string,
  payload: PushPayload,
  now: Date = new Date(),
): Promise<PushSendResult> {
  const config = getPushConfig();
  if (!config) return { status: "not_configured" };
  const subscriptions = await repos.pushSubscriptions.listForUser(userId);
  if (subscriptions.length === 0) return { status: "no_subscriptions" };

  // All devices in parallel: one user's fan-out is then bounded by a
  // single request timeout, not by devices × timeout, which matters inside
  // the cron's time budget.
  const outcomes = await Promise.all(
    subscriptions.map(async (sub): Promise<PushDelivery> => {
      try {
        const outcome = await _transport(sub, payload, config);
        if (outcome === "delivered") await repos.pushSubscriptions.touch(sub.id, now);
        if (outcome === "gone") await repos.pushSubscriptions.remove(sub.id);
        return outcome;
      } catch (err) {
        reportError(err, {
          area: "notifications.push",
          userId,
          tags: { endpointHost: safeHost(sub.endpoint) },
        });
        return "failed";
      }
    }),
  );
  return {
    status: "sent",
    delivered: outcomes.filter((o) => o === "delivered").length,
    removed: outcomes.filter((o) => o === "gone").length,
    failed: outcomes.filter((o) => o === "failed").length,
  };
}

function safeHost(endpoint: string): string {
  try {
    return new URL(endpoint).host;
  } catch {
    return "invalid";
  }
}
