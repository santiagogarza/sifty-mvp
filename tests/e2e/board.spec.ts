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
  const viewport = page.viewportSize();
  if (!viewport) throw new Error("no viewport");

  // Columns grow taller than the window once a workspace has real volume, so
  // neither end of the drag can be assumed to be on screen.
  await card.scrollIntoViewIfNeeded();
  const from = await card.boundingBox();
  if (!from) throw new Error("card is not laid out");

  /** The on-screen part of an element, or null when none of it is visible. */
  const visiblePart = (box: { x: number; y: number; width: number; height: number }) => {
    const left = Math.max(box.x, 8);
    const right = Math.min(box.x + box.width, viewport.width - 8);
    const top = Math.max(box.y, 8);
    const bottom = Math.min(box.y + box.height, viewport.height - 8);
    if (right <= left || bottom <= top) return null;
    return { x: (left + right) / 2, y: (top + bottom) / 2 };
  };

  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  // First nudge clears the 5px activation distance without looking like a jump.
  await page.mouse.move(from.x + from.width / 2 + 12, from.y + from.height / 2, { steps: 4 });

  let previousX: number | null = null;
  let landed = false;
  for (let attempt = 0; attempt < 20; attempt++) {
    const to = await target.boundingBox();
    if (!to) throw new Error("target column is not laid out");
    const point = visiblePart(to);

    if (!point) {
      // The column is still off screen. Hold the pointer against the edge it
      // lies beyond and let the board auto-scroll, exactly as a user would.
      const edgeX = to.x > 0 ? viewport.width - 12 : 12;
      await page.mouse.move(edgeX, viewport.height / 2, { steps: 4 });
      await page.waitForTimeout(150);
      continue;
    }

    await page.mouse.move(point.x, point.y, { steps: 8 });
    await page.waitForTimeout(120);

    const settled = await target.boundingBox();
    if (settled && previousX !== null && Math.abs(settled.x - previousX) < 1) {
      landed = true;
      break;
    }
    previousX = settled?.x ?? null;
  }
  if (!landed) throw new Error("target column never settled under the pointer");

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

