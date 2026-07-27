import { expect, test } from "@playwright/test";

/**
 * Board view e2e — proves the PRD contract that a filed card survives refresh
 * and that List↔Board mode is remembered.
 */

test("toggle Focus into Board, keyboard-file a card, reload keeps column + mode", async ({
  page,
}) => {
  await page.goto("/focus", { waitUntil: "networkidle" });

  const marker = `Board e2e ${Date.now()}`;
  await page.keyboard.press("c");
  await page.getByPlaceholder("What do you need to do?").fill(marker);
  await page.keyboard.press("ControlOrMeta+Enter");

  // Land in Inbox after capture; move into Focus via the detail sheet or by
  // opening board from Focus after filing. Capture creates inbox tasks —
  // go to inbox, open board, file into Focus with the keyboard.
  await page.goto("/inbox", { waitUntil: "networkidle" });
  await expect(page.getByText(marker.slice(0, 30)).first()).toBeVisible({ timeout: 10_000 });

  await page.getByRole("button", { name: "Board", pressed: false }).click();
  await expect(page.getByRole("button", { name: "Board", pressed: true })).toBeVisible();

  // Five columns are present.
  for (const label of ["Inbox", "Focus", "Waiting on", "Someday", "Done"]) {
    await expect(page.getByRole("listbox", { name: label })).toBeVisible();
  }

  const card = page.getByRole("option", { name: new RegExp(marker.slice(0, 24), "i") }).first();
  await card.focus();
  await page.keyboard.press("Shift+ArrowRight");

  await expect
    .poll(async () => {
      const focusCol = page.getByRole("listbox", { name: "Focus" });
      return focusCol.getByRole("option", { name: new RegExp(marker.slice(0, 24), "i") }).count();
    })
    .toBeGreaterThan(0);

  // Reload — board mode and column placement must survive.
  await page.reload({ waitUntil: "networkidle" });

  await expect(page.getByRole("button", { name: "Board", pressed: true })).toBeVisible({
    timeout: 10_000,
  });
  await expect(
    page
      .getByRole("listbox", { name: "Focus" })
      .getByRole("option", { name: new RegExp(marker.slice(0, 24), "i") }),
  ).toBeVisible({ timeout: 10_000 });
});
