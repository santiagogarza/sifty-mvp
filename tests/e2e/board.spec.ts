import { type Page, expect, test } from "@playwright/test";

/**
 * Board view: the store write is what has to survive refresh, so these
 * drive the keyboard path (Shift+arrow) and poll the API rather than
 * simulating a pixel-perfect drag. The pointer path is dnd-kit's sensor
 * wiring, checked by hand against the Figma frames.
 *
 * Lifecycle edits ride the 400ms patch debounce in `lib/store/sync.ts`, so
 * every server assertion polls.
 */

const boardRadio = (page: Page) => page.getByRole("radio", { name: "Board" });
const listRadio = (page: Page) => page.getByRole("radio", { name: "List" });
const column = (page: Page, status: string) => page.locator(`section[data-status="${status}"]`);

async function setMode(page: Page, mode: "list" | "board") {
  const radio = mode === "board" ? boardRadio(page) : listRadio(page);
  if ((await radio.getAttribute("aria-checked")) !== "true") await radio.click();
  await expect(radio).toHaveAttribute("aria-checked", "true");
}

async function captureViaKeyboard(page: Page, text: string) {
  await page.keyboard.press("c");
  await page.getByPlaceholder("What do you need to do?").fill(text);
  await page.keyboard.press("ControlOrMeta+Enter");
  await expect(page.getByPlaceholder("What do you need to do?")).toBeHidden();
  // Capture opens the sheet on the new task a frame later; wait for it, then leave it.
  const sheet = page.getByRole("dialog");
  await expect(sheet).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(sheet).toBeHidden();
}

const boardTitle = (page: Page) => page.getByRole("heading", { name: "Everything, by status" });

async function serverLifecycle(page: Page, sourceText: string): Promise<string | null> {
  const res = await page.request.get("/api/tasks");
  if (!res.ok()) return null;
  const { tasks } = (await res.json()) as {
    tasks: Array<{ sourceText: string; lifecycle: string }>;
  };
  return tasks.find((t) => t.sourceText === sourceText)?.lifecycle ?? null;
}

async function deleteBySourceText(page: Page, sourceText: string) {
  const res = await page.request.get("/api/tasks");
  if (!res.ok()) return;
  const { tasks } = (await res.json()) as { tasks: Array<{ id: string; sourceText: string }> };
  for (const t of tasks.filter((t) => t.sourceText === sourceText)) {
    await page.request.delete(`/api/tasks/${t.id}`);
  }
}

test.afterEach(async ({ page }) => {
  await page.evaluate(() => window.localStorage.removeItem("sifty.viewMode")).catch(() => {});
});

test("filing a card from the keyboard survives refresh and the preference is global", async ({
  page,
}) => {
  const marker = `Board e2e ${Date.now()}`;
  await page.goto("/inbox", { waitUntil: "networkidle" });
  await captureViaKeyboard(page, marker);
  await expect(page.getByText(marker)).toBeVisible();

  await setMode(page, "board");
  await expect(boardTitle(page)).toBeVisible();
  await expect(page.locator("section[data-status]")).toHaveCount(5);

  const card = page.getByRole("option", { name: marker });
  await expect(column(page, "inbox").getByRole("option", { name: marker })).toBeVisible();
  await card.focus();
  await expect(card).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("Shift+ArrowRight");

  await expect(column(page, "active").getByRole("option", { name: marker })).toBeVisible();
  await expect(page.getByText("Moved to Focus")).toBeVisible();
  await expect.poll(() => serverLifecycle(page, marker), { timeout: 10_000 }).toBe("active");

  await page.reload({ waitUntil: "networkidle" });
  await expect(boardRadio(page)).toHaveAttribute("aria-checked", "true");
  await expect(column(page, "active").getByRole("option", { name: marker })).toBeVisible();

  // One global preference: another task route opens as Board too.
  await page.goto("/focus", { waitUntil: "networkidle" });
  await expect(boardRadio(page)).toHaveAttribute("aria-checked", "true");
  await expect(boardTitle(page)).toBeVisible();

  // Back to List on Inbox: the route's own header returns and the filed task is gone.
  await page.goto("/inbox", { waitUntil: "networkidle" });
  await setMode(page, "list");
  await expect(page.getByRole("heading", { name: "Inbox" })).toHaveCount(2);
  await expect(boardTitle(page)).toBeHidden();
  await expect(page.getByText(marker)).toBeHidden();

  await deleteBySourceText(page, marker);
});

test("the Done page hides its Dropped disclosure in Board and brings it back in List", async ({
  page,
}) => {
  const marker = `Dropped e2e ${Date.now()}`;
  const created = await page.request.post("/api/tasks", {
    data: { sourceText: marker, lifecycle: "dropped" },
  });
  expect(created.status()).toBe(201);

  await page.goto("/done", { waitUntil: "networkidle" });
  await setMode(page, "list");
  const disclosure = page.getByRole("button", { name: /^Dropped/ });
  await expect(disclosure).toBeVisible();

  await setMode(page, "board");
  await expect(disclosure).toBeHidden();
  await expect(page.locator("section[data-status]")).toHaveCount(5);
  await expect(page.getByRole("option", { name: marker })).toHaveCount(0);

  await setMode(page, "list");
  await expect(disclosure).toBeVisible();

  await deleteBySourceText(page, marker);
});

test("on a phone the columns scroll sideways and the toggle sits under the title", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/today", { waitUntil: "networkidle" });
  await setMode(page, "board");

  const scroller = page.locator('section[data-status="inbox"]').locator("..");
  const overflow = await scroller.evaluate((el) => el.scrollWidth - el.clientWidth);
  expect(overflow).toBeGreaterThan(200);

  const title = await boardTitle(page).boundingBox();
  const toggle = await page.getByRole("radiogroup", { name: "View" }).boundingBox();
  expect(toggle!.y).toBeGreaterThan(title!.y + title!.height);

  await expect(page.getByRole("navigation")).toBeVisible();
});
