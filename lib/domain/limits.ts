/**
 * Wire-format size limits, shared by the server Zod schemas and the client
 * (input `maxLength`s + push-time clamps). One source of truth so the
 * strict API can never reject an entity the UI allowed — a drifted limit
 * would wedge the sync replay loop.
 */

export const TASK_LIMITS = {
  sourceText: 4000,
  sourceContext: 8000,
  title: 280,
  description: 4000,
  nextAction: 280,
  aiError: 2000,
  rationale: 2000,
  clarifyingQuestion: 500,
  agentBrief: 8000,
  subtaskTitle: 160,
  maxSubtasks: 20,
  maxLabels: 20,
} as const;

export const LABEL_LIMITS = {
  name: 24,
} as const;

export const MEMORY_LIMITS = {
  text: 2000,
} as const;

/** Bounded context passed to AI routes (triage, brief). */
export const AI_CONTEXT_LIMITS = {
  maxPreferences: 20,
  maxRecentLabels: 20,
} as const;
