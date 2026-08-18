import { expect, test } from "@playwright/test";
import { appendFileSync } from "node:fs";

function agentLog(
  hypothesisId: string,
  location: string,
  message: string,
  data: Record<string, unknown>,
) {
  appendFileSync(
    "/opt/cursor/logs/debug.log",
    `${JSON.stringify({ hypothesisId, location, message, data, timestamp: Date.now() })}\n`,
  );
}

test("board move and view preference survive reloads and routes", async ({ page, request }) => {
  await page.setViewportSize({ width: 2200, height: 900 });
  const marker = `Board e2e ${Date.now()}`;
  const created = await request.post("/api/tasks", {
    data: {
      sourceText: marker,
      title: marker,
      lifecycle: "active",
      aiStatus: "ready",
    },
  });
  expect(created.status()).toBe(201);
  const { task } = (await created.json()) as { task: { id: string } };

  await page.goto("/focus", { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Board" }).click();
  await expect(page.getByRole("button", { name: "Board" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("heading", { name: "Dropped" })).toHaveCount(0);

  const card = page.locator(`[data-task-id="${task.id}"]`);
  const doneColumn = page.locator('[data-board-column="done"]');
  await expect(card).toBeVisible();
  await doneColumn.scrollIntoViewIfNeeded();

  const cardBox = await card.boundingBox();
  const doneBox = await doneColumn.boundingBox();
  expect(cardBox).not.toBeNull();
  expect(doneBox).not.toBeNull();
  if (!cardBox || !doneBox) return;

  // #region agent log
  agentLog(
    "A",
    "tests/e2e/board.spec.ts:before-pointer-down",
    "Geometry and hit target after scrolling Done into view",
    await page.evaluate(
      ({ cardId, x, y }) => {
        const target = document.elementFromPoint(x, y);
        const cardElement = document.querySelector(`[data-task-id="${cardId}"]`);
        const board = document.querySelector('[aria-label="Task board"]');
        return {
          point: { x, y },
          targetTag: target?.tagName ?? null,
          targetTaskId: target?.closest("[data-task-id]")?.getAttribute("data-task-id") ?? null,
          targetColumn:
            target?.closest("[data-board-column]")?.getAttribute("data-board-column") ?? null,
          cardRect: cardElement?.getBoundingClientRect().toJSON() ?? null,
          boardRect: board?.getBoundingClientRect().toJSON() ?? null,
          boardScrollLeft: board?.scrollLeft ?? null,
        };
      },
      { cardId: task.id, x: cardBox.x + cardBox.width / 2, y: cardBox.y + cardBox.height / 2 },
    ),
  );
  // #endregion

  await page.mouse.move(cardBox.x + cardBox.width / 2, cardBox.y + cardBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(cardBox.x + cardBox.width / 2 + 8, cardBox.y + cardBox.height / 2, {
    steps: 2,
  });
  // #region agent log
  agentLog(
    "A,B",
    "tests/e2e/board.spec.ts:after-activation-move",
    "DOM state after crossing drag activation distance",
    await page.evaluate((cardId) => {
      const matches = [...document.querySelectorAll(`[data-task-id="${cardId}"]`)];
      return {
        matches: matches.length,
        classes: matches.map((element) => element.className),
        draggingMatches: matches.filter((element) => element.classList.contains("opacity-35")).length,
      };
    }, task.id),
  );
  // #endregion
  await page.mouse.move(doneBox.x + doneBox.width / 2, doneBox.y + 80, { steps: 12 });
  // #region agent log
  agentLog(
    "C,D",
    "tests/e2e/board.spec.ts:before-pointer-up",
    "Hit target and DnD visual state over Done",
    await page.evaluate(
      ({ cardId, x, y }) => {
        const target = document.elementFromPoint(x, y);
        const matches = [...document.querySelectorAll(`[data-task-id="${cardId}"]`)];
        return {
          point: { x, y },
          targetTag: target?.tagName ?? null,
          targetColumn:
            target?.closest("[data-board-column]")?.getAttribute("data-board-column") ?? null,
          draggingMatches: matches.filter((element) => element.classList.contains("opacity-35"))
            .length,
          doneIsOver: document
            .querySelector('[data-board-column="done"]')
            ?.classList.contains("border-[var(--accent)]"),
        };
      },
      { cardId: task.id, x: doneBox.x + doneBox.width / 2, y: doneBox.y + 80 },
    ),
  );
  // #endregion
  await page.mouse.up();

  const stateAfterDrop = await request.get(`/api/tasks/${task.id}`);
  // #region agent log
  agentLog(
    "D,E",
    "tests/e2e/board.spec.ts:after-pointer-up",
    "DOM and server lifecycle immediately after drop",
    {
      domColumn: await card
        .evaluate((element) =>
          element.closest("[data-board-column]")?.getAttribute("data-board-column"),
        )
        .catch(() => null),
      serverStatus: stateAfterDrop.status(),
      serverTask: stateAfterDrop.ok() ? (await stateAfterDrop.json()).task : null,
    },
  );
  // #endregion

  await expect(doneColumn.locator(`[data-task-id="${task.id}"]`)).toBeVisible();
  await expect
    .poll(async () => {
      const response = await request.get(`/api/tasks/${task.id}`);
      if (!response.ok()) return null;
      const json = (await response.json()) as {
        task: { lifecycle: string; completedAt: string | null };
      };
      return json.task;
    })
    .toMatchObject({ lifecycle: "done", completedAt: expect.any(String) });

  await page.reload({ waitUntil: "networkidle" });
  await expect(page.getByRole("button", { name: "Board" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator('[data-board-column="done"]')).toContainText(marker);

  await page.goto("/inbox", { waitUntil: "networkidle" });
  await expect(page.getByRole("button", { name: "Board" })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: /show dropped/i }).click();
  await expect(page.getByRole("heading", { name: "Dropped" })).toBeVisible();
});
