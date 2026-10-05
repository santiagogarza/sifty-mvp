import { expect, test } from "@playwright/test";

/**
 * Board drag: dropping a card on another column is a status change.
 * A drop on the column the card already occupies is not.
 *
 * Mouse drags need 5px of travel before they start (so a click still opens
 * the detail sheet). The pointer path below crosses that threshold, then
 * lands in the middle of the target column.
 */

test.use({ viewport: { width: 1600, height: 900 } });

test("dragging a card from Inbox to Focus changes its status", async ({ page }) => {
  const title = `Move board card ${Date.now()}`;

  await page.goto("/inbox", { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Board view" }).waitFor();

  await page.keyboard.press("c");
  await page.getByPlaceholder("What do you need to do?").fill(title);
  await page.keyboard.press("ControlOrMeta+Enter");

  // Capture opens the detail sheet over the board. Close it before dragging.
  await expect(page.getByRole("dialog", { name: title })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);

  await page.getByRole("button", { name: "Board view" }).click();
  await expect(page.getByRole("heading", { name: "Board" })).toBeVisible();

  const inbox = page.getByRole("region", { name: "Inbox column" });
  const focus = page.getByRole("region", { name: "Focus column" });
  const card = inbox.getByText(title, { exact: true });
  await expect(card).toBeVisible();
  await focus.scrollIntoViewIfNeeded();

  const cardBox = await card.boundingBox();
  const focusBox = await focus.boundingBox();
  if (!cardBox || !focusBox) throw new Error("card or Focus column is not visible");

  const startX = cardBox.x + cardBox.width / 2;
  const startY = cardBox.y + Math.min(20, cardBox.height / 2);
  const endX = focusBox.x + focusBox.width / 2;
  const endY = focusBox.y + Math.min(140, focusBox.height / 2);

  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + 12, startY, { steps: 3 });
  await page.mouse.move(endX, endY, { steps: 20 });
  await page.mouse.up();

  await expect(focus.getByText(title, { exact: true })).toBeVisible();
  await expect(inbox.getByText(title, { exact: true })).toHaveCount(0);

  await expect
    .poll(async () => {
      const res = await page.request.get("/api/tasks");
      if (!res.ok()) return null;
      const { tasks } = (await res.json()) as {
        tasks: Array<{ sourceText: string; lifecycle: string }>;
      };
      return tasks.find((t) => t.sourceText === title)?.lifecycle ?? null;
    })
    .toBe("active");
});
