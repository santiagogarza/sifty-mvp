/**
 * Model registry.
 *
 * Sifty's UI lets users pick from a small, curated list of models. Adding a
 * model here is enough to surface it in Settings and route triage through it
 * via the AI Gateway. Keep this list small — the goal is calm choice, not a
 * provider catalog.
 */

export type ModelProvider = "anthropic" | "openai";

export interface ModelOption {
  /** Stable identifier persisted in user prefs and on `aiRuns`. */
  id: string;
  /** Provider-prefixed Gateway slug, e.g. "anthropic/claude-sonnet-4-5". */
  gatewaySlug: string;
  provider: ModelProvider;
  label: string;
  /** One-liner shown in the picker. */
  description: string;
  /**
   * Approximate per-1M-token costs. Used only to estimate `costCents` on the
   * `aiRuns` row when the provider doesn't return cost. Update freely; the
   * persistence schema is the contract, not the values.
   */
  inputUsdPerMillion: number;
  outputUsdPerMillion: number;
}

export const MODEL_OPTIONS: ReadonlyArray<ModelOption> = [
  {
    id: "claude-sonnet",
    gatewaySlug: "anthropic/claude-sonnet-4-5",
    provider: "anthropic",
    label: "Claude Sonnet",
    description: "Best-in-class triage. Slightly slower; worth it for high-stakes lists.",
    inputUsdPerMillion: 3,
    outputUsdPerMillion: 15,
  },
  {
    id: "claude-haiku",
    gatewaySlug: "anthropic/claude-haiku-4-5",
    provider: "anthropic",
    label: "Claude Haiku",
    description: "Fast, cheap, surprisingly good. The sensible default.",
    inputUsdPerMillion: 1,
    outputUsdPerMillion: 5,
  },
  {
    id: "gpt-4o",
    gatewaySlug: "openai/gpt-4o",
    provider: "openai",
    label: "GPT-4o",
    description: "Strong general-purpose alternative. Good if you prefer OpenAI's tone.",
    inputUsdPerMillion: 2.5,
    outputUsdPerMillion: 10,
  },
  {
    id: "gpt-4o-mini",
    gatewaySlug: "openai/gpt-4o-mini",
    provider: "openai",
    label: "GPT-4o mini",
    description: "Fastest path. Use for quick capture-heavy days.",
    inputUsdPerMillion: 0.15,
    outputUsdPerMillion: 0.6,
  },
] as const;

export const DEFAULT_MODEL_ID: ModelOption["id"] = "claude-haiku";

export function getModel(id: string | null | undefined): ModelOption {
  const match = MODEL_OPTIONS.find((m) => m.id === id);
  return match ?? MODEL_OPTIONS.find((m) => m.id === DEFAULT_MODEL_ID)!;
}

export function estimateCostCents(opts: {
  model: ModelOption;
  inputTokens: number | null;
  outputTokens: number | null;
}): number | null {
  if (opts.inputTokens == null || opts.outputTokens == null) return null;
  const inUsd = (opts.inputTokens / 1_000_000) * opts.model.inputUsdPerMillion;
  const outUsd = (opts.outputTokens / 1_000_000) * opts.model.outputUsdPerMillion;
  return Math.round((inUsd + outUsd) * 100);
}
