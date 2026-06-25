import { type ReducibleEvent, applyStripeEvent } from "@/lib/billing/events";
import { StripeNotConfiguredError, verifyAndParseEvent } from "@/lib/billing/stripe";
import { getRepos } from "@/lib/db/repos";
import { reportError } from "@/lib/observability/report-error";
import { buildRateLimitKey, consumeToken, rateLimitResponseInit } from "@/lib/ratelimit/limiter";
import { STRIPE_WEBHOOK_POLICY, clientIdFromRequest } from "@/lib/ratelimit/policies";
import { NextResponse } from "next/server";
import type Stripe from "stripe";

export const runtime = "nodejs";

const HANDLED_EVENTS = new Set([
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "invoice.paid",
  "invoice.payment_failed",
]);

/**
 * Stripe webhook.
 *
 * Stripe expects the raw request body for signature verification, so we
 * call `req.text()` once and pass the string to `constructEvent`. Any
 * tampering (different bytes, expired timestamp) throws and we return 400.
 *
 * Idempotency lives in `stripe_events` — `recordIfNew` returns false on
 * replays, in which case we 200 immediately without doing work. If the
 * processing step fails we delete the record so Stripe's retry can
 * actually re-run the reducer instead of falsely deduping.
 */
export async function POST(req: Request) {
  const limit = consumeToken(
    buildRateLimitKey("stripe-webhook", clientIdFromRequest(req)),
    STRIPE_WEBHOOK_POLICY,
  );
  if (!limit.ok) {
    return NextResponse.json({ error: "Webhook rate limited" }, rateLimitResponseInit(limit));
  }

  const signature = req.headers.get("stripe-signature");
  if (!signature) {
    return NextResponse.json({ error: "Missing signature" }, { status: 400 });
  }

  const rawBody = await req.text();

  let event: Stripe.Event;
  try {
    event = verifyAndParseEvent(rawBody, signature);
  } catch (err) {
    if (err instanceof StripeNotConfiguredError) {
      return NextResponse.json({ error: err.message }, { status: 503 });
    }
    return NextResponse.json(
      { error: "Invalid signature", detail: err instanceof Error ? err.message : "" },
      { status: 400 },
    );
  }

  const repos = getRepos();
  const isNew = await repos.stripeEvents.recordIfNew(event.id, event.type);
  if (!isNew) {
    return NextResponse.json({ ok: true, deduped: true });
  }

  if (!HANDLED_EVENTS.has(event.type)) {
    // Acknowledge with 2xx so Stripe doesn't retry; we record-without-act.
    return NextResponse.json({ ok: true, ignored: true });
  }

  try {
    await processEvent(event, repos);
    return NextResponse.json({ ok: true });
  } catch (err) {
    // Roll back the dedupe record so Stripe's retry can re-process the
    // event instead of being incorrectly short-circuited as a duplicate.
    await repos.stripeEvents.delete(event.id).catch(() => undefined);
    const message = err instanceof Error ? err.message : "Webhook handler failed";
    reportError(err, {
      area: "stripe.webhook",
      tags: { type: event.type, eventId: event.id },
    });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

async function processEvent(
  event: Stripe.Event,
  repos: ReturnType<typeof getRepos>,
): Promise<void> {
  const customerId = extractCustomerId(event);
  if (!customerId) {
    // Cannot route without a customer link; record-without-act.
    return;
  }

  const user = await repos.users.findByStripeCustomerId(customerId);
  const userId = user?.id ?? null;
  if (!userId) {
    // No matching user — this can happen if a webhook arrives before the
    // app records the Stripe customer linkage. Throw so the caller drops
    // the dedupe record and returns 5xx; Stripe will retry and the next
    // attempt can resolve the user.
    throw new Error(
      `[stripe.webhook] No user for stripe customer ${customerId} (event ${event.id})`,
    );
  }

  const current = (await repos.entitlements.get(userId)) ?? {
    tier: "trialing",
    trialStartedAt: null,
    trialEndsAt: null,
    subscriptionActive: false,
    stripeCustomerId: customerId,
    stripeSubscriptionId: null,
    stripeStatus: null,
    currentPeriodEnd: null,
    aiRunsLimitDay: 50,
  };

  const next = applyStripeEvent(current, event as unknown as ReducibleEvent);
  await repos.entitlements.upsert(userId, { ...next, stripeCustomerId: customerId });
}

function extractCustomerId(event: Stripe.Event): string | null {
  const obj = event.data.object as { customer?: string | { id?: string } | null };
  if (!obj || !obj.customer) return null;
  if (typeof obj.customer === "string") return obj.customer;
  return obj.customer.id ?? null;
}
