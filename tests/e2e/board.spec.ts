import { type APIRequestContext, type Page, expect, test } from "@playwright/test";

/**
 * Board view e2e. Like the smoke suite, runs against the dev server with
 * SIFTY_DISABLE_AUTH=1: the API is reachable as the bypass user, so tests
 * seed tasks server-side and the client pulls them on load.
 *
 * Tasks are seeded with aiStatus "ready" so the client's triage auto-resume
 * can't race the drag's sync push.
 */

const uniq = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

async function createTask(
  request: APIRequestContext,
  fields: { title: string; lifecycle?: "inbox" | "active" | "dropped" },
): Promise<{ id: string }> {
  const res = await request.post("/api/tasks", {
    data: {
      sourceText: fields.title,
      title: fields.title,
      aiStatus: "ready",
      ...(fields.lifecycle ? { lifecycle: fields.lifecycle } : {}),
    },
  });
  expect(res.status()).toBe(201);
  return (await res.json()).task;
}

async function switchToBoard(page: Page) {
  await page.getByRole("button", { name: "Board view" }).click();
  await expect(page.getByRole("listbox", { name: "Task board" })).toBeVisible();
}

function column(page: Page, name: string) {
  return page.getByRole("group", { name: `${name} column` });
}

/** Drag a card into a column with real mouse events (5px activation). */
async function dragCardToColumn(page: Page, title: string, columnName: string) {
  const card = page.getByRole("option").filter({ hasText: title });
  const cardBox = await card.boundingBox();
  const targetBox = await column(page, columnName).boundingBox();
  if (!cardBox || !targetBox) throw new Error("card or column not on screen");

  await page.mouse.move(cardBox.x + cardBox.width / 2, cardBox.y + cardBox.height / 2);
  await page.mouse.down();
  // First hop crosses the activation distance, then travel to the target.
  await page.mouse.move(cardBox.x + cardBox.width / 2 + 12, cardBox.y + cardBox.height / 2, {
    steps: 4,
  });
  await page.mouse.move(targetBox.x + targetBox.width / 2, targetBox.y + 90, { steps: 12 });
  await page.mouse.up();
}

test("dragging a card to another column survives refresh and sync", async ({ page }) => {
  const title = `Board drag ${uniq()}`;
  const task = await createTask(page.request, { title, lifecycle: "inbox" });

  await page.goto("/inbox", { waitUntil: "networkidle" });
  await switchToBoard(page);
  await expect(column(page, "Inbox").getByText(title)).toBeVisible();

  await dragCardToColumn(page, title, "Focus");
  await expect(column(page, "Focus").getByText(title)).toBeVisible();
  await expect(column(page, "Inbox").getByText(title)).toBeHidden();

  // The background push must land server-side before we trust a reload.
  await expect
    .poll(
      async () => {
        const res = await page.request.get("/api/tasks");
        if (!res.ok()) return "unreachable";
        const { tasks } = (await res.json()) as {
          tasks: Array<{ id: string; lifecycle: string }>;
        };
        return tasks.find((t) => t.id === task.id)?.lifecycle;
      },
      { timeout: 10_000 },
    )
    .toBe("active");

  await page.reload({ waitUntil: "networkidle" });
  await expect(column(page, "Focus").getByText(title)).toBeVisible();
});

test("the Dropped column stays behind the Show dropped disclosure", async ({ page }) => {
  const title = `Board dropped ${uniq()}`;
  await createTask(page.request, { title, lifecycle: "dropped" });

  await page.goto("/inbox", { waitUntil: "networkidle" });
  await switchToBoard(page);

  await expect(column(page, "Dropped")).toBeHidden();
  await expect(page.getByText(title)).toBeHidden();

  await page.getByRole("button", { name: /show dropped/i }).click();
  await expect(column(page, "Dropped")).toBeVisible();
  await expect(column(page, "Dropped").getByText(title)).toBeVisible();
});

test("the board preference persists across routes and reloads", async ({ page }) => {
  await page.goto("/today", { waitUntil: "networkidle" });
  await switchToBoard(page);

  await page.goto("/focus", { waitUntil: "networkidle" });
  await expect(page.getByRole("listbox", { name: "Task board" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Board view" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );

  await page.reload({ waitUntil: "networkidle" });
  await expect(page.getByRole("listbox", { name: "Task board" })).toBeVisible();

  await page.getByRole("button", { name: "List view" }).click();
  await expect(page.getByRole("listbox", { name: "Task board" })).toBeHidden();
});
