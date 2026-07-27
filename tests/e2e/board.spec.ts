import { expect, test } from "@playwright/test";

test("board mode and a keyboard-filed task survive reload", async ({ page }) => {
  await page.goto("/inbox", { waitUntil: "networkidle" });
  const marker = `Board e2e ${Date.now()}`;

  await page.keyboard.press("c");
  await page.getByPlaceholder("What do you need to do?").fill(marker);
  await page.keyboard.press("ControlOrMeta+Enter");
  await expect(page.getByText(marker).first()).toBeVisible();
  await page.getByRole("button", { name: "Close" }).click();
  await expect(page.getByRole("dialog")).toBeHidden();

  await page.getByRole("button", { name: "Board" }).click();
  await expect(page.getByRole("listbox", { name: "Inbox tasks" })).toBeVisible();
  await expect(page.getByRole("listbox")).toHaveCount(5);

  const card = page.locator('[role="option"]', { hasText: marker });
  await card.focus();
  await page.keyboard.press("Shift+ArrowRight");
  await expect(page.getByRole("listbox", { name: "Focus tasks" }).getByText(marker)).toBeVisible();
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(page.getByRole("listbox", { name: "Inbox tasks" }).getByText(marker)).toBeVisible();

  await page.getByRole("option", { name: new RegExp(marker) }).focus();
  await page.keyboard.press("Shift+ArrowRight");
  await expect(page.getByRole("listbox", { name: "Focus tasks" }).getByText(marker)).toBeVisible();

  await page.reload({ waitUntil: "networkidle" });
  await expect(page.getByRole("button", { name: "Board" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("listbox", { name: "Focus tasks" }).getByText(marker)).toBeVisible();
});

test("mobile long-press opens Move to with the current status", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/inbox?view=board", { waitUntil: "networkidle" });
  const marker = `Mobile board ${Date.now()}`;

  await page.keyboard.press("c");
  await page.getByPlaceholder("What do you need to do?").fill(marker);
  await page.keyboard.press("ControlOrMeta+Enter");
  await expect(page.getByText(marker).first()).toBeVisible();
  await page.getByRole("button", { name: "Close" }).click();

  const card = page.locator('[role="option"]', { hasText: marker });
  await card.dispatchEvent("pointerdown", { pointerType: "touch", bubbles: true });
  await page.waitForTimeout(600);

  const sheet = page.getByRole("dialog", { name: "Move task" });
  await expect(sheet).toBeVisible();
  await expect(sheet.getByRole("heading", { name: "Move to" })).toBeVisible();
  await expect(sheet.getByText("Current")).toBeVisible();
  await expect(page.locator("nav.fixed")).toBeVisible();
});
