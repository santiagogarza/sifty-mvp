import "@testing-library/jest-dom/vitest";
import { createMemoryRepos, setReposForTesting } from "@/lib/db/repos";
import { createConsoleProvider, setEmailProviderForTesting } from "@/lib/email";
import { afterAll, afterEach, beforeAll, beforeEach, vi } from "vitest";

// Default test env. Individual tests may override per-suite via vi.stubEnv().
(process.env as Record<string, string | undefined>).NODE_ENV = "test";
process.env.AUTH_SECRET ??= "test-auth-secret-do-not-use-in-production-please-32";
process.env.CREATOR_EMAIL ??= "s.gonzalez.garza@gmail.com";

// Provide a fresh in-memory repo and email outbox per test so writes don't
// leak across files.
let _handle = createMemoryRepos();
let _outbox = createConsoleProvider({ silent: true });

beforeEach(() => {
  _handle = createMemoryRepos();
  setReposForTesting(_handle);
  _outbox = createConsoleProvider({ silent: true });
  setEmailProviderForTesting(_outbox);
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
  setEmailProviderForTesting(null);
  console.error = originalError;
});

export function getTestRepos() {
  return _handle;
}

/** Every email sent during the current test, in order. */
export function getTestOutbox() {
  return _outbox;
}
