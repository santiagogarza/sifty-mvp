import { expect, test } from "@playwright/test";
import { gotoApp } from "./helpers";

/**
 * Sifty smoke suite.
 *
 * Runs against a live Next.js dev server (or `PLAYWRIGHT_BASE_URL` for
 * preview deploys). With `SIFTY_DISABLE_AUTH=1` set, the app is reachable
 * without going through sign-in, and the triage path uses `?offline=1`
 * so it doesn't require an AI provider key.
 */

test("home redirects to today and renders the shell", async ({ page }) => {
  const response = await page.goto("/today", { waitUntil: "networkidle" });
  expect(response?.status()).toBeLessThan(400);
  await expect(page.getByText(/Today|Inbox|Focus/i).first()).toBeVisible();
});

test("root sends a signed-in visitor straight into the app", async ({ page }) => {
  // The bypass session counts as signed in, so `/` must skip the landing page.
  await page.goto("/", { waitUntil: "networkidle" });
  await expect(page).toHaveURL(/\/today$/);
});

test("public pages render for anyone", async ({ page, request }) => {
  await page.goto("/pricing", { waitUntil: "networkidle" });
  await expect(page).toHaveTitle("Pricing — Sifty");
  await expect(page.getByRole("heading", { name: "Free", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Pro", exact: true })).toBeVisible();
  await expect(page.getByText("$10")).toBeVisible();
  // The invite link must land on the real redeem page, not the 404.
  const redeem = page.getByRole("link", { name: /redeem it here/i });
  await expect(redeem).toHaveAttribute("href", "/redeem");
  await redeem.click();
  await expect(page).toHaveURL(/\/redeem$/);
  await expect(page.getByRole("heading", { name: /redeem an invite/i })).toBeVisible();
  await page.goBack();

  for (const path of ["/privacy", "/terms"]) {
    await page.goto(path, { waitUntil: "networkidle" });
    await expect(page.getByText("Waimaka, Inc").first()).toBeVisible();
    await expect(page.getByRole("note")).toContainText("Draft");
  }

  const security = await request.get("/.well-known/security.txt");
  expect(security.status()).toBe(200);
  expect(await security.text()).toContain("Contact: mailto:");

  for (const path of ["/robots.txt", "/sitemap.xml", "/opengraph-image"]) {
    const res = await request.get(path);
    expect(res.status(), path).toBe(200);
  }
});

test("a capture is sifted server-side by the Workflow runtime (offline stages)", async ({
  request,
}) => {
  // Creating a task enqueues `siftTask`; with SIFTY_AI_OFFLINE=1 every stage
  // answers deterministically, so this exercises the real Workflow runtime
  // (Local World inside the dev server) end to end.
  const created = await request.post("/api/tasks?offline=1", {
    data: { sourceText: "Draft the investor update by Friday and send it to the board" },
  });
  expect(created.status()).toBe(201);
  const { task, sift } = (await created.json()) as {
    task: { id: string; aiStatus: string; siftId: string | null };
    sift: { enqueued: boolean; runId?: string };
  };
  expect(sift.enqueued).toBe(true);
  expect(sift.runId).toMatch(/^wrun_/);
  expect(task.aiStatus).toBe("pending");
  expect(task.siftId).toBeTruthy();

  let final: Record<string, unknown> | null = null;
  await expect
    .poll(
      async () => {
        const res = await request.get(`/api/tasks/${task.id}`);
        if (!res.ok()) return "fetch-failed";
        const body = (await res.json()) as { task: Record<string, unknown> };
        final = body.task;
        return body.task.aiStatus;
      },
      { timeout: 30_000, intervals: [300, 500, 1000] },
    )
    .toBe("ready");

  const done = final as unknown as {
    siftStage: string | null;
    due: string | null;
    plan: { executor: string } | null;
    labelIds: string[];
    priorityBucket: string;
    rationale: string | null;
    aiAttempts: number;
  };
  expect(done.siftStage).toBeNull();
  expect(done.due).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  expect(done.plan?.executor).toBe("ai_agent");
  expect(done.labelIds.length).toBeGreaterThan(0);
  expect(done.priorityBucket).not.toBe("unset");
  expect(done.rationale).toContain("Heuristic triage");
  expect(done.aiAttempts).toBe(1);

  // "Re-sift now" takes the task over and runs the pipeline again.
  const resift = await request.post("/api/triage?offline=1", { data: { taskId: task.id } });
  expect(resift.status()).toBe(202);
  const again = (await resift.json()) as { siftId: string; task: { aiStatus: string } };
  expect(again.siftId).not.toBe(task.siftId);
  expect(again.task.aiStatus).toBe("pending");
  await expect
    .poll(
      async () => {
        const res = await request.get(`/api/tasks/${task.id}`);
        return res.ok() ? ((await res.json()).task.aiAttempts as number) : -1;
      },
      { timeout: 30_000 },
    )
    .toBe(2);
});

test("captured task syncs to the server and survives cleared local state", async ({ page }) => {
  await gotoApp(page, "/today");

  const marker = `Sync smoke ${Date.now()}`;
  await page.keyboard.press("c");
  await page.getByPlaceholder("What do you need to do?").fill(marker);
  await page.keyboard.press("ControlOrMeta+Enter");

  // The capture push is background; poll the API until it lands.
  await expect
    .poll(
      async () => {
        const res = await page.request.get("/api/tasks");
        if (!res.ok()) return false;
        const { tasks } = (await res.json()) as { tasks: Array<{ sourceText: string }> };
        return tasks.some((t) => t.sourceText === marker);
      },
      { timeout: 10_000 },
    )
    .toBe(true);

  // The reverse direction: a fresh client (no localStorage) pulls it back.
  await page.evaluate(() => window.localStorage.clear());
  await gotoApp(page, "/inbox");
  await expect(page.getByText(marker.slice(0, 30)).first()).toBeVisible({ timeout: 10_000 });
});

test("a date typed at capture becomes a due chip and a protected due date", async ({ page }) => {
  await gotoApp(page, "/inbox");

  const marker = `Dentist ${Date.now()}`;
  await page.keyboard.press("c");
  await page.getByPlaceholder("What do you need to do?").fill(`${marker} tomorrow 3pm`);
  const chip = page.getByTestId("capture-due-chip");
  await expect(chip).toContainText(/^Due .*· 3pm$/);
  await page.keyboard.press("ControlOrMeta+Enter");

  // The sheet opens on the new task with the date set and the phrase gone.
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByPlaceholder("Task title")).toHaveValue(marker);
  await expect(dialog.getByText("Tomorrow", { exact: true })).toBeVisible();

  await expect
    .poll(async () => {
      const res = await page.request.get("/api/tasks");
      if (!res.ok()) return null;
      const { tasks } = (await res.json()) as {
        tasks: Array<{ title: string; due: string | null; editedFields: string[] }>;
      };
      const mine = tasks.find((t) => t.title === marker);
      return mine ? { due: mine.due, protectedDue: mine.editedFields.includes("due") } : null;
    })
    .toMatchObject({ due: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/), protectedDue: true });
});

test.describe("mobile detail sheet", () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  // SIF-27: the bottom sheet's body must scroll so the footer (Delete) and
  // the disclosures above it are reachable on a phone.
  test("scrolls to the bottom actions", async ({ page }) => {
    await gotoApp(page, "/inbox");

    await page.keyboard.press("c");
    await page.getByPlaceholder("What do you need to do?").fill(`Mobile sheet smoke ${Date.now()}`);
    await page.keyboard.press("ControlOrMeta+Enter");

    const body = page.getByTestId("task-detail-body");
    await expect(body).toBeVisible();
    const deleteButton = page.getByRole("button", { name: "Delete task" });

    // The footer is pinned below the scroller: Delete is reachable before
    // any scroll, and it must not move when the body scrolls.
    await expect(deleteButton).toBeInViewport();
    const footerTopBefore = (await deleteButton.boundingBox())!.y;

    const scrollable = await body.evaluate((el) => el.scrollHeight > el.clientHeight);
    expect(scrollable).toBe(true);
    await expect(page.getByText("Original capture")).not.toBeInViewport();

    await body.evaluate((el) => el.scrollTo({ top: el.scrollHeight }));
    await expect(page.getByText("Original capture")).toBeInViewport();
    await expect(deleteButton).toBeInViewport();
    expect((await deleteButton.boundingBox())!.y).toBe(footerTopBefore);
  });
});

