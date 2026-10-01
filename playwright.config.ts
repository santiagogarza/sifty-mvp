import { execFileSync } from "node:child_process";
import { defineConfig, devices } from "@playwright/test";

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000";

// Cloud egress resets TLS to storage.googleapis.com, so Playwright cannot
// download Chrome for Testing here. Use the image's Google Chrome when it is
// on PATH. CI has no such binary and still uses the Chromium it installs.
function systemChrome(): string | undefined {
  try {
    return (
      execFileSync("which", ["google-chrome"], { encoding: "utf8" }).trim() ||
      undefined
    );
  } catch {
    return undefined;
  }
}

const executablePath = systemChrome();

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        ...(executablePath ? { launchOptions: { executablePath } } : {}),
      },
    },
  ],
  webServer: process.env.PLAYWRIGHT_BASE_URL
    ? undefined
    : {
        command: "pnpm dev",
        url: BASE_URL,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
        env: {
          ...process.env,
          // Every smoke test shares one bypass user, and triage requests
          // count against a persistent per-user window. Keep the cap high
          // enough that the burst test can't starve the functional tests
          // running in parallel (it skips itself when no 429 is observed;
          // limiter semantics are covered by unit tests).
          RATELIMIT_TRIAGE_PER_MIN: process.env.RATELIMIT_TRIAGE_PER_MIN ?? "200",
        },
      },
});
