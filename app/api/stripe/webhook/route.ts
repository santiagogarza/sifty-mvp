import { type ReducibleEvent, applyStripeEvent } from "@/lib/billing/events";
import { StripeNotConfiguredError, verifyAndParseEvent } from "@/lib/billing/stripe";
import { getRepos } from "@/lib/db/repos";
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
 * replays, in which case we 200 immediately without doing work.
 */
export async function POST(req: Request) {
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
    const message = err instanceof Error ? err.message : "Webhook handler failed";
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
    // No matching user — this can happen during dev if a Stripe sandbox
    // event arrives before the app records the customer linkage. Log and
    // 200; Stripe will not retry.
    console.warn(`[stripe.webhook] No user for stripe customer ${customerId} (event ${event.id})`);
    return;
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
