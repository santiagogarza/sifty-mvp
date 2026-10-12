import { getSession } from "@/lib/auth/session";
import { StripeNotConfiguredError, getStripe } from "@/lib/billing/stripe";
import { getRepos } from "@/lib/db/repos";
import { enforceRateLimit } from "@/lib/ratelimit/guard";
import { STRIPE_IP_POLICY, STRIPE_USER_POLICY } from "@/lib/ratelimit/policies";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function POST(req: Request) {
  // IP first, before the session lookup, so an unauthenticated flood spends
  // its budget here instead of on free 401s.
  const ipLimit = await enforceRateLimit(req, {
    route: "stripe-user",
    ip: STRIPE_IP_POLICY,
    message: "Too many portal requests. Try again in a moment.",
  });
  if (!ipLimit.ok) return ipLimit.response;

  const session = await getSession(req);
  if (!session) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const limit = await enforceRateLimit(req, {
    route: "stripe-user",
    subject: { id: session.user.id, policy: STRIPE_USER_POLICY },
    message: "Too many portal requests. Try again in a moment.",
  });
  if (!limit.ok) return limit.response;

  const repos = getRepos();
  const ent = await repos.entitlements.get(session.user.id);
  if (!ent?.stripeCustomerId) {
    return NextResponse.json(
      { error: "No Stripe customer for this account. Start a checkout first." },
      { status: 400 },
    );
  }

  try {
    const stripe = getStripe();
    const origin = req.headers.get("origin") ?? process.env.NEXT_PUBLIC_APP_URL ?? "";
    const portal = await stripe.billingPortal.sessions.create({
      customer: ent.stripeCustomerId,
      return_url: `${origin}/settings/billing`,
    });
    return NextResponse.json({ url: portal.url });
  } catch (err) {
    if (err instanceof StripeNotConfiguredError) {
      return NextResponse.json({ error: err.message }, { status: 503 });
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Portal session failed" },
      { status: 500 },
    );
  }
}
