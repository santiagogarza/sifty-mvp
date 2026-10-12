import { type AiTransport, readAiTransport, resolveProvider } from "@/lib/ai/provider";
import { SIFT_STAGES } from "@/lib/domain/types";

/**
 * How this eval run talks to models.
 *
 * - `SIFTY_AI_OFFLINE=1`: every stage answers with its deterministic
 *   offline variant. No key, no network; this is what runs on every PR.
 * - otherwise: the configured `AI_TRANSPORT` with real models. Keys are
 *   verified for every stage up front so a misconfigured nightly fails in
 *   the first second with the provider's own message, not halfway through.
 *
 * `EVAL_UPDATE_BASELINES=1` rewrites `evals/baselines/*` from this run
 * instead of comparing against them.
 */
export interface EvalMode {
  offline: boolean;
  transport: "offline" | AiTransport;
  update: boolean;
  /** Parallel captures when online; offline runs are instant anyway. */
  concurrency: number;
  /** Optional id prefix filter (`EVAL_ONLY=adv-`) for quick iterations. */
  only: string | null;
}

type Env = Record<string, string | undefined>;

export function resolveEvalMode(env: Env = process.env): EvalMode {
  const offline = env.SIFTY_AI_OFFLINE === "1";
  const update = env.EVAL_UPDATE_BASELINES === "1";
  const concurrency = clampInt(env.EVAL_CONCURRENCY, 1, 8, 4);
  const only = env.EVAL_ONLY?.trim() || null;

  if (offline) return { offline, transport: "offline", update, concurrency, only };

  const transport = readAiTransport(env);
  for (const stage of SIFT_STAGES) resolveProvider(stage, { env });
  return { offline, transport, update, concurrency, only };
}

/**
 * Baselines are recorded only from a full-set update run: a filtered
 * (`EVAL_ONLY`) run would replace whole-set averages and rubric results
 * with a subset's.
 */
export function recordsBaselines(mode: Pick<EvalMode, "update" | "only">): boolean {
  return mode.update && mode.only === null;
}

export function describeMode(mode: EvalMode): string {
  return mode.offline
    ? "offline (deterministic heuristic)"
    : `online via AI_TRANSPORT=${mode.transport}`;
}

function clampInt(raw: string | undefined, min: number, max: number, fallback: number): number {
  const n = Number.parseInt(raw ?? "", 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}
