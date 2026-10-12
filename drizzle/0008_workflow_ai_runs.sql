ALTER TABLE "ai_runs" ADD COLUMN "sift_id" text;--> statement-breakpoint
ALTER TABLE "ai_runs" ADD COLUMN "workflow_run_id" text;--> statement-breakpoint
CREATE INDEX "ai_runs_sift_idx" ON "ai_runs" USING btree ("sift_id");--> statement-breakpoint
CREATE INDEX "ai_runs_created_idx" ON "ai_runs" USING btree ("created_at");