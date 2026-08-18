import { expect, test } from "@playwright/test";

test.describe("board view", () => {
  test("drag persists across refresh and viewMode survives reload and routes", async ({ page }) => {
    await page.goto("/inbox", { waitUntil: "networkidle" });

    const marker = `Board drag ${Date.now()}`;
    await page.keyboard.press("c");
    await page.getByPlaceholder("What do you need to do?").fill(marker);
    await page.keyboard.press("ControlOrMeta+Enter");
    await expect(page.getByText(marker.slice(0, 30)).first()).toBeVisible({ timeout: 10_000 });

    await page.getByRole("button", { name: "Board" }).click();
    await expect(page.getByRole("listbox", { name: "Task board" })).toBeVisible();

    const card = page
      .getByTestId(/task-card-/)
      .filter({ hasText: marker.slice(0, 30) })
      .first();
    const focus = page.getByTestId("board-column-active");
    await card.dragTo(focus);

    await expect(focus.getByText(marker.slice(0, 30))).toBeVisible();

    await page.reload({ waitUntil: "networkidle" });
    await expect(page.getByRole("button", { name: "Board" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(
      page.getByTestId("board-column-active").getByText(marker.slice(0, 30)),
    ).toBeVisible();

    await page.goto("/focus", { waitUntil: "networkidle" });
    await expect(page.getByRole("button", { name: "Board" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(page.getByRole("listbox", { name: "Task board" })).toBeVisible();
  });

  test("dropped column stays hidden until Show dropped", async ({ page }) => {
    await page.goto("/inbox", { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "Board" }).click();
    await expect(page.getByTestId("board-column-dropped")).toHaveCount(0);
    await page.getByRole("button", { name: /Show dropped/ }).click();
    await expect(page.getByTestId("board-column-dropped")).toBeVisible();
  });
});
