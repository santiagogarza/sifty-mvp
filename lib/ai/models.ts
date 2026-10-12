/**
 * Model registry.
 *
 * Three layers, all transport-agnostic:
 *
 *  1. `MODELS` — every model Sifty may call, keyed by its canonical
 *     `provider/model` slug (the AI Gateway id). Carries the provider-native
 *     id used in `direct` mode and the list prices used for `ai_runs.cost_cents`.
 *  2. `STAGE_ROUTES` — per pipeline stage, a primary model plus an ordered
 *     fallback list. Haiku-class for the cheap, frequent stages; Sonnet-class
 *     for planning and execution. Every stage has one OpenAI fallback so a
 *     provider outage never stalls the pipeline.
 *  3. `MODEL_PREFERENCES` — the small set of choices surfaced in Settings.
 *     A preference rewrites stage routes by model class; the UI never sees
 *     raw model ids.
 *
 * `lib/ai/provider.ts` turns a route into an AI SDK model for the configured
 * transport. Nothing here imports a provider SDK.
 */

export type ModelProvider = "anthropic" | "openai";

/** Canonical `provider/model` id, e.g. "anthropic/claude-haiku-4.5". */
export type ModelSlug = `${ModelProvider}/${string}`;

/** Cost/quality class a stage asks for. Preferences remap by class. */
export type ModelClass = "fast" | "deep";

export interface ModelSpec {
  slug: ModelSlug;
  provider: ModelProvider;
  /** Id the provider's own API expects (used by the `direct` transport). */
  directId: string;
  class: ModelClass;
  label: string;
  /**
   * List prices in USD per 1M tokens. These drive `ai_runs.cost_cents` in
   * both transports so spend reporting never depends on a vendor dashboard.
   */
  inputUsdPerMillion: number;
  outputUsdPerMillion: number;
}

export const MODELS = {
  "anthropic/claude-haiku-4.5": {
    slug: "anthropic/claude-haiku-4.5",
    provider: "anthropic",
    directId: "claude-haiku-4-5",
    class: "fast",
    label: "Claude Haiku 4.5",
    inputUsdPerMillion: 1,
    outputUsdPerMillion: 5,
  },
  "anthropic/claude-sonnet-4.5": {
    slug: "anthropic/claude-sonnet-4.5",
    provider: "anthropic",
    directId: "claude-sonnet-4-5",
    class: "deep",
    label: "Claude Sonnet 4.5",
    inputUsdPerMillion: 3,
    outputUsdPerMillion: 15,
  },
  "openai/gpt-5-mini": {
    slug: "openai/gpt-5-mini",
    provider: "openai",
    directId: "gpt-5-mini",
    class: "fast",
    label: "GPT-5 mini",
    inputUsdPerMillion: 0.25,
    outputUsdPerMillion: 2,
  },
  "openai/gpt-5": {
    slug: "openai/gpt-5",
    provider: "openai",
    directId: "gpt-5",
    class: "deep",
    label: "GPT-5",
    inputUsdPerMillion: 1.25,
    outputUsdPerMillion: 10,
  },
} as const satisfies Record<ModelSlug, ModelSpec>;

export type KnownModelSlug = keyof typeof MODELS;

export const MODEL_SLUGS = Object.keys(MODELS) as KnownModelSlug[];

export function isKnownModel(slug: string): slug is KnownModelSlug {
  return Object.hasOwn(MODELS, slug);
}

export function getModelSpec(slug: KnownModelSlug): ModelSpec {
  return MODELS[slug];
}

/**
 * Looks a model up by canonical slug or by provider-native id (what a direct
 * provider or the Gateway reports back in `response.modelId`). Dated
 * snapshot ids like `claude-haiku-4-5-20251001` match their base id. An
 * exact id wins, then the longest prefix, so `gpt-5-mini-2025…` resolves to
 * `gpt-5-mini` regardless of registry order.
 */
