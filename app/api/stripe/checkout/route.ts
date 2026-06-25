import { getSession } from "@/lib/auth/session";
import { StripeNotConfiguredError, getPriceIds, getStripe } from "@/lib/billing/stripe";
import { getRepos } from "@/lib/db/repos";
import { buildRateLimitKey, consumeToken, rateLimitResponseInit } from "@/lib/ratelimit/limiter";
import { STRIPE_USER_POLICY, clientIdFromRequest } from "@/lib/ratelimit/policies";
import { NextResponse } from "next/server";
import { z } from "zod";

export const runtime = "nodejs";

const Body = z.object({
  cadence: z.enum(["monthly", "yearly"]).default("monthly"),
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
      const current = ent ?? (await repos.entitlements.startTrialIfMissing(session.user.id, 30));
      await repos.entitlements.upsert(session.user.id, {
        ...current,
        stripeCustomerId: customerId,
      });
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
