import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { MODELS, STAGES, type Stage } from "@/lib/ai/models";
import {
  AiConfigError,
  MissingAiKeyError,
  readAiTransport,
  resolveProvider,
  shouldFallBack,
  usageFromResult,
} from "@/lib/ai/provider";
import { APICallError, generateObject } from "ai";
import { MockLanguageModelV3 } from "ai/test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

/**
 * Both transports against a mock model. The three provider SDKs are mocked
 * at the module boundary (the only place `provider.ts` touches them); the
 * AI SDK core (`generateObject`, `wrapLanguageModel`) is real, so these
 * tests prove what a route would actually observe.
 */

type GenerateResult = Awaited<ReturnType<MockLanguageModelV3["doGenerate"]>>;
type Behavior = (callIndex: number) => GenerateResult;

const behaviors = new Map<string, Behavior>();
const created: Array<{ sdk: "gateway" | "anthropic" | "openai"; id: string; apiKey: string }> = [];
const mocks = new Map<string, MockLanguageModelV3>();

function mockModel(sdk: "gateway" | "anthropic" | "openai", apiKey: string, id: string) {
  created.push({ sdk, id, apiKey });
  let calls = 0;
  const model = new MockLanguageModelV3({
    provider: sdk,
    modelId: id,
    doGenerate: async () => {
      const behavior = behaviors.get(id) ?? behaviors.get("*");
      if (!behavior) throw new Error(`no behavior for ${id}`);
      return behavior(calls++);
    },
  });
  mocks.set(id, model);
  return model;
}

vi.mock("@ai-sdk/gateway", () => ({
  createGateway: ({ apiKey }: { apiKey: string }) => ({
    languageModel: (id: string) => mockModel("gateway", apiKey, id),
  }),
}));
vi.mock("@ai-sdk/anthropic", () => ({
  createAnthropic:
    ({ apiKey }: { apiKey: string }) =>
    (id: string) =>
      mockModel("anthropic", apiKey, id),
}));
vi.mock("@ai-sdk/openai", () => ({
  createOpenAI:
    ({ apiKey }: { apiKey: string }) =>
    (id: string) =>
      mockModel("openai", apiKey, id),
}));

const Answer = z.object({ title: z.string() });

function ok(modelId: string, usage = { input: 1_000, output: 200 }): Behavior {
  return (): GenerateResult => ({
    content: [{ type: "text", text: JSON.stringify({ title: `from ${modelId}` }) }],
    finishReason: { unified: "stop", raw: "stop" },
    usage: {
      inputTokens: { total: usage.input, noCache: usage.input, cacheRead: 0, cacheWrite: 0 },
      outputTokens: { total: usage.output, text: usage.output, reasoning: 0 },
    },
    warnings: [],
    response: { id: "r", timestamp: new Date(0), modelId: `${modelId}-20260101` },
  });
}

function apiError(statusCode: number, isRetryable: boolean) {
  return new APICallError({
    message: `upstream ${statusCode}`,
    url: "https://example.invalid",
    requestBodyValues: {},
    statusCode,
    isRetryable,
  });
}

const failWith =
  (err: Error): Behavior =>
  () => {
    throw err;
  };

async function run(resolved: ReturnType<typeof resolveProvider>) {
  const result = await generateObject({
    model: resolved.model,
    schema: Answer,
    prompt: "hello",
    maxRetries: 0,
  });
  return { result, usage: usageFromResult(resolved, result) };
}

const GATEWAY_ENV = { AI_GATEWAY_API_KEY: "gw-key" };
const DIRECT_ENV = {
  AI_TRANSPORT: "direct",
  ANTHROPIC_API_KEY: "ant-key",
  OPENAI_API_KEY: "oai-key",
};

