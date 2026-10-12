import type { PushSubscriptionRecord, Repos } from "@/lib/db/repos/types";
import { reportError } from "@/lib/observability/report-error";
import webpush from "web-push";
import type { PushPayload } from "./digest";

/**
 * Web Push delivery.
 *
 * VAPID keys come from the environment (`VAPID_PUBLIC_KEY`,
 * `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`). With none of them set, push is
 * a no-op everywhere — Settings hides the toggle and `sendPushToUser`
 * reports `not_configured` — so the rest of notifications works without
 * it. Setting some but not all three is a deployment mistake and throws.
 */

export interface PushConfig {
  publicKey: string;
  privateKey: string;
  /** `mailto:` or `https:` URL push services may contact about abuse. */
  subject: string;
}

export class PushMisconfiguredError extends Error {
  constructor(missing: string[]) {
    super(
      `Web Push is partially configured: ${missing.join(", ")} missing. Set VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, and VAPID_SUBJECT together (generate a pair with \`npx web-push generate-vapid-keys\`), or unset all three to disable push.`,
    );
    this.name = "PushMisconfiguredError";
  }
}

export function getPushConfig(): PushConfig | null {
  const publicKey = process.env.VAPID_PUBLIC_KEY?.trim() || "";
  const privateKey = process.env.VAPID_PRIVATE_KEY?.trim() || "";
  const subject = process.env.VAPID_SUBJECT?.trim() || "";
  if (!publicKey && !privateKey && !subject) return null;
  const missing = [
    !publicKey && "VAPID_PUBLIC_KEY",
    !privateKey && "VAPID_PRIVATE_KEY",
    !subject && "VAPID_SUBJECT",
  ].filter((x): x is string => typeof x === "string");
  if (missing.length) throw new PushMisconfiguredError(missing);
  if (!/^(mailto:|https:\/\/)/.test(subject)) {
    throw new Error("VAPID_SUBJECT must be a mailto: address or an https: URL.");
  }
  return { publicKey, privateKey, subject };
}

export function isPushConfigured(): boolean {
  return getPushConfig() !== null;
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

  let delivered = 0;
  let removed = 0;
  let failed = 0;
  for (const sub of subscriptions) {
    try {
      const outcome = await _transport(sub, payload, config);
      if (outcome === "delivered") {
        delivered += 1;
        await repos.pushSubscriptions.touch(sub.id, now);
      } else if (outcome === "gone") {
        removed += 1;
        await repos.pushSubscriptions.remove(sub.id);
      } else {
        failed += 1;
      }
    } catch (err) {
      failed += 1;
      reportError(err, {
        area: "notifications.push",
        userId,
        tags: { endpointHost: safeHost(sub.endpoint) },
      });
    }
  }
  return { status: "sent", delivered, removed, failed };
}

function safeHost(endpoint: string): string {
  try {
    return new URL(endpoint).host;
  } catch {
    return "invalid";
  }
}
