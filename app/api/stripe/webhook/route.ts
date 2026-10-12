import { sendPaymentFailedEmail } from "@/lib/billing/dunning";
import {
  type ReducibleEvent,
  type StripeInvoiceLike,
  applyStripeEvent,
} from "@/lib/billing/events";
import { StripeNotConfiguredError, verifyAndParseEvent } from "@/lib/billing/stripe";
import { HANDLED_EVENTS } from "@/lib/billing/webhook-events";
import { getRepos } from "@/lib/db/repos";
import { emptySnapshot, isGraceActive } from "@/lib/entitlements/entitlements";
import { reportError } from "@/lib/observability/report-error";
import { buildRateLimitKey, consumeToken, rateLimitResponseInit } from "@/lib/ratelimit/limiter";
import { STRIPE_WEBHOOK_POLICY, clientIdFromRequest } from "@/lib/ratelimit/policies";
import { NextResponse } from "next/server";
import type Stripe from "stripe";

export const runtime = "nodejs";

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
  if (event.type === "checkout.session.completed") {
    await linkCustomerFromCheckout(event, repos);
    return;
  }

  const customerId = extractCustomerId(event);
  if (!customerId) {
    // Cannot route without a customer link; record-without-act.
    return;
  }

  const user = await repos.users.findByStripeCustomerId(customerId);
  const userId = user?.id ?? null;
  if (!user || !userId) {
    // No matching user — this can happen if a webhook arrives before the
    // app records the Stripe customer linkage. Throw so the caller drops
    // the dedupe record and returns 5xx; Stripe will retry and the next
    // attempt can resolve the user.
    throw new Error(
      `[stripe.webhook] No user for stripe customer ${customerId} (event ${event.id})`,
    );
  }

  const reducible = event as unknown as ReducibleEvent;
  const at = event.created ? new Date(event.created * 1000) : new Date();
  // Locked read-modify-write: an invite redemption or checkout committing
  // concurrently is seen by the reducer instead of being overwritten.
  let noop = false;
  const next = await repos.entitlements.update(userId, (current) => {
    const base = current ?? { ...emptySnapshot(), stripeCustomerId: customerId };
    const reduced = applyStripeEvent(base, reducible, at);
    noop = reduced === base;
    return { ...reduced, stripeCustomerId: customerId };
  });

  // Dunning mail only when the failure actually put a live subscription into
  // dunning: never for leftover retries on a subscription that already ended
  // (the reducer leaves those untouched), and never for creator or comped
  // accounts, whose access does not depend on the card — the same rule the
  // in-app banner follows (`paymentProblem`).
  const nagged = next.tier !== "creator" && next.tier !== "comped";
  if (reducible.type === "invoice.payment_failed" && !noop && nagged) {
    await sendPaymentFailedEmail({
      user,
      invoice: reducible.data.object as StripeInvoiceLike,
      graceEndsAt: isGraceActive(next.graceEndsAt, at) ? next.graceEndsAt : null,
      accessPaused: next.tier !== "pro",
      eventId: event.id,
    });
  }
}

/**
 * Checkout pins the customer id on the user before redirecting, so this is
 * normally a no-op. It exists for the case where that write failed or the
 * customer was created outside the app: `client_reference_id` carries our
 * user id, so the subscription events that follow can find their owner.
 */
async function linkCustomerFromCheckout(
  event: Stripe.Event,
  repos: ReturnType<typeof getRepos>,
): Promise<void> {
  const session = event.data.object as {
    client_reference_id?: string | null;
    customer?: string | { id?: string } | null;
  };
  const userId = session.client_reference_id ?? null;
  const customerId =
    typeof session.customer === "string" ? session.customer : (session.customer?.id ?? null);
  if (!userId || !customerId) return;
  const user = await repos.users.getById(userId);
  if (!user) return;
  const ent = await repos.entitlements.get(userId);
  if (ent?.stripeCustomerId === customerId) return;
  await repos.users.setStripeCustomerId(userId, customerId);
  await repos.entitlements.update(userId, (current) => ({
    ...(current ?? emptySnapshot()),
    stripeCustomerId: customerId,
  }));
}

function extractCustomerId(event: Stripe.Event): string | null {
  const obj = event.data.object as { customer?: string | { id?: string } | null };
  if (!obj || !obj.customer) return null;
  if (typeof obj.customer === "string") return obj.customer;
  return obj.customer.id ?? null;
}