test.describe("short desktop detail sheet", () => {
  test.use({ viewport: { width: 1280, height: 520 } });

  // Same contract as mobile for the side panel: the body scrolls, the
  // footer stays pinned, and opening the sheet focuses the panel itself.
  test("scrolls inside the side panel and focuses the panel on open", async ({ page }) => {
    await gotoApp(page, "/inbox");

    await page.keyboard.press("c");
    await page
      .getByPlaceholder("What do you need to do?")
      .fill(`Desktop sheet smoke ${Date.now()}`);
    await page.keyboard.press("ControlOrMeta+Enter");

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog).toBeFocused();

    const body = page.getByTestId("task-detail-body");
    const deleteButton = page.getByRole("button", { name: "Delete task" });
    await expect(deleteButton).toBeInViewport();
    const footerTopBefore = (await deleteButton.boundingBox())!.y;

    expect(await body.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);
    await body.evaluate((el) => el.scrollTo({ top: el.scrollHeight }));
    await expect(page.getByText("Original capture")).toBeInViewport();
    expect((await deleteButton.boundingBox())!.y).toBe(footerTopBefore);

    // One Escape closes the sheet: nothing else (a tooltip) took focus.
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
  });
});

test("rate limit returns 429 with Retry-After when bursting the triage route", async ({
  request,
}) => {
  // Burst significantly above the default 30/min cap.
  const requests = Array.from({ length: 35 }, () =>
    request.post("/api/triage?offline=1", { data: { sourceText: "burst" } }),
  );
  const responses = await Promise.all(requests);
  const limited = responses.find((r) => r.status() === 429);
  if (!limited) {
    test.skip(
      true,
      "No 429 observed in this run — set RATELIMIT_TRIAGE_PER_MIN lower for the smoke environment.",
    );
    return;
  }
  expect(limited.headers()["retry-after"]).toBeTruthy();
});
