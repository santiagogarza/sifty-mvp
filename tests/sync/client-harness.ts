import type { MemoryReposHandle } from "@/lib/db/repos";
import { vi } from "vitest";

/**
 * Boots the client sync stack (Zustand store + `lib/store/sync`) against
 * the real route handlers and an in-memory repo, with `fetch` dispatched
 * in-process. Each boot resets the module registry so the sync module's
 * state (ledger, chains, pull flags) starts fresh — exactly like a page
 * load. localStorage is left alone so a second boot behaves like a reload.
 *
 * Auth runs in bypass mode (`SIFTY_DISABLE_AUTH=1`): the routes resolve the
 * same bootstrap user on every call without the JWT path, which keeps the
 * harness independent of `jose` under jsdom.
 */

export interface RecordedCall {
  method: string;
  path: string;
  body: unknown;
  status: number;
}

/**
 * Return a Response to short-circuit the route, or null to pass through.
 * `proceed` runs the real route, so an interceptor can hold a genuine
 * response back to simulate a slow network.
 */
export type Interceptor = (
  method: string,
  path: string,
  proceed: () => Promise<Response>,
) => Response | Promise<Response | null> | null;

/**
 * Pass the previous handle to "reload the page" against the same server
 * state; omit it for a fresh server.
 */
export async function bootClient(previous?: Pick<ClientHandle, "repos">): Promise<ClientHandle> {
  vi.resetModules();
  vi.stubEnv("SIFTY_DISABLE_AUTH", "1");

  const reposMod = await import("@/lib/db/repos");
  const repos = previous?.repos ?? reposMod.createMemoryRepos();
  reposMod.setReposForTesting(repos);

  const [me, tasks, task, labels, memories, memory] = await Promise.all([
    import("@/app/api/auth/me/route"),
    import("@/app/api/tasks/route"),
    import("@/app/api/tasks/[id]/route"),
    import("@/app/api/labels/route"),
    import("@/app/api/memories/route"),
    import("@/app/api/memories/[id]/route"),
  ]);

  const calls: RecordedCall[] = [];
  const interceptors: Interceptor[] = [];

  const route = async (method: string, path: string, req: Request): Promise<Response> => {
    const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
    if (path === "/api/auth/me") return me.GET(req);
    if (path === "/api/tasks") return method === "GET" ? tasks.GET(req) : tasks.POST(req);
    if (path === "/api/labels") return method === "GET" ? labels.GET(req) : labels.PUT(req);
    if (path === "/api/memories") {
      return method === "GET" ? memories.GET(req) : memories.POST(req);
    }
    const taskMatch = path.match(/^\/api\/tasks\/([^/]+)$/);
    if (taskMatch) {
      const id = decodeURIComponent(taskMatch[1]!);
      if (method === "GET") return task.GET(req, ctx(id));
      if (method === "PATCH") return task.PATCH(req, ctx(id));
      if (method === "DELETE") return task.DELETE(req, ctx(id));
    }
    const memMatch = path.match(/^\/api\/memories\/([^/]+)$/);
    if (memMatch) {
      const id = decodeURIComponent(memMatch[1]!);
      if (method === "PATCH") return memory.PATCH(req, ctx(id));
      if (method === "DELETE") return memory.DELETE(req, ctx(id));
    }
    return new Response(JSON.stringify({ error: `unrouted ${method} ${path}` }), { status: 500 });
  };

  const dispatch = async (method: string, url: URL, req: Request): Promise<Response> => {
    const path = url.pathname;
    for (const fn of interceptors) {
      const hit = await fn(method, path, () => route(method, path, req));
      if (hit) return hit;
    }
    return route(method, path, req);
  };

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : input.toString(), "http://localhost");
    const method = (init?.method ?? "GET").toUpperCase();
    const bodyText = typeof init?.body === "string" ? init.body : null;
    const req = new Request(url, {
      method,
      headers: init?.headers,
      body: bodyText,
    });
    const res = await dispatch(method, url, req);
    calls.push({
      method,
      path: url.pathname,
      body: bodyText ? JSON.parse(bodyText) : null,
      status: res.status,
    });
    return res;
  }) as typeof fetch;

  const sync = await import("@/lib/store/sync");
  const { useStore } = await import("@/lib/store/store");
  const user = (await (await me.GET(new Request("http://localhost/api/auth/me"))).json()).user as {
    id: string;
  };

  return {
    repos,
    sync,
    store: useStore,
    userId: user.id,
    calls,
    intercept(fn: Interceptor) {
      interceptors.push(fn);
      return () => {
        const i = interceptors.indexOf(fn);
        if (i >= 0) interceptors.splice(i, 1);
      };
    },
  };
}

export interface ClientHandle {
  repos: MemoryReposHandle;
  sync: typeof import("@/lib/store/sync");
  store: typeof import("@/lib/store/store")["useStore"];
  userId: string;
  calls: RecordedCall[];
  intercept(fn: Interceptor): () => void;
}

/** Pull, then settle the debounce window and every push chain. */
export async function settle(client: ClientHandle, ms = 500): Promise<void> {
  await vi.advanceTimersByTimeAsync(ms);
  await client.sync.whenSyncIdle();
  await vi.advanceTimersByTimeAsync(ms);
  await client.sync.whenSyncIdle();
}
