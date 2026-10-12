import {
  ConnectorError,
  callbackUrlFor,
  checkConnection,
  completeConnect,
  connectedProviders,
  connectorToolsFor,
  disconnect,
  getAccessToken,
  listConnectionViews,
  startConnect,
} from "@/lib/connectors/service";
import { MOCK_TOKEN_PREFIX, __resetMockNotes } from "@/lib/connectors/tools/mock";
import { isSealed } from "@/lib/crypto/aes-gcm";
import type { Repos } from "@/lib/db/repos";
import { emptySnapshot, trialSnapshot } from "@/lib/entitlements/entitlements";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getTestRepos } from "../setup";

const ORIGIN = "https://sifty.example";

async function proUser(repos: Repos, email = "pro@example.com") {
  const user = await repos.users.create({ email, displayName: "Pro", isCreator: false });
  await repos.entitlements.upsert(user.id, trialSnapshot());
  return user;
}

async function freeUser(repos: Repos, email = "free@example.com") {
  const user = await repos.users.create({ email, displayName: "Free", isCreator: false });
  await repos.entitlements.upsert(user.id, emptySnapshot());
  return user;
}

/** Run the mock consent round trip and return the callback's query. */
async function consent(repos: Repos, userId: string) {
  const { url } = await startConnect(userId, "mock", { origin: ORIGIN }, repos);
  const parsed = new URL(url);
  expect(`${parsed.origin}${parsed.pathname}`).toBe(callbackUrlFor(ORIGIN, "mock"));
  return parsed.searchParams;
}

