import { expect, test } from "@playwright/test";

/**
 * Board view against a live server. Lifecycle edits are asserted through
 * the tasks API, then the reloaded UI, because the patch is debounced.
 */

test("create and patch lifecycle round-trip through the API", async ({ request }) => {
  const created = await request.post("/api/tasks", {
    data: { sourceText: `Api lifecycle ${Date.now()}` },
  });
  expect(created.status()).toBe(201);
  const { task } = await created.json();
  expect(task.lifecycle).toBe("inbox");
  expect(task.completedAt).toBeNull();

  const focused = await request.post("/api/tasks", {
    data: { sourceText: `Api focus ${Date.now()}`, lifecycle: "active" },
  });
  expect(focused.status()).toBe(201);
  expect((await focused.json()).task.lifecycle).toBe("active");

  const rejected = await request.post("/api/tasks", {
    data: { sourceText: "Not a status", lifecycle: "today" },
  });
  expect(rejected.status()).toBe(400);

  const done = await request.patch(`/api/tasks/${task.id}`, { data: { lifecycle: "done" } });
  expect(done.ok()).toBe(true);
  const doneTask = (await done.json()).task;
  expect(doneTask.lifecycle).toBe("done");
  expect(doneTask.completedAt).toBeTruthy();

  const back = await request.patch(`/api/tasks/${task.id}`, { data: { lifecycle: "active" } });
  expect(back.ok()).toBe(true);
  const backTask = (await back.json()).task;
  expect(backTask.lifecycle).toBe("active");
  expect(backTask.completedAt).toBeNull();

  const listed = await request.get("/api/tasks");
  expect(listed.ok()).toBe(true);
  const again = (await listed.json()).tasks.find((t: { id: string }) => t.id === task.id);
  expect(again.lifecycle).toBe("active");
  expect(again.completedAt).toBeNull();
});

test("filing from the board survives refresh", async ({ page }) => {
  await page.goto("/inbox", { waitUntil: "networkidle" });
  const marker = `Board file ${Date.now()}`;
  await page.keyboard.press("c");
  await page.getByPlaceholder("What do you need to do?").fill(marker);
  await page.keyboard.press("ControlOrMeta+Enter");
  const sheet = page.getByRole("dialog");
  await expect(sheet).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(sheet).toHaveCount(0);

  let title = "";
  await expect
    .poll(async () => {
      const res = await page.request.get("/api/tasks");
      if (!res.ok()) return "";
      const { tasks } = (await res.json()) as {
        tasks: Array<{ sourceText: string; title: string; aiStatus: string }>;
      };
      const task = tasks.find((t) => t.sourceText === marker);
      if (!task) return "";
      if (task.aiStatus === "pending" || task.aiStatus === "running") return "";
      title = task.title;
      return task.title;
    })
    .not.toBe("");

  await page.getByRole("radio", { name: "Board" }).click();
  await page.getByRole("listbox", { name: "Board" }).focus();
  await page.keyboard.press("Shift+ArrowRight");

  await expect
    .poll(async () => {
      const res = await page.request.get("/api/tasks");
      if (!res.ok()) return "";
      const { tasks } = (await res.json()) as {
        tasks: Array<{ sourceText: string; lifecycle: string }>;
      };
      return tasks.find((t) => t.sourceText === marker)?.lifecycle ?? "";
    })
    .toBe("active");

  await page.reload({ waitUntil: "networkidle" });
  await expect(page.getByRole("heading", { name: "Everything, by status" })).toBeVisible();
  const focus = page.getByRole("region", { name: /^Focus,/ });
  await expect(focus.getByText(title, { exact: false }).first()).toBeVisible();

  await page.goto("/focus");
  await expect(page.getByRole("heading", { name: "Everything, by status" })).toBeVisible();

  await page.getByRole("radio", { name: "List" }).click();
  await expect(page.locator("h1.text-display")).toHaveText("Focus");
});

test("Dropped disclosure is hidden on the board and returns in the list", async ({ page }) => {
  const marker = `Dropped ${Date.now()}`;
  const created = await page.request.post("/api/tasks", {
    data: { sourceText: marker, lifecycle: "dropped" },
  });
  expect(created.status()).toBe(201);

  await page.goto("/done", { waitUntil: "networkidle" });
  await expect(page.getByRole("button", { name: /Dropped/ })).toBeVisible();

  await page.getByRole("radio", { name: "Board" }).click();
  await expect(page.getByRole("button", { name: /Dropped/ })).toHaveCount(0);
  await expect(page.getByRole("region", { name: /Dropped/ })).toHaveCount(0);

  await page.getByRole("radio", { name: "List" }).click();
  await expect(page.getByRole("button", { name: /Dropped/ })).toBeVisible();
});

test("a phone-width board scrolls columns and stacks the toggle", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/today", { waitUntil: "networkidle" });
  await page.getByRole("radio", { name: "Board" }).click();

  const scroller = page.getByTestId("board-scroller");
  await expect
    .poll(async () => scroller.evaluate((el) => el.scrollWidth > el.clientWidth))
    .toBe(true);

  const title = await page.getByRole("heading", { name: "Everything, by status" }).boundingBox();
  const toggle = await page.getByRole("radio", { name: "List" }).boundingBox();
  expect(title).toBeTruthy();
  expect(toggle).toBeTruthy();
  expect(toggle!.y).toBeGreaterThan(title!.y);
});
