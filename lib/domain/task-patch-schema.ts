import { z } from "zod";
import { normalizeAssigneeName } from "./assignee";
import { TASK_LIMITS } from "./limits";
import {
  AI_STATUS,
  DELEGATION_CANDIDATE,
  EFFORT,
  LIFECYCLE,
  PRIORITY_BUCKET,
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

export const TaskPatchSchema = z
  .object({
    title: z.string().min(1).max(TASK_LIMITS.title).optional(),
    description: z.string().max(TASK_LIMITS.description).nullable().optional(),
    /** Editable: clarifying-question answers append to it. */
    sourceContext: z.string().max(TASK_LIMITS.sourceContext).nullable().optional(),
    nextAction: z.string().max(TASK_LIMITS.nextAction).nullable().optional(),
    lifecycle: z.enum(LIFECYCLE).optional(),
    aiStatus: z.enum(AI_STATUS).optional(),
    aiError: z.string().max(TASK_LIMITS.aiError).nullable().optional(),
    aiAttempts: z.number().int().nonnegative().optional(),
    urgency: z.number().min(0).max(1).optional(),
    importance: z.number().min(0).max(1).optional(),
    priorityBucket: z.enum(PRIORITY_BUCKET).optional(),
    effort: z.enum(EFFORT).optional(),
    due: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .nullable()
      .optional(),
    delegationCandidate: z.enum(DELEGATION_CANDIDATE).optional(),
    assigneeName: z
      .string()
      .max(TASK_LIMITS.assigneeName)
      .nullable()
      .optional()
      .transform((v) => (v === undefined ? undefined : normalizeAssigneeName(v))),
    confidence: z.number().min(0).max(1).optional(),
    clarifyingQuestion: z.string().max(TASK_LIMITS.clarifyingQuestion).nullable().optional(),
    rationale: z.string().max(TASK_LIMITS.rationale).nullable().optional(),
    agentBrief: z.string().max(TASK_LIMITS.agentBrief).nullable().optional(),
    labelIds: z.array(ClientId).max(TASK_LIMITS.maxLabels).optional(),
    subtasks: z
      .array(
        z.object({
          id: z.string().max(64),
          title: z.string().min(1).max(TASK_LIMITS.subtaskTitle),
          done: z.boolean(),
          order: z.number().int().nonnegative(),
        }),
      )
      .max(TASK_LIMITS.maxSubtasks)
      .optional(),
    editedFields: z.array(z.enum(TASK_EDITABLE_FIELDS)).max(20).optional(),
  })
  .strict();

export type TaskPatchInput = z.infer<typeof TaskPatchSchema>;
