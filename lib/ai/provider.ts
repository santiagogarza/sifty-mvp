import { reportError } from "@/lib/observability/report-error";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createGateway } from "@ai-sdk/gateway";
import { createOpenAI } from "@ai-sdk/openai";
import {
  APICallError,
  type LanguageModel,
  type LanguageModelMiddleware,
  type LanguageModelUsage,
  type ProviderMetadata,
  wrapLanguageModel,
} from "ai";
import {
  type ModelPreference,
  type ModelProvider,
  type ModelSpec,
  type Stage,
  type StageRoute,
  estimateCostCents,
  findModelSpec,
  resolveStageRoute,
  routeModels,
} from "./models";

/**
 * The only module that knows which SDK talks to which vendor.
 *
 * `AI_TRANSPORT` picks the wire:
 *
 *   - `gateway` (default): every model goes through the Vercel AI Gateway
 *     with one key. The stage's fallback list is handed to the Gateway as a
 *     routing option, so provider outages fail over server-side.
 *   - `direct`: each model is called on its own provider SDK with that
 *     provider's key. The same fallback list is applied here, in process,
 *     by `FallbackLanguageModel`, so both transports behave the same way.
 *
 * Misconfiguration fails loudly: an unknown `AI_TRANSPORT` value or a missing
 * key for the chosen transport throws before any request leaves the box.
 * Nothing is inferred from which keys happen to exist. The offline heuristic
 * (`SIFTY_AI_OFFLINE=1`, `?offline=1`) is decided by the route before this
 * module is reached and is never a silent fallback.
 *
 * Callers pass `resolved.model` to the AI SDK and nothing else — every
 * transport-specific `providerOptions` lives in this file.
 */

export type AiTransport = "gateway" | "direct";
export const AI_TRANSPORTS: readonly AiTransport[] = ["gateway", "direct"];
export const DEFAULT_AI_TRANSPORT: AiTransport = "gateway";

export type AiConfigErrorCode = "ai_misconfigured" | "no_ai_key";

export class AiConfigError extends Error {
  readonly code: AiConfigErrorCode;
  constructor(message: string, code: AiConfigErrorCode = "ai_misconfigured") {
    super(message);
    this.name = "AiConfigError";
    this.code = code;
  }
}

/** A required key for the configured transport is absent. Routes map this to 503. */
export class MissingAiKeyError extends AiConfigError {
  constructor(message: string) {
    super(message, "no_ai_key");
    this.name = "MissingAiKeyError";
  }
}

type Env = Record<string, string | undefined>;

export function readAiTransport(env: Env = process.env): AiTransport {
  const raw = env.AI_TRANSPORT?.trim().toLowerCase();
  if (!raw) return DEFAULT_AI_TRANSPORT;
  if ((AI_TRANSPORTS as readonly string[]).includes(raw)) return raw as AiTransport;
  throw new AiConfigError(
    `AI_TRANSPORT must be one of ${AI_TRANSPORTS.map((t) => `"${t}"`).join(", ")} (got "${raw}").`,
  );
}

const PROVIDER_KEY_VAR: Record<ModelProvider, string> = {
  anthropic: "ANTHROPIC_API_KEY",
  openai: "OPENAI_API_KEY",
};

export interface ResolvedProvider {
  /** Hand this to `generateObject` / `generateText`. Fallbacks are baked in. */
  model: LanguageModel;
  transport: AiTransport;
  stage: Stage;
  preference: ModelPreference;
  route: StageRoute;
  primary: ModelSpec;
  fallbacks: ModelSpec[];
}

export interface ResolveProviderOptions {
  /** Settings → AI model value. Unknown or legacy values fall back to the stage default. */
  preference?: string | null;
  /** Test seam; defaults to `process.env`. */
  env?: Env;
}

export function resolveProvider(stage: Stage, opts: ResolveProviderOptions = {}): ResolvedProvider {
  const env = opts.env ?? process.env;
  const transport = readAiTransport(env);
  const route = resolveStageRoute(stage, opts.preference);
  const models = routeModels(route);
  const [primary, ...fallbacks] = models as [ModelSpec, ...ModelSpec[]];

  const model =
    transport === "gateway"
      ? buildGatewayModel({ stage, primary, fallbacks, env })
      : buildDirectModel({ stage, primary, fallbacks, env });

  return {
    model,
    transport,
    stage,
    preference: route.preference,
    route: { primary: route.primary, fallbacks: route.fallbacks },
    primary,
    fallbacks,
  };
}

// ---------------------------------------------------------------------------
// Usage attribution
// ---------------------------------------------------------------------------

export interface AiUsage {
  /** Canonical slug of the model that actually answered. */
  model: ModelSpec["slug"];
  inputTokens: number | null;
  outputTokens: number | null;
  costCents: number | null;
}

/**
 * Which model served the call, with its token counts priced from the
 * registry. In `direct` mode the fallback wrapper stamps the served model
 * into `providerMetadata.sifty`; in `gateway` mode the Gateway reports the
 * upstream model id in `response.modelId`. If neither is recognizable we
 * attribute to the primary, which is the common case.
 */
export function usageFromResult(
  resolved: Pick<ResolvedProvider, "primary" | "fallbacks">,
  result: {
    usage?: Partial<LanguageModelUsage> | null;
    response?: { modelId?: string | null } | null;
    providerMetadata?: ProviderMetadata | null;
  },
): AiUsage {
  const stamped = result.providerMetadata?.sifty?.model;
  const served =
    (typeof stamped === "string" ? findModelSpec(stamped) : null) ??
    findModelSpec(result.response?.modelId) ??
    resolved.primary;
  const inputTokens = result.usage?.inputTokens ?? null;
  const outputTokens = result.usage?.outputTokens ?? null;
  return {
    model: served.slug,
    inputTokens,
    outputTokens,
    costCents: estimateCostCents({ model: served, inputTokens, outputTokens }),
  };
}

