import {
  type MemoryExtractInput,
  type MemoryExtractOutcome,
  extractMemories,
} from "@/lib/ai/memory/execute";
import { getWorkflowMetadata } from "workflow";

/**
 * `memoryFromEdit` — when a user edit reverses something the sift wrote,
 * ask whether that reveals a durable preference. One step; fired by
 * `PATCH /api/tasks/:id` at most once per task and sift. No per-user slot:
 * the run is short and cannot conflict with a sift (it only reads).
 */
export async function memoryFromEdit(input: MemoryExtractInput): Promise<MemoryExtractOutcome> {
  "use workflow";
  const { workflowRunId } = getWorkflowMetadata();
  console.log(`[workflow] memory from edit on ${input.taskId} (${workflowRunId})`);
  return extractStep(input, workflowRunId);
}

async function extractStep(
  input: MemoryExtractInput,
  runId: string,
): Promise<MemoryExtractOutcome> {
  "use step";
  return extractMemories(input, runId);
}
