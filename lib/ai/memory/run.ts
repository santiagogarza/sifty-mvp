import { generateObject } from "ai";
import { resolveProvider, usageFromResult } from "../provider";
import type { TriageMeta } from "../triage-agent";
import {
  MEMORY_PROMPT_VERSION,
  MEMORY_STAGE,
  MEMORY_SYSTEM_PROMPT,
  MEMORY_TEMPERATURE,
  type MemoryContext,
  MemoryExtractionOutput,
  buildMemoryUserPrompt,
  offlineMemoryExtraction,
} from "./extract";

/**
 * One model call on the `memory` route (fast class). Offline answers with
 * the regex variant and never resolves a provider. Pure with respect to
 * storage; `execute.ts` records the run and files the proposals.
 */

const HEURISTIC_MODEL = "sifty.local.heuristic";

export async function runMemoryExtraction(
  ctx: MemoryContext,
  opts: { modelPreference?: string | null; offline: boolean },
): Promise<{ output: MemoryExtractionOutput; meta: TriageMeta }> {
  const start = Date.now();
  if (opts.offline) {
    return {
      output: offlineMemoryExtraction(ctx),
      meta: {
        promptVersion: MEMORY_PROMPT_VERSION,
        stage: MEMORY_STAGE,
        model: HEURISTIC_MODEL,
        transport: "offline",
        durationMs: Date.now() - start,
        inputTokens: null,
        outputTokens: null,
        costCents: null,
        offline: true,
      },
    };
  }
  const resolved = resolveProvider(MEMORY_STAGE, { preference: opts.modelPreference });
  const result = await generateObject({
    model: resolved.model,
    schema: MemoryExtractionOutput,
    schemaName: "MemoryExtractionOutput",
    schemaDescription: "Durable facts or preferences about the user worth remembering, or none.",
    system: MEMORY_SYSTEM_PROMPT,
    prompt: buildMemoryUserPrompt(ctx),
    temperature: MEMORY_TEMPERATURE,
  });
  const usage = usageFromResult(resolved, result);
  return {
    output: result.object,
    meta: {
      promptVersion: MEMORY_PROMPT_VERSION,
      stage: MEMORY_STAGE,
      model: usage.model,
      transport: resolved.transport,
      durationMs: Date.now() - start,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      costCents: usage.costCents,
      offline: false,
    },
  };
}

export function failedMemoryMeta(offline: boolean): TriageMeta {
  return {
    promptVersion: MEMORY_PROMPT_VERSION,
    stage: MEMORY_STAGE,
    model: "unknown",
    transport: offline ? "offline" : "unknown",
    durationMs: 0,
    inputTokens: null,
    outputTokens: null,
    costCents: null,
    offline,
  };
}
