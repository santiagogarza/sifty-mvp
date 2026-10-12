CREATE TABLE "daily_plans" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"plan_date" date NOT NULL,
	"timezone" text DEFAULT 'UTC' NOT NULL,
	"trigger" text NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"workflow_run_id" text,
	"ai_run_id" text,
	"summary" text,
	"moves" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"considered" integer DEFAULT 0 NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "daily_plans" ADD CONSTRAINT "daily_plans_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "daily_plans_user_created_idx" ON "daily_plans" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "daily_plans_cron_day_idx" ON "daily_plans" USING btree ("user_id","plan_date") WHERE "daily_plans"."trigger" = 'cron';