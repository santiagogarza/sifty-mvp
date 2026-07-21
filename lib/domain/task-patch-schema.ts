import { z } from "zod";
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
    title: z.string().min(1).max(280).optional(),
    description: z.string().max(4000).nullable().optional(),
    /** Editable: clarifying-question answers append to it. */
    sourceContext: z.string().max(8000).nullable().optional(),
    nextAction: z.string().max(280).nullable().optional(),
    lifecycle: z.enum(LIFECYCLE).optional(),
    aiStatus: z.enum(AI_STATUS).optional(),
    aiError: z.string().max(2000).nullable().optional(),
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
    confidence: z.number().min(0).max(1).optional(),
    clarifyingQuestion: z.string().max(500).nullable().optional(),
    rationale: z.string().max(2000).nullable().optional(),
    agentBrief: z.string().max(8000).nullable().optional(),
    labelIds: z.array(ClientId).max(20).optional(),
    subtasks: z
      .array(
        z.object({
          id: z.string().max(64),
          title: z.string().min(1).max(160),
          done: z.boolean(),
          order: z.number().int().nonnegative(),
        }),
      )
      .max(20)
      .optional(),
    editedFields: z.array(z.enum(TASK_EDITABLE_FIELDS)).max(20).optional(),
  })
  .strict();

export type TaskPatchInput = z.infer<typeof TaskPatchSchema>;
