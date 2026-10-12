import { expect, test } from "@playwright/test";

/**
 * First-run onboarding for a brand-new account.
 *
 * Runs as its own Playwright project *before* the smoke suite (see
 * `playwright.config.ts`), so with a freshly started server the auth-bypass
 * user is still pristine: no demo seed, just the three starter examples.
 * Against a server that already has tasks (a reused local dev server) the
 * test skips rather than asserting on a workspace it did not create.
 */

test.describe.configure({ mode: "serial" });

test("a new account sees three sifted examples, learns the free cap, and can remove them", async ({
  page,
}) => {
  await page.goto("/inbox", { waitUntil: "networkidle" });
  const res = await page.request.get("/api/tasks");
  const { tasks } = (await res.json()) as { tasks: Array<{ title: string }> };
  const titles = tasks.map((t) => t.title).sort();
  test.skip(
    titles.join("|") !== "Dentist|Plan the Q4 reading list|Reply to Dana about the venue deposit",
    "workspace is not a pristine first run (reused dev server)",
  );
  page.on("dialog", (d) => d.accept());

  const welcome = page.getByTestId("welcome-card");
  await expect(welcome).toBeVisible();
  await expect(welcome).toContainText("Sifty sifts it into a clear title");
  await expect(welcome).toContainText("Free accounts get 5 sifts a day");

  const list = page.getByRole("listbox", { name: "Tasks" });
  await expect(list.getByText("Plan the Q4 reading list")).toBeVisible();
  await expect(list.getByText("Dentist")).toBeVisible();
  // The ambiguous example is flagged as low confidence in the list.
  await expect(list.getByTestId("confidence-pill")).toHaveAttribute("data-band", "low");

  // The dated example lands in Today.
  await page.goto("/today", { waitUntil: "networkidle" });
  await expect(page.getByText("Reply to Dana about the venue deposit")).toBeVisible();

  // Open the ambiguous one: it shows the clarifying question, and Delete works.
  await page.goto("/inbox", { waitUntil: "networkidle" });
  await list.getByText("Dentist").click();
  const sheet = page.getByRole("dialog");
  await expect(sheet.getByText("Sifty asks")).toBeVisible();
  await expect(sheet.getByText(/Book an appointment/)).toBeVisible();
  await sheet.getByRole("button", { name: "Delete task" }).click();
  await expect(list.getByText("Dentist")).toHaveCount(0);

  // Deletion is durable and the welcome stays while only examples remain.
  await page.reload({ waitUntil: "networkidle" });
  await expect(page.getByTestId("welcome-card")).toBeVisible();
  await expect(list.getByText("Dentist")).toHaveCount(0);
  await expect(list.getByText("Plan the Q4 reading list")).toBeVisible();

  // Remove the rest in one go; the workspace is empty and stays empty.
  await page.getByRole("button", { name: "Remove the examples" }).click();
  await expect(page.getByText("Inbox zero.")).toBeVisible();
  await expect(page.getByTestId("welcome-card")).toHaveCount(0);
  await expect
    .poll(
      async () => {
        const r = await page.request.get("/api/tasks");
        return ((await r.json()) as { tasks: unknown[] }).tasks.length;
      },
      { timeout: 10_000 },
    )
    .toBe(0);
  await page.reload({ waitUntil: "networkidle" });
  await expect(page.getByText("Inbox zero.")).toBeVisible();
  await expect(page.getByTestId("welcome-card")).toHaveCount(0);

  // The user's own first capture lands normally, with no welcome in the way.
  await page.keyboard.press("c");
  await page.getByPlaceholder("What do you need to do?").fill("Call the plumber about the leak");
  await page.keyboard.press("ControlOrMeta+Enter");
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByText("Call the plumber about the leak").first()).toBeVisible();
  await expect(page.getByTestId("welcome-card")).toHaveCount(0);
});
