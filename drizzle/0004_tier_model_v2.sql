-- Tier model v2: free / trialing / pro / comped / creator.
-- Forward-only. Maps the legacy tiers (creator / trialing / active / expired)
-- onto the new model; per-feature caps are derived from the tier in code, so
-- the per-row daily cap column goes away.
ALTER TABLE "entitlements" ADD COLUMN "subscription_active" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "entitlements" ADD COLUMN "comped_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "entitlements" ADD COLUMN "comped_until" timestamp with time zone;--> statement-breakpoint
UPDATE "entitlements" SET "subscription_active" = true WHERE "tier" = 'active';--> statement-breakpoint
UPDATE "entitlements" SET "tier" = 'pro' WHERE "tier" = 'active';--> statement-breakpoint
UPDATE "entitlements" SET "tier" = 'free' WHERE "tier" = 'expired';--> statement-breakpoint
UPDATE "entitlements" SET "tier" = 'free' WHERE "tier" = 'trialing' AND ("trial_ends_at" IS NULL OR "trial_ends_at" <= now());--> statement-breakpoint
ALTER TABLE "entitlements" DROP COLUMN "ai_runs_limit_day";
