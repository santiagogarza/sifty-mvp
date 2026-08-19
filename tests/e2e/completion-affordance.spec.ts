import { expect, test } from "@playwright/test";

/**
 * Regression: the list-row "complete" circle must be visibly distinct from the
 * page — not rendered in the near-invisible default `--border` color. A global
 * unlayered `* { border-color: var(--border) }` reset was silently defeating the
 * circle's intended border utility, leaving users unable to see (and therefore
 * click) the affordance. This asserts the circle's border differs from the bare
 * `--border` default a plain bordered element receives.
 */
test("incomplete completion circle is visibly bordered", async ({ page }) => {
  await page.goto("/focus", { waitUntil: "networkidle" });
  await page.waitForTimeout(1000);

  const btn = page.locator('button[aria-label="Mark as done"]').first();
  await expect(btn).toBeVisible();

  const result = await page.evaluate(() => {
    const b = document.querySelector('button[aria-label="Mark as done"]') as HTMLElement;
    const circleBorder = getComputedStyle(b).borderTopColor;

    // Reference: a bare element that only receives the global `--border`
    // default (no explicit border-color utility of its own).
    const probe = document.createElement("div");
    probe.style.borderStyle = "solid";
    probe.style.borderWidth = "1px";
    document.body.appendChild(probe);
    const defaultBorder = getComputedStyle(probe).borderTopColor;
    probe.remove();

    return { circleBorder, defaultBorder };
  });

  // If the circle border equals the bare `--border` default, it is effectively
  // invisible against the row — the bug this test guards against.
  expect(result.circleBorder).not.toBe(result.defaultBorder);
});
