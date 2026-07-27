import { expect, test } from "@playwright/test";

test("drag a card from Inbox to Focus column", async ({ page }) => {
  await page.goto("/focus?view=board", { waitUntil: "networkidle" });

  const card = page.getByRole("listbox", { name: "Inbox" }).getByRole("option").first();
  await expect(card).toBeVisible();

  const inboxBox = await card.boundingBox();
  const focusColumn = page.getByRole("listbox", { name: "Focus" });
  const focusBox = await focusColumn.boundingBox();
  if (!inboxBox || !focusBox) throw new Error("missing bounding boxes");

  const startX = inboxBox.x + inboxBox.width / 2;
  const startY = inboxBox.y + inboxBox.height / 2;
  const endX = focusBox.x + focusBox.width / 2;
  const endY = focusBox.y + 80;

  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(endX, endY, { steps: 15 });
  await page.mouse.up();

  await expect(page.getByText(/moved to focus/i)).toBeVisible({ timeout: 5000 });
});
