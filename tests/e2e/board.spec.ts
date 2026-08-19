import { expect, test } from "@playwright/test";

test.describe("Board View", () => {
  test.beforeEach(async ({ page }) => {
    // Navigate to Inbox and create a task
    await page.goto("/inbox", { waitUntil: "networkidle" });

    // Create a task
    await page.keyboard.press("c");
    await page.getByPlaceholder("What do you need to do?").fill("Test Kanban Task");
    await page.keyboard.press("ControlOrMeta+Enter");

    // Wait for detail sheet to open, then close it
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).not.toBeVisible();

    // Wait for task to appear
    await expect(page.getByText("Test Kanban Task").first()).toBeVisible();
  });

  test("toggle to board, move card, reload, persists", async ({ page }) => {
    // Switch to board view
    await page.getByRole("button", { name: "Board view" }).click();

    // Verify board renders
    await expect(page.getByRole("main").getByText("Inbox", { exact: true }).first()).toBeVisible();
    await expect(page.getByRole("main").getByText("Focus", { exact: true }).first()).toBeVisible();

    // Wait for card to appear in board
    const card = page.locator('div[role="option"]', { hasText: "Test Kanban Task" });
    await expect(card).toBeVisible();

    // Use keyboard to select the first card
    await page.keyboard.press("j");

    // Verify it's selected (has ring-1)
    await expect(card).toHaveClass(/ring-1/);

    // Use keyboard to move to Focus
    await page.keyboard.press("Alt+ArrowRight");

    // Verify it moved (wait for state update)
    // The Focus column should have the task
    const focusCol = page.locator(".flex-col", { hasText: "Focus" });
    await expect(
      focusCol.locator('div[role="option"]', { hasText: "Test Kanban Task" }),
    ).toBeVisible();

    // Reload page
    await page.reload();

    // Verify viewMode persisted (should still be board)
    await expect(page.getByRole("button", { name: "Board view" })).toHaveClass(
      /bg-\[var\(--surface\)\]/,
    );

    // Verify task is still in Focus column
    const focusColAfter = page.locator(".flex-col", { hasText: "Focus" });
    await expect(
      focusColAfter.locator('div[role="option"]', { hasText: "Test Kanban Task" }),
    ).toBeVisible();
  });

  test("dropped column is hidden by default and can be toggled", async ({ page }) => {
    // Switch to done view to see dropped toggle
    await page.goto("/done");
    await page.getByRole("button", { name: "Board view" }).click();

    // Dropped should not be visible initially
    await expect(page.getByText("Dropped", { exact: true })).not.toBeVisible();

    // Click Show dropped
    await page.getByRole("button", { name: "Show dropped" }).click();

    // Dropped should now be visible
    await expect(page.getByText("Dropped", { exact: true })).toBeVisible();

    // Click Hide dropped
    await page.getByRole("button", { name: "Hide dropped" }).click();

    // Dropped should be hidden again
    await expect(page.getByText("Dropped", { exact: true })).not.toBeVisible();
  });
});
