import { expect, test } from "@playwright/test";

/**
 * Board view against a live server. Lifecycle edits ride the 400ms patch
 * debounce, so the API assertion polls instead of reading once.
 */

test("filing a card from the board survives reload", async ({ page }) => {
  const marker = `Board file ${Date.now()}`;
  await page.goto("/inbox", { waitUntil: "networkidle" });

  await page.keyboard.press("c");
  await page.getByPlaceholder("What do you need to do?").fill(marker);
  await page.keyboard.press("ControlOrMeta+Enter");
  // Let triage finish before filing, so a late server snapshot cannot
  // overwrite the lifecycle edit.
  await expect(page.getByText("Organizing")).toHaveCount(0, { timeout: 15_000 });
  await page.keyboard.press("Escape");

  await page.getByRole("radio", { name: "Board" }).click();
  const board = page.getByTestId("board");
  await board.focus();
  for (let step = 0; step < 40; step++) {
    const selected = page.locator("[aria-selected='true']");
    if ((await selected.count()) > 0 && (await selected.first().innerText()).includes(marker)) {
      break;
    }
    await page.keyboard.press("ArrowDown");
  }
  await expect(page.locator("[aria-selected='true']")).toContainText(marker);
  await page.keyboard.press("Shift+ArrowRight");
  await expect(page.getByText("Moved to Focus")).toBeVisible();

  await expect
    .poll(
      async () => {
        const res = await page.request.get("/api/tasks");
        if (!res.ok()) return null;
        const { tasks } = (await res.json()) as {
          tasks: Array<{ sourceText: string; lifecycle: string }>;
        };
        return tasks.find((task) => task.sourceText === marker)?.lifecycle ?? null;
      },
      { timeout: 10_000 },
    )
    .toBe("active");

  await page.reload({ waitUntil: "networkidle" });
  await expect(page.getByRole("heading", { name: "Everything, by status" })).toBeVisible();
  await expect(page.getByRole("region", { name: /^Focus/ }).getByText(marker)).toBeVisible();
});

test("the layout choice carries to the next task route", async ({ page }) => {
  await page.goto("/inbox", { waitUntil: "networkidle" });
  await page.getByRole("radio", { name: "Board" }).click();
  await page.goto("/focus", { waitUntil: "networkidle" });
  await expect(page.getByRole("heading", { name: "Everything, by status" })).toBeVisible();
  await expect(page.getByRole("radio", { name: "Board" })).toBeChecked();
});

test("the Done page hides Dropped tasks while the board is showing", async ({ page }) => {
  const marker = `Dropped ${Date.now()}`;
  const created = await page.request.post("/api/tasks", {
    data: { sourceText: marker, lifecycle: "dropped" },
  });
  expect(created.status()).toBe(201);

  await page.goto("/done", { waitUntil: "networkidle" });
  const disclosure = page.getByRole("button", { name: /Dropped/ });
  await expect(disclosure).toBeVisible();

  await page.getByRole("radio", { name: "Board" }).click();
  await expect(disclosure).toHaveCount(0);
  await expect(page.getByRole("region", { name: /Dropped/ })).toHaveCount(0);

  await page.getByRole("radio", { name: "List" }).click();
  await expect(page.getByRole("button", { name: /Dropped/ })).toBeVisible();
});

test("a phone-width board scrolls sideways and stacks the toggle under the title", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/today", { waitUntil: "networkidle" });
  await page.getByRole("radio", { name: "Board" }).click();

  const overflows = await page.getByTestId("board-scroller").evaluate((el) => {
    return el.scrollWidth > el.clientWidth + 1;
  });
  expect(overflows).toBe(true);

  const title = await page.getByRole("heading", { name: "Everything, by status" }).boundingBox();
  const toggle = await page.getByRole("radio", { name: "List" }).boundingBox();
  expect(title).not.toBeNull();
  expect(toggle).not.toBeNull();
  expect(toggle!.y).toBeGreaterThan(title!.y + title!.height - 2);
});
