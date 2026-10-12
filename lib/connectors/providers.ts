import {
  CONNECTOR_PROVIDERS,
  type ConnectionBroker,
  type ConnectorProvider,
} from "@/lib/db/repos/types";
import { demoFlagEnabled } from "@/lib/env/production-guards";

/**
 * Connector provider registry.
 *
 * One entry per third-party service a user can connect. Everything the
 * product needs to *describe* a connection lives here (display copy,
 * scopes in plain words, which broker holds the credential, whether the
 * provider offers an MCP server); the tools an agent can call with it live
 * in `./tools/*` and are joined by `manifest.ts`.
 *
 * Scopes are declared with a `kind` so the UI can say "reads your email"
 * vs "creates drafts" and so the policy layer can grant read-only access
 * without the side-effect half. `scopeMode` says whether the ids are sent
 * on the authorization request (`oauth`) or are capabilities fixed on the
 * provider's app and listed here only for the user (`integration`).
 */

export type ScopeKind = "read" | "write";

export interface ScopeSpec {
  /** Provider scope string (or capability name for `integration` mode). */
  id: string;
  /** Plain-words description shown to the user. */
  label: string;
  kind: ScopeKind;
}

export interface ConnectorProviderSpec {
  id: ConnectorProvider;
  name: string;
  /** Short qualifier under the name ("Gmail and Calendar"). */
  tagline: string;
  /** What connecting lets Sifty do, one sentence, in the user's words. */
  description: string;
  broker: ConnectionBroker;
  /**
   * Env var holding the Vercel Connect connector UID (`google/sifty`).
   * Null for brokers that need no configuration.
   */
  connectorEnv: string | null;
  scopeMode: "oauth" | "integration";
  scopes: ScopeSpec[];
  /** Remote MCP server the agent can mount with this connection's token. */
  mcp: { url: string } | null;
}

const GOOGLE: ConnectorProviderSpec = {
  id: "google",
  name: "Google",
  tagline: "Gmail and Calendar",
  description:
    "Read mail and your calendar, draft replies, and add events — drafts never send on their own.",
  broker: "vercel-connect",
  connectorEnv: "CONNECTOR_GOOGLE",
  scopeMode: "oauth",
  scopes: [
    { id: "openid", label: "Know which Google account you connected", kind: "read" },
    { id: "email", label: "See the email address of that account", kind: "read" },
    {
      id: "https://www.googleapis.com/auth/gmail.readonly",
      label: "Read your email",
      kind: "read",
    },
    {
      id: "https://www.googleapis.com/auth/calendar.events.readonly",
      label: "See your calendar events",
      kind: "read",
    },
    {
      id: "https://www.googleapis.com/auth/gmail.compose",
      label: "Create email drafts in Gmail",
      kind: "write",
    },
    {
      id: "https://www.googleapis.com/auth/calendar.events",
      label: "Add and change calendar events",
      kind: "write",
    },
  ],
  mcp: null,
};

const SLACK: ConnectorProviderSpec = {
  id: "slack",
  name: "Slack",
  tagline: "Channels and messages",
  description: "Search your workspace for context and post messages as you, once you approve them.",
  broker: "vercel-connect",
  connectorEnv: "CONNECTOR_SLACK",
  scopeMode: "oauth",
  scopes: [
    { id: "channels:read", label: "See the channels you are in", kind: "read" },
    { id: "groups:read", label: "See the private channels you are in", kind: "read" },
    { id: "users:read", label: "See people's names in your workspace", kind: "read" },
    { id: "search:read", label: "Search messages you can already see", kind: "read" },
    { id: "chat:write", label: "Post messages as you", kind: "write" },
  ],
  mcp: null,
};

