import {
  DEFAULT_MODEL_PREFERENCE,
  MODELS,
  MODEL_PREFERENCES,
  MODEL_PREFERENCE_IDS,
  MODEL_SLUGS,
  STAGES,
  STAGE_ROUTES,
  estimateCostCents,
  findModelSpec,
  isKnownModel,
  isStage,
  normalizeModelPreference,
  resolveStageRoute,
  routeModels,
} from "@/lib/ai/models";
import { describe, expect, it } from "vitest";

describe("model registry", () => {
  it("keys every model by a canonical provider/model slug that matches its spec", () => {
    for (const slug of MODEL_SLUGS) {
      const spec = MODELS[slug];
      expect(spec.slug).toBe(slug);
      expect(slug).toMatch(/^(anthropic|openai)\/[a-z0-9.-]+$/);
      expect(slug.startsWith(`${spec.provider}/`)).toBe(true);
      expect(spec.directId).not.toContain("/");
      expect(spec.inputUsdPerMillion).toBeGreaterThan(0);
      expect(spec.outputUsdPerMillion).toBeGreaterThan(0);
    }
  });

  it("no longer ships the stale GPT-4o entries", () => {
    expect(MODEL_SLUGS.some((s) => s.includes("gpt-4o"))).toBe(false);
  });

  it("declares a route for every stage with a primary and exactly one OpenAI fallback", () => {
    expect(STAGES).toEqual([
      "enrich",
      "prioritize",
      "triage",
      "subtasks",
      "plan",
      "execute",
      "digest",
      "memory",
    ]);
    for (const stage of STAGES) {
      const route = STAGE_ROUTES[stage];
      const models = routeModels(route);
      expect(models[0]!.provider).toBe("anthropic");
      expect(route.fallbacks.length).toBeGreaterThanOrEqual(1);
      expect(models.filter((m) => m.provider === "openai")).toHaveLength(1);
      // A fallback must be a different model than the primary.
      expect(new Set(models.map((m) => m.slug)).size).toBe(models.length);
    }
  });

  it("uses Haiku-class for cheap stages and Sonnet-class for plan/execute", () => {
    for (const stage of ["enrich", "prioritize", "triage", "subtasks", "digest"] as const) {
      expect(STAGE_ROUTES[stage].primary).toBe("anthropic/claude-haiku-4.5");
    }
    for (const stage of ["plan", "execute"] as const) {
      expect(STAGE_ROUTES[stage].primary).toBe("anthropic/claude-sonnet-4.5");
    }
  });

  it("isStage guards free-form strings", () => {
    expect(isStage("triage")).toBe(true);
    expect(isStage("brief")).toBe(false);
  });
});

describe("preferences map onto the registry, never raw model ids", () => {
  it("every preference routes every stage class to known models", () => {
    for (const pref of MODEL_PREFERENCES) {
      for (const cls of ["fast", "deep"] as const) {
        for (const spec of routeModels(pref.routes[cls])) {
          expect(isKnownModel(spec.slug) && MODELS[spec.slug]).toBe(spec);
        }
      }
    }
  });

  it("normalizes unknown, empty, and legacy values", () => {
    expect(normalizeModelPreference(null)).toBe(DEFAULT_MODEL_PREFERENCE);
    expect(normalizeModelPreference("")).toBe(DEFAULT_MODEL_PREFERENCE);
    expect(normalizeModelPreference("anthropic/claude-haiku-4.5")).toBe(DEFAULT_MODEL_PREFERENCE);
    expect(normalizeModelPreference("claude-haiku")).toBe("recommended");
    expect(normalizeModelPreference("claude-sonnet")).toBe("quality");
    expect(normalizeModelPreference("gpt-4o")).toBe("openai");
    expect(normalizeModelPreference("gpt-4o-mini")).toBe("openai");
    for (const id of MODEL_PREFERENCE_IDS) expect(normalizeModelPreference(id)).toBe(id);
  });

  it("resolveStageRoute applies the preference by stage class", () => {
    expect(resolveStageRoute("triage")).toMatchObject({
      stage: "triage",
      preference: "recommended",
      primary: "anthropic/claude-haiku-4.5",
      fallbacks: ["openai/gpt-5-mini"],
    });
    expect(resolveStageRoute("triage", "quality").primary).toBe("anthropic/claude-sonnet-4.5");
    expect(resolveStageRoute("plan", "fast").primary).toBe("anthropic/claude-haiku-4.5");
    expect(resolveStageRoute("plan", "openai")).toMatchObject({
      primary: "openai/gpt-5",
      fallbacks: ["anthropic/claude-sonnet-4.5"],
    });
    expect(resolveStageRoute("digest", "recommended").primary).toBe(STAGE_ROUTES.digest.primary);
  });
});

