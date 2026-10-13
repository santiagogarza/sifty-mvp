import { expect, test } from "@playwright/test";

/**
 * Board view E2E — move persistence, dropped disclosure, viewMode preference.
 */

test("board move persists across reload and viewMode survives route changes", async ({ page }) => {
  await page.goto("/inbox", { waitUntil: "networkidle" });

  await page.getByRole("button", { name: "Board" }).click();
  await expect(page.getByRole("heading", { name: "Focus" })).toBeVisible();

  const inboxCol = page.locator('[data-lifecycle="inbox"]');
  const focusCol = page.locator('[data-lifecycle="active"]');

  const marker = `Board e2e ${Date.now()}`;
  let taskTitle = marker;
  const existing = await inboxCol.locator('[role="option"]').count();
  if (existing === 0) {
    await page.keyboard.press("c");
    await page.getByPlaceholder("What do you need to do?").fill(marker);
    await page.keyboard.press("ControlOrMeta+Enter");
    await expect(inboxCol.getByText(marker.slice(0, 20), { exact: false })).toBeVisible({
      timeout: 10_000,
    });
  } else {
    taskTitle =
      (await inboxCol.locator('[role="option"]').first().innerText())
        .split("\n")
        .map((line) => line.trim())
        .find((line) => line.length > 0 && line !== "Organizing") ?? marker;
  }

  const board = page.getByRole("listbox", { name: "Task board" });
  await board.focus();

  // First inbox card is selected on mount; Alt+→ moves it one column (same setLifecycle path as drag).
  await page.keyboard.press("Alt+ArrowRight");

  await expect(focusCol.getByText(taskTitle.slice(0, 20), { exact: false })).toBeVisible({
    timeout: 5_000,
  });

  await page.goto("/inbox", { waitUntil: "networkidle" });
  await expect(page.getByRole("button", { name: "Board" })).toHaveAttribute("aria-pressed", "true");
  await expect(focusCol.getByText(taskTitle.slice(0, 20), { exact: false })).toBeVisible({
    timeout: 10_000,
  });

  await page.goto("/focus", { waitUntil: "networkidle" });
  await expect(page.getByRole("button", { name: "Board" })).toHaveAttribute("aria-pressed", "true");
  await expect(focusCol.getByText(taskTitle.slice(0, 20), { exact: false })).toBeVisible();

  await page.reload({ waitUntil: "networkidle" });
  await page.goto("/inbox", { waitUntil: "networkidle" });
  await expect(page.getByRole("button", { name: "Board" })).toHaveAttribute("aria-pressed", "true");
});

test("dropped column is hidden until Show dropped is activated", async ({ page }) => {
  await page.goto("/done", { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Board" }).click();

  await expect(page.locator('[data-lifecycle="dropped"]')).toHaveCount(0);

  const showDropped = page.getByRole("button", { name: /Dropped/i });
  const hasDroppedTasks = (await showDropped.count()) > 0;
  if (!hasDroppedTasks) {
    test.skip(true, "No dropped tasks in workspace — seed demo data to exercise disclosure.");
    return;
  }

  await showDropped.click();
  await expect(page.locator('[data-lifecycle="dropped"]')).toBeVisible();
});
