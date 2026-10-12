import type { SiftStage } from "@/lib/domain/types";
import { generateObject } from "ai";
import { resolveProvider, usageFromResult } from "../provider";
import type { TriageMeta } from "../triage-agent";
import { STAGE_DEFINITIONS, type SiftContext, type StageOutputs } from "./stages";

/**
 * Run one stage: pick the stage's model through `resolveProvider`, call
 * `generateObject` against the stage schema, and price the usage. With
 * `offline` the stage's deterministic variant answers instead and no
 * provider is resolved, so keyless dev and CI never touch the network.
 *
 * Pure with respect to storage: the caller applies the output and records
 * the run (`execute-stage.ts`).
 */

const HEURISTIC_MODEL = "sifty.local.heuristic";

export interface StageRunOptions {
  modelPreference?: string | null;
  offline: boolean;
}

export interface StageRunResult<S extends SiftStage> {
  output: StageOutputs[S];
  meta: TriageMeta;
}

export async function runStage<S extends SiftStage>(
  stage: S,
  ctx: SiftContext,
  opts: StageRunOptions,
): Promise<StageRunResult<S>> {
  const def = STAGE_DEFINITIONS[stage];
  const start = Date.now();

  if (opts.offline) {
    const output = def.schema.parse(def.offline(ctx));
    return {
      output,
      meta: {
        promptVersion: def.promptVersion,
        stage,
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

  const resolved = resolveProvider(stage, { preference: opts.modelPreference });
  const result = await generateObject({
    model: resolved.model,
    schema: def.schema,
    schemaName: def.schemaName,
    schemaDescription: def.schemaDescription,
    system: def.system,
    prompt: def.user(ctx),
    temperature: def.temperature,
  });
  const usage = usageFromResult(resolved, result);
  return {
    output: result.object,
    meta: {
      promptVersion: def.promptVersion,
      stage,
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

/** `TriageMeta` for a failure before or during a stage call. */
export function failedStageMeta(stage: SiftStage, offline: boolean): TriageMeta {
  return {
    promptVersion: STAGE_DEFINITIONS[stage].promptVersion,
    stage,
    model: "unknown",
    transport: offline ? "offline" : "unknown",
    durationMs: 0,
    inputTokens: null,
    outputTokens: null,
    costCents: null,
    offline,
  };
}
