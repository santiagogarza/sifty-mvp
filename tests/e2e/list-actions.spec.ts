import { type Page, expect, test } from "@playwright/test";

/**
 * List actions end to end: Shift+click bulk move, `s t` snooze with undo,
 * and Duplicate from the sheet — on a real list with real sync.
 */

async function capture(page: Page, text: string) {
  await page.keyboard.press("c");
  await page.getByPlaceholder("What do you need to do?").fill(text);
  await page.keyboard.press("ControlOrMeta+Enter");
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
}

test("bulk move, keyboard snooze with undo, and duplicate", async ({ page }) => {
  await page.goto("/inbox", { waitUntil: "networkidle" });
  const stamp = Date.now();
  const titles = [`Bulk one ${stamp}`, `Bulk two ${stamp}`, `Bulk three ${stamp}`];
  for (const t of titles) await capture(page, t);

  const list = page.getByRole("listbox", { name: "Tasks" });
  const rows = list.getByRole("option");
  // New captures land at the top of the Inbox (newest first).
  await expect(rows.nth(0)).toContainText(titles[2]!);

  // Shift+click range: rows 0..2, then move them to Someday. (Opening a
  // row is a URL change, so wait for the sheet before dismissing it.)
  const dialog = page.getByRole("dialog");
  await rows.nth(0).click();
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await rows.nth(2).click({ modifiers: ["Shift"] });
  await expect(page.getByTestId("bulk-bar")).toContainText("3 selected");
  await page.getByRole("button", { name: /Move to Someday/ }).click();
  await expect(page.getByTestId("toast").filter({ hasText: "Moved 3 to Someday" })).toBeVisible();
  for (const t of titles) await expect(list.getByText(t)).toHaveCount(0);
  await expect
    .poll(async () => {
      const res = await page.request.get("/api/tasks");
      const { tasks } = (await res.json()) as
        | Array<never>
        | { tasks: Array<{ title: string; lifecycle: string }> } as {
        tasks: Array<{ title: string; lifecycle: string }>;
      };
      return tasks.filter((t) => titles.includes(t.title) && t.lifecycle === "someday").length;
    })
    .toBe(3);

  // Snooze the first remaining row from the keyboard, then undo it.
  await capture(page, `Snooze me ${stamp}`);
  const target = list.getByRole("option", { name: new RegExp(`Snooze me ${stamp}`) });
  await target.click();
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(target).toBeFocused();
  await page.keyboard.press("s");
  await expect(page.getByTestId("snooze-hint")).toBeVisible();
  await page.keyboard.press("t");
  const snoozeToast = page.getByTestId("toast").filter({ hasText: "Snoozed until" });
  await expect(snoozeToast).toBeVisible();
  await expect(target).toContainText("Tomorrow");
  await snoozeToast.getByRole("button", { name: "Undo" }).click();
  await expect(target).not.toContainText("Tomorrow");

  // Duplicate from the sheet: the copy opens, titled "(copy)".
  await target.click();
  await expect(dialog).toBeFocused();
  await dialog.getByRole("button", { name: "Duplicate task" }).click();
  await expect(dialog.getByPlaceholder("Task title")).toHaveValue(`Snooze me ${stamp} (copy)`);
  await page.keyboard.press("Escape");
  await expect(list.getByText(`Snooze me ${stamp} (copy)`)).toBeVisible();
});