describe("connection lifecycle (mock broker)", () => {
  beforeEach(() => __resetMockNotes());

  it("connects, issues tokens, checks, and disconnects — storing only a sealed secret", async () => {
    const repos = getTestRepos();
    const user = await proUser(repos);

    const query = await consent(repos, user.id);
    const pending = await repos.connections.get(user.id, "mock");
    expect(pending?.status).toBe("pending");
    expect(pending?.authState).toBe(query.get("state"));
    expect(pending?.scopes).toEqual(["notes:read", "notes:write"]);
    expect(pending?.encryptedSecret).toBeNull();

    const done = await completeConnect(user.id, "mock", query, repos);
    expect(done.ok).toBe(true);
    const row = await repos.connections.get(user.id, "mock");
    expect(row?.status).toBe("connected");
    expect(row?.authState).toBeNull();
    expect(row?.externalAccount).toBe("mock@sifty.local");
    // Encryption at rest: the row never holds the token.
    expect(isSealed(row?.encryptedSecret)).toBe(true);
    expect(row?.encryptedSecret).not.toContain(MOCK_TOKEN_PREFIX);

    const token = await getAccessToken(user.id, "mock", repos);
    expect(token.startsWith(MOCK_TOKEN_PREFIX)).toBe(true);
    expect(await connectedProviders(user.id, repos)).toEqual(["mock"]);

    const checked = await checkConnection(user.id, "mock", repos);
    expect(checked.status).toBe("connected");
    expect(checked.lastCheckedAt).not.toBeNull();
    expect(checked.lastError).toBeNull();

    expect(await disconnect(user.id, "mock", repos)).toBe(true);
    expect(await repos.connections.get(user.id, "mock")).toBeNull();
    expect(await disconnect(user.id, "mock", repos)).toBe(false);
    await expect(getAccessToken(user.id, "mock", repos)).rejects.toMatchObject({
      code: "not_connected",
      status: 409,
    });
  });

  it("refuses a callback whose state does not match the attempt", async () => {
    const repos = getTestRepos();
    const user = await proUser(repos);
    const query = await consent(repos, user.id);
    const forged = new URLSearchParams(query);
    forged.set("state", "someone-elses");
    expect(await completeConnect(user.id, "mock", forged, repos)).toMatchObject({
      ok: false,
      code: "state_mismatch",
    });
    expect((await repos.connections.get(user.id, "mock"))?.status).toBe("pending");

    const missing = new URLSearchParams(query);
    missing.delete("state");
    expect(await completeConnect(user.id, "mock", missing, repos)).toMatchObject({
      ok: false,
      code: "state_mismatch",
    });
  });

  it("records a declined consent as an error and lets the user retry", async () => {
    const repos = getTestRepos();
    const user = await proUser(repos);
    const query = await consent(repos, user.id);
    query.set("error", "access_denied");
    query.delete("code");
    expect(await completeConnect(user.id, "mock", query, repos)).toMatchObject({
      ok: false,
      code: "denied",
    });
    const row = await repos.connections.get(user.id, "mock");
    expect(row?.status).toBe("error");
    expect(row?.lastError).toContain("access_denied");
    expect(row?.encryptedSecret).toBeNull();

    // A new attempt replaces the failed row rather than adding another.
    const again = await consent(repos, user.id);
    expect(await completeConnect(user.id, "mock", again, repos)).toMatchObject({ ok: true });
    expect(await repos.connections.list(user.id)).toHaveLength(1);
  });

  it("ignores a callback with no attempt in progress", async () => {
    const repos = getTestRepos();
    const user = await proUser(repos);
    expect(
      await completeConnect(
        user.id,
        "mock",
        new URLSearchParams({ state: "x", code: "mock-code" }),
        repos,
      ),
    ).toMatchObject({ ok: false, code: "not_connected" });
  });

  it("marks the row as needing attention when the sealed secret cannot be opened", async () => {
    const repos = getTestRepos();
    const user = await proUser(repos);
    const query = await consent(repos, user.id);
    await completeConnect(user.id, "mock", query, repos);
    // Simulate a row whose secret was sealed under another key / tampered.
    await repos.connections.update(user.id, "mock", {
      encryptedSecret: "v1.AAAAAAAAAAAAAAAA.AAAA.AAAAAAAAAAAAAAAAAAAAAA",
    });
    const checked = await checkConnection(user.id, "mock", repos);
    expect(checked.status).toBe("error");
    expect(checked.lastError).toMatch(/set up again/);
    await expect(getAccessToken(user.id, "mock", repos)).rejects.toBeInstanceOf(ConnectorError);
  });

  it("hides the mock provider outside tests unless SIFTY_AI_OFFLINE is on", async () => {
    const repos = getTestRepos();
    const user = await proUser(repos);
    vi.stubEnv("NODE_ENV", "production");
    await expect(startConnect(user.id, "mock", { origin: ORIGIN }, repos)).rejects.toMatchObject({
      code: "unknown_provider",
      status: 404,
    });
    expect(
      (await listConnectionViews(user.id, { isCreator: false }, repos)).providers.map(
        (p) => p.provider,
      ),
    ).not.toContain("mock");

    vi.stubEnv("SIFTY_AI_OFFLINE", "1");
    await expect(startConnect(user.id, "mock", { origin: ORIGIN }, repos)).resolves.toMatchObject({
      url: expect.stringContaining("/api/connectors/mock/callback"),
    });

    // Never on Vercel production, whatever the flag says.
    vi.stubEnv("VERCEL_ENV", "production");
    await expect(startConnect(user.id, "mock", { origin: ORIGIN }, repos)).rejects.toMatchObject({
      code: "unknown_provider",
    });
  });

  it("answers 503 not_configured for a Vercel Connect provider with no connector UID", async () => {
    const repos = getTestRepos();
    const user = await proUser(repos);
    await expect(startConnect(user.id, "google", { origin: ORIGIN }, repos)).rejects.toMatchObject({
      code: "not_configured",
      status: 503,
      message: expect.stringContaining("CONNECTOR_GOOGLE"),
    });
    expect(await repos.connections.get(user.id, "google")).toBeNull();
  });

  it("lists every provider with availability and status, and hides config hints from non-creators", async () => {
    const repos = getTestRepos();
    const user = await proUser(repos);
    const query = await consent(repos, user.id);
    await completeConnect(user.id, "mock", query, repos);

    const { allowed, providers } = await listConnectionViews(user.id, { isCreator: false }, repos);
    expect(allowed).toBe(true);
    expect(providers.map((p) => p.provider)).toEqual([
      "google",
      "slack",
      "linear",
      "github",
      "notion",
      "mock",
    ]);
    const google = providers.find((p) => p.provider === "google");
    expect(google).toMatchObject({
      availability: "not_configured",
      status: "disconnected",
      configHint: null,
    });
    expect(
      google?.scopes.every((s) => s.label.length > 0 && (s.kind === "read" || s.kind === "write")),
    ).toBe(true);
    const mock = providers.find((p) => p.provider === "mock");
    expect(mock).toMatchObject({
      availability: "available",
      status: "connected",
      externalAccount: "mock@sifty.local",
      mcp: false,
    });
    expect(mock?.tools).toEqual([
      { name: "mock_list_notes", kind: "read" },
      { name: "mock_add_note", kind: "write" },
    ]);
    // The view never carries the credential.
    expect(JSON.stringify(providers)).not.toContain("encryptedSecret");
    expect(JSON.stringify(providers)).not.toContain(MOCK_TOKEN_PREFIX);

    const asCreator = await listConnectionViews(user.id, { isCreator: true }, repos);
    expect(asCreator.providers.find((p) => p.provider === "google")?.configHint).toBe(
      "CONNECTOR_GOOGLE",
    );
  });

  it("gives an agent loop tools over connected providers, read-only when asked", async () => {
    const repos = getTestRepos();
    const user = await proUser(repos);
    expect(Object.keys(await connectorToolsFor(user.id, { allow: "all" }, repos))).toEqual([]);

    const query = await consent(repos, user.id);
    await completeConnect(user.id, "mock", query, repos);

    const readOnly = await connectorToolsFor(user.id, { allow: "read" }, repos);
    expect(Object.keys(readOnly)).toEqual(["mock_list_notes"]);
    const all = await connectorToolsFor(user.id, { allow: "all" }, repos);
    expect(Object.keys(all).sort()).toEqual(["mock_add_note", "mock_list_notes"]);

    const addNote = all.mock_add_note;
    const listNotes = all.mock_list_notes;
    if (!addNote?.execute || !listNotes?.execute) throw new Error("tools must be executable");
    const callOpts = { toolCallId: "call_1", messages: [] };
    await addNote.execute({ text: "Follow up with Ana" }, callOpts);
    const listed = (await listNotes.execute({ limit: 10 }, callOpts)) as {
      notes: Array<{ text: string }>;
    };
    expect(listed.notes.map((n) => n.text)).toContain("Follow up with Ana");
  });
});