const LINEAR: ConnectorProviderSpec = {
  id: "linear",
  name: "Linear",
  tagline: "Issues and projects",
  description: "Find issues that relate to a task and file new ones in your teams.",
  broker: "vercel-connect",
  connectorEnv: "CONNECTOR_LINEAR",
  scopeMode: "oauth",
  scopes: [
    { id: "read", label: "Read issues, projects, and teams", kind: "read" },
    { id: "write", label: "Create and update issues", kind: "write" },
  ],
  mcp: { url: "https://mcp.linear.app/mcp" },
};

const GITHUB: ConnectorProviderSpec = {
  id: "github",
  name: "GitHub",
  tagline: "Repositories and issues",
  description:
    "Pick repositories for code tasks, look up issues and pull requests, and open issues.",
  broker: "vercel-connect",
  connectorEnv: "CONNECTOR_GITHUB",
  scopeMode: "integration",
  scopes: [
    { id: "metadata:read", label: "See which repositories you can access", kind: "read" },
    { id: "contents:read", label: "Read code and files", kind: "read" },
    { id: "issues:read", label: "Read issues and comments", kind: "read" },
    { id: "pull_requests:read", label: "Read pull requests", kind: "read" },
    { id: "issues:write", label: "Open and comment on issues", kind: "write" },
  ],
  mcp: { url: "https://api.githubcopilot.com/mcp/" },
};

const NOTION: ConnectorProviderSpec = {
  id: "notion",
  name: "Notion",
  tagline: "Pages and databases",
  description: "Search the pages you share with Sifty and write new ones.",
  broker: "vercel-connect",
  connectorEnv: "CONNECTOR_NOTION",
  scopeMode: "integration",
  scopes: [
    { id: "read_content", label: "Read pages you share with Sifty", kind: "read" },
    { id: "insert_content", label: "Create pages", kind: "write" },
    { id: "update_content", label: "Edit pages Sifty created", kind: "write" },
  ],
  mcp: { url: "https://mcp.notion.com/mcp" },
};

/**
 * A provider that needs no OAuth app: the "connect" step round-trips
 * through our own callback and the credential is a sealed random string.
 * It exists so the whole lifecycle runs in CI, under `SIFTY_AI_OFFLINE`,
 * and in demos. Hidden in production.
 */
const MOCK: ConnectorProviderSpec = {
  id: "mock",
  name: "Mock notes",
  tagline: "Test connector",
  description: "A stand-in service for trying the connect flow without any third-party account.",
  broker: "mock",
  connectorEnv: null,
  scopeMode: "oauth",
  scopes: [
    { id: "notes:read", label: "Read your mock notes", kind: "read" },
    { id: "notes:write", label: "Add mock notes", kind: "write" },
  ],
  mcp: null,
};

const REGISTRY: Record<ConnectorProvider, ConnectorProviderSpec> = {
  google: GOOGLE,
  slack: SLACK,
  linear: LINEAR,
  github: GITHUB,
  notion: NOTION,
  mock: MOCK,
};

export function getProvider(id: ConnectorProvider): ConnectorProviderSpec {
  return REGISTRY[id];
}

/** The mock provider is listed only where the demo flags are honoured. */
export function mockConnectorEnabled(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return process.env.NODE_ENV === "test" || demoFlagEnabled("SIFTY_AI_OFFLINE", env);
}

/** Providers shown in Settings, in display order. */
export function listProviders(): ConnectorProviderSpec[] {
  return CONNECTOR_PROVIDERS.map((id) => REGISTRY[id]).filter(
    (p) => p.id !== "mock" || mockConnectorEnabled(),
  );
}

/** The Vercel Connect connector UID for a provider, or null when Santi has not set it. */
export function connectorUidFor(
  spec: ConnectorProviderSpec,
  env: Record<string, string | undefined> = process.env,
): string | null {
  if (!spec.connectorEnv) return null;
  const value = env[spec.connectorEnv]?.trim();
  return value ? value : null;
}

export function scopeIds(
  spec: ConnectorProviderSpec,
  kinds: readonly ScopeKind[] = ["read", "write"],
): string[] {
  return spec.scopes.filter((s) => kinds.includes(s.kind)).map((s) => s.id);
}
