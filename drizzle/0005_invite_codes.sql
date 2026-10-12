CREATE TABLE "invite_codes" (
	"id" text PRIMARY KEY NOT NULL,
	"code_hash" text NOT NULL,
	"grants" text DEFAULT 'pro' NOT NULL,
	"duration_months" integer,
	"max_redemptions" integer DEFAULT 1 NOT NULL,
	"redemption_count" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp with time zone,
	"note" text,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invite_redemptions" (
	"id" text PRIMARY KEY NOT NULL,
	"code_id" text NOT NULL,
	"user_id" text NOT NULL,
	"comped_until" timestamp with time zone,
	"redeemed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "invite_redemptions" ADD CONSTRAINT "invite_redemptions_code_id_invite_codes_id_fk" FOREIGN KEY ("code_id") REFERENCES "public"."invite_codes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invite_redemptions" ADD CONSTRAINT "invite_redemptions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "invite_codes_hash_idx" ON "invite_codes" USING btree ("code_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "invite_redemptions_code_user_idx" ON "invite_redemptions" USING btree ("code_id","user_id");--> statement-breakpoint
CREATE INDEX "invite_redemptions_user_idx" ON "invite_redemptions" USING btree ("user_id");