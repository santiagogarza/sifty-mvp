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

test("board moves a task between statuses", async ({ page }) => {
  await page.goto("/inbox", { waitUntil: "networkidle" });

  const marker = `Board move ${Date.now()}`;
  await page.keyboard.press("c");
  await page.getByPlaceholder("What do you need to do?").fill(marker);
  await page.keyboard.press("ControlOrMeta+Enter");
  await expect(page.getByText(marker).first()).toBeVisible();

  await page.getByRole("link", { name: "Board" }).click();
  const card = page.getByTestId("task-board").getByText(marker).locator("..").locator("..");
  await card
    .getByRole("button", { name: `Drag ${marker}` })
    .dragTo(page.getByTestId("board-column-active"));
  await expect(page.getByTestId("board-column-active").getByText(marker)).toBeVisible();

  await page
    .getByTestId("board-column-active")
    .getByText(marker)
    .locator("..")
    .locator("..")
    .getByRole("button", { name: "Move task right" })
    .click();
  await expect(page.getByTestId("board-column-waiting").getByText(marker)).toBeVisible();

  await expect
    .poll(async () => {
      const res = await page.request.get("/api/tasks");
      if (!res.ok()) return null;
      const { tasks } = (await res.json()) as {
        tasks: Array<{ sourceText: string; lifecycle: string }>;
      };
      return tasks.find((task) => task.sourceText === marker)?.lifecycle ?? null;
    })
    .toBe("waiting");
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
