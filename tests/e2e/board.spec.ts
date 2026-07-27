import { expect, test } from "@playwright/test";

/**
 * Board view smoke.
 *
 * Runs against the live dev server with `SIFTY_DISABLE_AUTH=1` (same setup as
 * smoke.spec). Proves the PRD's load-bearing claims: five columns, a
 * keyboard move, and — the only thing that can't be shown any other way —
 * that the move survives a refresh with the board still selected.
 *
 * Assertions count cards per column rather than matching titles, since
 * offline triage may rewrite a captured task's title after it lands.
 */

function inbox(page: import("@playwright/test").Page) {
  return page.getByRole("listbox", { name: "Inbox" });
}
function focus(page: import("@playwright/test").Page) {
  return page.getByRole("listbox", { name: "Focus" });
}

test("board: five columns, a keyboard move, and it survives a refresh", async ({ page }) => {
  await page.goto("/focus", { waitUntil: "networkidle" });

  // Guarantee at least one Inbox card regardless of demo-seed state.
  await page.keyboard.press("c");
  await page.getByPlaceholder("What do you need to do?").fill(`Board e2e ${Date.now()}`);
  await page.keyboard.press("ControlOrMeta+Enter");
  await expect(page.getByPlaceholder("What do you need to do?")).toBeHidden();

  // Switch List → Board.
  await page.getByRole("button", { name: "Board" }).click();
  await expect(page.getByRole("listbox")).toHaveCount(5);

  const inboxBefore = await inbox(page).getByRole("option").count();
  const focusBefore = await focus(page).getByRole("option").count();
  expect(inboxBefore).toBeGreaterThan(0);

  // Drive the board's own keyboard model: focus the board, select the first
  // Inbox card, then file it one column right into Focus.
  await page.locator('[aria-label="Board"]').first().focus();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Shift+ArrowRight");

  await expect(inbox(page).getByRole("option")).toHaveCount(inboxBefore - 1);
  await expect(focus(page).getByRole("option")).toHaveCount(focusBefore + 1);

  // The move (and the board mode) survive a full page refresh.
  await page.reload({ waitUntil: "networkidle" });
  await expect(page.getByRole("listbox")).toHaveCount(5);
  await expect(page.getByRole("button", { name: "Board" })).toHaveAttribute("aria-pressed", "true");
  await expect(focus(page).getByRole("option")).toHaveCount(focusBefore + 1);
  await expect(inbox(page).getByRole("option")).toHaveCount(inboxBefore - 1);
});
