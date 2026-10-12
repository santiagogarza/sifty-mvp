import { getSession } from "@/lib/auth/session";
import { hasOpenStripeSubscription } from "@/lib/billing/events";
import type { Cadence } from "@/lib/billing/plans";
import {
  StripeNotConfiguredError,
  StripePriceMismatchError,
  getBillingStatus,
  getPriceIds,
  getStripe,
  verifyPriceMatchesPlan,
} from "@/lib/billing/stripe";
import { honoursRemainingTrial } from "@/lib/billing/trial-carryover";
import { getRepos } from "@/lib/db/repos";
import { TRIAL_DAYS, trialSnapshot } from "@/lib/entitlements/entitlements";
import { reportError } from "@/lib/observability/report-error";
import { buildRateLimitKey, consumeToken, rateLimitResponseInit } from "@/lib/ratelimit/limiter";
import { STRIPE_USER_POLICY, clientIdFromRequest } from "@/lib/ratelimit/policies";
import { NextResponse } from "next/server";
import { z } from "zod";

export const runtime = "nodejs";

const Body = z.object({
  cadence: z.enum(["monthly", "yearly"] satisfies [Cadence, ...Cadence[]]).default("monthly"),
});

export async function POST(req: Request) {
  const session = await getSession(req);
  if (!session) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const limit = consumeToken(
    buildRateLimitKey("stripe-user", session.user.id, clientIdFromRequest(req)),
    STRIPE_USER_POLICY,
  );
  if (!limit.ok) {
    return NextResponse.json(
      { error: "Too many checkout requests. Try again in a moment." },
      rateLimitResponseInit(limit),
    );
  }

  const json = await req.json().catch(() => ({}));
  const parsed = Body.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  }
  const { cadence } = parsed.data;

  const status = getBillingStatus();
  if (!status.configured) {
    return NextResponse.json(
      {
        error: `Billing is not configured yet (missing ${status.missing.join(", ")}). Upgrades open once Stripe is connected.`,
        code: "billing_not_configured",
      },
      { status: 503 },
    );
  }
  const priceId = getPriceIds()[cadence] as string;

  const repos = getRepos();
  const ent = await repos.entitlements.get(session.user.id);
  // Server-side twin of the panel's check: a comped user can still be
  // billed by Stripe, and a second Checkout would open a second
  // subscription. Dunning counts as open too: the fix for a failed card is
  // the portal, not a new subscription next to the unpaid one.
  if (hasOpenStripeSubscription(ent)) {
    return NextResponse.json(
      { error: "You already have a subscription. Manage it from the billing portal." },
      { status: 409 },
    );
  }
  let customerId = ent?.stripeCustomerId ?? null;

  try {
    await verifyPriceMatchesPlan(cadence, priceId);
    const stripe = getStripe();
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: session.user.email,
        name: session.user.displayName,
        metadata: { userId: session.user.id },
      });
      customerId = customer.id;
      await repos.users.setStripeCustomerId(session.user.id, customerId);
      // Also pin it onto the entitlement snapshot so lookups during the
      // webhook find this user even before we receive the first event.
      const pinned = customerId;
      await repos.entitlements.update(session.user.id, (current) => ({
        ...(current ?? trialSnapshot(TRIAL_DAYS)),
        stripeCustomerId: pinned,
      }));
    }

    const origin = req.headers.get("origin") ?? process.env.NEXT_PUBLIC_APP_URL ?? "";
    // Someone upgrading mid-trial keeps the days they were promised: the
    // card is collected now and first charged when the app trial ends.
    const honorTrial = honoursRemainingTrial(ent?.trialEndsAt);
    const trialEndsAt = honorTrial ? Date.parse(ent?.trialEndsAt as string) : Number.NaN;

    const checkout = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: customerId,
      line_items: [{ price: priceId, quantity: 1 }],
      // Promo code support — anyone with a code from the Stripe dashboard
      // can redeem it at checkout. Creator overrides are server-side only.
      allow_promotion_codes: true,
      // Stripe Tax: Checkout collects whatever address it needs and saves
      // it on the customer so renewals are taxed the same way.
      automatic_tax: { enabled: true },
      customer_update: { address: "auto", name: "auto" },
      tax_id_collection: { enabled: true },
      subscription_data: {
        metadata: { userId: session.user.id },
        ...(honorTrial ? { trial_end: Math.floor(trialEndsAt / 1000) } : {}),
      },
      success_url: `${origin}/settings/billing?checkout=success`,
      cancel_url: `${origin}/settings/billing?checkout=cancelled`,
      client_reference_id: session.user.id,
    });

    return NextResponse.json({ url: checkout.url });
  } catch (err) {
    if (err instanceof StripeNotConfiguredError) {
      return NextResponse.json({ error: err.message }, { status: 503 });
    }
    if (err instanceof StripePriceMismatchError) {
      reportError(err, { area: "stripe.checkout", tags: { cadence } });
      return NextResponse.json(
        {
          error: "Billing is misconfigured on our side. Nothing was charged.",
          detail: err.message,
        },
        { status: 503 },
      );
    }
    reportError(err, { area: "stripe.checkout", tags: { cadence } });
    return NextResponse.json(
      {
        error: "We couldn't reach Stripe just now. Nothing was charged; try again in a moment.",
        detail: err instanceof Error ? err.message : "Checkout failed",
      },
      { status: 500 },
    );
  }
}