describe("tier cap enforcement", () => {
  it("refuses free accounts at connect, callback, and token time with 402 pro_required", async () => {
    const repos = getTestRepos();
    const user = await freeUser(repos);
    await expect(startConnect(user.id, "mock", { origin: ORIGIN }, repos)).rejects.toMatchObject({
      code: "pro_required",
      status: 402,
    });
    expect(await repos.connections.get(user.id, "mock")).toBeNull();
    expect(
      await completeConnect(
        user.id,
        "mock",
        new URLSearchParams({ state: "s", code: "mock-code" }),
        repos,
      ),
    ).toMatchObject({ ok: false, code: "pro_required" });
    await expect(getAccessToken(user.id, "mock", repos)).rejects.toMatchObject({
      code: "pro_required",
    });

    const views = await listConnectionViews(user.id, { isCreator: false }, repos);
    expect(views.allowed).toBe(false);
    expect(views.providers.find((p) => p.provider === "mock")?.availability).toBe("pro_required");
    // An unconfigured provider reads as not configured first; the tier is moot until it exists.
    expect(views.providers.find((p) => p.provider === "google")?.availability).toBe(
      "not_configured",
    );
  });

  it("keeps a connection after a downgrade but stops issuing tokens for it", async () => {
    const repos = getTestRepos();
    const user = await proUser(repos, "downgraded@example.com");
    const query = await consent(repos, user.id);
    await completeConnect(user.id, "mock", query, repos);
    expect(await getAccessToken(user.id, "mock", repos)).toMatch(/^mock-token-/);

    await repos.entitlements.upsert(user.id, emptySnapshot());
    await expect(getAccessToken(user.id, "mock", repos)).rejects.toMatchObject({
      code: "pro_required",
    });
    expect((await repos.connections.get(user.id, "mock"))?.status).toBe("connected");
    const tools = await connectorToolsFor(user.id, { allow: "all" }, repos);
    const list = tools.mock_list_notes;
    if (!list?.execute) throw new Error("tool must be executable");
    await expect(
      list.execute({ limit: 1 }, { toolCallId: "c", messages: [] }),
    ).rejects.toMatchObject({
      code: "pro_required",
    });
  });

  it("lets the creator connect without a snapshot", async () => {
    const repos = getTestRepos();
    const user = await repos.users.create({
      email: "creator@example.com",
      displayName: "Creator",
      isCreator: true,
    });
    const query = await consent(repos, user.id);
    expect(await completeConnect(user.id, "mock", query, repos)).toMatchObject({ ok: true });
  });
});

describe("tenancy", () => {
  it("never lets one user see, use, or drop another user's connection", async () => {
    const repos = getTestRepos();
    const a = await proUser(repos, "a@example.com");
    const b = await proUser(repos, "b@example.com");
    const query = await consent(repos, a.id);
    await completeConnect(a.id, "mock", query, repos);

    expect(await connectedProviders(b.id, repos)).toEqual([]);
    expect(
      (await listConnectionViews(b.id, { isCreator: false }, repos)).providers.find(
        (p) => p.provider === "mock",
      )?.status,
    ).toBe("disconnected");
    await expect(getAccessToken(b.id, "mock", repos)).rejects.toMatchObject({
      code: "not_connected",
    });
    expect(await disconnect(b.id, "mock", repos)).toBe(false);
    expect((await repos.connections.get(a.id, "mock"))?.status).toBe("connected");

    // B completing A's callback (same state) cannot hijack A's attempt.
    const aQuery = await consent(repos, a.id);
    expect(await completeConnect(b.id, "mock", aQuery, repos)).toMatchObject({
      ok: false,
      code: "not_connected",
    });
    expect((await repos.connections.get(a.id, "mock"))?.status).toBe("pending");
  });
});
