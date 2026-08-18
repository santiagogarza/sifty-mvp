import type { Lifecycle } from "@/lib/domain/types";
import { type APIRequestContext, type Locator, type Page, expect, test } from "@playwright/test";

/**
 * Board suite.
 *
 * Covers the two things jsdom cannot: an actual pointer drag between columns,
 * and whether the move is still there after a reload — the round trip through
 * localStorage and the sync layer, not just the store.
 *
 * Every test seeds the task it acts on. Borrowing whatever the demo workspace
 * happens to contain makes the suite pass once and then fail on a server it has
 * already re-filed things in.
 */

// Wide enough for the whole pipeline to be on screen at once. A mouse drag
// cannot reach a column parked outside the viewport, and dragging against the
// edge to trigger auto-scroll would be timing-dependent; horizontal scrolling
// and touch drags are checked by hand instead.
test.use({ viewport: { width: 2100, height: 1000 } });

const column = (page: Page, name: string): Locator => page.getByRole("listbox", { name });

/** A task of our own, so no test depends on another test's leftovers. */
async function seedTask(
  request: APIRequestContext,
  lifecycle: Lifecycle,
  label: string,
): Promise<string> {
  const title = `${label} ${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const res = await request.post("/api/tasks", {
    data: { sourceText: title, title, lifecycle, aiStatus: "ready" },
  });
  expect(res.status()).toBe(201);
  return title;
}

async function showBoard(page: Page, route: string): Promise<void> {
  await page.goto(route, { waitUntil: "networkidle" });
  await page.getByRole("radio", { name: "Board" }).click();
  await expect(column(page, "Inbox")).toBeVisible();
}

/**
 * Drag a card onto a column.
 *
 * Two things make this more than a single mouse move. dnd-kit only starts a
 * drag once the pointer has travelled, and holding the pointer near the edge
 * of the board auto-scrolls it, which slides the target column out from under
 * whatever coordinates were computed beforehand. So the pointer is re-aimed
 * until the column stops moving, and only then released.
 */
async function dragCard(page: Page, card: Locator, target: Locator): Promise<void> {
  const from = await card.boundingBox();
  const viewport = page.viewportSize();
  if (!from || !viewport) throw new Error("card is not laid out");

  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  // First nudge clears the 5px activation distance without looking like a jump.
  await page.mouse.move(from.x + from.width / 2 + 12, from.y + from.height / 2, { steps: 4 });

  let previousX: number | null = null;
  for (let attempt = 0; attempt < 10; attempt++) {
    const to = await target.boundingBox();
    if (!to) throw new Error("target column is not laid out");

    // Stay inside the column and inside the window: the pointer cannot leave
    // the viewport, and aiming past the column's own edge would miss it.
    const tx = Math.min(to.x + to.width / 2, to.x + to.width - 8, viewport.width - 8);
    const ty = to.y + Math.min(60, to.height / 2);
    if (tx <= to.x) throw new Error("target column is not reachable on screen");

    await page.mouse.move(tx, ty, { steps: 8 });
    await page.waitForTimeout(100);

    const settled = await target.boundingBox();
    if (settled && previousX !== null && Math.abs(settled.x - previousX) < 1) break;
    previousX = settled?.x ?? null;
  }

  await page.mouse.up();
}

test("dragging a card to another column re-files it and the move survives a reload", async ({
  page,
  request,
}) => {
  const title = await seedTask(request, "inbox", "Drag me across");
  await showBoard(page, "/inbox");

  const card = column(page, "Inbox").getByRole("option", { name: title });
  await expect(card).toBeVisible();

  await dragCard(page, card, column(page, "Waiting on"));

  await expect(column(page, "Waiting on").getByRole("option", { name: title })).toBeVisible();
  await expect(column(page, "Inbox").getByRole("option", { name: title })).toHaveCount(0);

  await page.reload({ waitUntil: "networkidle" });

  await expect(column(page, "Waiting on").getByRole("option", { name: title })).toBeVisible();
  await expect(column(page, "Inbox").getByRole("option", { name: title })).toHaveCount(0);
});

test("the move survives a client that has lost its local state", async ({ page, request }) => {
  const title = await seedTask(request, "inbox", "Sync me through");
  await showBoard(page, "/inbox");

  await dragCard(
    page,
    column(page, "Inbox").getByRole("option", { name: title }),
    column(page, "Someday"),
  );
  await expect(column(page, "Someday").getByRole("option", { name: title })).toBeVisible();

  // The push is a background write; wait for the server to agree before
  // throwing away the only other copy.
  await expect
    .poll(
      async () => {
        const res = await page.request.get("/api/tasks");
        if (!res.ok()) return null;
        const { tasks } = (await res.json()) as { tasks: { title: string; lifecycle: string }[] };
        return tasks.find((t) => t.title === title)?.lifecycle ?? null;
      },
      { timeout: 10_000 },
    )
    .toBe("someday");

  // Clearing local state also clears the view preference, so the board has to
  // be chosen again before the card can be looked for in a column.
  await page.evaluate(() => window.localStorage.clear());
  await showBoard(page, "/someday");
  await expect(column(page, "Someday").getByRole("option", { name: title })).toBeVisible();
});

test("dragging into Done completes the task, and dragging back out reopens it", async ({
  page,
  request,
}) => {
  const title = await seedTask(request, "active", "Finish me");
  await showBoard(page, "/focus");

  const card = column(page, "Focus").getByRole("option", { name: title });
  await expect(card).toBeVisible();

  await dragCard(page, card, column(page, "Done"));

  const inDone = column(page, "Done").getByRole("option", { name: title });
  await expect(inDone).toBeVisible();
  // A done card reads as done: the checkbox flips to "not done".
  await expect(inDone.getByRole("button", { name: "Mark as not done" })).toBeVisible();
  await expect.poll(() => completedAtFor(page, title), { timeout: 10_000 }).not.toBeNull();

  await dragCard(page, inDone, column(page, "Focus"));

  const backInFocus = column(page, "Focus").getByRole("option", { name: title });
  await expect(backInFocus).toBeVisible();
  await expect(backInFocus.getByRole("button", { name: "Mark as done" })).toBeVisible();
  await expect.poll(() => completedAtFor(page, title), { timeout: 10_000 }).toBeNull();
});

async function completedAtFor(page: Page, title: string): Promise<string | null | undefined> {
  const res = await page.request.get("/api/tasks");
  if (!res.ok()) return undefined;
  const { tasks } = (await res.json()) as {
    tasks: { title: string; completedAt: string | null }[];
  };
  return tasks.find((t) => t.title === title)?.completedAt;
}

test("dropped stays behind a disclosure", async ({ page, request }) => {
  const title = await seedTask(request, "dropped", "Let this go");
  await showBoard(page, "/done");

  await expect(column(page, "Dropped")).toHaveCount(0);

  await page.getByRole("button", { name: /show dropped/i }).click();
  await expect(column(page, "Dropped").getByRole("option", { name: title })).toBeVisible();

  await page.getByRole("button", { name: /hide dropped/i }).click();
  await expect(column(page, "Dropped")).toHaveCount(0);
});

test("the List/Board choice is remembered across reloads and routes", async ({ page }) => {
  await showBoard(page, "/inbox");

  await page.reload({ waitUntil: "networkidle" });
  await expect(page.getByRole("radio", { name: "Board" })).toHaveAttribute("aria-checked", "true");
  await expect(column(page, "Inbox")).toBeVisible();

  // The preference is global, so a different route opens as a board too.
  await page.goto("/someday", { waitUntil: "networkidle" });
  await expect(column(page, "Someday")).toBeVisible();

  await page.getByRole("radio", { name: "List" }).click();
  await page.goto("/inbox", { waitUntil: "networkidle" });
  await expect(page.getByRole("listbox", { name: "Tasks" })).toBeVisible();
});

test("Today's board keeps the lens instead of showing the whole pipeline", async ({ page }) => {
  await showBoard(page, "/inbox");
  await page.goto("/today", { waitUntil: "networkidle" });

  await expect(column(page, "Inbox")).toBeVisible();
  await expect(column(page, "Focus")).toBeVisible();
  await expect(column(page, "Waiting on")).toBeVisible();

  // Today never shows finished or deferred work, so those columns don't exist.
  await expect(column(page, "Someday")).toHaveCount(0);
  await expect(column(page, "Done")).toHaveCount(0);
});

test("a card still opens the detail sheet on click", async ({ page, request }) => {
  const title = await seedTask(request, "inbox", "Open me");
  await showBoard(page, "/inbox");

  await column(page, "Inbox").getByRole("option", { name: title }).click();

  await expect(page).toHaveURL(/[?&]task=/);
  await expect(page.getByRole("dialog").getByText(title).first()).toBeVisible();
});

test("column headers use the presented status names", async ({ page }) => {
  await showBoard(page, "/inbox");

  const names = await page
    .getByRole("listbox")
    .evaluateAll((els) => els.map((el) => el.getAttribute("aria-label")));
  expect(names).toEqual(["Inbox", "Focus", "Waiting on", "Someday", "Done"]);
});
