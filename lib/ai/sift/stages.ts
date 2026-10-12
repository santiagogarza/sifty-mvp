import type { Task } from "@/lib/domain/types";
import { z } from "zod";
import { heuristicTriage } from "../triage-agent";

/**
 * The five sift stages: schema, prompt, prompt version, and the
 * deterministic offline variant for each.
 *
 * Stages are independently retryable, evaluable, and billable, so each one
 * carries its own `promptVersion` (bump when its prompt *or* schema
 * changes) and its own Zod contract. The offline variants slice the
 * single-shot heuristic (`heuristicTriage`) so `SIFTY_AI_OFFLINE=1` yields
 * the same task the old synchronous triage did, stage by stage.
 *
 * Nothing here talks to a model or the database: `run-stage.ts` executes a
 * stage, `apply.ts` writes its output to the task.
 */

export const SIFT_PROMPT_VERSION = "sift.v1";

/** What every stage sees. Built once per step from the repos. */
export interface SiftContext {
  task: Task;
  todayIso: string;
  /** Existing label names, most useful first. */
  recentLabels: string[];
  /** Pinned memories. */
  preferences: string[];
  /** The user's other open tasks, for list-aware prioritization. */
  openTasks: OpenTaskSummary[];
}

export interface OpenTaskSummary {
  title: string;
  lifecycle: Task["lifecycle"];
  due: string | null;
  urgency: number;
  importance: number;
  effort: Task["effort"];
}

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

export const EnrichOutput = z.object({
  title: z.string().min(1).max(140),
  description: z.string().max(1200).nullable(),
  nextAction: z.string().max(160).nullable(),
  /** Day-precision ISO date or null when the text carries no real signal. */
  dueHint: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "due must be YYYY-MM-DD")
    .nullable(),
  suggestedLabels: z.array(z.string().min(1).max(24)).max(3),
});
export type EnrichOutput = z.infer<typeof EnrichOutput>;

export const PrioritizeOutput = z.object({
  urgency: z.number().min(0).max(1),
  importance: z.number().min(0).max(1),
  effort: z.enum(["quick", "small", "medium", "deep"]),
  /** Why, relative to the rest of the list. Shown in the detail sheet. */
  rationale: z.string().max(600).nullable(),
});
export type PrioritizeOutput = z.infer<typeof PrioritizeOutput>;

export const TriageStageOutput = z.object({
  /** Where the task belongs. Only `waiting` and `someday` move a task out of the inbox. */
  routing: z.enum(["inbox", "active", "waiting", "someday"]),
  delegationCandidate: z.enum(["self", "ai", "person", "unsure"]),
  confidence: z.number().min(0).max(1),
  /** Set only when confidence is low and one question would unblock. */
  clarifyingQuestion: z.string().max(200).nullable(),
});
export type TriageStageOutput = z.infer<typeof TriageStageOutput>;

export const SubtasksOutput = z.object({
  /** Up to 5 sub-actions; empty when the task is a single step. */
  subtasks: z.array(z.string().min(1).max(160)).max(5),
});
export type SubtasksOutput = z.infer<typeof SubtasksOutput>;

export const PlanOutput = z.object({
  executor: z.enum(["self", "ai_agent", "cursor_agent", "person", "none"]),
  approach: z.string().max(400).nullable(),
  connectors: z.array(z.string().min(1).max(32)).max(5),
  readyForAi: z.boolean(),
  blockers: z.string().max(300).nullable(),
});
export type PlanOutput = z.infer<typeof PlanOutput>;

export type StageOutputs = {
  enrich: EnrichOutput;
  prioritize: PrioritizeOutput;
  triage: TriageStageOutput;
  subtasks: SubtasksOutput;
  plan: PlanOutput;
};

// ---------------------------------------------------------------------------
// Prompts
// ---------------------------------------------------------------------------

const STYLE = `Style:
- Be calm and concise. Verbs first. No emoji. No hype.
- Never invent dates, people, or context not present in the input.
- Output must conform to the supplied JSON schema exactly.`;

function taskBlock(ctx: SiftContext): string {
  const t = ctx.task;
  return [
    `Today is ${ctx.todayIso}.`,
    ctx.preferences.length ? `User preferences:\n- ${ctx.preferences.join("\n- ")}` : null,
    "",
    "Task as captured:",
    t.sourceText,
    t.sourceContext ? `\nAdditional context:\n${t.sourceContext}` : null,
  ]
    .filter((line) => line !== null)
    .join("\n");
}

