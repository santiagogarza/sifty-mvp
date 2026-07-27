import { expect, test } from "@playwright/test";

test("board mode files a task by keyboard and persists across reload", async ({
  page,
  request,
}) => {
  const marker = `Board e2e ${Date.now()}`;
  const create = await request.post("/api/tasks", { data: { sourceText: marker } });
  expect(create.status()).toBeLessThan(400);
  const { task } = (await create.json()) as { task: { id: string } };

  await page.goto("/focus", { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Board" }).click();

  await expect(page.getByRole("listbox", { name: "Inbox tasks" })).toBeVisible();
  await expect(page.getByRole("listbox", { name: "Focus tasks" })).toBeVisible();

  const card = page.getByRole("option", { name: new RegExp(marker) });
  await expect(card).toBeVisible();
  await card.focus();
  await page.keyboard.press("Shift+ArrowRight");

  await expect(page.getByRole("listbox", { name: "Focus tasks" }).getByText(marker)).toBeVisible();
  await expect
    .poll(
      async () => {
        const res = await request.get("/api/tasks");
        if (!res.ok()) return null;
        const json = (await res.json()) as {
          tasks: Array<{ id: string; lifecycle: string }>;
        };
        return json.tasks.find((candidate) => candidate.id === task.id)?.lifecycle ?? null;
      },
      { timeout: 10_000 },
    )
    .toBe("active");

  await page.reload({ waitUntil: "networkidle" });
  await expect(page.getByRole("button", { name: "Board" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("listbox", { name: "Focus tasks" }).getByText(marker)).toBeVisible();
});