describe("findModelSpec", () => {
  it("matches canonical slugs, native ids, and dated snapshots", () => {
    expect(findModelSpec("anthropic/claude-haiku-4.5")?.slug).toBe("anthropic/claude-haiku-4.5");
    expect(findModelSpec("claude-haiku-4-5")?.slug).toBe("anthropic/claude-haiku-4.5");
    expect(findModelSpec("claude-haiku-4-5-20251001")?.slug).toBe("anthropic/claude-haiku-4.5");
    expect(findModelSpec("gpt-5-mini-2025-08-07")?.slug).toBe("openai/gpt-5-mini");
    expect(findModelSpec("openai/gpt-5")?.slug).toBe("openai/gpt-5");
  });

  it("does not confuse gpt-5 with gpt-5-mini in either direction", () => {
    expect(findModelSpec("gpt-5-2025-08-07")?.slug).toBe("openai/gpt-5");
    expect(findModelSpec("gpt-5-mini")?.slug).toBe("openai/gpt-5-mini");
    expect(findModelSpec("gpt-5-mini-2025-08-07")?.slug).toBe("openai/gpt-5-mini");
    expect(findModelSpec("openai/gpt-5-mini-2025-08-07")?.slug).toBe("openai/gpt-5-mini");
  });

  it("prefers the longest native-id prefix, so registry order cannot change attribution", () => {
    // Every pair of models where one directId is a prefix of the other must
    // resolve a dated id of the longer one to the longer one.
    for (const a of Object.values(MODELS)) {
      for (const b of Object.values(MODELS)) {
        if (a === b || !b.directId.startsWith(`${a.directId}-`)) continue;
        expect(findModelSpec(`${b.directId}-20260101`)?.slug).toBe(b.slug);
        expect(findModelSpec(`${a.directId}-20260101`)?.slug).toBe(a.slug);
      }
    }
    // Guard the premise: the registry does contain such a pair.
    expect(
      Object.values(MODELS).some((a) =>
        Object.values(MODELS).some((b) => a !== b && b.directId.startsWith(`${a.directId}-`)),
      ),
    ).toBe(true);
  });

  it("returns null for unknown ids", () => {
    expect(findModelSpec(null)).toBeNull();
    expect(findModelSpec("gpt-4o")).toBeNull();
    expect(findModelSpec("sifty.local.heuristic")).toBeNull();
  });
});

describe("estimateCostCents", () => {
  it("prices from list prices and keeps fractional cents", () => {
    const haiku = MODELS["anthropic/claude-haiku-4.5"];
    // 1500 in @ $1/M + 400 out @ $5/M = $0.0035 = 0.35 cents — integer
    // cents would have recorded 0 for every triage.
    expect(estimateCostCents({ model: haiku, inputTokens: 1_500, outputTokens: 400 })).toBeCloseTo(
      0.35,
      9,
    );
    const sonnet = MODELS["anthropic/claude-sonnet-4.5"];
    expect(
      estimateCostCents({ model: sonnet, inputTokens: 1_000_000, outputTokens: 1_000_000 }),
    ).toBe(1800);
  });

  it("is null when either token count is unknown", () => {
    const haiku = MODELS["anthropic/claude-haiku-4.5"];
    expect(estimateCostCents({ model: haiku, inputTokens: null, outputTokens: 5 })).toBeNull();
    expect(estimateCostCents({ model: haiku, inputTokens: 5, outputTokens: undefined })).toBeNull();
  });

  it("is zero for zero tokens, not null", () => {
    const haiku = MODELS["anthropic/claude-haiku-4.5"];
    expect(estimateCostCents({ model: haiku, inputTokens: 0, outputTokens: 0 })).toBe(0);
  });
});
