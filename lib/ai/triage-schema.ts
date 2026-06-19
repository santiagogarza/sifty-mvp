import { z } from "zod";

/**
 * Structured output schema for `triageTask`.
 *
 * Versioned because the prompt and schema evolve together. When the schema
 * changes, bump `TRIAGE_PROMPT_VERSION` so older `ai_runs` records can be
 * interpreted correctly later.
 */

export const TRIAGE_PROMPT_VERSION = "triage.v1";

export const TriageOutput = z.object({
  title: z.string().min(1).max(140),
  description: z.string().max(1200).nullable(),
  nextAction: z.string().max(160).nullable(),

  urgency: z.number().min(0).max(1),
  importance: z.number().min(0).max(1),

  effort: z.enum(["quick", "small", "medium", "deep"]),

  /** Day-precision ISO date or null if no clear due signal. */
  dueHint: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "due must be YYYY-MM-DD")
    .nullable(),

  delegationCandidate: z.enum(["self", "ai", "person", "unsure"]),

  /** Up to 3 short labels suggested by the model. */
  suggestedLabels: z.array(z.string().min(1).max(24)).max(3),

  /** Up to 5 sub-actions. Empty array if not warranted. */
  subtasks: z.array(z.string().min(1).max(160)).max(5),

  /** Free-form short rationale, never shown above the fold. */
  rationale: z.string().max(600).nullable(),

  confidence: z.number().min(0).max(1),

  /** Set only when confidence is low and a single question would unblock. */
  clarifyingQuestion: z.string().max(200).nullable(),
});

export type TriageOutput = z.infer<typeof TriageOutput>;
