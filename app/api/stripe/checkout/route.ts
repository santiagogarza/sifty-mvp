import { getSession } from "@/lib/auth/session";
import { StripeNotConfiguredError, getPriceIds, getStripe } from "@/lib/billing/stripe";
import { getRepos } from "@/lib/db/repos";
import { TRIAL_DAYS, trialSnapshot } from "@/lib/entitlements/entitlements";
import { enforceRateLimit } from "@/lib/ratelimit/guard";
import { STRIPE_IP_POLICY, STRIPE_USER_POLICY } from "@/lib/ratelimit/policies";
import { NextResponse } from "next/server";
import { z } from "zod";

export const runtime = "nodejs";

const Body = z.object({
  cadence: z.enum(["monthly", "yearly"]).default("monthly"),
});

export async function POST(req: Request) {
  const session = await getSession(req);
  if (!session) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const limit = await enforceRateLimit(req, {
    route: "stripe-user",
    ip: STRIPE_IP_POLICY,
    subject: { id: session.user.id, policy: STRIPE_USER_POLICY },
    message: "Too many checkout requests. Try again in a moment.",
  });
  if (!limit.ok) return limit.response;

  const json = await req.json().catch(() => ({}));
  const parsed = Body.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  }

  const { monthly, yearly } = getPriceIds();
  const priceId = parsed.data.cadence === "yearly" ? yearly : monthly;
  if (!priceId) {
    return NextResponse.json(
      {
        error: `Stripe price for ${parsed.data.cadence} is not configured. Set STRIPE_PRICE_${parsed.data.cadence.toUpperCase()}.`,
      },
      { status: 503 },
    );
  }

  const repos = getRepos();
  const ent = await repos.entitlements.get(session.user.id);
  // Server-side twin of the panel's check: a comped user can still be
  // billed by Stripe, and a second Checkout would open a second subscription.
  if (ent?.subscriptionActive) {
    return NextResponse.json(
      { error: "You already have an active subscription. Manage it from the billing portal." },
      { status: 409 },
    );
  }
  let customerId = ent?.stripeCustomerId ?? null;

  try {
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
    const checkout = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: customerId,
      line_items: [{ price: priceId, quantity: 1 }],
      // Promo code support — anyone with a code from the Stripe dashboard
      // can redeem it at checkout. Creator overrides are server-side only.
      allow_promotion_codes: true,
      success_url: `${origin}/settings/billing?checkout=success`,
      cancel_url: `${origin}/settings/billing?checkout=cancelled`,
      client_reference_id: session.user.id,
    });

    return NextResponse.json({ url: checkout.url });
  } catch (err) {
    if (err instanceof StripeNotConfiguredError) {
      return NextResponse.json({ error: err.message }, { status: 503 });
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Checkout failed" },
      { status: 500 },
    );
  }
}
