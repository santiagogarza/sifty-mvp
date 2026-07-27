import { type Page, expect, test } from "@playwright/test";

/**
 * Board view smoke.
 *
 * Runs against the live dev server with `SIFTY_DISABLE_AUTH=1` (same setup as
 * smoke.spec). Proves the PRD's load-bearing claims: five columns, the
 * List/Board toggle remembered across a reload, moves by keyboard and by
 * drag, Undo, and — the thing that can't be shown any other way — that a
 * move survives a refresh with the board still selected.
 *
 * These tests share one bypass user with the rest of the suite, so they run
 * serially and assert on the Focus/Waiting columns (which no other spec
 * writes to) rather than on Inbox counts that concurrent captures perturb.
 */

test.describe.configure({ mode: "serial" });

const inbox = (page: Page) => page.getByRole("listbox", { name: "Inbox" });
const focus = (page: Page) => page.getByRole("listbox", { name: "Focus" });
const waiting = (page: Page) => page.getByRole("listbox", { name: "Waiting on" });

/**
 * Capture a task (guaranteeing an Inbox card) then land on the board. Capture
 * opens the new task's detail sheet, so we re-enter via the board URL — a
 * fresh nav that drops the `?task` param (and the sheet) and selects board
 * mode through `?view`.
 */
async function openBoardWithInboxCard(page: Page) {
  await page.goto("/focus", { waitUntil: "networkidle" });
  await page.keyboard.press("c");
  await page.getByPlaceholder("What do you need to do?").fill(`Board e2e ${Date.now()}`);
  await page.keyboard.press("ControlOrMeta+Enter");
  await page.goto("/focus?view=board", { waitUntil: "networkidle" });
  await expect(page.getByRole("listbox")).toHaveCount(5);
  await expect(inbox(page).getByRole("option").first()).toBeVisible();
}

test("board: the List/Board toggle switches views and is remembered across a reload", async ({
  page,
}) => {
  await page.goto("/focus", { waitUntil: "networkidle" });
  await expect(page.getByRole("button", { name: "Board" })).toHaveAttribute(
    "aria-pressed",
    "false",
  );

  await page.getByRole("button", { name: "Board" }).click();
  await expect(page.getByRole("listbox")).toHaveCount(5);
  await expect(page.getByRole("button", { name: "Board" })).toHaveAttribute("aria-pressed", "true");

  await page.reload({ waitUntil: "networkidle" });
  await expect(page.getByRole("listbox")).toHaveCount(5);
  await expect(page.getByRole("button", { name: "Board" })).toHaveAttribute("aria-pressed", "true");
});

test("board: a keyboard move files a card into Focus and survives a refresh", async ({ page }) => {
  await openBoardWithInboxCard(page);
  const focusBefore = await focus(page).getByRole("option").count();

  // Drive the board's own keyboard model: focus the board, select the first
  // Inbox card, then file it one column right into Focus.
  await page.locator('[aria-label="Board"]').first().focus();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Shift+ArrowRight");
  await expect(focus(page).getByRole("option")).toHaveCount(focusBefore + 1);

  await page.reload({ waitUntil: "networkidle" });
  await expect(page.getByRole("listbox")).toHaveCount(5);
  await expect(page.getByRole("button", { name: "Board" })).toHaveAttribute("aria-pressed", "true");
  await expect(focus(page).getByRole("option")).toHaveCount(focusBefore + 1);
});

test("board: pointer drag moves a card into another column, with an Undo pill", async ({
  page,
}) => {
  await openBoardWithInboxCard(page);
  const waitingBefore = await waiting(page).getByRole("option").count();

  const card = inbox(page).getByRole("option").first();
  const from = await card.boundingBox();
  const to = await waiting(page).boundingBox();
  if (!from || !to) throw new Error("missing bounding boxes");

  // dnd-kit's PointerSensor needs the activation distance crossed before the
  // drop, so move in steps rather than a single jump.
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(from.x + from.width / 2 + 24, from.y + from.height / 2, { steps: 5 });
  await page.mouse.move(to.x + to.width / 2, to.y + 80, { steps: 10 });
  await page.mouse.up();

  await expect(waiting(page).getByRole("option")).toHaveCount(waitingBefore + 1);
  await expect(page.getByText(/Moved to Waiting on/)).toBeVisible();
});

test("board: Undo returns a filed card to its previous column", async ({ page }) => {
  await openBoardWithInboxCard(page);
  const focusBefore = await focus(page).getByRole("option").count();

  await page.locator('[aria-label="Board"]').first().focus();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Shift+ArrowRight");
  await expect(focus(page).getByRole("option")).toHaveCount(focusBefore + 1);

  await page.getByRole("button", { name: "Undo" }).click();
  await expect(focus(page).getByRole("option")).toHaveCount(focusBefore);
});
