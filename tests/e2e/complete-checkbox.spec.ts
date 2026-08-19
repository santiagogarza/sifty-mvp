import { expect, test } from "@playwright/test";

async function getFirstIncomplete(page: import("@playwright/test").Page) {
  const btn = page.getByRole("button", { name: "Mark as done" }).first();
  await expect(btn).toBeVisible();
  const title = await btn
    .locator("xpath=ancestor::div[@role='option']//span[contains(@class,'truncate')]")
    .textContent();
  return { btn, title: title?.trim() ?? "" };
}

async function lifecycleInStore(page: import("@playwright/test").Page, title: string) {
  return page.evaluate((t) => {
    const raw = localStorage.getItem("sifty-store-v1");
    if (!raw) return null;
    const tasks = JSON.parse(raw).state?.tasks ?? [];
    return tasks.find((x: { title: string }) => x.title === t)?.lifecycle ?? null;
  }, title);
}

test.describe("task row complete checkbox regression", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/today", { waitUntil: "networkidle" });
  });

  test("outer-ring click completes without opening detail", async ({ page }) => {
    const { btn, title } = await getFirstIncomplete(page);
    const box = await btn.boundingBox();
    expect(box).toBeTruthy();
    if (!box) return;

    // Screen position that sat in the ::after padding ring on the old 20px
    // button: inside the intended 32px target but outside the clickable border box.
    const x = box.x + box.width / 2 - 14;
    const y = box.y + box.height / 2;

    await page.mouse.click(x, y);
    await page.waitForTimeout(200);

    expect(await lifecycleInStore(page, title)).toBe("done");
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });
});
