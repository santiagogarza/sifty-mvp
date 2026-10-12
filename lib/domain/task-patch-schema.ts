import { z } from "zod";
import { normalizeAssigneeName } from "./assignee";
import { TASK_LIMITS } from "./limits";
import {
  AI_STATUS,
  DELEGATION_CANDIDATE,
  EFFORT,
  LIFECYCLE,
  PRIORITY_BUCKET,
  RECURRENCE_FREQ,
  RECURRENCE_MODE,
  TASK_EDITABLE_FIELDS,
} from "./types";

/**
 * Wire schema for task mutations.
 *
 * Shared by `POST /api/tasks` (optimistic create can carry enrichment when
 * the sync layer replays an offline-captured task) and `PATCH
 * /api/tasks/[id]`. Client input is untrusted; everything is validated here
 * before touching the repos.
 */

/** Client-generated entity ids: `prefix_<base36>`. */
export const ClientId = z
  .string()
  .regex(/^[a-z]+_[a-z0-9]+$/i)
  .max(64);

const Title = z.string().min(1).max(TASK_LIMITS.title);
const Description = z.string().max(TASK_LIMITS.description).nullable();
const NextAction = z.string().max(TASK_LIMITS.nextAction).nullable();
const Scalar = z.number().min(0).max(1);
const AssigneeName = z.string().max(TASK_LIMITS.assigneeName).nullable();
const LabelIds = z.array(ClientId).max(TASK_LIMITS.maxLabels);
const Subtasks = z
  .array(
    z.object({
      id: z.string().max(64),
      title: z.string().min(1).max(TASK_LIMITS.subtaskTitle),
      done: z.boolean(),
      order: z.number().int().nonnegative(),
    }),
  )
  .max(TASK_LIMITS.maxSubtasks);

/** Series values parked by "this instance only" edits (`SERIES_FIELDS`). */
const SeriesValuesSchema = z
  .object({
    title: Title,
    description: Description,
    nextAction: NextAction,
    urgency: Scalar,
    importance: Scalar,
    priorityBucket: z.enum(PRIORITY_BUCKET),
    effort: z.enum(EFFORT),
    delegationCandidate: z.enum(DELEGATION_CANDIDATE),
    assigneeName: AssigneeName,
    labelIds: LabelIds,
    subtasks: Subtasks,
  })
  .partial()
  .strict();

export const RecurrenceSchema = z
  .object({
    freq: z.enum(RECURRENCE_FREQ),
    mode: z.enum(RECURRENCE_MODE),
    weekdays: z.array(z.number().int().min(0).max(6)).max(7).optional(),
    dayOfMonth: z.number().int().min(1).max(31).optional(),
    seriesValues: SeriesValuesSchema.optional(),
    spawnedFrom: ClientId.optional(),
  })
  .strict();

export const TaskPatchSchema = z
  .object({
    title: Title.optional(),
    description: Description.optional(),
    /** Editable: clarifying-question answers append to it. */
    sourceContext: z.string().max(TASK_LIMITS.sourceContext).nullable().optional(),
    nextAction: NextAction.optional(),
    lifecycle: z.enum(LIFECYCLE).optional(),
    aiStatus: z.enum(AI_STATUS).optional(),
    aiError: z.string().max(TASK_LIMITS.aiError).nullable().optional(),
    aiAttempts: z.number().int().nonnegative().optional(),
    urgency: Scalar.optional(),
    importance: Scalar.optional(),
    priorityBucket: z.enum(PRIORITY_BUCKET).optional(),
    effort: z.enum(EFFORT).optional(),
    due: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .nullable()
      .optional(),
    delegationCandidate: z.enum(DELEGATION_CANDIDATE).optional(),
    assigneeName: AssigneeName.optional().transform((v) =>
      v === undefined ? undefined : normalizeAssigneeName(v),
    ),
    confidence: Scalar.optional(),
    clarifyingQuestion: z.string().max(TASK_LIMITS.clarifyingQuestion).nullable().optional(),
    rationale: z.string().max(TASK_LIMITS.rationale).nullable().optional(),
    agentBrief: z.string().max(TASK_LIMITS.agentBrief).nullable().optional(),
    labelIds: LabelIds.optional(),
    subtasks: Subtasks.optional(),
    recurrence: RecurrenceSchema.nullable().optional(),
    seriesId: ClientId.nullable().optional(),
    editedFields: z.array(z.enum(TASK_EDITABLE_FIELDS)).max(20).optional(),
    /**
     * Completion context for a recurring task, not task fields: the user's
     * calendar day of completion (what the next due is computed from), the
     * client's IANA zone as a fallback when the day is absent, and the
     * status the task had before it was completed (where the next instance
     * lands) for when the server can no longer tell.
     */
    completedOn: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
    timeZone: z.string().max(64).refine(isValidTimeZone, "unknown time zone").optional(),
    completedFrom: z.enum(LIFECYCLE).optional(),
  })
  .strict();

function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export type TaskPatchInput = z.infer<typeof TaskPatchSchema>;
