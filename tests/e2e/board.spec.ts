import { type Page, expect, test } from "@playwright/test";

/**
 * Board view. Runs like the smoke suite (`SIFTY_DISABLE_AUTH=1`, offline
 * triage). Each test gets a fresh browser context, so the List/Board
 * preference starts at List.
 */

type ApiTask = { id: string; sourceText: string; lifecycle: string };

async function serverTask(page: Page, marker: string): Promise<ApiTask | undefined> {
  const res = await page.request.get("/api/tasks");
  if (!res.ok()) return undefined;
  const { tasks } = (await res.json()) as { tasks: ApiTask[] };
  return tasks.find((t) => t.sourceText === marker);
}

async function switchTo(page: Page, mode: "List" | "Board") {
  await page.getByRole("group", { name: "Layout" }).getByRole("button", { name: mode }).click();
}

test("Shift+Right files a card into Focus, persisted across reload", async ({ page }) => {
  await page.goto("/inbox", { waitUntil: "networkidle" });

  const marker = `Board e2e ${Date.now()}`;
  await page.keyboard.press("c");
  await page.getByPlaceholder("What do you need to do?").fill(marker);
  await page.keyboard.press("ControlOrMeta+Enter");
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toBeHidden();

  await expect.poll(async () => (await serverTask(page, marker))?.lifecycle).toBe("inbox");

  await switchTo(page, "Board");
  const board = page.getByRole("group", { name: "Board" });
  const inbox = page.getByRole("region", { name: "Inbox" });
  await expect(inbox.getByText(marker)).toBeVisible();

  // Other suites capture into the same workspace; walk down to our card.
  await board.focus();
  for (let i = 0; i < 40; i++) {
    await page.keyboard.press("ArrowDown");
    const focused = await page.evaluate(() => document.activeElement?.textContent ?? "");
    if (focused.includes(marker)) break;
  }
  await page.keyboard.press("Shift+ArrowRight");

  await expect(page.getByRole("region", { name: "Focus" }).getByText(marker)).toBeVisible();
  await expect(page.getByText("Moved to Focus")).toBeVisible();
  await expect
    .poll(async () => (await serverTask(page, marker))?.lifecycle, { timeout: 10_000 })
    .toBe("active");

  await page.reload({ waitUntil: "networkidle" });
  await expect(page.getByRole("region", { name: "Focus" }).getByText(marker)).toBeVisible();
});

test("the Board choice carries across routes", async ({ page }) => {
  await page.goto("/inbox", { waitUntil: "networkidle" });
  await switchTo(page, "Board");
  await expect(page.getByRole("heading", { name: "Everything, by status" })).toBeVisible();

  await page.goto("/focus", { waitUntil: "networkidle" });
  await expect(page.getByRole("heading", { name: "Everything, by status" })).toBeVisible();
  await expect(page.getByRole("region")).toHaveCount(5);
});

test("Done hides the Dropped disclosure in Board and restores it in List", async ({ page }) => {
  const res = await page.request.post("/api/tasks", {
    data: { sourceText: `Dropped e2e ${Date.now()}`, lifecycle: "dropped" },
  });
  expect(res.status()).toBe(201);

  await page.goto("/done", { waitUntil: "networkidle" });
  const disclosure = page.getByRole("button", { name: /^Dropped/ });
  await expect(disclosure).toBeVisible();

  await switchTo(page, "Board");
  await expect(page.getByRole("heading", { name: "Everything, by status" })).toBeVisible();
  await expect(disclosure).toBeHidden();

  await switchTo(page, "List");
  await expect(disclosure).toBeVisible();
});

test.describe("mobile", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("columns scroll horizontally and the toggle sits under the title", async ({ page }) => {
    await page.goto("/today", { waitUntil: "networkidle" });
    await switchTo(page, "Board");

    const board = page.getByRole("group", { name: "Board" });
    await expect(board).toBeVisible();
    const overflow = await board.evaluate((el) => el.scrollWidth - el.clientWidth);
    expect(overflow).toBeGreaterThan(0);

    const title = await page.getByRole("heading", { name: "Everything, by status" }).boundingBox();
    const toggle = await page.getByRole("group", { name: "Layout" }).boundingBox();
    expect(title && toggle).toBeTruthy();
    expect(toggle!.y).toBeGreaterThanOrEqual(title!.y + title!.height);
  });
});
