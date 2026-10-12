/**
 * Domain model.
 *
 * Design notes:
 *
 * - Tasks are durable and editable. Every AI-derived field is editable by the
 *   user, and we never overwrite a user-edited field on re-triage. The
 *   `editedFields` set on a task is the source of truth for that protection.
 *
 * - Status is split into two axes: `lifecycle` (where it sits in the GTD
 *   pipeline — inbox / active / waiting / someday / done / dropped) and
 *   `aiStatus` (the enrichment pipeline — pending / running / ready / failed).
 *   Conflating them makes views muddy.
 *
 * - Priority is encoded with two scalars (urgency, importance) plus a derived
 *   bucket. We store both so views can sort by either, and the user can edit
 *   the bucket directly without losing the underlying scalars.
 *
 * - Effort is an enum, not minutes. People can't accurately estimate minutes
 *   but can pick "quick" vs "deep" reliably.
 *
 * - `delegationCandidate` is a recommendation, not a routing decision. The
 *   MVP never auto-launches an external agent.
 *
 * - `confidence` is the AI's self-assessed confidence in the triage output,
 *   used to surface clarifying questions when low.
 */

export type ID = string;
export type ISODate = string;

/**
 * Stored status values. Presented to the user as "Status" — labels, order,
 * and per-status routes live in `lib/domain/status.ts` (`STATUS_META`).
 * Note `active` is presented as "Focus" so the picker mirrors the sidebar.
 */
export const LIFECYCLE = ["inbox", "active", "waiting", "someday", "done", "dropped"] as const;
export type Lifecycle = (typeof LIFECYCLE)[number];

export const AI_STATUS = ["idle", "pending", "running", "ready", "failed"] as const;
export type AiStatus = (typeof AI_STATUS)[number];

export const EFFORT = ["quick", "small", "medium", "deep"] as const;
export type Effort = (typeof EFFORT)[number];

/** Eisenhower-derived bucket: urgent×important quadrants, plus calm/none. */
export const PRIORITY_BUCKET = [
  "do_now", // urgent + important
  "schedule", // important, not urgent
  "delegate", // urgent, not important
  "drop", // neither
  "unset",
] as const;
export type PriorityBucket = (typeof PRIORITY_BUCKET)[number];

export const DELEGATION_CANDIDATE = ["self", "ai", "person", "unsure"] as const;
export type DelegationCandidate = (typeof DELEGATION_CANDIDATE)[number];

/**
 * The sifting pipeline, in order. Each stage is one durable workflow step
 * that writes to the task and one `ai_runs` row. `task.siftStage` names the
 * stage in progress (or the one that failed) while `aiStatus` is
 * `running`/`failed`.
 */
export const SIFT_STAGES = ["enrich", "prioritize", "triage", "subtasks", "plan"] as const;
export type SiftStage = (typeof SIFT_STAGES)[number];

/** Short progressive labels for the per-stage status UI. */
export const SIFT_STAGE_LABELS: Record<SiftStage, string> = {
  enrich: "Enriching",
  prioritize: "Prioritizing",
  triage: "Triaging",
  subtasks: "Breaking down",
  plan: "Planning",
};

export const PLAN_EXECUTOR = ["self", "ai_agent", "cursor_agent", "person", "none"] as const;
export type PlanExecutor = (typeof PLAN_EXECUTOR)[number];

/** Output of the `plan` stage: can AI do it, with what, and what is missing. */
export interface TaskPlan {
  executor: PlanExecutor;
  /** One or two sentences on how the work would get done. */
  approach: string | null;
  /** Connector slugs the executor would need ("gmail", "calendar", "github", …). */
  connectors: string[];
  /** True when an executor could start now without more input. */
  readyForAi: boolean;
  /** What stands in the way (missing access, unclear outcome), or null. */
  blockers: string | null;
  promptVersion: string;
}

export interface Subtask {
  id: ID;
  title: string;
  done: boolean;
  order: number;
}

export interface Label {
  id: ID;
  name: string;
  /** A token from a curated palette, not a raw hex. Keeps colors harmonious. */
  tone: LabelTone;
}

export const LABEL_TONES = ["neutral", "ember", "mist", "sage", "rose", "violet", "sand"] as const;
export type LabelTone = (typeof LABEL_TONES)[number];

export interface Task {
  id: ID;

