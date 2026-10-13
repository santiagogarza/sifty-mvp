import { type Locator, type Page, devices, expect, test } from "@playwright/test";

/**
 * Board view. Runs with the auth bypass and offline triage (see
 * playwright.config.ts). Tasks are created through the API so the client
 * pulls them the same way a second device would.
 */

test("remembers Board per route and leaves other routes on List", async ({ page }) => {
  await page.goto("/inbox", { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Board", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Everything, by status" })).toBeVisible();

  await page.reload({ waitUntil: "networkidle" });
  await expect(page.getByRole("button", { name: "Board", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );

  await page.goto("/focus", { waitUntil: "networkidle" });
  await expect(page.getByRole("button", { name: "List", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.getByRole("heading", { name: "Everything, by status" })).toHaveCount(0);
});

test("dragging a card files it, syncs, and survives a fresh client", async ({ page }) => {
  const title = `Board drag ${Date.now()}`;
  const task = await createTask(page, { sourceText: title, title, lifecycle: "inbox" });

  await page.goto("/inbox", { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Board", exact: true }).click();

  const card = page.locator(`[data-task-id="${task.id}"]`);
  await expect(card).toBeVisible();
  await dragCard(page, card, page.locator('[data-column="active"]'));

  await expect(
    page.locator('[data-column="active"]').locator(`[data-task-id="${task.id}"]`),
  ).toBeVisible();
  await expect
    .poll(async () => (await fetchTask(page, task.id))?.lifecycle, { timeout: 10_000 })
    .toBe("active");

  await page.evaluate(() => window.localStorage.clear());
  await page.goto("/focus", { waitUntil: "networkidle" });
  await expect(page.getByText(title).first()).toBeVisible({ timeout: 10_000 });
});

test("moving into Done sets completedAt and undo clears it", async ({ page }) => {
  const title = `Board done ${Date.now()}`;
  const task = await createTask(page, { sourceText: title, title, lifecycle: "active" });

  await page.goto("/focus", { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Board", exact: true }).click();
  await dragCard(
    page,
    page.locator(`[data-task-id="${task.id}"]`),
    page.locator('[data-column="done"]'),
  );

  await expect
    .poll(async () => (await fetchTask(page, task.id))?.completedAt, { timeout: 10_000 })
    .toBeTruthy();

  await page.getByRole("button", { name: /undo/i }).click();
  await expect
    .poll(async () => fetchTask(page, task.id), { timeout: 10_000 })
    .toMatchObject({ lifecycle: "active", completedAt: null });
});

test("Shift+Arrow files the selected card and Enter opens it", async ({ page }) => {
  const title = `Board keys ${Date.now()}`;
  const task = await createTask(page, { sourceText: title, title, lifecycle: "inbox" });

  await page.goto("/inbox", { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Board", exact: true }).click();
  const card = page.locator(`[data-task-id="${task.id}"]`);
  await card.focus();
  await page.keyboard.press("Shift+ArrowRight");

  await expect(
    page.locator('[data-column="active"]').locator(`[data-task-id="${task.id}"]`),
  ).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(new RegExp(`task=${task.id}`));
});

test("the Today board shows only Today-eligible tasks, split by real status", async ({ page }) => {
  const stamp = Date.now();
  const todayTitle = `Today lens ${stamp}`;
  const laterTitle = `Someday lens ${stamp}`;
  await createTask(page, {
    sourceText: todayTitle,
    title: todayTitle,
    lifecycle: "inbox",
    priorityBucket: "do_now",
  });
  await createTask(page, {
    sourceText: laterTitle,
    title: laterTitle,
    lifecycle: "someday",
  });

  await page.goto("/today", { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Board", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Today, by status" })).toBeVisible();
  await expect(page.getByText(todayTitle).first()).toBeVisible();
  await expect(page.getByText(laterTitle)).toHaveCount(0);
  await expect(page.locator('[data-column="someday"]')).toBeVisible();
  await expect(page.locator('[data-column="done"]')).toBeVisible();
});

test("a column Add row files the capture into that column", async ({ page }) => {
  const title = `Add row ${Date.now()}`;
  await page.goto("/inbox", { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Board", exact: true }).click();
  await page.getByRole("button", { name: "Add a task to Focus" }).click();
  await page.getByPlaceholder("What do you need to do?").fill(title);
  await page.keyboard.press("ControlOrMeta+Enter");
  await expect(page.locator('[data-column="active"]').getByText(title)).toBeVisible();
});

test("renders two hundred tasks and still accepts a drag", async ({ page }) => {
  const stamp = Date.now();
  const lifecycles = ["inbox", "active", "waiting", "someday", "done"] as const;
  for (let offset = 0; offset < 200; offset += 25) {
    await Promise.all(
      Array.from({ length: 25 }, (_, i) => {
        const n = offset + i;
        const title = `Bulk ${stamp} ${n}`;
        return createTask(page, {
          sourceText: title,
          title,
          lifecycle: lifecycles[n % lifecycles.length]!,
        });
      }),
    );
  }

  await page.goto("/inbox", { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Board", exact: true }).click();
  for (const lifecycle of lifecycles) {
    await expect(page.locator(`[data-column="${lifecycle}"]`)).toBeVisible();
  }
  const card = page.locator('[data-column="inbox"] [data-task-id]').first();
  const id = await card.getAttribute("data-task-id");
  await dragCard(page, card, page.locator('[data-column="active"]'));
  await expect(
    page.locator('[data-column="active"]').locator(`[data-task-id="${id}"]`),
  ).toBeVisible();
});

test.describe("mobile", () => {
  test.use({
    viewport: devices["iPhone 13"].viewport,
    userAgent: devices["iPhone 13"].userAgent,
    deviceScaleFactor: devices["iPhone 13"].deviceScaleFactor,
    isMobile: devices["iPhone 13"].isMobile,
    hasTouch: devices["iPhone 13"].hasTouch,
  });

  test("columns are 288px, scroll sideways, and a hold-and-drag files a card", async ({ page }) => {
    const title = `Mobile drag ${Date.now()}`;
    const task = await createTask(page, { sourceText: title, title, lifecycle: "inbox" });

    await page.goto("/inbox", { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "Board", exact: true }).click();

    const column = page.locator('[data-column="inbox"]');
    const width = await column.evaluate((el) => el.getBoundingClientRect().width);
    expect(width).toBeGreaterThan(270);
    expect(width).toBeLessThan(310);
    await expect(page.getByTestId("board-keyboard-hint")).toBeHidden();

    const scroller = page.getByTestId("board-columns");
    await scroller.evaluate((el) => {
      el.scrollLeft = 300;
    });
    expect(await scroller.evaluate((el) => el.scrollLeft)).toBeGreaterThan(100);
    // Leave the source card on screen and the next column well inside the
    // viewport. Sitting on the right edge makes the row auto-scroll to Done.
    await scroller.evaluate((el) => {
      el.scrollLeft = 120;
    });

    await dragCard(
      page,
      page.locator(`[data-task-id="${task.id}"]`),
      page.locator('[data-column="active"]'),
      {
        holdMs: 250,
        preferPeek: true,
      },
    );
    await expect(
      page.locator('[data-column="active"]').locator(`[data-task-id="${task.id}"]`),
    ).toBeVisible();
  });
});

async function createTask(
  page: Page,
  data: { sourceText: string; title: string; lifecycle: string; priorityBucket?: string },
): Promise<{ id: string }> {
  const res = await page.request.post("/api/tasks", { data });
  expect(res.status()).toBe(201);
  const body = (await res.json()) as { task: { id: string } };
  return body.task;
}

async function fetchTask(
  page: Page,
  id: string,
): Promise<{ lifecycle: string; completedAt: string | null } | undefined> {
  const res = await page.request.get("/api/tasks");
  if (!res.ok()) return undefined;
  const body = (await res.json()) as {
    tasks: Array<{ id: string; lifecycle: string; completedAt: string | null }>;
  };
  return body.tasks.find((task) => task.id === id);
}

async function dragCard(
  page: Page,
  card: Locator,
  column: Locator,
  opts?: { holdMs?: number; preferPeek?: boolean },
) {
  if (opts?.preferPeek) {
    await card.evaluate((el) => {
      el.scrollIntoView({ block: "nearest", inline: "nearest" });
    });
    await page.getByTestId("board-columns").evaluate((el) => {
      el.scrollLeft = 0;
    });
  } else {
    await card.scrollIntoViewIfNeeded();
    await column.scrollIntoViewIfNeeded();
  }
  const cardBox = await card.boundingBox();
  const colBox = await column.boundingBox();
  if (!cardBox || !colBox) throw new Error("Board card or column is not visible");
  const startX = cardBox.x + Math.min(40, cardBox.width / 2);
  const startY = cardBox.y + Math.min(28, cardBox.height / 2);
  // On a phone, drop on the sliver of the next column that peeks in — and
  // stay out of the auto-scroll edge so the row doesn't run away.
  const dropX = opts?.preferPeek ? colBox.x + 18 : colBox.x + colBox.width / 2;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  if (opts?.holdMs) await page.waitForTimeout(opts.holdMs);
  await page.mouse.move(startX + 16, startY, { steps: 4 });
  await page.mouse.move(dropX, colBox.y + Math.min(90, colBox.height / 2), { steps: 18 });
  await page.mouse.up();
}
