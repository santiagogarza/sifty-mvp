import { type Page, expect, test } from "@playwright/test";
import { gotoApp } from "./helpers";

/**
 * Board view end to end: the global List/Board preference, keyboard filing
 * synced to the server, the Dropped disclosure, and the phone layout.
 */

type ApiTask = { id: string; title: string; lifecycle: string };

async function serverTasks(page: Page): Promise<ApiTask[]> {
  const res = await page.request.get("/api/tasks");
  return ((await res.json()) as { tasks: ApiTask[] }).tasks;
}

async function capture(page: Page, text: string) {
  await page.keyboard.press("c");
  await page.getByPlaceholder("What do you need to do?").fill(text);
  await page.keyboard.press("ControlOrMeta+Enter");
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
}

const boardHeading = (page: Page) => page.getByRole("heading", { name: "Everything, by status" });
const column = (page: Page, name: string) =>
  page.getByRole("region", { name: `${name} column`, exact: true });

test("Shift+Right files a card into Focus, syncs, and survives a reload", async ({ page }) => {
  await gotoApp(page, "/inbox");
  const title = `Board file ${Date.now()}`;
  await capture(page, title);

  await page.getByRole("button", { name: "Board", exact: true }).click();
  await expect(boardHeading(page)).toBeVisible();
  const card = column(page, "Inbox").locator("[data-board-card]", { hasText: title });
  await expect(card).toBeVisible();

  await card.focus();
  await page.keyboard.press("Shift+ArrowRight");
  await expect(page.getByTestId("board-undo")).toContainText("Moved to Focus");
  await expect(column(page, "Focus").getByText(title)).toBeVisible();

  // Patches are debounced; poll until the server has the move.
  await expect
    .poll(async () => (await serverTasks(page)).find((t) => t.title === title)?.lifecycle)
    .toBe("active");

  await page.reload({ waitUntil: "networkidle" });
  await expect(boardHeading(page)).toBeVisible();
  await expect(column(page, "Focus").getByText(title)).toBeVisible();
  await expect(column(page, "Inbox").getByText(title)).toHaveCount(0);
});

test("the Board choice carries across routes", async ({ page }) => {
  await gotoApp(page, "/inbox");
  await page.getByRole("button", { name: "Board", exact: true }).click();
  await expect(boardHeading(page)).toBeVisible();

  await page
    .getByRole("link", { name: /^Focus/ })
    .first()
    .click();
  await expect(page).toHaveURL(/\/focus/);
  await expect(boardHeading(page)).toBeVisible();
  await expect(page.getByRole("button", { name: "Board", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
});

test("Done hides the Dropped disclosure in Board and restores it in List", async ({ page }) => {
  await gotoApp(page, "/done");
  const res = await page.request.post("/api/tasks", {
    data: { sourceText: `Dropped seed ${Date.now()}`, lifecycle: "dropped" },
  });
  expect(res.ok()).toBe(true);
  await page.reload({ waitUntil: "networkidle" });

  const dropped = page.getByRole("button", { name: /^Dropped/ });
  await expect(dropped).toBeVisible();
  await page.getByRole("button", { name: "Board", exact: true }).click();
  await expect(boardHeading(page)).toBeVisible();
  await expect(dropped).toHaveCount(0);
  await page.getByRole("button", { name: "List", exact: true }).click();
  await expect(dropped).toBeVisible();
});

test.describe("phone", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("columns scroll horizontally and the toggle sits under the title", async ({ page }) => {
    await gotoApp(page, "/today");
    await page.getByRole("button", { name: "Board", exact: true }).click();
    await expect(boardHeading(page)).toBeVisible();

    const board = page.getByTestId("board");
    const overflow = await board.evaluate((el) => el.scrollWidth - el.clientWidth);
    expect(overflow).toBeGreaterThan(288);
    // The second column peeks in from the right edge.
    const focusBox = await column(page, "Focus").boundingBox();
    expect(focusBox!.x).toBeLessThan(390);

    const titleBox = await boardHeading(page).boundingBox();
    const toggleBox = await page.getByRole("group", { name: "View" }).boundingBox();
    expect(toggleBox!.y).toBeGreaterThanOrEqual(titleBox!.y + titleBox!.height);
  });
});
