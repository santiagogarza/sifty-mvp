import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * `vercel.json` crons must point at route files that exist and, while the
 * account is on Hobby, run at most once a day (Vercel rejects anything more
 * frequent at deploy time, which would take the whole deployment down).
 */
const ROOT = resolve(__dirname, "../..");
const config = JSON.parse(readFileSync(resolve(ROOT, "vercel.json"), "utf8")) as {
  crons?: Array<{ path: string; schedule: string }>;
};

const DAILY_CRON = /^\d{1,2} \d{1,2} \* \* \*$/;

describe("vercel.json crons", () => {
  it("schedules the grace-period and digest jobs daily", () => {
    const byPath = Object.fromEntries((config.crons ?? []).map((c) => [c.path, c.schedule]));
    expect(byPath).toEqual({
      "/api/cron/expire-grace-periods": "0 6 * * *",
      "/api/cron/send-digests": "0 6 * * *",
    });
  });

  it("every cron targets an existing route handler with a Hobby-compatible schedule", () => {
    for (const cron of config.crons ?? []) {
      expect(cron.path.startsWith("/api/cron/")).toBe(true);
      expect(existsSync(resolve(ROOT, `app${cron.path}/route.ts`))).toBe(true);
      expect(cron.schedule).toMatch(DAILY_CRON);
      const source = readFileSync(resolve(ROOT, `app${cron.path}/route.ts`), "utf8");
      // Each cron route must gate on CRON_SECRET so it can never be a public trigger.
      expect(source).toContain("CRON_SECRET");
    }
  });
});
