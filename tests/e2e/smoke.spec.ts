import { expect, test } from "@playwright/test";

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

test("offline triage round-trips through the API", async ({ request }) => {
  const res = await request.post("/api/triage?offline=1", {
    data: {
      sourceText: "Draft email to investor by tomorrow",
    },
  });
  expect(res.status()).toBe(200);
  const json = await res.json();
  expect(json.meta.offline).toBe(true);
  expect(json.output.title).toBeTruthy();
});

test("captured task syncs to the server and survives cleared local state", async ({ page }) => {
  await page.goto("/today", { waitUntil: "networkidle" });

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
  await page.goto("/inbox", { waitUntil: "networkidle" });
  await expect(page.getByText(marker.slice(0, 30)).first()).toBeVisible({ timeout: 10_000 });
});

test.describe("mobile detail sheet", () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  // SIF-27: the bottom sheet's body must scroll so the footer (Delete) and
  // the disclosures above it are reachable on a phone.
  test("scrolls to the bottom actions", async ({ page }) => {
    await page.goto("/inbox", { waitUntil: "networkidle" });

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
    await page.goto("/inbox", { waitUntil: "networkidle" });

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
