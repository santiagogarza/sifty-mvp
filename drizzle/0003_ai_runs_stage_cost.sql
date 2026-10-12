ALTER TABLE "ai_runs" ALTER COLUMN "cost_cents" SET DATA TYPE double precision;--> statement-breakpoint
ALTER TABLE "ai_runs" ADD COLUMN "stage" text;