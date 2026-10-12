import {
  ConnectorApiError,
  type ConnectorToolContext,
  buildConnectorTools,
  selectTools,
} from "@/lib/connectors/manifest";
import { getProvider, listProviders, scopeIds } from "@/lib/connectors/providers";
import { MANIFESTS } from "@/lib/connectors/tools";
import { CONNECTOR_PROVIDERS } from "@/lib/db/repos/types";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

/**
 * The manifest contract: what the executor (3.4) and the policy layer rely
 * on. A tool added without a kind, with a clashing name, or outside its
 * provider's prefix fails here before it can reach an agent loop.
 */
describe("tool manifest contract", () => {
  const all = Object.values(MANIFESTS).flatMap((m) =>
    m.tools.map((t) => ({ ...t, provider: m.provider })),
  );

  it("covers every provider in the registry", () => {
    expect(Object.keys(MANIFESTS).sort()).toEqual([...CONNECTOR_PROVIDERS].sort());
    for (const provider of CONNECTOR_PROVIDERS) {
      expect(MANIFESTS[provider].provider).toBe(provider);
      expect(MANIFESTS[provider].tools.length).toBeGreaterThan(0);
    }
  });

  it("gives every tool a unique, provider-prefixed snake_case name and a kind", () => {
    const names = all.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
    for (const t of all) {
      expect(t.name).toMatch(/^[a-z][a-z0-9_]*$/);
      expect(t.name.startsWith(`${t.provider}_`)).toBe(true);
      expect(["read", "write"]).toContain(t.kind);
      expect(t.description.length).toBeGreaterThan(20);
      expect(t.inputSchema).toBeInstanceOf(z.ZodType);
      expect(typeof t.execute).toBe("function");
    }
  });

  it("has at least one read and one write tool per provider, and the registry scopes match", () => {
    for (const provider of CONNECTOR_PROVIDERS) {
      const manifest = MANIFESTS[provider];
      const spec = getProvider(provider);
      expect(selectTools(manifest, "read").length).toBeGreaterThan(0);
      expect(selectTools(manifest, "write").length).toBeGreaterThan(0);
      expect(scopeIds(spec, ["read"]).length).toBeGreaterThan(0);
      expect(scopeIds(spec, ["write"]).length).toBeGreaterThan(0);
      expect(selectTools(manifest, "all")).toHaveLength(manifest.tools.length);
    }
  });

  it("declares MCP servers where the provider runs one", () => {
    expect(MANIFESTS.linear.mcp?.url).toBe("https://mcp.linear.app/mcp");
    expect(MANIFESTS.github.mcp?.url).toBe("https://api.githubcopilot.com/mcp/");
    expect(MANIFESTS.notion.mcp?.url).toBe("https://mcp.notion.com/mcp");
    expect(MANIFESTS.google.mcp).toBeNull();
    expect(MANIFESTS.slack.mcp).toBeNull();
    for (const provider of CONNECTOR_PROVIDERS) {
      expect(getProvider(provider).mcp?.url ?? null).toBe(MANIFESTS[provider].mcp?.url ?? null);
    }
  });

  it("lists providers in display order with the mock last and only in test/offline", () => {
    expect(listProviders().map((p) => p.id)).toEqual([
      "google",
      "slack",
      "linear",
      "github",
      "notion",
      "mock",
    ]);
    for (const spec of listProviders()) {
      expect(spec.name.length).toBeGreaterThan(0);
      expect(spec.description.length).toBeGreaterThan(20);
      if (spec.broker === "vercel-connect") expect(spec.connectorEnv).toMatch(/^CONNECTOR_[A-Z]+$/);
    }
  });

  it("builds AI SDK tools that fetch a token per call and honour the kind filter", async () => {
    const getToken = vi.fn(async () => "mock-token-xyz");
    const read = buildConnectorTools({
      userId: "u1",
      manifests: [MANIFESTS.mock, MANIFESTS.github],
      allow: "read",
      getToken,
    });
    expect(Object.keys(read).sort()).toEqual([
      "github_list_repos",
      "github_search_issues",
      "mock_list_notes",
    ]);
    const list = read.mock_list_notes;
    if (!list?.execute) throw new Error("expected executable tool");
    await list.execute({ limit: 2 }, { toolCallId: "c1", messages: [] });
    await list.execute({ limit: 2 }, { toolCallId: "c2", messages: [] });
    expect(getToken).toHaveBeenCalledTimes(2);
    expect(getToken).toHaveBeenCalledWith("mock");
  });
});

