import { createAnthropic } from "@ai-sdk/anthropic";
import { createGateway } from "@ai-sdk/gateway";
import { createOpenAI } from "@ai-sdk/openai";
import type { LanguageModel } from "ai";
import { type ModelOption, getModel } from "./models";

/**
 * Resolves a Sifty model id to an AI SDK `LanguageModel`.
 *
 * Priority order:
 *   1. AI_GATEWAY_API_KEY → route every model through the Vercel AI Gateway.
 *      One key, multi-provider, automatic failover. This is the recommended
 *      production path.
 *   2. Provider-specific key (ANTHROPIC_API_KEY / OPENAI_API_KEY) → fall back
 *      to a direct provider client. Useful for local dev with a single key.
 *   3. Throw `MissingAiKeyError`. The route handler converts this to a 503
 *      with a clear error so the UI can prompt the user to add a key.
 *
 * The triage agent's heuristic mode is a separate, opt-in debug path
 * (`?offline=1`). It is *not* a silent fallback when keys are missing — that
 * was the old MVP behavior and it hid configuration mistakes.
 */
export class MissingAiKeyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MissingAiKeyError";
  }
}

export interface ResolvedProvider {
  model: LanguageModel;
  /** "gateway", "anthropic-direct", or "openai-direct". Surfaced on aiRuns. */
  transport: string;
  option: ModelOption;
}

export function resolveProvider(modelId: string | null | undefined): ResolvedProvider {
  const option = getModel(modelId);
  const gatewayKey = process.env.AI_GATEWAY_API_KEY;
  if (gatewayKey) {
    const gateway = createGateway({ apiKey: gatewayKey });
    return {
      model: gateway.languageModel(option.gatewaySlug),
      transport: "gateway",
      option,
    };
  }

  if (option.provider === "anthropic") {
    const key = process.env.ANTHROPIC_API_KEY;
    if (!key) {
      throw new MissingAiKeyError(
        "Anthropic provider selected, but neither AI_GATEWAY_API_KEY nor ANTHROPIC_API_KEY is set.",
      );
    }
    const anthropic = createAnthropic({ apiKey: key });
    const slug = option.gatewaySlug.replace(/^anthropic\//, "");
    return { model: anthropic(slug), transport: "anthropic-direct", option };
  }

  if (option.provider === "openai") {
    const key = process.env.OPENAI_API_KEY;
    if (!key) {
      throw new MissingAiKeyError(
        "OpenAI provider selected, but neither AI_GATEWAY_API_KEY nor OPENAI_API_KEY is set.",
      );
    }
    const openai = createOpenAI({ apiKey: key });
    const slug = option.gatewaySlug.replace(/^openai\//, "");
    return { model: openai(slug), transport: "openai-direct", option };
  }

  throw new MissingAiKeyError(`Unknown provider for model ${option.id}`);
}
