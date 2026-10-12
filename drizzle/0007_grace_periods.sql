-- Dunning grace period: Pro is kept until grace_ends_at after a failed
-- payment, then dropped by expireGracePeriods(). stripe_synced_at is the
-- `created` of the newest Stripe event applied to the tracked subscription,
-- so out-of-order deliveries cannot rewind state. Forward-only.
ALTER TABLE "entitlements" ADD COLUMN "grace_ends_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "entitlements" ADD COLUMN "stripe_synced_at" timestamp with time zone;