export function findModelSpec(id: string | null | undefined): ModelSpec | null {
  if (!id) return null;
  if (isKnownModel(id)) return MODELS[id];
  const bare = id.includes("/") ? id.slice(id.indexOf("/") + 1) : id;
  let best: ModelSpec | null = null;
  for (const spec of Object.values(MODELS)) {
    if (spec.directId === bare) return spec;
    if (
      bare.startsWith(`${spec.directId}-`) &&
      (!best || spec.directId.length > best.directId.length)
    ) {
      best = spec;
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// Stages
// ---------------------------------------------------------------------------

export const STAGES = [
  "enrich",
  "prioritize",
  "triage",
  "subtasks",
  "plan",
  "execute",
  "digest",
  "memory",
] as const;
export type Stage = (typeof STAGES)[number];

export function isStage(value: string): value is Stage {
  return (STAGES as readonly string[]).includes(value);
}

export interface StageRoute {
  primary: KnownModelSlug;
  /** Tried in order when the primary fails. */
  fallbacks: readonly KnownModelSlug[];
}

const FAST_CLAUDE: StageRoute = {
  primary: "anthropic/claude-haiku-4.5",
  fallbacks: ["openai/gpt-5-mini"],
};
const DEEP_CLAUDE: StageRoute = {
  primary: "anthropic/claude-sonnet-4.5",
  fallbacks: ["openai/gpt-5"],
};
const FAST_OPENAI: StageRoute = {
  primary: "openai/gpt-5-mini",
  fallbacks: ["anthropic/claude-haiku-4.5"],
};
const DEEP_OPENAI: StageRoute = {
  primary: "openai/gpt-5",
  fallbacks: ["anthropic/claude-sonnet-4.5"],
};

/** Default routing: cheap stages on Haiku-class, planning/execution on Sonnet-class. */
export const STAGE_ROUTES: Record<Stage, StageRoute> = {
  enrich: FAST_CLAUDE,
  prioritize: FAST_CLAUDE,
  triage: FAST_CLAUDE,
  subtasks: FAST_CLAUDE,
  plan: DEEP_CLAUDE,
  execute: DEEP_CLAUDE,
  digest: FAST_CLAUDE,
  memory: FAST_CLAUDE,
};

// ---------------------------------------------------------------------------
// User preference (Settings → AI model)
// ---------------------------------------------------------------------------

export const MODEL_PREFERENCE_IDS = ["recommended", "quality", "fast", "openai"] as const;
export type ModelPreference = (typeof MODEL_PREFERENCE_IDS)[number];

export const DEFAULT_MODEL_PREFERENCE: ModelPreference = "recommended";

export interface ModelPreferenceOption {
  id: ModelPreference;
  label: string;
  /** One-liner shown in the picker. */
  description: string;
  /** Route to use for a stage of the given class. */
  routes: Record<ModelClass, StageRoute>;
}

export const MODEL_PREFERENCES: ReadonlyArray<ModelPreferenceOption> = [
  {
    id: "recommended",
    label: "Recommended",
    description: "Claude Haiku for everyday sifting, Claude Sonnet when a task needs a plan.",
    routes: { fast: FAST_CLAUDE, deep: DEEP_CLAUDE },
  },
  {
    id: "quality",
    label: "Best quality",
    description:
      "Claude Sonnet for everything. Slower and pricier; worth it for high-stakes lists.",
    routes: { fast: DEEP_CLAUDE, deep: DEEP_CLAUDE },
  },
  {
    id: "fast",
    label: "Fastest",
    description: "Claude Haiku for everything, including planning. Best for capture-heavy days.",
    routes: { fast: FAST_CLAUDE, deep: FAST_CLAUDE },
  },
  {
    id: "openai",
    label: "Prefer OpenAI",
    description: "GPT-5 mini and GPT-5 first, with Claude as the fallback.",
    routes: { fast: FAST_OPENAI, deep: DEEP_OPENAI },
  },
];

/** Pre-registry preference values that may still be persisted in browsers. */
const LEGACY_PREFERENCE_IDS: Record<string, ModelPreference> = {
  "claude-haiku": "recommended",
  "claude-sonnet": "quality",
  "gpt-4o": "openai",
  "gpt-4o-mini": "openai",
};

export function normalizeModelPreference(value: string | null | undefined): ModelPreference {
  if (!value) return DEFAULT_MODEL_PREFERENCE;
  if ((MODEL_PREFERENCE_IDS as readonly string[]).includes(value)) return value as ModelPreference;
  return LEGACY_PREFERENCE_IDS[value] ?? DEFAULT_MODEL_PREFERENCE;
}

export function getModelPreference(id: ModelPreference): ModelPreferenceOption {
  return MODEL_PREFERENCES.find((p) => p.id === id) ?? MODEL_PREFERENCES[0]!;
}

/**
 * The route a stage runs with under a preference. `null`/unknown preferences
 * fall back to the stage default, so a stale browser can never pick a model
 * the registry does not know.
 */
export function resolveStageRoute(
  stage: Stage,
  preference?: string | null,
): StageRoute & { stage: Stage; preference: ModelPreference } {
  const pref = normalizeModelPreference(preference);
  const stageClass = getModelSpec(STAGE_ROUTES[stage].primary).class;
  const route = getModelPreference(pref).routes[stageClass];
  return { stage, preference: pref, primary: route.primary, fallbacks: route.fallbacks };
}

/** Every model a stage may touch (primary first), for key checks and evals. */
export function routeModels(route: StageRoute): ModelSpec[] {
  return [route.primary, ...route.fallbacks].map((slug) => MODELS[slug]);
}

// ---------------------------------------------------------------------------
// Cost
// ---------------------------------------------------------------------------

/**
 * Estimated cost in cents (fractional — a Haiku triage is well under one
 * cent). Returns null when the provider reported no usage so the row is
 * honestly "unknown" rather than zero.
 */
export function estimateCostCents(opts: {
  model: Pick<ModelSpec, "inputUsdPerMillion" | "outputUsdPerMillion">;
  inputTokens: number | null | undefined;
  outputTokens: number | null | undefined;
}): number | null {
  if (opts.inputTokens == null || opts.outputTokens == null) return null;
  const inUsd = (opts.inputTokens / 1_000_000) * opts.model.inputUsdPerMillion;
  const outUsd = (opts.outputTokens / 1_000_000) * opts.model.outputUsdPerMillion;
  return Math.round((inUsd + outUsd) * 100 * 1_000_000) / 1_000_000;
}
