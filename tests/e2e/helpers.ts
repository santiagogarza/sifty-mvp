import type { Page } from "@playwright/test";

/**
 * Open an app page and wait until the shell is interactive. `networkidle`
 * alone can resolve before React has hydrated (a cold dev server with
 * several workers in parallel), and a key pressed before hydration is
 * simply lost. `AppFrame` sets `data-app-ready` once its effects ran.
 */
export async function gotoApp(page: Page, path: string): Promise<void> {
  await page.goto(path, { waitUntil: "networkidle" });
  await page.locator("html[data-app-ready='1']").waitFor({ state: "attached" });
}
