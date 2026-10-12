CREATE TABLE "execution_policies" (
	"user_id" text NOT NULL,
	"scope" text NOT NULL,
	"key" text NOT NULL,
	"policy" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "execution_policies_user_id_scope_key_pk" PRIMARY KEY("user_id","scope","key")
);
--> statement-breakpoint
CREATE TABLE "execution_steps" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"execution_id" text NOT NULL,
	"seq" integer NOT NULL,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"status" text DEFAULT 'ok' NOT NULL,
	"input" jsonb,
	"output" jsonb,
	"duration_ms" integer,
	"cost_cents" double precision DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "executions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"task_id" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"executor" text NOT NULL,
	"policy" text NOT NULL,
	"connector" text,
	"idempotency_key" text NOT NULL,
	"workflow_run_id" text,
	"decision_id" text,
	"reserved_cents" integer DEFAULT 0 NOT NULL,
	"cost_cents" double precision DEFAULT 0 NOT NULL,
	"result" jsonb,
	"answers" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"error" text,
	"cancel_reason" text,
	"cancel_requested" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "execution_policies" ADD CONSTRAINT "execution_policies_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "execution_steps" ADD CONSTRAINT "execution_steps_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "execution_steps" ADD CONSTRAINT "execution_steps_execution_id_executions_id_fk" FOREIGN KEY ("execution_id") REFERENCES "public"."executions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "executions" ADD CONSTRAINT "executions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "executions" ADD CONSTRAINT "executions_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "execution_steps_execution_seq_idx" ON "execution_steps" USING btree ("execution_id","seq");--> statement-breakpoint
CREATE UNIQUE INDEX "executions_user_idempotency_idx" ON "executions" USING btree ("user_id","idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "executions_task_live_idx" ON "executions" USING btree ("task_id") WHERE "executions"."status" not in ('done', 'failed', 'cancelled');--> statement-breakpoint
CREATE INDEX "executions_user_status_created_idx" ON "executions" USING btree ("user_id","status","created_at");--> statement-breakpoint
CREATE INDEX "executions_task_idx" ON "executions" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX "executions_user_created_idx" ON "executions" USING btree ("user_id","created_at");