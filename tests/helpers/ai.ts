import { MODELS, type Stage, resolveStageRoute, routeModels } from "@/lib/ai/models";
import type { ResolvedProvider } from "@/lib/ai/provider";

/**
 * A `ResolvedProvider` for route tests that mock `resolveProvider` and the
 * AI SDK's `generateObject`. The model object is never called; the registry
 * fields are real so cost attribution in the route still exercises them.
 */
export function mockResolvedProvider(
  stage: Stage = "triage",
  overrides: Partial<ResolvedProvider> = {},
): ResolvedProvider {
  const route = resolveStageRoute(stage);
  const [primary, ...fallbacks] = routeModels(route);
  return {
    model: { __mock: true } as unknown as ResolvedProvider["model"],
    transport: "gateway",
    stage,
    preference: route.preference,
    route: { primary: route.primary, fallbacks: route.fallbacks },
    primary: primary ?? MODELS["anthropic/claude-haiku-4.5"],
    fallbacks,
    ...overrides,
  };
}
