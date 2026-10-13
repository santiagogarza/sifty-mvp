import { type Page, expect, test } from "@playwright/test";

/**
 * Board smoke: toggle from a list to the board, move a card by mouse drag
 * and by keyboard, confirm each move reached the server, and toggle back to
 * the list that was open before.
 */

async function seedInboxTask(page: Page, title: string): Promise<string> {
  const id = `task_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  const res = await page.request.post("/api/tasks", {
    data: { id, sourceText: title, title, lifecycle: "inbox", aiStatus: "ready" },
  });
  expect(res.status()).toBe(201);
  return id;
}

/** dnd-kit's keyboard sensor starts listening a frame after the lift, so pace keys like a person. */
async function pressKeys(page: Page, keys: string[]): Promise<void> {
  for (const key of keys) {
    await page.keyboard.press(key);
    await page.waitForTimeout(60);
  }
}

async function serverLifecycle(page: Page, id: string): Promise<string | undefined> {
  const res = await page.request.get("/api/tasks");
  const { tasks } = (await res.json()) as { tasks: Array<{ id: string; lifecycle: string }> };
  return tasks.find((t) => t.id === id)?.lifecycle;
}

test("board: toggle from the list, drag and keyboard-move a card, toggle back", async ({
  page,
}) => {
  const title = `Board smoke ${Date.now()}`;
  const id = await seedInboxTask(page, title);
  const column = (name: string) => page.getByRole("region", { name, exact: true });
  const card = (status: string) => column(status).getByRole("button", { name: new RegExp(title) });

  await page.goto("/inbox", { waitUntil: "networkidle" });
  await page.getByRole("link", { name: "Board", exact: true }).click();
  await expect(page).toHaveURL(/\/board$/, { timeout: 30_000 });
  await expect(card("Inbox")).toBeVisible();

  // Mouse: past the 5px activation distance, then across to Focus.
  const from = await card("Inbox").boundingBox();
  const to = await column("Focus").boundingBox();
  if (!from || !to) throw new Error("board is not laid out");
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(from.x + from.width / 2 + 12, from.y + from.height / 2, { steps: 4 });
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 3, { steps: 12 });
  await page.mouse.up();

  await expect(card("Focus")).toBeVisible();
  await expect(card("Inbox")).toHaveCount(0);
  await expect(page).not.toHaveURL(/task=/);
  await expect.poll(() => serverLifecycle(page, id), { timeout: 10_000 }).toBe("active");

  // Keyboard: Space lifts, → jumps one column, Space drops.
  const announcer = page.locator('[role="status"][aria-live="assertive"]');
  await card("Focus").focus();
  await pressKeys(page, ["Space", "ArrowRight", "Space"]);
  await expect(announcer).toHaveText(`Moved ${title} to Waiting on.`);
  await expect(card("Waiting on")).toBeVisible();
  await expect(card("Waiting on")).toBeFocused();
  await expect.poll(() => serverLifecycle(page, id), { timeout: 10_000 }).toBe("waiting");

  // A plain click still opens the task.
  await card("Waiting on").click();
  await expect(page).toHaveURL(new RegExp(`task=${id}`));
  await page.keyboard.press("Escape");
  await expect(page).not.toHaveURL(/task=/);

  await page.getByRole("link", { name: "List", exact: true }).click();
  await expect(page).toHaveURL(/\/inbox$/);
});
