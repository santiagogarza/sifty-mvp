ALTER TABLE "tasks" ADD COLUMN "sift_id" text;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "sift_stage" text;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "plan" jsonb;