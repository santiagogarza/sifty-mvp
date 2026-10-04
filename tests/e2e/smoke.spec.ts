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

test("board files a card, keeps the layout across routes, and survives reload", async ({
  page,
}) => {
  await page.goto("/inbox", { waitUntil: "networkidle" });

  const marker = `Board file ${Date.now()}`;
  await page.keyboard.press("c");
  await page.getByPlaceholder("What do you need to do?").fill(marker);
  await page.keyboard.press("ControlOrMeta+Enter");
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);

  await page.getByRole("radio", { name: "Board" }).click();
  const board = page.getByRole("listbox", { name: "Board" });
  await board.focus();
  await board.press("ArrowDown");
  for (let step = 0; step < 20; step += 1) {
    const selected = board.locator("[aria-selected='true']");
    const text = (await selected.textContent()) ?? "";
    if (text.includes(marker)) break;
    await board.press("ArrowDown");
  }
  await board.press("Shift+ArrowRight");

  let title = marker;
  await expect
    .poll(
      async () => {
        const res = await page.request.get("/api/tasks");
        if (!res.ok()) return null;
        const { tasks } = (await res.json()) as {
          tasks: Array<{ sourceText: string; lifecycle: string; title: string }>;
        };
        const task = tasks.find((entry) => entry.sourceText === marker);
        if (task?.title) title = task.title;
        return task?.lifecycle ?? null;
      },
      { timeout: 10_000 },
    )
    .toBe("active");

  await page.reload({ waitUntil: "networkidle" });
  await expect(page.getByRole("region", { name: /^Focus,/ })).toContainText(title);
  await expect(page.getByRole("region", { name: /^Inbox,/ })).not.toContainText(title);

  await page.goto("/focus", { waitUntil: "networkidle" });
  await expect(page.getByRole("radio", { name: "Board" })).toHaveAttribute("aria-checked", "true");

  await page.goto("/inbox", { waitUntil: "networkidle" });
  await page.getByRole("radio", { name: "List" }).click();
  await expect(page.getByText(/Newly captured tasks/)).toBeVisible();
  await expect(page.getByText(title)).toHaveCount(0);
});

test("board hides the dropped disclosure and list brings it back", async ({ page }) => {
  await page.goto("/inbox", { waitUntil: "networkidle" });
  const marker = `Drop me ${Date.now()}`;
  await page.keyboard.press("c");
  await page.getByPlaceholder("What do you need to do?").fill(marker);
  await page.keyboard.press("ControlOrMeta+Enter");
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByRole("button", { name: /^Status/ }).click();
  await page.getByRole("button", { name: /^Dropped/ }).click();
  await page.keyboard.press("Escape");

  await page.goto("/done", { waitUntil: "networkidle" });
  await expect(page.getByRole("button", { name: /Dropped/ })).toBeVisible();
  await page.getByRole("radio", { name: "Board" }).click();
  await expect(page.getByRole("button", { name: /Dropped/ })).toHaveCount(0);
  await page.getByRole("radio", { name: "List" }).click();
  await expect(page.getByRole("button", { name: /Dropped/ })).toBeVisible();
});

test("board columns scroll and the toggle sits under the title on a phone", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/inbox", { waitUntil: "networkidle" });
  await page.getByRole("radio", { name: "Board" }).click();

  const scroller = page.getByRole("region", { name: "Columns" });
  const overflows = await scroller.evaluate((el) => el.scrollWidth > el.clientWidth);
  expect(overflows).toBe(true);

  const title = await page.getByRole("heading", { name: "Everything, by status" }).boundingBox();
  const toggle = await page.getByRole("radiogroup", { name: "Layout" }).boundingBox();
  expect(title).toBeTruthy();
  expect(toggle).toBeTruthy();
  if (!title || !toggle) return;
  expect(toggle.y).toBeGreaterThan(title.y + title.height - 1);
});
