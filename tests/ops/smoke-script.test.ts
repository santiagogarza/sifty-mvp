import { spawn } from "node:child_process";
import { type Server, createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

/**
 * Runs `scripts/smoke-deployment.sh` against a stub of the deployed app, so
 * the probe list, the exit code, the bypass header, and the URL guard are
 * covered without a network.
 */
const SCRIPT = resolve(__dirname, "../../scripts/smoke-deployment.sh");

type Stub = { server: Server; url: string; headers: Record<string, string | undefined>[] };

function startStub(
  overrides: Record<string, { status: number; body: string }> = {},
): Promise<Stub> {
  const headers: Stub["headers"] = [];
  const pages: Record<string, { status: number; body: string }> = {
    "/": { status: 200, body: "<title>Sifty</title>" },
    "/pricing": { status: 200, body: "<h1>Sifty pricing</h1>" },
    "/sign-up": { status: 200, body: "Sifty sign up" },
    "/sign-in": { status: 200, body: "Sifty sign in" },
    "/api/health": { status: 200, body: '{"ok":true,"db":"ok"}' },
    ...overrides,
  };
  return new Promise((done) => {
    const server = createServer((req, res) => {
      headers.push({ ...req.headers } as Record<string, string | undefined>);
      const page = pages[req.url ?? ""] ?? { status: 404, body: "nope" };
      res.statusCode = page.status;
      res.end(req.method === "HEAD" ? undefined : page.body);
    });
    server.keepAliveTimeout = 1;
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      done({ server, url: `http://127.0.0.1:${port}`, headers });
    });
  });
}

function run(
  url: string,
  env: Record<string, string> = {},
): Promise<{ status: number | null; stdout: string; stderr: string }> {
  return new Promise((done) => {
    const child = spawn("bash", [SCRIPT, url], {
      env: { NODE_ENV: "test", PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "", ...env },
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => {
      stdout += d;
    });
    child.stderr.on("data", (d) => {
      stderr += d;
    });
    child.on("close", (status) => done({ status, stdout, stderr }));
  });
}

describe("scripts/smoke-deployment.sh", () => {
  let stub: Stub | null = null;
  afterEach(() => {
    stub?.server.closeAllConnections();
    stub?.server.close();
    stub = null;
  });

  it("passes when every probe is 200 with the expected body", async () => {
    stub = await startStub();
    const res = await run(stub.url);
    expect(res.status, res.stdout + res.stderr).toBe(0);
    expect(res.stdout).toMatch(/ok {3}\/ -> 200/);
    expect(res.stdout).toMatch(/ok {3}\/api\/health -> 200/);
  });

  it("fails on a non-200 page and on a health body without ok:true", async () => {
    stub = await startStub({ "/pricing": { status: 404, body: "gone" } });
    const res = await run(stub.url);
    expect(res.status).toBe(1);
    expect(res.stdout).toContain("FAIL /pricing -> 404");

    stub.server.closeAllConnections();
    stub.server.close();
    stub = await startStub({ "/api/health": { status: 200, body: '{"ok":false}' } });
    const res2 = await run(stub.url);
    expect(res2.status).toBe(1);
    expect(res2.stdout).toContain("FAIL /api/health -> 200 but body lacks");
  });

  it("sends SMOKE_BYPASS_SECRET as one header, spaces included", async () => {
    stub = await startStub();
    const res = await run(stub.url, { SMOKE_BYPASS_SECRET: "token with spaces" });
    expect(res.status).toBe(0);
    expect(stub.headers.length).toBeGreaterThan(0);
    for (const h of stub.headers) {
      expect(h["x-vercel-protection-bypass"]).toBe("token with spaces");
    }
  });

  it("refuses non-https targets other than loopback", async () => {
    expect((await run("http://evil.example/")).status).toBe(2);
    expect((await run("ftp://sifty-app.vercel.app")).status).toBe(2);
  });
});
