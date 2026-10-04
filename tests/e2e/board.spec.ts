import { expect, test } from "@playwright/test";

test("board files a task into Focus and list view drops it from Inbox", async ({ page }) => {
  await page.goto("/inbox", { waitUntil: "networkidle" });

  const marker = `Board file ${Date.now()}`;
  await page.keyboard.press("c");
  await page.getByPlaceholder("What do you need to do?").fill(marker);
  await page.keyboard.press("ControlOrMeta+Enter");
  const sheet = page.getByRole("dialog");
  await expect(sheet).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(sheet).toBeHidden();

  await page.getByRole("radio", { name: "Board" }).click();
  await expect(page.getByRole("heading", { name: "Everything, by status" })).toBeVisible();
  await expect(page.locator("[aria-current='true']")).toBeFocused();

  await page.keyboard.press("Shift+ArrowRight");
  await expect(page.getByText("Moved to Focus")).toBeVisible();
  await page.screenshot({ path: "/opt/cursor/artifacts/board-filed.png", fullPage: false });

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
  await expect(page.getByRole("region", { name: /Focus/ }).getByText(marker)).toBeVisible();

  await page.getByRole("radio", { name: "List" }).click();
  await expect(page.locator("h1.text-display")).toHaveText("Inbox");
  await expect(page.getByText("Newly captured tasks.")).toBeVisible();
  await expect(page.getByText(marker)).toHaveCount(0);
});

test("phone layout puts the toggle under the title and scrolls columns", async ({ page }) => {
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

  const overflows = await page.getByTestId("board-scroller").evaluate((el) => {
    return el.scrollWidth > el.clientWidth + 1;
  });
  expect(overflows).toBe(true);
  await page.screenshot({ path: "/opt/cursor/artifacts/board-mobile.png", fullPage: false });
});
