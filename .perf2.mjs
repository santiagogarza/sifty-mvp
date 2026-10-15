import { chromium } from "@playwright/test";
const base = "http://localhost:3000";
const browser = await chromium.launch({ executablePath: "/usr/local/bin/google-chrome" });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 832 } });
const api = ctx.request;
const lifecycles = ["inbox", "active", "waiting", "someday", "done"];
const ids = [];
await Promise.all(Array.from({ length: 200 }, async (_, i) => {
  const res = await api.post(`${base}/api/tasks`, { data: { sourceText: `Perf card ${i} with a reasonably long title to wrap`, lifecycle: lifecycles[i % 5], nextAction: "Next step for this card", aiStatus: "ready" } });
  ids.push((await res.json()).task.id);
}));
const page = await ctx.newPage();
await page.addInitScript(() => localStorage.setItem("sifty.viewMode", '"board"'));
await page.goto(`${base}/today`, { waitUntil: "networkidle" });
await page.getByRole("region", { name: "Focus" }).locator("[data-task-id]").first().waitFor();
const cdp = await ctx.newCDPSession(page);
for (const rate of [1, 4]) {
  await cdp.send("Emulation.setCPUThrottlingRate", { rate });
  const kb = [];
  for (let i = 0; i < 3; i++) {
    kb.push(await page.evaluate(async () => {
      const board = document.querySelector('[aria-label="Board"]');
      board.focus();
      board.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }));
      board.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }));
      await new Promise((r) => requestAnimationFrame(() => r()));
      const id = document.activeElement.getAttribute("data-task-id");
      const t = performance.now();
      document.activeElement.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", shiftKey: true, bubbles: true }));
      // Synchronous commit check, then the next painted frame.
      const sync = !!document.querySelector(`[data-status="active"] [data-task-id="${id}"]`);
      await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
      return { commit: sync, painted: performance.now() - t };
    }));
    await page.waitForTimeout(500);
  }
  const card = page.getByRole("region", { name: "Inbox" }).locator("[data-task-id]").first();
  const id = await card.getAttribute("data-task-id");
  const a = await card.boundingBox();
  const b = await page.getByRole("region", { name: "Someday" }).boundingBox();
  await page.mouse.move(a.x + 30, a.y + 15); await page.mouse.down();
  await page.mouse.move(a.x + 50, a.y + 25, { steps: 3 });
  await page.mouse.move(b.x + 60, b.y + 40, { steps: 10 });
  const wait = page.evaluate((id) => new Promise((r) => {
    window.addEventListener("pointerup", () => {
      const t = performance.now();
      requestAnimationFrame(() => setTimeout(() => r({ landed: !!document.querySelector(`[data-status="someday"] [data-task-id="${id}"]`), ms: performance.now() - t }), 0));
    }, { once: true, capture: true });
  }), id);
  await page.waitForTimeout(50);
  await page.mouse.up();
  console.log(`cpu ${rate}x keyboard:`, JSON.stringify(kb), "drop:", JSON.stringify(await wait));
  await page.waitForTimeout(800);
}
await Promise.all(ids.map((id) => api.delete(`${base}/api/tasks/${id}`)));
console.log("cleaned", ids.length);
await browser.close();
