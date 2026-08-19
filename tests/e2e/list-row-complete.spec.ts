import { expect, test } from "@playwright/test";

/**
 * Regression: clicking a list row's completion circle must mark the task done.
 * A regression once reduced the circle's handler to `stopPropagation()` only,
 * so clicks no longer toggled lifecycle — the task never got marked done,
 * while completing from the detail sheet still worked.
 *
 * Captures its own Inbox task so the spec does not depend on `SIFTY_DEMO_SEED`
 * (CI never sets that flag; createTask starts tasks in Inbox, not Focus).
 */
test("clicking a list-row circle marks the task done", async ({ page }) => {
  await page.goto("/inbox", { waitUntil: "networkidle" });

  const marker = `List-row complete ${Date.now()}`;
  await page.keyboard.press("c");
  await page.getByPlaceholder("What do you need to do?").fill(marker);
  await page.keyboard.press("ControlOrMeta+Enter");

  // Capture opens the detail sheet; dismiss it so the click hits the list-row
  // circle, not the sheet's own complete control (which never regressed).
  await page.getByRole("button", { name: "Close" }).click();
  await expect(page.getByText(marker.slice(0, 30)).first()).toBeVisible();

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
