import { expect, test } from "@playwright/test";

/**
 * Board view E2E — toggle, keyboard move, persistence across reload.
 */

test("toggle Focus into Board, move by keyboard, survives reload", async ({ page }) => {
  await page.goto("/focus", { waitUntil: "networkidle" });

  const marker = `Board e2e ${Date.now()}`;
  const createRes = await page.request.post("/api/tasks", {
    data: {
      sourceText: marker,
      title: marker,
      lifecycle: "inbox",
    },
  });
  expect(createRes.ok()).toBeTruthy();

  await page.reload({ waitUntil: "networkidle" });
  await page.getByRole("button", { name: /board/i }).click();

  const card = page
    .getByRole("listbox", { name: "Inbox" })
    .getByRole("option", { name: new RegExp(marker.slice(0, 20)) });
  await expect(card).toBeVisible({ timeout: 10_000 });

  await expect(page.getByRole("listbox", { name: "Focus" })).toBeVisible();
  await expect(page.getByRole("listbox", { name: "Waiting on" })).toBeVisible();
  await expect(page.getByRole("listbox", { name: "Someday" })).toBeVisible();
  await expect(page.getByRole("listbox", { name: "Done" })).toBeVisible();

  await card.focus();
  await page.keyboard.press("Shift+ArrowRight");

  await expect
    .poll(async () => {
      const res = await page.request.get("/api/tasks");
      if (!res.ok()) return false;
      const { tasks } = (await res.json()) as {
        tasks: Array<{ sourceText: string; lifecycle: string }>;
      };
      const task = tasks.find((t) => t.sourceText === marker);
      return task?.lifecycle === "active";
    })
    .toBe(true);

  await page.goto("/focus?view=board", { waitUntil: "networkidle" });

  await expect(
    page.getByRole("group", { name: "View mode" }).getByRole("button", { name: "Board" }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(
    page.getByRole("listbox", { name: "Focus" }).getByRole("option", {
      name: new RegExp(marker.slice(0, 20)),
    }),
  ).toBeVisible({ timeout: 10_000 });
});
