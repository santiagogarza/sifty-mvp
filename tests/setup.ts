import "@testing-library/jest-dom/vitest";
import { afterAll, afterEach, beforeAll, vi } from "vitest";

// Default test env. Individual tests may override per-suite via vi.stubEnv().
process.env.NODE_ENV = "test";
process.env.AUTH_SECRET ??= "test-auth-secret-do-not-use-in-production-please";
process.env.CREATOR_EMAIL ??= "s.gonzalez.garza@gmail.com";

// Quiet noisy framework logs from tests.
const originalError = console.error;
beforeAll(() => {
  console.error = (...args: unknown[]) => {
    const first = args[0];
    if (typeof first === "string" && /not wrapped in act/.test(first)) return;
    originalError(...(args as Parameters<typeof console.error>));
  };
});

afterEach(() => {
  vi.unstubAllEnvs();
});

afterAll(() => {
  console.error = originalError;
});
