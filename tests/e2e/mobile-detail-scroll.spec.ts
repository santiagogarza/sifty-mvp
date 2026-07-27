import { expect, test } from "@playwright/test";

/**
 * Regression: on a mobile (bottom-sheet) viewport, opening a task detail must
 * keep the overlay scrollable so the bottommost content — including the footer
 * with the Delete action — stays reachable.
 *
 * The bug was a flex child (`flex-1 overflow-y-auto`) without `min-height: 0`:
 * its default `min-height: auto` let it grow to its full content height instead
 * of scrolling, which pushed the footer below the fixed bottom sheet's visible
 * area and made the lower details unreachable on mobile.
 */
test("mobile task detail overlay scrolls to reveal its footer", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/inbox", { waitUntil: "networkidle" });

  const marker = `Scroll regression ${Date.now()}`;
  await page.keyboard.press("c");
  await page.getByPlaceholder("What do you need to do?").fill(marker);
  await page.keyboard.press("ControlOrMeta+Enter");

  const row = page.getByText(marker.slice(0, 30)).first();
  await expect(row).toBeVisible({ timeout: 10_000 });
  await row.click();

  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();

  // The scroll region must actually scroll: its content overflows its own box
  // rather than expanding the box and spilling out of the sheet.
  const scroller = dialog.getByTestId("detail-scroll");
  await expect(scroller).toBeVisible();
  const overflow = await scroller.evaluate((el) => el.scrollHeight - el.clientHeight);
  expect(overflow).toBeGreaterThan(0);

  // The footer's Delete action is the bottommost detail; it must sit within the
  // viewport, not be pushed off the bottom of the screen.
  const del = dialog.getByRole("button", { name: /delete task/i });
  const box = await del.boundingBox();
  const viewport = page.viewportSize();
  expect(box).not.toBeNull();
  expect(viewport).not.toBeNull();
  if (box && viewport) {
    expect(box.y + box.height).toBeLessThanOrEqual(viewport.height + 1);
    expect(box.y).toBeGreaterThanOrEqual(0);
  }
});
