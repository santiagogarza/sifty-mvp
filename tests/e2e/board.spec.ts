import { expect, test } from "@playwright/test";

test.describe("board view", () => {
  test("drag persists across refresh and viewMode survives reload and routes", async ({ page }) => {
    await page.goto("/inbox", { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "Board" }).click();
    await expect(page.getByRole("listbox", { name: "Task board" })).toBeVisible();

    const marker = `Board drag ${Date.now()}`;
    await page.keyboard.press("c");
    await page.getByPlaceholder("What do you need to do?").fill(marker);
    await page.keyboard.press("ControlOrMeta+Enter");
    await expect(page.getByText(marker.slice(0, 30)).first()).toBeVisible({ timeout: 10_000 });
    await page.getByRole("button", { name: "Close" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);

    const card = page
      .getByTestId(/task-card-/)
      .filter({ hasText: marker.slice(0, 30) })
      .first();
    const cardId = await card.getAttribute("data-testid");
    expect(cardId).toBeTruthy();
    const focus = page.getByTestId("board-column-active");

    const from = await card.boundingBox();
    const to = await focus.boundingBox();
    expect(from && to).toBeTruthy();
    await page.mouse.move(from!.x + from!.width / 2, from!.y + from!.height / 2);
    await page.mouse.down();
    await page.mouse.move(to!.x + to!.width / 2, to!.y + 28, { steps: 25 });
    await page.mouse.up();

    await expect(focus.getByTestId(cardId!)).toBeVisible();

    await page.reload({ waitUntil: "networkidle" });
    await expect(page.getByRole("button", { name: "Board" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(page.getByTestId("board-column-active").getByTestId(cardId!)).toBeVisible();

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