  /** The raw text the user typed. Always preserved for traceability. */
  sourceText: string;
  /** Optional context the user added during capture. */
  sourceContext: string | null;

  /** AI-derived but user-editable. */
  title: string;
  description: string | null;
  nextAction: string | null;

  /** GTD lifecycle. */
  lifecycle: Lifecycle;
  /** AI enrichment pipeline state, independent of lifecycle. */
  aiStatus: AiStatus;
  aiError: string | null;
  /** Number of triage attempts so far. Surface this when retrying. */
  aiAttempts: number;

  /** Eisenhower scalars, 0..1, plus derived bucket. */
  urgency: number;
  importance: number;
  priorityBucket: PriorityBucket;

  effort: Effort;

  /** ISO date or null. Day-precision; Sifty doesn't track times in MVP. */
  due: ISODate | null;

  delegationCandidate: DelegationCandidate;
  /** User-assigned person; independent of AI delegation recommendation. */
  assigneeName: string | null;

  /** AI's self-reported confidence in this triage, 0..1. */
  confidence: number;
  /** Optional clarifying question shown if confidence is low. */
  clarifyingQuestion: string | null;

  /** Free-form rationale the AI emits, shown in detail sheet only. */
  rationale: string | null;

  /**
   * Markdown brief generated by "Prepare for agent" — a clean handoff
   * document for an AI agent or a person. Null until generated.
   */
  agentBrief: string | null;

  /** Server-owned sift bookkeeping; never sent by the client. */
  siftId: ID | null;
  siftStage: SiftStage | null;
  plan: TaskPlan | null;

  labelIds: ID[];
  subtasks: Subtask[];

  /**
   * Field names the user has manually edited. Re-triage will respect these
   * and not overwrite them.
   */
  editedFields: TaskEditableField[];

  createdAt: ISODate;
  updatedAt: ISODate;
  /** When the task moved to `done`. Used by Today/Focus views. */
  completedAt: ISODate | null;
}

/** Subset of fields that can be edited (and thus protected from AI overwrite). */
export const TASK_EDITABLE_FIELDS = [
  "title",
  "description",
  "nextAction",
  "urgency",
  "importance",
  "priorityBucket",
  "effort",
  "due",
  "delegationCandidate",
  "assigneeName",
  "labelIds",
  "subtasks",
] as const;
export type TaskEditableField = (typeof TASK_EDITABLE_FIELDS)[number];

export interface AiRun {
  id: ID;
  taskId: ID;
  promptVersion: string;
  model: string;
  status: "running" | "succeeded" | "failed";
  startedAt: ISODate;
  finishedAt: ISODate | null;
  durationMs: number | null;
  /** Best-effort token usage for budget visibility. */
  inputTokens: number | null;
  outputTokens: number | null;
  costCents: number | null;
  error: string | null;
}

export interface Memory {
  id: ID;
  /** Free-form note; AI may retrieve a small bounded set of these. */
  text: string;
  /** "preference", "fact", "context" — kept loose on purpose. */
  kind: "preference" | "fact" | "context";
  pinned: boolean;
  createdAt: ISODate;
}

/**
 * Product tiers, lowest to highest. When several facts apply to one account
 * the effective tier is the highest: `creator > comped > pro > trialing > free`.
 *
 * - `free`: capture/organize/sync/reminders, a few sifts a day.
 * - `trialing`: 30-day Pro trial for new sign-ups.
 * - `pro`: paid via Stripe.
 * - `comped`: Pro granted by an invite code, no Stripe involved.
 * - `creator`: the owner account, unlimited.
 */
export const TIERS = ["free", "trialing", "pro", "comped", "creator"] as const;
export type Tier = (typeof TIERS)[number];

/** Per-feature caps; `Number.POSITIVE_INFINITY` means unlimited. */
export interface FeatureCaps {
  siftsPerDay: number;
  executionBudgetCentsMonth: number;
  connectorsAllowed: boolean;
  /** Nightly re-planning of Today/Focus and the manual "Re-plan today" action. */
  dailyPlan: boolean;
}

export interface Entitlement {
  tier: Tier;
  trialEndsAt: ISODate | null;
  /** When a comp ends; null when not comped or comped forever. */
  compedUntil: ISODate | null;
  siftsToday: number;
  caps: FeatureCaps;
}

export interface UserProfile {
  id: ID;
  email: string;
  displayName: string;
  isCreator: boolean;
  createdAt: ISODate;
}
