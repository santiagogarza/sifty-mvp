import { expect, test } from "@playwright/test";

/**
 * Board view smoke: the only test that proves the PRD's "survives a page
 * refresh" — toggle a status view into Board, move a card by keyboard,
 * reload, and the card is still in its new column with Board mode still
 * on.
 *
 * Same environment contract as smoke.spec.ts: a live dev server with
 * `SIFTY_DISABLE_AUTH=1`.
 */

test("board: toggle, five columns, keyboard move, refresh persistence", async ({ page }) => {
  await page.goto("/inbox", { waitUntil: "networkidle" });

  // Seed a task through capture; it lands in Inbox with the raw text as
  // its provisional title.
  const marker = `Board smoke ${Date.now()}`;
  await page.keyboard.press("c");
  await page.getByPlaceholder("What do you need to do?").fill(marker);
  await page.keyboard.press("ControlOrMeta+Enter");

  // Capture opens the new task's detail sheet (async, via ?task=); wait for
  // it so the Escape can't race ahead of it, then close it before toggling.
  await expect(page).toHaveURL(/task=/);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByText(marker).first()).toBeVisible();

  // Toggle into Board mode.
  await page.getByRole("button", { name: "Board" }).click();
  await expect(page).toHaveURL(/view=board/);

  // All five columns, in the sidebar's own words.
  for (const name of ["Inbox", "Focus", "Waiting on", "Someday", "Done"]) {
    await expect(page.getByRole("listbox", { name })).toBeVisible();
  }

  const inboxColumn = page.getByRole("listbox", { name: "Inbox" });
  const card = inboxColumn.getByRole("option").filter({ hasText: marker });
  await expect(card).toBeVisible();

  // Keyboard move: select the card, ⇧→ files it into Focus.
  await card.focus();
  await page.keyboard.press("Shift+ArrowRight");

  const focusColumn = page.getByRole("listbox", { name: "Focus" });
  await expect(focusColumn.getByRole("option").filter({ hasText: marker })).toBeVisible();
  await expect(inboxColumn.getByRole("option").filter({ hasText: marker })).toHaveCount(0);

  // The undo pill names the destination.
  await expect(page.getByText("Moved to Focus", { exact: true })).toBeVisible();

  // Survives a refresh: still in Board mode, still in Focus.
  await page.reload({ waitUntil: "networkidle" });
  await expect(
    page.getByRole("listbox", { name: "Focus" }).getByRole("option").filter({ hasText: marker }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Board" })).toHaveAttribute("aria-pressed", "true");
});
