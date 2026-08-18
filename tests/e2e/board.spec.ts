import { expect, test } from "@playwright/test";

test("board move and view preference survive reloads and routes", async ({ page, request }) => {
  const marker = `Board e2e ${Date.now()}`;
  const created = await request.post("/api/tasks", {
    data: {
      sourceText: marker,
      title: marker,
      lifecycle: "active",
      aiStatus: "ready",
    },
  });
  expect(created.status()).toBe(201);
  const { task } = (await created.json()) as { task: { id: string } };

  await page.goto("/focus", { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Board" }).click();
  await expect(page.getByRole("button", { name: "Board" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("heading", { name: "Dropped" })).toHaveCount(0);

  const card = page.locator(`[data-task-id="${task.id}"]`);
  const doneColumn = page.locator('[data-board-column="done"]');
  await expect(card).toBeVisible();
  await doneColumn.scrollIntoViewIfNeeded();

  const cardBox = await card.boundingBox();
  const doneBox = await doneColumn.boundingBox();
  expect(cardBox).not.toBeNull();
  expect(doneBox).not.toBeNull();
  if (!cardBox || !doneBox) return;

  await page.mouse.move(cardBox.x + cardBox.width / 2, cardBox.y + cardBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(cardBox.x + cardBox.width / 2 + 8, cardBox.y + cardBox.height / 2, {
    steps: 2,
  });
  await page.mouse.move(doneBox.x + doneBox.width / 2, doneBox.y + 80, { steps: 12 });
  await page.mouse.up();

  await expect(doneColumn.locator(`[data-task-id="${task.id}"]`)).toBeVisible();
  await expect
    .poll(async () => {
      const response = await request.get(`/api/tasks/${task.id}`);
      if (!response.ok()) return null;
      const json = (await response.json()) as {
        task: { lifecycle: string; completedAt: string | null };
      };
      return json.task;
    })
    .toMatchObject({ lifecycle: "done", completedAt: expect.any(String) });

  await page.reload({ waitUntil: "networkidle" });
  await expect(page.getByRole("button", { name: "Board" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator('[data-board-column="done"]')).toContainText(marker);

  await page.goto("/inbox", { waitUntil: "networkidle" });
  await expect(page.getByRole("button", { name: "Board" })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: /show dropped/i }).click();
  await expect(page.getByRole("heading", { name: "Dropped" })).toBeVisible();
});
