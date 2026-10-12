import type { ConnectorProvider } from "@/lib/db/repos/types";
import { type Tool, type ToolSet, tool } from "ai";
import type { z } from "zod";
import type { ScopeKind } from "./providers";

/**
 * Tool manifests: what an agent can do with a connection.
 *
 * Every provider contributes a `ProviderToolManifest`: a list of REST tools
 * (each one a name, a description, a zod input schema, an `execute`, and a
 * `kind`) plus, where the provider runs one, the URL of its MCP server. The
 * executor (Phase 3.4) turns the REST tools into AI SDK tools with
 * `buildConnectorTools()` and mounts the MCP server with the same
 * connection's token; both go through the same `kind` filter so the
 * policy layer can hand a read-only loop to the model and keep every
 * side effect behind `draft_then_approve`.
 *
 * Rules the contract test enforces: names are globally unique and
 * prefixed with the provider id; every tool has a kind; descriptions are
 * short imperative sentences; `execute` never receives a raw token except
 * through `ctx.token`.
 */

export type ToolKind = ScopeKind;

export interface ConnectorToolContext {
  userId: string;
  provider: ConnectorProvider;
  /** Short-lived provider access token for this call. */
  token: string;
  /** Injectable for tests; defaults to global fetch. */
  fetch: typeof fetch;
}

// biome-ignore lint/suspicious/noExplicitAny: a heterogeneous list needs the erased form.
export interface ConnectorToolDefinition<I extends z.ZodTypeAny = z.ZodTypeAny, O = any> {
  /** `<provider>_<verb>_<object>`, snake case, unique across providers. */
  name: string;
  description: string;
  kind: ToolKind;
  inputSchema: I;
  execute(input: z.infer<I>, ctx: ConnectorToolContext): Promise<O>;
}

/** Keeps `input` typed from the schema inside `execute`, then erases for the list. */
export function defineTool<I extends z.ZodTypeAny, O>(
  def: ConnectorToolDefinition<I, O>,
): ConnectorToolDefinition {
  return def as unknown as ConnectorToolDefinition;
}

export interface ProviderToolManifest {
  provider: ConnectorProvider;
  tools: ConnectorToolDefinition[];
  /** Remote MCP server authorized with this connection's token, if any. */
  mcp: { url: string } | null;
}

/** Thrown by tools when the provider answers with an error status. */
export class ConnectorApiError extends Error {
  readonly provider: ConnectorProvider;
  readonly status: number;

  constructor(provider: ConnectorProvider, status: number, detail: string) {
    super(`${provider} API error ${status}: ${detail}`);
    this.name = "ConnectorApiError";
    this.provider = provider;
    this.status = status;
  }
}

const MAX_ERROR_DETAIL = 300;
const PROVIDER_TIMEOUT_MS = 15_000;

/** `fetch` with the bearer token attached and non-2xx turned into `ConnectorApiError`. */
export async function providerFetch(
  ctx: ConnectorToolContext,
  url: string,
  init: RequestInit & { headers?: Record<string, string> } = {},
): Promise<Response> {
  const res = await ctx.fetch(url, {
    ...init,
    signal: init.signal ?? AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
    headers: {
      Authorization: `Bearer ${ctx.token}`,
      Accept: "application/json",
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...init.headers,
    },
  });
  if (!res.ok) {
    const detail = (await res.text().catch(() => "")).slice(0, MAX_ERROR_DETAIL);
    throw new ConnectorApiError(ctx.provider, res.status, detail || res.statusText);
  }
  return res;
}

export function selectTools(
  manifest: ProviderToolManifest,
  allow: ToolKind | "all",
): ConnectorToolDefinition[] {
  if (allow === "all") return manifest.tools;
  return manifest.tools.filter((t) => t.kind === allow);
}

export interface BuildToolsOptions {
  userId: string;
  manifests: ProviderToolManifest[];
  /** `read` hands the model read-only tools; `all` includes side effects. */
  allow: ToolKind | "all";
  /** Resolves a fresh token right before each call; the service's `getAccessToken`. */
  getToken(provider: ConnectorProvider): Promise<string>;
  fetch?: typeof fetch;
}

/**
 * AI SDK `ToolSet` over the selected tools. The token is fetched per call,
 * not per loop, so a token that expires mid-run is refreshed by the broker
 * instead of failing the step.
 */
export function buildConnectorTools(options: BuildToolsOptions): ToolSet {
  const out: Record<string, Tool> = {};
  for (const manifest of options.manifests) {
    for (const def of selectTools(manifest, options.allow)) {
      out[def.name] = tool({
        description: def.description,
        inputSchema: def.inputSchema,
        execute: async (input: unknown) => {
          const token = await options.getToken(manifest.provider);
          return def.execute(input, {
            userId: options.userId,
            provider: manifest.provider,
            token,
            fetch: options.fetch ?? fetch,
          });
        },
      });
    }
  }
  return out;
}

/** Summary for the Settings page and the planner: names and kinds only. */
export function describeTools(
  manifest: ProviderToolManifest,
): Array<{ name: string; kind: ToolKind }> {
  return manifest.tools.map((t) => ({ name: t.name, kind: t.kind }));
}
