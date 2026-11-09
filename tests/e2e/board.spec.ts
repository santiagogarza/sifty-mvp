import { type Page, expect, test } from "@playwright/test";

/**
 * Board smoke: a real pointer drag moves a card between status columns,
 * the move reaches the server, and it survives a reload. Every task this
 * spec creates is deleted again — the smoke suite shares one bypass user.
 */

async function openBoard(page: Page, path = "/inbox") {
  await page.goto(path, { waitUntil: "networkidle" });
  await page.evaluate(() => window.localStorage.setItem("sifty.viewMode", "board"));
  await page.reload({ waitUntil: "networkidle" });
  await expect(page.getByRole("heading", { name: "Everything, by status" })).toBeVisible();
}

/** Capture a task (it lands in Inbox) and return its id. */
async function capture(page: Page, text: string): Promise<string> {
  await page.keyboard.press("c");
  await page.getByPlaceholder("What do you need to do?").fill(text);
  await page.keyboard.press("ControlOrMeta+Enter");
  // Capture opens the detail sheet on the new task: `?task=<id>`.
  await expect(page).toHaveURL(/[?&]task=/);
  const id = new URL(page.url()).searchParams.get("task");
  expect(id).toBeTruthy();
  await page.keyboard.press("Escape");
  await expect(page).not.toHaveURL(/[?&]task=/);
  return id!;
}

async function serverLifecycle(page: Page, id: string): Promise<string | null> {
  const res = await page.request.get("/api/tasks");
  if (!res.ok()) return null;
  const { tasks } = (await res.json()) as { tasks: Array<{ id: string; lifecycle: string }> };
  return tasks.find((t) => t.id === id)?.lifecycle ?? null;
}

async function drag(page: Page, from: string, to: string) {
  const source = await page.locator(from).boundingBox();
  const target = await page.locator(to).boundingBox();
  if (!source || !target) throw new Error("drag endpoints not visible");
  await page.mouse.move(source.x + source.width / 2, source.y + source.height / 2);
  await page.mouse.down();
  await page.mouse.move(source.x + source.width / 2 + 12, source.y + source.height / 2, {
    steps: 4,
  });
  await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2, { steps: 15 });
  await page.mouse.up();
}

test("dragging a card to another column moves it, syncs it, and survives a reload", async ({
  page,
}) => {
  await openBoard(page);
  const id = await capture(page, `Board drag ${Date.now()}`);
  const card = `[data-task-id="${id}"]`;

  try {
    await expect(page.locator(`section[data-status="inbox"] ${card}`)).toBeVisible();

    await drag(page, card, 'section[data-status="active"]');

    await expect(page.locator(`section[data-status="active"] ${card}`)).toBeVisible();
    await expect(page.getByText(/^Moved to Focus$/)).toBeVisible();
    await expect.poll(() => serverLifecycle(page, id), { timeout: 10_000 }).toBe("active");

    await page.reload({ waitUntil: "networkidle" });
    await expect(page.locator(`section[data-status="active"] ${card}`)).toBeVisible();
  } finally {
    await page.request.delete(`/api/tasks/${id}`);
  }
});

test("Shift+Arrow files the selected card and Cmd/Ctrl+Z undoes it", async ({ page }) => {
  await openBoard(page);
  const id = await capture(page, `Board keys ${Date.now()}`);
  const card = page.locator(`[data-task-id="${id}"]`);

  try {
    await card.focus();
    await page.keyboard.press("Shift+ArrowRight");
    await expect(
      page.locator(`section[data-status="active"] [data-task-id="${id}"]`),
    ).toBeFocused();
    await expect.poll(() => serverLifecycle(page, id), { timeout: 10_000 }).toBe("active");

    await page.keyboard.press("ControlOrMeta+z");
    await expect(page.locator(`section[data-status="inbox"] [data-task-id="${id}"]`)).toBeVisible();
    await expect.poll(() => serverLifecycle(page, id), { timeout: 10_000 }).toBe("inbox");
  } finally {
    await page.request.delete(`/api/tasks/${id}`);
  }
});

test("the List/Board choice carries across task pages", async ({ page }) => {
  await page.goto("/inbox", { waitUntil: "networkidle" });
  await page.evaluate(() => window.localStorage.setItem("sifty.viewMode", "list"));
  await page.reload({ waitUntil: "networkidle" });

  await page.getByRole("button", { name: "Board", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Everything, by status" })).toBeVisible();

  await page.goto("/focus", { waitUntil: "networkidle" });
  await expect(page.getByRole("heading", { name: "Everything, by status" })).toBeVisible();
  await expect(page.locator('section[data-status="done"]')).toBeVisible();

  await page.getByRole("button", { name: "List", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Focus", level: 1 }).last()).toBeVisible();
  await expect(page.locator("section[data-status]")).toHaveCount(0);
});