beforeEach(() => {
  behaviors.clear();
  created.length = 0;
  mocks.clear();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("readAiTransport", () => {
  it("defaults to gateway when AI_TRANSPORT is unset", () => {
    expect(readAiTransport({})).toBe("gateway");
    expect(readAiTransport({ AI_TRANSPORT: "" })).toBe("gateway");
  });

  it("accepts the two transports case-insensitively", () => {
    expect(readAiTransport({ AI_TRANSPORT: "Direct " })).toBe("direct");
    expect(readAiTransport({ AI_TRANSPORT: "gateway" })).toBe("gateway");
  });

  it("rejects anything else loudly", () => {
    expect(() => readAiTransport({ AI_TRANSPORT: "anthropic" })).toThrow(AiConfigError);
    expect(() => readAiTransport({ AI_TRANSPORT: "anthropic" })).toThrow(/got "anthropic"/);
  });

  it("reads process.env by default", () => {
    vi.stubEnv("AI_TRANSPORT", "direct");
    expect(readAiTransport()).toBe("direct");
  });
});

describe("misconfiguration fails loudly instead of inferring from keys", () => {
  it("gateway without AI_GATEWAY_API_KEY throws even when provider keys exist", () => {
    const env = { ANTHROPIC_API_KEY: "ant", OPENAI_API_KEY: "oai" };
    expect(() => resolveProvider("triage", { env })).toThrow(MissingAiKeyError);
    expect(() => resolveProvider("triage", { env })).toThrow(/AI_GATEWAY_API_KEY/);
  });

  it("direct without ANTHROPIC_API_KEY throws even when a gateway key exists", () => {
    const env = { AI_TRANSPORT: "direct", AI_GATEWAY_API_KEY: "gw", OPENAI_API_KEY: "oai" };
    expect(() => resolveProvider("triage", { env })).toThrow(MissingAiKeyError);
    expect(() => resolveProvider("triage", { env })).toThrow(/ANTHROPIC_API_KEY/);
  });

  it("direct names the OpenAI fallback that needs OPENAI_API_KEY", () => {
    const env = { AI_TRANSPORT: "direct", ANTHROPIC_API_KEY: "ant" };
    let caught: unknown;
    try {
      resolveProvider("plan", { env });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(MissingAiKeyError);
    expect((caught as Error).message).toContain("OPENAI_API_KEY");
    expect((caught as Error).message).toContain("openai/gpt-5");
    expect((caught as Error).message).toContain('stage "plan"');
  });

  it("invalid AI_TRANSPORT is an AiConfigError with code ai_misconfigured", () => {
    let caught: unknown;
    try {
      resolveProvider("triage", { env: { AI_TRANSPORT: "bogus", AI_GATEWAY_API_KEY: "x" } });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(AiConfigError);
    expect(caught).not.toBeInstanceOf(MissingAiKeyError);
    expect((caught as AiConfigError).code).toBe("ai_misconfigured");
  });

  it("MissingAiKeyError carries code no_ai_key", () => {
    expect(new MissingAiKeyError("x").code).toBe("no_ai_key");
    expect(new MissingAiKeyError("x")).toBeInstanceOf(AiConfigError);
  });

  it("throws before any model is constructed", () => {
    expect(() => resolveProvider("triage", { env: {} })).toThrow();
    expect(created).toHaveLength(0);
  });
});

describe("gateway transport", () => {
  it("routes the primary through the Gateway with the fallback list as a routing option", async () => {
    behaviors.set("*", ok("claude-haiku-4-5"));
    const resolved = resolveProvider("triage", { env: GATEWAY_ENV });

    expect(resolved.transport).toBe("gateway");
    expect(resolved.stage).toBe("triage");
    expect(resolved.primary.slug).toBe("anthropic/claude-haiku-4.5");
    expect(resolved.fallbacks.map((m) => m.slug)).toEqual(["openai/gpt-5-mini"]);
    expect(created).toEqual([
      { sdk: "gateway", id: "anthropic/claude-haiku-4.5", apiKey: "gw-key" },
    ]);

    const { result, usage } = await run(resolved);
    expect(result.object.title).toBe("from claude-haiku-4-5");

    const call = mocks.get("anthropic/claude-haiku-4.5")!.doGenerateCalls[0]!;
    expect(call.providerOptions?.gateway).toEqual({ models: ["openai/gpt-5-mini"] });

    // 1000 in @ $1/M + 200 out @ $5/M = $0.002 = 0.2 cents.
    expect(usage).toEqual({
      model: "anthropic/claude-haiku-4.5",
      inputTokens: 1_000,
      outputTokens: 200,
      costCents: 0.2,
    });
  });

  it("attributes cost to the model the Gateway reports when it fell back", async () => {
    behaviors.set("*", ok("gpt-5-mini"));
    const resolved = resolveProvider("triage", { env: GATEWAY_ENV });
    const { usage } = await run(resolved);
    expect(usage.model).toBe("openai/gpt-5-mini");
    // 1000 in @ $0.25/M + 200 out @ $2/M = $0.00065 = 0.065 cents.
    expect(usage.costCents).toBeCloseTo(0.065, 9);
  });

  it("honors the user preference when picking the route", () => {
    const resolved = resolveProvider("triage", { env: GATEWAY_ENV, preference: "openai" });
    expect(resolved.preference).toBe("openai");
    expect(resolved.primary.slug).toBe("openai/gpt-5-mini");
    expect(resolved.fallbacks.map((m) => m.slug)).toEqual(["anthropic/claude-haiku-4.5"]);
  });

  it("maps legacy raw model ids onto a preference instead of failing", () => {
    const resolved = resolveProvider("triage", { env: GATEWAY_ENV, preference: "claude-sonnet" });
    expect(resolved.preference).toBe("quality");
    expect(resolved.primary.slug).toBe("anthropic/claude-sonnet-4.5");
  });

  it("builds a model for every stage", () => {
    for (const stage of STAGES) {
      expect(resolveProvider(stage, { env: GATEWAY_ENV }).stage).toBe(stage);
    }
  });
});

describe("direct transport", () => {
  it("uses each provider's own SDK, key, and native model id", async () => {
    behaviors.set("*", ok("claude-haiku-4-5"));
    const resolved = resolveProvider("triage", { env: DIRECT_ENV });

    expect(resolved.transport).toBe("direct");
    expect(created).toEqual([
      { sdk: "anthropic", id: "claude-haiku-4-5", apiKey: "ant-key" },
      { sdk: "openai", id: "gpt-5-mini", apiKey: "oai-key" },
    ]);

    const { result, usage } = await run(resolved);
    expect(result.object.title).toBe("from claude-haiku-4-5");
    expect(usage).toEqual({
      model: "anthropic/claude-haiku-4.5",
      inputTokens: 1_000,
      outputTokens: 200,
      costCents: 0.2,
    });
    expect(mocks.get("gpt-5-mini")!.doGenerateCalls).toHaveLength(0);
    // Nothing transport-specific leaks into the provider call.
    expect(mocks.get("claude-haiku-4-5")!.doGenerateCalls[0]!.providerOptions).toBeUndefined();
  });

  it("falls back in registry order on a retryable provider error and prices the fallback", async () => {
    behaviors.set("claude-haiku-4-5", failWith(apiError(529, true)));
    behaviors.set("gpt-5-mini", ok("gpt-5-mini"));
    const resolved = resolveProvider("triage", { env: DIRECT_ENV });

    const { result, usage } = await run(resolved);
    expect(result.object.title).toBe("from gpt-5-mini");
    expect(mocks.get("claude-haiku-4-5")!.doGenerateCalls).toHaveLength(1);
    expect(mocks.get("gpt-5-mini")!.doGenerateCalls).toHaveLength(1);
    expect(result.providerMetadata?.sifty).toEqual({ model: "openai/gpt-5-mini", attempt: 2 });
    expect(usage.model).toBe("openai/gpt-5-mini");
    expect(usage.costCents).toBeCloseTo(0.065, 9);
  });

  it("does not fall back on non-retryable errors", async () => {
    behaviors.set("claude-haiku-4-5", failWith(apiError(400, false)));
    behaviors.set("gpt-5-mini", ok("gpt-5-mini"));
    const resolved = resolveProvider("triage", { env: DIRECT_ENV });

    await expect(run(resolved)).rejects.toThrow(/upstream 400/);
    expect(mocks.get("gpt-5-mini")!.doGenerateCalls).toHaveLength(0);
  });

  it("surfaces the last error when every model in the route fails", async () => {
    behaviors.set("claude-haiku-4-5", failWith(apiError(503, true)));
    behaviors.set("gpt-5-mini", failWith(apiError(429, true)));
    const resolved = resolveProvider("triage", { env: DIRECT_ENV });

    await expect(run(resolved)).rejects.toThrow(/upstream 429/);
    expect(mocks.get("claude-haiku-4-5")!.doGenerateCalls).toHaveLength(1);
    expect(mocks.get("gpt-5-mini")!.doGenerateCalls).toHaveLength(1);
  });

  it("walks a longer fallback chain in order", async () => {
    // The `openai` preference flips the order; prove the chain is not hard-coded.
    behaviors.set("gpt-5", failWith(apiError(500, true)));
    behaviors.set("claude-sonnet-4-5", ok("claude-sonnet-4-5"));
    const resolved = resolveProvider("plan", { env: DIRECT_ENV, preference: "openai" });
    expect(created.map((c) => c.id)).toEqual(["gpt-5", "claude-sonnet-4-5"]);

    const { usage } = await run(resolved);
    expect(usage.model).toBe("anthropic/claude-sonnet-4.5");
    // 1000 in @ $3/M + 200 out @ $15/M = $0.006 = 0.6 cents.
    expect(usage.costCents).toBeCloseTo(0.6, 9);
  });

  it("only requires the keys the route actually uses", () => {
    // A Claude-only chain would not need OPENAI_API_KEY; today every route has
    // an OpenAI model, so prove the check is per-route rather than global by
    // asserting the error names the exact model that needs the key.
    const env = { AI_TRANSPORT: "direct", OPENAI_API_KEY: "oai" };
    expect(() => resolveProvider("triage", { env })).toThrow(/anthropic\/claude-haiku-4\.5/);
  });
});

describe("module boundary", () => {
  const files = sourceFiles(["lib", "app", "components"]);

  it("only lib/ai/provider.ts imports a provider SDK", () => {
    const offenders = files.filter(
      (f) => f !== "lib/ai/provider.ts" && /from\s+["']@ai-sdk\//.test(readFileSync(f, "utf8")),
    );
    expect(offenders).toEqual([]);
  });

  it("no transport-specific providerOptions outside lib/ai/provider.ts", () => {
    const offenders = files.filter(
      (f) => f !== "lib/ai/provider.ts" && /providerOptions/.test(readFileSync(f, "utf8")),
    );
    expect(offenders).toEqual([]);
  });
});

function sourceFiles(roots: string[]): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, entry.name);
      if (entry.isDirectory()) walk(p);
      else if (/\.(ts|tsx)$/.test(entry.name)) out.push(p);
    }
  };
  for (const root of roots) walk(root);
  return out;
}

describe("fallback and cost semantics are transport-agnostic", () => {
  it("shouldFallBack mirrors the Gateway: retryable API errors only", () => {
    expect(shouldFallBack(apiError(429, true))).toBe(true);
    expect(shouldFallBack(apiError(503, true))).toBe(true);
    expect(shouldFallBack(apiError(400, false))).toBe(false);
    expect(shouldFallBack(new Error("schema mismatch"))).toBe(false);
  });

  it("usageFromResult returns null cost when usage was not reported", () => {
    const resolved = { primary: MODELS["anthropic/claude-haiku-4.5"], fallbacks: [] };
    expect(usageFromResult(resolved, {})).toEqual({
      model: "anthropic/claude-haiku-4.5",
      inputTokens: null,
      outputTokens: null,
      costCents: null,
    });
  });

  it("usageFromResult prefers the stamped model, then response.modelId, then the primary", () => {
    const resolved = {
      primary: MODELS["anthropic/claude-haiku-4.5"],
      fallbacks: [MODELS["openai/gpt-5-mini"]],
    };
    const usage = { inputTokens: 10, outputTokens: 10 };
    expect(
      usageFromResult(resolved, {
        usage,
        response: { modelId: "gpt-5-mini-2025" },
        providerMetadata: { sifty: { model: "anthropic/claude-sonnet-4.5" } },
      }).model,
    ).toBe("anthropic/claude-sonnet-4.5");
    expect(
      usageFromResult(resolved, { usage, response: { modelId: "gpt-5-mini-2025" } }).model,
    ).toBe("openai/gpt-5-mini");
    expect(usageFromResult(resolved, { usage, response: { modelId: "mystery" } }).model).toBe(
      "anthropic/claude-haiku-4.5",
    );
  });

  it("the same stage resolves to the same route under both transports", () => {
    const stages: Stage[] = ["triage", "plan"];
    for (const stage of stages) {
      const gw = resolveProvider(stage, { env: GATEWAY_ENV });
      const direct = resolveProvider(stage, { env: DIRECT_ENV });
      expect(direct.route).toEqual(gw.route);
      expect(direct.primary).toBe(gw.primary);
      expect(direct.fallbacks).toEqual(gw.fallbacks);
    }
  });
});