/** A due the user confirmed at capture (or edited since): protected, and not worth restating. */
function userSetDue(t: Task): boolean {
  return t.due !== null && t.editedFields.includes("due");
}

/**
 * Offline stand-in for the model's "leave the date out of the title": the
 * capture chip already stripped the phrase from the provisional title, so
 * that title is the cleanest text available.
 */
function titleWithoutDate(t: Task): string {
  return t.title.trim() || t.sourceText.trim();
}

function currentState(t: Task): string {
  return [
    `Current title: ${t.title}`,
    t.nextAction ? `Next action: ${t.nextAction}` : null,
    t.due ? `Due: ${t.due}` : null,
    `Urgency ${t.urgency.toFixed(2)}, importance ${t.importance.toFixed(2)}, effort ${t.effort}.`,
  ]
    .filter(Boolean)
    .join("\n");
}

interface StageDefinition<S extends keyof StageOutputs> {
  promptVersion: string;
  schema: z.ZodType<StageOutputs[S]>;
  schemaName: string;
  schemaDescription: string;
  system: string;
  user(ctx: SiftContext): string;
  /** Deterministic variant for `SIFTY_AI_OFFLINE=1` and tests. */
  offline(ctx: SiftContext): StageOutputs[S];
  temperature: number;
}

function offlineBase(ctx: SiftContext) {
  return heuristicTriage({
    sourceText: ctx.task.sourceText,
    sourceContext: ctx.task.sourceContext,
    recentLabels: ctx.recentLabels,
    preferences: ctx.preferences,
    offline: true,
  });
}

const WAITING_RE =
  /\b(wait(ing)? (for|on|until)|blocked (on|by)|once \w+ (replies|responds|sends))\b/i;
const SOMEDAY_RE = /\b(someday|some day|one day|maybe|eventually|not urgent at all)\b/i;

