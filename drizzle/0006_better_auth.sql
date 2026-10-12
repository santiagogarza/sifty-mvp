-- Better Auth migration (plan 1.1). Forward-only; preserves every `users` row.
--
-- 1. New `accounts` + `verifications` tables.
-- 2. `sessions` gains Better Auth's columns. Existing rows were bound to the
--    old JWT cookie format, which no client can present any more, so they
--    are deleted before `token` becomes NOT NULL (everyone signs in again).
-- 3. `users` gains `email_verified` + `image`; existing bcrypt hashes move to
--    `accounts.password` (provider `credential`) and `password_hash` is
--    dropped so there is exactly one copy of each hash.
-- 4. Migrated users stay `email_verified = false`: the old sign-up never
--    proved the address, so the first sign-in sends a verification link and
--    the first magic link strips any unproven password (Better Auth's
--    revoke-unproven-access). Nobody loses data; everyone clicks one email.
CREATE TABLE "accounts" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"password" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "verifications" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DELETE FROM "sessions";--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "token" text NOT NULL;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "ip_address" text;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "user_agent" text;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "email_verified" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "image" text;--> statement-breakpoint
INSERT INTO "accounts" ("id", "user_id", "account_id", "provider_id", "password", "created_at", "updated_at")
SELECT 'acct_' || "id", "id", "id", 'credential', "password_hash", "created_at", now()
FROM "users"
WHERE "password_hash" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "accounts_user_idx" ON "accounts" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "accounts_provider_account_idx" ON "accounts" USING btree ("provider_id","account_id");--> statement-breakpoint
CREATE INDEX "verifications_identifier_idx" ON "verifications" USING btree ("identifier");--> statement-breakpoint
CREATE UNIQUE INDEX "sessions_token_idx" ON "sessions" USING btree ("token");--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "password_hash";
