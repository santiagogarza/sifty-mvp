import { nanoid } from "nanoid";
import type { TriageMeta } from "./triage-agent";

/**
 * `aiRuns` ring buffer.
 *
 * Stage 1 keeps this in-memory on the server process so the triage route can
 * write rows without requiring a database. Stage 2 swaps this implementation
 * for a Drizzle-backed table without touching call sites.
 *
 * The shape is the contract — keep it in sync with the eventual `ai_runs`
 * SQL table in `lib/db/schema.ts`.
 */

export type AiRunStatus = "succeeded" | "failed";

export interface AiRunRecord {
  id: string;
  userId: string;
  taskId: string | null;
  promptVersion: string;
  model: string;
  transport: string;
  status: AiRunStatus;
  durationMs: number;
  inputTokens: number | null;
  outputTokens: number | null;
  costCents: number | null;
  offline: boolean;
  error: string | null;
  createdAt: string;
}

const MAX_RECORDS = 500;
const RECORDS: AiRunRecord[] = [];

export interface RecordRunInput {
  userId: string;
  taskId?: string | null;
  meta: TriageMeta;
  status: AiRunStatus;
  error?: string | null;
}

export function recordAiRun(input: RecordRunInput): AiRunRecord {
  const record: AiRunRecord = {
    id: nanoid(12),
    userId: input.userId,
    taskId: input.taskId ?? null,
    promptVersion: input.meta.promptVersion,
    model: input.meta.model,
    transport: input.meta.transport,
    status: input.status,
    durationMs: input.meta.durationMs,
    inputTokens: input.meta.inputTokens,
    outputTokens: input.meta.outputTokens,
    costCents: input.meta.costCents,
    offline: input.meta.offline,
    error: input.error ?? null,
    createdAt: new Date().toISOString(),
  };
  RECORDS.push(record);
  if (RECORDS.length > MAX_RECORDS) RECORDS.shift();
  return record;
}

export function countAiRunsToday(userId: string, now: Date = new Date()): number {
  const dayStart = new Date(now);
  dayStart.setHours(0, 0, 0, 0);
  const start = dayStart.getTime();
  return RECORDS.filter(
    (r) =>
      r.userId === userId &&
      r.status === "succeeded" &&
      !r.offline &&
      Date.parse(r.createdAt) >= start,
  ).length;
}

export function listAiRuns(userId: string, limit = 50): AiRunRecord[] {
  return RECORDS.filter((r) => r.userId === userId)
    .slice(-limit)
    .reverse();
}

/** Test-only helper. */
export function __resetAiRuns(): void {
  RECORDS.length = 0;
}