// ---------------------------------------------------------------------------
// Gateway transport
// ---------------------------------------------------------------------------

interface BuildArgs {
  stage: Stage;
  primary: ModelSpec;
  fallbacks: ModelSpec[];
  env: Env;
}

function buildGatewayModel({ primary, fallbacks, env }: BuildArgs): LanguageModel {
  const apiKey = env.AI_GATEWAY_API_KEY;
  if (!apiKey) {
    throw new MissingAiKeyError(
      "AI_TRANSPORT=gateway (the default) requires AI_GATEWAY_API_KEY. Set it, or set AI_TRANSPORT=direct with the provider keys.",
    );
  }
  const gateway = createGateway({ apiKey });
  const fallbackSlugs = fallbacks.map((m) => m.slug);

  // The Gateway does the failover; we only declare the order. Merging keeps
  // any caller-supplied `gateway` options (there should be none) intact.
  const routing: LanguageModelMiddleware = {
    specificationVersion: "v3",
    transformParams: async ({ params }) => ({
      ...params,
      providerOptions: {
        ...params.providerOptions,
        gateway: {
          ...(params.providerOptions?.gateway ?? {}),
          ...(fallbackSlugs.length ? { models: fallbackSlugs } : {}),
        },
      },
    }),
  };

  return wrapLanguageModel({ model: gateway.languageModel(primary.slug), middleware: routing });
}

// ---------------------------------------------------------------------------
// Direct transport
// ---------------------------------------------------------------------------

type LanguageModelV3 = Extract<LanguageModel, { specificationVersion: "v3" }>;
type GenerateOptions = Parameters<LanguageModelV3["doGenerate"]>[0];
type GenerateResult = Awaited<ReturnType<LanguageModelV3["doGenerate"]>>;
type StreamResult = Awaited<ReturnType<LanguageModelV3["doStream"]>>;

function buildDirectModel({ stage, primary, fallbacks, env }: BuildArgs): LanguageModel {
  const specs = [primary, ...fallbacks];

  for (const provider of new Set(specs.map((m) => m.provider))) {
    const varName = PROVIDER_KEY_VAR[provider];
    if (!env[varName]) {
      const needing = specs.filter((m) => m.provider === provider).map((m) => m.slug);
      throw new MissingAiKeyError(
        `AI_TRANSPORT=direct: stage "${stage}" routes to ${needing.join(", ")} but ${varName} is not set.`,
      );
    }
  }

  const clients: Partial<Record<ModelProvider, (id: string) => LanguageModelV3>> = {};
  const clientFor = (provider: ModelProvider) => {
    const existing = clients[provider];
    if (existing) return existing;
    const apiKey = env[PROVIDER_KEY_VAR[provider]]!;
    const client =
      provider === "anthropic"
        ? (id: string) => createAnthropic({ apiKey })(id) as LanguageModelV3
        : (id: string) => createOpenAI({ apiKey })(id) as LanguageModelV3;
    clients[provider] = client;
    return client;
  };

  return new FallbackLanguageModel(
    stage,
    specs.map((spec) => ({ spec, model: clientFor(spec.provider)(spec.directId) })),
  );
}

/** Mirrors the Gateway's failover: retryable provider errors move to the next model. */
export function shouldFallBack(err: unknown): boolean {
  return APICallError.isInstance(err) && err.isRetryable;
}

class FallbackLanguageModel implements LanguageModelV3 {
  readonly specificationVersion = "v3" as const;
  readonly provider = "sifty.direct";
  readonly modelId: string;

  constructor(
    private readonly stage: Stage,
    private readonly candidates: ReadonlyArray<{ spec: ModelSpec; model: LanguageModelV3 }>,
  ) {
    this.modelId = candidates[0]!.spec.slug;
  }

  get supportedUrls() {
    return this.candidates[0]!.model.supportedUrls;
  }

  doGenerate(options: GenerateOptions): Promise<GenerateResult> {
    return this.attempt(options, async (candidate, attempt) => {
      const result = await candidate.model.doGenerate(options);
      return {
        ...result,
        providerMetadata: {
          ...result.providerMetadata,
          sifty: { model: candidate.spec.slug, attempt },
        },
      };
    });
  }

  doStream(options: GenerateOptions): Promise<StreamResult> {
    // Failover only before the first byte; a stream that has started cannot
    // be restarted on another model without duplicating output.
    return this.attempt(options, async (candidate) => candidate.model.doStream(options));
  }

  private async attempt<T>(
    options: GenerateOptions,
    run: (candidate: { spec: ModelSpec; model: LanguageModelV3 }, attempt: number) => Promise<T>,
  ): Promise<T> {
    let lastError: unknown;
    for (let i = 0; i < this.candidates.length; i += 1) {
      const candidate = this.candidates[i]!;
      try {
        return await run(candidate, i + 1);
      } catch (err) {
        lastError = err;
        const isLast = i === this.candidates.length - 1;
        if (isLast || options.abortSignal?.aborted || !shouldFallBack(err)) throw err;
        reportError(err, {
          area: "ai.fallback",
          tags: {
            stage: this.stage,
            failed: candidate.spec.slug,
            next: this.candidates[i + 1]!.spec.slug,
          },
        });
      }
    }
    throw lastError;
  }
}
