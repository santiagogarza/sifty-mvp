import path from "node:path";
import { defineConfig } from "vitest/config";

/**
 * `pnpm eval` — separate from `pnpm test` so unit tests stay fast and
 * key-free while evals may call real models.
 *
 * Offline (`SIFTY_AI_OFFLINE=1`): seconds, deterministic, no network.
 * Online: minutes and real spend; see evals/README.md.
 */
export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    include: ["evals/**/*.eval.ts"],
    setupFiles: ["./evals/setup.ts"],
    // Relative dates in the golden set resolve against a fixed clock in UTC.
    env: { TZ: "UTC" },
    testTimeout: 60_000,
    // The whole golden set runs once in `beforeAll`; online that is ~300 model calls.
    hookTimeout: 30 * 60_000,
    // One file at a time: the model-calling file must not run twice in parallel.
    fileParallelism: false,
    passWithNoTests: false,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, ".."),
    },
  },
});
