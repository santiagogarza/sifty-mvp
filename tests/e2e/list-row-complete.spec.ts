import { expect, test } from "@playwright/test";

/**
 * Regression: clicking a list row's completion circle must mark the task done.
 * A regression once reduced the circle's handler to `stopPropagation()` only,
 * so clicks no longer toggled lifecycle — the task never got marked done,
 * while completing from the detail sheet still worked.
 */
test("clicking a list-row circle marks the task done", async ({ page }) => {
  await page.goto("/focus", { waitUntil: "networkidle" });
  await page.waitForTimeout(1000);

  const doneCount = () =>
    page.evaluate(() => {
      const raw = localStorage.getItem("sifty-store-v1");
      if (!raw) return 0;
      const s = JSON.parse(raw).state as { tasks: Array<{ lifecycle: string }> };
      return s.tasks.filter((t) => t.lifecycle === "done").length;
    });

  const circle = page.locator('button[aria-label="Mark as done"]').first();
  await expect(circle).toBeVisible();

  const before = await doneCount();
  await circle.click();

  await expect.poll(async () => doneCount(), { timeout: 5000 }).toBe(before + 1);
});
