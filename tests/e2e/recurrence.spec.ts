import { type Page, expect, test } from "@playwright/test";
import { gotoApp } from "./helpers";

/**
 * Recurring tasks end to end: set a daily repeat in the sheet, complete
 * the task from the list, and the next instance appears — spawned by the
 * server, already sifted, due tomorrow, carrying the repeat mark.
 */

interface ApiTask {
  id: string;
  title: string;
  lifecycle: string;
  aiStatus: string;
  due: string | null;
  recurrence: { freq: string } | null;
  seriesId: string | null;
}

async function tasksTitled(page: Page, title: string): Promise<ApiTask[]> {
  const res = await page.request.get("/api/tasks");
  if (!res.ok()) return [];
  const { tasks } = (await res.json()) as { tasks: ApiTask[] };
  return tasks.filter((t) => t.title === title);
}

test("completing a recurring task spawns its next instance", async ({ page }) => {
  await gotoApp(page, "/inbox");
  const marker = `Water the plants ${Date.now()}`;

  await page.keyboard.press("c");
  await page.getByPlaceholder("What do you need to do?").fill(marker);
  await page.keyboard.press("ControlOrMeta+Enter");
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();

  // Repeat daily, from the sheet.
  const repeatRow = dialog.getByTestId("recurrence-row");
  await expect(repeatRow).toHaveText(/Doesn't repeat/);
  await repeatRow.click();
  await page.getByRole("menuitemradio", { name: "Daily" }).click();
  await expect(repeatRow).toHaveText(/Daily/);
  await expect(page.getByRole("menuitemradio", { name: "Fixed schedule" })).toHaveAttribute(
    "aria-checked",
    "true",
  );
  await page.keyboard.press("Escape"); // popover
  await page.keyboard.press("Escape"); // sheet
  await expect(dialog).toHaveCount(0);

  const list = page.getByRole("listbox", { name: "Tasks" });
  const row = list.getByRole("option", { name: new RegExp(marker) });
  await expect(row).toBeVisible();
  await expect(row.getByTestId("repeat-glyph")).toHaveAttribute("aria-label", "Repeats daily");

  // Let the rule sync and the (offline) sift finish, so the copy is a sifted one.
  await expect
    .poll(
      async () => {
        const [mine] = await tasksTitled(page, marker);
        return mine ? `${mine.recurrence?.freq ?? "none"}/${mine.aiStatus}` : "missing";
      },
      { timeout: 30_000 },
    )
    .toBe("daily/ready");

  // Complete from the list: the server spawns the next instance.
  await row.getByRole("button", { name: "Mark as done" }).click();

  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowIso = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, "0")}-${String(tomorrow.getDate()).padStart(2, "0")}`;

  await expect
    .poll(
      async () => {
        const mine = await tasksTitled(page, marker);
        const done = mine.find((t) => t.lifecycle === "done");
        const next = mine.find((t) => t.lifecycle !== "done");
        return {
          count: mine.length,
          doneHasRule: done?.recurrence?.freq ?? null,
          next: next
            ? {
                due: next.due,
                aiStatus: next.aiStatus,
                rule: next.recurrence?.freq ?? null,
                series: next.seriesId === done?.id,
              }
            : null,
        };
      },
      { timeout: 15_000 },
    )
    .toEqual({
      count: 2,
      doneHasRule: "daily",
      next: { due: tomorrowIso, aiStatus: "ready", rule: "daily", series: true },
    });

  // …and it shows up in the list without a reload, due tomorrow, still repeating.
  const next = list
    .getByRole("option", { name: new RegExp(marker) })
    .filter({ hasText: "Tomorrow" });
  await expect(next).toBeVisible({ timeout: 15_000 });
  await expect(next.getByTestId("repeat-glyph")).toBeVisible();
  await expect(next.getByRole("button", { name: "Mark as done" })).toBeVisible();

  // Completing again (a replay of the same transition) spawns nothing new.
  const [doneTask] = (await tasksTitled(page, marker)).filter((t) => t.lifecycle === "done");
  const replay = await page.request.patch(`/api/tasks/${doneTask!.id}`, {
    data: { lifecycle: "done" },
  });
  expect(replay.status()).toBe(200);
  expect((await tasksTitled(page, marker)).length).toBe(2);
});
