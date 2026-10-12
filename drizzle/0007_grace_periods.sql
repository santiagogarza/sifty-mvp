-- Dunning grace period: Pro is kept until grace_ends_at after a failed
-- payment, then dropped by expireGracePeriods(). Forward-only.
ALTER TABLE "entitlements" ADD COLUMN "grace_ends_at" timestamp with time zone;
