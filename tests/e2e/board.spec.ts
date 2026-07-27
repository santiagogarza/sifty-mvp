import { expect, test } from "@playwright/test";

/**
 * Board view, end to end.
 *
 * The one thing only a real browser can prove: a move made in the board
 * is a real edit — it survives a refresh, and so does the choice to be in
 * board mode at all.
 */

test("toggling a list into Board lays out the five status columns", async ({ page }) => {
  await page.goto("/focus", { waitUntil: "networkidle" });

  await page.getByRole("radio", { name: "Board" }).click();

  await expect(page.getByRole("heading", { name: "Everything, by status" })).toBeVisible();
  for (const label of ["Inbox", "Focus", "Waiting on", "Someday", "Done"]) {
    await expect(page.getByRole("listbox", { name: new RegExp(`^${label},`) })).toBeVisible();
  }
  // `dropped` has no view, so it gets no column.
  await expect(page.getByRole("listbox", { name: /^Dropped,/ })).toHaveCount(0);
});

test("a keyboard move survives a refresh, and so does board mode", async ({ page }) => {
  await page.goto("/focus?view=board", { waitUntil: "networkidle" });

  // Capture a task of this run's own, so the test does not depend on
  // whatever the shared bypass workspace happens to hold.
  const marker = `Board move ${Date.now()}`;
  await page.keyboard.press("c");
  await page.getByPlaceholder("What do you need to do?").fill(marker);
  await page.keyboard.press("ControlOrMeta+Enter");
  // Capture hands off to the detail sheet. Dismiss it, or its focus trap
  // owns every keystroke that follows.
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);

  // Triage rewrites the title, so wait it out and then track the task by
  // its id — the one handle that survives being organized and re-filed.
  const readTask = async () => {
    const res = await page.request.get("/api/tasks");
    if (!res.ok()) return null;
    const { tasks } = (await res.json()) as {
      tasks: Array<{ id: string; sourceText: string; aiStatus: string; lifecycle: string }>;
    };
    return tasks.find((t) => t.sourceText === marker) ?? null;
  };
  await expect
    .poll(async () => (await readTask())?.aiStatus ?? null, { timeout: 15_000 })
    .toBe("ready");
  const taskId = (await readTask())?.id;
  expect(taskId).toBeTruthy();

  await page.goto("/focus?view=board", { waitUntil: "networkidle" });
  const card = page.locator(`[data-task-id="${taskId}"]`);
  await expect(card).toBeVisible();
  expect(await card.locator("xpath=ancestor::*[@data-column]").getAttribute("data-column")).toBe(
    "inbox",
  );

  // With that card selected, ⇧→ files it one column over.
  await card.focus();
  await expect(card).toBeFocused();
  await page.keyboard.press("Shift+ArrowRight");

  await expect(page.locator(`[data-column="active"] [data-task-id="${taskId}"]`)).toBeVisible();
  await expect(page.getByRole("button", { name: /Undo/ })).toBeVisible();

  // The push is background; wait for the server to agree before reloading.
  await expect
    .poll(async () => (await readTask())?.lifecycle ?? null, { timeout: 10_000 })
    .toBe("active");

  await page.reload({ waitUntil: "networkidle" });

  // Board mode came back with the page, and the card is where it was put.
  await expect(page.getByRole("heading", { name: "Everything, by status" })).toBeVisible();
  await expect(page.locator(`[data-column="active"] [data-task-id="${taskId}"]`)).toBeVisible();
  await expect(page.locator(`[data-column="inbox"] [data-task-id="${taskId}"]`)).toHaveCount(0);
});

test("the board remembers itself per view, and List stays the default", async ({ page }) => {
  await page.goto("/someday", { waitUntil: "networkidle" });
  await page.getByRole("radio", { name: "Board" }).click();
  await expect(page.getByRole("heading", { name: "Everything, by status" })).toBeVisible();

  // A different view is untouched by the choice.
  await page.goto("/waiting", { waitUntil: "networkidle" });
  await expect(page.getByRole("radio", { name: "List" })).toHaveAttribute("aria-checked", "true");

  // The remembered choice comes back without the query param.
  await page.goto("/someday", { waitUntil: "networkidle" });
  await expect(page.getByRole("radio", { name: "Board" })).toHaveAttribute("aria-checked", "true");
});
