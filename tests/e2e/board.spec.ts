import { expect, test } from "@playwright/test";

/**
 * Board is a view over the same tasks. Lifecycle edits ride the 400ms patch
 * debounce, so the server assertion polls instead of reading the DOM once.
 */

test("keyboard file survives reload and the preference is global", async ({ page }) => {
  const marker = `Board file ${Date.now()}`;
  await page.goto("/inbox", { waitUntil: "networkidle" });

  await page.keyboard.press("c");
  await page.getByPlaceholder("What do you need to do?").fill(marker);
  await page.keyboard.press("ControlOrMeta+Enter");
  // Capture opens the detail sheet on the next frame. Escape before that
  // lands on the dialog that's already closing, and the sheet stays up.
  const sheet = page.getByPlaceholder("What's the very next concrete step?");
  await expect(sheet).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);

  await page.getByRole("radio", { name: "Board" }).click();
  const card = page.locator("[data-board-card]", { hasText: marker });
  await expect(card).toBeVisible();
  await card.focus();
  await page.keyboard.press("Shift+ArrowRight");

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
  await expect(page.getByRole("region", { name: /^Focus/ }).getByText(marker)).toBeVisible();
  await expect(page.getByRole("region", { name: /^Inbox/ }).getByText(marker)).toHaveCount(0);

  await page.goto("/focus", { waitUntil: "networkidle" });
  await expect(page.getByRole("heading", { name: "Everything, by status" })).toBeVisible();

  await page.goto("/inbox", { waitUntil: "networkidle" });
  await page.getByRole("radio", { name: "List" }).click();
  await expect(page.getByText("Newly captured tasks")).toBeVisible();
  await expect(page.getByText(marker)).toHaveCount(0);
});

test("Done hides the Dropped disclosure in Board and restores it in List", async ({ page }) => {
  const marker = `Dropped ${Date.now()}`;
  const created = await page.request.post("/api/tasks", {
    data: { sourceText: marker, lifecycle: "dropped" },
  });
  expect(created.ok()).toBeTruthy();

  await page.goto("/done", { waitUntil: "networkidle" });
  await page.evaluate(() => window.localStorage.clear());
  await page.reload({ waitUntil: "networkidle" });

  const dropped = page.getByRole("button", { name: /^Dropped/ });
  await expect(dropped).toBeVisible();

  await page.getByRole("radio", { name: "Board" }).click();
  await expect(page.getByRole("heading", { name: "Everything, by status" })).toBeVisible();
  await expect(dropped).toHaveCount(0);

  await page.getByRole("radio", { name: "List" }).click();
  await expect(dropped).toBeVisible();
});

test("a phone-width board scrolls columns and stacks the toggle under the title", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/inbox", { waitUntil: "networkidle" });
  await page.getByRole("radio", { name: "Board" }).click();

  const title = page.getByRole("heading", { name: "Everything, by status" });
  const toggle = page.getByRole("radiogroup", { name: "Layout" });
  await expect(title).toBeVisible();
  const titleBox = await title.boundingBox();
  const toggleBox = await toggle.boundingBox();
  expect(titleBox).toBeTruthy();
  expect(toggleBox).toBeTruthy();
  expect(toggleBox!.y).toBeGreaterThan(titleBox!.y + titleBox!.height - 1);

  const overflows = await page.locator("[data-board-scroller]").evaluate((el) => {
    return el.scrollWidth > el.clientWidth + 1;
  });
  expect(overflows).toBe(true);
});