function ctx(
  fetchImpl: typeof fetch,
  provider: ConnectorToolContext["provider"] = "github",
): ConnectorToolContext {
  return { userId: "u1", provider, token: "tok_123", fetch: fetchImpl };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("REST tools call the provider with the brokered token", () => {
  it("github_list_repos sends the bearer token and maps the response", async () => {
    const fetchImpl = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      expect(String(url)).toMatch(/^https:\/\/api\.github\.com\/user\/repos\?/);
      expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer tok_123");
      return jsonResponse([
        {
          full_name: "acme/app",
          private: true,
          default_branch: "main",
          html_url: "https://github.com/acme/app",
        },
      ]);
    });
    const tool = MANIFESTS.github.tools.find((t) => t.name === "github_list_repos");
    if (!tool) throw new Error("missing tool");
    const out = (await tool.execute({ perPage: 5 }, ctx(fetchImpl as typeof fetch))) as {
      repos: Array<{ fullName: string }>;
    };
    expect(out.repos).toEqual([
      expect.objectContaining({ fullName: "acme/app", private: true, defaultBranch: "main" }),
    ]);
  });

  it("turns a non-2xx answer into ConnectorApiError with a bounded detail", async () => {
    const fetchImpl = vi.fn(async () => new Response("x".repeat(5_000), { status: 403 }));
    const tool = MANIFESTS.github.tools.find((t) => t.name === "github_create_issue");
    if (!tool) throw new Error("missing tool");
    await expect(
      tool.execute(
        { repo: "acme/app", title: "Flaky test", labels: [] },
        ctx(fetchImpl as typeof fetch),
      ),
    ).rejects.toMatchObject({ name: "ConnectorApiError", provider: "github", status: 403 });
    try {
      await tool.execute(
        { repo: "acme/app", title: "x", labels: [] },
        ctx(fetchImpl as typeof fetch),
      );
    } catch (err) {
      expect(err).toBeInstanceOf(ConnectorApiError);
      expect((err as Error).message.length).toBeLessThan(400);
    }
  });

  it("sends every provider call with a timeout signal", async () => {
    const fetchImpl = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      expect(init?.signal).toBeInstanceOf(AbortSignal);
      return jsonResponse([]);
    });
    const tool = MANIFESTS.github.tools.find((t) => t.name === "github_list_repos");
    if (!tool) throw new Error("missing tool");
    await tool.execute({ perPage: 1 }, ctx(fetchImpl as typeof fetch));
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("refuses header injection in gmail drafts and encodes non-ASCII subjects", async () => {
    const gmailFetch = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      const sent = JSON.parse(String(init?.body)) as { message: { raw: string } };
      const raw = Buffer.from(sent.message.raw, "base64url").toString("utf8");
      expect(raw).toContain("Subject: =?UTF-8?B?");
      return jsonResponse({ id: "d1", message: { id: "m1", threadId: "t1" } });
    });
    const draft = MANIFESTS.google.tools.find((t) => t.name === "google_gmail_create_draft");
    if (!draft) throw new Error("missing tool");
    const base = { to: "ana@example.com", subject: "Račun", body: "Hi" };
    await draft.execute(base, ctx(gmailFetch as typeof fetch, "google"));
    for (const bad of [
      { ...base, to: "ana@example.com\r\nBcc: evil@example.com" },
      { ...base, subject: "Invoice\nBcc: evil@example.com" },
      { ...base, inReplyTo: "<x>\r\nTo: evil@example.com" },
    ]) {
      await expect(draft.execute(bad, ctx(gmailFetch as typeof fetch, "google"))).rejects.toThrow(
        /line breaks/,
      );
    }
    expect(gmailFetch).toHaveBeenCalledTimes(1);
  });

  it("slack treats ok:false as an error and gmail drafts are base64url RFC 822", async () => {
    const slackFetch = vi.fn(async () => jsonResponse({ ok: false, error: "missing_scope" }));
    const post = MANIFESTS.slack.tools.find((t) => t.name === "slack_post_message");
    if (!post) throw new Error("missing tool");
    await expect(
      post.execute({ channel: "C1", text: "hi" }, ctx(slackFetch as typeof fetch, "slack")),
    ).rejects.toMatchObject({
      provider: "slack",
      message: expect.stringContaining("missing_scope"),
    });

    let sent: { message: { raw: string; threadId?: string } } | null = null;
    const gmailFetch = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      sent = JSON.parse(String(init?.body));
      return jsonResponse({ id: "d1", message: { id: "m1", threadId: "t1" } });
    });
    const draft = MANIFESTS.google.tools.find((t) => t.name === "google_gmail_create_draft");
    if (!draft) throw new Error("missing tool");
    const out = await draft.execute(
      { to: "ana@example.com", subject: "Invoice", body: "Hi Ana", threadId: "t1" },
      ctx(gmailFetch as typeof fetch, "google"),
    );
    expect(out).toEqual({ draftId: "d1", messageId: "m1", threadId: "t1" });
    const raw = Buffer.from(sent!.message.raw, "base64url").toString("utf8");
    expect(raw).toContain("To: ana@example.com");
    expect(raw).toContain("Subject: Invoice");
    expect(raw.endsWith("Hi Ana")).toBe(true);
    expect(sent!.message.threadId).toBe("t1");
  });
});
