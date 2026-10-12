ALTER TABLE "tasks" ADD COLUMN "recurrence" jsonb;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "series_id" text;--> statement-breakpoint
CREATE INDEX "tasks_user_series_idx" ON "tasks" USING btree ("user_id","series_id");