test("a drag delivered as a single pointer move still lands", async ({ page, request }) => {
  const title = await seedTask(request, "inbox", "Flick me over");
  await showBoard(page, "/inbox");

  const card = column(page, "Inbox").getByRole("option", { name: title });
  await expect(card).toBeVisible();
  const from = await card.boundingBox();
  const to = await column(page, "Focus").boundingBox();
  if (!from || !to) throw new Error("board is not laid out");

  // One move that both starts the drag and arrives, which is what a coalesced
  // pointer stream looks like. dnd-kit reports a zero delta here, so the board
  // has to fall back to the pointer's real position or the move is swallowed.
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(to.x + to.width / 2, to.y + 50);
  await page.mouse.up();

  await expect(column(page, "Focus").getByRole("option", { name: title })).toBeVisible();
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
  // Seeded into Inbox, whose newest-first ordering puts it at the top of the
  // column: a card buried under a hundred others is a scrolling test, not a
  // completion test.
  const title = await seedTask(request, "inbox", "Finish me");
  await showBoard(page, "/inbox");

  const card = column(page, "Inbox").getByRole("option", { name: title });
  await expect(card).toBeVisible();

  await dragCard(page, card, column(page, "Done"));

  const inDone = column(page, "Done").getByRole("option", { name: title });
  await expect(inDone).toBeVisible();
  // A done card reads as done: the checkbox flips to "not done".
  await expect(inDone.getByRole("button", { name: "Mark as not done" })).toBeVisible();
  await expect.poll(() => completedAtFor(page, title), { timeout: 10_000 }).not.toBeNull();

  // Done sorts newest-completed first, so the card is at the top to grab again.
  await dragCard(page, inDone, column(page, "Waiting on"));

  const reopened = column(page, "Waiting on").getByRole("option", { name: title });
  await expect(reopened).toBeVisible();
  await expect(reopened.getByRole("button", { name: "Mark as done" })).toBeVisible();
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

test("a card is one Tab away, and Alt+arrow files it", async ({ page, request }) => {
  const title = await seedTask(request, "inbox", "Walk me over");
  await showBoard(page, "/inbox");

  const card = column(page, "Inbox").getByRole("option", { name: title });
  await expect(card).toBeVisible();

  // Roving tabindex: the whole board is a single stop, not one per card.
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.press("Tab");
  await expect(card).toBeFocused();

  await page.keyboard.press("Alt+ArrowRight");
  await expect(column(page, "Focus").getByRole("option", { name: title })).toBeVisible();

  // Focus rides along, so the card can be walked further without re-finding it.
  await expect(column(page, "Focus").getByRole("option", { name: title })).toBeFocused();

  await page.keyboard.press("Alt+ArrowRight");
  await expect(column(page, "Waiting on").getByRole("option", { name: title })).toBeVisible();

  await page.keyboard.press("Alt+ArrowLeft");
  await expect(column(page, "Focus").getByRole("option", { name: title })).toBeVisible();
});

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

test.describe("on a phone", () => {
  // Spelled out rather than spread from `devices`, whose descriptors also pin
  // a browser engine and cannot be applied to a single describe block.
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test("a swipe scrolls the columns and a long press drags a card", async ({
    page,
    context,
    request,
  }) => {
    const title = await seedTask(request, "inbox", "Touch me");
    await showBoard(page, "/inbox");

    const cdp = await context.newCDPSession(page);
    const touch = (type: "touchStart" | "touchMove" | "touchEnd", x: number, y: number) =>
      cdp.send("Input.dispatchTouchEvent", {
        type,
        touchPoints: type === "touchEnd" ? [] : [{ x, y, id: 1 }],
      });

    const scroller = page.locator("div.overflow-x-auto").first();
    await expect.poll(() => scroller.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);

    const card = column(page, "Inbox").getByRole("option", { name: title });
    const box = await card.boundingBox();
    if (!box) throw new Error("card is not laid out");
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;

    // A swipe is a scroll, not a drag: the columns move, the card does not.
    await touch("touchStart", x, y);
    for (let i = 1; i <= 8; i++) await touch("touchMove", x - i * 25, y);
    await touch("touchEnd", x - 200, y);

    await expect.poll(() => scroller.evaluate((el) => el.scrollLeft)).toBeGreaterThan(0);
    await expect.poll(() => lifecycleOf(page, title)).toBe("inbox");

    await scroller.evaluate((el) => {
      el.scrollLeft = 0;
    });
    const grab = await card.boundingBox();
    if (!grab) throw new Error("card is not laid out");
    const gx = grab.x + grab.width / 2;
    const gy = grab.y + grab.height / 2;

    // A long press picks the card up. Where it lands depends on how far the
    // board auto-scrolls under the finger, so this asserts only that a touch
    // drag files the card somewhere other than where it started.
    await touch("touchStart", gx, gy);
    await page.waitForTimeout(400); // clear the long-press threshold
    for (let i = 1; i <= 12; i++) {
      await touch("touchMove", gx + i * 20, gy);
      await page.waitForTimeout(40);
    }
    await touch("touchEnd", gx + 240, gy);

    await expect.poll(() => lifecycleOf(page, title), { timeout: 10_000 }).not.toBe("inbox");
  });
});

async function lifecycleOf(page: Page, title: string): Promise<string | undefined> {
  const res = await page.request.get("/api/tasks");
  if (!res.ok()) return undefined;
  const { tasks } = (await res.json()) as { tasks: { title: string; lifecycle: string }[] };
  return tasks.find((t) => t.title === title)?.lifecycle;
}

test("column headers use the presented status names", async ({ page }) => {
  await showBoard(page, "/inbox");

  const names = await page
    .getByRole("listbox")
    .evaluateAll((els) => els.map((el) => el.getAttribute("aria-label")));
  expect(names).toEqual(["Inbox", "Focus", "Waiting on", "Someday", "Done"]);
});
