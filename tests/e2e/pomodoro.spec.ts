import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

/**
 * Focus timer end-to-end.
 *
 * The 25-minute wait is skipped by seeding the persisted anchors rather than
 * by shortening the durations: the point of the design is that the UI is a
 * pure function of `now` and two timestamps, so a block whose `endsAt` is
 * three seconds out behaves exactly like one twenty-five minutes in.
 */

const STORE_KEY = "sifty-pomodoro-v1";

interface SeedInterval {
  startedAt: number;
  endsAt: number;
}

async function seedTimer(
  page: Page,
  seed: { block?: SeedInterval; rest?: SeedInterval },
): Promise<void> {
  await page.addInitScript(
    ([key, payload]) => {
      const now = Date.now();
      const shift = (interval: { startedAt: number; endsAt: number }) => ({
        startedAt: now + interval.startedAt,
        endsAt: now + interval.endsAt,
        pausedAt: null,
      });
      const seeded = payload as { block?: SeedInterval; rest?: SeedInterval };
      window.localStorage.setItem(
        key as string,
        JSON.stringify({
          state: {
            timer: {
              block: seeded.block
                ? { ...shift(seeded.block), id: "pom_seed", closedAt: null, completions: [] }
                : null,
              rest: seeded.rest ? { ...shift(seeded.rest), id: "rest_seed" } : null,
              history: [],
            },
            // Headless Chromium has no audio device; the visible states and
            // the tab title are what this suite asserts on.
            soundEnabled: false,
            notifyEnabled: false,
          },
          version: 1,
        }),
      );
    },
    [STORE_KEY, seed] as const,
  );
}

const startButton = (page: Page) => page.getByRole("button", { name: /Start a 25-minute focus/i });
const detailsButton = (page: Page) => page.getByRole("button", { name: "Focus timer details" });

test("one click starts a block and the header shows the countdown", async ({ page }) => {
  await page.goto("/today", { waitUntil: "networkidle" });

  await expect(startButton(page)).toBeVisible();
  await startButton(page).click();

  await expect(page.getByText(/^2[45]:\d\d$/)).toBeVisible();
  await expect(page.getByRole("button", { name: /of focus left/i })).toBeVisible();
});

test("tasks closed during a block are counted and listed", async ({ page }) => {
  await page.goto("/today", { waitUntil: "networkidle" });
  await startButton(page).click();

  const row = page.getByRole("option").first();
  const title = (await row.locator("span").first().innerText()).trim();
  await row.getByRole("button", { name: "Mark as done" }).click();

  await detailsButton(page).click();
  const panel = page.getByRole("dialog");
  await expect(panel.getByText("Closed this block")).toBeVisible();
  await expect(panel.getByText(title, { exact: false }).first()).toBeVisible();
});

test("a reload mid-block resumes at the real remaining time", async ({ page }) => {
  // Started twenty minutes ago: five minutes should be left, not twenty-five.
  await seedTimer(page, { block: { startedAt: -20 * 60_000, endsAt: 5 * 60_000 } });
  await page.goto("/today", { waitUntil: "networkidle" });

  await expect(page.getByText(/^0[45]:\d\d$/)).toBeVisible();
});

test("the block rings, offers the break, and the break rings back", async ({ page }) => {
  await seedTimer(page, { block: { startedAt: -25 * 60_000 + 4_000, endsAt: 4_000 } });
  await page.goto("/today", { waitUntil: "networkidle" });

  // The panel opens itself at the bell — that's the "let me know" moment.
  const panel = page.getByRole("dialog");
  await expect(panel.getByText("Break time")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole("button", { name: /start your 5-minute break/i })).toBeVisible();
  await expect(page).toHaveTitle(/^Break time · /);

  await panel.getByRole("button", { name: "Start 5-minute break" }).click();
  await expect(panel.getByText("On a break")).toBeVisible();
  await expect(page.getByRole("button", { name: /0[45]:\d\d of break left/ })).toBeVisible();
});

test("the end of a break asks you back to work", async ({ page }) => {
  await seedTimer(page, { rest: { startedAt: -5 * 60_000 + 3_000, endsAt: 3_000 } });
  await page.goto("/today", { waitUntil: "networkidle" });

  await expect(page.getByRole("button", { name: /start the next focus block/i })).toBeVisible({
    timeout: 15_000,
  });
  await expect(page).toHaveTitle(/^Focus time · /);
});