export const STAGE_DEFINITIONS: { [S in keyof StageOutputs]: StageDefinition<S> } = {
  enrich: {
    promptVersion: "enrich.v2",
    schema: EnrichOutput,
    schemaName: "EnrichOutput",
    schemaDescription: "Clean title, description, next action, due hint, and labels for a task.",
    temperature: 0.2,
    system: `You enrich freshly captured tasks for an AI productivity app called Sifty.

${STYLE}

For the task, produce:
- A clean title (3-7 words is great) and, only if it helps, a short description.
- A single GTD-style next physical action: concrete, doable in one sitting.
- dueHint only when the text contains a real signal ("by Friday", a date). Otherwise null.
- Up to 3 short labels. Prefer the user's existing labels when they fit.`,
    user: (ctx) =>
      [
        taskBlock(ctx),
        userSetDue(ctx.task)
          ? `\nThe user already set the due date to ${ctx.task.due}. Leave the date phrase out of the title and the next action; dueHint is ignored.`
          : null,
        ctx.recentLabels.length
          ? `\nUser's existing labels (prefer reusing): ${ctx.recentLabels.join(", ")}.`
          : null,
      ]
        .filter(Boolean)
        .join("\n"),
    offline: (ctx) => {
      const h = offlineBase(ctx);
      return {
        title: userSetDue(ctx.task) ? titleWithoutDate(ctx.task) : h.title,
        description: h.description,
        nextAction: h.nextAction,
        dueHint: h.dueHint,
        suggestedLabels: h.suggestedLabels,
      };
    },
  },

  prioritize: {
    promptVersion: "prioritize.v1",
    schema: PrioritizeOutput,
    schemaName: "PrioritizeOutput",
    schemaDescription: "Urgency, importance, and effort for a task relative to the user's list.",
    temperature: 0.2,
    system: `You prioritize one task against the rest of a user's list for an AI productivity app called Sifty.

${STYLE}

Score urgency and importance in [0,1]. Reserve >= 0.85 for clear emergencies or
high-stakes commitments; casual asks sit around 0.4. Look at the other open
tasks: if several are already due sooner or matter more, this one should not
outrank them without a reason. Effort: quick (<10 min), small (<30 min),
medium (1-3 hr), deep (multi-session). The rationale is one or two sentences
that mention the comparison when it changed your mind.`,
    user: (ctx) => {
      const others = ctx.openTasks
        .slice(0, 25)
        .map(
          (o) =>
            `- [${o.lifecycle}] ${o.title}${o.due ? ` (due ${o.due})` : ""} — u${o.urgency.toFixed(2)} i${o.importance.toFixed(2)} ${o.effort}`,
        );
      return [
        taskBlock(ctx),
        "",
        currentState(ctx.task),
        "",
        others.length
          ? `Other open tasks (${others.length}):\n${others.join("\n")}`
          : "No other open tasks.",
      ].join("\n");
    },
    offline: (ctx) => {
      const h = offlineBase(ctx);
      return {
        urgency: h.urgency,
        importance: h.importance,
        effort: h.effort,
        rationale: h.rationale,
      };
    },
  },

  triage: {
    promptVersion: "triage.v2",
    schema: TriageStageOutput,
    schemaName: "TriageStageOutput",
    schemaDescription: "Routing, delegation candidate, confidence, and clarifying question.",
    temperature: 0.2,
    system: `You triage one task for an AI productivity app called Sifty.

${STYLE}

Decide:
- routing: "waiting" when the task is blocked on someone else's reply or
  event, "someday" when it is explicitly aspirational with no horizon,
  "active" when it is clearly the next thing to do, otherwise "inbox".
- delegationCandidate: most personal tasks are "self". "ai" only when the
  task is well-defined and verifiable. "person" when handing off to a human is
  clearly right. Use "unsure" rather than guessing.
- confidence in [0,1]. Below 0.55, set one clarifyingQuestion the user can
  answer in under 10 seconds. Otherwise leave it null.`,
    user: (ctx) => [taskBlock(ctx), "", currentState(ctx.task)].join("\n"),
    offline: (ctx) => {
      const h = offlineBase(ctx);
      const text = `${ctx.task.sourceText}\n${ctx.task.sourceContext ?? ""}`;
      const routing = WAITING_RE.test(text)
        ? "waiting"
        : SOMEDAY_RE.test(text)
          ? "someday"
          : "inbox";
      return {
        routing,
        delegationCandidate: h.delegationCandidate,
        confidence: h.confidence,
        clarifyingQuestion: h.clarifyingQuestion,
      };
    },
  },

  subtasks: {
    promptVersion: "subtasks.v1",
    schema: SubtasksOutput,
    schemaName: "SubtasksOutput",
    schemaDescription: "Up to five concrete sub-actions, or none.",
    temperature: 0.2,
    system: `You break a task into sub-actions for an AI productivity app called Sifty.

${STYLE}

Return up to 5 subtasks only when the work genuinely has distinct steps
(medium or deep effort, or several named deliverables). A quick or small
single action gets an empty list. Each subtask starts with a verb and is
doable on its own.`,
    user: (ctx) => [taskBlock(ctx), "", currentState(ctx.task)].join("\n"),
    offline: (ctx) => ({ subtasks: offlineBase(ctx).subtasks }),
  },

  plan: {
    promptVersion: "plan.v1",
    schema: PlanOutput,
    schemaName: "PlanOutput",
    schemaDescription: "Whether and how an executor could do this task.",
    temperature: 0.3,
    system: `You plan how a task could get done for an AI productivity app called Sifty, which can
delegate work to executors: a model agent with connectors (email, calendar,
Slack, Linear, Notion, GitHub, web research), a Cursor coding agent for code
in the user's repositories, or a person.

${STYLE}

Decide:
- executor: "ai_agent" for research, drafting, messages, scheduling, or
  document work a model could do with the right connector; "cursor_agent"
  for changes to code; "person" when a human other than the user should do
  it; "self" when only the user can; "none" when nothing needs doing yet.
- approach: one or two sentences on how the executor would proceed.
- connectors: short slugs the approach needs, from: gmail, calendar, slack,
  linear, notion, github, web. Empty when none.
- readyForAi: true only if an executor could start now without asking.
- blockers: what is missing (access, an unclear outcome, a decision), or null.
Nothing here is executed automatically; every side effect is drafted for approval.`,
    user: (ctx) =>
      [
        taskBlock(ctx),
        "",
        currentState(ctx.task),
        ctx.task.subtasks.length
          ? `Subtasks:\n- ${ctx.task.subtasks.map((s) => s.title).join("\n- ")}`
          : null,
        `Delegation candidate so far: ${ctx.task.delegationCandidate}.`,
      ]
        .filter(Boolean)
        .join("\n"),
    offline: (ctx) => {
      const h = offlineBase(ctx);
      const executor =
        h.delegationCandidate === "ai"
          ? "ai_agent"
          : h.delegationCandidate === "person"
            ? "person"
            : "self";
      return {
        executor,
        approach: h.nextAction,
        connectors: [],
        readyForAi: executor === "ai_agent",
        blockers: executor === "ai_agent" ? null : "Only the user can do this.",
      };
    },
  },
};
