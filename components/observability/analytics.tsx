"use client";

import { scrubUrl } from "@/lib/observability/scrub";
import { Analytics as VercelAnalytics } from "@vercel/analytics/next";

/**
 * Vercel Web Analytics with the query string removed from every event, so
 * `/reset-password?token=`, `/redeem?code=`, and `/sign-in?next=` never
 * reach the analytics store. `beforeSend` must live in a client component.
 */
export function Analytics() {
  return <VercelAnalytics beforeSend={(event) => ({ ...event, url: scrubUrl(event.url) })} />;
}
