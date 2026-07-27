import "@testing-library/jest-dom/vitest";
import { createMemoryRepos, setReposForTesting } from "@/lib/db/repos";
import { afterAll, afterEach, beforeAll, beforeEach, vi } from "vitest";

// Default test env. Individual tests may override per-suite via vi.stubEnv().
(process.env as Record<string, string | undefined>).NODE_ENV = "test";
process.env.AUTH_SECRET ??= "test-auth-secret-do-not-use-in-production-please-32";
process.env.CREATOR_EMAIL ??= "s.gonzalez.garza@gmail.com";

// jsdom ships no matchMedia, and component code legitimately asks for
// prefers-reduced-motion and prefers-color-scheme. Default to "no match".
if (typeof window !== "undefined" && typeof window.matchMedia !== "function") {
  window.matchMedia = (query: string) =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }) as MediaQueryList;
}

// Provide a fresh in-memory repo per test so writes don't leak across files.
let _handle = createMemoryRepos();

beforeEach(() => {
  _handle = createMemoryRepos();
  setReposForTesting(_handle);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

// Quiet noisy framework logs from tests.
const originalError = console.error;
beforeAll(() => {
  console.error = (...args: unknown[]) => {
    const first = args[0];
    if (typeof first === "string" && /not wrapped in act/.test(first)) return;
    originalError(...(args as Parameters<typeof console.error>));
  };
});

afterAll(() => {
  setReposForTesting(null);
  console.error = originalError;
});

export function getTestRepos() {
  return _handle;
}
