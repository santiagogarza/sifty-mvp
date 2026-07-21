import { getRepos } from "@/lib/db/repos";
import type { TriageMeta } from "./triage-agent";

/**
 * `aiRuns` accessor — thin wrapper over the repository so call sites stay
 * concise. The DB-backed implementation handles persistence; tests use the
 * in-memory implementation via `setReposForTesting()`.
 */

export type AiRunStatus = "succeeded" | "failed";

export interface RecordRunInput {
  userId: string;
  taskId?: string | null;
  meta: TriageMeta;
  status: AiRunStatus;
  error?: string | null;
}

export async function recordAiRun(input: RecordRunInput): Promise<{ id: string }> {
  const repos = getRepos();
  const result = await repos.aiRuns.insert({
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
  });
  return { id: result.id };
}

export async function countAiRunsToday(userId: string, now: Date = new Date()): Promise<number> {
  const repos = getRepos();
  return repos.aiRuns.countSucceededToday(userId, now);
}

/** All runs (any status) since `since` — backs the sliding-window limit. */
export async function countAiRunsSince(userId: string, since: Date): Promise<number> {
  const repos = getRepos();
  return repos.aiRuns.countSince(userId, since);
}

export async function listAiRuns(userId: string, limit = 50) {
  const repos = getRepos();
  return repos.aiRuns.list(userId, limit);
}
