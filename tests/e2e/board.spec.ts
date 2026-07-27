import { expect, test } from "@playwright/test";

test("board mode and a keyboard-filed task survive reload", async ({ page }) => {
  await page.goto("/inbox", { waitUntil: "networkidle" });
  const marker = `Board e2e ${Date.now()}`;

  await page.keyboard.press("c");
  await page.getByPlaceholder("What do you need to do?").fill(marker);
  await page.keyboard.press("ControlOrMeta+Enter");
  await expect(page.getByText(marker).first()).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toBeHidden();

  await page.getByRole("button", { name: "Board" }).click();
  await expect(page.getByRole("listbox", { name: "Inbox tasks" })).toBeVisible();
  await expect(page.getByRole("listbox")).toHaveCount(5);

  const card = page.getByRole("option", { name: new RegExp(marker) });
  await card.focus();
  await page.keyboard.press("Shift+ArrowRight");
  await expect(page.getByRole("listbox", { name: "Focus tasks" }).getByText(marker)).toBeVisible();

  await page.reload({ waitUntil: "networkidle" });
  await expect(page.getByRole("button", { name: "Board" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("listbox", { name: "Focus tasks" }).getByText(marker)).toBeVisible();
});
