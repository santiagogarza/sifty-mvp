import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

/**
 * Board view suite.
 *
 * Same environment contract as the smoke suite: `SIFTY_DISABLE_AUTH=1`
 * makes the app reachable without sign-in and `SIFTY_AI_OFFLINE=1` keeps
 * triage keyless. Each test captures its own marker task so runs never
 * depend on seeded state.
 */

async function capture(page: Page, text: string): Promise<void> {
  await page.keyboard.press("c");
  const input = page.getByPlaceholder("What do you need to do?");
  await input.fill(text);
  await page.keyboard.press("ControlOrMeta+Enter");
  await expect(input).toBeHidden();
}

function column(page: Page, lifecycle: string) {
  return page.locator(`[data-column="${lifecycle}"]`);
}

test("layout switch round-trips between the list and the board", async ({ page }) => {
  await page.goto("/waiting", { waitUntil: "networkidle" });

  await page.getByRole("button", { name: "Board view" }).click();
  await expect(page).toHaveURL(/\/board/);
  for (const name of ["Inbox", "Active", "Waiting", "Someday", "Done"]) {
    await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
  }

  // The list side of the toggle returns to the list you came from.
  await page.getByRole("button", { name: "List view" }).click();
  await expect(page).toHaveURL(/\/waiting/);

  // `v` flips the layout from the keyboard.
  await page.keyboard.press("v");
  await expect(page).toHaveURL(/\/board/);
  await page.keyboard.press("v");
  await expect(page).toHaveURL(/\/waiting/);
});

test("dragging a card between columns changes its status durably", async ({ page }) => {
  await page.goto("/today", { waitUntil: "networkidle" });
  const marker = `Board drag ${Date.now()}`;
  await capture(page, marker);

  await page.keyboard.press("v");
  await expect(page).toHaveURL(/\/board/);

  const card = column(page, "inbox").locator("[data-task-id]", { hasText: marker });
  await expect(card).toBeVisible();

  const cardBox = await card.boundingBox();
  const targetBox = await column(page, "active").boundingBox();
  if (!cardBox || !targetBox) throw new Error("Missing bounding boxes for drag");

  // dnd-kit's mouse sensor activates after 4px of travel, so move in steps.
  await page.mouse.move(cardBox.x + cardBox.width / 2, cardBox.y + cardBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(cardBox.x + cardBox.width / 2 + 12, cardBox.y + cardBox.height / 2, {
    steps: 4,
  });
  await page.mouse.move(targetBox.x + targetBox.width / 2, targetBox.y + targetBox.height / 2, {
    steps: 12,
  });
  await page.mouse.up();

  await expect(column(page, "active").getByText(marker)).toBeVisible();

  // The optimistic move syncs to the server in the background.
  await expect
    .poll(
      async () => {
        const res = await page.request.get("/api/tasks");
        if (!res.ok()) return null;
        const { tasks } = (await res.json()) as {
          tasks: Array<{ sourceText: string; lifecycle: string }>;
        };
        return tasks.find((t) => t.sourceText === marker)?.lifecycle ?? null;
      },
      { timeout: 10_000 },
    )
    .toBe("active");

  // And survives a fresh load.
  await page.reload({ waitUntil: "networkidle" });
  await expect(column(page, "active").getByText(marker)).toBeVisible();
});

test("bracket keys move the focused card between columns", async ({ page }) => {
  await page.goto("/inbox", { waitUntil: "networkidle" });
  const marker = `Board keys ${Date.now()}`;
  await capture(page, marker);

  await page.keyboard.press("v");
  await expect(page).toHaveURL(/\/board/);

  const card = column(page, "inbox").locator("[data-task-id]", { hasText: marker });
  await card.focus();
  await page.keyboard.press("]");
  await expect(column(page, "active").getByText(marker)).toBeVisible();

  // Focus follows the card, so the move chains without re-selecting.
  await page.keyboard.press("]");
  await expect(column(page, "waiting").getByText(marker)).toBeVisible();
  await page.keyboard.press("[");
  await expect(column(page, "active").getByText(marker)).toBeVisible();
});
